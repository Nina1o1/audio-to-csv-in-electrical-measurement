import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useManualWorkflow } from '../../src/app/useManualWorkflow'
import { createDraftManager } from '../../src/modules/m3-draft-manager'
import { createRecordManager } from '../../src/modules/m4-record-manager'
import type { CsvExporterModule } from '../../src/contracts/m5-csv-exporter'
import type { InspectionFields, InspectionRecord } from '../../src/shared/data-models'

const fields: InspectionFields = {
  workOrder: 'aB-007 X', partNumber: 'P-007', contactResistance: 0,
  insulationResistance: 200, withstandVoltage: 1500, result: 'PASS',
}

function storageFixture(raw: string | null = null) {
  let contents = raw
  const storage = {
    getItem: vi.fn(() => contents),
    setItem: vi.fn((_key: string, value: string) => { contents = value }),
  }
  vi.stubGlobal('localStorage', storage)
  return { storage, read: () => contents }
}

function setup(csvExporter?: CsvExporterModule) {
  const draft = createDraftManager()
  const records = createRecordManager()
  const fresh = vi.fn(() => createRecordManager()).mockReturnValueOnce(records)
  const ui = reactive(useManualWorkflow({ draftManager: draft, createRecords: fresh, csvExporter }))
  ui.initialize()
  fresh.mockClear()
  return { ui, draft, records, fresh }
}

type Ui = ReturnType<typeof setup>['ui']
function fill(ui: Ui) {
  ui.updateField('workOrder', fields.workOrder)
  ui.updateField('partNumber', fields.partNumber)
  ui.updateField('contactResistance', fields.contactResistance)
  ui.updateField('insulationResistance', fields.insulationResistance)
  ui.updateField('withstandVoltage', fields.withstandVoltage)
  ui.updateField('result', fields.result)
}
function confirm(ui: Ui) { fill(ui); ui.requestSave(); ui.confirmSave() }

