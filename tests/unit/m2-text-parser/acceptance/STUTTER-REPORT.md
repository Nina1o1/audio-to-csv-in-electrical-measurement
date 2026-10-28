# M2 重复字段名称与料号粘连修复验证报告

日期：2026-10-29。用户确认有限别名契约后，按测试先行、最小修复、完整验证执行。

## 根因与最小修复

- Phase 1调用当前真实公开parse方法，主例工工单17156号c2958和So前缀已正确；33条候选中30一致、3不一致。未把无法复现的主例空结果归因于当前源码。
- A04工单单只被定位为工单，遗留单污染后续编号，也使6号前缀校验失败，输出{}。A06料料号的定位起点过晚，导致前一工单候选成为1715料，只输出料号。A08料号号遗留号，使料号候选非法。首个偏差均在字段名定位和消耗阶段。
- 唯一生产修改为在原FIELD_ALIASES中增加5个有限别名及一条说明注释：工工单/工工工单/工单单→workOrder；料料号/料号号→partNumber。复用原有最早位置扫描、同位置最长优先及完整字段范围切分。
- 未新增全文规范化、不删除重复字符、不截取固定编号长度、不全局替换6号、不引入依赖；6号/六号、单位换算、纠正、结果识别实现本轮均未修改。

## 实际测试与验证

| 检查 | 结果 |
|---|---|
| 新增专项修复前 | 26失败、37通过；真实公开方法，日志 /tmp/m2-stutter-red.log |
| 原始A01–D10 | 33通过，0失败，0待确认 |
| 新增保护用例G01–G30 | 30通过，0失败 |
| M2回归 | 8文件，650通过，0失败，1个既有todo |
| npm run type-check | 退出码0，通过 |
| npm test | 26文件，1483通过，0失败，1个既有todo |
| npm run build | 退出码0，通过，含再次执行type-check；39模块构建完成 |
| git diff --check | 通过 |

新增Vitest用例全部使用test.each和真实TextParserModule.parse；严格比较完整ParseResult与全部键，字符串大小写/重复字符及数值类型均参与严格相等比较；并检查冻结输入、重复调用、新实例一致性、跨调用上下文及返回对象隔离。C07覆盖0.012欧姆→12mΩ、1.5千伏→1500V。未删除或修改已有正确测试。

## 原始33条每条Expected/Actual

| ID | 输入 | Expected（完整ParseResult） | Actual（完整ParseResult） | 状态 |
|---|---|---|---|---|
| A01 | "工工单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| A02 | "工工单A23016号C045" | `{"workOrder":"A2301","partNumber":"C045"}` | `{"workOrder":"A2301","partNumber":"C045"}` | 通过 |
| A03 | "工工单1715料号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| A04 | "工单单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| A05 | "工工工单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| A06 | "工单1715料料号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| A07 | "工工单1715，料料号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| A08 | "工单1715，料号号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B01 | "So工工单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B02 | "嗯工工单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B03 | "好工工单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B04 | "那个工工单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B05 | "好的，工工单17156号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B06 | "工工单1715，6号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B07 | "工工单1715六号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| B08 | "工工单1715 6号 c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| C01 | "工工单17156号c2958，接触电阻12毫欧" | `{"workOrder":"1715","partNumber":"c2958","contactResistance":12}` | `{"workOrder":"1715","partNumber":"c2958","contactResistance":12}` | 通过 |
| C02 | "工工单17156号c2958，绝缘电阻500兆欧" | `{"workOrder":"1715","partNumber":"c2958","insulationResistance":500}` | `{"workOrder":"1715","partNumber":"c2958","insulationResistance":500}` | 通过 |
| C03 | "工工单17156号c2958，耐压1500伏" | `{"workOrder":"1715","partNumber":"c2958","withstandVoltage":1500}` | `{"workOrder":"1715","partNumber":"c2958","withstandVoltage":1500}` | 通过 |
| C04 | "工工单17156号c2958，合格" | `{"workOrder":"1715","partNumber":"c2958","result":"PASS"}` | `{"workOrder":"1715","partNumber":"c2958","result":"PASS"}` | 通过 |
| C05 | "工工单17156号c2958，不合格" | `{"workOrder":"1715","partNumber":"c2958","result":"FAIL"}` | `{"workOrder":"1715","partNumber":"c2958","result":"FAIL"}` | 通过 |
| C06 | "工工单17156号c2958，耐压1500伏通过" | `{"workOrder":"1715","partNumber":"c2958","withstandVoltage":1500}` | `{"workOrder":"1715","partNumber":"c2958","withstandVoltage":1500}` | 通过 |
| C07 | "工工单17156号c2958，接触电阻0.012欧姆，绝缘电阻500兆欧，耐压1.5千伏，检验结果合格" | `{"workOrder":"1715","partNumber":"c2958","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"}` | `{"workOrder":"1715","partNumber":"c2958","contactResistance":12,"insulationResistance":500,"withstandVoltage":1500,"result":"PASS"}` | 通过 |
| D01 | "工单17156" | `{"workOrder":"17156"}` | `{"workOrder":"17156"}` | 通过 |
| D02 | "工单1715，6号工位" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| D03 | "工单1715，6号设备" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| D04 | "工单1715，第6号零件" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| D05 | "今天检查6号设备" | `{}` | `{}` | 通过 |
| D06 | "工工单1715" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| D07 | "工工单17156号" | `{}` | `{}` | 通过 |
| D08 | "工单17156号c2958号设备" | `{}` | `{}` | 通过 |
| D09 | "工单1715，料号" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| D10 | "6号c2958" | `{}` | `{}` | 通过 |

