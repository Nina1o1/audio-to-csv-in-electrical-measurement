<template>
  <section class="panel confirmation-panel" aria-labelledby="confirmation-title">
    <div class="section-heading">
      <h2 id="confirmation-title">确认弹窗布局预览</h2>
      <span class="muted">静态样式示例 · 非活动弹窗</span>
    </div>
    <div class="confirmation-previews">
      <article class="confirmation-example" aria-labelledby="save-preview-title">
        <h3 id="save-preview-title">确认保存当前草稿？</h3>
        <p>请核对六项检测字段，确认后保存为历史记录。</p>
        <div class="actions"><button type="button" disabled aria-describedby="static-note">修改</button><button type="button" class="primary" disabled aria-describedby="static-note">确认保存</button></div>
      </article>
      <article class="confirmation-example" aria-labelledby="delete-draft-preview-title">
        <h3 id="delete-draft-preview-title">确认删除当前草稿？</h3>
        <p>仅清空当前草稿，不影响已保存的历史记录。</p>
        <div class="actions"><button type="button" disabled aria-describedby="static-note">保留</button><button type="button" class="danger" disabled aria-describedby="static-note">确认删除</button></div>
      </article>
      <article class="confirmation-example" aria-labelledby="delete-history-preview-title">
        <h3 id="delete-history-preview-title">确认删除这条历史记录？</h3>
        <p>操作对象：示例工单 WO-20261026。确认后删除该记录。</p>
        <div class="actions"><button type="button" disabled aria-describedby="static-note">取消</button><button type="button" class="danger" disabled aria-describedby="static-note">确认删除记录</button></div>
      </article>
    </div>
  </section>
</template>
