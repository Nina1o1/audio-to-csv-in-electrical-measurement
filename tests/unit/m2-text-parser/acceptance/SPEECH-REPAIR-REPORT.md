# M2 语音解析专项修复验证报告

日期：2026-10-29。用户已确认第一阶段全部建议规则；本报告对应修复后的真实公开解析方法。

## 结果

- J/K/L：41通过，0失败，0待确认。
- 新增边界回归：58通过，0失败；专项合计99通过。
- M2回归：587通过，0失败，1个既有todo（D02微欧请求与固定单位词表冲突）。S01无标点字段边界已转为正式验收。
- 全量npm test：25个文件通过，1420通过，0失败，1个既有todo。
- npm run type-check：通过。npm run build：通过（含再次执行type-check）。git diff --check：通过。
- 新增测试均使用test.each，检查完整ParseResult、精确键集合、输入不变性、同实例重复调用、新实例一致性、跨调用及返回值隔离。

## 根因与修复

1. So等口头语并非根因，原有字段扫描已支持前缀。6号/六号缺少字段边界，导致含中文尾文的工单候选整体拒绝。增加只位于完整工单后的受限事件，不做全局替换、不按编号长度拆分。
2. 原expressionPart把数字之间的逗号保留为数值内部字符，误伤A2301，6号。现在仅测量候选保留千位分隔防护，标识符按标点分句。
3. 原结果词表明确包含通过，耐压附着分支直接写入PASS。现在从结果词表删除通过，但仅对完整合法耐压值和支持单位保留过程后缀，输出电压且不设置结果或结果纠正目标。
4. 完整独立合格/不合格允许直接更新；检测结果正式加入字段别名。PASS/FAIL/不通过仍保持原有作用域。

## 测试先行记录

- 生产修改前新增99条用例并运行：46失败、53通过；日志 /tmp/m2-speech-repair-red.log。
- 随后把两条与测量数字逗号保护无关的上下文负向用例补上明确毫欧单位，保持原有数值保护行为；最终专项仍为99条。
- 实现后J/K/L全部通过；直接冲突的旧断言按已确认契约迁移，其余正确断言保留。
- 全量初次为1失败、1419通过、1todo：旧App保存夹具仅说耐压1500伏通过，缺少最终结果。仅给该夹具及转写显示断言增加检验结果合格，保存/持久化断言保留；最终全量通过。

## 每条 J/K/L 的 Expected 与 Actual

