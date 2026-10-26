<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
withDefaults(defineProps<{ title: string; cancelText: string; confirmText: string; description?: string; disabled?: boolean }>(), {
  description: '请核对当前草稿后确认；选择取消选项可保留草稿。', disabled: false,
})
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
      else document.getElementById('manual-note')?.focus()
    }
  })
})
</script>

<template>
  <dialog ref="element" aria-labelledby="confirmation-title" aria-describedby="confirmation-note" @cancel.prevent="emit('cancel')" @keydown.tab="keepTabFocus">
    <h2 id="confirmation-title">{{ title }}</h2>
    <p id="confirmation-note" class="muted">{{ description }}</p>
    <slot />
    <div class="actions dialog-actions">
      <button type="button" autofocus :disabled="disabled" @click="emit('cancel')">{{ cancelText }}</button>
      <button type="button" class="primary" :disabled="disabled" @click="emit('confirm')">{{ confirmText }}</button>
    </div>
  </dialog>
</template>
