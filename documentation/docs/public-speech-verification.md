# 公共免口令语音改动与验证（2026-10-30）

## 交付状态

本地免口令改动和自动测试已完成，**Clone 即用尚未达成**。
服务器只读检查：m1-proxy active；仅 127.0.0.1:8787 监听；APP_ORIGIN=https://localhost:5173；
未发现 Nginx 可执行文件或 80/443 监听。维护者确认尚无域名。
没有可用的公共 HTTPS/WSS origin，因此没有伪造默认域名或将 SSH 隧道当成公共目标。
Vite 暂仍需维护者目标覆盖才能连接代理，无 .env 启动可打开页面但无法使用远程语音。
本轮未部署、未修改服务器环境/防火墙、未读取或输出讯飞密钥、未调用真实讯飞。
当前服务器仍为旧口令版本，必须同步发布新服务端才能配合新前端。

## 代码边界

M1–M5 源码、src/contracts、src/shared 均无修改；讯飞签名、音频协议、结果过滤、
语音命令和状态机不变。App 只删除认证请求、认证状态及关联 UI/提示。
旧 Cloudflare Worker 与共享 proxy-core 鉴权工具保留供回滚使用，不新增兼容认证层。
当前无登录 UI 的前端不能直接搭配旧 Worker，回滚需恢复匹配前端。

Node 只开放原有 GET /api/m1/iat 的匿名 WS 准入，原登录/退出返回 404。
路径含查询参数会拒绝；上游仍由原 upstreamUrl 固定为讯飞，不接受客户端目标。
Host/Origin/可信本机反向代理请求头校验未放宽。
Vite 允许匹配的 localhost HTTP 或可选 HTTPS 来源，仅代理 /api/m1/iat，
在检查来源后固定重写 Host/Origin；上游 TLS 校验保留，无新 CORS 放行。

保留每 IP 20 次/分钟、全局 60 次/分钟、MAX_CONNECTIONS、持久化日/月尝试额度、
90 秒启动冷却和异常占槽、10 秒上游握手、58 秒会话上限、音频速率/大小限制、
空闲/收尾超时与退出清理。仅删除失去用途的会话限流及登录限流。
匿名入口仍可能被脚本耗尽共享额度，Origin 不能抵抗脚本伪造。
额度按连接尝试计量，不等于已验证的供应商货币账单硬封顶。

## 验收结果

环境：Node 24.22.1。系统默认 Node 23.1.0 不符合项目 engines，首次运行因 node:sqlite
不可用而失败；切换到 Node 24 后执行最终检查。

| 项目 | 结果及证据边界 |
|---|---|
| 全新无 .env 安装/启动 | 将 Git 跟踪源码及本次改动复制到独立临时目录，无 .env/.certs/node_modules；npm install 成功。npm run dev 因现有 5173 占用失败；加 -- --port 5183 后启动成功，HTTP 200。并非已通过原样两命令的完整语音验收 |
| 口令 UI | SSR、真实 Vue 组件挂载测试及 Vite 编译组件检查确认无输入框、无登录/退出 |
| 阿里云公共连接 | 未验证；公共入口尚不存在，默认公共地址尚未填写 |
| “开始输入”/就绪提示 | 原自动测试通过，连接中及请开始说话提示保留；真实麦克风未测 |
| M1 → App → M2 → App → M3 | 原数据流及真实 M1 配合模拟传输测试通过；真实讯飞未测 |
| 结束/保存/删除/修改/历史/CSV | 原业务回归测试通过，模块未修改 |
| 失败与恢复 | 原连接失败与重试测试通过；改为不登录直接重试，保留旧回调隔离 |
| 匿名资源保护 | 本地真实 Node HTTP/WS + 模拟供应商验证 IP/全局速率、并发、预算、冷却、清理；SQLite 重启/进程终止额度测试通过。生产部署未测 |
| Vite 同源代理 | 真实 Vite + 本机模拟 WS 上游：无 Cookie 连接成功，固定 Host/Origin 正确，外部 Origin 被拒。无阿里云/讯飞调用 |
| TypeScript | npm run type-check 通过，覆盖前端、测试/构建配置及 Node 代理 |
| Vitest | 28 文件通过，1500 项通过，1 项原有 TODO |
| 生产/代理构建 | npm run build、npm run proxy:build 均通过 |
| 差异检查 | git diff --check 通过；M1–M5、contracts/shared、proxy-core、quota 无差异 |

测试监听本机端口需沙箱外权限，已获允许后完成。临时 Vite 服务已停止，原 5173 服务未动。
干净副本安装未更改工作区 package-lock.json，未增加依赖。

## 修改文件清单

| 文件 | 内容 |
|---|---|
| src/components/VoicePanel.vue | 删除口令输入和登录/退出专用 UI、props/events |
| src/App.vue | 删除认证绑定 |
| src/app/useManualWorkflow.ts | 删除认证请求、定时器和认证门槛 |
| src/app/useErrorPresentation.ts | 删除认证专用错误分类与展示 |
| vite.config.ts | localhost 证书可选、仅语音 WS 路径转发、删除 Cookie 诊断；公共默认目标待域名就绪 |
| infrastructure/m1-speech-proxy/dev-origin.ts | 按实际本地协议校验来源 |
| infrastructure/m1-speech-proxy/node-server.ts | 删除口令配置及 Cookie 校验、登录/退出；保留其他保护 |
| infrastructure/m1-speech-proxy/deploy/server.env.example | 删除 Node 不再使用的口令和会话密钥字段 |
| tests/integration/voice-workflow.test.ts | 删除旧认证测试，验证无登录 HTTP 即可启动 |
| tests/integration/voice-m1.test.ts | 失败后无需登录即可重试 |
| tests/integration/manual-app.test.ts | 删除旧认证 UI/Toast 测试，保留错误后手动可编辑检查 |
| tests/unit/m1-speech-recognition/node-proxy.test.ts | 匿名准入、固定路径/来源、IP/全局限流和必需凭据配置验证 |
| tests/unit/ui/static-ui.test.ts | 验证不再有口令 UI |
| .env.example | 覆盖均为维护者可选配置，明确公共目标尚未上线 |
| README.md | 当前能力、阻塞、回滚及来源隔离说明 |
| infrastructure/m1-speech-proxy/README.md | 标记旧 Worker 文档适用范围 |
| infrastructure/m1-speech-proxy/deploy/README.md | 没有域名时的配置指引、同步发布、风险及验收步骤 |
| documentation/docs/public-speech-verification.md | 本报告 |

## 余下工作

按 [部署说明](../../infrastructure/m1-speech-proxy/deploy/README.md) 完成域名/DNS、
中国内地服务器所需备案/接入、可信 TLS 与 Nginx。发布新 Node，保持原账本和额度，
APP_ORIGIN 设置为公共 HTTPS origin，等待 90 秒冷却。然后把真实 origin 写为
Vite 的默认目标并保留环境变量覆盖，再做无 .env、原样 npm install/npm run dev 的
完整验收及真实语音/网络/费用保护验证。不可用临时共享固定口令或公开 SSH 私钥替代。
