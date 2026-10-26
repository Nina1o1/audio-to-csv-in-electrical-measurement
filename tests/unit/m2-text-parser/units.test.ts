import { describe, expect, it } from 'vitest'
import { createTextParser } from '../../../src/modules/m2-text-parser'
import type { ParseResult } from '../../../src/shared/data-models'

const parse = (text: string) => createTextParser().parse({ text })
type MeasurementField = 'contactResistance' | 'insulationResistance' | 'withstandVoltage'

describe('M2 Stage B: complete contracted unit vocabulary', () => {
  const unitCases: [string, MeasurementField, string[], number][] = [
    ['接触电阻', 'contactResistance', ['mΩ', '毫欧', '毫欧姆'], 1],
    ['接触电阻', 'contactResistance', ['Ω', '欧', '欧姆'], 1000],
    ['绝缘电阻', 'insulationResistance', ['MΩ', '兆欧', '兆欧姆'], 1],
    ['绝缘电阻', 'insulationResistance', ['Ω', '欧', '欧姆'], 0.000001],
    // Authorized H04 extension: migrate 千欧 from rejection to conversion coverage.
    ['绝缘电阻', 'insulationResistance', ['千欧'], 0.001],
    ['耐压', 'withstandVoltage', ['V', '伏', '伏特'], 1],
    ['耐压', 'withstandVoltage', ['kV', '千伏', '千伏特'], 1000],
  ]
  for (const [name, field, units, factor] of unitCases) {
    for (const unit of units) {
      it.each([0, 0.0123, 12, 20000000])(`converts ${name} %s ${unit}`, value => {
        const result = parse(`${name} ${value} ${unit}`)
        expect(Object.keys(result)).toEqual([field])
        expect(typeof result[field]).toBe('number')
        expect(result[field]).toBeCloseTo(value * factor, 10)
        expect(Number.isFinite(result[field])).toBe(true)
      })
    }
  }

  it.each<[string, ParseResult]>([
    ['接触电阻0.012欧姆', { contactResistance: 12 }],
    ['绝缘电阻20000000欧姆', { insulationResistance: 20 }],
    ['耐压0.5千伏', { withstandVoltage: 500 }],
    ['耐压一点五千伏', { withstandVoltage: 1500 }],
    ['接触电阻0.012欧姆，绝缘电阻20000000欧姆，耐压0.5千伏', { contactResistance: 12, insulationResistance: 20, withstandVoltage: 500 }],
    ['接触电阻0.012欧姆，绝缘电阻20000千欧，耐压0.5千伏', { contactResistance: 12, insulationResistance: 20, withstandVoltage: 500 }],
    ['接触电阻0.012欧姆，接触电阻改成15毫欧', { contactResistance: 15 }],
    ['耐压500伏，耐压改成0.6千伏', { withstandVoltage: 600 }],
    ['接触电阻0.012欧姆，不对，是15毫欧', { contactResistance: 15 }],
    ['耐压500伏，不对，是0.6千伏', { withstandVoltage: 600 }],
    ['接触电阻0.012欧姆，不对，是15', { contactResistance: 15 }],
    ['耐压0.5千伏，耐压12', { withstandVoltage: 12 }],
    ['接触电阻12，接触电阻改成15伏', { contactResistance: 12 }],
    ['接触电阻12，不对，是15微欧', { contactResistance: 12 }],
    ['绝缘电阻20，不对，是20000千欧', { insulationResistance: 20 }],
    ['接触电阻0.015', { contactResistance: 0.015 }],
    ['接触电阻0.015欧', { contactResistance: 15 }],
    ['绝缘电阻200000000欧', { insulationResistance: 200 }],
    ['绝缘电阻200，耐压1500', { insulationResistance: 200, withstandVoltage: 1500 }],
    ['接触电阻12，绝缘电阻20，耐压500', { contactResistance: 12, insulationResistance: 20, withstandVoltage: 500 }],
  ])('%s', (text, expected) => {
    expect(parse(text)).toEqual(expected)
  })

  const rejectedUnits: [string, string[]][] = [
    ['接触电阻', ['μΩ', 'µΩ', '微欧', '微欧姆', 'kΩ', '千欧', 'MΩ', '兆欧', 'V', 'kV', 'mω', 'mΩ', 'ohm', '毫欧元', '毫欧姆数值', 'Ωx']],
    ['绝缘电阻', ['kΩ', '千欧姆', 'mΩ', '毫欧', 'μΩ', 'V', 'mω', 'Mω', '兆欧元']],
    ['耐压', ['v', 'kv', 'KV', 'Kv', 'mV', 'MV', 'Ω', 'mΩ', 'MΩ', '伏安', '千伏特x', 'kVA']],
  ]
  for (const [field, units] of rejectedUnits) {
    it.each(units)(`rejects entire unsupported/mismatched ${field} unit %s`, unit => {
      expect(parse(`${field}12${unit}`)).toEqual({})
    })
  }

  it('keeps the last valid value when raw numeric conversion overflows', () => {
    expect(parse(`接触电阻12，接触电阻${'9'.repeat(400)}毫欧`)).toEqual({ contactResistance: 12 })
  })

  it('keeps the last valid value when unit conversion overflows', () => {
    const finiteDecimal = `1${'0'.repeat(306)}`
    expect(Number.isFinite(Number(finiteDecimal))).toBe(true)
    expect(parse(`耐压500，耐压${finiteDecimal}千伏`)).toEqual({ withstandVoltage: 500 })
    expect(parse(`接触电阻${finiteDecimal}欧姆`)).toEqual({})
  })

  it('does not impose the Chinese numeral limit on Arabic values or converted values', () => {
    expect(parse('耐压1500伏')).toEqual({ withstandVoltage: 1500 })
    expect(parse('耐压一千千伏')).toEqual({ withstandVoltage: 1000000 })
    expect(parse('耐压一千五百伏')).toEqual({})
  })

  it('preserves useful decimal precision without rounding to an application scale', () => {
    expect(parse('接触电阻0.0000123456789欧姆').contactResistance).toBeCloseTo(0.0123456789, 14)
    expect(parse('绝缘电阻0.123456789欧姆').insulationResistance).toBeCloseTo(0.000000123456789, 18)
  })
})
