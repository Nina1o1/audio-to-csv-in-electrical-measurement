# Public Interface Contract（修订版）

日期：2026-10-26

本文件保留原有方法签名和类型，只补全行为。共享 [Data Models](data-models.md) 不变。第 1–6 节是修订后的行为约定，第 7 节保留完整公开声明；旧文档中与本文件不同的行为说明以本文件为准。当前仅整理文档，不实现代码。

## 1. 所有模块共同遵守

- 业务模块只由 App 协调，不直接调用其他业务模块。
- TypeScript 类型不能代替运行时校验。非法输入不得造成部分修改。
- 返回值、事件参数和传入后留存的数据必须隔离嵌套对象引用，外部修改不能影响模块内部。
- 订阅回调抛错应单独报告，不能改变已完成操作的结果，也不能阻止其他订阅者收到通知。
- 通知期间发起的业务变更不得嵌套执行，应拒绝并由 App 在通知结束后重新发起。只读查询可以执行。此规则避免事件重入造成顺序混乱。
- 新记录首次创建时，ID 唯一，createdAt 与 updatedAt 相同；时间由系统生成。历史修改保留 ID、createdAt，实际变化才更新 updatedAt。
- 测量值要求有限、非负，允许 0，不擅自设置量程上限，也不自动四舍五入。标准单位为 mΩ、MΩ、V。PASS/FAIL 由用户输入，不从测量值自动推导。
- 字符串必填且不能只有空白；保存时不擅自改变标识符大小写或内部空格。

上述数值规则用于数据有效性检查，不代表工业检验合格标准。若实际业务标准不同，须先修订规则。

## 2. M1：语音识别

| 接口/事件 | 修订后的行为 |
|---|---|
| startListening | 仅 IDLE 可启动；浏览器确认启动后才 resolve 并进入 LISTENING。启动尚未完成时，重复请求拒绝，不重复启动。失败回到 IDLE，通过原 SpeechError 报告。 |
| startRecording | 仅 LISTENING 生效，进入 RECORDING 并清空本次缓冲；非法状态不修改数据。 |
| stopRecording | 只处理当前录入，输出已确认文本，最多产生一次完成事件；重复停止不重复通知。正常目标状态为 LISTENING。 |
| stopListening | 任意状态可请求停止。录入中先结束并输出已确认文本，再进入 IDLE；IDLE 无操作。启动尚未完成时也要记住停止意图，迟到的启动结果不能重新开启监听。 |
| onTranscriptUpdate | 只用于展示本次完整实时快照；不能把每次更新追加成历史或直接写草稿。 |
| onTranscriptComplete | 每次录入最多一次，只包含已确认文本，不含 interim 文本和控制命令。中断时也保留已确认文本。 |
| onCommand | 只从已确认结果识别命令；LISTENING 可识别全部命令，RECORDING 仅识别 STOP_INPUT。由 App 判断业务命令是否可执行。 |

“结束输入”和“结束录入”都映射为 STOP_INPUT。页面“监听”按钮在录入期间禁用；“结束录入”按钮调用 stopRecording，保留已确认文本并返回监听。stopListening 保留原底层行为，用于页面退出或异常清理，不要求录入期间提供 UI 切换入口。

长停顿导致的正常识别结束按以下固定规则处理，不引入新依赖：

- 无错误的自然结束，在仍需要监听或录入时，等待 1 秒后续接；保留本次 confirmed 文本，丢弃未确认 interim，不发完成事件。
- 连续 3 次续接仍没有新的已确认识别结果时停止；收到新的已确认结果后计数归零。每次启动最多等待 10 秒。
- 用户结束录入、关闭监听或离开页面时取消待执行续接。结束录入只完成本次片段；后续监听使用新的操作标记，关闭监听则进入 IDLE。
- 权限、设备、识别错误、启动超时或续接耗尽时，不自动重试；录入中输出已确认文本一次，进入 IDLE，并用原 SpeechError 报告。超时和续接耗尽使用 RECOGNITION_FAILED。
- 单次录入不设置总时长限制；上述次数只是无有效结果时的保护，不保证无限连续识别。手动输入始终可用。

内部使用操作标记过滤迟到回调，不增加公开状态枚举。

不保留累计转写历史。App 只展示本次录入内容；开始下一次录入时替换，草稿成功保存或确认删除后清空展示。

## 3. M2：文本解析

`parse(segment)` 保持同步、无副作用，不读取草稿。