| ID | 输入 | Expected（完整） | Actual（完整） | 状态 |
|---|---|---|---|---|
| J01 | "So工单a23016号c045" | `{"workOrder":"a2301","partNumber":"c045"}` | `{"workOrder":"a2301","partNumber":"c045"}` | 通过 |
| J02 | "so工单A23016号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J03 | "嗯工单A23016号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J04 | "好的工单A23016号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J05 | "那个工单A23016号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J06 | "So，工单A2301，6号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J07 | "工单A2301六号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J08 | "工单A2301料号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J09 | "So工单A2301料号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J10 | "So工单A2301，料号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| J11 | "工单A2301，6号C045，接触电阻12毫欧" | `{"workOrder":"A2301","partNumber":"C045","contactResistance":12}` | `{"workOrder":"A2301","partNumber":"C045","contactResistance":12}` | 通过 |
| J12 | "So工单A23016号C045，绝缘电阻500兆欧" | `{"workOrder":"A2301","partNumber":"C045","insulationResistance":500}` | `{"workOrder":"A2301","partNumber":"C045","insulationResistance":500}` | 通过 |
| J13 | "工单A2301，6号C045，耐压1500伏，合格" | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"result":"PASS"}` | 通过 |
| J14 | "工单A2301，6号C045，不合格" | `{"workOrder":"A2301","partNumber":"C045","result":"FAIL"}` | `{"workOrder":"A2301","partNumber":"C045","result":"FAIL"}` | 通过 |
| J15 | "今天检查6号工位" | `{}` | `{}` | 通过 |
| J16 | "第6号零件已经完成" | `{}` | `{}` | 通过 |
| J17 | "工单A2301，第6号工位检查完成" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| J18 | "6号设备出现故障" | `{}` | `{}` | 通过 |
| J19 | "工单A23016" | `{"workOrder":"A23016"}` | `{"workOrder":"A23016"}` | 通过 |
| J20 | "6号" | `{}` | `{}` | 通过 |
| J21 | "工单A2301，6号" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| K01 | "通过" | `{}` | `{}` | 通过 |
| K02 | "测试通过" | `{}` | `{}` | 通过 |
| K03 | "耐压测试通过" | `{}` | `{}` | 通过 |
| K04 | "耐电压1500伏通过" | `{"withstandVoltage":1500}` | `{"withstandVoltage":1500}` | 通过 |
| K05 | "合格" | `{"result":"PASS"}` | `{"result":"PASS"}` | 通过 |
| K06 | "检验结果合格" | `{"result":"PASS"}` | `{"result":"PASS"}` | 通过 |
| K07 | "检测结果合格" | `{"result":"PASS"}` | `{"result":"PASS"}` | 通过 |
| K08 | "不合格" | `{"result":"FAIL"}` | `{"result":"FAIL"}` | 通过 |
| K09 | "检验结果不合格" | `{"result":"FAIL"}` | `{"result":"FAIL"}` | 通过 |
| K10 | "耐电压1500伏通过，合格" | `{"withstandVoltage":1500,"result":"PASS"}` | `{"withstandVoltage":1500,"result":"PASS"}` | 通过 |
| K11 | "耐电压1500伏通过，不合格" | `{"withstandVoltage":1500,"result":"FAIL"}` | `{"withstandVoltage":1500,"result":"FAIL"}` | 通过 |
| K12 | "工单A2301，测试通过" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| K13 | "工单A2301，检验结果合格" | `{"workOrder":"A2301","result":"PASS"}` | `{"workOrder":"A2301","result":"PASS"}` | 通过 |
| K14 | "工单A2301，检验结果不合格" | `{"workOrder":"A2301","result":"FAIL"}` | `{"workOrder":"A2301","result":"FAIL"}` | 通过 |
| K15 | "今天测试通过，准备下一件" | `{}` | `{}` | 通过 |
| L01 | "So工单a23016号c045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格" | `{"workOrder":"a2301","partNumber":"c045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"a2301","partNumber":"c045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"}` | 通过 |
| L02 | "So工单a23016号c045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过" | `{"workOrder":"a2301","partNumber":"c045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500}` | `{"workOrder":"a2301","partNumber":"c045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500}` | 通过 |
| L03 | "工单A2301，6号C045，接触电阻0.012欧姆，耐压1.5千伏，检验结果合格" | `{"workOrder":"A2301","partNumber":"C045","contactResistance":12,"withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"A2301","partNumber":"C045","contactResistance":12,"withstandVoltage":1500,"result":"PASS"}` | 通过 |
| L04 | "工单A2301，料号C045，耐压1500伏通过，检验结果不合格" | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"result":"FAIL"}` | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"result":"FAIL"}` | 通过 |
| L05 | "So工单A23016号C045，耐压1500伏通过，接触电阻改成15毫欧" | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"contactResistance":15}` | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"contactResistance":15}` | 通过 |

## 新增边界回归的 Expected 与 Actual

