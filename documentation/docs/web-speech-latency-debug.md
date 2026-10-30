# Chrome Web Speech 命令延迟诊断

## 当前实施状态：已按用户确认采用单次识别（2026-10-30）

用户在获知原有 1000ms 重启间隔及额外启动耗时带来的监听空窗后，明确回复“接受”。据此仅将 `src/modules/m1-speech-recognition/browser.ts:commandRecognition()` 中的 `recognition.continuous` 从 true 改为 false；lang=zh-CN、interimResults=true 保留。没有修改重启定时器、空结果保护、final 完整命令确认、去重、状态机、App 微任务、科大讯飞或任何业务模块。

实施依据是下文每组 5 次的交替试验：首次结果到 final 中位数 15558.4ms→1477.1ms，P90 16036.5ms→1593.8ms。它们是独立页配置对照数据，不是正式 App 修改后的新测量。未满足最初每组至少 10 次的样本要求，不能承诺在所有 Chrome/网络环境中达到同等改善。

增强现有集成回归用例：模拟单次引擎在 App 微任务处理前触发 onend，验证 START_INPUT 仍只启动一次录音，进入 RECORDING 后不会因待执行重启产生第二个命令引擎。原有精确 1000ms 重启、空续接保护、其他命令及结束录入测试保留。

落地后验证：28 个测试文件通过，1502 个测试通过，1 个原有 todo；type-check、Vite 生产构建及 diff 检查通过。尚未获得正式 App 新配置下的真实口述复测及至少 10 次延迟样本。无需重启开发服务，但已有识别实例保留创建时配置；复测应在非录入状态刷新原 App，然后重新点击开始监听。刷新会丢弃未保存草稿，因此没有代替用户刷新。

以下章节按审查与实验阶段记录历史结论；其中“未改配置”等表述指对应阶段，当前配置以上述实施状态为准。

## 1. 问题定位

首轮完成代码审查、临时诊断和自动化回归，没有实施性能修复。随后用户要求继续检测，本轮读取当前 Chrome 页面的真实 Console 元数据，已观察到主要等待位于 T3→T5（约 58.23 秒）。详见下方“真实 Chrome 跟进”；尚不能进一步确定端点检测、网络、服务端或主线程调度的具体责任。

## 真实 Chrome 跟进（2026-10-30）

来源：当前 Chrome `https://localhost:5173/?m1Debug=1` 页面已有 Console 的可见元数据，通过原生 UI 只读查看；不是本轮生成的 Mock，也不是完整原始日志导出。没有读取或保存语音原文，没有重新启动识别或调整配置。浏览器进程版本为 156.0.8078.73。

| listeningId=1 中观察到的事件 | performance.now()，毫秒 |
| --- | ---: |
| T1 声音起点 | 3441.5 |
| T2 语音起点 | 3442.6 |
| 首个 T3 / 随后 interim index=0 | 3445.5 / 3446.1 |
| 首个包含目标短语的 T4 | 3689.6 |
| index=0 后续 interim | 12406.9 |
| 包含目标短语的 T5 | 61678.4 |
| 紧随其后的 final index=0 处理日志 | 61680.3 |
| 后续 T3（第二条结果） | 74590.9 |
| 后续 T4 | 75373.2 |
| index=1 后续 interim | 118106.9 |
| index=1 final，matched=false、command=undefined、textLength=4 | 121551.7 |
| speechend / soundend / audioend | 132662.3 / 132669.9 / 132670.7 |

由首段可见顺序计算：T2→T3 约 2.9ms，T3→T5 约 58232.9ms，T4→T5 约 57988.8ms。T5→随后 final 处理日志约 1.9ms，这不是 T5→T6；没有看到该段 START_INPUT 分发或 T7，不得把缺失指标写成零。T1/T2 是浏览器事件回调时间，2.9ms 不能理解成从真实开口到识别的物理耗时。

已确认两种现象：

1. 识别已给出包含目标短语的 interim，但 final 交付晚约 58 秒。该段长等待在应用收到 final 前，不能由 M1 的 final 过滤、命令分发或科大讯飞握手解释。此期间仍出现 interim，至少不是整个区间完全没有 JS 回调；但没有 Performance trace，不能排除局部主线程阻塞。
2. index=1 的 final 明确 matched=false。临时结果曾出现目标短语，不保证最终结果仍是目标命令；该索引 final 前未看到 T5，按现有采样逻辑不支持“最终文本仍包含目标短语”的结论。最终四字内容未采集，因此不猜测具体错字。没有触发 START_INPUT 符合现有确认规则，不能以提前执行 interim 修复。

