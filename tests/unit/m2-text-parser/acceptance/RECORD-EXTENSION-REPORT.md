# M2 记录契约扩展验收报告

日期：2026-10-26（Asia/Shanghai）。授权：原H01–H17全部达到原始候选输出，并扩展正式契约、完成旧测试回归。

## 结果

H01–H17的原始输入与候选Expected均未改变，17/17通过；H18也通过。H01–H18全部为CONTRACT，无NEEDS_SPEC或CONFLICT。没有以修正H候选预期代替实现。

ParseResult、InspectionFields和TextParserModule公开签名不变；测量字段仍仅输出标准单位下的number，不带unit属性。未修改M1/M3/M4/M5或App。

## 已批准的最小契约扩展

- partNumber新增料号，withstandVoltage新增耐电压，原别名仍可用。
- 绝缘电阻仅新增千欧这一单位词，乘0.001转换为MΩ；H04的500000千欧输出500。kΩ、千欧姆、微欧仍不在当前词表；接触电阻也不接受千欧输入词。
- 支持有本次记录上下文的完整独立结果分句。至少一个明确命名字段先成功识别，且前一分句为结构化字段或有效结果；无关语句会阻断邻接，不能从全段搜索通过/合格。单独通过或发生在记录前的通过仍不更新结果。
- 仅完整有效的耐压数值＋合法单位可附着完整结果词。负数、范围、未知单位、溢出或额外尾文不能因此变成有效更新。
- 完整独立的改成/改为结果词仅纠正紧邻前一有效结果；字段、无关语句及无效纠正阻断目标；不跨调用保留。
- 仍按最后有效结果更新，完整匹配不合格/不通过，ASCII大小写折叠不扩展到ſ/ß。仍不根据测量值自动产生结果。

完整边界已写入 documentation/docs/public-interface.md 第3节。没有为了兼容候选而接受任意单位或任意数字前缀。

## H01–H18逐项验收

Expected是此前用户给定的原始完整稀疏更新；Actual来自真实M2。

