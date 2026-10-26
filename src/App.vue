<script setup lang="ts">
import VoicePanel from './components/VoicePanel.vue'
import DraftPanel from './components/DraftPanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import ConfirmationPreview from './components/ConfirmationPreview.vue'
import type { DraftFields, InspectionRecord } from './shared/data-models'

// Display snapshots only. Phase 1 does not create or call business modules.
const draft: DraftFields = {
  workOrder: null,
  partNumber: null,
  contactResistance: null,
  insulationResistance: null,
  withstandVoltage: null,
  result: null,
}

const records: InspectionRecord[] = [
  {
    id: 'demo-002',
    workOrder: 'WO-20261026',
    partNumber: 'P-007',
    contactResistance: 12.5,
    insulationResistance: 200,
    withstandVoltage: 1500,
    result: 'PASS',
    createdAt: '2026-10-26T02:30:00.000Z',
    updatedAt: '2026-10-26T02:30:00.000Z',
  },
  {
    id: 'demo-001',
    workOrder: 'WO-20261025',
    partNumber: 'P-012',
    contactResistance: 18,
    insulationResistance: 180,
    withstandVoltage: 1500,
    result: 'FAIL',
    createdAt: '2026-10-25T08:15:00.000Z',
    updatedAt: '2026-10-25T08:15:00.000Z',
  },
]
</script>

<template>
  <main class="workspace">
    <header class="page-header">
      <h1>工业质检语音录入系统</h1>
      <span class="status">Phase 1 · 静态预览</span>
    </header>
    <p id="static-note" class="preview-note">本阶段仅展示布局，输入与业务操作未启用；示例记录不会读取或写入本地存储。</p>
    <VoicePanel />
    <DraftPanel :draft="draft" />
    <HistoryPanel :records="records" />
    <ConfirmationPreview />
    <footer class="page-footer">静态 UI 预览 · 业务交互将在后续阶段实现</footer>
  </main>
</template>
