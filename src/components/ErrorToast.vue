<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ notification: { id: number; messages: readonly string[] } | null }>()
const visible = ref(false)
const element = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.notification, (notification) => {
  clearTimeout(timer)
  visible.value = notification !== null
  if (notification) timer = setTimeout(() => { visible.value = false }, 3000)
}, { immediate: true })

watch([visible, () => props.notification, element], () => {
  // Native modal dialogs occupy the top layer; a manual popover keeps errors above them
  // without taking focus or making the rest of the page inert.
  if (visible.value) {
    element.value?.hidePopover?.()
    element.value?.showPopover?.()
  }
}, { flush: 'post' })

onUnmounted(() => { clearTimeout(timer) })
</script>

<template>
  <div v-if="visible" ref="element" class="error-toast" popover="manual" role="alert" aria-atomic="true">
    <p v-for="(message, index) in notification?.messages" :key="index">{{ message }}</p>
  </div>
</template>

<style scoped>
.error-toast {
  position: fixed;
  inset: max(12px, env(safe-area-inset-top)) auto auto 50%;
  transform: translateX(-50%);
  z-index: 10000;
  margin: 0;
  width: max-content;
  max-width: min(560px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: hidden;
  padding: 10px 16px;
  border: 1px solid #c7aaa3;
  border-radius: 3px;
  background: #fff9f7;
  color: #945347;
  box-shadow: 0 4px 16px rgb(35 55 48 / 12%);
  font: inherit;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: pre-line;
  pointer-events: none;
}
.error-toast::backdrop { pointer-events: none; background: transparent; }
</style>