speechend 到约 132.66 秒才出现，值得进一步检查背景声音、麦克风输入和浏览器端点检测。但这些日志没有实际停止说话的时间，也没有同期网络请求及性能轨迹，不能将“噪声”“VPN”“continuous=true”定为根因。当前 Console 的分类中未显示错误，但这不证明识别服务网络正常。浏览器之后出现连续空续接保护提示；它发生在上述识别等待之后，不解释前面的 final 延迟。

只有一轮会话的异常观察，且没有成功匹配并触发的完整 T1–T7 样本。有效命令性能样本仍为 0，未达到 10 次，不能给出有统计意义的中位数/P90或修复前后改善。下一步应在独立页使用同样配置、明确单次口述后保持安静，采集至少 10 次，同时另录一次 Performance trace；再单独比较网络、麦克风和配置变量。本轮只更新诊断结论，不改业务或识别配置。

当前链路：浏览器结果回调 → M1 final 检查、结果索引去重、完整命令匹配 → 同步通知 → App 原有微任务 → startInput() 原有业务检查 → 正式录入。

| 时间点 | 采样位置 |
| --- | --- |
| T1 | onsoundstart 回调 |
| T2 | onspeechstart 回调 |
| T3 | 对当前结果索引首次收到 onresult，使用回调入口时间 |
| T4 | 该索引首次出现包含目标短语的 interim，仅诊断 |
| T5 | 该索引首次出现包含目标短语的 final，使用回调入口时间 |
| T6 | M1 已通过原有匹配与去重条件，准备同步分发 START_INPUT |
| T7 | App 原有微任务通过生命周期检查，准备调用 startInput() |

T7 代表处理入口，不代表科大讯飞连接完成，也不保证 startInput() 的业务检查通过。被 App 生命周期检查丢弃的命令没有 T7，不能记作零延迟。

同一 listeningId + index 关联 T3–T7；T1/T2 属于浏览器最近一次声音/语音起点，快照附在首次结果上。API 的这些事件不携带结果索引，无法严格关联重叠语音。测量时每次监听只说一次目标命令，等待 final，避免连续多句话造成起点歧义。每次重新开始监听使用新的 listeningId。

## 2. 根因分析与证据

### 用户提供的交替采样：每组 5 次（2026-10-30）

本组是同一对照页输出的 10 次交替试验：true/false 各 5 次，attempts 全部 matched-final，没有失败或取消。以下直接记录用户提供的汇总；不将之前独立的单样本合并到本批统计。

| 指标 | continuous=true 中位数 / P90（ms） | continuous=false 中位数 / P90（ms） |
| --- | ---: | ---: |
| T2→T3 | 504.3 / 695.5 | 535.2 / 562.1 |
| T3→T5 | 15558.4 / 16036.5 | 1477.1 / 1593.8 |
| T4→T5 | 14763.9 / 15042.7 | 523.0 / 919.2 |
| speechend→final | 384.2 / 711.7 | 206.6 / 366.6 |

T3→T5 中位数的组间差为 14081.3ms，约减少 90.5%；T4→T5 中位数的组间差为 14240.9ms，约减少 96.5%。这是两个组的中位数之差，不是逐对差值中位数。首次结果时间接近，而 final 等待差异显著。continuous=true 的 speechend→final 也仅数百毫秒，支持主要等待集中在语音结束判定之前。结合不加载业务的独立页即可复现，当前优先结论是：浏览器识别链路在连续配置下的结束判定/分段表现，是本组延迟的关键影响因素；没有证据指向 M1 final 后处理或科大讯飞。

这些数据没有解释为何浏览器迟迟判定结束：仍不能区分背景声、麦克风信号、浏览器实现或服务端分段策略。也不能仅凭汇总完全排除 JS 事件调度影响。每组 n=5 尚未满足原定每组至少 10 次；nearest-rank P90 在 n=5 时等于最大值，不能代表稳定尾延迟。

最小候选修复是仅将 commandRecognition() 的 continuous 改为 false，保留 interimResults=true、final 完整匹配、状态机及所有异常恢复代码。然而，这会使浏览器更频繁结束识别会话：未切入录音时，现有 onend 会经过原有 1000ms 定时器再启动下一引擎，期间存在监听空窗；空结果的连续续接保护也仍然有效。不得为了消除空窗顺便缩短定时器或更改保护规则。因此候选修复不是已证明无行为差异的配置替换；在用户允许这种会话结束/续接频率变化前，不修改生产配置。本次仅记录实测和候选变更。

