import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { request } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { localDevRequest } from '../../../infrastructure/m1-speech-proxy/dev-origin'
import { Quota, RateWindow } from '../../../infrastructure/m1-speech-proxy/quota'
import { configuration, createProxy, type Config } from '../../../infrastructure/m1-speech-proxy/node-server'

const directories: string[] = []
const cleanups: (() => Promise<unknown>)[] = []
function ledger(): string {
  const directory = mkdtempSync(join(tmpdir(), 'm1-quota-')); directories.push(directory)
  return join(directory, 'quota.sqlite')
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('local development origin boundary', () => {
  it('accepts HTTP/1.1 Host and HTTP/2 authority only for the matching localhost origin', () => {
    expect(localDevRequest({ headers: { host: 'localhost:5173', origin: 'https://localhost:5173' } })).toBe(true)
    expect(localDevRequest({ headers: { ':authority': 'localhost:5173', origin: 'https://localhost:5173' } })).toBe(true)
    expect(localDevRequest({ headers: { host: 'localhost:5173', ':authority': 'attacker.example', origin: 'https://localhost:5173' } })).toBe(false)
    expect(localDevRequest({ headers: { host: 'localhost:5173', origin: 'https://attacker.example' } })).toBe(false)
    expect(localDevRequest({ headers: { ':authority': 'localhost:5173' } })).toBe(false)
    expect(localDevRequest({ headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } }, 'http:')).toBe(true)
    expect(localDevRequest({ headers: { host: 'localhost:5173', origin: 'https://localhost:5173' } }, 'http:')).toBe(false)
    expect(localDevRequest({ headers: { host: 'attacker.example:5173', origin: 'http://attacker.example:5173' } }, 'http:')).toBe(false)
  })
})

describe('persistent budget and bounded rate limiting', () => {
  it('commits attempts across restart and rejects clock rollback', () => {
    const path = ledger(), first = new Quota(path, 2, 3, true)
    expect(first.reserve(new Date('2026-10-29T00:00Z'))).toBe(true)
    first.close()
    const second = new Quota(path, 2, 3)
    expect(second.reserve(new Date('2026-10-29T01:00Z'))).toBe(true)
    expect(second.reserve(new Date('2026-10-29T02:00Z'))).toBe(false)
    expect(second.reserve(new Date('2026-10-28T00:00Z'))).toBe(false)
    expect(second.reserve(new Date('2026-10-30T00:00Z'))).toBe(true)
    expect(second.reserve(new Date('2026-10-31T00:00Z'))).toBe(false)
    expect(second.reserve(new Date('2026-11-01T00:00Z'))).toBe(true)
    second.close()
  })
  it('serializes quota reservations from separate database connections', async () => {
    const path = ledger(), a = new Quota(path, 1, 1, true), b = new Quota(path, 1, 1)
    expect(await Promise.all([Promise.resolve().then(() => a.reserve()), Promise.resolve().then(() => b.reserve())])).toEqual([true, false])
    a.close(); b.close()
  })
  it('retains a committed attempt after the owning process is killed', async () => {
    const path = ledger(); new Quota(path, 1, 1, true).close()
    const source = `
      const { Quota } = await import(process.argv[1]);
      const quota = new Quota(process.argv[2], 1, 1);
      process.send(quota.reserve(new Date('2026-10-29T00:00Z')));
      setInterval(() => {}, 1000);
    `
    const child = spawn(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', source,
      pathToFileURL(resolve('infrastructure/m1-speech-proxy/quota.ts')).href, path], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    try {
      expect((await once(child, 'message'))[0]).toBe(true)
      const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited
      const recovered = new Quota(path, 1, 1)
      expect(recovered.reserve(new Date('2026-10-29T01:00Z'))).toBe(false)
      recovered.close()
    } finally { child.kill('SIGKILL') }
  })
  it('uses the Shanghai date boundary and never recreates a missing ledger', () => {
    const path = ledger()
    expect(() => new Quota(path, 1, 2)).toThrow()
    const q = new Quota(path, 1, 2, true)
    expect(q.reserve(new Date('2026-10-29T15:59Z'))).toBe(true)
    expect(q.reserve(new Date('2026-10-29T16:00Z'))).toBe(true)
    expect(q.reserve(new Date('2026-10-29T16:01Z'))).toBe(false)
    q.close()
  })
  it('bounds identifiers and expires windows', () => {
    const window = new RateWindow(1, 2)
    expect(window.allow('a', 0)).toBe(true)
    expect(window.allow('a', 1)).toBe(false)
    expect(window.allow('b', 2)).toBe(true)
    expect(window.allow('c', 3)).toBe(false)
    expect(window.allow('c', 60_001)).toBe(true)
  })
  it('needs vendor credentials and budgets but no access password or session secret', () => {
    const env = { APP_ORIGIN: 'https://app.example', IAT_APP_ID: 'app', IAT_API_KEY: 'key',
      IAT_API_SECRET: 'secret', QUOTA_DB: '/tmp/quota.sqlite', MAX_CONNECTIONS: '2',
      DAILY_ATTEMPTS: '10', MONTHLY_ATTEMPTS: '100' }
    expect(configuration(env)).toMatchObject({ concurrent: 2, daily: 10, monthly: 100 })
    expect(() => configuration({ ...env, IAT_API_SECRET: '' })).toThrow('IAT_API_SECRET')
  })
  it('requires explicit budgets and does not accept malformed values', () => {
    expect(() => configuration({ APP_ORIGIN: 'https://app.example' })).toThrow()
    expect(() => new Quota(ledger(), 0, 1, true)).toThrow()
  })
})

