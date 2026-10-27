import { decodeIat } from '../../src/modules/m1-speech-recognition/protocol'

// Only the small Workers runtime surface used here; no platform SDK is needed by the browser project.
interface EdgeSocket extends EventTarget {
  accept(): void
  send(data: string): void
  close(code?: number, reason?: string): void
}
declare const WebSocketPair: new () => { 0: EdgeSocket; 1: EdgeSocket }
interface UpgradeResponse extends Response { webSocket?: EdgeSocket }
interface UpgradeInit extends ResponseInit { webSocket: EdgeSocket }
interface RateLimit { limit(options: { key: string }): Promise<{ success: boolean }> }
export interface ProxyEnv {
  APP_ORIGIN: string
  IAT_APP_ID: string
  IAT_API_KEY: string
  IAT_API_SECRET: string
  ACCESS_PASSWORD: string
  SESSION_SECRET: string
  LOGIN_LIMIT: RateLimit
  CONNECT_LIMIT: RateLimit
  TOTAL_LIMIT: RateLimit
}

const encoder = new TextEncoder()
const cookieName = '__Host-m1-session'
const lifetime = 8 * 60 * 60
function response(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
}
function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
async function hmac(secret: string, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
}
async function sameSecret(left: string, right: string): Promise<boolean> {
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(left)))
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(right)))
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return difference === 0
}

async function issueSession(env: ProxyEnv): Promise<string> {
  const body = `${Math.floor(Date.now() / 1000) + lifetime}.${crypto.randomUUID()}`
  return `${body}.${base64url(await hmac(env.SESSION_SECRET, body))}`
}
async function validSession(request: Request, env: ProxyEnv): Promise<string | undefined> {
  const value = request.headers.get('Cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  if (!value || value.length > 200) return
  const parts = value.split('.')
  if (parts.length !== 3) return
  const [expiry, nonce, signature] = parts
  if (!expiry || !nonce || !signature || !/^\d+$/.test(expiry) || !/^[\da-f-]{36}$/.test(nonce)) return
  const seconds = Number(expiry) - Math.floor(Date.now() / 1000)
  if (seconds <= 0 || seconds > lifetime) return
  if (await sameSecret(signature, base64url(await hmac(env.SESSION_SECRET, `${expiry}.${nonce}`)))) return nonce
}

/** Signed URL is used only by the trusted upstream fetch, never returned to a browser or log. */
export async function upstreamUrl(env: Pick<ProxyEnv, 'IAT_API_KEY' | 'IAT_API_SECRET'>): Promise<URL> {
  const date = new Date().toUTCString()
  const signature = btoa(String.fromCharCode(...await hmac(env.IAT_API_SECRET,
    `host: iat-api.xfyun.cn\ndate: ${date}\nGET /v2/iat HTTP/1.1`)))
  const authorization = btoa(`api_key="${env.IAT_API_KEY}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`)
  const url = new URL('https://iat-api.xfyun.cn/v2/iat')
  url.search = new URLSearchParams({ authorization, date, host: 'iat-api.xfyun.cn' }).toString()
  return url
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid frame.')
  return value as Record<string, unknown>
}

/** Validate/replace every client field so an authenticated page cannot enable other vendor features. */
export function clientFrame(raw: unknown, first: boolean, appId: string): { json: string; bytes: number; end: boolean } {
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid frame.')
  const root = record(JSON.parse(raw) as unknown)
  if (Object.keys(root).some(key => key !== 'data')) throw new Error('Invalid frame.')
  const data = record(root.data)
  if (data.status === 2) {
    if (first || Object.keys(data).some(key => key !== 'status')) throw new Error('Invalid end frame.')
    return { json: JSON.stringify({ data: { status: 2 } }), bytes: 0, end: true }
  }
  if (data.status !== (first ? 0 : 1) || data.format !== 'audio/L16;rate=16000' || data.encoding !== 'raw'
    || typeof data.audio !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.audio)
    || Object.keys(data).some(key => !['status', 'format', 'encoding', 'audio'].includes(key))) throw new Error('Invalid audio frame.')
  const binary = atob(data.audio)
  if (!binary.length || binary.length > 1280 || binary.length % 2 || btoa(binary) !== data.audio) throw new Error('Invalid PCM frame.')
  return {
    json: JSON.stringify({
      ...(first ? {
        common: { app_id: appId },
        business: { language: 'zh_cn', domain: 'iat', accent: 'mandarin', ptt: 1, pcm: 0, eos: 2000 },
      } : {}),
      data: { status: first ? 0 : 1, format: 'audio/L16;rate=16000', encoding: 'raw', audio: data.audio },
    }),
    bytes: binary.length, end: false,
  }
}

