<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import VoicePanel from './components/VoicePanel.vue'
import DraftPanel from './components/DraftPanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import ConfirmationPreview from './components/ConfirmationPreview.vue'
import { useMockUi } from './mock/useMockUi'
import type { VoiceCommand } from './shared/data-models'

// Phase 2 coordination only. Replace this local preview with real contracts during integration.
const ui = reactive(useMockUi())
onMounted(() => {
  void nextTick(() => {
    if (ui.historyStatus === 'loading') ui.loadHistory('ready')
  })
})
const selectedCommand = ref<VoiceCommand>('START_INPUT')
const commands: { value: VoiceCommand; label: string }[] = [
  { value: 'START_INPUT', label: '开始输入' }, { value: 'STOP_INPUT', label: '结束输入' },
  { value: 'SAVE', label: '保存' }, { value: 'CONFIRM_SAVE', label: '确认保存' },
  { value: 'MODIFY', label: '修改' }, { value: 'DELETE', label: '删除' },
  { value: 'CONFIRM_DELETE', label: '确认删除' }, { value: 'KEEP', label: '保留' },
]
const dialogTitle = computed(() => ui.dialog === 'save' ? '确认保存当前模拟草稿？' : ui.dialog === 'draft-delete' ? '确认删除当前草稿？' : ui.dialog === 'history-edit' ? '编辑模拟历史记录' : '确认删除这条模拟历史记录？')
const draftDisabled = computed(() => !ui.editable || ui.dialog !== null)
</script>

