# Vue 页面组件

Phase 1 组件：VoicePanel 展示关键词与本次转写区域；DraftPanel 展示六项草稿和固定单位；HistoryPanel 展示历史示例、查询控件和 CSV 操作区；ConfirmationPreview 展示确认框布局。组件只读 props 或静态内容，所有业务控件禁用，不实现解析、校验或持久化业务。

手动编辑仅在 M3 为 IDLE 且未进行结构化处理时开放；录入中禁用监听切换按钮。
