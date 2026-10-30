import type { IncomingMessage } from 'node:http'

/** Vite HTTPS may receive HTTP/2 (:authority) while WebSocket uses HTTP/1.1 (Host). */
export function localDevRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const host = req.headers.host
  const authority = req.headers[':authority']
  if (host && authority && host !== authority) return false
  const address = host ?? authority
  return typeof address === 'string' && /^localhost:\d+$/.test(address)
    && req.headers.origin === `https://${address}`
}
