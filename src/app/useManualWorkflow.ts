import { computed, reactive, ref, shallowRef } from 'vue'
import type { DraftManagerModule, DraftValidationError } from '../contracts/m3-draft-manager'
import type { RecordErrorCode, RecordManagerModule, RecordQuery, RecordUpdate } from '../contracts/m4-record-manager'
import type { CsvExporterModule } from '../contracts/m5-csv-exporter'
import { createDraftManager } from '../modules/m3-draft-manager'
import { createRecordManager } from '../modules/m4-record-manager'
import { createCsvExporter } from '../modules/m5-csv-exporter'
import type { DraftFields, InspectionRecord } from '../shared/data-models'

/** Convert a device-local date/second to UTC; never silently choose a DST overlap offset. */
function timeBoundary(raw: string, end: boolean): string | undefined {
  if (!raw) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw)
  if (!match) throw new Error('时间格式无效。')
  const year = Number(match[1]), month = Number(match[2]) - 1, day = Number(match[3])
  const dateOnly = match[4] === undefined
  const hour = dateOnly ? (end ? 23 : 0) : Number(match[4])
  const minute = dateOnly ? (end ? 59 : 0) : Number(match[5])
  const second = dateOnly ? (end ? 59 : 0) : Number(match[6] ?? 0)
  const millisecond = end ? 999 : 0
  const local = new Date(0)
  local.setFullYear(year, month, day)
  local.setHours(hour, minute, second, millisecond)
  const matches = (date: Date) => date.getFullYear() === year && date.getMonth() === month
    && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute
    && date.getSeconds() === second && date.getMilliseconds() === millisecond
  if (!matches(local)) throw new Error('时间不存在或日期无效，请选择明确的本地时间。')

  // Nearby offsets include both sides of a clock transition, including non-hour DST shifts.
  // Test each alternative instant against the original wall time instead of accepting Date's choice.
  const offsets = new Set<number>()
  for (let hours = -48; hours <= 48; hours++) {
    offsets.add(new Date(local.getTime() + hours * 3_600_000).getTimezoneOffset())
  }
  for (const offset of offsets) {
    const candidate = new Date(local.getTime() + (offset - local.getTimezoneOffset()) * 60_000)
    if (candidate.getTime() !== local.getTime() && matches(candidate)) {
      throw new Error('时间存在时区歧义，请选择明确的本地时间。')
    }
  }
  return local.toISOString()
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '未知异常'
}

function csvErrorText(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    switch (error.code) {
      case 'EMPTY_RECORDS': return '暂无可导出的记录。'
      case 'INVALID_RECORD': return '记录数据无效，本次未发起下载。'
      case 'INVALID_FILENAME': return 'CSV 文件名无效，本次未发起下载。'
      case 'CSV_GENERATION_FAILED': return 'CSV 文件生成失败，请重试。'
      case 'DOWNLOAD_FAILED': return '无法发起下载，请检查浏览器后重试。'
    }
  }
  return errorText(error)
}

// Only documented M4 codes establish a known failure; Error.name is not part of the contract.
function hasRecordErrorCode(error: unknown, codes: readonly RecordErrorCode[]): boolean {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    && codes.some(code => code === error.code)
}

function sameRecord(left: InspectionRecord, right: InspectionRecord): boolean {
  return left.id === right.id && left.workOrder === right.workOrder && left.partNumber === right.partNumber
    && left.contactResistance === right.contactResistance && left.insulationResistance === right.insulationResistance
    && left.withstandVoltage === right.withstandVoltage && left.result === right.result
    && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt
}

/**
 * App-only coordination: Vue holds display snapshots, query input and persistence-outcome context.
 * M3 owns validation/state/identity; M4 owns records/storage; M5 owns CSV encoding/download.
 * Optional dependencies exercise the same public contracts in integration tests.
 */
