import { describe, expect, test } from 'vitest'
import { createTextParser } from '../../../src/modules/m2-text-parser'
import type { TextParserModule } from '../../../src/contracts/m2-text-parser'
import type { ParseResult } from '../../../src/shared/data-models'
import { STUTTER_CASES } from './acceptance/stutter-cases'

function verify(input: string, expected: ParseResult): void {
  const parser: TextParserModule = createTextParser()
  const segment = Object.freeze({ text: input })
  const actual = parser.parse(segment)
  expect(Reflect.ownKeys(actual).sort()).toStrictEqual(Reflect.ownKeys(expected).sort())
  expect(actual).toStrictEqual(expected)
  expect(segment).toStrictEqual({ text: input })
  expect(parser.parse(segment)).toStrictEqual(expected)
  expect(createTextParser().parse(segment)).toStrictEqual(expected)
  parser.parse({ text: '工单OTHER，结果FAIL' })
  actual.partNumber = 'external'
  expect(parser.parse(segment)).toStrictEqual(expected)
}

describe('M2 finite field-name stutter: approved A01–D10', () => {
  test.each(STUTTER_CASES)('$id: $input', ({ input, expected }) => verify(input, expected))
})

describe('M2 stutter: identifier integrity, context and last-valid-value protections', () => {
  test.each<[string, ParseResult]>([
    ['工单单AAB0011料号号cc0022', { workOrder: 'AAB0011', partNumber: 'cc0022' }],
    ['工工单0011料料号00-AA__11', { workOrder: '0011', partNumber: '00-AA__11' }],
    ['工单单是Z_0001-166号cC-0022__', { workOrder: 'Z_0001-16', partNumber: 'cC-0022__' }],
    ['工工工单：AB12料料号为Cc-77', { workOrder: 'AB12', partNumber: 'Cc-77' }],
    ['工单单1715六号c2958', { workOrder: '1715', partNumber: 'c2958' }],
    ['工单A1，工单单改成BB0022', { workOrder: 'BB0022' }],
    ['工单A1，工单单改成诶零三', { workOrder: 'A1' }],
    ['工单A1，工单单', { workOrder: 'A1' }],
    ['料号P1，料号号改为CC0022', { partNumber: 'CC0022' }],
    ['料号P1，料料号改为苹果', { partNumber: 'P1' }],
    ['料号P1，料号号', { partNumber: 'P1' }],
    ['工单单17156', { workOrder: '17156' }],
    ['工单单17156号', {}],
    ['工单单17156号c2958号设备', {}],
    ['工单单1715，6号设备', { workOrder: '1715' }],
    ['工单单1715，第6号c2958', { workOrder: '1715' }],
    ['工单单1715，6号12345', { workOrder: '1715' }],
    ['工单单1715，今天检查，6号c2958', { workOrder: '1715' }],
    ['工单单1715，料号号P1，6号c2958', { workOrder: '1715', partNumber: 'P1' }],
    ['工单单17156号c2958，接触电阻12毫欧，接触电阻改成15毫欧', { workOrder: '1715', partNumber: 'c2958', contactResistance: 15 }],
    ['工单单17156号c2958，接触电阻0.012欧姆，不对，是15毫欧', { workOrder: '1715', partNumber: 'c2958', contactResistance: 15 }],
    ['工单单17156号，接触电阻12毫欧，耐压1.5千伏通过', { contactResistance: 12, withstandVoltage: 1500 }],
    ['工单单17156号c2958，耐压1500伏通过', { workOrder: '1715', partNumber: 'c2958', withstandVoltage: 1500 }],
    ['工单单17156号c2958，结果通过', { workOrder: '1715', partNumber: 'c2958' }],
    ['料号号c2958，合格', { partNumber: 'c2958', result: 'PASS' }],
    ['工单单17156号c2958，不合格，改成合格', { workOrder: '1715', partNumber: 'c2958', result: 'PASS' }],
    ['工单单17156号c2958，合格，不合格', { workOrder: '1715', partNumber: 'c2958', result: 'FAIL' }],
    ['工单单17156号c2958，合格率很高', { workOrder: '1715', partNumber: 'c2958' }],
    ['工单单17156号c2958，接触电阻1,000毫欧', { workOrder: '1715', partNumber: 'c2958' }],
    ['工单单17156号c2958，接触电电阻12毫欧', { workOrder: '1715', partNumber: 'c2958' }],
  ])('%s', (input, expected) => verify(input, expected))
})