function csvFixture() {
  const exporter: CsvExporterModule = {
    generateCsv: vi.fn(),
    export: vi.fn((records, options) => ({ filename: options?.filename ?? 'inspection-records.csv', recordCount: records.length })),
  }
  return { exporter, download: vi.mocked(exporter.export) }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('App CSV export coordination', () => {
  function ready() {
    const storage = storageFixture()
    const csv = csvFixture()
    const context = setup(csv.exporter)
    confirm(context.ui)
    confirm(context.ui)
    const all = context.records.getAll()
    context.records.update(all[1]!.id, { workOrder: 'OTHER' })
    storage.storage.setItem.mockClear()
    return { ...context, ...csv, ...storage, all: context.records.getAll() }
  }

  it('names both export modes using the local time of each click, including zero padding and date rollover', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 28, 4, 5, 6))
    const { ui, all, download } = ready()
    ui.exportRecords(true)
    expect(download).toHaveBeenLastCalledWith(all, { filename: '工单信息2026-10-28_04-05-06.csv' })
    vi.setSystemTime(new Date(2026, 9, 29, 0, 0, 1))
    ui.select(all[0]!.id)
    ui.exportRecords(false)
    expect(download).toHaveBeenLastCalledWith([all[0]], { filename: '工单信息2026-10-29_00-00-01.csv' })
  })

  it('exports all latest records regardless of a partial or empty query, without writing storage or changing the draft', () => {
    const { ui, records, all, download, storage } = ready()
    ui.updateField('workOrder', 'UNSAVED')
    const draft = { ...ui.draft }
    ui.filters.workOrder = 'OTHER'; ui.query()
    expect(ui.rows).toHaveLength(1)
    ui.exportRecords(true)
    expect(download).toHaveBeenLastCalledWith(all, { filename: expect.stringMatching(/^工单信息\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/) })
    ui.filters.workOrder = 'missing'; ui.query()
    expect(ui.rows).toEqual([])
    expect(ui.canExport).toBe(true)
    ui.exportRecords(true)
    expect(download).toHaveBeenLastCalledWith(all, { filename: expect.stringMatching(/^工单信息\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/) })
    expect(ui.message).toBe('已发起下载，共 2 条记录。')
    expect(ui.filters.workOrder).toBe('missing')
    expect(ui.draft).toEqual(draft)
    expect(records.getAll()).toEqual(all)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('exports only selected latest M4 records, never the display snapshot', () => {
    const { ui, records, all, download } = ready()
    const id = all[0]!.id
    ui.select(id)
    records.update(id, { partNumber: 'LATEST' })
    ui.rows = ui.rows.map(record => ({ ...record, partNumber: 'STALE DISPLAY' }))
    ui.exportRecords(false)
    expect(download).toHaveBeenCalledExactlyOnceWith([records.getById(id)], { filename: expect.stringMatching(/^工单信息\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/) })
    expect(ui.selectedIds).toEqual([id])
    expect(ui.message).toBe('已发起下载，共 1 条记录。')
  })

  it('clears stale IDs, reports the actual count, and does not download an empty selection', () => {
    const { ui, all, download } = ready()
    ui.selectedIds = [all[0]!.id, 'deleted-id']
    ui.exportRecords(false)
    expect(download).toHaveBeenCalledExactlyOnceWith([all[0]], { filename: expect.stringMatching(/^工单信息\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/) })
    expect(ui.selectedIds).toEqual([all[0]!.id])
    expect(ui.message).toContain('共 1 条记录')
    expect(ui.message).toContain('已清理 1 条失效选择')
    download.mockClear()
    ui.selectedIds = ['deleted-id']
    ui.exportRecords(false)
    expect(ui.selectedIds).toEqual([])
    expect(ui.message).toContain('请选择有效记录')
    expect(ui.message).toContain('已清理 1 条失效选择')
    ui.exportRecords(false)
    expect(download).not.toHaveBeenCalled()
  })

  it('does not call M5 for an empty collection', () => {
    storageFixture()
    const { exporter, download } = csvFixture()
    const { ui } = setup(exporter)
    ui.exportRecords(true)
    expect(ui.message).toBe('暂无可导出的记录。')
    expect(download).not.toHaveBeenCalled()
  })

  it.each(['EMPTY_RECORDS', 'INVALID_RECORD', 'INVALID_FILENAME', 'CSV_GENERATION_FAILED', 'DOWNLOAD_FAILED'])
  ('reports %s separately from persistence failures, preserves data and permits retry', code => {
    const { ui, records, all, download, storage } = ready()
    ui.updateField('workOrder', 'UNSAVED')
    const draft = { ...ui.draft }
    ui.select(all[0]!.id)
    const ids = [...ui.selectedIds]
    const filters = { ...ui.filters }
    download.mockImplementationOnce(() => { throw Object.assign(new Error('technical detail'), { code }) })
    ui.exportRecords(false)
    expect(ui.message).toContain('CSV 导出失败')
    expect(ui.message).not.toContain('technical detail')
    expect(ui.message).not.toContain('保存失败')
    expect(ui.draft).toEqual(draft)
    expect(ui.selectedIds).toEqual(ids)
    expect(ui.filters).toEqual(filters)
    expect(ui.historyStatus).toBe('ready')
    expect(records.getAll()).toEqual(all)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(ui.busy).toBe(false)
    ui.exportRecords(false)
    expect(ui.message).toBe('已发起下载，共 1 条记录。')
  })

  it('keeps selection when snapshot retrieval fails and never calls M5', () => {
    const { ui, records, all, download } = ready()
    ui.select(all[0]!.id)
    vi.spyOn(records, 'getAll').mockImplementation(() => { throw new Error('snapshot unavailable') })
    ui.exportRecords(false)
    expect(ui.message).toContain('无法读取历史记录')
    expect(ui.selectedIds).toEqual([all[0]!.id])
    expect(ui.historyStatus).toBe('ready')
    expect(ui.busy).toBe(false)
    expect(download).not.toHaveBeenCalled()
  })

  it('guards direct calls during loading, errors, confirmations, saving, reconciliation and disposal', () => {
    storageFixture('broken')
    const { exporter, download } = csvFixture()
    const ui = reactive(useManualWorkflow({ csvExporter: exporter }))
    expect(ui.canExport).toBe(false)
    ui.exportRecords(true)
    ui.initialize()
    expect(ui.historyStatus).toBe('error')
    ui.exportRecords(true)
    const context = ready()
    const guard = () => {
      expect(context.ui.canExport).toBe(false)
      context.ui.exportRecords(true)
      expect(context.download).not.toHaveBeenCalled()
    }
    fill(context.ui); context.ui.requestSave(); guard()
    context.ui.cancelConfirmation(); context.ui.requestDelete(); guard()
    context.ui.cancelConfirmation(); context.ui.openHistoryEdit(context.all[0]!.id); guard()
    context.ui.cancelHistory(); context.ui.openHistoryDelete(context.all[0]!.id); guard()
    context.ui.cancelHistory()
    context.ui.busy = true; guard(); context.ui.busy = false
    vi.spyOn(context.records, 'save').mockImplementation(() => { guard(); throw new Error('unknown outcome') })
    context.ui.requestSave(); context.ui.confirmSave(); guard()
    expect(context.ui.awaitingCheck).toBe(true)
    context.ui.dispose(); guard()
    expect(download).not.toHaveBeenCalled()
  })

  it('blocks export after render failure until the page is recovered', () => {
    const { ui, download } = ready()
    ui.reportRenderError(new Error('render'), 'history')
    expect(ui.canExport).toBe(false)
    ui.exportRecords(true)
    expect(download).not.toHaveBeenCalled()
    ui.retryRender(); ui.exportRecords(true)
    expect(download).toHaveBeenCalledOnce()
  })

  it('prevents reentrant export calls during download initiation', () => {
    const { ui, download } = ready()
    download.mockImplementationOnce(records => {
      expect(ui.busy).toBe(true)
      expect(ui.canExport).toBe(false)
      ui.exportRecords(true)
      return { filename: 'inspection-records.csv', recordCount: records.length }
    })
    ui.exportRecords(true)
    expect(download).toHaveBeenCalledOnce()
    expect(ui.busy).toBe(false)
    expect(ui.message).toBe('已发起下载，共 2 条记录。')
  })
})