/** Both halves have one terminal path; server errors are redacted before leaving the proxy. */
export function bridge(client: EdgeSocket, upstream: EdgeSocket, appId: string): () => void {
  let closed = false, first = true, ending = false, bytes = 0
  const opened = Date.now()
  let firstAudio = opened
  const limit = setTimeout(() => finish(false), 58_000)
  let idle = setTimeout(() => finish(false), 10_000)
  function finish(normal: boolean): void {
    if (closed) return
    closed = true; clearTimeout(limit); clearTimeout(idle)
    client.removeEventListener('message', fromClient); upstream.removeEventListener('message', fromUpstream)
    client.removeEventListener('error', fault); upstream.removeEventListener('error', fault)
    client.removeEventListener('close', clientClosed); upstream.removeEventListener('close', fault)
    if (!normal) {
      try { client.send(JSON.stringify({ code: -1, message: 'Speech proxy session failed.' })) } catch { /* Disconnected. */ }
    }
    try { upstream.close(1000) } catch { /* Disconnected. */ }
    try { client.close(normal ? 1000 : 1011) } catch { /* Disconnected. */ }
  }
  function fault(): void { finish(false) }
  function clientClosed(): void { finish(true) }
  function fromClient(event: Event): void {
    if (closed) return
    try {
      if (ending || !(event instanceof MessageEvent)) throw new Error('Invalid frame.')
      const frame = clientFrame(event.data as unknown, first, appId)
      if (first) firstAudio = Date.now()
      bytes += frame.bytes
      // A small jitter allowance permits network batching, not unbounded accelerated uploads.
      if (bytes > 1_856_000 || bytes > (Date.now() - firstAudio + 250) * 32) throw new Error('Audio rate exceeded.')
      upstream.send(frame.json)
      first = false; ending = frame.end
      clearTimeout(idle); idle = setTimeout(() => finish(false), frame.end ? 5000 : 10_000)
    } catch { finish(false) }
  }
  function fromUpstream(event: Event): void {
    if (closed) return
    try {
      if (!(event instanceof MessageEvent)) throw new Error('Invalid response.')
      const message = decodeIat(event.data as unknown)
      const root = record(JSON.parse(String(event.data)) as unknown)
      const result = message.result
      // Whitelist protocol fields; never forward vendor diagnostics or unknown nested metadata.
      client.send(JSON.stringify({ code: 0, data: {
        status: record(root.data).status,
        ...(result ? { result: {
          sn: result.sn, ws: [{ cw: [{ w: result.text }] }],
          ...(result.dynamic ? {
            pgs: result.replacement ? 'rpl' : 'apd', ...(result.replacement ? { rg: result.replacement } : {}),
          } : {}),
        } } : {}),
      } }))
      if (message.ended) finish(true)
    } catch { finish(false) }
  }
  client.addEventListener('message', fromClient); upstream.addEventListener('message', fromUpstream)
  client.addEventListener('close', clientClosed); upstream.addEventListener('close', fault)
  client.addEventListener('error', fault); upstream.addEventListener('error', fault)
  return () => finish(true)
}

