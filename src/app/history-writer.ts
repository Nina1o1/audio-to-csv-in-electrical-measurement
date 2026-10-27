/** Hold one origin-wide writer lease without changing M4's synchronous contract. */
export function acquireHistoryWriter(acquired: () => void, unavailable: (reason: string) => void): () => void {
  // Non-browser module hosts have no competing browser pages.
  if (typeof window === 'undefined') { acquired(); return () => undefined }
  const page = window
  let active = true
  let release: (() => void) | undefined
  const stop = () => {
    if (!active) return
    active = false
    release?.()
    page.removeEventListener('pagehide', pagehide)
  }
  const pagehide = () => {
    stop()
    unavailable('页面已离开，历史写入已暂停；返回后请重试加载历史。')
  }
  page.addEventListener('pagehide', pagehide)
  try {
    const locks = navigator.locks
    if (!locks) {
      unavailable('浏览器无法安全协调历史写入，保存已禁用；请使用支持 Web Locks 的 HTTPS 浏览器。')
    } else {
      void locks.request('inspection-records-writer', {
        mode: 'exclusive', ifAvailable: true,
      }, async lock => {
        if (!active) return
        if (!lock) {
          unavailable('另一个页面正在管理历史，当前页面禁止保存、修改和删除；关闭该页面后请重试加载历史。')
          return
        }
        await new Promise<void>(resolve => { release = resolve; acquired() })
      }).catch(() => {
        if (active) unavailable('无法取得历史写入权限，保存已禁用；请重试加载历史。')
      })
    }
  } catch {
    unavailable('无法取得历史写入权限，保存已禁用；请重试加载历史。')
  }
  return stop
}
