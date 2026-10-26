# Inspection Records System

技术栈：Vue 3、TypeScript strict、Vite、Vitest。

Phase 2 已完成：共享类型、M1–M5 接口声明、空草稿工厂、严格类型检查和 Vitest 基础配置。页面仍是 Vue 初始模板；业务模块尚未实现。

## 开发与验证

使用 Node 24.22.1（见 `.nvmrc`）；如果使用 nvm，可执行 `nvm install`、`nvm use`。现有终端若仍使用 Node 23，先切换版本，不修改项目 engines 绕过要求。

```bash
npm ci
npm run dev
```

```bash
npx vue-tsc --noEmit
npm run type-check
npm test
npm run build
```

根 tsconfig 覆盖源码与测试；type-check 额外检查 Node 配置文件。npm test 执行运行时测试，类型反向用例由 type-check 检查。

Phase 2 使用已有依赖，没有新增第三方包；完整结果见 [阶段报告](documentation/docs/phase-2-report.md)。

## 项目结构

```text
documentation/
  docs/                    已确认的模型、架构、接口和页面要求
  interfaces/              已有模块接口文档目录
src/
  app/                     App 协调逻辑和 UI 状态
  components/              Vue 展示与交互组件
  contracts/               M1–M5 TypeScript 公开契约，无业务实现
  shared/                  原共享模型与独立空草稿工厂
  modules/
    m1-speech-recognition/  语音识别
    m2-text-parser/         文本解析
    m3-draft-manager/       内存草稿与确认状态
    m4-record-manager/      正式记录和 localStorage
    m5-csv-exporter/        CSV 生成和下载
public/                    无需构建处理的静态资源
tests/
  unit/
    shared/                共享逻辑与类型约束验证
    m1-speech-recognition/
    m2-text-parser/
    m3-draft-manager/
    m4-record-manager/
    m5-csv-exporter/
  integration/             后续验证 App 调用顺序与一致性
```

Vue 仅用于页面，业务模块保持独立 TypeScript。模块之间由 App 协调；共享模型和公开方法签名不变。

规范入口：[Architecture](documentation/docs/architecture.md)、[Public Interface](documentation/docs/public-interface.md)、[Data Models](documentation/docs/data-models.md)、[页面要求](documentation/docs/page-requirements.md)。
