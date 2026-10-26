# 源码目录

Phase 2：App 组合展示组件，并使用 mock/useMockUi.ts 中每次调用独立创建的局部 UI 状态。Mock 仅演示交互，不实现或调用真实 M1–M5；不访问 localStorage、麦克风、网络服务或下载 API。

shared/data-models.ts 复用 Data Models 的模型和既有状态。components 只接收展示数据并发出操作事件；真实公开接口声明及独立业务模块留待后续阶段。

后续集成时替换 App 的 Mock 协调入口及预设场景控件，展示组件可以继续使用。源码、测试及构建配置均接受 strict 类型检查。
