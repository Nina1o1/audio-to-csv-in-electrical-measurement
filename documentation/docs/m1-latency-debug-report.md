# M1 延迟与丢字专项 Debug 报告

日期：2026-10-27（Asia/Shanghai）。结论：完成源码排查、开发诊断和已复现计时缺陷的最小修复；**尚未完成真实麦克风／讯飞 A–F 验收，不能宣称原始偶发故障已全部解决**。

## 1. Debug Summary

已阅读 Architecture、Data Models、Public Interface、页面要求、M1 README 中已批准技术方案、Checkpoint B 数据流／验收记录；检查 M1 五份原实现、四份原单元测试、代理鉴权／桥接、独立人工验收页及现有 M1 集成测试。历史 Phase 报告只作为背景，行为以当前三份契约和 M1 已确认方案为准。

实际流程：

```text
Web Speech 最终命令 → START_INPUT 事件 → App 微任务调用 startRecording
→ RECORDING（此时不代表麦克风或网络已经就绪）
→ AudioContext.resume → getUserMedia → AudioWorklet 加载／音频图准备
→ 同源 WebSocket → 代理鉴权／上游握手 → 浏览器 onopen
→ 连接音频图（含7000Hz低通）→ Worklet 单声道 Float32 → 主线程持续重采样／PCM 编码
→ 1280B / 40ms 帧 → 有界队列 → pump → WebSocket.send
→ 代理验证／注入 business → 讯飞 → 代理白名单转发 → onmessage
→ decodeIat → IatText(sn/pgs/rg) → refresh/textOf → publish
→ onTranscriptUpdate → App 响应式赋值 → Vue 渲染
```

低通滤波发生在 Worklet 之前；PCM 重采样与编码在主线程发生。LISTENING 使用浏览器语音服务，不建立收费 IAT，也不预热正文麦克风。

### 各阶段检查

| 阶段 | 代码证据与检查结论 | 延迟／丢失边界 |
|---|---|---|
| 命令识别 | index.ts/startCommands：只消费 isFinal、严格完整短句；去重和 generation 隔离 | “开始输入”最终命令未返回前，不存在正文 PCM；连说成“开始输入接触电阻…”不匹配命令。不能把浏览器命令延迟计为 IAT 延迟 |
| 麦克风准备 | audio.ts/captureAudio：resume、授权、addModule 依次等待；准备完才 connect IAT；onopen 才连接音频图 | 冷启动空窗发生在采集之前，不能靠后续缓冲恢复。Mock 慢握手测试中等待 7500ms 仍未激活音频图；真机时长未测 |
| 采样编码 | audio.ts/PcmFrames 使用实际 context.sampleRate；持续面积重采样，跨128样本块保留余量；滤波7000Hz；显式单声道；PCM Int16 小端、截幅、非有限数归零 | 自动测试 16k/44.1k/48k 输入一秒均得到25帧、32000B；不是只改格式标签。真机实际采样率、音量、噪声及失真未测 |
| 缓冲分帧 | 每帧1280B=640样本=40ms；最后完整PCM样本可部分flush；队列96000B约3秒 | 正常首连接前根本不产生PCM，不存在正常路径“onopen前send丢帧”。溢出显式报错，中断只保留confirmed |
| 发送 | index.ts/pump：单一pump定时器、按帧时长发、最大10ms追赶；检查bufferedAmount；58秒发送保护 | 原Date.now计算会因时钟跳变错误等待／中断；已复现并修复。主线程阻塞、后台节流仍可能积压，需真机日志 |
| 代理 | worker.ts/upstreamUrl、clientFrame、bridge：HMAC固定端点、首帧注入参数、0/1/2顺序、速率／大小验证、服务最终结果后正常关闭 | 代理与上游可能贡献握手和返回耗时；本轮未实际运行网络。上游错误码目前统一脱敏成code=-1，客户端无法追溯具体讯飞错误码 |
| 解析事件 | index.ts/onmessage→refresh→publish同步调用；protocol.ts按sn排序、去重、rg替换；动态模式先interim后final确认 | 没有发现“只在关闭时更新”或“只在最终结果时更新”。序号缺口、动态修正或退休会话未收尾可有意延后confirmed；interim仍展示 |
| 停止与最终 | stop停止采集并flush已到达主线程的PCM、排队发送、drain发送结束标志，等待status=2或既有5秒保护；旧回调隔离 | stopRecording不会直接忽略迟到final。Worklet已产生但尚未投递的消息可能在port关闭时丢失，尚无设备证据，未擅改异步停止协议 |
| 自然结束／轮换 | 活动status=2结束本段；52秒准备、55秒切换，退休会话final只收尾；完成前等待退休会话 | 自然final后的排队音频按契约取消，不开启新IAT。静默后直接继续说话不保证进入同一段 |
| UI | useManualWorkflow.ts/onTranscriptUpdate立即赋值；VoicePanel展示confirmed和interim | 本轮未修改App。事件时间不是DOM绘制时间，未测Vue绘制或浏览器主线程卡顿 |

