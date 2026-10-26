import { computed, nextTick, ref, watch } from 'vue'
import type { DraftFields, DraftState, InspectionFields, InspectionRecord, MicrophoneState, ParseResult, VoiceCommand } from '../shared/data-models'

// Phase 2 only: local UI scenarios, never a substitute for M1–M5.
const emptyDraft = (): DraftFields => ({
  workOrder: null,
  partNumber: null,
  contactResistance: null,
  insulationResistance: null,
  withstandVoltage: null,
  result: null,
})
const fieldLabels: Record<keyof DraftFields, string> = {
  workOrder: '工单号',
  partNumber: '零件号',
  contactResistance: '接触电阻（mΩ）',
  insulationResistance: '绝缘电阻（MΩ）',
  withstandVoltage: '耐压（V）',
  result: '检验结果',
}
const exampleFields: InspectionFields = {
  workOrder: 'WO-20261026',
  partNumber: 'P-007',
  contactResistance: 12.5,
  insulationResistance: 200,
  withstandVoltage: 1500,
  result: 'PASS',
}
const exampleRecords = (): InspectionRecord[] => [
  { ...exampleFields, id: 'demo-002', createdAt: '2026-10-26T02:30:00.000Z', updatedAt: '2026-10-26T02:30:00.000Z' },
  { ...exampleFields, id: 'demo-001', workOrder: 'WO-20261025', partNumber: 'P-012', contactResistance: 18, result: 'FAIL', createdAt: '2026-10-25T08:15:00.000Z', updatedAt: '2026-10-25T08:15:00.000Z' },
]

