# M1专属IAT代理

这是可部署的Cloudflare Workers实现，使用平台原生WebSocket与Web Crypto，不新增运行依赖。
本次未安装Wrangler、未部署、未设置真实凭据、未调用讯飞。它是已批准的密钥安全组件，
不增加业务数据库、用户注册或记录API；音频经过代理转发，默认不落盘、不记录正文或凭据。

## 路由与访问

将Worker路由仅绑定现有HTTPS网站的 `/api/m1/*`，静态页面继续由原托管提供。
`APP_ORIGIN`必须等于该网站的完整origin（无尾斜线）。不要把整个域名所有路径路由到此Worker。
保持现有网站origin以保留localStorage数据。配置文件的example域名须在部署前替换，不能直接使用。

- `POST /api/m1/login`：同源JSON `{ "password": "用户输入的访问口令" }`。
  服务端验证后返回204和8小时HttpOnly/Secure/SameSite=Strict Cookie。不是讯飞密钥。
- `POST /api/m1/logout`：清除该浏览器Cookie。
- `GET /api/m1/iat`：仅允许有有效Cookie、正确Origin的WebSocket升级，不接受查询参数。
  浏览器不接触讯飞APIKey、APISecret或签名URL。

本次不增加登录页面；后续App集成时由独立语音入口进行登录。直接连代理而没有登录会失败，
不会退回前端密钥或匿名连接。不要通过跨域CORS开放来绕过认证。

## 服务端配置

通过平台Secrets或Wrangler安全交互设置，禁止VITE_变量、源码、URL、日志或前端localStorage：

| 名称 | 含义 |
|---|---|
| `IAT_APP_ID` | 已开通语音听写流式版的应用ID |
| `IAT_API_KEY` | 对应IAT APIKey |
| `IAT_API_SECRET` | 对应IAT APISecret |
| `ACCESS_PASSWORD` | 由密码管理器生成的高熵共享访问口令，至少20字符 |
| `SESSION_SECRET` | 独立高熵会话签名密钥，至少32字符 |
| `APP_ORIGIN` | 非敏感部署变量，实际HTTPS网站origin |

若已有部署工具，可在此目录运行 `wrangler secret put IAT_API_SECRET` 等交互命令设置Secrets；
不要在命令行参数直接写密钥。使用支持ratelimits绑定的当前Wrangler版本。
部署前添加自己域名的路由并检查账号套餐。无需向前端提供任何讯飞环境变量；默认路径已匹配模块。

`wrangler.jsonc` 提供LOGIN_LIMIT、CONNECT_LIMIT、TOTAL_LIMIT三个绑定配置；namespace_id应选
自己账号中未被其他应用占用的正整数。缺少绑定或必要Secrets时503，不退回实例内存限流。
默认登录10次/分钟；连接按Cookie会话与出口IP分别20次/分钟；总连接key 60次/分钟，
均可按实际小组规模调整。多人共用出口IP时须评估默认值，正常自然续接也会消耗连接次数。

平台限流是**每Cloudflare节点的近似计数**，TOTAL_LIMIT不是全球严格预算，也不保证严格并发上限。
本实现不增加Durable Objects/数据库来实现全球账单计数，不宣称绝对费用封顶。
每个物理连接限制音频速率/总量、10秒无音频、5秒收尾及58秒生命周期，控制单连接滥用。
计划轮换需要账号允许至少两条短暂并发连接。

共享口令无法逐人撤销；退出只清除当前浏览器Cookie，不撤销被复制的已有Cookie。
需要整体撤销会话时轮换SESSION_SECRET；ACCESS_PASSWORD泄漏时同时更换两者。
此为小范围内部使用的最低访问控制，不包含人员审计或个人账号。

## 上游协议与安全边界

代理只连接固定IAT端点；服务器使用HMAC-SHA256签名，不接受客户端指定上游URL、app_id或business参数。
音频仅接受16kHz、单声道、16bit小端PCM，单帧最多1280字节；由客户端base64封装JSON。
服务器首帧注入普通话/iat参数，省略dwa，关闭动态修正；标点随当前句返回。
结束帧必须按序发送。收到服务端最后结果才正常完成；其他关闭按故障处理。
上游错误消息、sid和签名URL不下发、不打印；客户端只收到固定错误内容。

`worker.ts`可由现有项目测试导入，因此项目strict类型检查覆盖它。Workers原生扩展仅声明实际使用的小接口。
自动化测试覆盖处理器和桥接行为，**没有启动真实Workers运行时**；部署前必须在目标平台验证Upgrade、
Cookie、计时器、双连接、路由和中国大陆网络可达性。不要将模拟Response/WebSocket测试等同于云端验收。

官方资料：
- https://www.xfyun.cn/doc/asr/voicedictation/API.html
- https://developers.cloudflare.com/workers/runtime-apis/websockets/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
