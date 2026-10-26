# M2 业务验收报告

> 本文件保留 Debugging 前的验收快照。后续发现的缺陷、修复结果及当前 TODO 状态见 [Debugging 回归报告](DEBUG-REPORT.md)，请勿将本快照中的计数或“未发现”结论当作最新状态。

日期：2026-10-26（Asia/Shanghai）。范围：测试和报告；未修改生产代码、共享类型、已有测试或正式契约。

## 结论

明确契约范围内验收通过，尚不能宣称所给57条业务需求全部通过。49条CONTRACT全部通过，5条NEEDS_SPEC、3条CONFLICT不计入通过或失败。没有发现本轮已执行契约场景下可复现的错误测量值、错误覆盖或错误字段更新。

这里的3项CONFLICT是已获用户确认的受限纠正规则尚未同步Public Interface造成的文档冲突，不是撤销先前确认，也不是要求回改现有纠正实现。

## 基准与分类口径

已完整阅读 architecture.md、data-models.md、public-interface.md，以及M2实现和现有测试。最终正式业务基准为Public Interface第1、3、7节。

- 所有57条原始输入与ID保留在 cases.ts 中，逐项分类如下表。
- Group D明确要求表外单位标NEEDS_SPEC，因此表外单位预期即使与现表不兼容，也不重复计入CONFLICT。G03按同样原因处理。
- Public Interface明文要求“标识符和值必须有明确字段名”。E08/E09/G05省略字段名，按本轮正式文档口径列CONFLICT；前轮确认和README可证明预期已有业务授权，但尚未完成正式契约同步。
- 待定项使用test.todo，不编造预期、不使用test.fails，也不把当前实现当作预期来源。
- 现有测试含前轮获批扩展，原样保留；全量测试通过数不等同于本轮正式契约验收通过数。

## 执行结果

| 范围 | 总数 | 通过 | 失败 | NEEDS_SPEC | CONFLICT |
|---|---:|---:|---:|---:|---:|
| 用户A–G业务样例 | 57 | 49 | 0 | 5 | 3 |
| 新增边界/运行时校验 | 38 | 36 | 0 | 2 | 0 |
| 本轮新增验收文件 | 95 | 85 | 0 | 7 | 3 |
| M2专项（含已有测试） | 339 | 329 | 0 | 7 | 3 |
| 全量Vitest | 875 | 865 | 0 | 7 | 3 |

Vitest汇总显示10 todo；不是10项通过。新增36个可执行边界测试=26条X表用例+9条非法segment+1条X27隔离测试。

已执行：

- npm run type-check：通过。
- npm test -- tests/unit/m2-text-parser：3个文件，329通过、0失败、10 todo。
- npm test：11个文件，865通过、0失败、10 todo。
- npm run build：类型检查和Vite构建均通过。

## 各组结果

| 组 | 总数 | CONTRACT通过 | 失败 | NEEDS_SPEC | CONFLICT |
|---|---:|---:|---:|---:|---:|
| A | 7 | 7 | 0 | 0 | 0 |
| B | 8 | 8 | 0 | 0 | 0 |
| C | 5 | 5 | 0 | 0 | 0 |
| D | 12 | 8 | 0 | 4 | 0 |
| E | 10 | 8 | 0 | 0 | 2 |
| F | 10 | 10 | 0 | 0 | 0 |
| G | 5 | 3 | 0 | 1 | 1 |

## 57条业务样例逐项分类与结果

预期是按稀疏ParseResult补全后的完整对象；数值采用近似断言，键集合与原始类型严格断言。待定项列出用户候选预期，不执行该预期的契约断言。

