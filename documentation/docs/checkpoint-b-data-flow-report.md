# Checkpoint B：连续数据流集成验证报告

日期：2026-10-27。本轮自动化验证通过；真实讯飞语音测试为 NOT TESTED。

## 契约与执行范围

已阅读 architecture.md、data-models.md、public-interface.md，并核对 M1/M2/M3/M4、App 和现有测试。共享模型与 Public Interface 未修改。

- TranscriptSegment 仅包含 `text: string`。请求样例中的 segment id/createdAt 不属于已确认模型，因此未添加、伪造或测试不存在的字段。M3 生成的 InspectionRecord 才包含 id/createdAt/updatedAt。
- M4 既有保存接口为 `save(InspectionRecord)`，保持原接口，不新增 `add()`。
- 实时更新只显示，最终片段经 M1 的 onTranscriptComplete 进入 App，再调用真实 M2、M3。空片段与空解析结果同样按原对象传递。

## 三层验证

### Layer 1：Data Contract Test

`voice-m1.test.ts` 对 M1 完成事件、M2 输入／返回、M3 输入／草稿／保存返回、M4 输入使用共享类型的 expectTypeOf 断言；项目 type-check 覆盖测试。

运行时使用精确结构和值断言、对象引用 toBe、冻结 M1/M2 输出及 M3 保存返回值验证数据交接。M3 的未更新字段、记录九字段、UUID 和 UTC 时间、M4 写入内容均单独检查。在 setItem 内和 M4 返回前检查 M3 草稿未清空且 completeSave 未调用。

### Layer 2：Integration Test

新增 `tests/integration/voice-data-flow.test.ts`，16 项场景使用真实 M1、M2、M3、M4 与 App 工作流。输入来自模拟浏览器命令识别结果与模拟讯飞 WebSocket 帧，由真实 M1 生成事件，不直接调用 M2 驱动业务。

外部替身范围：浏览器 SpeechRecognition 命令引擎、captureAudio 的 PCM 数据与资源句柄、WebSocket 服务端响应、localStorage getItem/setItem 存储适配；时钟使用 Vitest 假定时器。测试没有验证真实 PCM 采集、识别准确率、网络认证或物理浏览器持久化。

`manual-app.test.ts` 另用实际 Vue SFC 与自定义渲染宿主检查 input/change/click 事件、草稿显示、历史表显示、组件重挂载与卸载。该层 M1 使用公开事件替身，M2/M3/M4/M5 使用实际实现；它不替代真实 M1 连续数据流测试。

### Layer 3：Real Speech Smoke Test

本轮未执行真实麦克风／讯飞服务调用，也未进行真实浏览器刷新及断网实验。既有文档中的历史真机反馈不作为本轮真实环境通过证据。

在同源 HTTPS 和有效语音代理会话下，使用桌面 Chrome/Edge 人工执行：

1. 开始监听，说“开始输入”，确认进入录入状态。
2. 说完整示例：“工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格”。
3. 说“结束输入”，另测按钮结束及静默自然完成；检查最终文本只处理一次、草稿六字段正确。
4. 新一段说“接触电阻改成15毫欧”，检查只有该字段变化。
5. 手动把接触电阻改为18，再说“绝缘电阻500兆欧”，检查18被保留。
6. 说“保存”并“确认保存”，检查只有一条历史记录、草稿清空。
7. 刷新同源页面，确认历史仍存在，草稿为空；另复测断网保留已确认文本及卸载释放资源。

## 核心场景和异常结果