export function useManualWorkflow(options: {
  draftManager?: DraftManagerModule
  createRecords?: () => RecordManagerModule
  csvExporter?: CsvExporterModule
} = {}) {
  const manager = options.draftManager ?? createDraftManager()
  const makeRecords = options.createRecords ?? createRecordManager
  let records = makeRecords()
  const csvExporter = options.csvExporter ?? createCsvExporter()
  const draft = shallowRef(manager.getDraft())
  const draftState = ref(manager.getState())
  const rows = shallowRef<InspectionRecord[]>([])
  const selectedIds = ref<string[]>([])
  const historyStatus = ref<'loading' | 'ready' | 'error'>('loading')
  const historyError = ref('')
  const displayError = ref('')
  const renderError = ref(false)
  const historyRenderError = ref(false)
  const message = ref('')
  const errors = shallowRef<DraftValidationError[]>([])
  const pending = shallowRef<InspectionRecord | null>(null)
  const awaitingCheck = ref(false)
  const busy = ref(false)
  // Dialog/form state belongs to App; it never adds a business state to M3 or M4.
  const historyAction = ref<'edit' | 'delete' | null>(null)
  const historyRecord = shallowRef<InspectionRecord | null>(null)
  const historyFields = shallowRef<DraftFields | null>(null)
  const filters = reactive({ workOrder: '', createdFrom: '', createdTo: '', sort: 'createdAt:desc' })
  let appliedQuery: RecordQuery = {}
  const disposed = ref(false)
  const idle = computed(() => !disposed.value && !busy.value && !awaitingCheck.value && draftState.value === 'IDLE')
  const editable = computed(() => idle.value && historyAction.value === null)
  const canSave = computed(() => editable.value && historyStatus.value === 'ready')
  const historyWritable = canSave
  const canExport = computed(() => historyWritable.value && !renderError.value && !historyRenderError.value)
  const allSelected = computed(() => rows.value.length > 0
    && rows.value.every(record => selectedIds.value.includes(record.id)))
  const partiallySelected = computed(() => selectedIds.value.length > 0 && !allSelected.value)
  const unsubscribeDraft = manager.onDraftChange(value => { draft.value = value })
  const unsubscribeState = manager.onStateChange(value => { draftState.value = value })

  function showRows(snapshot: InspectionRecord[]): void {
    rows.value = snapshot
    // Selection belongs to the current query. Never silently restore IDs when filters are cleared.
    const visibleIds = new Set(snapshot.map(record => record.id))
    selectedIds.value = selectedIds.value.filter(id => visibleIds.has(id))
  }

  function refreshHistory(): boolean {
    try {
      const snapshot = records.query(appliedQuery)
      showRows(snapshot)
      if (!renderError.value && !historyRenderError.value) displayError.value = ''
      return true
    } catch (error: unknown) {
      displayError.value = `历史查询展示异常：${errorText(error)}`
      return false
    }
  }

  function subscribeRecords(): () => void {
    return records.onRecordsChange(() => {
      // Our save refreshes after its result is known; never let a display callback decide that result.
      if (!busy.value && !disposed.value) refreshHistory()
    })
  }
  let unsubscribeRecords = subscribeRecords()

  function rejectOperation(): void { message.value = '当前状态不允许此操作。' }

  /** Initialize/retry without losing an editable draft or treating a read error as empty history. */
  function initialize(): void {
    if (!editable.value) return rejectOperation()
    historyStatus.value = 'loading'
    try {
      records.initialize()
      historyStatus.value = 'ready'
      historyError.value = ''
    } catch (error: unknown) {
      historyStatus.value = 'error'
      historyError.value = `历史读取失败，禁止保存；仍可编辑草稿：${errorText(error)}`
      return
    }
    refreshHistory()
  }

  /** Translate presentation controls only; filtering, validation and sorting remain in M4. */
  function query(): void {
    if (disposed.value || historyStatus.value !== 'ready' || busy.value) return rejectOperation()
    try {
      const sort = filters.sort
      if (sort !== 'createdAt:desc' && sort !== 'createdAt:asc' && sort !== 'workOrder:asc' && sort !== 'workOrder:desc') {
        throw new Error('请选择有效排序。')
      }
      const candidate: RecordQuery = {
        workOrder: filters.workOrder,
        createdFrom: timeBoundary(filters.createdFrom, false),
        createdTo: timeBoundary(filters.createdTo, true),
        sortBy: sort.startsWith('workOrder:') ? 'workOrder' : 'createdAt',
        sortDirection: sort.endsWith(':asc') ? 'asc' : 'desc',
      }
      const snapshot = records.query(candidate)
      appliedQuery = candidate // Invalid queries never replace the last successfully applied query.
      showRows(snapshot)
      if (!renderError.value && !historyRenderError.value) displayError.value = ''
    } catch (error: unknown) {
      displayError.value = `历史查询失败：${errorText(error)}`
    }
  }

  /** Toggle a visible record ID only; selecting does not modify M4 records or storage. */
  function select(id: string): void {
    if (!historyWritable.value || !rows.value.some(record => record.id === id)) return rejectOperation()
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter(selected => selected !== id) : [...selectedIds.value, id]
  }

  /** Select/deselect the current query result, including correct empty and partial-selection behavior. */
  function selectAll(): void {
    if (!historyWritable.value) return rejectOperation()
    selectedIds.value = allSelected.value ? [] : rows.value.map(record => record.id)
  }

  /** Fetch current M4 snapshots at click time; all ignores filters, selected uses valid IDs only. */
  function exportRecords(all: boolean): void {
    if (!canExport.value) return rejectOperation()
    busy.value = true
    try {
      let snapshot: InspectionRecord[]
      try { snapshot = records.getAll() }
      catch (error: unknown) {
        message.value = `CSV 导出失败：无法读取历史记录：${errorText(error)}`
        return
      }
      // Reconcile IDs before exporting; neither the displayed rows nor history edit copies
      // are authoritative. A failed read above must not discard existing selection.
      const validIds = new Set(snapshot.map(record => record.id))
      const previousCount = selectedIds.value.length
      selectedIds.value = selectedIds.value.filter(id => validIds.has(id))
      const removedCount = previousCount - selectedIds.value.length
      const selectionNotice = removedCount ? `已清理 ${removedCount} 条失效选择。` : ''
      const selected = new Set(selectedIds.value)
      const batch = all ? snapshot : snapshot.filter(record => selected.has(record.id))
      if (batch.length === 0) {
        message.value = `${all ? '暂无可导出的记录。' : '请选择有效记录。'}${selectionNotice}`
        return
      }
      try {
        // M5 provides filename/BOM defaults and validates the entire batch before downloading.
        const result = csvExporter.export(batch)
        message.value = `已发起下载，共 ${result.recordCount} 条记录。${selectionNotice}`
      } catch (error: unknown) {
        message.value = `CSV 导出失败：${csvErrorText(error)}${selectionNotice}`
      }
    } finally { busy.value = false }
  }

  /** Route one input to M3; snapshots are never used as mutable business data. */
  function updateField<K extends keyof DraftFields>(field: K, value: DraftFields[K]): void {
    if (!editable.value) return rejectOperation()
    try {
      manager.updateField(field, value)
      // Keep the last attempt snapshot for coordination; confirmSave always obtains identity from M3.
      errors.value = []
    } catch (error: unknown) { message.value = `草稿编辑失败：${errorText(error)}` }
  }

  /** M3 validates and freezes; no record identity exists until confirmSave. */
  function requestSave(): void {
    if (!canSave.value) return rejectOperation()
    try {
      const validation = manager.requestSave()
      errors.value = validation.errors
      message.value = validation.valid ? '请确认保存当前草稿。' : '请修正以下草稿错误。'
    } catch (error: unknown) { message.value = `无法请求保存：${errorText(error)}` }
  }

  /** Request deletion of the M3 draft only; a history dialog prevents concurrent actions. */
  function requestDelete(): void {
    if (!editable.value) return rejectOperation()
    try { manager.requestDelete(); message.value = '确认删除当前草稿？' }
    catch (error: unknown) { message.value = `无法请求删除：${errorText(error)}` }
  }

  /** Cancel the current M3 confirmation without discarding draft data or retry identity. */
  function cancelConfirmation(): void {
    if (disposed.value || busy.value || awaitingCheck.value) return rejectOperation()
    try {
      if (manager.getState() === 'CONFIRMING_SAVE') manager.cancelSave()
      else if (manager.getState() === 'CONFIRMING_DELETE') manager.cancelDelete()
      else return rejectOperation()
      errors.value = []
      message.value = '已保留草稿，可继续修改。'
    } catch (error: unknown) { message.value = `取消确认失败：${errorText(error)}` }
  }

  /** Confirm draft deletion; formal history records remain owned by M4. */
  function confirmDelete(): void {
    if (disposed.value || busy.value || awaitingCheck.value || manager.getState() !== 'CONFIRMING_DELETE') return rejectOperation()
    try {
      manager.confirmDelete()
      pending.value = null
      errors.value = []
      message.value = '已删除草稿，历史记录不变。'
    } catch (error: unknown) { message.value = `草稿删除失败：${errorText(error)}` }
  }

  function openHistory(action: 'edit' | 'delete', id: string): void {
    if (!historyWritable.value) return rejectOperation()
    try {
      const record = records.getById(id)
      if (record === null) {
        message.value = '该历史记录已不存在，请重新查询。'
        refreshHistory()
        return
      }
      historyRecord.value = record
      historyFields.value = action === 'edit' ? {
        workOrder: record.workOrder, partNumber: record.partNumber,
        contactResistance: record.contactResistance, insulationResistance: record.insulationResistance,
        withstandVoltage: record.withstandVoltage, result: record.result,
      } : null
      historyAction.value = action
      message.value = action === 'edit' ? '编辑独立副本，确认后才写入历史。' : '请核对要删除的历史记录。'
    } catch (error: unknown) { message.value = `无法打开历史记录：${errorText(error)}` }
  }

  /** Load the latest M4 snapshot into an independent six-field history form, never into M3. */
  function openHistoryEdit(id: string): void { openHistory('edit', id) }

  /** Request confirmation for one existing historical record. Opening never deletes data. */
  function openHistoryDelete(id: string): void { openHistory('delete', id) }

  /** Change only the App-owned edit copy. M4 validates the complete update on confirmation. */
  function updateHistoryField<K extends keyof DraftFields>(field: K, value: DraftFields[K]): void {
    if (!idle.value || historyAction.value !== 'edit' || !historyFields.value) return rejectOperation()
    historyFields.value = { ...historyFields.value, [field]: value }
  }

  function closeHistory(): void {
    historyAction.value = null
    historyRecord.value = null
    historyFields.value = null
  }

  /** Discard the history edit/confirmation copy without changing M3 or persisted records. */
  function cancelHistory(): void {
    if (!idle.value || historyAction.value === null) return rejectOperation()
    closeHistory()
    message.value = '已取消历史操作，原记录不变。'
  }

  function confirmHistory(action: 'edit' | 'delete'): void {
    const target = historyRecord.value
    if (!idle.value || historyStatus.value !== 'ready' || historyAction.value !== action || !target) return rejectOperation()
    const form = historyFields.value
    if (action === 'edit' && !form) return rejectOperation()
    busy.value = true
    try {
      let deleted = false
      // Only the M4 call decides persistence success. Refresh/render failures are handled afterwards.
      try {
        if (action === 'edit' && form) {
          // An empty control must remain an explicit invalid update, not an omitted key that
          // silently keeps the old value. M4 rejects undefined and validates all six fields.
          const changes: RecordUpdate = {
            workOrder: form.workOrder ?? undefined, partNumber: form.partNumber ?? undefined,
            contactResistance: form.contactResistance ?? undefined,
            insulationResistance: form.insulationResistance ?? undefined,
            withstandVoltage: form.withstandVoltage ?? undefined, result: form.result ?? undefined,
          }
          records.update(target.id, changes)
        } else deleted = records.delete(target.id)
      } catch (error: unknown) {
        const label = action === 'edit' ? '修改' : '删除'
        const known = hasRecordErrorCode(error, ['NOT_INITIALIZED', 'INVALID_DATA', 'RECORD_NOT_FOUND', 'STORAGE_WRITE_FAILED'])
        message.value = known ? `${label}失败，原记录及表单已保留：${errorText(error)}`
          : `${label}结果未确认，请重新查询核对；当前表单已保留：${errorText(error)}`
        return
      }
      // A successful delete (including an already absent record) invalidates this selection
      // even if the subsequent display query fails and the old rows remain visible.
      if (action === 'delete') selectedIds.value = selectedIds.value.filter(id => id !== target.id)
      closeHistory()
      message.value = action === 'edit' ? '修改成功。' : deleted ? '删除成功。' : '该记录已不存在，已刷新历史。'
      if (refreshHistory() && action === 'edit' && !rows.value.some(record => record.id === target.id)) {
        message.value = '修改成功，该记录不在当前筛选范围内。'
      }
    } finally { busy.value = false }
  }

  /** Persist the six-field edit via M4, retaining the form and original data on known failure. */
  function confirmHistoryEdit(): void { confirmHistory('edit') }

  /** Delete one confirmed record via M4; success alone closes the dialog and refreshes the query. */
  function confirmHistoryDelete(): void { confirmHistory('delete') }

  function finishSuccess(id: string): void {
    // This catch is deliberately separate from M4.save: persistence is already confirmed.
    try {
      if (manager.getState() === 'SAVING') manager.completeSave()
    } catch (error: unknown) {
      awaitingCheck.value = true
      message.value = `记录已保存，草稿收尾异常，请核对保存结果：${errorText(error)}`
      return
    }
    pending.value = null
    awaitingCheck.value = false
    errors.value = []
    message.value = '保存成功。'
    if (refreshHistory() && !rows.value.some(record => record.id === id)) {
      message.value = '保存成功，该记录不在当前筛选范围内。'
    }
  }

  function finishFailure(error: unknown): void {
    try {
      manager.failSave()
      awaitingCheck.value = false
      message.value = `保存失败，草稿及保存身份已保留：${errorText(error)}`
    } catch (finalizationError: unknown) {
      awaitingCheck.value = true
      message.value = `保存收尾异常，请核对保存结果：${errorText(finalizationError)}`
    }
  }

  /** One synchronous persistence attempt. Unknown outcomes must be reconciled, never guessed. */
  function confirmSave(): void {
    if (disposed.value || busy.value || awaitingCheck.value || historyStatus.value !== 'ready'
      || manager.getState() !== 'CONFIRMING_SAVE') return rejectOperation()
    busy.value = true
    try {
      let record: InspectionRecord
      try { record = manager.confirmSave(); pending.value = { ...record } }
      catch (error: unknown) { message.value = `无法确认保存：${errorText(error)}`; return }
      try { records.save(record) }
      catch (error: unknown) {
        if (hasRecordErrorCode(error, ['NOT_INITIALIZED', 'INVALID_DATA', 'DUPLICATE_ID', 'STORAGE_WRITE_FAILED'])) finishFailure(error)
        else {
          awaitingCheck.value = true
          message.value = `保存结果待核对，请点击“核对保存结果”：${errorText(error)}`
        }
        return
      }
      finishSuccess(record.id)
    } finally { busy.value = false }
  }

  /** Re-read via a new M4 instance; never inspect storage or resume writes on the old instance. */
  function checkSave(): void {
    if (disposed.value || busy.value || !awaitingCheck.value || !pending.value) return rejectOperation()
    busy.value = true
    const candidate = { ...pending.value }
    try {
      unsubscribeRecords()
      let found: InspectionRecord | null
      try {
        const reloaded = makeRecords()
        reloaded.initialize()
        records = reloaded
        unsubscribeRecords = subscribeRecords()
        historyStatus.value = 'ready'
        historyError.value = ''
        found = records.getById(candidate.id)
      } catch (error: unknown) {
        message.value = `核对读取失败，继续冻结保存：${errorText(error)}`
        return
      }
      if (found === null) {
        refreshHistory()
        finishFailure(new Error('核对确认记录尚未持久化。'))
      }
      else if (sameRecord(found, candidate)) finishSuccess(candidate.id)
      else {
        refreshHistory()
        message.value = '核对发现同 ID 内容冲突，继续冻结保存，请保留当前页面。'
      }
    } finally { busy.value = false }
  }

  /** Release subscriptions on page unmount; drafts are intentionally never persisted. */
  function dispose(): void {
    disposed.value = true
    unsubscribeDraft(); unsubscribeState(); unsubscribeRecords()
  }

  /** Vue render faults are display failures, even if they occur just after persistence commits. */
  function reportRenderError(error: unknown, area: 'page' | 'history' = 'page'): void {
    if (area === 'history') historyRenderError.value = true
    else renderError.value = true
    displayError.value = `页面渲染异常，请保留当前页面；保存结果独立处理：${errorText(error)}`
  }

  /** Remount only the failed UI region while preserving draft, pending, query and edit copies. */
  function retryRender(): void {
    if (disposed.value || busy.value) return rejectOperation()
    renderError.value = false
    historyRenderError.value = false
    displayError.value = ''
  }

  return {
    draft, draftState, rows, selectedIds, allSelected, partiallySelected, select, selectAll, canExport, exportRecords,
    historyStatus, historyError, displayError, message, errors,
    pending, awaitingCheck, busy, filters, editable, canSave, renderError, historyRenderError, reportRenderError, retryRender,
    historyAction, historyRecord, historyFields, historyWritable,
    openHistoryEdit, openHistoryDelete, updateHistoryField, cancelHistory, confirmHistoryEdit, confirmHistoryDelete,
    initialize, query, updateField, requestSave, confirmSave, requestDelete, confirmDelete,
    cancelConfirmation, checkSave, dispose,
  }
}