| ID | 输入 | 分类 | 完整预期／候选预期 | 结果 |
|---|---|---|---|---|
| A01 | 接触电阻12毫欧 | CONTRACT | {"contactResistance":12} | PASS |
| A02 | 绝缘电阻20兆欧 | CONTRACT | {"insulationResistance":20} | PASS |
| A03 | 耐压500伏 | CONTRACT | {"withstandVoltage":500} | PASS |
| A04 | 接触电阻12 | CONTRACT | {"contactResistance":12} | PASS |
| A05 | 绝缘电阻20 | CONTRACT | {"insulationResistance":20} | PASS |
| A06 | 耐压500 | CONTRACT | {"withstandVoltage":500} | PASS |
| A07 | 接触电阻12毫欧，绝缘电阻20兆欧，耐压500伏 | CONTRACT | {"contactResistance":12,"insulationResistance":20,"withstandVoltage":500} | PASS |
| B01 | 今天先检查一下，接触电阻12毫欧 | CONTRACT | {"contactResistance":12} | PASS |
| B02 | 好的，现在开始，绝缘电阻20兆欧 | CONTRACT | {"insulationResistance":20} | PASS |
| B03 | 这个零件看起来还不错，耐压500伏 | CONTRACT | {"withstandVoltage":500} | PASS |
| B04 | 接触电阻12毫欧，今天就测到这里 | CONTRACT | {"contactResistance":12} | PASS |
| B05 | 今天是星期三，接触电阻12毫欧 | CONTRACT | {"contactResistance":12} | PASS |
| B06 | 今天检查了3个零件，接触电阻12毫欧 | CONTRACT | {"contactResistance":12} | PASS |
| B07 | 天气很好，准备下班了 | CONTRACT | {} | PASS |
| B08 | 这里有12个零件，检查完成 | CONTRACT | {} | PASS |
| C01 | 耐压500伏，绝缘电阻20兆欧 | CONTRACT | {"withstandVoltage":500,"insulationResistance":20} | PASS |
| C02 | 绝缘电阻20兆欧，接触电阻12毫欧 | CONTRACT | {"insulationResistance":20,"contactResistance":12} | PASS |
| C03 | 耐压500伏，接触电阻12毫欧，绝缘电阻20兆欧 | CONTRACT | {"withstandVoltage":500,"contactResistance":12,"insulationResistance":20} | PASS |
| C04 | 绝缘电阻20，耐压500，接触电阻12 | CONTRACT | {"insulationResistance":20,"withstandVoltage":500,"contactResistance":12} | PASS |
| C05 | 接触电阻12，耐压500，绝缘电阻20 | CONTRACT | {"contactResistance":12,"withstandVoltage":500,"insulationResistance":20} | PASS |
| D01 | 接触电阻0.012欧姆 | CONTRACT | {"contactResistance":12} | PASS |
| D02 | 接触电阻12000微欧 | NEEDS_SPEC | contactResistance = 12 | TODO，不计通过 |
| D03 | 接触电阻12毫欧 | CONTRACT | {"contactResistance":12} | PASS |
| D04 | 绝缘电阻20000000欧姆 | CONTRACT | {"insulationResistance":20} | PASS |
| D05 | 绝缘电阻20000千欧 | NEEDS_SPEC | insulationResistance = 20 | TODO，不计通过 |
| D06 | 绝缘电阻20兆欧 | CONTRACT | {"insulationResistance":20} | PASS |
| D07 | 耐压0.5千伏 | CONTRACT | {"withstandVoltage":500} | PASS |
| D08 | 耐压500伏 | CONTRACT | {"withstandVoltage":500} | PASS |
| D09 | 接触电阻0.012欧姆，绝缘电阻20000千欧，耐压0.5千伏 | NEEDS_SPEC | contactResistance = 12; insulationResistance = 20; withstandVoltage = 500 | TODO，不计通过 |
| D10 | 接触电阻1欧姆 | CONTRACT | {"contactResistance":1000} | PASS |
| D11 | 绝缘电阻1千欧 | NEEDS_SPEC | insulationResistance = 0.001 | TODO，不计通过 |
| D12 | 耐压1.5千伏 | CONTRACT | {"withstandVoltage":1500} | PASS |
| E01 | 接触电阻12，接触电阻15 | CONTRACT | {"contactResistance":15} | PASS |
| E02 | 接触电阻12，接触电阻改成15毫欧 | CONTRACT | {"contactResistance":15} | PASS |
| E03 | 耐压500伏，耐压改成600伏 | CONTRACT | {"withstandVoltage":600} | PASS |
| E04 | 绝缘电阻20，绝缘电阻30，绝缘电阻40 | CONTRACT | {"insulationResistance":40} | PASS |
| E05 | 接触电阻12，绝缘电阻20，接触电阻改成15 | CONTRACT | {"contactResistance":15,"insulationResistance":20} | PASS |
| E06 | 接触电阻0.012欧姆，接触电阻改成15毫欧 | CONTRACT | {"contactResistance":15} | PASS |
| E07 | 耐压500伏，耐压改成0.6千伏 | CONTRACT | {"withstandVoltage":600} | PASS |
| E08 | 接触电阻12，不对，是15毫欧 | CONFLICT | contactResistance = 15 | TODO，不计通过 |
| E09 | 耐压500，不对，是600伏 | CONFLICT | withstandVoltage = 600 | TODO，不计通过 |
| E10 | 接触电阻12，接触电阻改成苹果 | CONTRACT | {"contactResistance":12} | PASS |
| F01 | 接触电阻 | CONTRACT | {} | PASS |
| F02 | 绝缘电阻没有测量 | CONTRACT | {} | PASS |
| F03 | 耐压五百伏 | CONTRACT | {"withstandVoltage":500} | PASS |
| F04 | 耐压一千伏 | CONTRACT | {"withstandVoltage":1000} | PASS |
| F05 | 接触电阻-12毫欧 | CONTRACT | {} | PASS |
| F06 | 耐压5安培 | CONTRACT | {} | PASS |
| F07 | 接触电阻abc毫欧 | CONTRACT | {} | PASS |
| F08 | 接触电阻12毫欧，耐压5安培 | CONTRACT | {"contactResistance":12} | PASS |
| F09 | 绝缘电阻0兆欧 | CONTRACT | {"insulationResistance":0} | PASS |
| F10 | 耐压1000000000伏 | CONTRACT | {"withstandVoltage":1000000000} | PASS |
| G01 | 今天检查3个零件，耐压0.5千伏，接触电阻0.012欧姆 | CONTRACT | {"withstandVoltage":500,"contactResistance":12} | PASS |
| G02 | 接触电阻12毫欧，绝缘电阻20兆欧，接触电阻改成0.015欧姆 | CONTRACT | {"contactResistance":15,"insulationResistance":20} | PASS |
| G03 | 好的，耐压500伏，绝缘电阻20000千欧，耐压改成0.6千伏 | NEEDS_SPEC | withstandVoltage = 600; insulationResistance = 20 | TODO，不计通过 |
| G04 | 绝缘电阻20，今天测了3次，耐压500，接触电阻12 | CONTRACT | {"insulationResistance":20,"withstandVoltage":500,"contactResistance":12} | PASS |
| G05 | 接触电阻12，不对，是15毫欧，耐压0.5千伏 | CONFLICT | contactResistance = 15; withstandVoltage = 500 | TODO，不计通过 |