<template>
  <main class="workspace">
    <header class="page-header"><h1>工业质检语音录入系统</h1><span class="status">Phase 2 · Mock 演示</span></header>
    <p id="mock-note" class="preview-note">仅内存 Mock；不会读取或写入本地存储，不接入麦克风或下载。页面下方“Mock 测试工具”默认折叠，展开后可模拟命令与异常。</p>
    <VoicePanel :microphone="ui.microphone" :starting="ui.starting" :processing="ui.processing" :confirmed-text="ui.confirmedText" :interim-text="ui.interimText" :text-complete="ui.textComplete" @listen="ui.toggleListening" @stop="ui.stopInput" />
    <DraftPanel :draft="ui.draft" :disabled="draftDisabled" :save-disabled="!ui.historyWritable" :status="ui.processing ? '正在结构化解析' : ui.draftState" @update="ui.updateField" @save="ui.requestDraft('save')" @delete="ui.requestDraft('draft-delete')" />
    <div v-if="!ui.dialog" class="feedback" aria-live="polite">
      <p>{{ ui.message }}</p><ul v-if="ui.errors.length" role="alert"><li v-for="error in ui.errors" :key="error">{{ error }}</li></ul>
    </div>
    <HistoryPanel v-model:filters="ui.filters" :records="ui.visibleRecords" :selected-ids="ui.selectedIds" :status="ui.historyStatus" :writable="ui.historyWritable" :all-selected="ui.allSelected" :partially-selected="ui.partiallySelected" @query="ui.query" @select="ui.select" @select-all="ui.selectAll" @edit="ui.openHistory('history-edit', $event)" @delete="ui.openHistory('history-delete', $event)" @export="ui.exportRecords" />

    <details class="panel mock-panel">
      <summary id="mock-title">Mock 测试工具</summary>
      <p class="muted">正常启动、保存和首次历史初始化自动完成。可预先选择失败／结果不确定场景；解析仍通过预设控件演示。核对按钮仅在结果待核对时可用。真实算法与浏览器能力留待后续阶段。</p>
      <fieldset><legend>模拟语音和字段</legend>
        <label>模拟命令<select v-model="selectedCommand"><option v-for="command in commands" :key="command.value" :value="command.value">{{ command.label }}</option></select></label>
        <button @click="ui.command(selectedCommand)">执行模拟命令</button>
        <button :disabled="ui.microphone !== 'RECORDING'" @click="ui.transcript">发送预设实时文本</button>
        <button :disabled="!ui.processing" @click="ui.finishParse()">返回模拟解析结果</button>
        <button :disabled="ui.microphone === 'IDLE'" @click="ui.interruptSpeech">模拟识别中断</button>
        <button @click="ui.lateResult">模拟迟到结果</button>
        <button :disabled="draftDisabled" @click="ui.fillExample">填入完整示例草稿</button>
        <label><input v-model="ui.speechFailure" type="checkbox">预设启动失败</label>
        <label><input v-model="ui.parseFailure" type="checkbox">预设解析失败</label>
      </fieldset>
      <fieldset><legend>模拟保存和错误</legend>
        <label><input v-model="ui.validationFailure" type="checkbox" :disabled="ui.draftState !== 'IDLE'">预设校验失败（两项错误）</label>
        <label>模拟保存结果<select v-model="ui.saveOutcome" :disabled="ui.awaitingCheck"><option value="success">明确成功</option><option value="failure">明确失败</option><option value="uncertain">结果不确定</option></select></label>
        <label>模拟核对结果<select v-model="ui.checkOutcome"><option value="same">ID 与完整内容一致</option><option value="absent">ID 不存在</option><option value="conflict">同 ID 内容冲突</option><option value="error">读取失败</option></select></label>
        <button :disabled="!ui.awaitingCheck" @click="ui.checkSave">核对保存结果（Mock）</button>
        <label><input v-model="ui.operationFailure" type="checkbox">预设历史操作／导出失败</label>
        <label><input v-model="ui.queryFailure" type="checkbox">预设查询时间无效／歧义</label>
      </fieldset>
      <fieldset :disabled="ui.draftState !== 'IDLE' || ui.processing"><legend>模拟历史初始化（重新载入预设示例，不访问存储）</legend>
        <button @click="ui.loadHistory('loading')">模拟加载中</button><button @click="ui.loadHistory('ready')">模拟加载示例成功</button>
        <button @click="ui.loadHistory('ready', true)">模拟空历史</button><button @click="ui.loadHistory('error')">模拟读取失败</button>
      </fieldset>
      <p v-if="ui.pending" class="muted">Mock pending：{{ ui.pending.id }} · {{ ui.pending.createdAt }}（未持久化）</p>
    </details>

    <ConfirmationPreview v-if="ui.dialog" :title="dialogTitle" :cancel-text="ui.dialog === 'save' ? '修改' : ui.dialog === 'draft-delete' ? '保留' : '取消'" :confirm-text="ui.dialog === 'history-edit' ? '确认修改' : ui.dialog === 'save' ? '确认保存' : '确认删除'" @cancel="ui.cancelDialog" @confirm="ui.dialog === 'history-edit' ? ui.confirmHistory() : ui.confirmDialog()">
      <DraftPanel v-if="ui.dialog === 'history-edit'" :draft="ui.historyEditFields" prefix="history-edit" title="历史编辑副本" :show-actions="false" status="Mock" @update="ui.updateHistory" />
      <dl v-else-if="ui.dialog === 'save'" class="confirmation-values">
        <div v-for="(value, field) in ui.draft" :key="field"><dt>{{ ui.fieldLabels[field] }}</dt><dd>{{ value }}</dd></div>
      </dl>
      <p v-else-if="ui.dialog === 'draft-delete'">只清空当前草稿，不影响历史示例。</p>
      <p v-else>删除对象：{{ ui.editRecord?.workOrder }}（{{ ui.editRecord?.id }}）</p>
      <p role="status">{{ ui.message }}</p><ul v-if="ui.errors.length" role="alert"><li v-for="error in ui.errors" :key="error">{{ error }}</li></ul>
    </ConfirmationPreview>
    <footer class="page-footer">Phase 2 Mock · 刷新后重新初始化；没有真实持久化或下载</footer>
  </main>
</template>
