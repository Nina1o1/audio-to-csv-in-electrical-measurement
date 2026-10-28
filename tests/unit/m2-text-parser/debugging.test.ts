import { describe, expect, test } from 'vitest'
import { createTextParser } from '../../../src/modules/m2-text-parser'
import type { ParseResult } from '../../../src/shared/data-models'

const parse = (text: string) => createTextParser().parse(Object.freeze({ text }))

describe('M2 regression: complete candidates across line breaks', () => {
  test.each<[string, ParseResult]>([
    ['耐压0.5\n千伏', { withstandVoltage: 500 }],
    ['耐压0.5\nkV', { withstandVoltage: 500 }],
    ['接触电阻0.012\n欧姆', { contactResistance: 12 }],
    ['绝缘电阻20000000\n欧姆', { insulationResistance: 20 }],
    ['耐压500伏，耐压0.5\n千伏', { withstandVoltage: 500 }],
    ['耐压5\n安培', {}],
    ['耐压500伏，耐压5\n安培', { withstandVoltage: 500 }],
    ['耐压500伏，耐压12\n至15伏', { withstandVoltage: 500 }],
    ['耐压12\n到15伏', {}],
    ['耐压12\n～15伏', {}],
    ['接触电阻12\n-15毫欧', {}],
    ['耐压一\n点五千伏', {}],
    ['接触电阻1\n2毫欧', {}],
    ['耐压1e\n3伏', {}],
    ['耐压500伏，耐压5\nkv', { withstandVoltage: 500 }],
    ['耐压500\n今天检查结束', {}],
    ['耐压500伏，今天检查结束', { withstandVoltage: 500 }],
    ['接触电阻12毫欧，耐压0.5\n千伏，绝缘电阻20兆欧', { contactResistance: 12, withstandVoltage: 500, insulationResistance: 20 }],
    ['耐压0.5\n千伏，不对，是0.6\n千伏', { withstandVoltage: 600 }],
  ])('%s', (input, expected) => {
    expect(parse(input)).toStrictEqual(expected)
  })

  test.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])('retains the entire candidate across %j', separator => {
    expect(parse(`耐压0.5${separator}千伏`)).toStrictEqual({ withstandVoltage: 500 })
    expect(parse(`耐压500伏，耐压5${separator}安培`)).toStrictEqual({ withstandVoltage: 500 })
    expect(parse(`耐压500伏，耐压12${separator}至15伏`)).toStrictEqual({ withstandVoltage: 500 })
    expect(parse(`接触电阻1${separator}2毫欧`)).toStrictEqual({})
  })
})

describe('M2 regression: structurally identifiable correction context', () => {
  test.each<[string, ParseResult]>([
    ['接触电阻12今天已检查，不对，是15毫欧', {}],
    ['接触电阻12毫欧今天已检查，不对，是15毫欧', {}],
    ['接触电阻12，接触电阻13毫欧今天已检查，不对，是15毫欧', { contactResistance: 12 }],
    ['接触电阻12，接触电阻13毫欧\n今天已检查，不对，是15毫欧', { contactResistance: 12 }],
    ['接触电阻12，接触电阻13毫欧，今天已检查，不对，是15毫欧', { contactResistance: 13 }],
    ['接触电阻负三，不对，是15毫欧', { contactResistance: 15 }],
    ['接触电阻-3毫欧，不对，是15毫欧', { contactResistance: 15 }],
    ['接触电阻−3毫欧，不对，是15毫欧', { contactResistance: 15 }],
    ['接触电阻12，接触电阻负三毫欧', { contactResistance: 12 }],
    ['接触电阻12，不对，是负三毫欧', { contactResistance: 12 }],
    ['接触电阻12，不对，是15伏', { contactResistance: 12 }],
    ['接触电阻12伏，不对，是15毫欧', { contactResistance: 15 }],
    ['接触电阻12，绝缘电阻负三，不对，是20兆欧', { contactResistance: 12, insulationResistance: 20 }],
    ['接触电阻12，结果合格，不对，是15毫欧', { contactResistance: 12, result: 'PASS' }],
    ['接触电阻12，不对，是15毫欧，不对，是16毫欧', { contactResistance: 15 }],
    ['耐压500伏，耐压12\n至15伏，不对，是600伏', { withstandVoltage: 500 }],
  ])('%s', (input, expected) => {
    expect(parse(input)).toStrictEqual(expected)
  })

  test('does not preserve a correction target between calls or instances', () => {
    const parser = createTextParser()
    expect(parser.parse({ text: '接触电阻负三' })).toStrictEqual({})
    expect(parser.parse({ text: '不对，是15毫欧' })).toStrictEqual({})
    expect(createTextParser().parse({ text: '不对，是15毫欧' })).toStrictEqual({})
  })
})

describe('M2 regression: ASCII-only English result folding', () => {
  test.each(['paſs', 'PAſS', 'ｐａｓｓ', 'ＰＡＳＳ', 'ＦＡＩＬ', 'paß', 'pass额外', '不合格率'])('rejects the complete non-vocabulary result %s', word => {
    expect(parse(`结果${word}`)).toStrictEqual({})
    expect(parse(`结果FAIL，结果${word}`)).toStrictEqual({ result: 'FAIL' })
  })

  test.each<[string, ParseResult]>([
    ['结果pass', { result: 'PASS' }],
    ['结果PaSs', { result: 'PASS' }],
    ['结果FAIL', { result: 'FAIL' }],
    ['结果FaIl', { result: 'FAIL' }],
    ['结果合格', { result: 'PASS' }],
    ['结果通过', {}], // Approved speech repair: no PASS from process descriptions.
    ['结果不合格', { result: 'FAIL' }],
    ['结果不通过', { result: 'FAIL' }],
  ])('%s', (input, expected) => {
    expect(parse(input)).toStrictEqual(expected)
  })
})
