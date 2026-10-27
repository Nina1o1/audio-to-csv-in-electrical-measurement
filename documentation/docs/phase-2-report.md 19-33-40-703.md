# Phase 2 Mock UI 阶段报告

后续修正：正常操作已改为自动完成 Mock 结果，本文件保留初版开发记录；当前行为与复验结论见 [Phase 2 操作修正报告](phase-2-followup-report.md)。

日期：2026-10-26（Asia/Shanghai）。本阶段仅实现内存 Mock UI；未进入 Phase 3。

## 1. 本次完成内容

- 保持 Phase 1 纵向布局、固定单位、空值与浅红/浅灰配色，启用六项草稿编辑、清空、保存与删除确认。
- 增加明确标记的模拟命令/场景入口。监听启动、实时文本、录入结束、结构化处理、保存、历史初始化均可返回预设结果；处理中状态可停留供验收。
- 实时文本仅展示，最终 confirmed 文本使用固定稀疏解析示例；无中文解析器或单位换算实现。空录入仍展示完成，旧结果拒绝，不污染新草稿。
- 结构化处理、确认和保存期间冻结草稿；录入中禁止切换监听。录入中保存/删除先完成模拟解析再请求确认。
- 模拟保存成功后才追加内存记录并清空草稿；失败保留草稿和 pending；同值编辑及未修改重试保留身份，实际编辑使模拟 pending 失效。
- 结果不确定保持 SAVING，禁止历史写入；预设核对一致/不存在/冲突/读取失败分别演示成功、恢复重试或继续冻结，不访问磁盘。
- 历史支持独立编辑副本、取消、失败保留、确认删除、查询排序、行选择、全选和半选。按用户确认，全选只作用于当前查询结果，过滤后清除不可见选择，不隐式恢复。
- 选中导出使用最新内存记录；全部导出不受筛选限制。只提示模拟数量及未生成/下载文件。
- 活动确认框使用原生 dialog；补充首尾 Tab/Shift+Tab 循环、Escape 取消、关闭后的焦点恢复。

首次历史为 loading，需在页面下方点击“模拟加载示例成功”返回两条示例；这属于可控的 Mock 场景，不代表真实存储加载。

## 2. 修改文件

| 文件 | 原因 |
|---|---|
| src/App.vue | 连接局部 Mock、展示事件和场景控件 |
| src/mock/useMockUi.ts | 集中内存示例、状态展示与预设结果协调；后续可替换 |
| src/components/VoicePanel.vue | 监听/录入控件及 confirmed/interim 展示 |
| src/components/DraftPanel.vue | 可编辑字段及操作事件；复用为历史编辑；保存确认使用可换行的只读字段值 |
| src/components/HistoryPanel.vue | 查询、排序、选择、编辑删除及模拟导出事件 |
| src/components/ConfirmationPreview.vue | 保留已有文件名，改为活动原生弹窗及键盘/焦点控制 |
| src/shared/data-models.ts | 按 Data Models 补充消息、解析及既有状态/命令类型，不改已有字段 |
| src/style.css | 可操作按钮、场景控件和响应式弹窗样式 |
| tests/unit/ui/mock-ui.test.ts | 21 项 Mock 协调回归用例 |
| tests/unit/ui/static-ui.test.ts | 保留布局/空值回归；将阶段已变更的“所有控件禁用”断言改为初始历史门禁，增加冻结快照检查，共 4 项 |
| README.md、src/README.md、src/components/README.md、src/shared/README.md | 同步当前阶段与替换边界 |
| documentation/docs/page-requirements.md | 追加用户确认的 Mock 入口、筛选与全选规则，保留原有外部变更 |
| documentation/docs/phase-2-report.md | 本阶段报告及验证边界 |
| documentation/verification/phase-2/ | 四种视口截图、弹窗截图与布局实测 JSON |

开始前已有的 Phase 1 报告/验收/截图变更，以及 documentation/interfaces 下五个文件的外部删除均保留，不属于本次修改。

## 3. 契约一致性（Contract Check）

完整复核 Architecture、Data Models、Public Interface。测量始终为 number / number | null，单位仅为固定展示文本；结果不自动推导，初始不默认 PASS。未修改核心三份文档、公开签名或业务状态枚举。

Mock 使用 App 局部协调与 Vue 状态，未实现/调用真实 M1–M5，未建立跨模块调用。记录仅标记为 Mock 示例，不作为正式持久化记录。业务模块目录保持未实现。

Mock 中的基础完整性检查用于防止空值、负数或非有限数被加入示例；不是完整的 M3/M4/M5 运行时校验或错误契约。查询只提供普通本地时间的内存演示；非法/歧义时间以预设失败场景验证提示，完整转换留待集成。核对通过预设结果驱动，不代表已实现 M4 重新初始化或真实持久化校验。