| 场景 | 结果 | 证据 |
|---|---|---|
| Test 1 完整录入 | PASS | 指定完整文本 → 精确 ParseResult → 六字段 DraftFields；逐边界检查对象引用。 |
| Test 2 连续三段 | PASS | 按请求中的三段顺序输入，每段分别检查稀疏结果与累积草稿，最后与完整六字段相等。 |
| Test 3 语音修正 | PASS | 接触电阻12改为15，其他字段保持。 |
| Test 4 混合编辑 | PASS | 语音12 → 手动18 → 语音绝缘500；真实模块与实际组件事件两层检查18保留。 |
| Test 5 保存闭环 | PASS | 请求／确认分离；同对象交给 save；存储内容、历史快照、全新 M4 和全新 App 加载一致；另检查实际 SFC 历史表重挂载。 |
| 空文本、无关文本、部分有效 | PASS | 真实 M1 输出后经 M2/M3，既有字段保留，仅有效字段更新。 |
| 重复实时转写 | PASS | 重复相同序列的实时帧不调用 M2/M3，完成后只解析一次。 |
| M1 意外中断 | PASS | 已确认前缀落入草稿；序列缺口后的 interim 不解析，显示错误并进入 IDLE。 |
| 多次结束录入 | PASS | App 重复停止及 M1 重复 stopRecording 不重复完成；旧回调被忽略。 |
| 快速连续录入 | PASS | 不增加人工延迟连续录入12段，字段逐段更新；退休 socket 回调不污染草稿。 |
| 校验失败 | PASS | 缺五字段时返回五条错误，不生成 UUID、不调用 confirmSave/save、不写存储。 |
| 保存失败恢复 | PASS | 写入失败保留完整草稿、完整 pending，failSave 后重试复用身份和全部时间，仅保存一条记录。 |
| 重复确认 | PASS | 成功和失败重试场景均不重复创建历史。 |
| 删除后迟到结果 | PASS | 确认删除后重放旧 socket 响应，草稿不恢复。 |
| 卸载 | PASS | 五类 M1 事件取消订阅各执行一次，已排队最终片段不解析，音频释放，无残留定时器；实际 SFC 卸载另有回归。 |
| 原 M3/M4/M5 业务 | PASS | 原有校验、pending、未知结果核对、历史 CRUD、选择、CSV 编码／下载和异常回归全部通过。 |

## 最终检查表

| 检查项目 | 结果 | 说明 |
|---|---|---|
| M1 → App → M2 | PASS | 共享 TranscriptSegment `{ text }`，原对象、原文本，仅最终片段解析一次。 |
| M2 → App → M3 | PASS | 共享 ParseResult，稀疏标准数值原对象传递，草稿局部更新。 |
| M3 → App → M4 | PASS | 共享 InspectionRecord，校验／确认后生成，save 成功后才清草稿，存储重载一致。 |
| 连续多次语音输入 | PASS | 指定三段累积及12次快速录入。 |
| 语音修正 | PASS | 对应字段覆盖，其他字段保留。 |
| 手动与语音混合编辑 | PASS | 唯一草稿，手动18保留；组件事件同步显示。 |
| 保存失败恢复 | PASS | 保留草稿与 pending，未变更重试复用记录，未知结果恢复既有回归通过。 |
| TypeScript | PASS | npm run type-check；使用 vue-tsc + tsc 检查源代码、Vue、测试和构建配置。 |
| Vitest | PASS | npm run test -- --run：21文件通过，1261通过、0失败、2 TODO未执行。 |
| Build | PASS | npm run build 成功，包含类型检查与 Vite 生产构建。 |
| 真实讯飞语音测试 | NOT TESTED | 尚未执行本轮物理麦克风、真实服务、浏览器刷新和断网冒烟。 |

两个既有 TODO 为 M2 词表／相邻字段边界待定项，未删除或弱化；仍未验证，不能计为通过。

## 本轮变更与问题归属

- 新增 `tests/integration/voice-data-flow.test.ts`：16 项真实模块数据流测试，补齐连续场景和外部边界检查。
- 修改 `tests/integration/manual-app.test.ts`：新增1项实际数值编辑混合语音测试，扩展语音保存后的历史表展示、重挂载和取消订阅断言。
- 更新测试索引与 Checkpoint B 验证文档，并新增本报告。
- 本轮未发现新的业务集成缺陷，未新增业务代码修改，也未修改共享模型、Public Interface、存储格式或增加依赖。上一轮已确认的空输入／空结果完整传递与 M1 错误码校验修复作为本轮测试基线保留。
- 未验证范围：真实识别准确率、设备权限／音频与网络实际时序、代理凭据和讯飞在线响应、真实浏览器 localStorage 刷新，以及原有两个 TODO。自动化结论仅适用于上述替身范围内的模块及 Vue 集成。
