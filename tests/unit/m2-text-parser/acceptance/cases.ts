import type { ParseResult } from '../../../../src/shared/data-models'

type ContractCase = { id: string; input: string; status: 'CONTRACT'; expected: ParseResult }
type PendingCase = { id: string; input: string; status: 'NEEDS_SPEC' | 'CONFLICT'; requested: string; reason: string }
const contract = (id: string, input: string, expected: ParseResult): ContractCase => ({ id, input, status: 'CONTRACT', expected })
const pending = (id: string, input: string, requested: string, reason: string, status: PendingCase['status'] = 'NEEDS_SPEC'): PendingCase => ({ id, input, status, requested, reason })
const micro = '原始正向候选预期与正式单位词表及未知单位拒绝规则冲突；用户已确认维持词表，不增加微欧支持。保留原始请求供追溯，不计入通过。'
const kilo = '原始正向候选预期与正式单位词表及未知单位拒绝规则冲突；用户已确认维持词表，不增加千欧支持。保留原始请求供追溯，不计入通过。'

/** All 57 user-supplied cases, preserving IDs and inputs. Pending expectations are descriptive only. */
export const BUSINESS_CASES = [
  contract('A01', '接触电阻12毫欧', { contactResistance: 12 }),
  contract('A02', '绝缘电阻20兆欧', { insulationResistance: 20 }),
  contract('A03', '耐压500伏', { withstandVoltage: 500 }),
  contract('A04', '接触电阻12', { contactResistance: 12 }),
  contract('A05', '绝缘电阻20', { insulationResistance: 20 }),
  contract('A06', '耐压500', { withstandVoltage: 500 }),
  contract('A07', '接触电阻12毫欧，绝缘电阻20兆欧，耐压500伏', { contactResistance: 12, insulationResistance: 20, withstandVoltage: 500 }),
  contract('B01', '今天先检查一下，接触电阻12毫欧', { contactResistance: 12 }),
  contract('B02', '好的，现在开始，绝缘电阻20兆欧', { insulationResistance: 20 }),
  contract('B03', '这个零件看起来还不错，耐压500伏', { withstandVoltage: 500 }),
  contract('B04', '接触电阻12毫欧，今天就测到这里', { contactResistance: 12 }),
  contract('B05', '今天是星期三，接触电阻12毫欧', { contactResistance: 12 }),
  contract('B06', '今天检查了3个零件，接触电阻12毫欧', { contactResistance: 12 }),
  contract('B07', '天气很好，准备下班了', {}),
  contract('B08', '这里有12个零件，检查完成', {}),
  contract('C01', '耐压500伏，绝缘电阻20兆欧', { withstandVoltage: 500, insulationResistance: 20 }),
  contract('C02', '绝缘电阻20兆欧，接触电阻12毫欧', { insulationResistance: 20, contactResistance: 12 }),
  contract('C03', '耐压500伏，接触电阻12毫欧，绝缘电阻20兆欧', { withstandVoltage: 500, contactResistance: 12, insulationResistance: 20 }),
  contract('C04', '绝缘电阻20，耐压500，接触电阻12', { insulationResistance: 20, withstandVoltage: 500, contactResistance: 12 }),
  contract('C05', '接触电阻12，耐压500，绝缘电阻20', { contactResistance: 12, withstandVoltage: 500, insulationResistance: 20 }),
  contract('D01', '接触电阻0.012欧姆', { contactResistance: 12 }),
  pending('D02', '接触电阻12000微欧', 'contactResistance = 12', micro, 'CONFLICT'),
  contract('D03', '接触电阻12毫欧', { contactResistance: 12 }),
  contract('D04', '绝缘电阻20000000欧姆', { insulationResistance: 20 }),
  pending('D05', '绝缘电阻20000千欧', 'insulationResistance = 20', kilo, 'CONFLICT'),
  contract('D06', '绝缘电阻20兆欧', { insulationResistance: 20 }),
  contract('D07', '耐压0.5千伏', { withstandVoltage: 500 }),
  contract('D08', '耐压500伏', { withstandVoltage: 500 }),
  pending('D09', '接触电阻0.012欧姆，绝缘电阻20000千欧，耐压0.5千伏', 'contactResistance = 12; insulationResistance = 20; withstandVoltage = 500', kilo, 'CONFLICT'),
  contract('D10', '接触电阻1欧姆', { contactResistance: 1000 }),
  pending('D11', '绝缘电阻1千欧', 'insulationResistance = 0.001', kilo, 'CONFLICT'),
  contract('D12', '耐压1.5千伏', { withstandVoltage: 1500 }),
  contract('E01', '接触电阻12，接触电阻15', { contactResistance: 15 }),
  contract('E02', '接触电阻12，接触电阻改成15毫欧', { contactResistance: 15 }),
  contract('E03', '耐压500伏，耐压改成600伏', { withstandVoltage: 600 }),
  contract('E04', '绝缘电阻20，绝缘电阻30，绝缘电阻40', { insulationResistance: 40 }),
  contract('E05', '接触电阻12，绝缘电阻20，接触电阻改成15', { contactResistance: 15, insulationResistance: 20 }),
  contract('E06', '接触电阻0.012欧姆，接触电阻改成15毫欧', { contactResistance: 15 }),
  contract('E07', '耐压500伏，耐压改成0.6千伏', { withstandVoltage: 600 }),
  // Previously pending: the approved restricted correction is now in Public Interface §3.
  contract('E08', '接触电阻12，不对，是15毫欧', { contactResistance: 15 }),
  contract('E09', '耐压500，不对，是600伏', { withstandVoltage: 600 }),
  contract('E10', '接触电阻12，接触电阻改成苹果', { contactResistance: 12 }),
  contract('F01', '接触电阻', {}),
  contract('F02', '绝缘电阻没有测量', {}),
  contract('F03', '耐压五百伏', { withstandVoltage: 500 }),
  contract('F04', '耐压一千伏', { withstandVoltage: 1000 }),
  contract('F05', '接触电阻-12毫欧', {}),
  contract('F06', '耐压5安培', {}),
  contract('F07', '接触电阻abc毫欧', {}),
  contract('F08', '接触电阻12毫欧，耐压5安培', { contactResistance: 12 }),
  contract('F09', '绝缘电阻0兆欧', { insulationResistance: 0 }),
  contract('F10', '耐压1000000000伏', { withstandVoltage: 1000000000 }),
  contract('G01', '今天检查3个零件，耐压0.5千伏，接触电阻0.012欧姆', { withstandVoltage: 500, contactResistance: 12 }),
  contract('G02', '接触电阻12毫欧，绝缘电阻20兆欧，接触电阻改成0.015欧姆', { contactResistance: 15, insulationResistance: 20 }),
  pending('G03', '好的，耐压500伏，绝缘电阻20000千欧，耐压改成0.6千伏', 'withstandVoltage = 600; insulationResistance = 20', kilo, 'CONFLICT'),
  contract('G04', '绝缘电阻20，今天测了3次，耐压500，接触电阻12', { insulationResistance: 20, withstandVoltage: 500, contactResistance: 12 }),
  contract('G05', '接触电阻12，不对，是15毫欧，耐压0.5千伏', { contactResistance: 15, withstandVoltage: 500 }),
]

