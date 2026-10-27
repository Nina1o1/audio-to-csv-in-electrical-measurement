import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const local = process.argv.includes('--local')
if (local && !existsSync(join(root, 'infrastructure/m1-speech-proxy/.dev.vars'))) {
  throw new Error('Fill infrastructure/m1-speech-proxy/.dev.vars before starting the local proxy.')
}

// Build a separate acceptance page; never rewrite the production App or its dist directory.
const outDir = await mkdtemp(join(tmpdir(), 'm1-acceptance-'))
await build({
  root, configFile: false,
  build: {
    outDir, emptyOutDir: false,
    rolldownOptions: { input: fileURLToPath(new URL('./m1-acceptance.html', import.meta.url)) },
  },
})
console.log(`M1 acceptance output: ${outDir}`)
console.log('Serve its files under the same HTTPS origin as /api/m1/*, then open /tests/manual/m1-acceptance.html.')

if (local) {
  // Run the existing proxy locally; never deploy, tunnel, or expose it on the LAN.
  console.log('Local M1 test: https://localhost:8787/tests/manual/m1-acceptance.html')
  const child = spawn('npm', [
    'exec', '--yes', '--package=wrangler@4.153.0', '--', 'wrangler', 'dev', '--local',
    '--config', 'infrastructure/m1-speech-proxy/wrangler.jsonc',
    '--assets', outDir, '--var', 'APP_ORIGIN:https://localhost:8787',
    '--local-protocol', 'https', '--ip', '127.0.0.1', '--port', '8787',
    '--log-level', 'warn', '--show-interactive-dev-session', 'false',
  ], { cwd: root, stdio: 'inherit', env: { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' } })
  child.on('error', () => { console.error('Could not start the local proxy. Check Node.js and npm.'); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
