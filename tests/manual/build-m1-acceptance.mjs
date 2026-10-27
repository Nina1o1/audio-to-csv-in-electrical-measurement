import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('../../', import.meta.url))
const { values } = parseArgs({ options: {
  local: { type: 'boolean', default: false },
  app: { type: 'boolean', default: false },
  debug: { type: 'boolean', default: false },
  port: { type: 'string' },
} })
const { local, app } = values
const port = values.port ?? (app ? '5173' : '8787')
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) {
  throw new Error('--port must be an integer between 1024 and 65535.')
}
if (local && !existsSync(join(root, 'infrastructure/m1-speech-proxy/.dev.vars'))) {
  throw new Error('Fill infrastructure/m1-speech-proxy/.dev.vars before starting the local proxy.')
}

// Both entry points reuse the existing same-origin HTTPS Worker, without modifying dist.
const outDir = await mkdtemp(join(tmpdir(), app ? 'm1-app-' : 'm1-acceptance-'))
await build({
  root, ...(app ? {} : { configFile: false }),
  ...(values.debug ? { mode: 'm1-debug' } : {}),
  ...(values.debug && app ? { plugins: [{
    name: 'm1-local-debug-panel',
    transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', attrs: { type: 'module', src: '/tests/manual/m1-debug-panel.ts' }, injectTo: 'body' }] },
  }] } : {}),
  build: {
    outDir, emptyOutDir: false,
    ...(app ? {} : { rolldownOptions: { input: fileURLToPath(new URL('./m1-acceptance.html', import.meta.url)) } }),
  },
})
console.log(`M1 ${app ? 'App' : 'acceptance'} output: ${outDir}`)
const page = app ? '/' : '/tests/manual/m1-acceptance.html'
console.log(`Serve its files under the same HTTPS origin as /api/m1/*, then open ${page}.`)

if (local) {
  // Run the existing proxy locally; never deploy, tunnel, or expose it on the LAN.
  console.log(`Local M1 ${app ? 'App' : 'test'}: https://localhost:${port}${page}`)
  console.log('If this port is already occupied, stop that proxy first or pass --port with another port.')
  const child = spawn('npm', [
    'exec', '--yes', '--package=wrangler@4.153.0', '--', 'wrangler', 'dev', '--local',
    '--config', 'infrastructure/m1-speech-proxy/wrangler.jsonc',
    '--assets', outDir, '--var', `APP_ORIGIN:https://localhost:${port}`,
    '--local-protocol', 'https', '--ip', '127.0.0.1', '--port', port,
    '--log-level', 'warn', '--show-interactive-dev-session', 'false',
  ], { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' } })
  child.on('error', () => { console.error('Could not start the local proxy. Check Node.js and npm.'); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
