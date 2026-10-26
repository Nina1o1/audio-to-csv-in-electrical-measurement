# Inspection Records System

技术栈：Vue 3、TypeScript strict、Vite、Vitest。

当前仅为目录骨架和职责说明。技术栈由用户手动安装；本轮不添加源码、依赖、配置、锁文件或测试实现，也不修改既有文档和代码。

## 项目结构

```text
inspection-records/
  docs/                    已确认的模型、架构、接口和页面要求
  interfaces/              已有模块接口文档目录
src/
  app/                     App 协调逻辑和 UI 状态
  components/              Vue 展示与交互组件
  contracts/               后续放置 M1–M5 TypeScript 公开契约
  shared/                  后续放置原共享模型及必要的纯函数
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

Vue 仅用于页面，业务模块保持独立 TypeScript。模块之间由 App 协调；共享模型和公开方法签名不变。目录中的 README 仅作注释，不是实现文件。

规范入口：[Architecture](inspection-records/docs/architecture.md)、[Public Interface](inspection-records/docs/public-interface.md)、[Data Models](inspection-records/docs/data-models.md)、[页面要求](inspection-records/docs/page-requirements.md)。
