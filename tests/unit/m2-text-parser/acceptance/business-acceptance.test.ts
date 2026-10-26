import { describe, expect, test } from 'vitest'
import type { TextParserModule } from '../../../../src/contracts/m2-text-parser'
import type { ParseResult, TranscriptSegment } from '../../../../src/shared/data-models'
import { createTextParser } from '../../../../src/modules/m2-text-parser'
import { BUSINESS_CASES, EDGE_CASES, PENDING_EDGES } from './cases'

/** Assert every own key and primitive value; approximate only numeric values, never shape. */
function expectExactResult(actual: ParseResult, expected: ParseResult): void {
  expect(Object.getPrototypeOf(actual)).toBe(Object.prototype)
  expect(Reflect.ownKeys(actual).sort()).toEqual(Reflect.ownKeys(expected).sort())
  for (const key of Object.keys(expected) as (keyof ParseResult)[]) {
    const value = expected[key]
    if (typeof value === 'number') {
      const measured = actual[key]
      expect(typeof measured).toBe('number')
      expect(Number.isFinite(measured)).toBe(true)
      expect(measured).toBeGreaterThanOrEqual(0)
      // Keep meaningful precision for small converted resistance values as well.
      expect(measured).toBeCloseTo(value, value !== 0 && Math.abs(value) < 0.000001 ? 18 : 12)
    } else {
      expect(actual[key]).toBe(value)
    }
  }
}

describe('M2 business acceptance: Public Interface only', () => {
  const cases = BUSINESS_CASES.filter(item => item.status === 'CONTRACT')
  test.each(cases)('[CONTRACT] $id: $input', ({ input, expected }) => {
    const parser: TextParserModule = createTextParser()
    const segment = Object.freeze({ text: input })
    const result = parser.parse(segment)
    expectExactResult(result, expected)
    expect(parser.parse(segment)).toStrictEqual(result)
    expect(segment.text).toBe(input)
  })

  for (const item of BUSINESS_CASES.filter(item => item.status !== 'CONTRACT')) {
    test.todo(`[${item.status}] ${item.id}: ${item.input} — ${item.reason}`)
  }
})

describe('M2 additional contract safety boundaries', () => {
  test.each(EDGE_CASES)('[CONTRACT] $id: $input', ({ input, expected }) => {
    expectExactResult(createTextParser().parse(Object.freeze({ text: input })), expected)
  })

  test.each<unknown>([null, undefined, [], 12, '耐压500', {}, { text: undefined }, { text: null }, { text: 500 }])(
    '[CONTRACT] malformed segment %j throws TypeError without defining a message contract', input => {
      const parser: TextParserModule = createTextParser()
      expect(() => parser.parse(input as TranscriptSegment)).toThrow(TypeError)
      expectExactResult(parser.parse({ text: '耐压500' }), { withstandVoltage: 500 })
    },
  )

  test('[CONTRACT] X27: snapshots, input immutability and cross-call isolation', () => {
    const parser: TextParserModule = createTextParser()
    const segment = Object.freeze({ text: '接触电阻0.012欧姆' })
    const result = parser.parse(segment)
    result.contactResistance = 999
    result.workOrder = 'external'
    expectExactResult(parser.parse(segment), { contactResistance: 12 })
    expectExactResult(parser.parse({ text: '15毫欧，通过' }), {})
    expectExactResult(parser.parse({ text: '耐压500伏' }), { withstandVoltage: 500 })
    expect(segment).toStrictEqual({ text: '接触电阻0.012欧姆' })
  })

  for (const item of PENDING_EDGES) {
    test.todo(`[NEEDS_SPEC] ${item.id}: ${item.input} — ${item.reason}`)
  }
})
