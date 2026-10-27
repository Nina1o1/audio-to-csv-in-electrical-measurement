# Inspection Records System

技术栈：Vue 3、TypeScript strict、Vite、Vitest。

Checkpoint B 已完成前端业务接线：M1 最终语音经 App → M2 → M3 更新唯一草稿，语音和手动编辑共用同一草稿；语音命令与按钮共用保存／删除确认流程。正式历史由 M4 持久化到当前来源的 localStorage，M5 导出 CSV。草稿及本次转写刷新后丢失。

## 开发与验证

使用 Node 24.22.1（见 `.nvmrc`）。

```bash
npm ci
# 全功能页面（需先配置下文的本地语音代理）
npm run dev:voice
```

```bash
npm run type-check
npm run test -- --run
npm run build
```

类型检查覆盖源码、测试及构建配置。Vitest 使用浏览器、音频、网络和下载替身，不会启动真实麦克风或调用付费讯飞服务。保留的 Phase 2 Mock 仅供测试，不连接生产 App。

## 历史写入保护与发布注意

同一浏览器来源只允许一个页面管理历史。App 在读取历史前通过 Web Locks 取得独占写入权限，
并保持到页面离开或组件卸载；其他页面可编辑草稿，但历史保存、修改、删除及导出暂不可用。
关闭占用页面后，点击“重试加载历史”，取得权限后重新读取磁盘；离开后返回的页面也需重试。
草稿在本页重试时保留，不会把旧历史缓存写回磁盘。互斥位于 App 协调层，不改变 M4 同步接口或存储格式。

正式部署须使用支持 Web Locks 的 HTTPS 浏览器；不支持或申请失败时禁用历史写入，不退回不安全写入。
该保护只能协调采用此机制的页面。首次发布此修复时，应先保存或导出所需数据并关闭旧版本页面，
再统一重新打开新版本；旧版本页面不参与互斥，不能与新版本并行写入。

语音代理登录和退出最多等待10秒，超时后可重试，手动功能不受认证失败影响。
临时转写单独展示，只将最终确认文本用于更新草稿；识别中断后仍可查看已确认文本。
Web Speech 在无VPN网络下的可用性仍需目标设备实测，当前修复不更换语音供应商。

## 真实语音运行前提

桌面 Chrome／Edge，通过 HTTPS（本地开发可使用 localhost）访问。LISTENING 使用浏览器中文语音命令识别，RECORDING 使用已有讯飞 IAT 安全代理；浏览器及语音服务可用性需要真机验证。

按 [已有代理部署说明](infrastructure/m1-speech-proxy/README.md) 配置同源 `/api/m1/*` 路由、访问口令及服务端讯飞凭据。前端构建不包含代理，不部署 Worker，不安装额外服务；Vite 默认也不会转发这些路由。仅运行 `npm run dev` 不代表已具备真实讯飞连接。

展开页面“语音代理访问”，输入共享访问口令并登录。该口令不是讯飞 APIKey／APISecret；前端提交后清空输入框，不写入 localStorage。服务端使用 HttpOnly Cookie 管理已有会话；有效会话可直接开始监听。

本地真实语音开发使用已有 Worker 同时提供完整 App 和 `/api/m1/*`，避免 Vite 5173 仅有页面、没有语音接口的问题：

```bash
# 先在 infrastructure/m1-speech-proxy/.dev.vars 配置已有服务端变量（不要提交凭据）
npm run dev:voice
# 默认使用 HTTPS 5173；先停止占用 5173 的 Vite。也可显式指定其他端口：
npm run dev:voice -- --port 8788
```

打开命令输出的 `https://localhost:5173/`（或所选端口），接受本地开发证书后，在这个页面内登录语音代理再开始监听。该命令沿用已有固定版本 Wrangler，由 npm 首次准备开发工具，不新增项目运行依赖、不部署云端服务；构建输出位于临时目录，修改代码后需重启命令重新构建。单独的 `npm run dev` 仅用于前端热更新和手动功能，不能与完整服务器同时占用 5173；如需并行，可用 `npm run dev -- --port 5174 --strictPort`。全功能测试只需打开 HTTPS 5173 一个页面。

浏览器 localStorage 按协议、主机及端口隔离：`http://localhost:5173`、`https://localhost:5173`、8787、8788 的历史互不共享，原有历史仍保留在原来源；切换测试地址前可先导出需要的记录。

点击“开始监听”，说“开始输入”。录入有权限和服务连接延迟，应先验证设备就绪再讲话；当前公开接口不提供底层音频就绪事件。实时 confirmed／interim 文本仅展示。说完后保持安静，讯飞返回活动会话最终结果时自动完成本段；也可说“结束输入”或点击“结束录入”。等待 LISTENING 后开始下一段。

录入期间可手动编辑草稿；点击保存／删除将先完成当前录入并合并最终文本，再进入原有确认流程。确认期间只能“修改”或“保留”返回编辑。保存明确失败时保留草稿及 pending 身份供重试；未知结果沿用“核对保存结果”入口。语音失败不影响手动输入和可用的本地历史功能。

完整人工验收见 [Checkpoint B 检查清单](documentation/docs/checkpoint-b-verification.md)。真实麦克风、代理登录、平台 WebSocket 和讯飞连通性尚需部署后验证。

## 项目结构

- `src/App.vue`：页面组合与事件绑定。
- `src/app/useManualWorkflow.ts`：App 协调层，串联 M1–M5；文件名沿用现有手动集成入口。
- `src/components/`：语音、草稿、历史和确认框展示组件。
- `src/contracts/`、`src/shared/`：公开接口与共享模型。
- `src/modules/`：独立 TypeScript 业务模块，不相互调用。
- `src/mock/`：独立的旧 UI 测试设施。
- `tests/integration/`：App 协调、真实模块串联和 Vue 组件事件回归。
- `infrastructure/m1-speech-proxy/`：已有安全代理；与静态前端分开部署。

规范入口：[Architecture](documentation/docs/architecture.md)、[Public Interface](documentation/docs/public-interface.md)、[Data Models](documentation/docs/data-models.md)、[页面要求](documentation/docs/page-requirements.md)。公开接口、共享模型、标准单位及存储格式保持不变，没有新增依赖。
