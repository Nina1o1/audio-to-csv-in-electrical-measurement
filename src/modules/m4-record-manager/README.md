# M4 正式记录管理

独占正式记录集合及其 localStorage，负责初始化、查询和 CRUD；先持久化成功，再提交内存。

入口为 `createRecordManager()`，返回 `RecordManagerModule`。创建后先调用 `initialize()`；创建实例本身不访问存储。业务类型从 shared/data-models 复用，公开声明见 contracts/m4-record-manager。

固定 key 为 `inspection-records`，保存九字段 `InspectionRecord[]` 的 JSON。不自动读取、迁移或删除其他 key。初始化失败保持禁写，原始数据不变；成功后重复初始化返回内存快照，新实例才重新读盘。

所有实际写操作先构造并校验完整新集合，序列化、写入成功后才提交内存并通知。返回值和每位订阅者的快照均隔离引用；通知异常单独报告，通知中的嵌套写入抛 INVALID_DATA，只读查询允许执行。

写入重入保护覆盖输入读取、校验、提交和通知全过程，避免带副作用的输入 getter 导致旧快照覆盖新数据；失败及无变化返回也会释放保护。首次保存新 ID 要求 createdAt 与 updatedAt 相同；已有历史记录允许修改时间晚于创建时间，仍支持完整字段相同的幂等保存。

M4 不生成 ID、不重写新记录时间、不依赖 Vue，不调用其他业务模块。App 的协调和核对流程不在本模块实现。多实例不自动同步，使用新的实例重新读取仅供调用方按契约协调。

契约测试：`npm test -- tests/unit/m4-record-manager/record-manager.test.ts`。
