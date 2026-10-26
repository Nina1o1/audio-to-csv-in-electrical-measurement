# 共享模型与纯函数

`data-models.ts` 定义已确认的共享类型；`create-empty-draft.ts` 创建独立的空草稿。这里不依赖 Vue、页面或业务模块。

emptyDraftFields 仅描述 DraftFields 的初始空状态，不是独立业务数据；初始化或清空时使用独立对象。MeasurementUpdate 保持现有类型，语音空更新不得清空已有字段。

Phase 2 的工厂没有外部输入。运行时业务校验在后续相应模块实现，不把类型检查当成输入校验。