- 未提及、无法识别的字段不输出；没有有效字段返回 `{}`。
- 无关内容跳过；字段顺序不限；同字段取文本中最后一个有效值。
- 语音测量更新须明确识别数值及单位，成功转换后输出完整 `{ value, unit }`。缺少数值或单位时不输出该测量字段；可通过手动方式补充。
- 换算后也必须满足有限、非负要求。后续无效表达不清空之前的有效值。
- 不输出 null，不修改 segment，不负责整份草稿完整性校验。
- segment 结构非法（例如 text 不是字符串）时抛 TypeError；空文本属于正常输入，返回 `{}`。

MeasurementUpdate 保持原来的 Partial 类型；M3 仍按属性合并。M2 第一版采用完整测量输出策略，不改变共享模型。

### 第一版固定词表

采用本地规则解析，不安装 NLP、AI SDK 或外部解析服务。仅承诺下列范围；未支持内容不猜测，可手动填写。

| 字段 | 接受的名称 |
|---|---|
| workOrder | 工单号、工单 |
| partNumber | 零件号、零件编号 |
| contactResistance | 接触电阻 |
| insulationResistance | 绝缘电阻 |
| withstandVoltage | 耐压、耐压值 |
| result | 检验结果、结果 |

- 字段名后允许空白，以及“是”“为”“改成”“改为”、冒号等连接词。标识符和值必须有明确字段名；结果也必须带字段名，不把无关的“通过”写成结果。
- 工单号、零件号只接受识别文本中已经出现的 ASCII 字母、数字、连字符、下划线组成的连续标识符，例如 A2301、P-007。去掉字段周围的分隔空白，保留标识符大小写和前导零。不把“诶”“杠”等口述词猜成字符，也不拼接被空格拆开的标识符片段；这类输入请手动修正。
- 测量值支持阿拉伯十进制整数/小数，以及一千以内的常用中文数词：零/〇、一至九、两、十、百、千及规范组合；小数用“点”后逐位读数。也接受逐位数字串，如“一二点五”→12.5。不支持万/亿、分数、科学计数法、千位分隔符或混合中阿数字。
- 数词须完整匹配，不能从负数、指数、分数或不合法组合中截取一段有效数字。负号、“负”及范围表达都不形成有效测量更新。
- 结果映射：PASS（忽略英文大小写）、合格、通过 → PASS；FAIL（忽略英文大小写）、不合格、不通过 → FAIL。按完整结果词匹配，先识别较长词，避免“不合格”误判为“合格”。

| 单位词 | 原值乘数 → 标准单位 |
|---|---|
| mΩ、毫欧、毫欧姆 | ×1 → mΩ（接触电阻） |
| Ω、欧、欧姆 | ×1000 → mΩ（接触电阻）；×0.000001 → MΩ（绝缘电阻） |
| MΩ、兆欧、兆欧姆 | ×1 → MΩ（绝缘电阻） |
| V、伏、伏特 | ×1 → V（耐压） |
| kV、千伏、千伏特 | ×1000 → V（耐压） |

单位符号大小写严格区分，mΩ 与 MΩ 不能混淆；不按大小写模糊推断单位。只接受表内与目标字段匹配的单位。

### 最小验收样例

| 输入 | 预期 |
|---|---|
| 工单号 A2301，零件号 P-007 | workOrder=A2301；partNumber=P-007 |
| 接触电阻十二点五毫欧 | contactResistance={value:12.5,unit:"mΩ"} |
| 接触电阻 0.015 欧 | contactResistance={value:15,unit:"mΩ"} |
| 绝缘电阻两百兆欧，耐压一点五千伏，结果不合格 | 200 MΩ；1500 V；FAIL |
| 接触电阻 12 毫欧，接触电阻改成 15 毫欧 | 接触电阻为 15 mΩ |
| 接触电阻 12 毫欧，接触电阻改成负三毫欧 | 保留该片段中最后有效值 12 mΩ |
| 接触电阻 12 | 不输出接触电阻 |
| 零件号诶零零七 | 不输出零件号，手动补充 |
| 今天设备已经检查过了 | {} |

## 4. M3：草稿与保存状态

### 编辑和校验

- 只在 IDLE 允许 applyParseResult、updateField、updateMeasurement。
- 语音按字段、测量属性合并；缺少的属性保持原值。null 不能清空已有值，应忽略该空更新。其他非法解析数据应整批拒绝，不部分合并。
- App 仅在 M3 为 IDLE 且未进行结构化处理时开放手动编辑；CONFIRMING_SAVE、CONFIRMING_DELETE、SAVING 均冻结草稿。录音中如满足上述条件可编辑，解析合并期间暂时禁用。
- 手动编辑可用 null 单独清空字段或测量属性。App 将空输入转换为 null，不能把空字符串转换成数字 0。
- validate 不改数据或状态；requestSave 校验成功才进入 CONFIRMING_SAVE。两者返回全部错误。
- 必填、字符串、有限非负数字、标准单位和结果枚举都要检查；历史和导出入口采用同一套有效性规则。
- 非法状态调用抛 Error；结构/类型非法抛 TypeError；不得修改草稿、pending 或状态。不新增公开错误类型。