/** Additional explicitly contracted safety boundaries; IDs link to the acceptance report. */
export const EDGE_CASES: ContractCase[] = [
  contract('X01', '接触电阻12MΩ，绝缘电阻20mΩ，耐压5kv', {}),
  contract('X02', '接触电阻12mΩ，绝缘电阻20MΩ，耐压0.5kV', { contactResistance: 12, insulationResistance: 20, withstandVoltage: 500 }),
  contract('X03', '接触电阻12毫欧元，绝缘电阻20兆欧元，耐压5kVA', {}),
  contract('X04', '接触电阻，今天检查12个零件，耐压500伏', { withstandVoltage: 500 }),
  contract('X05', '今天检查12件，500次通过，20个零件', {}),
  contract('X06', '接触电阻12，接触电阻改成15V，绝缘电阻20，绝缘电阻改成-3', { contactResistance: 12, insulationResistance: 20 }),
  contract('X07', '接触电阻12μΩ，绝缘电阻20kΩ，耐压5A', {}),
  contract('X08', '接触电阻一二点五毫欧，绝缘电阻两百兆欧，耐压一千', { contactResistance: 12.5, insulationResistance: 200, withstandVoltage: 1000 }),
  contract('X09', '接触电阻一千五百毫欧，绝缘电阻一万欧，耐压一千零一', {}),
  contract('X10', '耐压一点五千伏', { withstandVoltage: 1500 }),
  contract('X11', '接触电阻1e3毫欧，绝缘电阻1/2兆欧，耐压12到15伏', {}),
  contract('X12', '接触电阻1,000毫欧，绝缘电阻一2兆欧', {}),
  contract('X13', '接触电阻0.0000123456789欧姆', { contactResistance: 0.0123456789 }),
  contract('X14', '绝缘电阻0.123456789欧姆', { insulationResistance: 0.000000123456789 }),
  contract('X15', '', {}),
  contract('X16', '   \t\n ', {}),
  contract('X17', '接触电阻0毫欧，绝缘电阻〇兆欧，耐压零伏', { contactResistance: 0, insulationResistance: 0, withstandVoltage: 0 }),
  contract('X18', '接触电阻0.012欧姆，接触电阻15，耐压0.5千伏，耐压600', { contactResistance: 15, withstandVoltage: 600 }),
  contract('X19', `接触电阻12，接触电阻${'9'.repeat(400)}毫欧`, { contactResistance: 12 }),
  contract('X20', `耐压500，耐压1${'0'.repeat(306)}千伏`, { withstandVoltage: 500 }),
  contract('X21', '工单号 aB_007，零件编号 P-007，检验结果不合格', { workOrder: 'aB_007', partNumber: 'P-007', result: 'FAIL' }),
  contract('X22', '工单号 A 2301，零件号诶零零七', {}),
  contract('X23', '结果pass，检验结果FaIl', { result: 'FAIL' }),
  contract('X24', '结果不合格率，通过，接触电阻12', { contactResistance: 12 }),
  contract('X25', '接触电阻是12毫欧，绝缘电阻为20兆欧，耐压值：500伏', { contactResistance: 12, insulationResistance: 20, withstandVoltage: 500 }),
  contract('X26', '接触电阻NaN，绝缘电阻Infinity，耐压负三', {}),
  // Promoted from PENDING_EDGES after the confirmed correction boundary was documented.
  contract('S02', '接触电阻12毫欧，今天已检查，不对，是15毫欧', { contactResistance: 12 }),
]

export const PENDING_EDGES: PendingCase[] = [
  pending('S01', '接触电阻12耐压500绝缘电阻20', '字段之间无标点时如何确定边界', '已有实现与旧测试支持；Public Interface 未明确相邻字段无分隔的切分规则，单列待同步。'),
]
