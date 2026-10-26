import { describe, expect, test } from 'vitest'
import type { TextParserModule } from '../../../../src/contracts/m2-text-parser'
import type { ParseResult } from '../../../../src/shared/data-models'
import { createTextParser } from '../../../../src/modules/m2-text-parser'
import { CONTRACT_CONTROLS, FULL_RECORD_CASES } from './full-record-cases'

function verify(input: string, expected: ParseResult): void {
  const parser: TextParserModule = createTextParser()
  const segment = Object.freeze({ text: input })
  const actual = parser.parse(segment)
  const exactShape = Object.fromEntries(Object.entries(expected).map(([key, value]) => [
    key, typeof value === 'number' ? expect.closeTo(value, 10) : value,
  ]))
  // Strictly check the complete sparse shape; numeric approximation never permits extra keys.
  expect(Reflect.ownKeys(actual).sort()).toEqual(Reflect.ownKeys(expected).sort())
  expect(actual).toStrictEqual(exactShape)
  for (const field of ['contactResistance', 'insulationResistance', 'withstandVoltage'] as const) {
    if (!Object.hasOwn(actual, field)) continue
    expect(typeof actual[field]).toBe('number')
    expect(Number.isFinite(actual[field])).toBe(true)
    expect(actual[field]).toBeGreaterThanOrEqual(0)
  }
  expect(parser.parse(segment)).toStrictEqual(actual)
  expect(segment).toStrictEqual({ text: input })
}

describe('M2 original H01–H18: authorized complete-record contract', () => {
  test.each(FULL_RECORD_CASES)('$id [CONTRACT]: $input', item => {
    verify(item.input, item.requested)
  })
})

describe('M2 independent complete-record controls using the fixed public vocabulary', () => {
  test.each(CONTRACT_CONTROLS)('$id [CONTRACT CONTROL]: $input', item => {
    verify(item.input, item.expected)
  })
})
