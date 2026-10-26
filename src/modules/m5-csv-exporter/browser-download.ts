/** Browser-only resource adapter; contains no CSV validation or business data access. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  let link: HTMLAnchorElement | undefined

  function cleanup(): void {
    // Attempt each release independently; cleanup/reporting cannot change an
    // already initiated download into a reported business failure.
    for (const release of [() => link?.remove(), () => URL.revokeObjectURL(url)]) {
      try { release() } catch (error: unknown) {
        try { console.error('M5 download cleanup failed:', error) } catch { /* Reporting is best effort. */ }
      }
    }
  }

  try {
    link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } catch (error: unknown) {
    cleanup()
    throw error
  }
  // Keep the URL alive through click dispatch; each download owns its cleanup.
  try { setTimeout(cleanup, 0) } catch { cleanup() }
}
