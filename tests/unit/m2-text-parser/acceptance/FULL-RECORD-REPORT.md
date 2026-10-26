# M2 完整工业质检记录 H01–H18 测试报告

> 历史快照：本报告记录用户批准扩展契约之前的范围冲突。H01–H17随后已按原始候选输出获准并通过，当前结果、契约范围及旧断言迁移见 [记录契约扩展验收报告](RECORD-EXTENSION-REPORT.md)。下方旧计数与CONFLICT状态不代表当前实现。

日期：2026-10-26（Asia/Shanghai）。本轮仅新增测试数据、测试和报告；生产实现、正式契约、共享模型和既有测试未修改。

## 结论

原始候选18项：H18为CONTRACT，执行通过；H01–H17为CONFLICT，不计入候选验收通过或失败；NEEDS_SPEC=0。没有以新增别名、放宽结果字段要求或支持千欧的方式让候选通过。

另执行17项原输入的现契约拒绝/稀疏输出检查，以及22项使用正式词表的独立完整记录对照，全部通过。40项可执行测试通过不代表18条原始正向候选全部通过。

本轮未发现CONTRACT测试失败，无需提出生产代码修复补丁。原始正向预期与现有契约的差异是范围冲突，不是据以改代码的缺陷。若要求原H01–H17全部达到候选输出，需要先确认业务范围，见后文。

这18项输入均为合法的TranscriptSegment结构。未知字段、无效单位和未支持表达按稀疏规则省略，不返回自创的错误信息属性；结构非法时的TypeError由既有测试继续覆盖。新增测试使用Reflect.ownKeys检查全部自有键（含非枚举键），不只检查期望字段是否存在。

## 契约核对

完整阅读了 Architecture、Data Models、Public Interface、M2实现和已有Vitest测试。具体业务以Public Interface第3节为准。

| 核对项 | 现契约 | 本轮结论 |
|---|---|---|
| 工单 | 工单号、工单 | 工单A2301与工单改成A2302均支持 |
| partNumber | 零件号、零件编号 | 料号不在词表，不能识别或纠正为partNumber |
| withstandVoltage | 耐压、耐压值 | 耐电压不在词表，不做模糊匹配 |
| 结果词 | 带字段名的PASS/FAIL、合格/不合格、通过/不通过 | 词本身支持，但孤立结果词不更新；不是取整段最后一个结果词 |
| 测量省略字段纠正 | 固定“，不对，是数值[单位]”，上下文受限 | H07对应接触电阻更新15有效，不解决其他未知别名与孤立结果词 |
| 标识符纠正 | 明确字段名＋改成/改为＋连续ASCII标识符 | 工单纠正支持；料号纠正因别名未知不支持；零件号改成C-046支持 |
| 结果纠正 | 必须明确结果字段名 | 结果不合格，结果改成合格支持；不合格，改成合格不支持 |
| 单位换算 | 接触电阻Ω→mΩ；绝缘电阻Ω→MΩ；耐压kV→V等表内组合 | H04的千欧不支持；对照C04用500000000欧姆得到500 MΩ |
| 不支持单位 | 当前候选无效，保留该字段此前有效值；其他字段正常解析 | 不整批抛错、不当缺省；C15明确以耐压字段验证5安培被拒绝 |
| 多个结果词 | 同字段最后有效值；完整词匹配 | 有结果字段名时按文本位置；无字段名的词不参与；不合格不被截成合格 |
| 附着结果 | 数词、单位与候选须完整匹配 | 即使将别名改为耐压，1500伏通过也不能按数字前缀接受；C18单独验证 |

## H01–H18 原始输入

原文和候选Expected完整保留在 full-record-cases.ts；expectedByContract是独立的契约预期，没有替换requested。

