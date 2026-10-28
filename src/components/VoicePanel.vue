<script setup lang="ts">
import { ref } from 'vue'
import type { MicrophoneState } from '../shared/data-models'
defineProps<{ serviceReady?: boolean; inputActive?: boolean; microphone: MicrophoneState; starting: boolean; processing: boolean; stopping: boolean; confirmedText: string; interimText?: string; speechError: string; textComplete: boolean; authenticating: boolean; authMessage: string; canStartInput: boolean; canStopInput: boolean }>()
const emit = defineEmits<{ listen: []; start: []; stop: []; login: [password: string]; logout: [] }>()
const password = ref('')
function passwordInput(event: Event): void {
  if (event.target instanceof HTMLInputElement) password.value = event.target.value
}
function login(): void {
  const value = password.value
  password.value = ''
  emit('login', value)
}
</script>
<template>
  <section class="panel keywords-panel" aria-labelledby="keywords-title">
    <h2 id="keywords-title">语音关键词提示</h2>
    <div class="keywords-content">
      <div class="actions">
        <button type="button" :disabled="authenticating || microphone === 'RECORDING'" :aria-describedby="speechError ? 'microphone-error voice-note' : 'voice-note'" @click="emit('listen')">{{ starting ? '取消启动' : microphone === 'IDLE' ? (speechError ? '重试监听' : '开始监听') : '停止监听' }}</button>
        <span class="status" :class="{ 'status-idle': microphone === 'IDLE' }" role="status">{{ microphone === 'IDLE' ? '未在监听' : '监听中' }}</span>
      </div>
      <p v-if="speechError" id="microphone-error" role="alert" class="microphone-error">{{ speechError }}</p>
      <dl class="keywords">
        <div><dt>录入</dt><dd><strong>开始输入</strong> 开始记录语音 <span>／</span> <strong>结束输入</strong> 结束记录语音</dd></div>
        <div><dt>删除</dt><dd><strong>删除</strong> 请求删除草稿 <span>／</span> <strong>保留</strong> 保留草稿 <span>／</span> <strong>确认删除</strong> 删除草稿</dd></div>
        <div><dt>保存</dt><dd><strong>保存</strong> 请求保存草稿 <span>／</span> <strong>修改</strong> 返回修改 <span>／</span> <strong>确认保存</strong> 保存草稿</dd></div>
      </dl>
    </div>
  </section>

  <section class="panel voice-panel" aria-labelledby="voice-title">
    <div class="section-heading">
      <h2 id="voice-title">实时语音转写文本</h2>
      <div class="actions">
        <span class="status">文本状态：{{ processing ? '正在结构化解析' : textComplete ? '文本编译完成' : microphone === 'RECORDING' ? '倾听中' : '空白' }}</span>
      </div>
    </div>
    <div class="transcript" aria-label="本次实时转写文本">
      <p class="muted">已确认文本</p>
      <p v-if="confirmedText" class="transcript-final">{{ confirmedText }}</p>
      <p v-if="interimText" class="muted">临时文本（待确认）：{{ interimText }}</p>
      <p v-if="inputActive && !confirmedText && !interimText && !stopping && !processing && !speechError" class="transcript-final muted" role="status">{{ serviceReady && microphone === 'RECORDING' ? '请开始说话' : '连接中' }}</p>
      <p v-else-if="microphone === 'IDLE'" class="transcript-final muted">请先点击“<strong>开始监听</strong>”</p>
      <p v-else-if="!confirmedText && !interimText && !speechError && !stopping && !processing" class="transcript-final muted">
        <template v-if="microphone === 'LISTENING'">请说“<strong>开始输入</strong>”</template>
      </p>
      <p v-if="confirmedText && microphone === 'LISTENING' && !speechError" class="transcript-final muted">请说“<strong>开始输入</strong>”继续输入</p>
    </div>
    <div class="panel-footer">
      <p id="voice-note" class="muted">{{ microphone }} · {{ stopping ? '正在结束录入，请稍候' : '说“开始输入”后等待录入就绪再讲话；停顿后自动完成本段，也可说“结束输入”。' }} 录入中不可切换监听；仅最终确认文本用于更新草稿。</p>
    </div>
    <div class="actions voice-input-actions">
      <button type="button" :disabled="!canStartInput" aria-describedby="voice-note" @click="emit('start')">开始输入</button>
      <button type="button" :disabled="!canStopInput" aria-describedby="voice-note" @click="emit('stop')">结束输入</button>
    </div>
    <details>
      <summary>语音代理访问</summary>
      <label for="voice-password">语音访问口令（不是讯飞密钥）</label>
      <input id="voice-password" type="password" autocomplete="off" :value="password" :disabled="authenticating || microphone === 'RECORDING'" @input="passwordInput" @keydown.enter.prevent="login">
      <div class="actions">
        <button type="button" :disabled="authenticating || microphone === 'RECORDING' || !password" @click="login">登录语音代理</button>
        <button type="button" :disabled="authenticating || microphone === 'RECORDING'" @click="emit('logout')">退出语音代理</button>
      </div>
      <p role="status">{{ authenticating ? '正在连接语音代理…' : authMessage }}</p>
    </details>
  </section>
</template>
