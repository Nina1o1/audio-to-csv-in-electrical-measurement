import { spawn, type ChildProcess } from 'node:child_process'
import type { Plugin } from 'vite'

/** Optional SSH transport for domain-free development; owned by the Vite server lifecycle. */
export function devTunnel(options: { host: string; identity: string; knownHosts: string; port: number }): Plugin {
  if (!/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$/.test(options.host)) throw new Error('Invalid development SSH host.')
  return {
    name: 'm1-development-ssh-tunnel',
    configureServer(server) {
      let child: ChildProcess | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let stopped = false
      let delay = 1000
      const retry = () => {
        if (stopped || timer) return
        server.config.logger.warn('[m1] SSH tunnel disconnected; reconnecting. Check SSH access if this repeats.')
        timer = setTimeout(() => { timer = undefined; start() }, delay)
        delay = Math.min(delay * 2, 30_000)
      }
      const start = () => {
        if (stopped) return
        const started = Date.now()
        child = spawn('ssh', [
          '-F', '/dev/null', '-NT', '-i', options.identity,
          '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
          '-o', `UserKnownHostsFile=${options.knownHosts}`, '-o', 'ExitOnForwardFailure=yes',
          '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
          '-L', `127.0.0.1:${options.port}:127.0.0.1:8787`, options.host,
        ], { stdio: 'ignore' })
        child.once('error', retry)
        child.once('exit', () => { if (Date.now() - started > 60_000) delay = 1000; retry() })
      }
      const stop = () => {
        stopped = true; clearTimeout(timer); child?.kill('SIGTERM')
        process.removeListener('exit', stop)
      }
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
      start()
    },
  }
}