describe('Checkpoint A: real App coordination with M3 and M4', () => {
  it('recognizes explicit persistence errors by their contractual code without requiring a custom name', () => {
    storageFixture()
    const { ui, records, draft } = setup()
    vi.spyOn(records, 'save').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { code: 'STORAGE_WRITE_FAILED' })
    })
    const fail = vi.spyOn(draft, 'failSave')
    confirm(ui)
    expect(fail).toHaveBeenCalledOnce()
    expect(ui.draftState).toBe('IDLE')
    expect(ui.awaitingCheck).toBe(false)
    expect(ui.pending).not.toBeNull()
  })

  it.each(['absent', 'conflict'] as const)('refreshes the new M4 snapshot when reconciliation finds %s', outcome => {
    const { storage } = storageFixture()
    const { ui, records } = setup()
    let attempted: InspectionRecord | undefined
    vi.spyOn(records, 'save').mockImplementation(record => { attempted = record; throw new Error('unknown') })
    confirm(ui)
    const other: InspectionRecord = { ...attempted!, id: 'other', workOrder: 'OTHER' }
    const disk = outcome === 'absent' ? [other] : [other, { ...attempted!, partNumber: 'conflict' }]
    storage.getItem.mockReturnValue(JSON.stringify(disk))
    ui.checkSave()
    expect(ui.rows).toEqual(expect.arrayContaining(disk))
    expect(ui.rows).toHaveLength(disk.length)
    expect(ui.awaitingCheck).toBe(outcome === 'conflict')
  })
  it('loads without writing, permits manual input while loading, and reports all M3 validation errors', () => {
    const { storage } = storageFixture()
    const ui = reactive(useManualWorkflow())
    expect(ui.historyStatus).toBe('loading')
    expect(ui.canSave).toBe(false)
    ui.updateField('workOrder', 'WO')
    expect(ui.draft.workOrder).toBe('WO')
    ui.initialize()
    ui.requestSave()
    expect(ui.errors).toHaveLength(5)
    expect(ui.draftState).toBe('IDLE')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.getItem).toHaveBeenCalledWith('inspection-records')
  })

  it('persists only after confirmation, calls completeSave after M4 success, and queries again', () => {
    const { storage, read } = storageFixture()
    const { ui, draft, records } = setup()
    const complete = vi.spyOn(draft, 'completeSave')
    const query = vi.spyOn(records, 'query')
    const originalSave = records.save.bind(records)
    vi.spyOn(records, 'save').mockImplementation(record => {
      expect(draft.getState()).toBe('SAVING')
      expect(complete).not.toHaveBeenCalled()
      expect(record).toEqual({ ...fields, id: expect.any(String), createdAt: expect.any(String), updatedAt: expect.any(String) })
      return originalSave(record)
    })
    fill(ui)
    ui.requestSave()
    expect(ui.draftState).toBe('CONFIRMING_SAVE')
    expect(storage.setItem).not.toHaveBeenCalled()
    ui.confirmSave()
    expect(complete).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalled()
    expect(JSON.parse(read() ?? '[]')).toHaveLength(1)
    expect(ui.draftState).toBe('IDLE')
    expect(Object.values(ui.draft)).toEqual([null, null, null, null, null, null])
    expect(ui.pending).toBeNull()
    expect(ui.rows).toHaveLength(1)
    expect(ui.message).toContain('保存成功')
  })

  it('runs the full real save, isolates snapshots, and restores history with a new empty draft', () => {
    const { storage } = storageFixture()
    const { ui, records } = setup()
    confirm(ui)
    expect(ui.rows).toHaveLength(1)
    expect(ui.rows[0]).toMatchObject(fields)
    const saved = records.getAll()[0]!
    expect(saved.createdAt).toBe(saved.updatedAt)
    ui.rows[0]!.workOrder = 'tampered'
    expect(records.getById(saved.id)).toEqual(saved)
    ui.updateField('workOrder', 'unsaved')
    const reloaded = reactive(useManualWorkflow())
    reloaded.initialize()
    expect(reloaded.rows).toEqual([saved])
    expect(Object.values(reloaded.draft).every(value => value === null)).toBe(true)
    expect(reloaded.pending).toBeNull()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it('retains the entire pending on write failure and reuses it on unchanged retry', () => {
    const { storage } = storageFixture()
    const { ui, records, draft } = setup()
    const save = vi.spyOn(records, 'save')
    const complete = vi.spyOn(draft, 'completeSave')
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    confirm(ui)
    const pending = { ...ui.pending }
    expect(ui.draft).toEqual(fields)
    expect(ui.draftState).toBe('IDLE')
    expect(ui.rows).toEqual([])
    expect(complete).not.toHaveBeenCalled()
    ui.updateField('workOrder', fields.workOrder)
    ui.requestSave(); ui.cancelConfirmation()
    ui.requestSave(); ui.confirmSave()
    expect(save.mock.calls[1]?.[0]).toEqual(pending)
    expect(ui.rows).toEqual([pending])
  })

  it('uses M3 to invalidate failed pending only on actual edits', () => {
    const { storage } = storageFixture()
    const { ui, records } = setup()
    const save = vi.spyOn(records, 'save')
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    confirm(ui)
    const oldId = ui.pending?.id
    ui.updateField('partNumber', 'new')
    ui.requestSave(); ui.confirmSave()
    expect(save.mock.calls[1]?.[0].id).not.toBe(oldId)
    expect(ui.rows[0]?.partNumber).toBe('new')
  })

  it('requeries applied filters after saving and distinguishes excluded records from query failure', () => {
    storageFixture()
    const { ui, records } = setup()
    ui.filters.workOrder = 'excluded'; ui.query()
    ui.filters.workOrder = fields.workOrder // Unsubmitted text must not replace the active query.
    confirm(ui)
    expect(ui.rows).toEqual([])
    expect(records.getAll()).toHaveLength(1)
    expect(ui.message).toContain('保存成功，该记录不在当前筛选范围内')
    ui.filters.workOrder = ''; ui.query()
    expect(ui.rows).toHaveLength(1)
    vi.spyOn(records, 'query').mockImplementation(() => { throw new Error('display query') })
    confirm(ui)
    expect(records.getAll()).toHaveLength(2)
    expect(ui.draftState).toBe('IDLE')
    expect(ui.message).toContain('保存成功')
    expect(ui.displayError).toContain('查询')
    expect(ui.message).not.toContain('筛选范围')
    expect(ui.message).not.toContain('保存失败')
  })

  it('allows editing after failed initialization but gates both save entry points and preserves corrupt storage', () => {
    const { storage, read } = storageFixture('broken')
    const { ui, draft } = setup()
    const request = vi.spyOn(draft, 'requestSave')
    expect(ui.historyStatus).toBe('error')
    fill(ui); ui.requestSave(); ui.confirmSave()
    expect(ui.draft).toEqual(fields)
    expect(ui.canSave).toBe(false)
    expect(request).not.toHaveBeenCalled()
    expect(read()).toBe('broken')
    expect(storage.setItem).not.toHaveBeenCalled()
    storage.getItem.mockReturnValue(null)
    ui.initialize()
    expect(ui.historyStatus).toBe('ready')
    ui.requestSave(); ui.confirmSave()
    expect(ui.rows).toHaveLength(1)
  })

  it('freezes confirmation, rejects duplicate/reentrant submits, and preserves draft on cancel', () => {
    const { storage } = storageFixture()
    const { ui, records } = setup()
    fill(ui); ui.requestSave()
    ui.updateField('workOrder', 'illegal'); ui.requestDelete(); ui.requestSave()
    expect(ui.draft).toEqual(fields)
    ui.cancelConfirmation()
    expect(ui.draftState).toBe('IDLE')
    expect(ui.draft).toEqual(fields)
    records.onRecordsChange(() => {
      ui.confirmSave(); ui.updateField('workOrder', 'illegal'); ui.requestDelete()
    })
    ui.requestSave(); ui.confirmSave(); ui.confirmSave()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(ui.rows).toHaveLength(1)
    expect(ui.draftState).toBe('IDLE')
  })

  it('deletes only the draft through M3 and can cancel without affecting history', () => {
    const { storage } = storageFixture()
    const { ui } = setup()
    confirm(ui); fill(ui)
    ui.requestDelete(); ui.cancelConfirmation()
    expect(ui.draft).toEqual(fields)
    ui.requestDelete(); ui.confirmDelete()
    expect(Object.values(ui.draft).every(value => value === null)).toBe(true)
    expect(ui.rows).toHaveLength(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it.each(['same', 'absent', 'conflict', 'read-error'] as const)('freezes an unknown outcome and reconciles %s using a new M4', outcome => {
    const { storage } = storageFixture()
    const { ui, records, draft, fresh } = setup()
    const originalSave = records.save.bind(records)
    const fail = vi.spyOn(draft, 'failSave')
    const complete = vi.spyOn(draft, 'completeSave')
    vi.spyOn(records, 'save').mockImplementation(record => {
      if (outcome !== 'absent') originalSave(outcome === 'conflict' ? { ...record, partNumber: 'conflict' } : record)
      throw new Error('unexpected outcome')
    })
    confirm(ui)
    const pending = { ...ui.pending }
    expect(ui.draftState).toBe('SAVING')
    expect(ui.awaitingCheck).toBe(true)
    expect(fail).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    ui.updateField('partNumber', 'blocked'); ui.confirmSave(); ui.cancelConfirmation(); ui.initialize()
    expect(ui.draft).toEqual(fields)
    expect(ui.pending).toEqual(pending)
    if (outcome === 'read-error') storage.getItem.mockImplementation(() => { throw new Error('read') })
    ui.checkSave()
    expect(fresh).toHaveBeenCalledOnce()
    if (outcome === 'same') {
      expect(complete).toHaveBeenCalledOnce()
      expect(fail).not.toHaveBeenCalled()
      expect(ui.pending).toBeNull()
      expect(ui.draftState).toBe('IDLE')
    } else if (outcome === 'absent') {
      expect(fail).toHaveBeenCalledOnce()
      expect(complete).not.toHaveBeenCalled()
      expect(ui.pending).toEqual(pending)
      expect(ui.draftState).toBe('IDLE')
    } else {
      expect(ui.draftState).toBe('SAVING')
      expect(ui.awaitingCheck).toBe(true)
      expect(ui.pending).toEqual(pending)
      expect(fail).not.toHaveBeenCalled()
      expect(complete).not.toHaveBeenCalled()
    }
  })

  it('does not misclassify post-save completion or notification errors as write failures', () => {
    storageFixture()
    const { ui, records, draft } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    records.onRecordsChange(() => { throw new Error('UI subscriber') })
    const fail = vi.spyOn(draft, 'failSave')
    vi.spyOn(draft, 'completeSave').mockImplementationOnce(() => { throw new Error('completion') })
    confirm(ui)
    expect(records.getAll()).toHaveLength(1)
    expect(fail).not.toHaveBeenCalled()
    expect(ui.message).not.toContain('保存失败')
    expect(ui.awaitingCheck).toBe(true)
    ui.checkSave()
    expect(ui.draftState).toBe('IDLE')
    expect(ui.pending).toBeNull()
  })

  it('preserves the active query and rows after invalid time input and applies inclusive UTC boundaries', () => {
    storageFixture()
    const { ui, records } = setup()
    confirm(ui)
    const saved = records.getAll()[0]!
    const local = new Date(saved.createdAt)
    const pad = (value: number) => String(value).padStart(2, '0')
    const second = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`
    ui.filters.createdFrom = second; ui.filters.createdTo = second; ui.query()
    expect(ui.rows).toHaveLength(1)
    ui.filters.createdFrom = '2026-02-30T12:00:00'; ui.query()
    expect(ui.rows).toHaveLength(1)
    expect(ui.displayError).toContain('时间')
  })

  it('unsubscribes draft snapshots when the page is disposed', () => {
    storageFixture()
    const { ui, draft } = setup()
    ui.dispose()
    expect(ui.editable).toBe(false)
    expect(ui.canSave).toBe(false)
    ui.updateField('workOrder', 'after-unmount')
    expect(draft.getDraft().workOrder).toBeNull()
    draft.updateField('workOrder', 'external')
    expect(ui.draft.workOrder).toBeNull()
  })

  it.each([
    ['America/New_York', '2026-03-08T02:30:00'],
    ['America/New_York', '2026-11-01T01:30:00'],
    ['Australia/Lord_Howe', '2026-10-04T02:15:00'],
    ['Australia/Lord_Howe', '2026-04-05T01:45:00'],
  ])('rejects nonexistent or ambiguous local times in %s: %s', (zone, time) => {
    vi.stubEnv('TZ', zone)
    storageFixture()
    const { ui, records } = setup()
    const query = vi.spyOn(records, 'query')
    ui.filters.createdFrom = time
    ui.query()
    expect(query).not.toHaveBeenCalled()
    expect(ui.displayError).toContain('时间')
  })

  it('expands date-only bounds to the local day and lets M4 reject reversed ranges', () => {
    vi.stubEnv('TZ', 'America/New_York')
    storageFixture()
    const { ui, records } = setup()
    const query = vi.spyOn(records, 'query')
    ui.filters.createdFrom = '2026-03-08'; ui.filters.createdTo = '2026-03-08'; ui.query()
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({
      createdFrom: '2026-03-08T05:00:00.000Z', createdTo: '2026-03-09T03:59:59.999Z',
    }))
    ui.filters.createdFrom = '2026-03-10'; ui.query()
    expect(ui.displayError).toContain('查询失败')
  })
})

describe('Single-record history editing and deletion', () => {
  function saved() {
    const fixture = storageFixture()
    const context = setup()
    confirm(context.ui)
    const original = context.records.getAll()[0]!
    fixture.storage.setItem.mockClear()
    return { ...context, ...fixture, original }
  }

  it('edits an isolated copy, freezes draft actions, and cancels without writing', () => {
    const { ui, records, storage, original } = saved()
    fill(ui)
    ui.openHistoryEdit(original.id)
    expect(ui.historyAction).toBe('edit')
    ui.updateHistoryField('partNumber', 'changed')
    ui.updateField('workOrder', 'blocked'); ui.requestSave(); ui.requestDelete()
    expect(ui.draft).toEqual(fields)
    expect(records.getById(original.id)).toEqual(original)
    expect(ui.historyWritable).toBe(false)
    ui.cancelHistory()
    expect(ui.historyAction).toBeNull()
    expect(ui.editable).toBe(true)
    expect(storage.setItem).not.toHaveBeenCalled()
    ui.openHistoryEdit(original.id)
    expect(ui.historyFields?.partNumber).toBe(original.partNumber)
  })

  it('updates through M4 using only the six fields and preserves identity, creation time and current draft', () => {
    const { ui, records, storage, original } = saved()
    fill(ui)
    const update = vi.spyOn(records, 'update')
    ui.openHistoryEdit(original.id)
    ui.updateHistoryField('contactResistance', 0)
    ui.updateHistoryField('result', 'FAIL')
    ui.updateHistoryField('partNumber', 'P-NEW')
    ui.confirmHistoryEdit()
    expect(update).toHaveBeenCalledWith(original.id, { ...fields, partNumber: 'P-NEW', result: 'FAIL' })
    const updated = records.getById(original.id)!
    expect(updated.id).toBe(original.id)
    expect(updated.createdAt).toBe(original.createdAt)
    expect(updated.updatedAt >= original.updatedAt).toBe(true)
    expect(ui.rows).toEqual([updated])
    expect(ui.draft).toEqual(fields)
    expect(ui.historyAction).toBeNull()
    expect(storage.setItem).toHaveBeenCalledOnce()
    const reloaded = reactive(useManualWorkflow())
    reloaded.initialize()
    expect(reloaded.rows).toEqual([updated])
  })

  it('delegates incomplete and invalid form validation to M4 and retains the form and original data', () => {
    const { ui, records, storage, original } = saved()
    const update = vi.spyOn(records, 'update')
    ui.openHistoryEdit(original.id)
    ui.updateHistoryField('partNumber', null)
    ui.updateHistoryField('withstandVoltage', -1)
    ui.confirmHistoryEdit()
    expect(update).toHaveBeenCalledWith(original.id, expect.objectContaining({ partNumber: undefined, withstandVoltage: -1 }))
    expect(ui.historyFields?.partNumber).toBeNull()
    expect(ui.historyFields?.withstandVoltage).toBe(-1)
    expect(ui.historyAction).toBe('edit')
    expect(records.getById(original.id)).toEqual(original)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(ui.message).toContain('修改失败')
  })

  it.each(['edit', 'delete'] as const)('preserves history and confirmation on a failed %s write, then permits retry', action => {
    const { ui, records, storage, original } = saved()
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    if (action === 'edit') {
      ui.openHistoryEdit(original.id); ui.updateHistoryField('partNumber', 'changed'); ui.confirmHistoryEdit()
      expect(ui.historyFields?.partNumber).toBe('changed')
    } else { ui.openHistoryDelete(original.id); ui.confirmHistoryDelete() }
    expect(ui.historyAction).toBe(action)
    expect(records.getById(original.id)).toEqual(original)
    expect(ui.rows).toEqual([original])
    if (action === 'edit') ui.confirmHistoryEdit()
    else ui.confirmHistoryDelete()
    expect(ui.historyAction).toBeNull()
    expect(ui.rows).toHaveLength(action === 'edit' ? 1 : 0)
  })

  it('requeries applied filters after editing and reports an excluded record', () => {
    const { ui, records, original } = saved()
    ui.filters.workOrder = fields.workOrder; ui.query()
    ui.filters.workOrder = 'unsubmitted'
    ui.openHistoryEdit(original.id); ui.updateHistoryField('workOrder', 'OTHER'); ui.confirmHistoryEdit()
    expect(ui.rows).toEqual([])
    expect(records.getById(original.id)?.workOrder).toBe('OTHER')
    expect(ui.message).toContain('修改成功，该记录不在当前筛选范围内')
  })

  it('preserves a failed draft pending identity through an unrelated history edit', () => {
    const { ui, records, storage, original } = saved()
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    confirm(ui)
    const pending = { ...ui.pending }
    ui.openHistoryEdit(original.id); ui.updateHistoryField('partNumber', 'historical change'); ui.confirmHistoryEdit()
    expect(ui.draft).toEqual(fields)
    expect(ui.pending).toEqual(pending)
    ui.requestSave(); ui.confirmSave()
    expect(records.getById(pending.id!)).toEqual(pending)
    expect(records.getById(original.id)?.partNumber).toBe('historical change')
  })

  it('does not write on an unchanged edit or turn a post-commit query error into an update failure', () => {
    const { ui, records, storage, original } = saved()
    ui.openHistoryEdit(original.id); ui.confirmHistoryEdit()
    expect(storage.setItem).not.toHaveBeenCalled()
    ui.openHistoryEdit(original.id); ui.updateHistoryField('partNumber', 'changed')
    vi.spyOn(records, 'query').mockImplementation(() => { throw new Error('query failure') })
    ui.confirmHistoryEdit()
    expect(records.getById(original.id)?.partNumber).toBe('changed')
    expect(ui.message).toContain('修改成功')
    expect(ui.displayError).toContain('查询')
    expect(ui.historyAction).toBeNull()
  })

  it('requires deletion confirmation, preserves draft data, and rejects duplicate/reentrant actions', () => {
    const { ui, records, storage, original } = saved()
    fill(ui)
    ui.openHistoryDelete(original.id); ui.cancelHistory()
    expect(storage.setItem).not.toHaveBeenCalled()
    records.onRecordsChange(() => { ui.confirmHistoryDelete(); ui.openHistoryEdit(original.id); ui.requestSave() })
    ui.openHistoryDelete(original.id); ui.confirmHistoryDelete(); ui.confirmHistoryDelete()
    expect(storage.setItem).toHaveBeenCalledOnce()
    expect(ui.rows).toEqual([])
    expect(ui.draft).toEqual(fields)
    const reloaded = reactive(useManualWorkflow())
    reloaded.initialize()
    expect(reloaded.rows).toEqual([])
  })

  it('handles records missing before opening or confirming without recreating them', () => {
    const { ui, records, original } = saved()
    ui.openHistoryEdit('missing')
    expect(ui.historyAction).toBeNull()
    ui.openHistoryEdit(original.id)
    records.delete(original.id)
    ui.confirmHistoryEdit()
    expect(ui.historyAction).toBe('edit')
    expect(ui.message).toContain('修改失败')
    ui.cancelHistory()
    ui.openHistoryDelete('missing')
    expect(ui.historyAction).toBeNull()
    expect(records.getAll()).toEqual([])
  })

  it('treats a record disappearing after delete confirmation opens as an idempotent absence', () => {
    const { ui, records, storage, original } = saved()
    ui.openHistoryDelete(original.id)
    records.delete(original.id)
    storage.setItem.mockClear()
    ui.confirmHistoryDelete()
    expect(ui.historyAction).toBeNull()
    expect(ui.rows).toEqual([])
    expect(ui.message).toContain('已不存在')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('gates history writes during initialization failure, draft confirmation and unknown save outcomes', () => {
    storageFixture('broken')
    const failed = setup()
    failed.ui.openHistoryEdit('any'); failed.ui.openHistoryDelete('any')
    expect(failed.ui.historyAction).toBeNull()
    storageFixture()
    const { ui, records } = setup()
    fill(ui); ui.requestSave()
    expect(ui.historyWritable).toBe(false)
    ui.openHistoryEdit('any'); ui.openHistoryDelete('any')
    expect(ui.historyAction).toBeNull()
    vi.spyOn(records, 'save').mockImplementation(() => { throw new Error('unknown') })
    ui.confirmSave()
    expect(ui.historyWritable).toBe(false)
    ui.openHistoryEdit('any'); ui.openHistoryDelete('any')
    expect(ui.historyAction).toBeNull()
  })
})

describe('History selection for CSV export', () => {
  function withRows() {
    const fixture = storageFixture()
    const context = setup()
    confirm(context.ui)
    confirm(context.ui)
    const ids = context.records.getAll().map(record => record.id)
    fixture.storage.setItem.mockClear()
    return { ...context, ...fixture, ids }
  }

  it('toggles independent records, supports full/partial selection, and never writes storage', () => {
    const { ui, storage, ids } = withRows()
    expect(ui.selectedIds).toEqual([])
    expect(ui.allSelected).toBe(false)
    ui.select(ids[0]!)
    expect(ui.selectedIds).toEqual([ids[0]])
    expect(ui.partiallySelected).toBe(true)
    ui.select(ids[1]!)
    expect(ui.allSelected).toBe(true)
    expect(ui.partiallySelected).toBe(false)
    ui.select(ids[0]!)
    expect(ui.selectedIds).toEqual([ids[1]])
    ui.selectAll()
    expect(ui.selectedIds).toEqual(ids)
    ui.selectAll()
    expect(ui.selectedIds).toEqual([])
    ui.select('missing')
    expect(ui.selectedIds).toEqual([])
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('prunes excluded selections on successful queries without restoring them when filters are cleared', () => {
    const { ui, records, ids } = withRows()
    records.update(ids[1]!, { workOrder: 'OTHER' })
    ui.selectAll()
    ui.filters.workOrder = 'OTHER'; ui.query()
    expect(ui.selectedIds).toEqual([ids[1]])
    expect(ui.allSelected).toBe(true)
    ui.filters.workOrder = ''; ui.query()
    expect(ui.selectedIds).toEqual([ids[1]])
    expect(ui.partiallySelected).toBe(true)
    ui.filters.workOrder = 'missing'; ui.query()
    expect(ui.selectedIds).toEqual([])
    ui.selectAll()
    expect(ui.selectedIds).toEqual([])
    expect(ui.allSelected).toBe(false)
  })

  it('preserves selection on failed queries, edits and deletes, and prunes only after a successful deletion', () => {
    const { ui, storage, ids } = withRows()
    ui.selectAll()
    ui.filters.createdFrom = 'not-a-time'; ui.query()
    expect(ui.selectedIds).toEqual(ids)
    ui.filters.createdFrom = ''
    ui.openHistoryEdit(ids[0]!); ui.updateHistoryField('partNumber', 'NEW'); ui.confirmHistoryEdit()
    expect(ui.selectedIds).toEqual(ids)
    ui.openHistoryDelete(ids[0]!)
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    ui.confirmHistoryDelete()
    expect(ui.selectedIds).toEqual(ids)
    ui.confirmHistoryDelete()
    expect(ui.selectedIds).toEqual([ids[1]])
    expect(ui.allSelected).toBe(true)
  })

  it('removes a selected record excluded by editing and gates selection before ready and after disposal', () => {
    const { ui, ids } = withRows()
    ui.filters.workOrder = fields.workOrder; ui.query()
    ui.selectAll()
    ui.openHistoryEdit(ids[0]!); ui.updateHistoryField('workOrder', 'OTHER'); ui.confirmHistoryEdit()
    expect(ui.selectedIds).toEqual([ids[1]])
    ui.dispose(); ui.selectAll(); ui.select(ids[1]!)
    expect(ui.selectedIds).toEqual([ids[1]])
    const loading = reactive(useManualWorkflow())
    loading.selectAll(); loading.select(ids[0]!)
    expect(loading.selectedIds).toEqual([])
  })

  it('clears a successfully deleted ID even when refreshing the query fails', () => {
    const { ui, records, ids } = withRows()
    ui.selectAll()
    ui.openHistoryDelete(ids[0]!)
    vi.spyOn(records, 'query').mockImplementation(() => { throw new Error('display query') })
    ui.confirmHistoryDelete()
    expect(records.getById(ids[0]!)).toBeNull()
    expect(ui.selectedIds).toEqual([ids[1]])
    expect(ui.message).toContain('删除成功')
    expect(ui.displayError).toContain('查询')
  })
})
