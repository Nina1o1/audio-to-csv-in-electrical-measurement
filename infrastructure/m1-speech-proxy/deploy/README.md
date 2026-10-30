# 阿里云轻量服务器部署与验收

目标：大陆 2vCPU/1GiB 单实例，Nginx + systemd + 单 Node 进程。保留共享口令和同源 Cookie。
这里的文件是模板，尚未部署。完成域名备案/阿里云接入和可信 TLS 证书后才上线。
不运行 cluster、双实例、容器副本或新旧版本并行接入。同一账本的 SQLite 独占锁阻止第二进程；
复制账本到另一个路径会绕过该锁，因此 QUOTA_DB 路径必须固定且不可随版本改变。

## 构建和安装

使用项目 .nvmrc 指定的 Node 版本（24.22.1）。构建在开发机/CI 完成：

```sh
npm ci
npm run type-check
npm test
npm run build
npm run proxy:build
```

发布根目录结构必须保留：package.json、package-lock.json、dist/（网页）、
infrastructure/m1-speech-proxy/dist/（已编译服务端）。TypeScript bundler 解析只用于编译；
服务端所有保留至运行时的相对导入都有 .js 后缀，业务 type-only 导入会被擦除。
目标 Linux 上执行 npm ci --omit=dev 安装生产依赖。额度使用 Node.js 24 自带的 node:sqlite（DatabaseSync），不依赖外部 SQLite 原生扩展。
锁定并验证 Node 版本；不要把 macOS 的 node_modules 复制到 Linux。
部分 Node 版本可能显示 SQLite API 状态提示，仍需在升级 Node 时回归事务及锁测试。
服务器不运行 Vite、Vitest 或前端构建。按实际安装路径修改 service 的 ExecStart。

## 配置与首次初始化

创建专用无登录系统用户 m1，/opt/m1-proxy 保存发布文件；
/var/lib/m1-proxy 由 m1 独占写入（0700），数据库位于此目录，不在静态网站目录中。
将 server.env.example 填写到 /etc/m1-proxy.env，root 管理、权限 0600，由 systemd 注入。
不要在命令行参数、VITE_*、仓库、日志或 URL 写入密钥。

MAX_CONNECTIONS、DAILY_ATTEMPTS、MONTHLY_ATTEMPTS 必须显式设置正整数；未配置拒绝启动。
并发含握手/活动/关闭/异常隔离，长录音每用户可能需要两条重叠连接。不得超出讯飞实际权益。
预算单位为上游连接尝试数，不是元；用实际账号计费规则换算，预连接和不确定失败也保守扣减。
没有设置或验证供应商强制配额，不能宣称供应商账单绝对封顶。

首次初始化必须在服务未运行时，以 m1 身份加载相同服务端环境后执行：

```sh
npm run proxy:init-quota
```

生产环境变量文件使用 systemd EnvironmentFile 格式；不要把它作为任意 shell 脚本 source。
可用临时 systemd 单元以相同 User/EnvironmentFile/WorkingDirectory 执行上述命令。
初始化拒绝覆盖已有数据库。正常启动绝不自动创建缺失账本；不允许用重新初始化恢复额度。
账本损坏、丢失、恢复旧快照时必须核对供应商用量/保守扣除，不能自动恢复收费入口。

安装 m1-proxy.service，配置 Nginx 模板中的域名、静态目录和证书路径，检查 nginx -t 后启用。
防火墙仅开放必要的 SSH（限制管理来源）、80、443；8787 仅 loopback，不能通过其他代理公开。
Node 只信任本机 Nginx 重写的 Host、X-Real-IP、X-Forwarded-Proto；Origin 保持浏览器原值并严格校验。
若 Nginx 前另有 CDN，先设计可信代理链；不要直接把任意客户端 X-Forwarded-For 当作真实 IP。

## 额度与生命周期

SQLite FULL 同步、事务内同时检查日/月额度并扣减，提交后才拨号。周期按 Asia/Shanghai，
无需定时清零；检测到日期回退拒绝准入，历史月份不删除。服务端预算只约束此入口。
登录 10 次/分钟（IP 与总量），连接 20 次/分钟（IP 与会话），总连接 60 次/分钟。
固定窗口精确于单进程，窗口边界可能突发；key 容量受限，过期清理，满时拒绝。