### 保存与重试

| 操作 | 前态 | 结果 |
|---|---|---|
| requestSave | IDLE | 无效则保持 IDLE；有效则进入 CONFIRMING_SAVE，草稿冻结。 |
| cancelSave | CONFIRMING_SAVE | 返回 IDLE，保留草稿及仍有效的 pending。 |
| confirmSave | CONFIRMING_SAVE | 首次生成完整 pending；若为未改动草稿的重试，复用原 ID、内容和全部时间戳；进入 SAVING，返回独立快照。 |
| completeSave | SAVING | 仅在 M4 明确成功后调用；清空草稿和 pending，回到 IDLE。 |
| failSave | SAVING | 仅在 M4 明确失败后调用；保留草稿及完整 pending，回到 IDLE。 |

失败后，只有草稿实际变化才使旧 pending 失效；下次确认生成新 ID。相同值编辑、空解析结果不使 pending 失效。确认删除草稿时同时清除 pending；取消删除保留两者。

SAVING 时重复保存、编辑、删除或取消均拒绝。结果不确定时保持 SAVING，不清空，不调用 failSave，不生成新 ID。App 保留 confirmSave 返回的快照供协调；不增加 pending 查询接口。

草稿删除仍使用 requestDelete → confirmDelete/cancelDelete；不调用 M4。

## 5. M4：正式记录与 localStorage

### 初始化和格式

- 固定 key：`inspection-records:v1`；值为 JSON 编码的 `InspectionRecord[]`，不增加包装字段，不改变模型。
- key 不存在才初始化为 `[]`；读取失败、JSON 错误、无效记录或重复 ID 都必须整体拒绝。
- 初始化失败保持未初始化，所有业务查询和写入抛 NOT_INITIALIZED；保留原始存储，不自动修复、清空或部分加载。
- 初始化成功后重复 initialize 返回当前快照，不重新读盘覆盖内存。失败后允许用户修复外部原因再重试初始化。
- 后续升级不能仅更换 key 就把旧数据当空集合；迁移须另行设计，不在本版自动执行。

### 写入和结果边界

1. 在写入前完成运行时校验、复制、完整新集合构造和 JSON 序列化。
2. 调用 localStorage.setItem；正常返回即视为持久化提交成功。
3. 提交预先准备好的内存集合。
4. 向订阅者发独立快照；通知异常单独报告，不向调用者伪装成写入失败。

已知写入失败：内存不提交，不发变更通知，按原 RecordErrorCode 抛错。App 不得把提交之后的渲染或通知异常归为 STORAGE_WRITE_FAILED。

| 接口 | 关键约束 |
|---|---|
| save | 同 ID 且全部持久化字段相同：幂等成功，不写、不通知；同 ID 不同内容：DUPLICATE_ID，不覆盖。首次保存前必须校验完整记录。 |
| update | 仅允许 InspectionFields 字段；运行时拒绝 id、createdAt、updatedAt 或其他额外键。测量必须完整提交。验证合并后的整条记录。无变化不写、不更新时间、不通知。不存在抛 RECORD_NOT_FOUND。 |
| delete | 不存在返回 false；存在时先写后提交。写失败保留原记录。 |
| getAll/query/getById | 返回独立快照，不能修改内存集合或存储。query 条件 AND，工单号包含匹配且忽略大小写、查询两端空白；日期含边界。 |
| onRecordsChange | 只通知实际成功持久化的变化；initialize、查询、幂等保存、无变化修改和失败不通知。 |

默认 createdAt DESC、同时间 id ASC。时间按实际时刻比较。其他排序出现相同值时也以 id ASC 稳定排序。

### 时间和排序的固定规则

