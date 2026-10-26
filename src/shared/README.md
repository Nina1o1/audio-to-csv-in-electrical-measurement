# 共享模型

`data-models.ts` 按 Data Models 定义共享类型，不依赖 Vue、页面或业务模块。草稿三项测量为 number | null，记录为 number；没有 unit 属性。DraftFields 从 InspectionFields 派生，不重复定义字段。

Phase 2 补齐 UI 需要的 TranscriptSegment、ParseResult、MicrophoneState、DraftState、VoiceCommand，逐项沿用文档定义。局部 Mock 空草稿和示例放在 src/mock，不作为正式业务实现或持久化数据。

完整运行时业务校验及公开模块接口实现留到后续阶段，不把类型检查或 Mock 基础输入检查当成完整业务校验。
