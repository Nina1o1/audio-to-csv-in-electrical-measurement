import { describe, expect, test } from 'vitest'
import { createTextParser } from '../../../src/modules/m2-text-parser'
import type { ParseResult } from '../../../src/shared/data-models'

describe('M2 complete-record extension: context and boundary protections', () => {
  test.each<[string, ParseResult]>([
    // Approved speech repair: explicit judgements stand alone; 通过 never states PASS.
    ['合格', { result: 'PASS' }], ['通过', {}], ['改成合格', {}],
    ['今天检查了500次，通过，接触电阻12', { contactResistance: 12 }],
    ['接触电阻12，今天检查完成，通过', { contactResistance: 12 }],
    ['接触电阻12，今天检查完成通过', { contactResistance: 12 }],
    ['接触电阻12，合格率很高', { contactResistance: 12 }],
    ['接触电阻12，合格', { contactResistance: 12, result: 'PASS' }],
    ['耐压5安培，合格', { result: 'PASS' }],
    ['工单A2301，耐电压5安培，合格', { workOrder: 'A2301', result: 'PASS' }],
    ['结果不合格率，通过，接触电阻12', { contactResistance: 12 }],
    ['工单号A2301，料号C-045', { workOrder: 'A2301', partNumber: 'C-045' }],
    ['料号C-045，料号改成C-046', { partNumber: 'C-046' }],
    ['耐电压0.5千伏通过', { withstandVoltage: 500 }],
    ['耐压1500伏不合格', { withstandVoltage: 1500, result: 'FAIL' }],
    ['耐电压1500伏不通过', { withstandVoltage: 1500, result: 'FAIL' }],
    ['耐压5安培通过', {}],
    ['工单A2301，耐压5安培通过', { workOrder: 'A2301' }],
    ['耐电压1500伏通过率', {}],
    ['耐电压1500伏paſs', {}],
    ['耐电压500通过', {}],
    ['接触电阻12毫欧通过', {}],
    ['工单A2301，不合格，改成合格', { workOrder: 'A2301', result: 'PASS' }],
    ['工单A2301，不合格，改为通过', { workOrder: 'A2301', result: 'FAIL' }],
    ['工单A2301，不合格，今天检查完成，改成合格', { workOrder: 'A2301', result: 'FAIL' }],
    ['工单A2301，不合格，耐压500，改成合格', { workOrder: 'A2301', withstandVoltage: 500, result: 'FAIL' }],
    ['工单A2301，不合格，改成苹果', { workOrder: 'A2301', result: 'FAIL' }],
    ['工单A2301，不合格，改成合格率', { workOrder: 'A2301', result: 'FAIL' }],
    ['接触电阻12，合格，不对，是15', { contactResistance: 12, result: 'PASS' }],
    ['绝缘电阻500000千欧', { insulationResistance: 500 }],
    ['绝缘电阻1千欧', { insulationResistance: 0.001 }],
    ['绝缘电阻500000kΩ', {}],
    ['接触电阻1千欧', {}],
    ['接触电阻一千欧', { contactResistance: 1000000 }],
    ['绝缘电阻一千欧', { insulationResistance: 0.001 }],
    ['绝缘电阻20，不对，是30000千欧', { insulationResistance: 30 }],
    ['绝缘电阻20，不对，是3万千欧', { insulationResistance: 20 }],
    ['耐电压0.5\n千伏通过', { withstandVoltage: 500 }],
    ['工单A2301，paſs', { workOrder: 'A2301' }],
    ['工单A2301，结果FAIL，改成PASS', { workOrder: 'A2301', result: 'PASS' }],
    ['工单A2301，合格，不合格', { workOrder: 'A2301', result: 'FAIL' }],
    ['耐电压-1500伏通过', {}],
    ['耐压负三伏不合格', {}],
    ['耐电压1e3伏合格', {}],
    ['耐电压12至15伏通过', {}],
    ['耐电压一千五百伏通过', {}],
    [`耐压1${'0'.repeat(306)}千伏通过`, {}],
    ['工单A2301，耐压500伏不通过，耐电压-1500伏通过', { workOrder: 'A2301', withstandVoltage: 500, result: 'FAIL' }],
    ['工单A2301，结果FAIL，改成苹果，改成合格', { workOrder: 'A2301', result: 'FAIL' }],
  ])('%s', (input, expected) => {
    const parser = createTextParser()
    const segment = Object.freeze({ text: input })
    const actual = parser.parse(segment)
    expect(Reflect.ownKeys(actual).sort()).toEqual(Reflect.ownKeys(expected).sort())
    expect(actual).toStrictEqual(expected)
    expect(parser.parse(segment)).toStrictEqual(actual)
    expect(segment).toStrictEqual({ text: input })
  })

  test('does not retain record or result-correction context across calls', () => {
    const parser = createTextParser()
    parser.parse({ text: '工单A2301，结果不合格' })
    expect(parser.parse({ text: 'PASS' })).toStrictEqual({})
    expect(parser.parse({ text: '合格' })).toStrictEqual({ result: 'PASS' })
    expect(parser.parse({ text: '改成合格' })).toStrictEqual({})
  })
})