| ID | 原始输入 |
|---|---|
| H01 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格 |
| H02 | 耐电压1500伏，料号C-045，绝缘电阻500兆欧，工单A2301，合格，接触电阻12毫欧 |
| H03 | 今天先检查第一批产品，工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格，准备下一件 |
| H04 | 工单A2301，料号C-045，接触电阻0.012欧姆，绝缘电阻500000千欧，耐电压1.5千伏，合格 |
| H05 | 工单A2301，料号C-045，接触电阻12，绝缘电阻500，耐电压1500，合格 |
| H06 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，不合格 |
| H07 | 工单A2301，料号C-045，接触电阻12毫欧，不对，是15毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 |
| H08 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，接触电阻改成15毫欧，耐电压1500伏，合格 |
| H09 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，耐压改成1.6千伏，合格 |
| H10 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，不合格，改成合格 |
| H11 | 工单A2301，工单改成A2302，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 |
| H12 | 工单A2301，料号C-045，料号改成C-046，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 |
| H13 | 工单A2301，接触电阻12毫欧，合格 |
| H14 | 今天检查了3个产品，工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 |
| H15 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压5安培，合格 |
| H16 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏 |
| H17 | 工单A2301，料号C-045 |
| H18 | 今天先检查第一批产品，准备好以后再开始，检查完成 |

## H01–H18逐项 Expected / Actual / 分类

所有对象均为完整的稀疏ParseResult表示，未列出的属性不存在。Expected是用户原始候选预期，Actual来自当前真实M2。CONFLICT行不按该候选预期注册通过测试。

