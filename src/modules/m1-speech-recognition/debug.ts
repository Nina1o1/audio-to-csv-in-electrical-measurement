/** Development-only metadata. Opt in with ?m1Debug=1; never retain audio/text/URLs. */
export type Diagnostic = (event: string, fields?: Record<string, number | string | boolean | undefined>) => void
let sequence = 0
export function m1Diagnostic(scope: 'recording' | 'listening' = 'recording'): Diagnostic {
  const enabled = (import.meta.env.DEV || import.meta.env.MODE === 'm1-debug')
    && new URLSearchParams(globalThis.location?.search ?? '').get('m1Debug') === '1'
  if (!enabled) return () => undefined
  const diagnosticId = ++sequence
  const started = performance.now()
  return (event, fields = {}) => {
    try { console.debug('[M1]', { ...(scope === 'recording' ? { recordingId: diagnosticId } : { listeningId: diagnosticId }), event, atMs: performance.now(), elapsedMs: performance.now() - started, ...fields }) }
    catch { /* Diagnostics cannot affect recognition. */ }
  }
}
