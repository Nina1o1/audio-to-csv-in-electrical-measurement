# M2 Debugging 与 TODO 处理报告

日期：2026-10-26（Asia/Shanghai）。本轮按用户确认的三项修复执行，不增加单位、公开方法、共享模型或其他业务模块功能。

## 修复与验证证据

先新增 `../debugging.test.ts`，运行真实解析器。修复前57项中27失败、30通过；修复后57项全部通过。没有修改预期来消除这些失败，没有使用Mock、test.fails或跳过失败用例。

| 问题 | 复现输入（\n表示实际换行） | 修复前Actual | 修复后Actual / Expected |
|---|---|---|---|
| 数值后换行丢失单位 | 耐压0.5\n千伏 | withstandVoltage=0.5 | withstandVoltage=500 |
| 电阻单位丢失 | 接触电阻0.012\n欧姆 | contactResistance=0.012 | contactResistance=12 |
| 绝缘电阻倍率错误 | 绝缘电阻20000000\n欧姆 | insulationResistance=20000000 | insulationResistance=20 |
| 未知单位退回缺省并覆盖 | 耐压500伏，耐压5\n安培 | withstandVoltage=5 | withstandVoltage=500 |
| 截取范围前缀并覆盖 | 耐压500伏，耐压12\n至15伏 | withstandVoltage=12 | withstandVoltage=500 |
| 拼接/截取拆开的数词 | 接触电阻1\n2毫欧 | contactResistance=1 | {} |
| 无关尾文建立纠正目标 | 接触电阻12，接触电阻13毫欧今天已检查，不对，是15毫欧 | contactResistance=15 | contactResistance=12 |
| Unicode折叠扩大词表 | 结果paſs；另测结果paß | result=PASS | {} |

根因及最小修改：

1. `expressionPart` 不再以换行截断候选，保留换行供完整数词/单位/范围检查；不删除空白拼接数字。LF、CRLF、CR、U+2028、U+2029均有回归测试。
2. 内部测量候选分别返回归属是否明确和可选的有效标准值。完整数词、已识别单位的结构与值的有效性分别校验。负三仍不能更新，但可被明确纠正；数字开头的无关尾文不能建立上下文。单位识别词从现有换算表派生；错配单位没有换算因子，不能成为有效值。没有扩大单位支持。
3. 仅折叠ASCII a-z，中文词精确匹配；Unicode ſ/ß、全角词及非完整词不得映射成PASS/FAIL。

Public Interface第3节已同步以上确认边界，以及前轮已经批准的受限纠正例外。签名、ParseResult、标准单位和单位词表未变。没有将算法细节加入产品界面。

## 实际运行结果

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| M2 Passed | 329 | 390 |
| M2 Failed | 0 | 0 |
| M2 TODO | 10 | 6 |
| 全量 Passed | 865 | 926 |
| 全量 Failed | 0 | 0 |
| 全量 TODO | 10 | 6 |
| TypeScript | PASS | PASS |
| Build | PASS | PASS |

本轮实际执行：

- `npm test -- tests/unit/m2-text-parser/debugging.test.ts`：先确认27失败，再确认57通过。
- `npm test -- tests/unit/m2-text-parser`：4文件，390通过、0失败、6 todo，总396。
- `npm run type-check`：通过。
- `npm test`：12文件，926通过、0失败、6 todo，总932。
- `npm run build`：Vite与脚本内类型检查通过。
- `git diff --check`：通过。

通过数增长61=新增57项回归+4项既有TODO启用。TODO不是通过；既有正确的字段、单位测试未删除或放宽。

## 原10项TODO的处理结果

| ID | 最终状态 | 处理与依据 |
|---|---|---|
| D02 | CONFLICT，保留TODO | 微欧不在表内；保留原始正向候选CR=12，未改写为通过、未扩充词表。现有拒绝测试继续运行。 |
| D05 | CONFLICT，保留TODO | 千欧不在表内；保留原始候选IR=20。 |
| D09 | CONFLICT，保留TODO | 保留原始三字段候选；实际合法输出CR=12、WV=500，IR省略，已有同输入正确测试继续运行。 |
| D11 | CONFLICT，保留TODO | 千欧不在表内；保留原始候选IR=0.001。 |
| E08 | CONTRACT，可执行且通过 | 已批准的受限纠正同步正式文档，预期仍为CR=15；已有重复用例保留，没有擅自删除。 |
| E09 | CONTRACT，可执行且通过 | 预期仍为WV=600，无需扩大纠正语法。 |
| G03 | CONFLICT，保留TODO | 保留原始IR=20、WV=600候选；千欧不能生成IR更新。 |
| G05 | CONTRACT，可执行且通过 | 原始预期CR=15、WV=500不变。 |
| S01 | NEEDS_SPEC，保留TODO | 未获得相邻字段无标点切分规则的新确认；既有同输入测试保留，没有删除重复项或擅自补充契约。 |
| S02 | CONTRACT，可执行且通过 | 已确认无关语句阻断纠正，完整预期为CR=12；移入可执行边界表，原ID与输入保留。 |

原单位候选的历史NEEDS_SPEC分类按审计结论更新为CONFLICT：正式单位表已有明确拒绝规则，不属于尚未开发的单位功能。原始输入及请求的正向结果仍存于 cases.ts 的 requested 中。

本轮没有删除6个未执行候选来制造TODO=0，也没有更改其原始请求结果。若后续决定将5项范围外需求从可执行TODO迁至需求清单，或处理重复项，仍需按此前要求确认。S01缺少的规则是：相邻完整字段名能否作为分界、是否允许无标点、如何拒绝有歧义的归属。

## 跳过与覆盖审查

测试源码AST检查仍只有原来的两个 `test.todo` 调用，动态展开为5个CONFLICT和1个NEEDS_SPEC。未新增skip、only、fails/failing、skipIf或runIf。完整回归没有失败，也没有把6项TODO纳入通过数。

已有测试继续覆盖字段乱序、混合单位、无关数字、最后有效值、字段别名、结果词、零值、中文范围、换算溢出、稀疏纯数字输出、冻结输入、独立返回及跨调用隔离。新增测试覆盖此前缺失的数值后换行、完整候选与纠正上下文、ASCII词表边界。

## 修改范围与结论

- 生产实现：`src/modules/m2-text-parser/index.ts`。
- 新增回归：`tests/unit/m2-text-parser/debugging.test.ts`。
- 验收分类及启用：`tests/unit/m2-text-parser/acceptance/cases.ts`。
- 已确认契约文字：`documentation/docs/public-interface.md`第3节。
- 说明与报告：M2模块README、测试README、本报告及旧报告快照提示。

没有修改M1/M3/M4/M5、Vue/App、共享模型、M2公开接口、依赖或构建配置。`business-acceptance.test.ts`沿用原有严格断言与注册逻辑；此前已存在的未跟踪验收文件得以保留。

已确认三类缺陷完成修复，未发现该范围内尚未覆盖或未解决的P0/P1问题；不宣称支持未定义的自然语言。可以进入独立M1开发，本轮不自动启动。M2原57条候选中52条可执行契约验收通过、5条范围冲突保留；另有S01需明确契约，不能宣称全部候选验收通过。
