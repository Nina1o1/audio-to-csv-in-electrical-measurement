<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, reactive } from 'vue'
import DraftPanel from './components/DraftPanel.vue'
import VoicePanel from './components/VoicePanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import ConfirmationPreview from './components/ConfirmationPreview.vue'
import ErrorToast from './components/ErrorToast.vue'
import { useErrorPresentation } from './app/useErrorPresentation'
import { useManualWorkflow } from './app/useManualWorkflow'
import type { DraftFields } from './shared/data-models'

const ui = reactive(useManualWorkflow())
const fieldLabels: Record<keyof DraftFields, string> = {
  workOrder: '工单', partNumber: '料号', contactResistance: '接触电阻（mΩ）',
  insulationResistance: '绝缘电阻（MΩ）', withstandVoltage: '耐电压（V）', result: '检验结果',
}
const { notification, statusMessage, authStatusMessage, actions } = useErrorPresentation(ui, fieldLabels)
const confirming = computed(() => !ui.awaitingCheck
  && (ui.draftState === 'CONFIRMING_SAVE' || ui.draftState === 'CONFIRMING_DELETE'))
const saving = computed(() => ui.draftState === 'CONFIRMING_SAVE')
onMounted(actions.initialize)
onUnmounted(ui.dispose)
// A broken history view must not remove an unrelated draft or its confirmation controls.
onErrorCaptured((error, instance) => {
  ui.reportRenderError(error, instance?.$options.name === 'HistoryPanel' ? 'history' : 'page')
  return false
})
</script>

<template>
  <main class="workspace">
    <ErrorToast :notification="notification" />
    <header class="page-header"><h1>工业质检语音录入系统</h1></header>
    <p id="manual-note" class="preview-note" tabindex="-1">当前已接入手动草稿与浏览器本地历史记录，支持新增、查询、编辑、删除和 CSV 导出。草稿刷新后丢失；语音与手动编辑使用同一份草稿。</p>
    <VoicePanel :microphone="ui.microphone" :starting="ui.starting" :processing="ui.processing" :stopping="ui.stopping" :confirmed-text="ui.confirmedText" :interim-text="ui.interimText" :speech-error="ui.speechError" :text-complete="ui.textComplete" :authenticating="ui.authenticating" :auth-message="authStatusMessage" :can-start-input="ui.editable && !ui.inputActive && !ui.authenticating && ui.microphone === 'LISTENING'" :can-stop-input="ui.microphone === 'RECORDING' && ui.inputActive && !ui.processing && !ui.stopping" @listen="ui.toggleListening" @start="ui.startInput" @stop="ui.stopInput" @login="ui.loginVoice" @logout="ui.logoutVoice" />
    <template v-if="!ui.renderError">
      <DraftPanel :draft="ui.draft" :disabled="!ui.editable" :save-disabled="!ui.canSave" :status="ui.draftState" @update="ui.updateField" @save="ui.requestSave" @delete="ui.requestDelete" />
      <HistoryPanel v-if="!ui.historyRenderError" v-model:filters="ui.filters" :records="ui.rows" :selected-ids="ui.selectedIds" :status="ui.historyStatus" :writable="ui.historyWritable" :all-selected="ui.allSelected" :partially-selected="ui.partiallySelected" :selection-disabled="!ui.historyWritable" :export-disabled="!ui.canExport" @export="actions.exportRecords" @query="actions.query" @select="ui.select" @select-all="ui.selectAll" @edit="actions.openHistoryEdit" @delete="actions.openHistoryDelete" />
      <section v-else class="panel history-panel" aria-labelledby="history-title"><h2 id="history-title">历史记录</h2></section>
    </template>
    <section v-else class="panel" aria-label="草稿保留快照">
      <dl class="confirmation-values"><div v-for="(value, field) in ui.draft" :key="field"><dt>{{ fieldLabels[field] }}</dt><dd>{{ value ?? '未填写' }}</dd></div></dl>
      <button v-if="confirming" @click="actions.cancelConfirmation">取消当前草稿确认</button>
      <button v-if="ui.historyAction" @click="ui.cancelHistory">取消当前历史确认</button>
    </section>
    <div class="feedback" aria-live="polite">
      <p v-if="statusMessage">{{ statusMessage }}</p>
      <p v-if="ui.historyStatus === 'error'">{{ ui.historyError }}</p>
      <button v-if="ui.historyStatus === 'error' && !ui.awaitingCheck" @click="actions.initialize">重试加载历史</button>
      <button v-if="ui.awaitingCheck" :disabled="ui.busy" @click="actions.checkSave">核对保存结果</button>
      <button v-if="ui.renderError || ui.historyRenderError" :disabled="ui.busy" @click="ui.retryRender">恢复页面展示</button>
    </div>
    <ConfirmationPreview v-if="confirming && !ui.renderError" class="draft-confirmation" :title="saving ? '确认保存当前草稿？' : '确认删除当前草稿？'" :cancel-text="saving ? '修改' : '保留'" :confirm-text="saving ? '确认保存' : '确认删除'" :disabled="ui.busy" @cancel="actions.cancelConfirmation" @confirm="saving ? actions.confirmSave() : actions.confirmDelete()">
      <dl v-if="saving" class="confirmation-values">
        <div v-for="(value, field) in ui.draft" :key="field"><dt>{{ fieldLabels[field] }}</dt><dd>{{ value }}</dd></div>
      </dl>
      <p v-if="saving && statusMessage" role="status">{{ statusMessage }}</p>
    </ConfirmationPreview>
    <ConfirmationPreview v-if="ui.historyAction && ui.historyRecord && !ui.renderError" :title="ui.historyAction === 'edit' ? '编辑历史记录' : '确认删除历史记录？'" cancel-text="取消" :confirm-text="ui.historyAction === 'edit' ? '确认修改' : '确认删除历史记录'" description="只操作当前选中的历史记录，不改变当前质检草稿。" :disabled="ui.busy" @cancel="ui.cancelHistory" @confirm="ui.historyAction === 'edit' ? actions.confirmHistoryEdit() : actions.confirmHistoryDelete()">
      <p v-if="ui.historyAction === 'edit'">记录 ID：{{ ui.historyRecord.id }} · 创建时间（UTC）：{{ ui.historyRecord.createdAt }}</p>
      <DraftPanel v-if="ui.historyAction === 'edit' && ui.historyFields" :draft="ui.historyFields" prefix="history-edit" title="历史编辑副本" status="确认后写入" :show-actions="false" :disabled="ui.busy" @update="ui.updateHistoryField" />
      <dl v-else class="confirmation-values">
        <div><dt>记录 ID</dt><dd>{{ ui.historyRecord.id }}</dd></div>
        <div v-for="(label, field) in fieldLabels" :key="field"><dt>{{ label }}</dt><dd>{{ ui.historyRecord[field] }}</dd></div>
        <div><dt>创建时间（UTC）</dt><dd>{{ ui.historyRecord.createdAt }}</dd></div>
        <div><dt>修改时间（UTC）</dt><dd>{{ ui.historyRecord.updatedAt }}</dd></div>
      </dl>
      <p v-if="statusMessage" role="status">{{ statusMessage }}</p>
    </ConfirmationPreview>
    <footer class="page-footer">历史记录仅保存在当前浏览器及当前网站来源；草稿不持久化。</footer>
  </main>
</template>
