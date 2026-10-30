import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { isIP, Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import WebSocket, { WebSocketServer } from 'ws'
import { bridge, upstreamUrl, type EdgeSocket } from './proxy-core.js'
import { Quota, RateWindow } from './quota.js'

export interface Config {
  origin: string; appId: string; apiKey: string; apiSecret: string
  database: string; concurrent: number; daily: number; monthly: number; port: number
}
function positive(value: string | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Missing or invalid numeric configuration.')
  return Number(value)
}
export function configuration(env: NodeJS.ProcessEnv): Config {
  const origin = new URL(env.APP_ORIGIN ?? '')
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN) throw new Error('APP_ORIGIN must be an HTTPS origin.')
  const required = (key: string, min = 1) => {
    const value = env[key]
    if (!value || value.length < min) throw new Error(`Missing or invalid ${key}.`)
    return value
  }
  const port = positive(env.PORT ?? '8787')
  if (port > 65535) throw new Error('Invalid port.')
  return {
    origin: origin.origin, appId: required('IAT_APP_ID'), apiKey: required('IAT_API_KEY'), apiSecret: required('IAT_API_SECRET'),
    database: required('QUOTA_DB'),
    concurrent: positive(env.MAX_CONNECTIONS), daily: positive(env.DAILY_ATTEMPTS), monthly: positive(env.MONTHLY_ATTEMPTS), port,
  }
}

/** Adapt ws to the existing bridge, retaining text-only messages and its single terminal path. */
class SocketAdapter extends EventTarget implements EdgeSocket {
  private closeTimer?: ReturnType<typeof setTimeout>
  constructor(private readonly ws: WebSocket, maxPayload: number) {
    super()
    ws.on('message', (data, binary) => {
      const buffer = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
      const text = buffer.toString('utf8')
      if (binary || Buffer.byteLength(text) > maxPayload) { this.dispatchEvent(new Event('error')); return }
      this.dispatchEvent(new MessageEvent('message', { data: text }))
    })
    ws.on('error', () => { this.dispatchEvent(new Event('error')) })
    ws.once('close', () => { clearTimeout(this.closeTimer); this.dispatchEvent(new Event('close')) })
  }
  accept(): void { /* Node sockets are accepted by handleUpgrade/open. */ }
  send(data: string): void {
    if (this.ws.readyState !== WebSocket.OPEN || this.ws.bufferedAmount > 96_000) throw new Error('Socket unavailable.')
    this.ws.send(data, error => { if (error) this.dispatchEvent(new Event('error')) })
  }
  close(code = 1000): void {
    if (this.ws.readyState === WebSocket.CLOSED) return
    this.ws.close(code)
    this.closeTimer ??= setTimeout(() => this.ws.terminate(), 2000)
  }
}

