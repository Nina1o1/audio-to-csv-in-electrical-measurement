# Inspection Records System

基于浏览器的工业检验记录管理系统，通过语音或手动填写唯一草稿，经校验和确认后保存至 localStorage，支持历史维护及 CSV 导出。

当前阶段：第一版接口与架构约定已整理，尚未进入实现。本文档不表示已安装依赖、实现功能或通过测试。

## 项目文档

| 文档 | 内容 |
|---|---|
| [architecture.md](docs/architecture.md) | 模块边界、所有权、流程、技术方案、测试与未决事项 |
| [public-interface.md](docs/public-interface.md) | M1–M5 完整公开声明及修订后的行为约定 |
| [data-models.md](docs/data-models.md) | user story.pages“数据模型”章节原文，未改类型 |

## 来源与确认范围

来源：用户提供的 user story.pages、public interface.pages、data-flow.md，以及 2026-10-26 用户要求“不改变 data model，按照推荐更改 public interface 和 architecture”的指示。

共享模型原样归档；公开方法签名和类型不变，行为调整见 public-interface.md。当前仓库没有复制原 Pages 文件或另外生成完整 Business Requirements、Data Flow 修订文件；原文中冲突的行为按上述两份修订文档理解。原有 OPEN QUESTION 已按“安装和实现简单”的原则确定第一版答案，见 architecture.md 第 9–10 节。data model 和公开签名不变，本轮不安装依赖或开始代码实现。
