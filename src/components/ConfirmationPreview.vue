<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
defineProps<{ title: string; cancelText: string; confirmText: string }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()
const element = ref<HTMLDialogElement | null>(null)
let previousFocus: HTMLElement | null = null
function keepTabFocus(event: KeyboardEvent) {
  const controls = element.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')
  const first = controls?.[0]
  const last = controls?.[controls.length - 1]
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  element.value?.showModal()
})
onUnmounted(() => {
  element.value?.close()
  void nextTick(() => {
    if (previousFocus?.isConnected && !previousFocus.matches(':disabled')) previousFocus.focus()
    else {
      const draftInput = document.getElementById('draft-work-order')
      if (draftInput && !draftInput.matches(':disabled')) draftInput.focus()
      else document.getElementById('mock-title')?.focus()
    }
  })
})
</script>

<template>
  <dialog ref="element" aria-labelledby="confirmation-title" aria-describedby="confirmation-note" @cancel.prevent="emit('cancel')" @keydown.tab="keepTabFocus">
    <h2 id="confirmation-title">{{ title }}</h2>
    <p id="confirmation-note" class="muted">Mock：仅修改内存示例，不保存到本地存储。</p>
    <slot />
    <div class="actions dialog-actions">
      <button type="button" autofocus @click="emit('cancel')">{{ cancelText }}</button>
      <button type="button" class="primary" @click="emit('confirm')">{{ confirmText }}</button>
    </div>
  </dialog>
</template>