| ID | 原始输入 | Expected | Actual | 分类/结果 |
|---|---|---|---|---|
| H01 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H02 | 耐电压1500伏，料号C-045，绝缘电阻500兆欧，工单A2301，合格，接触电阻12毫欧 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"withstandVoltage":1500,"partNumber":"C-045","insulationResistance":500,"workOrder":"A2301","result":"PASS","contactResistance":12} | CONTRACT / PASS |
| H03 | 今天先检查第一批产品，工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格，准备下一件 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H04 | 工单A2301，料号C-045，接触电阻0.012欧姆，绝缘电阻500000千欧，耐电压1.5千伏，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H05 | 工单A2301，料号C-045，接触电阻12，绝缘电阻500，耐电压1500，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H06 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，不合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"FAIL"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"FAIL"} | CONTRACT / PASS |
| H07 | 工单A2301，料号C-045，接触电阻12毫欧，不对，是15毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H08 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，接触电阻改成15毫欧，耐电压1500伏，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":15,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H09 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，耐压改成1.6千伏，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1600,"result":"PASS"} | CONTRACT / PASS |
| H10 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，不合格，改成合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H11 | 工单A2301，工单改成A2302，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 | {"workOrder":"A2302","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2302","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H12 | 工单A2301，料号C-045，料号改成C-046，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 | {"workOrder":"A2301","partNumber":"C-046","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-046","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H13 | 工单A2301，接触电阻12毫欧，合格 | {"workOrder":"A2301","contactResistance":12,"result":"PASS"} | {"workOrder":"A2301","contactResistance":12,"result":"PASS"} | CONTRACT / PASS |
| H14 | 今天检查了3个产品，工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"} | CONTRACT / PASS |
| H15 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压5安培，合格 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"result":"PASS"} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"result":"PASS"} | CONTRACT / PASS |
| H16 | 工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏 | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500} | {"workOrder":"A2301","partNumber":"C-045","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500} | CONTRACT / PASS |
| H17 | 工单A2301，料号C-045 | {"workOrder":"A2301","partNumber":"C-045"} | {"workOrder":"A2301","partNumber":"C-045"} | CONTRACT / PASS |
| H18 | 今天先检查第一批产品，准备好以后再开始，检查完成 | {} | {} | CONTRACT / PASS |

## Test-First与安全回归

先将H01–H18按原始候选注册为可执行测试，并加入首批42项记录结果边界保护用例。实现前两份测试合计82项，39失败、43通过；实现后全部通过。审查附着结果的有效性后又补充8项负数、指数、范围、中文超范围、换算溢出及无效纠正保护，记录扩展测试最终为50项。随后重新运行M2全量、全项目、类型检查及构建。

新增记录边界测试覆盖：

- 无记录上下文的结果词、记录前的结果词、无关长句中的词均不更新。
- 有效字段＋独立结果词、合法耐压附着结果、最后有效结果。
- 其他字段/无关语句阻断结果纠正，非法纠正不覆盖。
- 附着结果不能使安培、无单位电压、负数/错误数字或Unicode伪结果成为合法词法。
- 千欧换算、字段错配、表外kΩ继续拒绝；一千欧保留原有中文数词含义。
- 冻结输入、重复解析等价、结果上下文不跨调用、严格稀疏键集合。

另外执行独立的0–1000规范中文整数×19种字段/合法单位组合探查，共19019组、0不符；该探查未计入Vitest测试数。它覆盖新增千欧与原有欧的后缀歧义，接触电阻一千欧仍输出1000000。

## 旧测试兼容与迁移清单

新旧契约的互斥断言不可能同时成立。本轮按用户明确授权只迁移直接冲突的预期；未通过句子硬编码区分相同业务规则，也未放宽严格断言。

| 旧用例 | 旧规则 | 新规则及迁移 |
|---|---|---|
| 绝缘电阻12千欧的拒绝参数项 | 表外单位，无更新 | 保留千欧用例，移入合法单位换算参数表；0、小数、12及20000000四个值均验证乘0.001（净增3项测试） |
| units.test.ts欧姆/千欧/千伏混合输入 | 省略绝缘电阻 | 仍验证原输入，新增insulationResistance=20；其他字段预期不变 |
| C18完整记录的耐压1500伏通过，合格 | 省略耐压和结果 | 同一输入现在输出完整6字段，符合H01授权的通用规则 |
| C19完整记录的结果不合格，改成合格 | 保留FAIL | 同一输入现在支持受限结果纠正，输出PASS |
| H01–H17的旧POLICY检查 | 使用旧契约下的稀疏预期 | 由同ID/同原始输入/同用户正向预期的正式验收替代；旧行为记录保留于历史报告，未伪装成仍需兼容的当前契约 |
| D05/D09/D11/G03四个TODO | 千欧正向候选记CONFLICT | 原输入和原候选数值不变，转为CONTRACT并执行通过 |

text-parser.test.ts的110项和debugging.test.ts的57项原有断言未改，均通过；无关数字、原始负值、换行单位、未知单位、无效覆盖、独立调用等保护继续有效。M3/M4/M5及App等其他模块的测试未修改且通过。

## 实际运行结果

| 指标 | 扩展前 | 扩展后 |
|---|---:|---:|
| H01–H17正式候选通过 | 0（17个CONFLICT） | 17 |
| H01–H18正式候选通过 | 1 | 18 |
| M2 Passed | 430 | 487 |
| M2 Failed | 0 | 0 |
| M2 TODO | 6 | 2 |
| 全量Passed | 966 | 1023 |
| 全量Failed | 0 | 0 |
| 全量TODO | 6 | 2 |
| TypeScript | PASS | PASS |
| Build | PASS | PASS |

已实际运行：

- npm test -- tests/unit/m2-text-parser：6文件，487 passed、0 failed、2 todo，总489。
- npm run type-check：通过。
- npm test：14文件，1023 passed、0 failed、2 todo，总1025。
- npm run build：Vite构建和脚本内类型检查通过。
- git diff --check：通过。

通过数增加57=新增50项保护测试+合法千欧参数表净增3项+4项TODO启用。H原正向验收替代旧POLICY，不虚增这部分测试数。

## 剩余TODO

| ID | 状态 | 处理 |
|---|---|---|
| D02 | CONFLICT | 接触电阻12000微欧的正向需求仍未授权；原候选保留，不计通过 |
| S01 | NEEDS_SPEC | 字段间无标点的通用边界仍待正式确认；原用例与已存在的可执行测试均保留 |

本轮没有新增TODO/skip/only/failing。两个TODO不是本次H01–H17的缺失项，不计入通过数。

## 修改范围

- documentation/docs/public-interface.md：新别名、千欧词、记录内结果与纠正边界。
- src/modules/m2-text-parser/index.ts：词表扩展、完整单位/数词分割、受限结果事件与本次调用上下文。
- tests/unit/m2-text-parser/record-extension.test.ts：50项边界回归。
- tests/unit/m2-text-parser/units.test.ts：仅迁移与千欧扩展直接冲突的预期与参数项。
- tests/unit/m2-text-parser/acceptance/full-record-cases.ts、full-record.test.ts：H原始正向验收与对照C18/C19迁移，移除过时的冲突分类结构。
- tests/unit/m2-text-parser/acceptance/cases.ts：4项千欧候选启用。
- 相关M2 README与报告：更新当前范围并给旧报告标注历史快照。

未修改共享模型、M2公开签名、其他业务模块、依赖或构建配置。新增行为局限于单次文本规则解析；没有调用外部服务、DOM或存储。