/** The production entry always uses the fixed vendor; dependency injection is only for local tests. */
export function createProxy(config: Config, options: {
  dial?: (url: URL) => WebSocket; recoveryMs?: number; now?: () => number
} = {}) {
  // A SQLite lock is released by the OS on crash, unlike a stale PID/lock file.
  const lock = new DatabaseSync(`${config.database}.lock`)
  lock.exec('PRAGMA busy_timeout = 0')
  try { lock.exec('CREATE TABLE IF NOT EXISTS owner (id INTEGER); BEGIN EXCLUSIVE') }
  catch { lock.close(); throw new Error('Another proxy owns this quota ledger.') }
  let quota: Quota
  try {
    if (!existsSync(config.database)) throw new Error('Initialize the quota ledger explicitly before starting.')
    quota = new Quota(config.database, config.daily, config.monthly)
  } catch (error) { lock.close(); throw error }
  const now = options.now ?? (() => performance.now())
  const readyAt = now() + (options.recoveryMs ?? 90_000)
  const connect = new RateWindow(20), total = new RateWindow(60)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false })
  const transports = new Set<WebSocket>()
  const slots = new Set<symbol>()
  const quarantine = new Set<ReturnType<typeof setTimeout>>()
  let stopping = false
  let stopPromise: Promise<void> | undefined
  const server = createServer((req, res) => { void http(req, res).catch(() => reply(res, 503)) })
  server.headersTimeout = 10_000; server.requestTimeout = 10_000
  server.maxHeadersCount = 32
  server.on('request', req => { req.setTimeout(10_000, () => req.destroy()) })
  function reply(res: ServerResponse, status: number): void {
    if (res.destroyed || res.headersSent) return
    res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end()
  }
  function trusted(req: IncomingMessage): boolean {
    return req.headers.host === new URL(config.origin).host && req.headers.origin === config.origin
      && req.headers['x-forwarded-proto'] === 'https' && typeof req.headers['x-real-ip'] === 'string' && isIP(req.headers['x-real-ip']) !== 0
  }
  async function http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.url === '/healthz' && req.method === 'GET') { reply(res, !stopping && now() >= readyAt ? 204 : 503); return }
    if (!trusted(req)) { reply(res, 403); return }
    reply(res, 404)
  }
  server.on('upgrade', (req, socket, head) => {
    if (!(socket instanceof Socket)) { socket.destroy(); return }
    // Always absorb transport errors, including requests rejected before ws takes ownership.
    socket.on('error', () => { socket.destroy() })
    socket.setTimeout(12_000, () => socket.destroy())
    const reject = (status: number) => { if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`) }
    const upgrade = async () => {
      if (stopping || now() < readyAt) return reject(503)
      if (!trusted(req)) return reject(403)
      if (req.method !== 'GET' || req.url !== '/api/m1/iat') return reject(404)
      // Validate the downstream handshake before spending an upstream attempt.
      if (req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13'
        || !/^[+/0-9A-Za-z]{22}==$/.test(String(req.headers['sec-websocket-key'] ?? ''))) return reject(400)
      if (socket.destroyed || stopping) return
      if (!connect.allow(`ip:${String(req.headers['x-real-ip'])}`) || !total.allow('all')) return reject(429)
      if (slots.size >= config.concurrent) return reject(429)
      const slot = Symbol(); slots.add(slot)
      let upstream: WebSocket | undefined
      const started = now()
      const release = () => { slots.delete(slot) }
      try {
        if (!quota.reserve()) { release(); return reject(429) }
        const url = await upstreamUrl({ IAT_API_KEY: config.apiKey, IAT_API_SECRET: config.apiSecret }); url.protocol = 'wss:'
        if (socket.destroyed || stopping) { release(); return }
        upstream = options.dial ? options.dial(url) : new WebSocket(url, { handshakeTimeout: 10_000, maxPayload: 262_144, perMessageDeflate: false })
        const vendor = upstream
        transports.add(vendor)
        let opened = false
        const abort = () => { if (vendor.readyState !== WebSocket.CLOSED) vendor.terminate() }
        socket.once('close', abort)
        vendor.on('error', () => { reject(502) }) // Never log error objects containing signed URLs.
        vendor.once('close', code => {
          transports.delete(vendor); socket.removeListener('close', abort)
          if (opened && code === 1000) release()
          else {
            const timer = setTimeout(() => { quarantine.delete(timer); release() }, Math.max(0, 90_000 - (now() - started)))
            quarantine.add(timer)
          }
          if (!opened) reject(502)
        })
        vendor.once('open', () => {
          opened = true
          if (socket.destroyed || stopping) { abort(); return }
          try {
            wss.handleUpgrade(req, socket, head, client => {
              socket.setTimeout(0)
              socket.removeListener('close', abort)
              transports.add(client); client.once('close', () => transports.delete(client))
              bridge(new SocketAdapter(client, 4096), new SocketAdapter(vendor, 262_144), config.appId)
            })
          } catch { abort(); reject(503) }
        })
      } catch {
        if (upstream) upstream.terminate()
        else release()
        reject(503)
      }
    }
    void upgrade().catch(() => reject(503))
  })
  return {
    server,
    stop(): Promise<void> {
      stopping = true
      if (stopPromise) return stopPromise
      stopPromise = new Promise(resolve => {
        let httpClosed = false
        const deadline = setTimeout(() => { for (const ws of transports) ws.terminate(); server.closeAllConnections() }, 70_000)
        server.close(() => { httpClosed = true })
        const poll = setInterval(() => {
          if (!httpClosed || transports.size) return
          clearInterval(poll); clearTimeout(deadline)
          for (const timer of quarantine) clearTimeout(timer)
          wss.close(); quota.close(); lock.close(); resolve()
        }, 25)
      })
      return stopPromise
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.umask(0o077)
    const config = configuration(process.env)
    if (process.argv.includes('--init-quota')) {
      if (existsSync(config.database)) throw new Error('Ledger already exists; refusing to reset it.')
      new Quota(config.database, config.daily, config.monthly, true).close()
      console.log('Quota ledger initialized.')
    } else {
      const proxy = createProxy(config)
      proxy.server.on('error', () => { console.error('Proxy listener failed.'); process.exit(1) })
      proxy.server.listen(config.port, '127.0.0.1', () => console.log('M1 proxy listening; recovery cooldown is 90 seconds.'))
      const stop = () => { void proxy.stop().then(() => process.exit(0)) }
      process.once('SIGTERM', stop); process.once('SIGINT', stop)
    }
  } catch { console.error('Proxy startup refused. Check configuration, quota ledger and single-process ownership.'); process.exitCode = 1 }
}