官方核对：[讯飞 IAT 流式 API](https://www.xfyun.cn/doc/asr/voicedictation/API.html)。当前协议为16kHz/16bit/单声道PCM，首、中、结束状态0/1/2；上传结束后等待最终结果；单次最长60秒。保留既有eos=2000、未开启dwa；官方说明动态修正通常颗粒更小，但不据此改变已批准方案。

## 2. Root Cause Analysis

以下源码行号对应本轮实现，均为仓库相对路径。现有证据不足以将任何未验证因素列为“高概率根因”。

| 问题／分类 | 证据 | 根因（文件／函数） | 影响 | 修复方案 |
|---|---|---|---|---|
| 已确认代码缺陷：墙上时钟后跳导致丢失／中断；**未证实为用户本次真机事件原因** | 新增测试 keeps PCM cadence…(-60000)：修复前在100帧输入内报“音频缓冲已满”；修复后101帧全部发送且final尾字完成一次 | src/modules/m1-speech-recognition/index.ts:388，pump 原用Date.now计算绝对sendAt；后跳后sendAt-now被拉长到约60秒，期间队列达到96000B上限 | 发送停顿，约3秒队列耗尽后中断；未确认内容不能完成 | pump及同一客户端会话的计时统一用performance.now；不改帧长、缓冲、重试或超时阈值 |
| 已确认代码缺陷：墙上时钟前跳导致误超时；**未证实为用户本次真机事件原因** | 同测试(+60000)：修复前报“语音会话超过安全发送时限”；修复后完整101帧且final一次 | index.ts:375，pump 原Date.now-opened错误超过58000；scheduleRotation:300与connect:316共用此计时基准 | 立即停止，可能形成空片段或只保留部分confirmed | connect/pump/scheduleRotation全部使用同一单调时钟；真实58秒超限仍失败，原测试改为模拟单调时间确实流逝 |
| 已确认实现限制：快速开始正文有采集空窗；是否解释本次现象待真机验证 | audio.test.ts/prepares audio…验证音频图延迟连接；speech-recognition.test.ts/slow initial handshake验证7500ms内activate未调用 | audio.ts:133 captureAudio/start；index.ts:328 onopen；index.ts:435 startRecording先进入公开RECORDING再异步准备 | 用户先说的声音从未采集；很短正文可能全部落在此窗口 | 本轮只记录准备／打开／首帧时间，不预热收费服务、不添加录前缓冲、不更改状态或就绪接口。若需零空窗需另行设计 |
| 已确认契约边界：静默后自然结束并取消待发送正文 | index.ts:347 onmessage在活动status=2时清队列；现有自然完成／退休会话测试通过 | 当前已批准自然段规则，eos=2000；不是“所有物理会话结束都结束录入” | 超过自然截止的讲话不继续写入本段 | 保持契约；F测试分别验证final前恢复和final后新段 |
| 未验证：网络／讯飞返回颗粒、音量噪声、后台节流、Worklet关停未投递尾帧 | 无本轮真机日志，不能排名为已确认或高概率根因 | 网络、浏览器音频、服务识别链路 | 可能延迟或缺字，实际占比未知 | 使用新增诊断定位后再决定；不盲改dwa/eos/缓冲或停止状态机 |

在现有Mock覆盖内排除：仅改采样率标记、PCM大小端错误、追加结果覆盖全文、动态修正直接追加、等关闭才更新、stop后无条件忽略final、轮换旧final直接结束用户录入。此处“排除”仅指受测代码路径，不能等同真实声学质量或服务兼容性全部通过。

修复前实际执行结果：M1基线187通过；新增两项时钟回归后104通过、2失败（单状态机测试文件）。失败输出分别为：

```text
jump=-60000: RECOGNITION_FAILED / 音频缓冲已满，已停止录入。
jump=+60000: RECOGNITION_FAILED / 语音会话超过安全发送时限。
```

## 3. 修复方案及代码修改

- index.ts：仅将客户端会话时长／节奏计算的四处Date.now改为performance.now。其余改动为诊断ID、计数、状态和时间点；close回调只记录关闭code／wasClean／是否收到服务final，不执行旧会话业务。
- debug.ts：开发环境且URL含`m1Debug=1`时启用；独立本地`m1-debug`构建同样需要显式URL开关；生产production构建不启用。日志失败隔离。每次录入独立recordingId，每条物理连接在录入内独立sessionId；组合键识别连接。
- audio.ts：记录实际采样率、设备设置（不含设备ID／名称）、context状态、首个Worklet消息；未改变采样、图连接时机或关停逻辑。
- protocol.ts：内部解码结果保留已校验status供诊断使用；不是Public Interface变更。结果归并算法未改。
- tests/manual：既有构建器增加`--debug`，不覆盖用户原有本地运行修改；日志使用performance.now，复制内容默认只有转写长度，屏幕仍显示正文；收集M1元数据用于人工验收。
- 回归：两个墙上时钟跳变、真实单调超限、诊断开关及隐私／异常隔离、帧日志采样、消息到事件、65秒编号PCM顺序。

帧日志仅首帧和每25帧输出，记录序号、字节数、帧时长、queuedBytes、bufferedAmount与readyState。停止记录总采集／发送帧数；不会保存音频、完整正文、鉴权URL或凭据。结果日志只记录status/sn/类型和长度；不新增高频Worklet日志、不重复执行一次文本归并来做诊断。

## 4. 性能指标

**没有真实设备修复前后数据；不报告虚构的识别提速百分比。**下表保留缺测项，后续按同一设备、同一句话、同一网络采集至少5轮分别报告。

| 指标 | 修复前真机 | 修复后真机 | 本轮可执行证据 |
|---|---|---|---|
| 开始录入→首音频帧 | 未测 | 未测 | 7500ms慢握手Mock中音频未启动；这是注入条件，不是设备测量 |
| 首PCM帧→首次send | 未测 | 未测 | 现有发送测试首帧同步send；不含声卡／Worklet延迟 |
| 首send→首次识别结果 | 未测 | 未测 | Mock服务器主动推送，不能用于估算网络或ASR时长 |
| 收到识别结果→更新事件 | 未测 | 未测 | 新诊断测试的假时钟差值0ms，只证明同步路径没有人为等待，不能当CPU执行时间 |
| stop→最终完成 | 未测 | 未测 | 人工将Mock final延后120ms，完成恰在120ms；证明等待final而非提前输出 |
| 时钟跳变后4秒音频 | 已复现队列满／误超时 | Mock中101帧完整发送 | 直接回归证据，与真实识别准确率无关 |

诊断计算方式（相同recordingId；跨连接指标按sessionId分别计算）：

1. 首`audio-frame-captured.atMs - recording-requested.atMs`为首PCM帧可观测耗时；`audio-capture-started`记录主线程首次收到Float32消息的时间，**不是硬件实际首样本产生时间**。
2. 首`audio-frame-sent.atMs - audio-frame-captured.atMs`为首帧发送等待。
3. 有result/sn的首`websocket-message.receivedAtMs - 首send.atMs`为客户端可见返回耗时，包含代理、网络、服务；不能拆解为纯ASR耗时，也不能关联为某一帧的独立识别耗时。
4. 对应`transcript-event-emitted.atMs - websocket-message.receivedAtMs`衡量解析到分发；重复消息不发事件，缺口／动态模式等需结合parsed类型判断。首个新录入清屏事件不计为首次转写。
5. `transcript-complete-emitted.atMs - 首个recording-stopped.atMs`为停止到最终输出；如reason=stop-command后App再stop，只使用第一个停止事件。自然结束和错误中断分开统计。

客户端不能直接测量：真实发声起点、麦克风硬件采样时刻、上游接收／内部解码时间、讯飞准确处理耗时和UI实际绘制。墙上时钟仅留作人工日志日期，所有耗时使用单调时间。

## 5. 测试结果

环境：已有bundled Node v24.22.1、项目现有依赖，未安装新库。最终命令通过PATH选择该Node。测试全为Mock／合成PCM，不调用付费服务。

| 检查 | 结果 |
|---|---|
| TypeScript：npm run type-check | PASS；源码、Vue、测试、Node配置 |
| M1：npm test -- tests/unit/m1-speech-recognition | PASS；5文件、194项 |
| 全量：npm test | PASS；22文件、1272项通过、2项既有TODO未执行 |
| Production：npm run build | PASS；含类型检查与Vite生产打包 |
| 独立诊断验收页：node tests/manual/build-m1-acceptance.mjs --debug | PASS；临时目录构建，未启动网络服务 |
| git diff --check | PASS |
| 真实讯飞API／物理麦克风A–F | NOT TESTED；无本轮真实音频或用户设备日志 |

Mock已有覆盖：权限失败／迟到授权／取消、40ms发送、5ms抖动及短阻塞、网络积压失败、停止flush和迟到final、重复消息、动态替换、序号排序／缺口、旧连接隔离、命令严格边界、自然final、5秒收尾保护。新增65秒测试传输1625个带编号的1280B帧，逐一比对完整顺序，退休尾字先于新会话文字完成，且不提前发用户完成事件。

### A–F 人工复现与日志收集

使用独立M1页，避免把M2数词能力混入本次ASR判定。沿用已配置代理，不读取／输出`.dev.vars`内容。

```sh
PATH=/Users/nina/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH node tests/manual/build-m1-acceptance.mjs --local --debug
```

在桌面Chrome/Edge打开输出端口的`https://localhost:8787/tests/manual/m1-acceptance.html?m1Debug=1`；接受本地证书并在页内登录。使用页面“开始监听”，等LISTENING；“自动路由命令”启用。开发者工具显示Verbose级别的`[M1]`，页面“复制日志”包含M1元数据。每项测试前清空日志并记录设备、浏览器版本、是否首次授权、前后台、网络、是否已OPEN；每项至少5次，并保留失败轮。

| 测试 | 操作步骤 | 预期 | 本轮实际／是否复现／关键时间戳 |
|---|---|---|---|
| A 短句 | 点开始录入；等待连接就绪，再说“接触电阻十二毫欧。”并静默 | 说话中收到update；最终全文完整且complete一次 | 真机未执行，无时间戳；Mock有短句长度／同步事件覆盖，不等于ASR准确率通过 |
| B 连续长句 | 就绪后连续说“工单A2301，料号C045，接触电阻十二毫欧，绝缘电阻五百兆欧，耐电压一千五百伏通过，合格。” | 连续update、send积压不持续增长；最终保留全文（ASR文本与M2数词解析分开） | 真机未执行；无时间戳或识别结果 |
| C 快速开始 | 说“开始输入”后立即说A正文；另做等待OPEN后说A的对照；冷／热授权分别测试 | 观察START_INPUT是否发出、录入与首帧空窗；按现契约无法承诺立即正文首字完整 | 真机未执行；Mock已确认7500ms未激活音频。若无recording-requested，先查命令整体匹配；若有请求但首帧晚，查冷启动 |
| D 快速结束 | 就绪后说A正文后立刻说“结束输入”；另做正文后立刻点结束录入的对照 | STOP只消费完整短句；正文尾字随迟到final保留，complete一次；命令不进入正文 | 真机未执行；Mock迟到尾字／split STOP／重复停止通过。收集stop、end-sent、status=2、complete时间 |
| E 长时间 | 就绪后持续说编号语句超过65秒，每隔几秒说下一编号，避免2秒静默；到结束再停止 | 52/55秒轮换；退休final不结束用户录入；编号和尾字顺序完整、无双发 | 真机未执行；Mock65秒1625帧编号完整。收集两sessionId握手、发送及final顺序；真机并发权限未验证 |
| F 静音恢复 | 第1轮就绪后说A、短停顿且在status=2前接着说；第2轮停顿直到status=2／LISTENING，再说开始输入和下一句 | final前可续同段；final后应开始新段。不能把既定自然结束当成无条件自动恢复 | 真机未执行；Mock自然final及下一段、旧回调隔离通过。分别收集final前／后恢复的日志 |

每轮人工记录模板（不能留成“已通过”）：

```text
测试ID／轮次：
设备／Chrome或Edge版本／实际sampleRate：
首次授权？前台？网络：
操作步骤与实际口述：
预期：
实际正文（由操作者核对，不默认写入诊断日志）：
是否复现：未执行 / 是 / 否
recordingId／sessionId：
请求／microphone-ready／首Float32／首PCM／首send／首result／update／stop／final／complete atMs：
最大queuedBytes／bufferedAmount（采样值）：
错误code／close code／wasClean／finalReceived：
证据：复制日志文件、必要时截图（上传前自行检查正文）
```

帧日志采用采样，最大队列值仅是观测值，不保证捕获瞬时峰值。网页显示的转写文本仍含用户口述，但“复制日志”默认只复制长度。不要导出包含完整签名URL的网络HAR作为默认日志。

## 6. 未解决问题

- 原始不稳定故障还没有真实会话日志，无法判断冷启动、服务返回节奏、设备、网络、关停尾帧各占多少；本轮已修复的时钟问题也尚未关联到某次真机故障。
- 本轮未改变“命令最终识别→异步权限／连接→正文采集”的空窗，快速开始可能仍丢首字；这是已有批准限制，需要数据后再讨论就绪提示或采集策略。
- 未改变活动status=2自然截止、eos=2000或dwa关闭；静默恢复须按现有分段规则使用。
- 代理继续统一脱敏上游失败；客户端只知道拒绝／中断，无法给出真实讯飞错误码。本轮未新增服务端持久日志或改变错误接口。
- 代理速率计数自身仍使用服务器Date.now；本轮修复范围是可控复现的客户端调度，未验证服务器时钟调整场景。
- Worklet端口在停止时未投递的尾样本、AudioContext实际running、降噪对声学的影响、后台／前台恢复、双连接配额仍需真实设备／部署验证。

## 7. Contract Compliance

公开契约文件和共享模型未改。MicrophoneState仍IDLE/LISTENING/RECORDING；TranscriptSegment仍只有text；TranscriptUpdate仍只有confirmedText/interimText。新增status仅是M1内部IAT解码元数据。

M1只发事件；没有改App业务接线、M2/M3/M4/M5。临时结果不覆盖confirmed、不作为complete；普通停止等待服务final或既有错误保护，每段最多完成一次，旧会话回调不修改当前业务。自然结束规则、52/55秒轮换、3秒PCM上限、5秒收尾、10秒启动、58秒安全时限与既有收费控制保持。

工作区开始前已有README、checkpoint-b-verification、代理README及人工构建器修改，均保留；本轮只在人工构建器增补debug选项，未撤销用户修改。未提交、部署或调用付费API。


## 追加：LISTENING 下“开始输入”无响应

用户报告：说命令后页面一直显示LISTENING。当前无法仅凭此现象确定是浏览器没返回结果、仅返回interim、最终文本未完整匹配，还是App条件拒绝；没有把任何一种列为已确认根因。

定位发现上一版诊断从startRecording才建立recordingId，无法观察此前的命令监听。因此补充每个命令引擎的listeningId和以下开发日志：

- command-listening-requested / started / timeout / unavailable / ended / error。
- command-result-interim（首次及每10次统计）、command-result-final（仅长度、匹配与预定义命令名）。
- command-result-ignored（迟到、非监听、重复最终结果）和command-event-emitted。

未放宽完整短句匹配，未从interim触发命令，未改变费用或续接策略。新增测试证实：临时“开始输入”不触发；最终“开始输入接触电阻”不匹配；新的独立最终“开始输入。”只发一次START_INPUT。195项M1测试通过，全量1273通过／2项既有TODO，type-check和production build通过。

已在localhost:8788启动并用Chrome打开独立诊断页（m1-debug构建、URL显式m1Debug=1）；原localhost:5173主App未重启。用户随后在该页进行真实录入，观察到RECORDING、连接已就绪及实际转写文本；最近语音命令当时仍显示“暂无”。这只证明该次正文采集和讯飞链路能工作，不能据此判定命令服务可用，也不等于完整A–F验收。完整命令日志尚待用户复现／提供。

读取判据：只有started且没有result，先查浏览器命令服务／麦克风输入；只有interim，不提前触发；final matched=false，查最终文本完整边界；已有command-event-emitted但无recording-requested，再查路由／业务门禁。监听中的浏览器语音服务与RECORDING中的讯飞服务分开判断。


### 用户提供的真实命令启动日志（22:37 Asia/Shanghai）

收到用户从独立页复制的28条真实事件，保存为[派生时间点摘要](../verification/m1-debug/command-start-observation.json)，未伪装为完整原始日志。该轮final matched=true、command=START_INPUT，事件随后触发recording-requested和RECORDING。

| 区间 | 本轮实际差值 |
|---|---:|
| LISTENING started→首个interim | 2061.2ms |
| 首个interim→匹配的final | 2364.3ms |
| final→command-event-emitted | 0.6ms |
| command-event-emitted→recording-requested | 0.4ms |
| recording-requested→microphone-ready | 211.4ms |
| websocket-connecting→websocket-opened | 1740.4ms |
| recording-requested→首Float32到达 | 1960.7ms |
| recording-requested→首PCM帧 | 1991.6ms |
| 首PCM帧→首次send | 0.3ms |

结论：本轮命令已正常触发；可见的等待主要发生于浏览器返回命令final之前，以及正文采集前等待IAT握手。缺少实际发声起点，2061.2ms/2364.3ms不能当作完整ASR端到端耗时。该轮未复现“完全不触发”，不能据此宣称之前的无响应已修复。

设备：AudioContext实际44100Hz，track报告48000Hz、单声道，context为running；二者可由浏览器音频图转换衔接，PcmFrames以实际context.sampleRate再转16000Hz。采样帧1/25/50/75时queuedBytes均为0，send后bufferedAmount均1789B，未见这些采样点持续积压。每帧1280B=40ms。提供的日志没有IAT识别结果和完成事件，因此首次正文转写／最终完成耗时仍缺测。

本轮日志直接量化了约1.99秒的采集前空窗；在首Float32前说出的正文不属于已采集的音频。本轮没有通过预先消费interim、更改严格命令边界或收费预连接来掩盖这个窗口。


### 原5173完整App复测准备

用户明确要求在原5173页面复现后，检查确认其服务使用启动时构建的临时目录m1-app-ZH0JKK，原页面引用index-UtGOdVCN.js，未加载后来增加的诊断。保留旧index和原hash资源，将相同完整App构建为m1-debug，增加仅在显式m1Debug=1时运行的开发日志观察面板；面板在tests/manual/m1-debug-panel.ts，由人工构建器注入，M1本身不引入DOM、App路由代码不变。

原服务无法正确提供新增资源，刷新后短暂白屏；重新启动原5173服务并强制重新加载后，Chrome确认面板和完整App正常显示、原1条历史记录仍在。未修改来源、存储内容、公开接口、业务门禁或命令匹配规则。旧文件保留，未删除历史数据。

Chrome现打开https://localhost:5173/?m1Debug=1，顶部可复制最多500条M1元数据；只有用户点击开始监听才启动识别。TypeScript和production build通过；本地debug完整App构建38模块，正常production仍37模块，不注入该面板。已请用户在原页口述复测，结果待实际日志。


原5173复测结果：用户随后确认页面显示RECORDING。本轮在原来源的完整App中成功从LISTENING进入RECORDING，证明该轮START_INPUT至App录入路由能够执行。未取得该轮完整时间点，不能据此量化原页面延迟，也不能把旧构建或任何未验证因素归因为此前偶发失败；“一直LISTENING无响应”本轮未复现。诊断面板保留供下一次失败时复制原页日志。

## 2026-10-28 真机跟进：说“开始输入”后连接失败

本轮只读取浏览器状态与代理代码，未改识别逻辑，未调用讯飞或读取凭据。

- 当前页面：`https://localhost:5173/`；本机workerd正在5173端口监听。
- Chrome现存控制台记录中，4次`wss://localhost:5173/api/m1/iat`失败均提示：`HTTP Authentication failed; no valid credentials available`。
- 这是浏览器可观察到的HTTP鉴权失败；当前Worker的IAT入口在`validSession`未通过时返回401，且发生在上游讯飞握手之前。缺失、过期、被更换SESSION_SECRET失效的Cookie均可能触发，单凭控制台不能进一步区分。
- LISTENING使用浏览器Web Speech，不依赖代理Cookie；因此能够识别“开始输入”与正文代理鉴权失败并不矛盾。
- 现有M1的WebSocket.onerror统一报告“语音连接中断”，掩盖了本次失败发生在建连阶段的细节。本次不根据该通用提示修改音频缓冲或停止逻辑。
- 恢复步骤：在**当前HTTPS localhost:5173页面**展开“语音代理访问”，输入已有共享访问口令并点击“登录语音代理”；确认显示登录成功，再开始监听并说“开始输入”。访问口令不是讯飞APIKey/APISecret。若登录后仍失败，须继续检查该次login响应和随后的WebSocket握手，不能认定所有鉴权问题均已解决。
- 本轮未代填口令、未验证重新登录后的录入成功；用户恢复登录后仍需实际复测。
