# M3 草稿管理

独占唯一内存草稿、确认状态和 pending record；不访问 localStorage 或调用 M4。

入口为 `createDraftManager()`，返回 `DraftManagerModule`；公开声明位于 `src/contracts/m3-draft-manager.ts`。每个实例初始化为六字段全部为 null 的独立草稿，状态为 IDLE。

仅 IDLE 允许编辑。语音稀疏合并忽略运行时 null，其他非法解析数据整批拒绝。手动 updateField 接受符合字段类型的值及 null；null 显式清空，空白字符串、负数及非有限数可暂存，完整有效性由 validate/requestSave 检查。错误字段、类型或结果枚举立即抛 TypeError，不进行隐式转换。

requestSave 校验成功后冻结草稿；confirmSave 才通过 crypto.randomUUID() 和系统 UTC 时间生成完整 pending，并进入 SAVING。明确失败后保留全部 pending；未修改重试复用 ID、内容和两个时间戳。实际编辑使旧 pending 失效，相同值、空解析及被忽略的 null 不失效。completeSave 或 confirmDelete 同时清空草稿和 pending。结果不确定时保持 SAVING，由调用方协调，不自动解冻。

非法状态及嵌套变更抛 Error，失败不部分修改。变更保护覆盖输入读取、身份生成及通知。先提交所有数据，再按草稿、状态顺序通知实际变化；每位订阅者及返回值各自收到独立快照。订阅不立即通知，取消幂等且相同回调可独立订阅；订阅集合在提交时固定，本次通知中的订阅调整在下次提交生效。回调及 console.error 异常均不能改变已完成操作的结果。

模块无额外依赖，不处理 App 的空输入转换、M4 调用、保存结果核对或界面流程。

契约测试：`npm test -- tests/unit/m3-draft-manager/draft-manager.test.ts`。