### 用户提供的独立页配置对照（2026-10-30）

来源：用户分别运行原配置及单次识别测试后提供的 summary 输出。每组只有 1 个有效样本；未取得原始事件序列，浏览器、设备、网络及试验顺序没有独立核验。以下数值为用户所提供的真实测量摘要，不是自动化测试结果。

| 指标 | continuous=true（n=1） | continuous=false（n=1） |
| --- | ---: | ---: |
| T2→T3 | 361.8ms | 0.2ms |
| T3→T5 | 6960.9ms | 1056.0ms |
| T4→T5 | 5431.7ms | 502.7ms |
| speechend→final | 缺失（n=0） | 缺失（n=0） |

这次对照中，单次模式的 T3→T5 少 5904.9ms，约减少 84.8%；T4→T5 少 4929.0ms，约减少 90.7%。只描述这两个样本的差异，不代表稳定改善或生产修复效果。n=1 时 median 和 P90 都只是该样本本身，没有可解释的尾延迟分布；仍需每组至少 10 次。

独立页的原配置也发生秒级 final 等待，说明这种等待可以在不加载 App/M1/科大讯飞的环境中出现。因此应用业务处理不是产生该现象的必要条件。单次模式更快，使 continuous 成为优先验证的配置因素；但不能据一次对照把 continuous 定为唯一根因，尤其两组首次结果时间也明显不同。speechend 指标缺失不能推断没有停顿或端点检测失败，也不能补零。

下一步在同一 Chrome、麦克风和网络下，保持两页都打开，按 true/false 交替各补 9 次，每轮只说一次并等待 final，记录失败轮次。若差异稳定，再评估配置变更是否满足原有持续监听与恢复契约。当前 continuous=false 会改变引擎的会话结束行为，直接采用并依赖既有 onend 重启还会引入原有重启间隔；不能将其当作无行为变化的一行修复。本轮未修改任何生产配置或业务逻辑。

- `browser.ts:commandRecognition()` 使用 SpeechRecognition，缺失时回退 webkitSpeechRecognition；配置原本就是 zh-CN、continuous=true、interimResults=true。本轮未改变配置。
- `index.ts:startCommands()` 的 onresult 同步遍历 resultIndex 之后的变化结果。interim 直接跳过；final 按 index 去重，然后执行 commandOf() 并同步 emit()。这段没有 Promise、setTimeout、缓存等待或异步过滤。
- `protocol.ts:commandOf()` 去首尾空白、末尾指定标点后匹配完整短语。包含“开始输入”的更长句子仍不会触发命令；诊断 T4/T5 的包含判断不参与业务。
- App 的 onCommand 使用一次 queueMicrotask，因为 M1 禁止通知回调中嵌套修改。这是原有协调规则，必须保留。微任务通常很快，但可能受当前任务或其他微任务阻塞，需要实际测量。
- 麦克风权限 Promise 发生在 engine.start() 前，不在已开始说话后的结果处理路径中。10 秒定时器是启动超时保护；1 秒定时器只用于 onend 后重启；都不解释一次活跃监听中的 final 等待，均未修改。
- 每次 startCommands 创建一个引擎；generation、engine 身份、started 和 LISTENING 检查阻止过期回调。detachCommands 清理回调并 abort。静态审查未发现正常路径上重复启动、重复分发的证据；异常重启仍需真实事件日志验证。
- 没有在该处理链中发现显式长计算。但静态审查无法排除浏览器主线程长任务，也不能把事件回调到达前的全部耗时归于识别服务器。