## NEEDS_SPEC / CONFLICT清单

| ID | 分类 | 具体原因 | 最小处理建议 |
|---|---|---|---|
| D02 | NEEDS_SPEC | Public Interface 单位表不含微欧；按任务的 Group D 指示标 NEEDS_SPEC，不能扩展单位表。 | 维持前轮已确认单位表；将该候选留作范围外需求。若扩展，须先正式修订单位表，再建立新验收预期。 |
| D05 | NEEDS_SPEC | Public Interface 单位表不含千欧；按任务的 Group D 指示标 NEEDS_SPEC，不能扩展单位表。 | 维持前轮已确认单位表；将该候选留作范围外需求。若扩展，须先正式修订单位表，再建立新验收预期。 |
| D09 | NEEDS_SPEC | Public Interface 单位表不含千欧；按任务的 Group D 指示标 NEEDS_SPEC，不能扩展单位表。 | 维持前轮已确认单位表；将该候选留作范围外需求。若扩展，须先正式修订单位表，再建立新验收预期。 |
| D11 | NEEDS_SPEC | Public Interface 单位表不含千欧；按任务的 Group D 指示标 NEEDS_SPEC，不能扩展单位表。 | 维持前轮已确认单位表；将该候选留作范围外需求。若扩展，须先正式修订单位表，再建立新验收预期。 |
| G03 | NEEDS_SPEC | Public Interface 单位表不含千欧；按任务的 Group D 指示标 NEEDS_SPEC，不能扩展单位表。 | 维持前轮已确认单位表；将该候选留作范围外需求。若扩展，须先正式修订单位表，再建立新验收预期。 |
| E08 | CONFLICT | 预期省略字段名，与 Public Interface“值必须有明确字段名”冲突。该补充已获本会话确认但尚未同步正式文档；不计入契约通过数，也不据此回改实现。 | 将前轮已经确认的受限纠正规则及上下文边界同步到Public Interface；不需要重新决定同一业务规则。 |
| E09 | CONFLICT | 预期省略字段名，与 Public Interface“值必须有明确字段名”冲突。该补充已获本会话确认但尚未同步正式文档；不计入契约通过数，也不据此回改实现。 | 将前轮已经确认的受限纠正规则及上下文边界同步到Public Interface；不需要重新决定同一业务规则。 |
| G05 | CONFLICT | 预期省略字段名，与 Public Interface“值必须有明确字段名”冲突。该补充已获本会话确认但尚未同步正式文档；不计入契约通过数，也不据此回改实现。 | 将前轮已经确认的受限纠正规则及上下文边界同步到Public Interface；不需要重新决定同一业务规则。 |
| S01 | NEEDS_SPEC | 已有实现与旧测试支持；Public Interface 未明确相邻字段无分隔的切分规则，单列待同步。 | 明确相邻字段无标点时的切分边界；现有实现/旧测试虽支持，本轮不据此反推契约。 |
| S02 | NEEDS_SPEC | 前轮受限纠正记录在 README；正式文档未规定纠正的上下文边界，需同步。 | 将前轮已经确认的受限纠正规则及上下文边界同步到Public Interface；不需要重新决定同一业务规则。 |

