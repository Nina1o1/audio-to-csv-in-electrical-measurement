# Phase 2：项目基础结构

日期：2026-10-26。该阶段完成后停止，等待确认再进入 Phase 3。

## 已完成

| 文件 | 作用 |
|---|---|
| src/shared/data-models.ts | 从已确认模型提取类型，字段、单位、空值及状态定义不变 |
| src/shared/create-empty-draft.ts | 每次创建新的初始草稿，不导出共享可变单例 |
| src/contracts/m1-speech-recognition.ts … m5-csv-exporter.ts | 原公开声明，统一引用共享类型，不实现业务方法 |
| tsconfig.json、tsconfig.app.json、tsconfig.node.json | 显式 strict，根检查覆盖源码与测试，Node 配置单独检查 |
| vitest.config.ts | Node 环境、测试匹配、路径别名及 Mock 清理 |
| package.json | 添加 test、test:watch，更新 type-check；build 保留类型检查 |
| env.d.ts、.nvmrc | Vite 环境声明、验证使用的 Node 版本 |
| tests/unit/shared/create-empty-draft.test.ts | 初始空值和嵌套引用隔离测试 |
| tests/unit/shared/contracts.typecheck.ts | 正反向类型用例，覆盖 M1–M5 的模型传递及关键参数约束 |
| README、目录说明、页面需求、架构 | 更新开发命令、阶段状态和最新布局要求 |

## 内部设计

- shared 和 contracts 都不依赖 Vue。公共类型只有一个定义来源。
- emptyDraftFields 是初始状态说明；createEmptyDraft 无外部输入、无内部可变状态、每次返回全新的对象。
- MeasurementUpdate 保留原 datatype。null 的语音业务处理由后续 M3 实现。
- 未改变公开签名，也未增加业务状态机或第三方依赖。
- 根 tsconfig 不再是无文件的空项目：直接运行 vue-tsc --noEmit 会检查源码和测试。type-check 还检查 vite/vitest 等 Node 配置。

## 实际验证结果

验证使用本机已有 Node v24.22.1；未更改系统默认 Node，默认终端当时仍为 v23.1.0。现有 npm 为 10.9.0。

| 验证 | 结果 |
|---|---|
| npx --no-install vue-tsc --noEmit | 通过；等价于所要求命令，但禁止 npx 自动下载 |
| npm run type-check | 通过，包含源码、测试和配置 |
| npm test | 1 个测试文件，4 个测试全部通过 |
| npm run build | 通过，生成 dist；构建期间也运行 type-check |
| 文档与 TypeScript 声明比对 | 共享类型和五个模块声明一致，仅添加 export 和共享类型 import |
| package.json 与锁文件 | dependencies、devDependencies、engines 一致，无依赖变更 |
| git diff --check | 通过 |

4 个运行时测试覆盖：六字段及单位初始为空、不预设 PASS；不同草稿的嵌套对象隔离；修改后重新创建仍为空且不破坏旧草稿；同一草稿三项测量互不影响。

类型用例覆盖合法稀疏/空更新、单位约束、数值类型、结果枚举、历史测量完整性、禁止修改 ID、排序字段限制、正式记录不可含空测量、CSV 只接收正式记录并接受 readonly 数组。类型用例属于编译验证，不计入 4 个运行时测试。

## Code Review 与限制

当前基础层未发现阻塞性问题；没有使用 any，也没有让组件直接管理业务数据。原 Data Models 文档和公开签名未修改。

本阶段没有真实语音、解析、保存、查询或导出实现，没有 Mock 冒充真实功能；运行时外部输入校验、组件测试、浏览器验证在对应阶段完成。生产构建目前打包的是已有 Vue 初始模板，不代表页面已完成。

首屏设计已记录：四块纵向叠放、浅色填充分区、无板块分隔线；关键词、转写、草稿在桌面首屏，草稿面积和文字更大。Phase 3 再按约定视口进行实际布局验证。