Web Speech 规范没有给出 final 延迟保证；continuous 控制连续结果，interimResults 控制是否返回临时结果，不能据此推断关闭哪个配置就会更快。[规范](https://webaudio.github.io/web-speech-api/)。Chromium 存在通过远程流式服务实现的网络识别引擎，因此网络是待验证因素，不能据此认定本次是网络问题。[Chromium 源码](https://chromium.googlesource.com/chromium/src/+/lkgr/content/browser/speech/network_speech_recognition_engine_impl.h)。

## 3. 方案

仅添加可关闭的诊断，保留现有异常处理与恢复。开发环境或显式 m1-debug 构建中使用 `?m1Debug=1` 开启；普通生产构建即使带此参数也不会开启。关闭时不注册新增观测事件、不建立时间点 Map、不创建定时器或 PerformanceObserver。

日志只输出时间、索引、监听编号、命令类型及数值差值，不包含语音文本、音频、URL、密钥或服务错误原文。Console 本身会带来开销；T5→T6/T6→T7 的微小差值不能过度解读。

## 4. 代码变更

| 文件 | 变更 |
| --- | --- |
| src/modules/m1-speech-recognition/browser.ts | 内部结构类型补充可选音频/声音/语音事件，不改初始化配置 |
| src/modules/m1-speech-recognition/debug.ts | 提取既有诊断开关判断供时间点采样复用 |
| src/modules/m1-speech-recognition/command-timing.ts | 新增时间点采样、缺失值处理、分段差值和内部同步分发上下文 |
| src/modules/m1-speech-recognition/index.ts | startCommands/detachCommands 注册和清理诊断事件；onresult 采样并关联同步分发 |
| src/app/useManualWorkflow.ts | onCommand 捕获诊断上下文，在原微任务中标记 T7；不改原有检查或路由 |
| tests/unit/m1-speech-recognition/command-timing.test.ts | 时间差、缺失事件、不同索引、零时间戳、上下文恢复和生产关闭测试 |
| tests/unit/m1-speech-recognition/speech-recognition.test.ts | 原诊断断言允许新增时间日志，保留原命令断言 |
| tests/integration/voice-m1.test.ts | 增加 M1→App 关联、原微任务和重复 final 只启动一次的验证 |
| tests/manual/web-speech-latency.html | 独立原生 API 复现页，不加载 Vue、M1 或科大讯飞，不执行业务命令 |

诊断完成后可以移除新增 helper、观测回调和 App 两处采样调用，并将 debug.ts 恢复原开关内联；无需迁移数据或修改业务模块。

## 5. 性能对比与实测步骤

下表为首轮自动化验证结束时的记录；真实 Chrome 跟进增加了一轮未成功触发命令的异常观察，仍没有修复前后成对的有效命令样本。

| 指标 | 修改前有效样本 | 修改后有效样本 | 中位数 / P90 |
| --- | --- | --- | --- |
| T2→T3 首次结果 | 0 | 0 | 未测量 |
| T3→T5 最终确认 | 0 | 0 | 未测量 |
| T5→T6 M1 处理 | 0 | 0 | 未测量 |
| T6→T7 App 处理 | 0 | 0 | 未测量 |

本次没有性能修复，所以不存在已证明的修复前后改善。Mock 时钟测试仅证明计算与控制流正确，不能证明真实识别速度。

### App 采集

1. 使用符合项目 engines 要求的 Node 启动 `npm run dev`；在原有可用代理配置及登录环境中打开 localhost 或 HTTPS 页面，附加 `?m1Debug=1`。不更改代理配置。Console 打开 Verbose/Debug；开始监听后等待 command-listening-started。
2. 每轮只说一次“开始输入”，保持固定麦克风、距离、音量和停顿；等待 final、命令处理后按原流程结束录入，再开始下一轮。记录 listeningId、index，保留失败、未匹配与重启次数，避免只挑最快结果。
3. `command-latency` 直接给出 t2ToT3Ms、t3ToT5Ms、t5ToT6Ms；同 ID/index 的 T7 日志给出 t6ToT7Ms，并拆分 dispatchToReceiptMs、receiptToHandlingMs。T4 未返回时保留缺失，不补零；若未来原配置为 interimResults=false，T4 不可观测，不为诊断改变该配置。
4. 下面代码在 Console 中、开始监听前运行，可收集随后日志中的四项指标。采集后调用 `speechLatencySummary()`。采集结束调用 `restoreSpeechLatencyConsole()` 恢复 Console，不刷新其他页面状态。

```js
const originalSpeechDebug = console.debug
const speechLatencyRows = new Map()
console.debug = function (...args) {
  const [tag, data] = args
  if (tag === '[M1]' && data && (data.event === 'command-latency' || data.point === 'T7')) {
    const key = `${data.listeningId}:${data.index}`
    const row = speechLatencyRows.get(key) ?? {}
    for (const name of ['t2ToT3Ms', 't3ToT5Ms', 't5ToT6Ms', 't6ToT7Ms']) {
      if (Number.isFinite(data[name])) row[name] = data[name]
    }
    speechLatencyRows.set(key, row)
  }
  return originalSpeechDebug.apply(console, args)
}
window.restoreSpeechLatencyConsole = () => { console.debug = originalSpeechDebug }
window.speechLatencySummary = () => ['t2ToT3Ms', 't3ToT5Ms', 't5ToT6Ms', 't6ToT7Ms'].map(metric => {
  const values = [...speechLatencyRows.values()].map(row => row[metric]).filter(Number.isFinite).sort((a, b) => a - b)
  const n = values.length
  return { metric, n,
    median: n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : undefined,
    p90: n ? values[Math.ceil(n * .9) - 1] : undefined }
})
```

每个比较条件至少 10 次有效识别；每项指标独立报告有效 n，缺事件的轮次仍保留其他可计算指标。P90 使用 nearest rank：升序第 ceil(0.9n) 项，中位数使用中间两项平均。n=10 时 P90 只是第 9 项，波动很大；少于 10 次不足以完成要求，不能下“稳定改善”的结论。若后续证实并修复应用延迟，基线和修复版必须使用相同诊断代码、浏览器版本和采样条件，交替采集，避免环境漂移。

### 最小复现与环境对比

- 为简化人工操作，独立页新增 `?compare=1`：每次点击开始自动交替两种模式，在收到 final 并采样后结束本轮，各达到 10 个有效样本时停止；页面直接显示进度、分组统计和失败/取消轮次。不会自动开启下一轮，也不会强制提前产生 final。原有不带 compare 的测试方式保留。新增页面逻辑经过脚本语法检查及模拟 20 轮有效 final/1 轮未匹配 final 的控制流检查；模拟不属于真实延迟数据。

- 通过同一 Vite 开发服务打开 `/tests/manual/web-speech-latency.html`，默认与项目相同：zh-CN、continuous=true、interimResults=true。每次点击开始，说一次命令，等待 final，再结束。没有自动重启。Console 的 `speechLatency.samples` 只有时间和匹配标记；`speechLatency.summary()` 返回浏览器阶段的 n、中位数、P90。这里没有 T6/T7。
- 独立页面用 `?continuous=0` 进行配置对比，或 `?interim=0` 验证 final-only 行为，分别至少 10 次。一次只改变一个变量。这些参数仅用于独立页，结果更快也不能直接应用到现有 M1：单次模式会改变监听结束及重启行为。
- 同一 Chrome 版本和配置，对比原 App 与独立页；记录版本、系统、麦克风型号、网络类型及代理/VPN 状态。再逐项比较干净 Chrome 配置/禁用扩展、另一麦克风、可用网络、localhost 与 HTTPS。不要一次改变多项；没有复现不等于修复。
- 在 DevTools Performance 中记录一次慢样本，检查 T2–T5 是否覆盖主线程长任务，T6–T7 是否存在任务/微任务阻塞。性能录制另开诊断轮次，避免录制开销污染主要对比数据。Console 只记录上述安全错误码，不导出带文本的原始事件对象。

判读：T4 很早但 T5 很晚，说明 final 确认阶段耗时；语音结束事件迟到，支持检查端点检测，但仍需对照；speechend 很早而 final 晚，只能定位到结束检测后的结果交付区间，不能单凭日志区分网络与服务。T5→T6 大则检查同步处理/日志开销；T6→T7 大则检查订阅者执行和微任务排队。T2→T3 大且主线程没有对应阻塞，支持进一步排查浏览器/识别服务。所有时间戳都是 JavaScript 回调执行时间，不是音频物理采样或服务器内部时间。

## 6. 回归验证

- Node 24.22.1：28 个测试文件通过，1502 个测试通过，1 个原有 todo。
- `npm run type-check` 通过；Vite 生产构建通过。
- 新测试验证诊断计算、T7 关联、final 去重及原微任务保留；原命令、状态恢复、结束录入、M2–M5 和数据流相关测试均通过。
- 系统默认 Node 23.1.0 缺少 node:sqlite，且不符合项目 engines；使用已安装 Node 24.22.1 重跑。代理本地套接字测试在沙箱因 EPERM 失败，经允许本地监听后全量通过，没有修改代理。
- 未完成真实 Chrome 口述识别、实际事件序列、浏览器错误/网络状态检查或至少 10 次实测；也未验证真实科大讯飞服务端流程。自动化仅替换浏览器/音频边界验证回归，不是实际网络识别证据。

## 7. 业务完整性确认

M1–M5 业务职责、Public Interface、数据模型、状态机和转换规则保持不变；命令仍只依据完整 final，去重条件不变；App→M1→M2→M3 的数据流、原微任务及所有业务定时器保留。没有修改 UI、提示、科大讯飞、签名、WebSocket、音频传输、异常处理或引入依赖。

工作区在本轮开始时已有其他修改，包括代理、package.json、锁文件、构建入口及文档；本轮没有改动这些既有修改。根因尚未证实，因此没有强行调整配置或声称消除浏览器服务延迟。
