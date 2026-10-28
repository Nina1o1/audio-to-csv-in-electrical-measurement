import { describe, expect, test } from 'vitest'
import { createTextParser } from '../../../src/modules/m2-text-parser'
import type { TextParserModule } from '../../../src/contracts/m2-text-parser'
import type { ParseResult } from '../../../src/shared/data-models'
import { SPEECH_REPAIR_CASES } from './acceptance/speech-repair-cases'

function verify(input: string, expected: ParseResult): void {
  const parser: TextParserModule = createTextParser()
  const segment = Object.freeze({ text: input })
  const actual = parser.parse(segment)
  expect(Reflect.ownKeys(actual).sort()).toStrictEqual(Reflect.ownKeys(expected).sort())
  expect(actual).toStrictEqual(expected)
  expect(segment).toStrictEqual({ text: input })
  expect(parser.parse(segment)).toStrictEqual(expected)
  expect(createTextParser().parse(segment)).toStrictEqual(expected)
  // Neither an unrelated previous call nor mutation of an earlier result may leak state.
  parser.parse({ text: '工单OTHER，结果FAIL' })
  actual.workOrder = 'external'
  expect(parser.parse(segment)).toStrictEqual(expected)
}

describe('M2 approved speech repair J/K/L', () => {
  test.each(SPEECH_REPAIR_CASES)('$id: $input', ({ input, expected }) => verify(input, expected))
})

describe('M2 speech repair: restricted alias and result boundaries', () => {
  test.each<[string, ParseResult]>([
    ['工单号是ab_0009-16号p-007_02', { workOrder: 'ab_0009-1', partNumber: 'p-007_02' }],
    ['工单改成Z99；六号c-001', { workOrder: 'Z99', partNumber: 'c-001' }],
    ['工单Z9 6号 c-01接触电阻12', { workOrder: 'Z9', partNumber: 'c-01', contactResistance: 12 }],
    ['工单A6号B，工单Z6号c', { workOrder: 'Z', partNumber: 'c' }],
    ['料号12345', { partNumber: '12345' }],
    ['6号C045', {}], ['六号C045', {}],
    ['接触电阻12毫欧，6号C045', { contactResistance: 12 }],
    ['料号P1，6号C045', { partNumber: 'P1' }],
    ['工单A2301，今天检查，6号C045', { workOrder: 'A2301' }],
    ['工单A2301，第6号C045', { workOrder: 'A2301' }],
    ['工单A2301，接触电阻12毫欧，6号C045', { workOrder: 'A2301', contactResistance: 12 }],
    ['工单A2301，六号工位', { workOrder: 'A2301' }],
    ['工单A2301，6号12345', { workOrder: 'A2301' }],
    ['工单A23016号12345', {}],
    ['工单A2301六号', {}],
    ['工单A2301，六号', { workOrder: 'A2301' }],
    ['工单A2301，6号C045额外文本', { workOrder: 'A2301' }],
    ['工单A2301，6号C 045', { workOrder: 'A2301' }],
    ['工单A23016号C0456号D001', {}],
    ['工单A2301，6号C045，6号D001', { workOrder: 'A2301', partNumber: 'C045' }],
    ['工单A2301，料号P1，6号C045', { workOrder: 'A2301', partNumber: 'P1' }],
    ['工单A2301，6号C045，料号改成P2', { workOrder: 'A2301', partNumber: 'P2' }],
    ['工单A2301，结果FAIL，6号C045', { workOrder: 'A2301', result: 'FAIL' }],
    ['工单A2301，6号C045，工单A23016', { workOrder: 'A23016', partNumber: 'C045' }],
    ['接触电阻1,000毫欧', {}], ['耐压1，000伏通过', {}],
    ['结果通过', {}], ['检验结果通过', {}], ['检测结果通过', {}],
    ['工单A1，通过', { workOrder: 'A1' }],
    ['结果FAIL，结果通过', { result: 'FAIL' }],
    ['结果FAIL，改成通过', { result: 'FAIL' }],
    ['耐压1500伏通过，改成合格', { withstandVoltage: 1500 }],
    ['耐压1.5千伏通过', { withstandVoltage: 1500 }],
    ['耐压0.5\n千伏通过', { withstandVoltage: 500 }],
    ['耐压1500伏通过率', {}], ['耐压1500伏通过今天结束', {}],
    ['耐压1500通过', {}], ['耐压5安培通过', {}], ['耐压-1500伏通过', {}],
    ['耐压500伏，耐压5安培通过', { withstandVoltage: 500 }],
    ['今天测试合格了', {}], ['合格率', {}], ['不合格率', {}],
    ['合格，不合格', { result: 'FAIL' }], ['不合格，合格', { result: 'PASS' }],
    ['不合格，改成合格', { result: 'PASS' }],
    ['合格，改成通过', { result: 'PASS' }],
    ['改成合格', {}], ['PASS', {}], ['FAIL', {}], ['不通过', {}],
    ['检测结果不合格', { result: 'FAIL' }],
    ['检验结果PASS', { result: 'PASS' }], ['结果不通过', { result: 'FAIL' }],
    ['耐压1500伏不通过', { withstandVoltage: 1500, result: 'FAIL' }],
    ['耐压1500伏合格', { withstandVoltage: 1500, result: 'PASS' }],
  ])('%s', (input, expected) => verify(input, expected))
})