| ID | 输入 | Expected（完整） | Actual（完整） | 状态 |
|---|---|---|---|---|
| G01 | "工单号是ab_0009-16号p-007_02" | `{"workOrder":"ab_0009-1","partNumber":"p-007_02"}` | `{"workOrder":"ab_0009-1","partNumber":"p-007_02"}` | 通过 |
| G02 | "工单改成Z99；六号c-001" | `{"workOrder":"Z99","partNumber":"c-001"}` | `{"workOrder":"Z99","partNumber":"c-001"}` | 通过 |
| G03 | "工单Z9 6号 c-01接触电阻12" | `{"workOrder":"Z9","partNumber":"c-01","contactResistance":12}` | `{"workOrder":"Z9","partNumber":"c-01","contactResistance":12}` | 通过 |
| G04 | "工单A6号B，工单Z6号c" | `{"workOrder":"Z","partNumber":"c"}` | `{"workOrder":"Z","partNumber":"c"}` | 通过 |
| G05 | "料号12345" | `{"partNumber":"12345"}` | `{"partNumber":"12345"}` | 通过 |
| G06 | "6号C045" | `{}` | `{}` | 通过 |
| G07 | "六号C045" | `{}` | `{}` | 通过 |
| G08 | "接触电阻12毫欧，6号C045" | `{"contactResistance":12}` | `{"contactResistance":12}` | 通过 |
| G09 | "料号P1，6号C045" | `{"partNumber":"P1"}` | `{"partNumber":"P1"}` | 通过 |
| G10 | "工单A2301，今天检查，6号C045" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| G11 | "工单A2301，第6号C045" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| G12 | "工单A2301，接触电阻12毫欧，6号C045" | `{"workOrder":"A2301","contactResistance":12}` | `{"workOrder":"A2301","contactResistance":12}` | 通过 |
| G13 | "工单A2301，六号工位" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| G14 | "工单A2301，6号12345" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| G15 | "工单A23016号12345" | `{}` | `{}` | 通过 |
| G16 | "工单A2301六号" | `{}` | `{}` | 通过 |
| G17 | "工单A2301，六号" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| G18 | "工单A2301，6号C045额外文本" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| G19 | "工单A2301，6号C 045" | `{"workOrder":"A2301"}` | `{"workOrder":"A2301"}` | 通过 |
| G20 | "工单A23016号C0456号D001" | `{}` | `{}` | 通过 |
| G21 | "工单A2301，6号C045，6号D001" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| G22 | "工单A2301，料号P1，6号C045" | `{"workOrder":"A2301","partNumber":"P1"}` | `{"workOrder":"A2301","partNumber":"P1"}` | 通过 |
| G23 | "工单A2301，6号C045，料号改成P2" | `{"workOrder":"A2301","partNumber":"P2"}` | `{"workOrder":"A2301","partNumber":"P2"}` | 通过 |
| G24 | "工单A2301，结果FAIL，6号C045" | `{"workOrder":"A2301","result":"FAIL"}` | `{"workOrder":"A2301","result":"FAIL"}` | 通过 |
| G25 | "工单A2301，6号C045，工单A23016" | `{"workOrder":"A23016","partNumber":"C045"}` | `{"workOrder":"A23016","partNumber":"C045"}` | 通过 |
| G26 | "接触电阻1,000毫欧" | `{}` | `{}` | 通过 |
| G27 | "耐压1，000伏通过" | `{}` | `{}` | 通过 |
| G28 | "结果通过" | `{}` | `{}` | 通过 |
| G29 | "检验结果通过" | `{}` | `{}` | 通过 |
| G30 | "检测结果通过" | `{}` | `{}` | 通过 |
| G31 | "工单A1，通过" | `{"workOrder":"A1"}` | `{"workOrder":"A1"}` | 通过 |
| G32 | "结果FAIL，结果通过" | `{"result":"FAIL"}` | `{"result":"FAIL"}` | 通过 |
| G33 | "结果FAIL，改成通过" | `{"result":"FAIL"}` | `{"result":"FAIL"}` | 通过 |
| G34 | "耐压1500伏通过，改成合格" | `{"withstandVoltage":1500}` | `{"withstandVoltage":1500}` | 通过 |
| G35 | "耐压1.5千伏通过" | `{"withstandVoltage":1500}` | `{"withstandVoltage":1500}` | 通过 |
| G36 | "耐压0.5\n千伏通过" | `{"withstandVoltage":500}` | `{"withstandVoltage":500}` | 通过 |
| G37 | "耐压1500伏通过率" | `{}` | `{}` | 通过 |
| G38 | "耐压1500伏通过今天结束" | `{}` | `{}` | 通过 |
| G39 | "耐压1500通过" | `{}` | `{}` | 通过 |
| G40 | "耐压5安培通过" | `{}` | `{}` | 通过 |
| G41 | "耐压-1500伏通过" | `{}` | `{}` | 通过 |
| G42 | "耐压500伏，耐压5安培通过" | `{"withstandVoltage":500}` | `{"withstandVoltage":500}` | 通过 |
| G43 | "今天测试合格了" | `{}` | `{}` | 通过 |
| G44 | "合格率" | `{}` | `{}` | 通过 |
| G45 | "不合格率" | `{}` | `{}` | 通过 |
| G46 | "合格，不合格" | `{"result":"FAIL"}` | `{"result":"FAIL"}` | 通过 |
| G47 | "不合格，合格" | `{"result":"PASS"}` | `{"result":"PASS"}` | 通过 |
| G48 | "不合格，改成合格" | `{"result":"PASS"}` | `{"result":"PASS"}` | 通过 |
| G49 | "合格，改成通过" | `{"result":"PASS"}` | `{"result":"PASS"}` | 通过 |
| G50 | "改成合格" | `{}` | `{}` | 通过 |
| G51 | "PASS" | `{}` | `{}` | 通过 |
| G52 | "FAIL" | `{}` | `{}` | 通过 |
| G53 | "不通过" | `{}` | `{}` | 通过 |
| G54 | "检测结果不合格" | `{"result":"FAIL"}` | `{"result":"FAIL"}` | 通过 |
| G55 | "检验结果PASS" | `{"result":"PASS"}` | `{"result":"PASS"}` | 通过 |
| G56 | "结果不通过" | `{"result":"FAIL"}` | `{"result":"FAIL"}` | 通过 |
| G57 | "耐压1500伏不通过" | `{"withstandVoltage":1500,"result":"FAIL"}` | `{"withstandVoltage":1500,"result":"FAIL"}` | 通过 |
| G58 | "耐压1500伏合格" | `{"withstandVoltage":1500,"result":"PASS"}` | `{"withstandVoltage":1500,"result":"PASS"}` | 通过 |

