# M1 “开始输入”后连接失败排查

日期：2026-10-28，Asia/Shanghai。

## 1. 根因

本次第一个可确认的异常是浏览器到同源语音代理的 WebSocket HTTP 鉴权失败，尚未建立正文连接。用户提供的原始错误为：

```text
WebSocket connection to 'wss://localhost:5173/api/m1/iat' failed:
HTTP Authentication failed; no valid credentials available
```

代码定位：`infrastructure/m1-speech-proxy/worker.ts:209–210`，`validSession` 校验不通过即返回 401；其后才有上游讯飞握手。上游 HTTP 拒绝由 Worker 映射为 502，不直接返回 401。结合该源码与浏览器错误，本次定位为代理访问会话无效。不能从现有证据区分 Cookie 缺失、过期或 SESSION_SECRET 变化。未读取真实凭据或 Cookie。

用户按当前 HTTPS 来源展开“语音代理访问”、用已有共享口令重新登录并复测后，反馈“成功”。这支持本次登录恢复方案；未将该简短反馈扩展为完整九步真机验收通过。

## 2. 故障传播过程

真实调用链：Web Speech 最终命令 → M1 `onCommand(START_INPUT)` → App 微任务 `startInput` → M1 `startRecording` → RECORDING → AudioContext/getUserMedia/Worklet 准备 → 同源代理握手 → HTTP 鉴权失败 → 浏览器 WebSocket `onerror` → M1 `fail` → 释放资源、完成空片段一次、IDLE → App `onError` 显示“语音错误：语音连接中断。”。

- LISTENING 使用浏览器 Web Speech，不需要代理 Cookie，因此识别“开始输入”成功与随后正文鉴权失败并不矛盾。
- 失败发生时按代码应处于 RECORDING 启动阶段；WebSocket 未到 OPEN，没有 onopen 启动音频图，也没有发送正文帧。未取得本次完整事件日志，不能报告具体 readyState 数值或 CloseEvent 实测字段。
- 首先是服务器在 HTTP 握手阶段拒绝请求，随后客户端 `fail/release/closeSession` 请求清理；不是清理先造成了鉴权失败，也没有证据表明讯飞中断已建立会话。
- App 的“语音错误”前缀和 M1 的“语音连接中断”消息可由同一个错误事件组成，不代表两个独立根因。迟到 close 在清理后仅诊断，不再次触发公共错误。用户未提供两个独立错误事件的完整日志。
- `startListening` 仅 IDLE 启动，onstart 后进入 LISTENING 并 resolve；`startRecording` 仅 LISTENING 且无当前录入时生效；`stopRecording` 收尾一次后恢复实际命令监听；`stopListening` 取消启动或先收尾录入再 IDLE。原三状态及事件顺序不变。
- 命令最终结果按索引去重，App 微任务再次校验录入上下文和当前状态。切换时 generation 和旧实例身份失效，主动 abort 的错误/结束回调不会关闭新录入。未发现须针对本次故障修改该生命周期的证据。

## 3. 修复内容

实际恢复措施：使用已有登录入口重新建立当前来源的代理访问会话。未绕过认证、下发讯飞密钥或增加重连；该故障无需修改录音协议或业务状态机。

本轮代码仅补齐开发诊断和回归：

- `src/modules/m1-speech-recognition/index.ts`：onerror 在清理前记录 sessionId、公开状态、是否已打开、readyState；关闭日志增加是否已请求客户端清理和 reason 长度。自由文本 reason 不写入日志，避免泄漏；code/wasClean 继续保留。开关仍为开发环境或显式 m1-debug 构建且 URL 含 m1Debug=1；普通 production 构建不启用。
- `tests/unit/m1-speech-recognition/proxy.test.ts`：新增三种代理会话无效 → 401 且零上游请求 → 显式登录 → 101 的测试。
- `tests/unit/m1-speech-recognition/speech-recognition.test.ts`：新增建连失败的诊断、关闭元数据、脱敏、一次错误及音频/定时器释放验证。
- `tests/integration/voice-m1.test.ts`：新增真实 M1/App/M2/M3、模拟浏览器边界的恢复场景，覆盖重复 START_INPUT、预期 abort/旧 onend、建连失败清理、登录后再启动、OPEN 后发送、两次实时更新、STOP 最终片段和下一轮启动。

没有修改 App 协调代码、M2–M5、共享模型、公共接口、错误文案、超时或重试策略。工作区原有其他模块及 public-interface.md 的修改保持原样。

## 4. 测试结果

使用本机已有 Node v24.22.1 与现有依赖，未安装库。

| 验证 | 结果 |
|---|---|
| 修改前 M1 + 三份语音集成 | 8 文件，243 项通过 |
| 修改后 M1 专项 | 5 文件，199 项通过 |
| 修改后 M1 + 三份语音集成 | 8 文件，248 项通过 |
| 全量 npm test | 22 文件，1278 项通过，2 项既有 TODO 未执行 |
| npm run type-check | 通过 |
| npm run build | 通过，生产构建 |
| git diff --check | 通过 |
| 本次真实浏览器恢复 | 用户重新登录并复测后反馈“成功” |
| 完整真实麦克风/讯飞九步验收 | 尚未逐项确认，不宣称全部通过 |

代理回归使用 Worker/Fetch/WebSocket 替身；集成回归替换音频和网络边界。它们不证明真实服务识别准确率或持续时长。已有用例继续覆盖正常关闭不误报、真实连接故障、迟到回调与自然结束。

## 5. 剩余风险

- 代理会话仍按契约八小时到期；更换 SESSION_SECRET 或清除 Cookie 后须重新登录。浏览器 WebSocket onerror 不提供 HTTP 状态，不能仅凭通用连接错误断定以后也都是鉴权失败。
- 登录成功后若仍出错，应重新检查该次握手及服务响应，不能用本次结论解释所有连接异常。
- 本次 CloseEvent code/reason/wasClean 原始值缺测；完整连续语音、结束一次、下一轮和网络故障恢复的真机检查仍待逐项验收。

## 6. 最短手动复现与验收

1. 使用已有 `npm run dev:voice` 服务，保持 `https://localhost:5173/` 来源；若服务已运行，不必重复启动。
2. 展开“语音代理访问”，退出后开始监听，说“开始输入”。在 Network 中仅核对 `/api/m1/iat` 的 HTTP 状态；预期无有效登录时拒绝，回 IDLE。不要复制 Cookie 或完整 HAR。
3. 用已有共享访问口令登录，确认登录成功。再次开始监听，说“开始输入”；Network 应看到 101。
4. 等待连接打开，口述“工单A2301，接触电阻12毫欧”，核对实时文本更新；说“结束输入”，核对一次最终结果和返回 LISTENING。注意现有 eos=2000，停顿可先自然完成，不能把它计为重复完成。
5. 再说“开始输入”录第二段，确认新会话可用；另测断网后 IDLE、保留已确认文本，恢复网络后显式开始监听。

若再次失败，使用 `npm run dev:voice -- --debug` 构建并重启本地服务，访问 `https://localhost:5173/?m1Debug=1`，复制开发诊断面板元数据及握手 HTTP 状态。仅设置 URL 参数不会让普通 production 构建启用日志。所需最小证据为 recording-requested、websocket-opened 是否出现、websocket-error、websocket-close-request、websocket-closed；不提供口令、密钥、Authorization、签名 URL、完整音频或转写。