- 记录时间和 RecordQuery 的时间边界统一使用 UTC、毫秒精度格式：YYYY-MM-DDTHH:mm:ss.sssZ，例如 2026-10-26T01:30:00.000Z。新增时间使用 Date.toISOString() 的标准形式。
- 校验时先检查完整格式，再检查日历合法性，并进行解析后原格式往返比对；拒绝 2 月 30 日等被宽松解析器自动修正的日期。updatedAt 不得早于 createdAt。若设备时钟回退，更新时取当前时间与原 updatedAt 的较大值。
- UI 显示及输入采用浏览器所在设备的本地时区，并标出时区。日期时间输入精确到秒；App 补毫秒：起点 .000，终点 .999，然后转为 UTC。仅选择日期时，起点为本地 00:00:00.000，终点为本地 23:59:59.999；不靠加固定 24 小时计算次日。
- 不存在或有歧义的本地时间（如夏令时切换）拒绝并提示换一个明确时间，不默选时区偏移。不为此安装日期库。
- M4 只接受上述 UTC 格式；非法边界、起点晚于终点均报 INVALID_QUERY。CSV 保留 UTC 原值。
- 工单号使用区分大小写的确定性字典序（JavaScript 字符串比较），不使用自然排序或依赖地区的 localeCompare；A10 排在 A2 前。工单号相同时按 id ASC；创建时间相同时也按 id ASC，主排序降序不改变 ID 的升序规则。

### 不确定结果

本版 save 是同步调用，不引入网络式超时或后台重试。正常返回即成功；明确的写入前/写入失败按原错误处理。

出现意外的提交后异常时，先保持 SAVING 和原 pending，禁止其他历史写入，并提供“核对保存结果”按钮。用现有接口恢复，不新增方法：

1. App 在原调用和通知结束后暂停 M4 操作，取消旧 M4 的订阅；保留草稿、pending、选择和查询。
2. 创建新的 M4 实例并调用 initialize，由 M4 重新读取并整体校验持久化数据；不能复用旧实例 initialize 的缓存，也不能由 App 直接访问存储。
3. 初始化成功后替换旧实例并重新订阅。用新实例 getById(pending.id) 核对全部持久化字段：
   - ID 存在且全部相同：视为保存成功，调用 M3.completeSave。
   - ID 不存在：已确认未持久化该记录，调用 M3.failSave；允许用户再次确认，仍复用完整 pending。
   - 同 ID 内容不同：显示冲突，继续冻结保存，不自动覆盖、清空或生成新 ID。
4. 读取失败或数据损坏：继续冻结，不调用 failSave、不写入；允许再次点击核对。未核对成功前不得重新启用旧实例写入。

核对不自动循环，不安装恢复库。页面刷新会按既定规则丢失草稿及 pending，因此该恢复入口必须在当前页面执行；不新增草稿持久化。

## 6. M5：CSV

- generateCsv 先校验整批数据；任何记录无效则整体失败，不返回部分文件。
- 保留输入顺序；正确转义逗号、双引号、换行；行分隔符 CRLF。
- 固定 12 列及顺序：ID、工单号、零件号、接触电阻值、接触电阻单位、绝缘电阻值、绝缘电阻单位、耐压值、耐压单位、检验结果、创建时间、修改时间。
- 第一版优先安全地用 Excel 打开：对文本单元格检查原文及前置空白/控制字符后的危险前缀 `=`、`+`、`-`、`@`，以及前置制表/回车/换行；危险内容在原文前加单引号，再做 CSV 转义。加双引号本身不等于公式防护。
- 防护只改变导出文本，不修改原记录；不承诺 CSV 原文无损往返。
- generateCsv 不带 BOM、不下载；export 默认文件名 inspection-records.csv、includeBom=true，按原文件名规则校验并释放临时资源。
- 成功只表示下载已发起，不表示用户已保存到磁盘。
- App 决定导出集合：选中项按 ID 从 M4 获取最新记录；全部导出不受当前筛选限制。空集合不下载。失效选择清除，并提示实际导出数量。

## 7. 公开声明

以下声明来自原 Public Interface；只移除原注释，未修改类型或方法签名。共享基础类型见 data-models.md。行为以本文件前述章节为准。

### M1

```typescript
type MicrophoneState =
  | "IDLE"
  | "LISTENING"
  | "RECORDING";

interface TranscriptSegment {
  text: string;
}

type VoiceCommand =
  | "START_INPUT"
  | "STOP_INPUT"
  | "SAVE"
  | "CONFIRM_SAVE"
  | "MODIFY"
  | "DELETE"
  | "CONFIRM_DELETE"
  | "KEEP";

interface TranscriptUpdate {
  confirmedText: string;
  interimText: string;
}

type SpeechErrorCode =
  | "NOT_SUPPORTED"
  | "PERMISSION_DENIED"
  | "MICROPHONE_UNAVAILABLE"
  | "RECOGNITION_FAILED";

interface SpeechError {
  code: SpeechErrorCode;
  message: string;
}

interface SpeechRecognitionModule {

  startListening(): Promise<void>;

  stopListening(): void;

  startRecording(): void;

  stopRecording(): void;

  getState(): MicrophoneState;

  onStateChange(
    callback: (state: MicrophoneState) => void
  ): () => void;

  onCommand(
    callback: (command: VoiceCommand) => void
  ): () => void;

  onTranscriptUpdate(
    callback: (update: TranscriptUpdate) => void
  ): () => void;

  onTranscriptComplete(
    callback: (segment: TranscriptSegment) => void
  ): () => void;

  onError(
    callback: (error: SpeechError) => void
  ): () => void;
}
```