## 修复前后差异

| ID | 修复前 Actual | 修复后 Actual |
|---|---|---|
| J01 | `{}` | `{"workOrder":"a2301","partNumber":"c045"}` |
| J02 | `{}` | `{"workOrder":"A2301","partNumber":"C045"}` |
| J03 | `{}` | `{"workOrder":"A2301","partNumber":"C045"}` |
| J04 | `{}` | `{"workOrder":"A2301","partNumber":"C045"}` |
| J05 | `{}` | `{"workOrder":"A2301","partNumber":"C045"}` |
| J06 | `{}` | `{"workOrder":"A2301","partNumber":"C045"}` |
| J07 | `{}` | `{"workOrder":"A2301","partNumber":"C045"}` |
| J11 | `{"contactResistance":12}` | `{"workOrder":"A2301","partNumber":"C045","contactResistance":12}` |
| J12 | `{"insulationResistance":500}` | `{"workOrder":"A2301","partNumber":"C045","insulationResistance":500}` |
| J13 | `{"withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"result":"PASS"}` |
| J14 | `{}` | `{"workOrder":"A2301","partNumber":"C045","result":"FAIL"}` |
| J21 | `{}` | `{"workOrder":"A2301"}` |
| K04 | `{"withstandVoltage":1500,"result":"PASS"}` | `{"withstandVoltage":1500}` |
| K05 | `{}` | `{"result":"PASS"}` |
| K08 | `{}` | `{"result":"FAIL"}` |
| L01 | `{"contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"a2301","partNumber":"c045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"}` |
| L02 | `{"contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"a2301","partNumber":"c045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500}` |
| L03 | `{"contactResistance":12,"withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"A2301","partNumber":"C045","contactResistance":12,"withstandVoltage":1500,"result":"PASS"}` |
| L05 | `{"withstandVoltage":1500,"result":"PASS","contactResistance":15}` | `{"workOrder":"A2301","partNumber":"C045","withstandVoltage":1500,"contactResistance":15}` |

## 修改文件

- documentation/docs/public-interface.md：经确认的M2契约修订。
- src/modules/m2-text-parser/index.ts、README.md：最小解析修复与同步说明。
- tests/unit/m2-text-parser/speech-repair.test.ts：J/K/L及边界测试入口。
- tests/unit/m2-text-parser/acceptance/speech-repair-cases.ts：41条原始验收用例。
- tests/unit/m2-text-parser/text-parser.test.ts、debugging.test.ts、record-extension.test.ts：只迁移直接冲突断言，保留其他回归。
- tests/unit/m2-text-parser/acceptance/cases.ts：S01转正式验收。
- tests/unit/m2-text-parser/README.md、本报告：测试说明和逐条证据。
- tests/integration/manual-app.test.ts：直接相关M2录入夹具明确最终结果。
- M1/M3/M4/M5实现、App实现、共享数据模型、依赖与锁文件均未修改。

## 过度匹配风险与限制

- 普通6号/六号、工位、设备、带第、无工单、跨字段/无关语句、空料号、拆分料号、数字开头误转写料号均不建立料号更新；纯数字料号仍可通过明确料号字段录入。
- 多个无标点别名导致候选不完整时不猜测拆分；工单A23016保留完整编号。已覆盖大小写、前导零、连字符/下划线及不同长度编号。
- 合格率、不合格率、长句内子串不触发；通过率、未知单位、缺单位、负数及非法数词仍不截取合法前缀。
- 按已批准边界规则，“工单A6号B”解析为工单A、料号B；若真实业务另有与该格式相同的自然语言含义，本地规则无法进一步区分，需使用明确料号字段。
- 未新增依赖、NLP/LLM调用或整句特判；测量换算及其他字段回归全部通过。
