import { describe, expect, it } from 'vitest'
import { createTextParser } from '../../../src/modules/m2-text-parser'
import type { ParseResult, TranscriptSegment } from '../../../src/shared/data-models'

const parse = (text: string) => createTextParser().parse({ text })

describe('M2 Stage A: fields, values and correction scope', () => {
  it.each<[string, ParseResult]>([
    ['接触电阻12毫欧', { contactResistance: 12 }],
    ['今天先检查一下，接触电阻12毫欧', { contactResistance: 12 }],
    ['耐压500伏，绝缘电阻20兆欧', { withstandVoltage: 500, insulationResistance: 20 }],
    ['接触电阻12，接触电阻改成15毫欧', { contactResistance: 15 }],
    ['接触电阻12，不对，是15毫欧', { contactResistance: 15 }],
    ['工单号 A2301，零件号 P-007', { workOrder: 'A2301', partNumber: 'P-007' }],
    ['工单为 aB_007，零件编号：00-X，检验结果是不通过', { workOrder: 'aB_007', partNumber: '00-X', result: 'FAIL' }],
    ['耐压值:500，结果改为pass', { withstandVoltage: 500, result: 'PASS' }],
    ['接触电阻十二点五', { contactResistance: 12.5 }],
    ['接触电阻十二点五毫欧', { contactResistance: 12.5 }],
    ['接触电阻一二点五', { contactResistance: 12.5 }],
    ['绝缘电阻两百，耐压一千，结果不合格', { insulationResistance: 200, withstandVoltage: 1000, result: 'FAIL' }],
    ['绝缘电阻一百二，耐压两百五', { insulationResistance: 120, withstandVoltage: 250 }],
    ['耐压一百零二', { withstandVoltage: 102 }],
    ['接触电阻12，接触电阻改成负三', { contactResistance: 12 }],
    ['接触电阻12，接触电阻改成15', { contactResistance: 15 }],
    ['接触电阻12，不对，是负三', { contactResistance: 12 }],
    ['接触电阻12，不对，是15，接触电阻改为16', { contactResistance: 16 }],
    ['接触电阻12，绝缘电阻20，不对，是30', { contactResistance: 12, insulationResistance: 30 }],
    ['接触电阻12，结果合格，不对，是15', { contactResistance: 12, result: 'PASS' }],
    ['接触电阻12，今天检查结束，不对，是15', { contactResistance: 12 }],
    ['接触电阻今天已检查，不对，是15', {}],
    ['接触电阻，不对，是15', {}],
    ['接触电阻负三，不对，是15', { contactResistance: 15 }],
    ['接触电阻12，绝缘电阻今天已检查，不对，是30', { contactResistance: 12 }],
    ['接触电阻12；不对，是15', { contactResistance: 12 }],
    ['接触电阻12，不对，是15，不对，是16', { contactResistance: 15 }],
    ['今天检查了500次，通过，接触电阻12，另外还有20件', { contactResistance: 12 }],
    ['接触电阻12耐压500绝缘电阻20', { contactResistance: 12, withstandVoltage: 500, insulationResistance: 20 }],
    ['接触电阻12，接触电阻', { contactResistance: 12 }],
    ['接触电阻\n 12毫欧', { contactResistance: 12 }],
    ['接触电阻\t改成\n12毫欧', { contactResistance: 12 }],
    ['结果通过，结果不通过，结果未知', { result: 'FAIL' }],
    ['工单号 001，工单号 Ab_002，工单号诶零三', { workOrder: 'Ab_002' }],
    ['', {}], ['  \n ', {}], ['今天设备已经检查过了', {}],
    ['接触电阻', {}], ['零件号诶零零七', {}], ['通过', {}],
    ['工单号 A 2301', {}], ['零件号 P-007额外文本', {}],
    ['结果PASSING', {}], ['结果不合格率', {}],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual(expected)
  })

  it.each(['', ' ', '是', '为', '改成', '改为', '：', ':'])('accepts contracted connector %j', connector => {
    expect(parse(`耐压值 ${connector} 500`)).toEqual({ withstandVoltage: 500 })
  })
  it.each(['等于', '为:', '=', '大约', '约'])('does not extend the connector vocabulary with %s', connector => {
    expect(parse(`耐压${connector}500`)).toEqual({})
  })

  // 2026-10-29: 通过 is a process description, removed from the approved result vocabulary.
  it.each(['PASS', 'pass', 'PaSs', '合格'])('maps complete PASS word %s', value => {
    expect(parse(`结果${value}`)).toEqual({ result: 'PASS' })
  })
  it('does not map 通过 even with an explicit result field', () => {
    expect(parse('结果通过')).toStrictEqual({})
  })
  it.each(['FAIL', 'fail', 'FaIl', '不合格', '不通过'])('maps complete FAIL word %s', value => {
    expect(parse(`检验结果${value}`)).toEqual({ result: 'FAIL' })
  })
  it.each([
    '-3', '−3', '负三', '+12', '.5', '12.', '1e3', '1E+3', '1/2', '二分之一',
    '1,000', '1，000', '12-15', '12～15', '12到15', '十二至十五', '一万', '一亿',
    '一千五百', '一千零一', '一〇〇一', '1二', '十二3', '十百', '一百百',
    '一点', '点五', '一百零', 'NaN', 'Infinity', '今天12',
  ])('rejects entire invalid numeric expression %s', value => {
    expect(parse(`接触电阻${value}`)).toEqual({})
    expect(parse(`接触电阻8，接触电阻改成${value}`)).toEqual({ contactResistance: 8 })
  })

  it.each(['零', '〇', '0', '0.0'])('accepts zero %s', value => {
    expect(parse(`耐压${value}`)).toEqual({ withstandVoltage: 0 })
  })

  it.each([null, undefined, [], '接触电阻12', {}, { text: null }, { text: 12 }])('throws TypeError for malformed segment %j', segment => {
    expect(() => createTextParser().parse(segment as unknown as TranscriptSegment)).toThrow(TypeError)
  })

  it('does not mutate input, retain context or share output objects', () => {
    const parser = createTextParser()
    const segment = Object.freeze({ text: '接触电阻12' })
    const first = parser.parse(segment)
    first.contactResistance = 99
    expect(parser.parse(segment)).toEqual({ contactResistance: 12 })
    expect(parser.parse({ text: '不对，是15毫欧' })).toEqual({})
    expect(parser.parse({ text: '耐压500' })).toEqual({ withstandVoltage: 500 })
    expect(segment).toEqual({ text: '接触电阻12' })
  })
})