## 新增30条保护测试每条Expected/Actual

| ID | 输入 | Expected（完整ParseResult） | Actual（完整ParseResult） | 状态 |
|---|---|---|---|---|
| G01 | "工单单AAB0011料号号cc0022" | `{"workOrder":"AAB0011","partNumber":"cc0022"}` | `{"workOrder":"AAB0011","partNumber":"cc0022"}` | 通过 |
| G02 | "工工单0011料料号00-AA__11" | `{"workOrder":"0011","partNumber":"00-AA__11"}` | `{"workOrder":"0011","partNumber":"00-AA__11"}` | 通过 |
| G03 | "工单单是Z_0001-166号cC-0022__" | `{"workOrder":"Z_0001-16","partNumber":"cC-0022__"}` | `{"workOrder":"Z_0001-16","partNumber":"cC-0022__"}` | 通过 |
| G04 | "工工工单：AB12料料号为Cc-77" | `{"workOrder":"AB12","partNumber":"Cc-77"}` | `{"workOrder":"AB12","partNumber":"Cc-77"}` | 通过 |
| G05 | "工单单1715六号c2958" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| G06 | "工单A1，工单单改成BB0022" | `{"workOrder":"BB0022"}` | `{"workOrder":"BB0022"}` | 通过 |
| G07 | "工单A1，工单单改成诶零三" | `{"workOrder":"A1"}` | `{"workOrder":"A1"}` | 通过 |
| G08 | "工单A1，工单单" | `{"workOrder":"A1"}` | `{"workOrder":"A1"}` | 通过 |
| G09 | "料号P1，料号号改为CC0022" | `{"partNumber":"CC0022"}` | `{"partNumber":"CC0022"}` | 通过 |
| G10 | "料号P1，料料号改为苹果" | `{"partNumber":"P1"}` | `{"partNumber":"P1"}` | 通过 |
| G11 | "料号P1，料号号" | `{"partNumber":"P1"}` | `{"partNumber":"P1"}` | 通过 |
| G12 | "工单单17156" | `{"workOrder":"17156"}` | `{"workOrder":"17156"}` | 通过 |
| G13 | "工单单17156号" | `{}` | `{}` | 通过 |
| G14 | "工单单17156号c2958号设备" | `{}` | `{}` | 通过 |
| G15 | "工单单1715，6号设备" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| G16 | "工单单1715，第6号c2958" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| G17 | "工单单1715，6号12345" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| G18 | "工单单1715，今天检查，6号c2958" | `{"workOrder":"1715"}` | `{"workOrder":"1715"}` | 通过 |
| G19 | "工单单1715，料号号P1，6号c2958" | `{"workOrder":"1715","partNumber":"P1"}` | `{"workOrder":"1715","partNumber":"P1"}` | 通过 |
| G20 | "工单单17156号c2958，接触电阻12毫欧，接触电阻改成15毫欧" | `{"workOrder":"1715","partNumber":"c2958","contactResistance":15}` | `{"workOrder":"1715","partNumber":"c2958","contactResistance":15}` | 通过 |
| G21 | "工单单17156号c2958，接触电阻0.012欧姆，不对，是15毫欧" | `{"workOrder":"1715","partNumber":"c2958","contactResistance":15}` | `{"workOrder":"1715","partNumber":"c2958","contactResistance":15}` | 通过 |
| G22 | "工单单17156号，接触电阻12毫欧，耐压1.5千伏通过" | `{"contactResistance":12,"withstandVoltage":1500}` | `{"contactResistance":12,"withstandVoltage":1500}` | 通过 |
| G23 | "工单单17156号c2958，耐压1500伏通过" | `{"workOrder":"1715","partNumber":"c2958","withstandVoltage":1500}` | `{"workOrder":"1715","partNumber":"c2958","withstandVoltage":1500}` | 通过 |
| G24 | "工单单17156号c2958，结果通过" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| G25 | "料号号c2958，合格" | `{"partNumber":"c2958","result":"PASS"}` | `{"partNumber":"c2958","result":"PASS"}` | 通过 |
| G26 | "工单单17156号c2958，不合格，改成合格" | `{"workOrder":"1715","partNumber":"c2958","result":"PASS"}` | `{"workOrder":"1715","partNumber":"c2958","result":"PASS"}` | 通过 |
| G27 | "工单单17156号c2958，合格，不合格" | `{"workOrder":"1715","partNumber":"c2958","result":"FAIL"}` | `{"workOrder":"1715","partNumber":"c2958","result":"FAIL"}` | 通过 |
| G28 | "工单单17156号c2958，合格率很高" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| G29 | "工单单17156号c2958，接触电阻1,000毫欧" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |
| G30 | "工单单17156号c2958，接触电电阻12毫欧" | `{"workOrder":"1715","partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` | 通过 |

