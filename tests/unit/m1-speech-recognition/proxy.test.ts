import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { bridge, clientFrame, upstreamUrl, type ProxyEnv } from '../../../infrastructure/m1-speech-proxy/worker'

class EdgeSocket extends EventTarget {
  accept = vi.fn()
  send = vi.fn<(data: string) => void>()
  close = vi.fn()
  message(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })) }
}
const nativeResponse = Response
class WorkerResponse extends nativeResponse {
  readonly webSocket?: unknown
  constructor(body?: BodyInit | null, init?: ResponseInit & { webSocket?: unknown }) {
    super(body, init?.status === 101 ? { ...init, status: 200 } : init)
    if (init?.status === 101) Object.defineProperty(this, 'status', { value: 101 })
    this.webSocket = init?.webSocket
  }
}
let env: ProxyEnv
let upstream: EdgeSocket
let pair: { 0: EdgeSocket; 1: EdgeSocket }
let upstreamFetch: ReturnType<typeof vi.fn>
function request(path: string, method = 'GET', extra: Record<string, string> = {}, body?: string): Request {
  return new Request(`https://inspection.example/api/m1/${path}`, {
    method, body, headers: { Origin: 'https://inspection.example', 'CF-Connecting-IP': '203.0.113.10', ...extra },
  })
}
async function login(): Promise<string> {
  const result = await worker.fetch(request('login', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ password: env.ACCESS_PASSWORD })), env)
  expect(result.status).toBe(204)
  return result.headers.get('Set-Cookie')!.split(';')[0]!
}
async function connect(cookie: string) {
  return worker.fetch(request('iat', 'GET', { Cookie: cookie, Upgrade: 'websocket' }), env)
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T00:00:00Z'))
  env = {
    APP_ORIGIN: 'https://inspection.example', IAT_APP_ID: 'test-app', IAT_API_KEY: 'test-key-only',
    IAT_API_SECRET: 'test-secret-only', ACCESS_PASSWORD: 'test-access-password-for-tests-only',
    SESSION_SECRET: 'test-cookie-signature-secret-for-tests-only',
    LOGIN_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
    CONNECT_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
    TOTAL_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
  }
  upstream = new EdgeSocket()
  pair = { 0: new EdgeSocket(), 1: new EdgeSocket() }
  vi.stubGlobal('WebSocketPair', class { constructor() { return pair } })
  vi.stubGlobal('Response', WorkerResponse)
  upstreamFetch = vi.fn(async () => new WorkerResponse(null, { status: 101, webSocket: upstream }))
  vi.stubGlobal('fetch', upstreamFetch)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('M1 proxy authentication and vendor boundary', () => {
  it('refuses unauthenticated connections without contacting the paid service', async () => {
    expect((await connect('')).status).toBe(401)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
  it('issues a secure short-lived HttpOnly cookie without returning secrets', async () => {
    const result = await worker.fetch(request('login', 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ password: env.ACCESS_PASSWORD })), env)
    expect(result.status).toBe(204)
    const cookie = result.headers.get('Set-Cookie')!
    expect(cookie).toContain('__Host-m1-session=')
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800')
    expect(cookie).not.toContain(env.ACCESS_PASSWORD); expect(cookie).not.toContain(env.SESSION_SECRET)
    expect(result.headers.get('Cache-Control')).toBe('no-store')
  })
  it('validates the shared password on the server', async () => {
    const result = await worker.fetch(request('login', 'POST', { 'Content-Type': 'application/json' }, '{"password":"wrong"}'), env)
    expect(result.status).toBe(401); expect(upstreamFetch).not.toHaveBeenCalled()
  })
  it('rejects cross-origin requests even when a valid cookie is present', async () => {
    const cookie = await login()
    expect((await worker.fetch(request('iat', 'GET', { Origin: 'https://attacker.example', Cookie: cookie, Upgrade: 'websocket' }), env)).status).toBe(403)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
  it('does not trust same-site form posts as login requests', async () => {
    expect((await worker.fetch(request('login', 'POST', { 'Content-Type': 'text/plain' }, '{}'), env)).status).toBe(415)
  })
  it('bounds login request size before parsing', async () => {
    const result = await worker.fetch(request('login', 'POST', { 'Content-Type': 'application/json' }, 'x'.repeat(1025)), env)
    expect(result.status).toBe(413)
  })
  it.each(['ACCESS_PASSWORD', 'SESSION_SECRET', 'IAT_API_SECRET'] as const)('fails closed when %s is missing', async key => {
    env[key] = ''
    expect((await worker.fetch(request('login', 'POST'), env)).status).toBe(503)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
  it('rejects expired and tampered cookies', async () => {
    const cookie = await login()
    expect((await connect(`${cookie}tampered`)).status).toBe(401)
    vi.advanceTimersByTime(8 * 3600 * 1000)
    expect((await connect(cookie)).status).toBe(401)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
  it('invalidates old sessions after server-side signing-secret rotation', async () => {
    const cookie = await login(); env.SESSION_SECRET += '-rotated'
    expect((await connect(cookie)).status).toBe(401)
  })
  it('clears the browser cookie on logout without exposing business APIs', async () => {
    const result = await worker.fetch(request('logout', 'POST'), env)
    expect(result.headers.get('Set-Cookie')).toContain('Max-Age=0')
    expect((await worker.fetch(request('records'), env)).status).toBe(404)
  })
  it('enforces platform login limits before password evaluation', async () => {
    vi.mocked(env.LOGIN_LIMIT.limit).mockResolvedValueOnce({ success: false })
    expect((await worker.fetch(request('login', 'POST', { 'Content-Type': 'application/json' }, '{}'), env)).status).toBe(429)
  })
  it.each(['CONNECT_LIMIT', 'TOTAL_LIMIT'] as const)('enforces %s before upstream handshake', async key => {
    const cookie = await login(); vi.mocked(env[key].limit).mockResolvedValueOnce({ success: false })
    expect((await connect(cookie)).status).toBe(429); expect(upstreamFetch).not.toHaveBeenCalled()
  })
  it('rejects URL parameters and non-upgrade connections', async () => {
    const cookie = await login()
    expect((await worker.fetch(request('iat?key=bad', 'GET', { Cookie: cookie, Upgrade: 'websocket' }), env)).status).toBe(400)
    expect((await worker.fetch(request('iat', 'GET', { Cookie: cookie }), env)).status).toBe(400)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
  it('signs the exact IAT host/date/request-line only on the server', async () => {
    const url = await upstreamUrl(env)
    expect(url.origin + url.pathname).toBe('https://iat-api.xfyun.cn/v2/iat')
    const date = url.searchParams.get('date')!
    const signature = createHmac('sha256', env.IAT_API_SECRET)
      .update(`host: iat-api.xfyun.cn\ndate: ${date}\nGET /v2/iat HTTP/1.1`).digest('base64')
    expect(atob(url.searchParams.get('authorization')!)).toContain(`signature="${signature}"`)
    expect(atob(url.searchParams.get('authorization')!)).toContain(`api_key="${env.IAT_API_KEY}"`)
  })
  it('upgrades the browser only after an authenticated upstream connection', async () => {
    const result = await connect(await login())
    expect(result.status).toBe(101)
    expect(pair[1].accept).toHaveBeenCalledTimes(1); expect(upstream.accept).toHaveBeenCalledTimes(1)
    expect(await result.text()).toBe('')
    expect(result.headers.get('Location')).toBeNull()
    expect(result.headers.get('Set-Cookie')).toBeNull()
    expect(JSON.stringify(pair[1].send.mock.calls)).not.toMatch(/test-key-only|test-secret-only/)
  })
  it('does not expose upstream HTTP errors or exception messages', async () => {
    upstreamFetch.mockResolvedValueOnce(new WorkerResponse(env.IAT_API_SECRET, { status: 401 }))
    const result = await connect(await login())
    expect(result.status).toBe(502); expect(await result.text()).toBe('')
    upstreamFetch.mockRejectedValueOnce(new Error(env.IAT_API_SECRET))
    const failed = await connect(await login()); expect(failed.status).toBe(503); expect(await failed.text()).toBe('')
  })
  it('does not abort an established recording when the handshake deadline passes', async () => {
    // Native AbortSignal.timeout uses a real timer even under fake timers. Model its
    // abort explicitly so the previous implementation fails this regression test.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), ms)
      return controller.signal
    })
    let handshakeSignal: AbortSignal | undefined
    upstreamFetch.mockImplementationOnce(async (_url: URL, init: RequestInit) => {
      handshakeSignal = init.signal ?? undefined
      return new WorkerResponse(null, { status: 101, webSocket: upstream })
    })
    expect((await connect(await login())).status).toBe(101)
    expect(handshakeSignal).toBeDefined()
    const audio = (status: number) => JSON.stringify({ data: {
      status, format: 'audio/L16;rate=16000', encoding: 'raw', audio: btoa('\0'.repeat(1280)),
    } })
    pair[1].message(audio(0))
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(1000)
      pair[1].message(audio(1))
    }
    expect(handshakeSignal?.aborted).toBe(false)
    expect(upstream.close).not.toHaveBeenCalled()
    pair[1].dispatchEvent(new Event('close'))
    expect(vi.getTimerCount()).toBe(0)
  })
  it('still aborts a stalled handshake after ten seconds', async () => {
    let handshakeSignal: AbortSignal | undefined
    upstreamFetch.mockImplementationOnce((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
      handshakeSignal = init.signal ?? undefined
      handshakeSignal?.addEventListener('abort', () => reject(new Error('test timeout')), { once: true })
    }))
    const pending = connect(await login())
    await vi.waitFor(() => expect(handshakeSignal).toBeDefined())
    vi.advanceTimersByTime(10_000)
    expect((await pending).status).toBe(503)
    expect(handshakeSignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('closes a partially upgraded upstream if the browser pair cannot be accepted', async () => {
    pair[1].accept.mockImplementationOnce(() => { throw new Error('upgrade failed') })
    const result = await connect(await login())
    expect(result.status).toBe(503); expect(upstream.close).toHaveBeenCalledTimes(1)
    expect(pair[1].close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
})

describe('proxy audio protocol and resource lifetime', () => {
  const first = () => JSON.stringify({ data: { status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: btoa('\0'.repeat(1280)) } })
  const message = (text: string, status = 1) => JSON.stringify({ code: 0, message: 'diagnostic', sid: 'vendor-session', data: { status, result: { sn: 0, ws: [{ cw: [{ w: text }] }] } } })
  it('injects only the approved product configuration and omits dynamic correction', () => {
    const payload = JSON.parse(clientFrame(first(), true, env.IAT_APP_ID).json)
    expect(payload.common).toEqual({ app_id: env.IAT_APP_ID })
    expect(payload.business).toEqual({ language: 'zh_cn', domain: 'iat', accent: 'mandarin', ptt: 1, pcm: 0, eos: 2000 })
    expect(payload.business.dwa).toBeUndefined()
  })
  it.each([
    '{"common":{"app_id":"attacker"},"data":{"status":2}}',
    '{"data":{"status":0,"format":"audio/L16;rate=8000","encoding":"raw","audio":"AAA="}}',
    '{"data":{"status":0,"format":"audio/L16;rate=16000","encoding":"raw","audio":"AA=="}}',
    '{"data":{"status":2}}',
  ])('rejects unsafe first-frame payload %s', value => { expect(() => clientFrame(value, true, 'app')).toThrow() })
  it('forwards frames and strips upstream diagnostics, then closes only after final results', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID)
    pair[1].message(first())
    expect(upstream.send).toHaveBeenCalledTimes(1)
    pair[1].message('{"data":{"status":2}}')
    expect(upstream.close).not.toHaveBeenCalled()
    upstream.message(message('尾字。', 2))
    expect(JSON.parse(pair[1].send.mock.calls[0]![0])).toEqual({ code: 0, data: expect.objectContaining({ status: 2 }) })
    expect(pair[1].send.mock.calls[0]![0]).not.toMatch(/diagnostic|vendor-session/)
    expect(upstream.close).toHaveBeenCalledTimes(1); expect(pair[1].close).toHaveBeenCalledExactlyOnceWith(1000)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('redacts vendor failures and deduplicates error/close events', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID)
    upstream.message(JSON.stringify({ code: 10005, message: env.IAT_API_SECRET }))
    upstream.dispatchEvent(new Event('close')); upstream.dispatchEvent(new Event('error'))
    expect(pair[1].send).toHaveBeenCalledTimes(1)
    expect(pair[1].send.mock.calls[0]![0]).not.toContain(env.IAT_API_SECRET)
    expect(pair[1].close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('never forwards unknown nested metadata from an otherwise valid service response', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID)
    upstream.message(JSON.stringify({ code: 0, data: {
      status: 1, diagnostics: env.IAT_API_SECRET,
      result: { sn: 0, debug: env.IAT_API_KEY, ws: [{ cw: [{ w: '正文' }] }] },
    } }))
    const forwarded = pair[1].send.mock.calls[0]![0]
    expect(forwarded).not.toContain(env.IAT_API_KEY); expect(forwarded).not.toContain(env.IAT_API_SECRET)
    expect(JSON.parse(forwarded).data.result.ws[0].cw[0].w).toBe('正文')
  })
  it('closes the upstream when the browser disconnects', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID); pair[1].dispatchEvent(new Event('close'))
    expect(upstream.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects accelerated uploads and oversized frames', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID)
    pair[1].message(first())
    const middle = first().replace('"status":0', '"status":1')
    for (let i = 0; i < 7; i++) pair[1].message(middle)
    expect(pair[1].close).toHaveBeenCalledWith(1011)
    expect(() => clientFrame(first().replace(btoa('\0'.repeat(1280)), btoa('\0'.repeat(1282))), true, 'app')).toThrow()
  })
  it('rejects post-end audio frames', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID)
    pair[1].message(first()); pair[1].message('{"data":{"status":2}}'); pair[1].message(first())
    expect(pair[1].close).toHaveBeenCalledWith(1011)
  })
  it('closes silent/abandoned sockets after ten seconds', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID); vi.advanceTimersByTime(10_000)
    expect(upstream.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('caps physical session lifetime before the vendor 60s boundary', () => {
    bridge(pair[1], upstream, env.IAT_APP_ID)
    pair[1].message(first())
    const middle = first().replace('"status":0', '"status":1')
    for (let i = 0; i < 57; i++) { vi.advanceTimersByTime(1000); pair[1].message(middle) }
    expect(pair[1].close).not.toHaveBeenCalled(); vi.advanceTimersByTime(1000)
    expect(pair[1].close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
})
