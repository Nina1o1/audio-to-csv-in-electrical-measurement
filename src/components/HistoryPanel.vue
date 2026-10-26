<script setup lang="ts">
import type { InspectionRecord } from '../shared/data-models'

defineProps<{ records: readonly InspectionRecord[] }>()

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
      <span class="status">{{ records.length }} 条静态示例 · 非本地数据</span>
    </div>
    <p class="muted">本阶段未读取本地存储。保存时间显示 createdAt，设备本地时区：{{ timeZone }}。</p>
    <div class="filters" aria-label="历史记录查询（静态预览）">
      <label>工单号<input type="search" placeholder="输入工单号" disabled aria-describedby="static-note"></label>
      <label>保存时间起点<input type="datetime-local" step="1" disabled aria-describedby="static-note"></label>
      <label>保存时间终点<input type="datetime-local" step="1" disabled aria-describedby="static-note"></label>
      <label>排序<select disabled aria-describedby="static-note"><option>保存时间降序</option><option>保存时间升序</option><option>工单号升序</option><option>工单号降序</option></select></label>
      <button type="button" disabled aria-describedby="static-note">查询</button>
    </div>
    <div class="table-scroll" role="region" aria-label="历史记录表格，可横向滚动" tabindex="0">
      <table class="history-table">
        <caption class="sr-only">静态历史记录示例，行操作未启用</caption>
        <thead><tr>
          <th scope="col"><input type="checkbox" aria-label="全选示例记录" disabled></th>
          <th scope="col">工单号</th><th scope="col">零件号</th>
          <th scope="col">接触电阻（mΩ）</th><th scope="col">绝缘电阻（MΩ）</th>
          <th scope="col">耐压（V）</th><th scope="col">检验结果</th>
          <th scope="col">保存时间</th><th scope="col">操作</th>
        </tr></thead>
        <tbody><tr v-for="record in records" :key="record.id">
          <td><input type="checkbox" :aria-label="`选择记录 ${record.workOrder}`" disabled></td>
          <td>{{ record.workOrder }}</td><td>{{ record.partNumber }}</td>
          <td>{{ record.contactResistance }}</td><td>{{ record.insulationResistance }}</td><td>{{ record.withstandVoltage }}</td>
          <td><span class="status" :class="record.result === 'PASS' ? 'pass' : 'fail'">{{ record.result === 'PASS' ? 'PASS · 合格' : 'FAIL · 不合格' }}</span></td>
          <td><time :datetime="record.createdAt">{{ dateFormatter.format(new Date(record.createdAt)) }}</time></td>
          <td><div class="actions"><button type="button" disabled aria-describedby="static-note">编辑</button><button type="button" class="danger" disabled aria-describedby="static-note">删除</button></div></td>
        </tr></tbody>
      </table>
    </div>
    <div class="export-area" aria-labelledby="export-title">
      <div><h3 id="export-title">CSV 文件导出</h3><p class="muted">已选 0 条 · 导出全部不受筛选限制 · 静态预览不会下载文件</p></div>
      <div class="actions">
        <button type="button" disabled aria-describedby="static-note">导出选中记录至 CSV</button>
        <button type="button" class="primary" disabled aria-describedby="static-note">导出全部记录至 CSV</button>
      </div>
    </div>
  </section>
</template>
