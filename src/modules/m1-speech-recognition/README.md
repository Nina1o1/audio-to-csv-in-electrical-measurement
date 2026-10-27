# M1 语音识别

独立 TypeScript 模块，不依赖 Vue、DOM 展示、M2–M5 或 localStorage。
入口 `createSpeechRecognition({ proxyPath?: string }): SpeechRecognitionModule`，默认代理路径
`/api/m1/iat`。返回对象仅有 Public Interface 已定义的方法；工厂选项只是部署配置，不包含密钥。

## 契约依据与已批准补充

已完整核对 `documentation/docs/` 的九份 Markdown 文档。基础行为以
`public-interface.md` 第1、2、7节、Architecture 和页面要求为准。
本次聊天已逐项确认、但尚未写入核心文档的补充为：

- LISTENING 使用 Web Speech API（`zh-CN`），不建立收费的讯飞连接；浏览器服务可能联网，
  不承诺免费、离线或所有 Chrome/Edge 可用。
- RECORDING 使用 `wss://iat-api.xfyun.cn/v2/iat`，经同源安全 WebSocket 代理连接，
  不能改为其他讯飞产品。APIKey/APISecret 均不下发浏览器。
- 第一版不发送 `dwa=wpgs`。正常追加式结果作为 confirmed；若服务意外从第一片起返回动态结果，
  按 sn/pgs/rg 归并为 interim，直到物理会话最后结果才确认。已经输出追加式正文后突然切换动态模式，
  视为协议故障，保留先前确认正文，不撤回已消费命令。
- 计划轮换与自然结束不同：约52秒提前建连，55秒切换音频归属，旧连接继续收尾。
  短暂双连接、音频不重叠；不发用户完成事件、不改变 RECORDING、不额外等待1秒。
- 2026-10-27已确认：正文活动会话返回`data.status=2`时自动完成本段，不自然续接正文，
  不伪造STOP_INPUT；恢复命令引擎后回到LISTENING，下一段重新开始。`eos=2000`不变。
  命令监听仍1秒后续接，连续3次已启动续接无新确认结果则停；真正错误不重试。
  每次连接/命令监听/音频准备最多等待10秒。
- 正常停止最多收尾5秒，期间保持 RECORDING；完成事件先于目标状态变化。
  恢复命令引擎实际启动后才回 LISTENING；恢复失败进入 IDLE 并报错，不重复完成。
- 开始录入存在浏览器权限及冷启动延迟，不承诺“开始输入＋立即连续正文”首字完整。

上述为用户已批准的实现依据；自然结束修订已同步Architecture、Public Interface与页面要求，
不修改共享模型或接口声明。
55秒是安全余量参数，不是服务可用性或文字无损保证。计划轮换需要账号允许短暂双连接。

## 文件边界

- `index.ts`：唯一公开状态、启动结算、续接、轮换、收尾、事件与订阅生命周期。
- `browser.ts`：原生 Web Speech 构造和同源代理 WebSocket。
- `audio.ts`：AudioWorklet、低通滤波、持续重采样、16kHz/16bit/单声道小端PCM、40ms帧。
- `protocol.ts`：严格JSON校验、序号与替换归并、独立短句命令边界、音频消息。
- `../../../infrastructure/m1-speech-proxy/`：最小访问控制和IAT安全代理部署示例。

音频队列上限96000字节（约3秒PCM）；网络积压或超过安全发送时限明确失败，不静默丢音。
浏览器发出 offline 通知时，即使本机代理 WebSocket 仍连接，也立即按现有中断流程保留已确认文本、
回到 IDLE、释放音频和网络监听；已离线时拒绝启动，恢复网络后须由用户重新启动。
离线监听仅在语音会话期间存在，停止、失败及取消启动后清理；不根据“没有新文字”判断断网。
浏览器在线标记不保证上游服务可达；未发离线通知的故障仍由现有传输错误、积压和超时机制处理。
采集使用 Blob AudioWorklet 模块，部署 CSP 如有限制，须允许该 worklet 模块加载。
不安装 Service Worker 或 PWA，不持久化音频。后台采集暂停/设备中断按错误停止，不保证后台运行。

## 事件与命令

IDLE不识别命令；LISTENING识别全部八命令；RECORDING仅识别STOP_INPUT。
“结束录入”为STOP_INPUT别名。其他业务词在正文中不全局剥离，不执行、不排队业务操作。
完整短句匹配，不截取“确认保存/确认删除”；不从interim识别命令。

录入中的停止短句须有标点或真实会话结束边界，不能将任意传输包尾当语句结束；
跨传输片段保留候选尾部。命令消费后固定正文截止位置，后续文字不进入最终片段。
命中STOP_INPUT后立即停止本次音频并收尾收费连接；公开录入完成仍等待App调用stopRecording，
不由M1擅自执行业务协调，也不因App稍后处理命令而额外报错。
上一物理会话仍可能补尾字时，后一会话文本先留在interim，不能提前执行其中的停止命令。

正文自然完成以活动会话的服务端最终结果为截止边界，取消未发送PCM，不把截止后的讲话
续传到下一会话；只输出服务已确认的本段文本。计划轮换的旧连接结束不触发整段完成，
活动会话先结束时仍等待退休会话补尾。标点或普通中间结果不能代替最终结果。

`onTranscriptUpdate` 是完整快照；`onTranscriptComplete`每次录入一次（含空文本）。
错误中断只保留confirmed。通知期间调用变更方法会拒绝；只读getState可调用。
订阅独立、取消幂等，回调收到独立payload；订阅异常仅作固定内容日志，不传播敏感异常内容。

## App接线约束示例

```typescript
const speech = createSpeechRecognition()
const unsubscribe = speech.onCommand(command => {
  queueMicrotask(() => {
    // App在这里重新检查M3和录入上下文，再路由命令。
    // START_INPUT -> speech.startRecording()
    // STOP_INPUT -> speech.stopRecording()
  })
})
speech.onError(error => { /* 统一显示故障；catch不重复提示。 */ })
await speech.startListening() // UI须在catch/finally核对自己的启动请求身份。
// onTranscriptUpdate -> 本次展示
// onTranscriptComplete -> App核对上下文后M2.parse -> M3.applyParseResult
// 组件卸载：speech.stopListening(); unsubscribe(); 取消其他订阅。
```

先由独立语音访问入口登录代理，凭据由安全Cookie发送；模块不增加登录公开方法。
App不得从onStateChange/onCommand内同步嵌套调用变更方法，不得把interim送入M2。

## 验证与限制

使用现有Vitest，测试无网络/麦克风/付费调用：

```sh
npm run type-check
npm test -- tests/unit/m1-speech-recognition
npm test
npm run build
```

测试替换浏览器边界和代理运行时；正式模块有真实Web Speech、AudioWorklet和WebSocket路径。
Checkpoint B 已由 App 协调层接入 M1、M2 与唯一 M3 草稿；代理仍单独部署，Vite不会打包服务端密钥。
真实Chrome中文能力、工厂噪声、权限/后台行为、讯飞连通/计费、双连接权限、代理运行时及网络延迟
尚需部署后验收。普通互联网不保证浏览器语音服务可达；失败应保留手动功能。

官方协议：https://www.xfyun.cn/doc/asr/voicedictation/API.html
