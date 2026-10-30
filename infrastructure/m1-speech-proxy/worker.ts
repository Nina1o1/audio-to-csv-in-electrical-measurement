import { bridge, upstreamUrl, validSession, sameSecret, issueSession, cookieName, lifetime, type EdgeSocket, type ProxyEnv } from './proxy-core'
export { bridge, clientFrame, upstreamUrl, type ProxyEnv } from './proxy-core'

declare const WebSocketPair: new () => { 0: EdgeSocket; 1: EdgeSocket }
interface UpgradeResponse extends Response { webSocket?: EdgeSocket }
interface UpgradeInit extends ResponseInit { webSocket: EdgeSocket }
function response(status: number): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })
}
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid frame.')
  return value as Record<string, unknown>
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
