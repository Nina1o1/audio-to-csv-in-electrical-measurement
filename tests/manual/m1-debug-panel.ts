/** Local debug-build observer only. No App calls, microphone acquisition or transcript storage. */
if ((import.meta.env.DEV || import.meta.env.MODE === 'm1-debug') && new URLSearchParams(location.search).get('m1Debug') === '1') {
  const entries: Record<string, unknown>[] = []
  const panel = document.createElement('aside')
  panel.setAttribute('aria-label', 'M1 开发诊断')
  panel.style.cssText = 'padding:8px 16px;background:#fff4cf;color:#222;font-family:system-ui;font-size:var(--font-size-md);position:relative;z-index:1'
  const label = document.createElement('strong')
  label.textContent = 'M1 开发诊断 · 仅记录事件元数据'
  const status = document.createElement('span')
  status.textContent = ' · 等待点击开始监听'
  status.setAttribute('role', 'status')
  const copy = document.createElement('button')
  copy.textContent = '复制 M1 诊断日志'
  copy.style.cssText = 'margin:0 12px;padding:4px 8px;font:inherit'
  copy.onclick = () => {
    void navigator.clipboard.writeText(JSON.stringify({ userAgent: navigator.userAgent, origin: location.origin, entries }, null, 2))
      .then(() => { status.textContent = ' · 日志已复制' })
      .catch(() => { status.textContent = ' · 复制失败，请展开日志手动复制' })
  }
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = '查看诊断日志'
  const output = document.createElement('pre')
  output.style.cssText = 'max-height:220px;overflow:auto;white-space:pre-wrap;font-size:var(--font-size-sm)'
  details.append(summary, output)
  panel.append(label, status, copy, details)
  document.body.prepend(panel)
  const original = console.debug
  console.debug = (...args: unknown[]) => {
    try { original.apply(console, args) } catch { /* Console failures must not affect the observer. */ }
    if (args[0] !== '[M1]' || typeof args[1] !== 'object' || args[1] === null) return
    const entry = args[1] as Record<string, unknown>
    entries.push({ ...entry })
    if (entries.length > 500) entries.shift()
    status.textContent = ` · 最近事件：${String(entry.event)}${entry.command ? ` / ${String(entry.command)}` : ''}`
    // Rendering is deferred until expanded; normal tracing does not stringify the log buffer.
    if (details.open) output.textContent = JSON.stringify(entries, null, 2)
  }
  details.ontoggle = () => { if (details.open) output.textContent = JSON.stringify(entries, null, 2) }
  window.addEventListener('pagehide', () => { console.debug = original }, { once: true })
}
