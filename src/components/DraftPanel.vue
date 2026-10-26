<script setup lang="ts">
import type { DraftFields } from '../shared/data-models'

defineProps<{ draft: Readonly<DraftFields> }>()

const measurementRows = [
  { field: 'contactResistance', label: '接触电阻', displayUnit: 'mΩ' },
  { field: 'insulationResistance', label: '绝缘电阻', displayUnit: 'MΩ' },
  { field: 'withstandVoltage', label: '耐压', displayUnit: 'V' },
] as const
</script>

<template>
  <section class="panel draft-panel" aria-labelledby="draft-title">
    <div class="section-heading">
      <h2 id="draft-title">当前质检草稿</h2>
      <span class="status">待填写 · 静态展示</span>
    </div>
    <table class="draft-table">
      <caption class="sr-only">六项质检指标，单位仅为固定说明，不存入数据</caption>
      <thead><tr><th scope="col">指标名称</th><th scope="col">记录</th><th scope="col" class="unit-column">单位</th></tr></thead>
      <tbody>
        <tr>
          <th scope="row"><label for="draft-work-order">工单号</label></th>
          <td><input id="draft-work-order" :value="draft.workOrder ?? ''" placeholder="请输入工单号" disabled aria-describedby="static-note"></td>
          <td class="unit-column">—</td>
        </tr>
        <tr>
          <th scope="row"><label for="draft-part-number">零件号</label></th>
          <td><input id="draft-part-number" :value="draft.partNumber ?? ''" placeholder="请输入零件号" disabled aria-describedby="static-note"></td>
          <td class="unit-column">—</td>
        </tr>
        <tr v-for="row in measurementRows" :key="row.field">
          <th scope="row"><label :for="`draft-${row.field}`">{{ row.label }}</label></th>
          <td><input :id="`draft-${row.field}`" type="number" min="0" step="any" :value="draft[row.field] ?? ''" placeholder="未填写" disabled :aria-describedby="`static-note unit-${row.field}`"></td>
          <td :id="`unit-${row.field}`" class="unit-column">{{ row.displayUnit }}</td>
        </tr>
        <tr>
          <th scope="row"><label for="draft-result">检验结果</label></th>
          <td><select id="draft-result" disabled aria-describedby="static-note">
            <option value="" :selected="draft.result === null">未选择</option>
            <option value="PASS" :selected="draft.result === 'PASS'">PASS · 合格</option>
            <option value="FAIL" :selected="draft.result === 'FAIL'">FAIL · 不合格</option>
          </select></td>
          <td class="unit-column">—</td>
        </tr>
      </tbody>
    </table>
    <div class="panel-footer draft-footer">
      <p class="muted">单位为固定说明；结构化处理、确认和保存期间不可编辑。</p>
      <div class="actions">
        <button type="button" class="danger" disabled aria-describedby="static-note">删除</button>
        <button type="button" class="primary" disabled aria-describedby="static-note">保存</button>
      </div>
    </div>
  </section>
</template>