S01/S02是额外边界待定项，不混入57条A–G的统计。

## 契约覆盖率

公开方法：parse(segment)覆盖1/1（100%）。明确规则按下列22组审计，22/22具备行为测试或注明的静态边界证据；这是规则追踪覆盖率，不是V8/Istanbul行或分支覆盖率，也不包含未定义语法。

| 规则 | 明确契约 | 测试或审查证据 |
|---|---|---|
| R01 | 同步单次解析、无草稿读取及外部业务调用 | 全部直接调用；生产代码导入/职责静态审查 |
| R02 | 非法 segment 或 text 抛 TypeError | 新增非法输入参数表9项；不固定未约定的 message |
| R03 | 空文本、无法识别内容返回空对象 | B07/B08、X15/X16 |
| R04 | 六个字段全部固定别名 | 现有 text-parser.test.ts 别名用例；新增 X21/X25 |
| R05 | 明确支持的连接词与空白 | 现有连接词参数表；X25；不宣称覆盖“等”所隐含的未知语法 |
| R06 | ASCII连续标识符、保留大小写/前导零、不拼接口述或拆分片段 | 现有标识符用例；X21/X22 |
| R07 | 阿拉伯十进制整数/小数，不设置1000或业务量程上限 | A01–A06、D01/D04/D07、F10、X13/X14 |
| R08 | 中文规范位值、逐位串、中文小数、原始值≤1000 | F03/F04、X08–X10、现有中文数词边界测试 |
| R09 | 完整数词校验；拒绝负数/范围/指数/分数/混合/万亿/千位分隔 | F05、X09/X11/X12/X26；现有非法数词参数表 |
| R10 | 值有明确字段，结果不从无关通过或测量阈值推导 | B07/B08、X04/X05/X24；全部无result预期严格键检查 |
| R11 | 六类结果词映射、英文大小写、完整长词匹配 | 现有PASS/FAIL参数表；X21/X23/X24 |
| R12 | 稀疏输出；无null/undefined/额外键 | 新增全部49业务与26边界表：Reflect.ownKeys精确比对 |
| R13 | 测量字段只输出标准单位number，不含unit或子对象 | 新增每个数值类型/有限性断言；现有单位词表参数测试 |
| R14 | 无关内容跳过、字段语序不限、不错误关联数字 | B全组、C全组、G01/G04、X04/X05 |
| R15 | 最后有效值；后续无效表达不清空此前值 | E01–E07/E10、G02、X06/X19/X20 |
| R16 | 表内18个字段-单位别名组合逐个覆盖 | 现有units.test.ts：18组合×4数值=72项 |
| R17 | 集中单位换算、保留小数精度、不擅自舍入 | D契约项、E06/E07、X13/X14及生产代码审查 |
| R18 | 无单位默认标准单位、不继承前次单位 | A04–A06、C04/C05、X18 |
| R19 | 大小写严格区分、未知/错配单位拒绝且不回退默认 | F06/F08、X01–X03/X06/X07；现有拒绝词表 |
| R20 | 原始值有限、非负、允许0 | F05/F09、X17/X19/X26 |
| R21 | 换算后值有限、非负、允许0 | X17/X20；现有单位溢出与零值测试 |
| R22 | 输入不变、独立返回、无跨调用状态、重复解析等价 | 全部49业务重复解析与冻结输入；X27；现有隔离测试 |