## 原始用例修复前后的差异

| ID | 修复前Actual | 修复后Actual |
|---|---|---|
| A04 | `{}` | `{"workOrder":"1715","partNumber":"c2958"}` |
| A06 | `{"partNumber":"c2958"}` | `{"workOrder":"1715","partNumber":"c2958"}` |
| A08 | `{"workOrder":"1715"}` | `{"workOrder":"1715","partNumber":"c2958"}` |

## 本轮修改文件

- src/modules/m2-text-parser/index.ts：5个有限字段别名及注释。
- documentation/docs/public-interface.md：新增已确认有限重复字段名规则。
- src/modules/m2-text-parser/README.md：同步容错范围。
- tests/unit/m2-text-parser/stutter.test.ts：63条参数化用例与统一完整结果验证。
- tests/unit/m2-text-parser/acceptance/stutter-cases.ts：33条用户原始输入及确认后的完整预期。
- tests/unit/m2-text-parser/README.md：专项说明。
- tests/unit/m2-text-parser/acceptance/STUTTER-REPORT.md：本报告。
上一轮已存在的未提交修改保留；本轮未修改M1/M3/M4/M5、App、共享模型、既有测试预期、依赖或锁文件。

## NEEDS_SPEC与歧义

- 本轮NEEDS_SPEC为0。有限5个别名已获确认；B07六号沿用上一轮已确认词表。
- D07缺少完整料号，不建立6号边界；整体工单候选含号而非法，返回{}。不猜测1715或17156。
- D08料号候选c2958号设备不是完整ASCII标识符，拒绝截取其前缀；无可靠字段边界，返回{}。
- D10独立6号c2958无明确工单上下文，返回{}；未增加独立6号料号入口。
- 既有微欧请求与单位词表冲突仍为1个todo，非本轮重复字段解析问题（既有业务验收D02，不是本轮D02）。
- 未列出的重复形态不自动按重复次数规范化；仍按既有字段词表与前缀噪声规则处理，因此某些包含标准字段子串的形态仍可能识别，不能将有限白名单误解为对其他形态一律拒绝。
- 主例在此前页面显示空值的运行环境差异尚未核实；当前源码和全部专项用例已验证。构建产物已重新生成，未执行部署或浏览器运行版本核验。

## 过度匹配与独立性

- 编号AAB0011、cc0022、0011、00-AA__11保持原文；误转写料号仍要求字母开头，不允许纯数字入口。
- 普通工位/设备、第6号、跨其他字段/无关语句、无完整值及尾文歧义均有负向覆盖。
- 无效重复字段候选不覆盖已有有效编号；工单/料号非法时测量仍独立输出；测量纠正、数值千位分隔拒绝、通过不产生PASS、长结果词和最后有效结果均通过回归。
