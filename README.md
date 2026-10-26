# Inspection Records System

技术栈：Vue 3、TypeScript strict、Vite、Vitest。

当前按最新阶段顺序推进 Phase 1 静态 UI：关键词、实时转写、六项草稿、历史示例和 CSV 操作区纵向排列，附确认弹窗布局预览。所有业务控件禁用；没有语音、解析、存储或下载调用。后续阶段须经用户确认再开始。

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

根 tsconfig 覆盖源码与测试；type-check 额外检查 Node 配置文件。npm test 执行 Vue 服务端渲染测试，检查静态结构、空值展示和控件禁用，不等同浏览器视觉验收。

本阶段使用已有依赖，没有新增第三方包；检查结果及已知文档不同步项见 [Phase 1 报告](documentation/docs/phase-1-report.md)。

## 项目结构

```text
documentation/
  docs/                    已确认的模型、架构、接口和页面要求
  interfaces/              已有模块接口文档目录
src/
  App.vue                  静态展示快照和页面组合
  components/              语音、草稿、历史和确认框展示组件
  contracts/               公开契约实现的预留目录
  shared/                  UI 使用的共享数据模型
  modules/
    m1-speech-recognition/  语音识别
    m2-text-parser/         文本解析
    m3-draft-manager/       内存草稿与确认状态
    m4-record-manager/      正式记录和 localStorage
    m5-csv-exporter/        CSV 生成和下载
public/                    无需构建处理的静态资源
tests/
  unit/
    shared/                共享逻辑测试预留目录
    ui/                    Phase 1 静态渲染测试
    m1-speech-recognition/
    m2-text-parser/
    m3-draft-manager/
    m4-record-manager/
    m5-csv-exporter/
  integration/             后续验证 App 调用顺序与一致性
```

Vue 仅用于页面，业务模块保持独立 TypeScript。模块之间由 App 协调；共享模型和公开方法签名不变。

规范入口：[Architecture](documentation/docs/architecture.md)、[Public Interface](documentation/docs/public-interface.md)、[Data Models](documentation/docs/data-models.md)、[页面要求](documentation/docs/page-requirements.md)。