正常上游关闭码 1000 后释放槽位；异常关闭保守占槽至拨号开始后 90 秒。
每次启动均冷却 90 秒，包含普通重启，防止上个进程遗留上游连接导致短暂超并发。
依据讯飞文档会话最长 60 秒/超过 10 秒不发数据主动断开，90 秒包含握手和安全余量，仍需真机验证。
原代理 58 秒生命周期、10 秒无音频、5 秒收尾不变。关闭握手最多等 2 秒后 terminate。
收到 SIGTERM 停止新增请求，现存录入按原规则排空，70 秒后强制结束传输；systemd 最终上限 100 秒。
本机 GET /healthz 仅表示启动冷却结束且未停止，既不消耗讯飞额度，也不是供应商连通性证明。

不要在生产机上打包或跑测试。上线前观察空闲和负载 RSS、可用内存、磁盘及日志增长，
再决定 systemd MemoryHigh/MemoryMax；V8 堆限制不代表 RSS 限制。日志定额/轮转，备份包含 SQLite
完整一致状态；保留备份不等于允许恢复旧额度。1GiB 下不能承诺未压测的并发容量。

## 本地开发

普通前端仍 npm run dev，无远程配置不启用语音代理。完整语音：

1. 先部署独立开发代理，独立密钥/预算；APP_ORIGIN 为其 HTTPS 域名。
2. 准备本机信任的 localhost 证书，含 localhost SAN；私钥仅放 .certs/。
3. 按根目录 .env.example 填写未提交的 .env.local。
4. npm run dev，打开 https://localhost:5173，按原 UI 输入开发访问口令。

Vite 转发全部 /api/m1/*（包含登录/退出及 WS），校验本地 Origin 后固定改写至开发域名。
TLS 上游证书验证保持开启。Cookie 保留 __Host-、Secure、HttpOnly、SameSite=Strict，
由浏览器按 localhost 响应来源存储，不放宽生产认证。不使用开发代理访问生产预算。
本地 HTTPS 与旧 HTTP origin 的 localStorage 不共享，不自动迁移记录。
原 npm run dev:voice 和 Wrangler 验收脚本保持可用。

## 验收与回滚

自动测试使用本地模拟供应商，不代表真实讯飞或阿里云已验证。
必须人工验证：登录/Cookie、真实转写、持续有声 70–120 秒轮换、主动结束、浏览器断开、
多用户轮换、预算耗尽不拨号、进程 SIGKILL 后额度保留/冷却、磁盘异常、TLS/证书更新、
中国电信/移动/联通网络及命令监听（Web Speech API 是另一条网络路径）。

发布前保留 CF Worker/配置、旧前端产物与现有 origin。先关闭旧入口准入/排空再切换，
回滚时先关闭 Node 收费入口，再恢复 CF 路由。CF 当前没有严格持久化预算，不能同时开放
两边入口并宣称共享预算；须使用单独保守额度/经验证的供应商硬配额。保持前端 origin
以保留 localStorage。若使用讯飞 IP 白名单，回滚前也必须验证 CF 出口是否允许。

本轮不提供真实凭据、不创建云资源、不调用供应商，不将任何 Mock 结果当作真实网络验收。

## 无域名 SSH 测试

仅本机测试可先不安装 Nginx，通过 SSH 将本机 127.0.0.1:18787 转发到服务器
127.0.0.1:8787。服务器 APP_ORIGIN=https://localhost:5173。Vite 设置
M1_DEV_PROXY_TARGET=http://127.0.0.1:18787、M1_DEV_PROXY_ORIGIN=https://localhost:5173，
仍需可信 localhost HTTPS 证书。只有数字 loopback 允许 HTTP 目标，公网 HTTP 禁止。
Vite 先检查浏览器本地 Origin，再设置固定 Host/Origin 与隧道 IP。公网只需 SSH，
不要开放 8787。正式域名部署仍使用上面的 HTTPS/Nginx 方案。
configure-server.sh 只在服务器交互输入凭据，勿在聊天或命令参数中提供。

配置 M1_DEV_SSH_HOST、M1_DEV_SSH_IDENTITY、M1_DEV_SSH_KNOWN_HOSTS 后，
npm run dev 会管理并在断线后重连 SSH 隧道，退出/重启 Vite 时清理其子进程。
known-hosts 必须先经控制台指纹核对；不会关闭 SSH 主机校验或 TLS 校验。
不要再同时运行占用相同本地端口的手动隧道。若未配置 SSH 选项，仍支持外部手动隧道。
