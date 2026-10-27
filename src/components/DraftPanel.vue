<script setup lang="ts">
import type { DraftFields } from '../shared/data-models'

withDefaults(defineProps<{ draft: Readonly<DraftFields>; disabled?: boolean; title?: string; prefix?: string; showActions?: boolean; saveDisabled?: boolean; status?: string }>(), { disabled: false, title: '当前质检草稿', prefix: 'draft', showActions: true, saveDisabled: false, status: 'IDLE' })
const emit = defineEmits<{ update: [field: keyof DraftFields, value: DraftFields[keyof DraftFields]]; save: []; delete: [] }>()
function input(field: keyof DraftFields, event: Event) {
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return
  const raw = target.value
  if (target instanceof HTMLSelectElement) {
    emit('update', 'result', raw === 'PASS' || raw === 'FAIL' ? raw : null)
  } else if (target.type === 'number') {
    emit('update', field, raw === '' ? null : target.valueAsNumber)
  } else {
    emit('update', field, raw === '' ? null : raw)
  }
}

const measurementRows = [
  { field: 'contactResistance', label: '接触电阻', displayUnit: 'mΩ' },
  { field: 'insulationResistance', label: '绝缘电阻', displayUnit: 'MΩ' },
  { field: 'withstandVoltage', label: '耐电压', displayUnit: 'V' },
] as const
</script>

<template>
  <section class="panel draft-panel" :aria-labelledby="`${prefix}-title`">
    <div class="section-heading">
      <h2 :id="`${prefix}-title`">{{ title }}</h2>
      <span class="status">{{ status }}</span>
    </div>
    <table class="draft-table">
      <caption class="sr-only">六项质检指标，单位仅为固定说明，不存入数据</caption>
      <thead><tr><th scope="col">指标名称</th><th scope="col">记录</th><th scope="col" class="unit-column">单位</th></tr></thead>
      <tbody>
        <tr>
          <th scope="row"><label :for="`${prefix}-work-order`">工单</label></th>
          <td><input :id="`${prefix}-work-order`" :value="draft.workOrder ?? ''" placeholder="未填写" @input="input('workOrder', $event)" :disabled="disabled" aria-describedby="manual-note"></td>
          <td class="unit-column">—</td>
        </tr>
        <tr>
          <th scope="row"><label :for="`${prefix}-part-number`">料号</label></th>
          <td><input :id="`${prefix}-part-number`" :value="draft.partNumber ?? ''" placeholder="未填写" @input="input('partNumber', $event)" :disabled="disabled" aria-describedby="manual-note"></td>
          <td class="unit-column">—</td>
        </tr>
        <tr v-for="row in measurementRows" :key="row.field">
          <th scope="row"><label :for="`${prefix}-${row.field}`">{{ row.label }}</label></th>
          <td><input :id="`${prefix}-${row.field}`" type="number" min="0" step="any" :value="draft[row.field] ?? ''" placeholder="未填写" @input="input(row.field, $event)" :disabled="disabled" :aria-describedby="`manual-note ${prefix}-unit-${row.field}`"></td>
          <td :id="`${prefix}-unit-${row.field}`" class="unit-column">{{ row.displayUnit }}</td>
        </tr>
        <tr>
          <th scope="row"><label :for="`${prefix}-result`">检验结果</label></th>
          <td><select :id="`${prefix}-result`" @change="input('result', $event)" :disabled="disabled" aria-describedby="manual-note">
            <option value="" :selected="draft.result === null">未选择</option>
            <option value="PASS" :selected="draft.result === 'PASS'">PASS · 合格</option>
            <option value="FAIL" :selected="draft.result === 'FAIL'">FAIL · 不合格</option>
          </select></td>
          <td class="unit-column">—</td>
        </tr>
      </tbody>
    </table>
    <div v-if="showActions" class="panel-footer draft-footer">
      <p class="muted">单位仅作说明；处理、确认或保存中冻结编辑；历史未就绪时禁止保存。</p>
      <div class="actions">
        <button type="button" class="danger" @click="emit('delete')" :disabled="disabled" aria-describedby="manual-note">删除</button>
        <button type="button" class="primary" @click="emit('save')" :disabled="disabled || saveDisabled" aria-describedby="manual-note">保存</button>
      </div>
    </div>
  </section>
</template>
