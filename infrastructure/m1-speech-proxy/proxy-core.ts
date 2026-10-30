import { decodeIat } from '../../src/modules/m1-speech-recognition/protocol.js'

// Only the small Workers runtime surface used here; no platform SDK is needed by the browser project.
export interface EdgeSocket extends EventTarget {
  accept(): void
  send(data: string): void
  close(code?: number, reason?: string): void
}
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
export const cookieName = '__Host-m1-session'
export const lifetime = 8 * 60 * 60
function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
async function hmac(secret: string, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
}
export async function sameSecret(left: string, right: string): Promise<boolean> {
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(left)))
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(right)))
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return difference === 0
}

export async function issueSession(env: Pick<ProxyEnv, 'SESSION_SECRET'>): Promise<string> {
  const body = `${Math.floor(Date.now() / 1000) + lifetime}.${crypto.randomUUID()}`
  return `${body}.${base64url(await hmac(env.SESSION_SECRET, body))}`
}
export async function validSession(request: Request, env: Pick<ProxyEnv, 'SESSION_SECRET'>): Promise<string | undefined> {
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

