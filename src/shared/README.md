# 共享模型与纯函数

`data-models.ts` 按 Data Models 定义当前 UI 使用的共享类型，不依赖 Vue、页面或业务模块。草稿三项测量为 number | null，正式记录为 number；没有 unit 属性。

DraftFields 从 InspectionFields 派生，不重复定义字段。Phase 1 在 App 中提供静态空草稿快照；尚未实现草稿工厂和业务更新。

运行时业务校验留到相应模块实现阶段，不把类型检查当成输入校验。