原文档中旧阶段编号、DraftFields“待同步”及 contracts README 声称五份声明文件存在的说明仍为已知过时描述，本次没有自行修改这些业务设计文件。

## 4. 测试结果（Type / Test / Regression Check）

使用本机已有 Node v24.22.1：/Users/nina/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin。通过 PATH 选择运行时，没有安装或修改全局 Node。

| 实际检查 | 结果 |
|---|---|
| npm run type-check | 通过；strict 检查源码、测试和 Node 配置 |
| npm test | 通过；2 个文件、25 项测试 |
| npm run build | 通过；包括类型检查和 Vite 生产打包，非 Phase 6 部署验收 |
| git diff --check | 通过 |
| storage/语音/下载 API spy | 主要 Mock 工作流未调用 localStorage 读写/清空、SpeechRecognition 或下载对象 URL API；新实例恢复初始数据 |
| 浏览器实际交互 | 在内置浏览器的本机 Vite 页面验证，见下表 |

自动测试覆盖初始门禁、空值/零值、全部错误展示、冻结、取消隔离、失败保留、pending 复用/失效、四种核对结果、录入与解析时序、旧结果拒绝、筛选选择、编辑/删除与导出集合。没有删除既有测试来规避失败；原静态阶段断言按本阶段已授权的启用交互要求更新。

| 浏览器验收 | 结果 |
|---|---|
| 保存确认与成功 | 确认后 SAVING，模拟成功从 2 行变为 3 行，草稿清空 |
| 键盘与焦点 | Tab/Shift+Tab 在弹窗首尾循环；Escape 取消；焦点恢复到保存/编辑入口，保存中可转到结果控件 |
| 保存不确定 | 冲突时字段及历史写入持续禁用；核对不存在后保留草稿恢复编辑 |
| 历史编辑 | 失败保留输入与原行；取消不修改；成功只更新历史，草稿不变 |
| 筛选选择 | 全选两行后筛选只剩一行，选中数量同步为 1 |
| 模拟语音 | 录入中监听按钮禁用；输入 0 保持 0；结束录入后解析中冻结，结束解析后可清空数值 |
| 1366×768 / 1440×900 | 草稿底部 y=722.40，删除/保存按钮底部 y=712.40，桌面首屏完整显示；草稿输入 24px |
| 390×844 / 320×640 | 页面 scrollWidth 与 clientWidth 相同，无整页横向溢出；草稿输入 22px，历史允许内部横向滚动 |
| 小屏弹窗 | 390 视口下宽 341px、内容 clientWidth/scrollWidth 均为 339px，无内部横向溢出；保存确认使用可换行文本，避免禁用输入框截断标识符 |
| 浏览器日志 | 本次读取的 warn/error 为空 |

证据：[视口测量](../verification/phase-2/measurements.json)、[桌面布局](../verification/phase-2/1366x768.png)、[小屏布局](../verification/phase-2/390x844.png)、[桌面确认框](../verification/phase-2/confirmation-desktop.png)、[小屏确认框](../verification/phase-2/confirmation-mobile.png)。

## 5. 业务风险与验证边界

- 真实语音权限、启动 Promise、超时/续接、完整解析与校验、localStorage 一致性、真实恢复和 CSV 编码/下载尚未实现，不能据此宣称业务模块通过测试。
- 歧义时间与非法日期在本阶段通过预设错误演示；不承诺任意输入均已执行生产级日期/夏令时判断。
- 浏览器检查使用桌面应用内置浏览器，未在独立 Chrome/Edge 复验。尝试浏览器放大快捷键未改变视口或缩放指标，实际缩放/系统字体放大验收未完成，不能用小视口检查冒充。
- 草稿、pending、历史修改刷新即丢失，为明确标记的阶段行为。场景中的“重新加载示例”会重置内存历史，不访问或清空真实存储。

## 6. 复杂度评估（Complexity / Documentation Check）

没有新增依赖，没有修改 package.json、锁文件、构建配置，没有引入状态框架、后端、数据库或 PWA。Mock 集中在一个局部协调文件，组件复用已有六字段表格及原生 dialog；不建立模块工厂、事件总线或恢复框架。

README、组件/共享说明、页面补充和本报告已与实现同步。三份核心契约保持不变；上文明确记录模拟范围与真实能力的差别。

## 7. 下一阶段建议

先由用户审阅 Phase 2 页面和上述验收边界，确认后再进入 Phase 3。独立模块建议按 Architecture 的 M4 → M3 → M2 → M1 → M5 顺序逐个实现并测试；App 真实接线留在 Phase 4。本次未进入下一阶段，也未执行部署。
