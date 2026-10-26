# Inspection Records System

技术栈：Vue 3、TypeScript strict、Vite、Vitest。

当前阶段：Phase 2 Mock UI 交互。支持草稿编辑、确认/取消、模拟监听与转写、历史编辑副本、筛选排序、当前查询全选，以及成功/失败/结果待核对场景。

所有数据仅在本次页面内存中；不接入真实 M1–M5，不访问 localStorage、麦克风或下载。正常 Mock 启动、确认后的保存和首次历史初始化会自动完成；无需点击场景结果按钮。页面下方“Mock 测试工具”默认折叠，可用鼠标或键盘展开；已移除手动返回启动/保存结果及取消模拟启动控件。首次短暂显示加载中后自动载入两条内存示例。失败与结果不确定可预先在“Mock 测试工具”中选择，解析仍通过预设控件演示。

已确认：筛选后清除不可见选择，表头全选仅作用于当前查询结果；导出全部仍不受筛选限制。刷新后重新初始化。下一阶段须经用户确认。

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

根 tsconfig 覆盖源码与测试；type-check 额外检查 Node 配置文件。npm test 执行 Mock 协调流程和 Vue 服务端渲染回归测试；浏览器实际交互、焦点和布局另外验收。

本阶段使用已有依赖，没有新增第三方包；本阶段范围与检查结果见 [Phase 2 报告](documentation/docs/phase-2-report.md)。

## 项目结构

```text
documentation/
  docs/                    已确认的模型、架构、接口和页面要求
  interfaces/              已有模块接口文档目录
src/
  App.vue                  页面组合及 Mock 协调入口
  components/              语音、草稿、历史和确认框展示组件
  mock/                    可替换的局部 Mock UI 协调及内存示例
  contracts/               公开契约声明的预留目录
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
    ui/                    Phase 1 布局回归及 Mock 协调测试
    m1-speech-recognition/
    m2-text-parser/
    m3-draft-manager/
    m4-record-manager/
    m5-csv-exporter/
  integration/             后续验证 App 调用顺序与一致性
```

Vue 仅用于页面，业务模块保持独立 TypeScript。模块之间由 App 协调；共享模型和公开方法签名不变。

规范入口：[Architecture](documentation/docs/architecture.md)、[Public Interface](documentation/docs/public-interface.md)、[Data Models](documentation/docs/data-models.md)、[页面要求](documentation/docs/page-requirements.md)。
