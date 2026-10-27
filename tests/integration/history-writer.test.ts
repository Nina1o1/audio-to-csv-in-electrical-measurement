import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useManualWorkflow } from '../../src/app/useManualWorkflow'
import type { InspectionRecord } from '../../src/shared/data-models'

const cleanup: (() => void)[] = []
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const original: InspectionRecord = {
  id: 'original', workOrder: 'ORIGINAL', partNumber: 'P-001', contactResistance: 0,
  insulationResistance: 200, withstandVoltage: 1500, result: 'PASS',
  createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
}

function fixture(seed: InspectionRecord[] = []) {
  let raw = JSON.stringify(seed)
  const storage = { getItem: vi.fn(() => raw), setItem: vi.fn((_key: string, value: string) => { raw = value }) }
  vi.stubGlobal('localStorage', storage)
  let held = false
  const request = vi.fn(async (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown) => {
    // ifAvailable and signal cannot be combined in the native API.
    expect(options).toEqual({ mode: 'exclusive', ifAvailable: true })
    expect(name).toBe('inspection-records-writer')
    await Promise.resolve()
    if (held) return callback(null)
    held = true
    try { return await callback({ name, mode: 'exclusive' }) }
    finally { held = false }
  })
  vi.stubGlobal('navigator', { locks: { request } })
  function page() {
    const events = new EventTarget()
    vi.stubGlobal('window', events)
    const ui = reactive(useManualWorkflow())
    cleanup.push(ui.dispose)
    ui.initialize()
    return { ui, events }
  }
  return { page, storage, request, read: () => JSON.parse(raw) as InspectionRecord[] }
}

function save(ui: ReturnType<ReturnType<typeof fixture>['page']>['ui']) {
  ui.updateField('workOrder', 'NEW')
  ui.updateField('partNumber', 'P-002')
  ui.updateField('contactResistance', 1)
  ui.updateField('insulationResistance', 300)
  ui.updateField('withstandVoltage', 1200)
  ui.updateField('result', 'PASS')
  ui.requestSave(); ui.confirmSave()
}

afterEach(async () => {
  for (const dispose of cleanup.splice(0)) dispose()
  await flush()
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('origin-wide history writer protection', () => {
  it('blocks the second page before reading; retry after release loads the first save and preserves both records', async () => {
    const f = fixture()
    const a = f.page(), b = f.page()
    await flush()
    expect(a.ui.canSave).toBe(true)
    expect(b.ui.historyStatus).toBe('error')
    expect(b.ui.historyError).toContain('另一个页面')
    expect(b.ui.editable).toBe(true)
    expect(f.storage.getItem).toHaveBeenCalledOnce()
    save(b.ui)
    expect(f.storage.setItem).not.toHaveBeenCalled()
    save(a.ui)
    a.ui.dispose(); await flush()
    b.ui.initialize(); await flush()
    expect(b.ui.rows).toHaveLength(1)
    save(b.ui)
    expect(f.read()).toHaveLength(2)
    expect(new Set(f.read().map(record => record.id)).size).toBe(2)
  })

  it.each(['edit', 'delete'] as const)('does not undo another page’s %s after taking over', async action => {
    const f = fixture([original])
    const a = f.page(), b = f.page()
    await flush()
    if (action === 'delete') { a.ui.openHistoryDelete(original.id); a.ui.confirmHistoryDelete() }
    else { a.ui.openHistoryEdit(original.id); a.ui.updateHistoryField('workOrder', 'EDITED'); a.ui.confirmHistoryEdit() }
    a.ui.dispose(); await flush()
    b.ui.initialize(); await flush()
    save(b.ui)
    const persisted = f.read().find(record => record.id === original.id)
    if (action === 'delete') expect(persisted).toBeUndefined()
    else expect(persisted?.workOrder).toBe('EDITED')
  })

  it('freezes writes on pagehide and reloads fresh M4 memory after reacquiring, preserving the draft', async () => {
    const f = fixture([original])
    const a = f.page(); await flush()
    a.ui.updateField('partNumber', 'UNSAVED')
    a.events.dispatchEvent(new Event('pagehide')); await flush()
    expect(a.ui.canSave).toBe(false)
    expect(a.ui.historyStatus).toBe('error')
    const b = f.page(); await flush()
    b.ui.openHistoryDelete(original.id); b.ui.confirmHistoryDelete()
    b.ui.dispose(); await flush()
    a.ui.initialize(); await flush()
    expect(a.ui.rows).toEqual([])
    expect(a.ui.draft.partNumber).toBe('UNSAVED')
    save(a.ui)
    expect(f.read()).toHaveLength(1)
    expect(f.read()[0]?.id).not.toBe(original.id)
  })

  it('fails closed without Web Locks, while allowing manual draft edits', async () => {
    const f = fixture([original])
    vi.stubGlobal('navigator', {})
    const { ui } = f.page(); await flush()
    expect(ui.historyError).toContain('Web Locks')
    save(ui)
    expect(ui.draft.workOrder).toBe('NEW')
    expect(ui.canSave).toBe(false)
    expect(f.storage.getItem).not.toHaveBeenCalled()
    expect(f.read()).toEqual([original])
  })

  it('ignores a late grant after disposal and releases it for the next page', async () => {
    const f = fixture()
    const a = f.page()
    a.ui.initialize() // Duplicate initialization cannot request another lease.
    a.ui.dispose(); await flush()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.storage.getItem).not.toHaveBeenCalled()
    const b = f.page(); await flush()
    expect(b.ui.canSave).toBe(true)
  })

  it('keeps writes disabled when the browser rejects the lock request', async () => {
    const f = fixture([original])
    vi.stubGlobal('navigator', { locks: { request: vi.fn().mockRejectedValue(new Error('denied')) } })
    const { ui } = f.page(); await flush()
    expect(ui.historyError).toContain('无法取得')
    save(ui)
    expect(f.storage.getItem).not.toHaveBeenCalled()
    expect(f.storage.setItem).not.toHaveBeenCalled()
  })

  it('rejects a pending confirmation after pagehide and allows cancellation without losing the draft', async () => {
    const f = fixture()
    const { ui, events } = f.page(); await flush()
    ui.updateField('workOrder', 'DRAFT')
    ui.updateField('partNumber', 'P')
    ui.updateField('contactResistance', 0)
    ui.updateField('insulationResistance', 1)
    ui.updateField('withstandVoltage', 1)
    ui.updateField('result', 'PASS')
    ui.requestSave()
    events.dispatchEvent(new Event('pagehide')); await flush()
    ui.confirmSave()
    expect(f.storage.setItem).not.toHaveBeenCalled()
    expect(ui.draftState).toBe('CONFIRMING_SAVE')
    ui.cancelConfirmation(); ui.initialize(); await flush()
    expect(ui.canSave).toBe(true)
    expect(ui.draft.workOrder).toBe('DRAFT')
  })
})