export function useMockUi() {
  const draft = ref<DraftFields>(emptyDraft())
  const draftState = ref<DraftState>('IDLE')
  const microphone = ref<MicrophoneState>('IDLE')
  const starting = ref(false)
  const processing = ref(false)
  const confirmedText = ref('')
  const interimText = ref('')
  const textComplete = ref(false)
  const message = ref('')
  const errors = ref<string[]>([])
  const historyStatus = ref<'loading' | 'ready' | 'error'>('loading') // UI state, not business state.
  const records = ref<InspectionRecord[]>(exampleRecords())
  const selectedIds = ref<string[]>([])
  const filters = ref({ workOrder: '', createdFrom: '', createdTo: '', sort: 'createdAt:desc' })
  const appliedFilters = ref({ ...filters.value })
  const dialog = ref<'save' | 'draft-delete' | 'history-edit' | 'history-delete' | null>(null)
  const editRecord = ref<InspectionRecord | null>(null)
  const pending = ref<InspectionRecord | null>(null)
  const awaitingCheck = ref(false)
  const saveOutcome = ref<'success' | 'failure' | 'uncertain'>('success')
  const checkOutcome = ref<'same' | 'absent' | 'conflict' | 'error'>('same')
  const validationFailure = ref(false)
  const operationFailure = ref(false)
  const speechFailure = ref(false)
  const parseFailure = ref(false)
  const queryFailure = ref(false)
  let session = 0
  let currentSession = 0
  let startRequest = 0
  let saveSequence = 0
  let saveRequest = 0
  let afterParse: 'save' | 'draft-delete' | null = null

  const editable = computed(() => draftState.value === 'IDLE' && !processing.value)
  const historyWritable = computed(() => historyStatus.value === 'ready' && draftState.value !== 'SAVING')
  const historyAvailable = computed(() => historyStatus.value === 'ready')
  const visibleRecords = computed(() => {
    if (!historyAvailable.value) return []
    const f = appliedFilters.value
    // Small in-memory preview only; UTC/local-time production query validation belongs to M4/App integration.
    const from = f.createdFrom ? new Date(f.createdFrom).getTime() : -Infinity
    const to = f.createdTo ? new Date(f.createdTo).getTime() + 999 : Infinity
    const [field, direction] = f.sort.split(':')
    return records.value.filter(r => r.workOrder.toLowerCase().includes(f.workOrder.trim().toLowerCase()) && Date.parse(r.createdAt) >= from && Date.parse(r.createdAt) <= to)
      .sort((a, b) => {
        const left = field === 'workOrder' ? a.workOrder : a.createdAt
        const right = field === 'workOrder' ? b.workOrder : b.createdAt
        const order = left < right ? -1 : left > right ? 1 : 0
        return order ? order * (direction === 'asc' ? 1 : -1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
  })
  watch(visibleRecords, rows => {
    selectedIds.value = selectedIds.value.filter(id => rows.some(r => r.id === id))
  }, { flush: 'sync' })
  const allSelected = computed(() => visibleRecords.value.length > 0 && selectedIds.value.length === visibleRecords.value.length)
  const partiallySelected = computed(() => selectedIds.value.length > 0 && !allSelected.value)
  const say = (text: string) => { message.value = `Mock：${text}` }
  const reject = () => say('当前状态不允许此操作。')

  function updateField<K extends keyof DraftFields>(field: K, value: DraftFields[K]) {
    if (!editable.value || dialog.value) return reject()
    if (draft.value[field] !== value) pending.value = null
    draft.value = { ...draft.value, [field]: value }
    errors.value = []
  }
  function applyPreset(result: ParseResult) {
    if (!editable.value || dialog.value) return reject()
    errors.value = []
    for (const field of Object.keys(result) as (keyof ParseResult)[]) {
      const value = result[field]
      if (value !== undefined && value !== null && draft.value[field] !== value) {
        pending.value = null
        draft.value = { ...draft.value, [field]: value }
      }
    }
  }
  function clearDraft() {
    draft.value = emptyDraft()
    pending.value = null
    confirmedText.value = ''
    interimText.value = ''
    textComplete.value = false
    session++
    afterParse = null
    errors.value = []
  }
  function toggleListening() {
    if (starting.value || microphone.value === 'RECORDING') return reject()
    if (microphone.value === 'LISTENING') {
      microphone.value = 'IDLE'
      return
    }
    starting.value = true
    const request = ++startRequest
    void nextTick(() => finishStartup(request))
  }
  function finishStartup(request = startRequest) {
    if (!starting.value || request !== startRequest) return
    starting.value = false
    microphone.value = speechFailure.value ? 'IDLE' : 'LISTENING'
    if (speechFailure.value) say('模拟语音启动失败，手动操作仍可使用。')
  }
  function cancelStartup() {
    startRequest++
    starting.value = false
    microphone.value = 'IDLE'
    say('已取消模拟启动。')
  }
  function startInput() {
    if (!editable.value || dialog.value || microphone.value !== 'LISTENING') return reject()
    microphone.value = 'RECORDING'
    currentSession = ++session
    confirmedText.value = ''
    interimText.value = ''
    textComplete.value = false
  }
  function transcript() {
    if (microphone.value !== 'RECORDING') return reject()
    confirmedText.value = '工单号 WO-20261026，接触电阻十二点五毫欧'
    interimText.value = '零件号…'
  }
  function stopInput() {
    if (microphone.value !== 'RECORDING') return reject()
    microphone.value = 'LISTENING'
    interimText.value = ''
    textComplete.value = true
    processing.value = true
  }
  function finishParse(token = currentSession) {
    if (!processing.value || token !== session) return reject()
    processing.value = false
    if (parseFailure.value) {
      afterParse = null
      say('模拟结构化失败，草稿保持不变。')
      return
    }
    if (confirmedText.value) applyPreset({ workOrder: exampleFields.workOrder, contactResistance: exampleFields.contactResistance })
    const action = afterParse
    afterParse = null
    if (action) requestDraft(action)
  }
  function interruptSpeech() {
    if (microphone.value === 'RECORDING') stopInput()
    microphone.value = 'IDLE'
    say('模拟识别中断，保留已确认文本，未自动重启。')
  }
  // Basic input completeness guard for the preview; not the M3 validator or its error contract.
  function completeFields(fields: DraftFields): fields is InspectionFields {
    errors.value = []
    for (const key of Object.keys(fieldLabels) as (keyof DraftFields)[]) {
      const value = fields[key]
      if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
        errors.value.push(`${fieldLabels[key]}：必填`)
      } else if (key === 'workOrder' || key === 'partNumber') {
        if (typeof value !== 'string') errors.value.push(`${fieldLabels[key]}：需要文本`)
      } else if (key === 'result') {
        if (value !== 'PASS' && value !== 'FAIL') errors.value.push(`${fieldLabels[key]}：请选择 PASS 或 FAIL`)
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        errors.value.push(`${fieldLabels[key]}：需要有限非负数`)
      }
    }
    if (validationFailure.value) errors.value.push('预设校验错误：工单号无效', '预设校验错误：零件号无效')
    return errors.value.length === 0
  }
  function requestDraft(action: 'save' | 'draft-delete') {
    if (draftState.value !== 'IDLE' || dialog.value) return reject()
    if (action === 'save' && !historyWritable.value) return reject()
    if (microphone.value === 'RECORDING' || processing.value) {
      if (afterParse) return reject()
      afterParse = action
      if (microphone.value === 'RECORDING') stopInput()
      say('先完成模拟结构化处理，再执行请求。')
      return
    }
    if (action === 'save' && !completeFields(draft.value)) return
    draftState.value = action === 'save' ? 'CONFIRMING_SAVE' : 'CONFIRMING_DELETE'
    message.value = ''
    dialog.value = action
  }
  function cancelDialog() {
    if (!dialog.value) return
    if (dialog.value === 'save' || dialog.value === 'draft-delete') draftState.value = 'IDLE'
    dialog.value = null
    editRecord.value = null
    errors.value = []
  }
  function confirmDialog() {
    const action = dialog.value
    if (action === 'save' && draftState.value === 'CONFIRMING_SAVE' && completeFields(draft.value)) {
      if (!historyWritable.value) return reject()
      if (!pending.value) {
        const now = new Date().toISOString()
        pending.value = { ...draft.value, id: `mock-${++saveSequence}`, createdAt: now, updatedAt: now }
      }
      draftState.value = 'SAVING'
      awaitingCheck.value = false
      dialog.value = null
      say('模拟保存中，正在自动返回预设结果。')
      const request = ++saveRequest
      void nextTick(() => {
        if (request === saveRequest && draftState.value === 'SAVING' && !awaitingCheck.value) finishSave()
      })
    } else if (action === 'draft-delete' && draftState.value === 'CONFIRMING_DELETE') {
      clearDraft()
      draftState.value = 'IDLE'
      dialog.value = null
      say('已清空模拟草稿，历史不变。')
    } else if (action === 'history-edit' || action === 'history-delete') {
      if (!historyWritable.value) return reject()
      if (action === 'history-edit' && editRecord.value && !completeFields(editRecord.value)) return
      if (operationFailure.value) {
        say('模拟历史操作失败，保留原记录和编辑副本。')
        return
      }
      if (action === 'history-delete') records.value = records.value.filter(r => r.id !== editRecord.value?.id)
      else if (editRecord.value) {
        const copy = editRecord.value
        records.value = records.value.map(record => {
          if (record.id !== copy.id) return record
          const unchanged = JSON.stringify(record) === JSON.stringify(copy)
          const updatedAt = unchanged
            ? record.updatedAt
            : new Date(Math.max(Date.now(), Date.parse(record.updatedAt))).toISOString()
          return { ...copy, updatedAt }
        })
      }
      cancelDialog()
      say('模拟历史操作成功，仅修改内存示例。')
    }
  }
  function saveSucceeded() {
    awaitingCheck.value = false
    if (!pending.value) return
    const record = { ...pending.value }
    if (!records.value.some(r => r.id === record.id)) records.value = [...records.value, record]
    clearDraft()
    draftState.value = 'IDLE'
    say(visibleRecords.value.some(r => r.id === record.id) ? '模拟保存成功，仅在内存中。' : '模拟保存成功，该记录不在当前筛选范围内。')
  }
  function finishSave() {
    if (draftState.value !== 'SAVING' || !pending.value || awaitingCheck.value) return reject()
    if (saveOutcome.value === 'success') saveSucceeded()
    else if (saveOutcome.value === 'failure') {
      draftState.value = 'IDLE'
      say('模拟保存失败，保留草稿及完整 pending。')
    } else {
      awaitingCheck.value = true
      say('模拟保存结果不确定，请核对保存结果。')
    }
  }
  function checkSave() {
    if (draftState.value !== 'SAVING' || !pending.value || !awaitingCheck.value) return reject()
    if (checkOutcome.value === 'same') saveSucceeded()
    else if (checkOutcome.value === 'absent') {
      awaitingCheck.value = false
      draftState.value = 'IDLE'
      say('模拟核对：记录不存在，保留草稿和 pending，可再次确认保存。')
    }
    else say(checkOutcome.value === 'conflict' ? '模拟核对内容冲突，继续冻结。' : '模拟核对读取失败，继续冻结。')
  }
  function openHistory(action: 'history-edit' | 'history-delete', id: string) {
    if (!historyWritable.value || dialog.value) return reject()
    const record = records.value.find(r => r.id === id)
    if (!record) return reject()
    editRecord.value = { ...record }
    const { workOrder, partNumber, contactResistance, insulationResistance, withstandVoltage, result } = record
    historyEditFields.value = { workOrder, partNumber, contactResistance, insulationResistance, withstandVoltage, result }
    errors.value = []
    message.value = ''
    dialog.value = action
  }
  function updateHistory<K extends keyof DraftFields>(field: K, value: DraftFields[K]) {
    if (dialog.value !== 'history-edit' || !historyWritable.value || !editRecord.value) return reject()
    // The UI may hold incomplete input; official records stay untouched until confirmation.
    historyEditFields.value = { ...historyEditFields.value, [field]: value }
  }
  const historyEditFields = ref<DraftFields>(emptyDraft())
  function confirmHistory() {
    if (!editRecord.value || !completeFields(historyEditFields.value)) return
    editRecord.value = { ...editRecord.value, ...historyEditFields.value }
    confirmDialog()
  }
  function query() {
    if (!historyAvailable.value || dialog.value) return reject()
    const f = filters.value
    if (queryFailure.value || (f.createdFrom && f.createdTo && f.createdFrom > f.createdTo)) return say('模拟 INVALID_QUERY：时间范围无效或存在歧义，查询结果保持不变。')
    appliedFilters.value = { ...f }
  }
  function select(id: string) {
    if (!visibleRecords.value.some(r => r.id === id)) return reject()
    selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(x => x !== id) : [...selectedIds.value, id]
  }
  function selectAll() { selectedIds.value = allSelected.value ? [] : visibleRecords.value.map(r => r.id) }
  function exportRecords(all: boolean) {
    if (!historyAvailable.value) return reject()
    const latest = all ? records.value : records.value.filter(r => selectedIds.value.includes(r.id))
    if (!latest.length) return say('没有可模拟导出的记录，未下载。')
    say(operationFailure.value ? '模拟导出失败，数据保持不变。' : `模拟导出 ${latest.length} 条，未生成或下载文件。`)
  }
  function loadHistory(status: 'loading' | 'ready' | 'error', empty = false) {
    if (draftState.value !== 'IDLE' || dialog.value || processing.value) return reject()
    historyStatus.value = status
    if (status === 'ready') {
      records.value = empty ? [] : exampleRecords()
      say(empty ? '模拟历史为空。' : '模拟历史加载成功，仅内存示例。')
    } else if (status === 'error') {
      say('模拟读取失败，禁止历史写入；仍可编辑草稿。')
    } else {
      say('模拟历史加载中，等待预设结果。')
    }
  }
  function command(command: VoiceCommand) {
    if (microphone.value === 'RECORDING' && command !== 'STOP_INPUT') return reject()
    switch (command) {
      case 'START_INPUT': return startInput()
      case 'STOP_INPUT': return stopInput()
      case 'SAVE': return requestDraft('save')
      case 'DELETE': return requestDraft('draft-delete')
      case 'CONFIRM_SAVE': if (dialog.value === 'save') return confirmDialog(); break
      case 'CONFIRM_DELETE': if (dialog.value === 'draft-delete') return confirmDialog(); break
      case 'MODIFY': if (dialog.value === 'save') return cancelDialog(); break
      case 'KEEP': if (dialog.value === 'draft-delete') return cancelDialog(); break
    }
    reject()
  }
  return {
    fieldLabels,
    awaitingCheck,
    draft,
    draftState,
    microphone,
    starting,
    processing,
    confirmedText,
    interimText,
    textComplete,
    message,
    errors,
    historyStatus,
    records,
    selectedIds,
    filters,
    visibleRecords,
    dialog,
    editRecord,
    historyEditFields,
    pending,
    saveOutcome,
    checkOutcome,
    validationFailure,
    operationFailure,
    speechFailure,
    parseFailure,
    queryFailure,
    editable,
    historyWritable,
    historyAvailable,
    allSelected,
    partiallySelected,
    updateField,
    applyPreset,
    toggleListening,
    finishStartup,
    cancelStartup,
    startInput,
    transcript,
    stopInput,
    finishParse,
    interruptSpeech,
    requestDraft,
    cancelDialog,
    confirmDialog,
    finishSave,
    checkSave,
    openHistory,
    updateHistory,
    confirmHistory,
    query,
    select,
    selectAll,
    exportRecords,
    loadHistory,
    command,
    fillExample: () => applyPreset(exampleFields),
    lateResult: () => finishParse(-1),
  }
}
