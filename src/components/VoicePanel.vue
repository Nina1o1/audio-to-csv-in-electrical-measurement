<template>
  <section class="panel keywords-panel" aria-labelledby="keywords-title">
    <h2 id="keywords-title">语音关键词提示</h2>
    <dl class="keywords">
      <div><dt>录入</dt><dd><strong>开始输入</strong> 开始记录语音 <span>／</span> <strong>结束输入</strong> 结束记录语音</dd></div>
      <div><dt>删除</dt><dd><strong>删除</strong> 请求删除草稿 <span>／</span> <strong>保留</strong> 保留草稿 <span>／</span> <strong>确认删除</strong> 删除草稿</dd></div>
      <div><dt>保存</dt><dd><strong>保存</strong> 请求保存草稿 <span>／</span> <strong>修改</strong> 返回修改 <span>／</span> <strong>确认保存</strong> 保存草稿</dd></div>
    </dl>
  </section>

  <section class="panel voice-panel" aria-labelledby="voice-title">
    <div class="section-heading">
      <h2 id="voice-title">实时语音转写文本</h2>
      <div class="actions">
        <span class="status">文本状态：空白</span>
        <button type="button" disabled aria-describedby="static-note">开始监听</button>
      </div>
    </div>
    <div class="transcript" aria-label="本次实时转写文本">
      <p><span>已确认文本</span><span class="muted">等待本次录入内容…</span></p>
      <p><span>临时文本</span><span class="muted">暂无临时文本</span></p>
    </div>
    <div class="panel-footer">
      <p class="muted">状态：空白 → 倾听中 → 文本编译完成。倾听中不可切换监听；结束录入保留已确认文本。</p>
      <button type="button" disabled aria-describedby="static-note">结束录入</button>
    </div>
  </section>
</template>