async function fixture(budget = 10, concurrent = 2, recoveryMs = 0) {
  const database = ledger(); new Quota(database, budget, budget, true).close()
  const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await once(upstream, 'listening')
  const upstreamAddress = upstream.address()
  if (typeof upstreamAddress === 'string' || !upstreamAddress) throw new Error('No address')
  let dials = 0
  const messages: string[] = []
  upstream.on('connection', ws => ws.on('message', data => {
    messages.push(data.toString())
    const frame = JSON.parse(data.toString()) as { data: { status: number } }
    if (frame.data.status === 2) ws.send(JSON.stringify({ code: 0, sid: 'private', data: { status: 2, result: { sn: 0, ws: [{ cw: [{ w: '完成。' }] }] } } }))
  }))
  const config: Config = { origin: 'https://app.example', appId: 'app', apiKey: 'key', apiSecret: 'secret', database, daily: budget, monthly: budget, concurrent, port: 0 }
  const proxy = createProxy(config, { recoveryMs, dial: () => { dials++; return new WebSocket(`ws://127.0.0.1:${upstreamAddress.port}`) } })
  proxy.server.listen(0, '127.0.0.1'); await once(proxy.server, 'listening')
  const address = proxy.server.address()
  if (typeof address === 'string' || !address) throw new Error('No address')
  const port = address.port
  const headers = { Host: 'app.example', Origin: config.origin, 'X-Forwarded-Proto': 'https', 'X-Real-IP': '203.0.113.1' }
  const clients: WebSocket[] = []
  cleanups.push(async () => {
    for (const client of clients) client.terminate()
    for (const ws of upstream.clients) ws.terminate()
    await proxy.stop()
    await new Promise<void>(resolve => upstream.close(() => resolve()))
  })
  async function http(path: string, body = '', extra: Record<string, string> = {}) {
    return new Promise<{ status: number; cookie?: string }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', ...extra } }, res => {
        res.resume(); res.once('end', () => resolve({ status: res.statusCode!, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] }))
      }); req.on('error', reject); req.end(body)
    })
  }
  function connect(extra: Record<string, string> = {}, path = '/api/m1/iat') {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers: { ...headers, ...extra } })
    ws.on('error', () => undefined); clients.push(ws); return ws
  }
  return { connect, http, proxy, config, messages, dials: () => dials }
}
async function rejection(ws: WebSocket): Promise<number> {
  return new Promise(resolve => ws.once('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); resolve(res.statusCode!) }))
}

describe('real Node HTTP and WebSocket transport with a local mock vendor', () => {
  it('allows anonymous access while preserving origin checks, audio injection, redaction and final close', async () => {
    const f = await fixture()
    expect((await f.http('/api/m1/login', '{"password":"wrong"}')).status).toBe(404)
    expect((await f.http('/api/m1/logout')).status).toBe(404)
    expect((await f.http('/api/m1/login', '{}', { Origin: 'https://attacker.example' })).status).toBe(403)
    expect(await rejection(f.connect({ Origin: 'https://attacker.example' }))).toBe(403)
    expect(await rejection(f.connect({}, '/api/m1/iat?target=wss://attacker.example'))).toBe(404)
    expect(f.dials()).toBe(0)
    const ws = f.connect(); await once(ws, 'open')
    const result = once(ws, 'message'), closed = once(ws, 'close')
    ws.send(JSON.stringify({ data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: Buffer.alloc(1280).toString('base64') } }))
    ws.send('{"data":{"status":2}}')
    expect(String((await result)[0])).not.toContain('private')
    expect(String((await result)[0])).toContain('完成。')
    expect((await closed)[0]).toBe(1000)
    expect(JSON.parse(f.messages[0]!).common).toEqual({ app_id: 'app' })
  })
  it('enforces the per-IP connection limit without a session cookie', async () => {
    const f = await fixture(100, 30)
    for (let i = 0; i < 20; i++) await once(f.connect(), 'open')
    expect(await rejection(f.connect())).toBe(429)
    expect(f.dials()).toBe(20)
  })
  it('enforces the global connection limit across anonymous IP addresses', async () => {
    const f = await fixture(100, 70)
    for (let i = 0; i < 60; i++) await once(f.connect({ 'X-Real-IP': `203.0.113.${i + 1}` }), 'open')
    expect(await rejection(f.connect({ 'X-Real-IP': '203.0.113.100' }))).toBe(429)
    expect(f.dials()).toBe(60)
  })
  it('refuses exhausted budgets before dialing the vendor', async () => {
    const f = await fixture(1)
    const ws = f.connect(); await once(ws, 'open')
    expect(await rejection(f.connect())).toBe(429)
    expect(f.dials()).toBe(1)
  })
  it('counts established connections and rejects excess concurrency', async () => {
    const f = await fixture(10, 1)
    const ws = f.connect(); await once(ws, 'open')
    expect(await rejection(f.connect())).toBe(429)
    expect(f.dials()).toBe(1)
  })
  it('blocks paid traffic during recovery and a second process using the same ledger', async () => {
    const f = await fixture(10, 2, 90_000)
    expect(await rejection(f.connect())).toBe(503)
    expect(f.dials()).toBe(0)
    expect(() => createProxy(f.config)).toThrow('Another proxy')
  })
  it('releases the slot after a normal final result', async () => {
    const f = await fixture(10, 1)
    const ws = f.connect(); await once(ws, 'open')
    const closed = once(ws, 'close')
    ws.send(JSON.stringify({ data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: Buffer.alloc(1280).toString('base64') } }))
    ws.send('{"data":{"status":2}}'); await closed
    await new Promise(resolve => setTimeout(resolve, 20))
    const next = f.connect(); await once(next, 'open')
    expect(f.dials()).toBe(2)
  })
  it('abnormal browser disconnect closes its upstream', async () => {
    const f = await fixture()
    const ws = f.connect(); await once(ws, 'open')
    const closed = once(ws, 'close'); ws.terminate(); await closed
    // stop waits for the upstream to close too; cleanup must finish without the 70s deadline.
  })
})
