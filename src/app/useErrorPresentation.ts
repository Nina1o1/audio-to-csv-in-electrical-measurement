import { computed, ref, watch } from 'vue'
import type { UnwrapNestedRefs } from 'vue'
import type { useManualWorkflow } from './useManualWorkflow'
import type { DraftFields } from '../shared/data-models'

type WorkflowView = UnwrapNestedRefs<ReturnType<typeof useManualWorkflow>>

// Presentation-only classification of the existing mixed status/error messages.
// Keep both workflow state and the original text untouched.
function isErrorMessage(message: string): boolean {
  return /^(当前状态不允许此操作。|CSV 导出失败：|暂无可导出的记录。|请选择有效记录。|草稿编辑失败：|请修正以下草稿错误。|无法请求保存：|无法请求删除：|取消确认失败：|草稿删除失败：|该历史记录已不存在，请重新查询。|无法打开历史记录：|修改失败，|删除失败，|修改结果未确认，|删除结果未确认，|记录已保存，草稿收尾异常，|保存失败，|保存收尾异常，|无法确认保存：|保存结果待核对，|核对读取失败，|核对发现同 ID 内容冲突，)/.test(message)
}

function isAuthError(message: string): boolean {
  return message === '语音代理操作失败，请检查访问口令和同源代理配置。'
    || message === '无法连接语音代理，请检查网络及同源部署。'
    || message === '语音代理连接超时，请重试；手动输入和历史记录仍可使用。'
}

export function useErrorPresentation(ui: WorkflowView, fieldLabels: Record<keyof DraftFields, string>) {
  const notification = ref<{ id: number; messages: readonly string[] } | null>(null)
  let sequence = 0
  function show(messages: readonly string[]): void {
    if (messages.length) notification.value = { id: ++sequence, messages }
  }
  const messageError = computed(() => isErrorMessage(ui.message) ? ui.message : '')
  const statusMessage = computed(() => messageError.value ? '' : ui.message)
  const authStatusMessage = computed(() => isAuthError(ui.authMessage) ? '' : ui.authMessage)
  const sources = [
    () => ui.speechError,
    () => ui.historyError,
    () => ui.displayError,
    () => messageError.value === '请修正以下草稿错误。' ? '' : messageError.value,
    () => ui.authenticating ? '' : isAuthError(ui.authMessage) ? ui.authMessage : '',
    () => ui.historyStatus === 'error' && ui.historyError.startsWith('历史读取失败，')
      ? '历史读取错误，保存已禁用，原始存储未被清空。' : '',
    () => ui.historyRenderError ? '历史展示异常，当前草稿及编辑副本仍保留。可重试恢复页面展示。' : '',
    () => ui.renderError ? '页面展示暂不可用，当前草稿仍保留在本页。可取消确认或重试展示，无需刷新。' : '',
  ]
  // Batch messages produced by one failure together, but never revive older errors
  // when an unrelated source changes or clears.
  watch(sources, (values, previous) => {
    show(values.filter((value, index) => value && value !== previous[index]))
  }, { immediate: true })

  watch([() => ui.errors, () => ui.message], ([errors, message], previous) => {
    if (!errors.length || (errors === previous[0] && message !== '请修正以下草稿错误。')) return
    show([
      ...(message === '请修正以下草稿错误。' ? [message] : []),
      ...errors.map(error => `${fieldLabels[error.field]}：${error.code === 'REQUIRED' ? '必填' : '数值必须有限且非负'}`),
    ])
  }, { immediate: true })

  // A repeated identical error does not invalidate a Vue ref. Re-present the result
  // of these explicit retry controls without clearing or changing workflow state.
  function repeatable<Args extends unknown[]>(action: (...args: Args) => void, error: () => string) {
    return (...args: Args): void => {
      const previous = sequence
      action(...args)
      if (sequence === previous && error()) show([error()])
    }
  }
  const actions = {
    checkSave: repeatable(ui.checkSave, () => messageError.value),
    openHistoryEdit: repeatable(ui.openHistoryEdit, () => messageError.value),
    openHistoryDelete: repeatable(ui.openHistoryDelete, () => messageError.value),
    cancelConfirmation: repeatable(ui.cancelConfirmation, () => messageError.value),
    confirmSave: repeatable(ui.confirmSave, () => messageError.value),
    confirmDelete: repeatable(ui.confirmDelete, () => messageError.value),
    initialize: repeatable(ui.initialize, () => ui.historyError || messageError.value),
    query: repeatable(ui.query, () => ui.displayError || messageError.value),
    exportRecords: repeatable(ui.exportRecords, () => messageError.value),
    confirmHistoryEdit: repeatable(ui.confirmHistoryEdit, () => messageError.value),
    confirmHistoryDelete: repeatable(ui.confirmHistoryDelete, () => messageError.value),
  }
  return { notification, statusMessage, authStatusMessage, actions }
}