## 12类额外风险追踪

| 风险 | 验证证据 | 结果 |
|---|---|---|
| 单位前缀大小写 | X01/X02及现有拒绝词表 | 通过 |
| 字段/数值错误关联 | X04、C全组 | 通过 |
| 无关数字 | B06/B08、X05、G04 | 通过 |
| 无效末次覆盖 | E10、X06/X19/X20 | 通过 |
| 未知单位当默认 | F06/F08、X03/X07 | 通过 |
| 中文边界 | F03/F04、X08–X12 | 通过 |
| 浮点精度 | X13/X14，分别采用12/18位小数近似断言 | 通过 |
| 字段间无标点 | S01；旧测试已有支持，但正式文档边界未明确 | NEEDS_SPEC |
| 空白文本 | X15/X16 | 通过 |
| 输入不变/跨调用状态 | X27、冻结输入 | 通过 |
| 纯数字/无额外字段 | 全部执行用例严格own-key与类型检查 | 通过 |
| 重复解析等价 | 全部49条业务样例在同实例重复解析 | 通过 |

## 失败分析

没有失败的CONTRACT测试，故没有可归因的运行时失败条目。不得将待定或文档冲突伪记为实现失败。

| Test ID | 输入 | Expected | Actual | 原因 | 严重程度 |
|---|---|---|---|---|---|
| 无 | — | — | — | 本轮85个可执行新增测试全部通过 | — |

## 高风险问题与最小修复建议

已执行场景中未发现P0/P1运行时缺陷：未知/错配单位未按缺省接受、单位转换未丢倍率、无效末次候选未覆盖有效值、测量值未推导PASS/FAIL。此结论不保证未定义语法或所有自然语言输入均安全。

正式验收的主要阻塞是契约与前轮已批准实现的同步：受限纠正在Public Interface仍受“必须明确字段名”限制。建议将已批准的规则、上下文阻断、非连续继承和默认单位语义写入正式契约，然后把相关TODO转为CONTRACT重新验收。前轮中文省略形式、连接词收口等补充也应一并同步，避免未来测试重新产生歧义。

微欧与千欧继续保持范围外；不能以D02/D05/D09/D11/G03为由增加生产支持或改变既有正确的拒绝测试。若保留现单位表，可另经确认调整候选验收需求；本轮不替用户改写其Expected Output。

不建议仅为让候选表全绿而修改生产代码。对相邻字段无分隔语法，先明确契约再增加正式断言。

## 文件与生产代码保护

本轮仅新增以下文件：

- cases.ts：57条业务分类、26条契约边界及2条待定义边界。
- business-acceptance.test.ts：使用真实TextParserModule、table-driven tests、严格稀疏键与类型断言，无Mock。
- REPORT.md：本报告。

未修改原有正确测试或ParseResult。执行前后以下SHA-256保持一致：

| 文件 | SHA-256 |
|---|---|
| src/modules/m2-text-parser/index.ts | ccb078996a27bb964254657b04db1cf2bba21a7b4ec7c672cf4c6e82368670c7 |
| src/modules/m2-text-parser/chinese-number.ts | 7e0091c0e9430c33d100dea601543de5b1c7a62eac0345387500a7256bc9778b |
| src/contracts/m2-text-parser.ts | 99e880cf9c38c618e4a6c64d4e8ab59dece314e6ec00bd7861becfaa8928f2ef |
| src/shared/data-models.ts | a889bf48dc6710f1233d36920a7a39c69495403997b765816433ace6a8b6b424 |

## 是否达到M2验收标准

对当前明确且无冲突的正式契约：通过本轮验收。对用户给定的完整57条候选业务需求：尚未全部验收，不能把5项NEEDS_SPEC和3项CONFLICT算作通过。需先完成范围/文档处理，再对相应项正式验收。
