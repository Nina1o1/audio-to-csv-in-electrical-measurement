<script setup lang="ts">
import type { InspectionRecord } from '../shared/data-models'

defineProps<{ records: readonly InspectionRecord[]; selectedIds: readonly string[]; status: 'loading' | 'ready' | 'error'; writable: boolean; allSelected: boolean; partiallySelected: boolean }>()
const filters = defineModel<{ workOrder: string; createdFrom: string; createdTo: string; sort: string }>('filters', { required: true })
const emit = defineEmits<{ query: []; select: [id: string]; selectAll: []; edit: [id: string]; delete: [id: string]; export: [all: boolean] }>()

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
</script>

<template>
  <section class="panel history-panel" aria-labelledby="history-title">
    <div class="section-heading">
      <h2 id="history-title">历史记录</h2>
      <span class="status">{{ records.length }} 条 Mock 示例 · 非本地数据</span>
    </div>
    <p id="history-note" class="muted">仅就绪时可查询和导出；仅就绪且未保存时可编辑、删除。本阶段未读取本地存储。保存时间显示 createdAt，设备本地时区：{{ timeZone }}。</p>
    <div class="filters" aria-label="历史记录查询（Mock）">
      <label>工单号<input type="search" v-model="filters.workOrder" placeholder="输入工单号" :disabled="status !== 'ready'" aria-describedby="history-note"></label>
      <label>保存时间起点<input v-model="filters.createdFrom" type="datetime-local" step="1" :disabled="status !== 'ready'"></label>
      <label>保存时间终点<input v-model="filters.createdTo" type="datetime-local" step="1" :disabled="status !== 'ready'"></label>
      <label>排序<select v-model="filters.sort" :disabled="status !== 'ready'"><option value="createdAt:desc">保存时间降序</option><option value="createdAt:asc">保存时间升序</option><option value="workOrder:asc">工单号升序</option><option value="workOrder:desc">工单号降序</option></select></label>
      <button type="button" :disabled="status !== 'ready'" @click="emit('query')">查询</button>
    </div>
    <p v-if="status === 'loading'" role="status">Mock：加载中，请在模拟场景区返回加载结果。</p>
    <p v-else-if="status === 'error'" role="alert">Mock：读取错误，历史写入已禁用，未清空本地存储。</p>
    <p v-else-if="!records.length">Mock：当前查询无记录。</p>
    <div class="table-scroll" role="region" aria-label="历史记录表格，可横向滚动" tabindex="0">
      <table class="history-table">
        <caption class="sr-only">Mock 历史记录，仅内存操作</caption>
        <thead><tr>
          <th scope="col"><input type="checkbox" aria-label="全选当前查询结果" :checked="allSelected" :indeterminate="partiallySelected" :disabled="!records.length" @change="emit('selectAll')"></th>
          <th scope="col">工单号</th><th scope="col">零件号</th>
          <th scope="col">接触电阻（mΩ）</th><th scope="col">绝缘电阻（MΩ）</th>
          <th scope="col">耐压（V）</th><th scope="col">检验结果</th>
          <th scope="col">保存时间</th><th scope="col">操作</th>
        </tr></thead>
        <tbody><tr v-for="record in records" :key="record.id">
          <td><input type="checkbox" :aria-label="`选择记录 ${record.workOrder}`" :checked="selectedIds.includes(record.id)" @change="emit('select', record.id)"></td>
          <td>{{ record.workOrder }}</td><td>{{ record.partNumber }}</td>
          <td>{{ record.contactResistance }}</td><td>{{ record.insulationResistance }}</td><td>{{ record.withstandVoltage }}</td>
          <td><span class="status" :class="record.result === 'PASS' ? 'pass' : 'fail'">{{ record.result === 'PASS' ? 'PASS · 合格' : 'FAIL · 不合格' }}</span></td>
          <td><time :datetime="record.createdAt">{{ dateFormatter.format(new Date(record.createdAt)) }}</time></td>
          <td><div class="actions"><button type="button" :disabled="!writable" aria-describedby="history-note" @click="emit('edit', record.id)">编辑</button><button type="button" class="danger" :disabled="!writable" aria-describedby="history-note" @click="emit('delete', record.id)">删除</button></div></td>
        </tr></tbody>
      </table>
    </div>
    <div class="export-area" aria-labelledby="export-title">
      <div><h3 id="export-title">CSV 文件导出</h3><p class="muted">已选 {{ selectedIds.length }} 条 · 全选仅当前查询结果，筛选后清除不可见选择 · 导出全部不受筛选限制 · Mock 不下载文件</p></div>
      <div class="actions">
        <button type="button" :disabled="status !== 'ready' || !selectedIds.length" aria-describedby="history-note" @click="emit('export', false)">导出选中记录至 CSV</button>
        <button type="button" class="primary" :disabled="status !== 'ready'" aria-describedby="history-note" @click="emit('export', true)">导出全部记录至 CSV</button>
      </div>
    </div>
  </section>
</template>
