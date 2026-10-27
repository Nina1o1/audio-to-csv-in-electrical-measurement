# 集成测试

使用真实业务模块验证 App 调用顺序与数据一致性，运行 `npm run test -- --run`。

- `voice-m1.test.ts`：真实 M1–M4 的共享类型、对象引用一致性、保存顺序，自然完成／语音停止／中断／离线边界。
- `voice-data-flow.test.ts`：真实 M1–M4 的完整录入、连续累积、语音修正、手动数值覆盖、保存重载与异常场景。仅替换浏览器命令引擎、PCM 采集、WebSocket 和 localStorage 适配，不直接调用 M2 绕过事件入口。
- `voice-workflow.test.ts`：在 M1 公开事件边界使用可控替身，真实 M2/M3/M4；覆盖重复通知、非法上下文、空更新 pending 保留、启动取消和认证。
- `manual-app.test.ts`：实际 Vue SFC 事件与生命周期；语音使用 M1 事件替身，其余业务模块真实。覆盖表单数值编辑、语音保存后历史展示与重挂载、卸载订阅清理，以及历史操作和 CSV 下载。
- `manual-workflow.test.ts`：真实 M3/M4/M5 协调、失败及不确定保存恢复、历史 CRUD、筛选、选择、导出与展示异常隔离。

自动化通过不表示真实麦克风或讯飞服务通过。完整报告与人工冒烟清单见 `documentation/docs/checkpoint-b-data-flow-report.md`。