| ID | 分类 | 原始Expected（完整JSON） | Actual（完整JSON） | 候选验收结果 |
|---|---|---|---|---|
| H01 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H02 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"insulationResistance":500,"workOrder":"A2301","contactResistance":12} | 不适用；CONFLICT，不计通过/失败 |
| H03 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H04 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12} | 不适用；CONFLICT，不计通过/失败 |
| H05 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H06 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"FAIL"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H07 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":15,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H08 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":15,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H09 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600} | 不适用；CONFLICT，不计通过/失败 |
| H10 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H11 | CONFLICT | {"workOrder":"A2302","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2302","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H12 | CONFLICT | {"workOrder":"A2301","partNumber":"C-046","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H13 | CONFLICT | {"workOrder":"A2301","contactResistance":12,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12} | 不适用；CONFLICT，不计通过/失败 |
| H14 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H15 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H16 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | 不适用；CONFLICT，不计通过/失败 |
| H17 | CONFLICT | {"workOrder":"A2301","partNumber":"C-045"} | {"workOrder":"A2301"} | 不适用；CONFLICT，不计通过/失败 |
| H18 | CONTRACT | {} | {} | PASS |

## 每项冲突原因与解析阶段

| ID | 原因 |
|---|---|
| H01 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。；1500伏通过没有字段或标点分隔；不得截取数字或将通过猜成独立结果字段。 |
| H02 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H03 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。；1500伏通过没有字段或标点分隔；不得截取数字或将通过猜成独立结果字段。 |
| H04 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。；绝缘电阻单位表不含千欧；该候选无效，不能换算或按无单位处理。 |
| H05 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H06 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H07 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H08 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H09 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H10 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。；省略字段的受限纠正仅适用于测量值；结果纠正须明确写结果改成合格。 |
| H11 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H12 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H13 | 结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H14 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H15 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。；结果词必须有结果/检验结果字段名；孤立的通过、合格、不合格不产生result更新。 |
| H16 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。；withstandVoltage仅接受耐压、耐压值；耐电压不是正式字段别名。 |
| H17 | partNumber仅接受零件号、零件编号；料号不是正式字段别名。 |

上述差异分别发生于字段识别阶段（未知别名）、完整候选/单位校验阶段（千欧、附着词）以及结果字段关联阶段（无字段名或非法省略纠正）。对应行为符合现契约，不能归因为应修复的解析错误。

## 原输入的现契约政策检查

以下17项是 Hxx-POLICY，验证的是当前契约下的拒绝/稀疏输出，不是对原始正向Expected的验收。每项完整键集合、字符串、数值类型、有限非负、冻结输入和同实例重复解析均被检查；没有Mock。

| 检查ID | 独立契约Expected | Actual | 结果 |
|---|---|---|---|
| H01-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H02-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"insulationResistance":500,"workOrder":"A2301","contactResistance":12} | PASS |
| H03-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H04-POLICY | {"workOrder":"A2301","contactResistance":12} | {"workOrder":"A2301","contactResistance":12} | PASS |
| H05-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H06-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H07-POLICY | {"workOrder":"A2301","contactResistance":15,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":15,"insulationResistance":500} | PASS |
| H08-POLICY | {"workOrder":"A2301","contactResistance":15,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":15,"insulationResistance":500} | PASS |
| H09-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600} | PASS |
| H10-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H11-POLICY | {"workOrder":"A2302","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2302","contactResistance":12,"insulationResistance":500} | PASS |
| H12-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H13-POLICY | {"workOrder":"A2301","contactResistance":12} | {"workOrder":"A2301","contactResistance":12} | PASS |
| H14-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H15-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H16-POLICY | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","contactResistance":12,"insulationResistance":500} | PASS |
| H17-POLICY | {"workOrder":"A2301"} | {"workOrder":"A2301"} | PASS |

## 正式词表完整记录对照 C01–C22

C01–C17是独立对照场景，分别覆盖H01–H17的业务意图；没有重命名或覆盖原H输入。C18–C22额外隔离附着结果、结果省略纠正、最后有效结果、无效末次覆盖和ASCII标识符格式。

例如标准完整输入可以写为：“工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果合格”。它可一次得到全部6个字段。

| ID | 输入 | Expected（完整JSON） | Actual（完整JSON） | 结果 |
|---|---|---|---|---|
| C01 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果通过，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C02 | 耐压1500伏，零件编号C-045，绝缘电阻500兆欧，工单A2301，结果合格，接触电阻12毫欧 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"withstandVoltage":1500,"partNumber":"C-045","insulationResistance":500,"workOrder":"A2301","result":"PASS","contactResistance":12} | PASS |
| C03 | 今天先检查第一批产品，工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，检验结果合格，准备下一件 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C04 | 工单A2301，零件号C-045，接触电阻0.012欧姆，绝缘电阻500000000欧姆，耐压1.5千伏，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C05 | 工单A2301，零件号C-045，接触电阻12，绝缘电阻500，耐压1500，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C06 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果不合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"FAIL"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"FAIL"} | PASS |
| C07 | 工单A2301，零件号C-045，接触电阻12毫欧，不对，是15毫欧，绝缘电阻500兆欧，耐压1500伏，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C08 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，接触电阻改成15毫欧，耐压1500伏，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C09 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，耐压改成1.6千伏，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600,"result":"PASS"} | PASS |
| C10 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果不合格，结果改成合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C11 | 工单A2301，工单改成A2302，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果合格 | {"workOrder":"A2302","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2302","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C12 | 工单A2301，零件号C-045，零件号改成C-046，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果合格 | {"workOrder":"A2301","partNumber":"C-046","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-046","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C13 | 工单A2301，接触电阻12毫欧，结果合格 | {"workOrder":"A2301","contactResistance":12,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"result":"PASS"} | PASS |
| C14 | 今天检查了3个产品，工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C15 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压5安培，结果合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"result":"PASS"} | PASS |
| C16 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500} | PASS |
| C17 | 工单A2301，零件号C-045 | {"workOrder":"A2301","partNumber":"C-045"} | {"workOrder":"A2301","partNumber":"C-045"} | PASS |
| C18 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏通过，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500} | PASS |
| C19 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果不合格，改成合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"FAIL"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"FAIL"} | PASS |
| C20 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，结果FAIL，结果改成合格，结果未知 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C21 | 工单A2301，零件号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，工单改成诶零三，零件号改成苹果，接触电阻改成-3，耐压改成5安培，结果合格，结果未知 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |
| C22 | 工单aB_0001，零件编号c-0045_01，接触电阻12毫欧，绝缘电阻500兆欧，耐压1500伏，检验结果pass | {"workOrder":"aB_0001","partNumber":"c-0045_01","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"aB_0001","partNumber":"c-0045_01","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | PASS |

## 潜在错配、错误覆盖与误验收风险

1. H09的withstandVoltage=1600来自后面的明确字段“耐压改成1.6千伏”，不能据此声称前面的“耐电压1500伏”被识别；C09使用两个合法字段表达验证真正的最后有效值。
2. H15的“耐电压5安培”连字段都未识别，单凭该用例不能证明未知单位处理正确。C15使用正式字段“耐压5安培”单独验证，不输出withstandVoltage=5。
3. H01/H03即使仅新增耐电压别名，也仍有“1500伏通过”的完整候选冲突。不能截取1500，或通过任意后缀剥离接受原表达，这会削弱未知单位与无关尾文保护。C18明确验证不产生该耐压更新。
4. H06的孤立“不合格”未产生result并非误判成PASS；C06验证明确结果不合格为FAIL。C19验证“结果不合格，改成合格”不会省略字段覆盖FAIL。
5. 不能通过取消字段名要求、全段搜索合格/通过来补齐原H结果字段，否则会把无关叙述写成检测结论。C20验证带字段名时最后有效值；C21验证无效末次输入不覆盖标识符、测量值和结果。
6. 原样H04不产生绝缘电阻500，这是按契约拒绝千欧，不是漏做已承诺换算；C04使用表内单位验证正确换算。
7. 本轮未发现已执行的契约场景中有错误数值进入结果、字段错配、额外更新、跨调用状态或从数值推断PASS/FAIL。该结论不扩展到未定义自然语言语法。

## 最小修复/范围处理建议

CONTRACT失败数为0，生产代码最小修复建议：无需修改。没有为了候选表全绿增加硬编码整句、词表、抽象或依赖。

若沿用现契约，最小业务输入调整是使用零件号/零件编号、耐压/耐压值，为结果加结果/检验结果字段名，为结果纠正重复字段名，并以表内欧姆表达绝缘电阻。C01–C17为可审查的独立示例，原H预期仍原样保留。

若要求保留原H输入及正向Expected，则先确认以下契约变更，再另行提出实现测试计划，本轮不执行：

- 是否增加“料号”和“耐电压”两个正式别名；若批准，再同步Public Interface与字段字典，不改共享模型。
- 是否允许无字段结果词；必须先规定作用域、无关文本隔离和多个候选归属，不能简单全局搜索。
- 是否允许结果省略字段纠正；目前测量纠正例外不适用于结果，需明确覆盖目标与阻断条件。
- 是否允许单位后直接附着结果词；须定义词法边界，不能用宽松数字前缀提取替代完整校验。
- H04千欧仍按此前“保持现有词表”的确认拒绝；若另有范围变化，必须单独修订，不能因这张候选表自行扩展。

不存在需要在本轮对生产代码执行的修复项；若后续批准范围扩展，应继续先补失败测试，再最小修改，重新回归现有字段关联与未知单位保护。

## 实际测试、类型检查、构建结果

| 范围 | 总数 | 通过 | 失败 | 其他 |
|---|---:|---:|---:|---|
| 原始H候选分类 | 18 | 1 | 0 | 17 CONFLICT；0 NEEDS_SPEC，不计通过/失败 |
| 新增可执行测试 | 40 | 40 | 0 | H18验收1 + H-POLICY检查17 + C对照22 |
| M2专项 | 436 | 430 | 0 | 原有6 TODO，不计通过 |
| 全量Vitest | 972 | 966 | 0 | 原有6 TODO，不计通过 |

已实际运行：

- npm test -- tests/unit/m2-text-parser：5文件，430 passed、0 failed、6 todo。
- npm run type-check：PASS。
- npm test：13文件，966 passed、0 failed、6 todo。
- npm run build：PASS，含脚本内类型检查。
- git diff --check：PASS。

本轮未新增todo/skip，也没有删除或修改原有6个TODO。17个范围冲突保留在数据与报告中，不把它们注册为待实现功能或伪装为通过测试。

## 修改文件及保护校验

仅新增：

- tests/unit/m2-text-parser/acceptance/full-record-cases.ts
- tests/unit/m2-text-parser/acceptance/full-record.test.ts
- tests/unit/m2-text-parser/acceptance/FULL-RECORD-REPORT.md

执行前后保护文件SHA-256一致：

| 文件 | SHA-256 |
|---|---|
| src/modules/m2-text-parser/index.ts | 2871d2831720a3033bfc16b7da797ffdf04299077f84a8ea308cd9e994a9e3ac |
| src/modules/m2-text-parser/chinese-number.ts | 7e0091c0e9430c33d100dea601543de5b1c7a62eac0345387500a7256bc9778b |
| src/contracts/m2-text-parser.ts | 99e880cf9c38c618e4a6c64d4e8ab59dece314e6ec00bd7861becfaa8928f2ef |
| src/shared/data-models.ts | a889bf48dc6710f1233d36920a7a39c69495403997b765816433ace6a8b6b424 |
| documentation/docs/public-interface.md | 2e904aa00cac7def9f97ec833961a1bc4eccaabc2bf7aefdc5b1fe0635c43696 |

不宣称原始H01–H17已验收通过；正式词表下的完整记录、乱序、无关文本、混合单位、重复/纠正、稀疏输出和非法末次覆盖等本轮测试全部通过。
