import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { devTunnel } from './infrastructure/m1-speech-proxy/dev-tunnel.ts'
import { localDevRequest } from './infrastructure/m1-speech-proxy/dev-origin.ts'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const plugins = [vue(), vueDevTools()]
  plugins.push({
    name: 'm1-opt-in-development-diagnostics',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'script', attrs: { type: 'module', src: '/tests/manual/m1-debug-panel.ts' }, injectTo: 'head' }],
    },
  })
  let proxy: Record<string, ProxyOptions> | undefined
  let https: { key: Buffer; cert: Buffer } | undefined
  // Public HTTPS origin is pending deployment; do not substitute a private SSH tunnel or example domain.
  if (env.M1_DEV_PROXY_TARGET) {
    const target = new URL(env.M1_DEV_PROXY_TARGET)
    const tunnel = target.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(target.hostname)
    if ((!tunnel && target.protocol !== 'https:') || target.origin !== env.M1_DEV_PROXY_TARGET) throw new Error('Proxy target must be HTTPS or a numeric loopback HTTP SSH tunnel.')
    const origin = new URL(env.M1_DEV_PROXY_ORIGIN ?? (tunnel ? 'https://localhost:5173' : target.origin))
    if (origin.protocol !== 'https:' || origin.origin !== (env.M1_DEV_PROXY_ORIGIN ?? origin.origin)) throw new Error('M1_DEV_PROXY_ORIGIN must be an HTTPS origin.')
    if (env.M1_DEV_TLS_KEY || env.M1_DEV_TLS_CERT) {
      if (!env.M1_DEV_TLS_KEY || !env.M1_DEV_TLS_CERT) throw new Error('Provide both localhost TLS certificate paths.')
      https = { key: readFileSync(env.M1_DEV_TLS_KEY), cert: readFileSync(env.M1_DEV_TLS_CERT) }
    }
    const localRequest = (req: Parameters<typeof localDevRequest>[0] & { url?: string }) => req.url === '/api/m1/iat' && localDevRequest(req, https ? 'https:' : 'http:')
    if (env.M1_DEV_SSH_HOST) {
      if (!tunnel || target.hostname !== '127.0.0.1' || !target.port || !env.M1_DEV_SSH_IDENTITY || !env.M1_DEV_SSH_KNOWN_HOSTS) throw new Error('SSH development requires a numeric IPv4 loopback target, port, identity and pinned known-hosts file.')
      plugins.push(devTunnel({ host: env.M1_DEV_SSH_HOST, identity: env.M1_DEV_SSH_IDENTITY, knownHosts: env.M1_DEV_SSH_KNOWN_HOSTS, port: Number(target.port) }))
    }
    proxy = { '/api/m1': {
      target: target.origin, ws: true, changeOrigin: true, secure: true,
      bypass(req, res) {
        if (localRequest(req)) return
        res?.writeHead(403); res?.end(); return false
      },
      configure(server) {
        const diagnosticEvents: Record<string, unknown>[] = []
        const record = (event: Record<string, unknown>) => {
          if (env.M1_DEV_DIAGNOSTICS !== 'true') return
          diagnosticEvents.push({ at: new Date().toISOString(), ...event })
          if (diagnosticEvents.length > 20) diagnosticEvents.shift()
          try { writeFileSync('.certs/proxy-status.json', JSON.stringify(diagnosticEvents, null, 2), { mode: 0o600 }) }
          catch { console.warn('[m1] Unable to write local diagnostic status.') }
        }
        const headers = (outgoing: { setHeader(name: string, value: string): void }) => {
          outgoing.setHeader('Origin', origin.origin)
          outgoing.setHeader('Host', origin.host)
          if (tunnel) outgoing.setHeader('X-Real-IP', '127.0.0.1')
          outgoing.setHeader('X-Forwarded-Proto', 'https')
        }
        server.on('proxyReqWs', (outgoing, req, socket) => {
          if (!localRequest(req)) { outgoing.destroy(); socket.destroy(); return }
          headers(outgoing)
          record({ phase: 'websocket-request' })
          outgoing.once('response', res => record({ phase: 'websocket-rejected', status: res.statusCode }))
          outgoing.once('upgrade', res => record({ phase: 'websocket-upgraded', status: res.statusCode }))
        })
      },
    } }
  }
  return {
    plugins,
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { host: 'localhost', port: 5173, strictPort: true, https, proxy },
  }
})