### M2

```typescript
interface TextParserModule {

  parse(segment: TranscriptSegment): ParseResult;
}
```

### M3

```typescript
type DraftState =
  | "IDLE"
  | "CONFIRMING_DELETE"
  | "CONFIRMING_SAVE"
  | "SAVING";

type SimpleDraftField =
  | "workOrder"
  | "partNumber"
  | "result";

type MeasurementField =
  | "contactResistance"
  | "insulationResistance"
  | "withstandVoltage";

type MeasurementProperty =
  | "value"
  | "unit";

type DraftValidationErrorCode =
  | "REQUIRED"
  | "INVALID_VALUE"
  | "INVALID_UNIT";

interface DraftValidationError {
  field: keyof DraftFields;
  property?: MeasurementProperty;
  code: DraftValidationErrorCode;
  message: string;
}

interface DraftValidationResult {
  valid: boolean;
  errors: DraftValidationError[];
}

interface DraftManagerModule {

  getDraft(): DraftFields;

  getState(): DraftState;

  applyParseResult(
    result: ParseResult
  ): DraftFields;

  updateField<K extends SimpleDraftField>(
    field: K,
    value: DraftFields[K]
  ): DraftFields;

  updateMeasurement<
    K extends MeasurementField,
    P extends MeasurementProperty
  >(
    field: K,
    property: P,
    value: DraftFields[K][P]
  ): DraftFields;

  validate(): DraftValidationResult;

  requestDelete(): void;

  confirmDelete(): void;

  cancelDelete(): void;

  requestSave(): DraftValidationResult;

  cancelSave(): void;

  confirmSave(): InspectionRecord;

  completeSave(): void;

  failSave(): void;

  onDraftChange(
    callback: (draft: DraftFields) => void
  ): () => void;

  onStateChange(
    callback: (state: DraftState) => void
  ): () => void;
}
```

### M4

```typescript
type RecordSortField =
  | "workOrder"
  | "createdAt";

type SortDirection =
  | "asc"
  | "desc";

interface RecordQuery {

  workOrder?: string;

  createdFrom?: string;

  createdTo?: string;

  sortBy?: RecordSortField;

  sortDirection?: SortDirection;
}

type RecordUpdate = Partial<InspectionFields>;

type RecordErrorCode =
  | "NOT_INITIALIZED"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_DATA_CORRUPTED"
  | "INVALID_DATA"
  | "INVALID_QUERY"
  | "RECORD_NOT_FOUND"
  | "DUPLICATE_ID";

interface RecordManagerError extends Error {
  code: RecordErrorCode;
}

interface RecordManagerModule {

  initialize(): InspectionRecord[];

  save(
    record: InspectionRecord
  ): InspectionRecord;

  getAll(): InspectionRecord[];

  getById(
    id: string
  ): InspectionRecord | null;

  query(
    query: RecordQuery
  ): InspectionRecord[];

  update(
    id: string,
    changes: RecordUpdate
  ): InspectionRecord;

  delete(
    id: string
  ): boolean;

  onRecordsChange(
    callback: (
      records: InspectionRecord[]
    ) => void
  ): () => void;
}
```

### M5

```typescript
interface CsvExportOptions {
  filename?: string;
  includeBom?: boolean;
}

interface CsvExportResult {
  filename: string;
  recordCount: number;
}

type CsvExportErrorCode =
  | "EMPTY_RECORDS"
  | "INVALID_RECORD"
  | "INVALID_FILENAME"
  | "CSV_GENERATION_FAILED"
  | "DOWNLOAD_FAILED";

interface CsvExportError extends Error {
  code: CsvExportErrorCode;
}

interface CsvExporterModule {

  generateCsv(
    records: readonly InspectionRecord[]
  ): string;

  export(
    records: readonly InspectionRecord[],
    options?: CsvExportOptions
  ): CsvExportResult;
}
```