export default {
  /** Dedicated M1 routes only. No records, database, account registration or business APIs. */
  async fetch(request: Request, env: ProxyEnv): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (!env.APP_ORIGIN || !env.IAT_APP_ID || !env.IAT_API_KEY || !env.IAT_API_SECRET
        || !env.ACCESS_PASSWORD || env.ACCESS_PASSWORD.length < 20 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32
        || !env.LOGIN_LIMIT || !env.CONNECT_LIMIT || !env.TOTAL_LIMIT) return response(503)
      if (url.origin !== env.APP_ORIGIN || url.protocol !== 'https:' || request.headers.get('Origin') !== env.APP_ORIGIN) return response(403)
      const ip = request.headers.get('CF-Connecting-IP')
      if (!ip) return response(403)
      if (url.pathname === '/api/m1/login' && request.method === 'POST') {
        if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return response(415)
        if (!(await env.LOGIN_LIMIT.limit({ key: `login:${ip}` })).success
          || !(await env.LOGIN_LIMIT.limit({ key: 'login-total' })).success) return response(429)
        const reader = request.body?.getReader()
        if (!reader) return response(400)
        let size = 0, body = ''
        try {
          const decoder = new TextDecoder()
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            size += chunk.value.byteLength
            if (size > 1024) { await reader.cancel(); return response(413) }
            body += decoder.decode(chunk.value, { stream: true })
          }
          body += decoder.decode()
        } finally { reader.releaseLock() }
        const password = record(JSON.parse(body) as unknown).password
        if (typeof password !== 'string' || !await sameSecret(password, env.ACCESS_PASSWORD)) return response(401)
        return new Response(null, { status: 204, headers: {
          'Cache-Control': 'no-store',
          'Set-Cookie': `${cookieName}=${await issueSession(env)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${lifetime}`,
        } })
      }
      if (url.pathname === '/api/m1/logout' && request.method === 'POST') {
        return new Response(null, { status: 204, headers: {
          'Cache-Control': 'no-store', 'Set-Cookie': `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
        } })
      }
      if (url.pathname !== '/api/m1/iat' || request.method !== 'GET') return response(404)
      const session = await validSession(request, env)
      if (!session) return response(401)
      if (url.search || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return response(400)
      if (!(await env.CONNECT_LIMIT.limit({ key: `session:${session}` })).success
        || !(await env.CONNECT_LIMIT.limit({ key: `ip:${ip}` })).success
        || !(await env.TOTAL_LIMIT.limit({ key: 'all-connections' })).success) return response(429)
      // Workers fetch performs the outbound WebSocket handshake; the URL never reaches the page.
      const handshake = new AbortController()
      const handshakeTimeout = setTimeout(() => handshake.abort(), 10_000)
      let result: UpgradeResponse
      try {
        result = await fetch(await upstreamUrl(env), {
          headers: { Upgrade: 'websocket' }, signal: handshake.signal,
        })
      } finally {
        // In Workers the fetch signal still controls the upgraded socket. The timeout
        // belongs to the handshake, so it must not abort an established recording.
        clearTimeout(handshakeTimeout)
      }
      if (result.status !== 101 || !result.webSocket) return response(502)
      let pair: InstanceType<typeof WebSocketPair> | undefined
      let cleanup: (() => void) | undefined
      try {
        pair = new WebSocketPair()
        result.webSocket.accept(); pair[1].accept()
        cleanup = bridge(pair[1], result.webSocket, env.IAT_APP_ID)
        const init: UpgradeInit = { status: 101, webSocket: pair[0] }
        return new Response(null, init)
      } catch {
        cleanup?.()
        try { result.webSocket.close(1000) } catch { /* Partial upgrade. */ }
        try { pair?.[1].close(1011) } catch { /* Partial upgrade. */ }
        return response(503)
      }
    } catch { return response(503) }
  },
}
