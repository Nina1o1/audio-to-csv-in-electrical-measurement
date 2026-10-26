import type { TextParserModule } from '../../contracts/m2-text-parser'
import type { ParseResult, TranscriptSegment } from '../../shared/data-models'
import { parseChineseNumber } from './chinese-number'

type Field = keyof ParseResult
type MeasurementField = 'contactResistance' | 'insulationResistance' | 'withstandVoltage'

const FIELD_ALIASES = {
  工单号: 'workOrder', 工单: 'workOrder', 零件号: 'partNumber', 零件编号: 'partNumber',
  接触电阻: 'contactResistance', 绝缘电阻: 'insulationResistance',
  耐压值: 'withstandVoltage', 耐压: 'withstandVoltage', 检验结果: 'result', 结果: 'result',
} as const satisfies Record<string, Field>

const UNIT_FACTORS: Record<MeasurementField, Readonly<Record<string, number>>> = {
  contactResistance: { mΩ: 1, 毫欧: 1, 毫欧姆: 1, Ω: 1000, 欧: 1000, 欧姆: 1000 },
  insulationResistance: { MΩ: 1, 兆欧: 1, 兆欧姆: 1, Ω: 0.000001, 欧: 0.000001, 欧姆: 0.000001 },
  withstandVoltage: { V: 1, 伏: 1, 伏特: 1, kV: 1000, 千伏: 1000, 千伏特: 1000 },
}
const RESULT_WORDS: Readonly<Record<string, 'PASS' | 'FAIL'>> = {
  PASS: 'PASS', 合格: 'PASS', 通过: 'PASS', FAIL: 'FAIL', 不合格: 'FAIL', 不通过: 'FAIL',
}

function isMeasurement(field: Field): field is MeasurementField {
  return field === 'contactResistance' || field === 'insulationResistance' || field === 'withstandVoltage'
}

function expressionPart(text: string): { expression: string; adjacent: boolean } {
  for (const match of text.matchAll(/[,，;；。!?！？\n]/g)) {
    const index = match.index
    // Keep numeric separators inside the candidate so 1,000 cannot become 1.
    if (/[,，]/.test(match[0]) && /[0-9]/.test(text[index - 1] ?? '') && /[0-9]/.test(text[index + 1] ?? '')) continue
    return {
      expression: text.slice(0, index).trim(),
      adjacent: /^[\s,，;；。!?！？]*$/.test(text.slice(index)),
    }
  }
  return { expression: text.trim(), adjacent: true }
}

function measurementValue(text: string, field: MeasurementField): number | undefined {
  // Match the longest unit suffix before parsing numbers, keeping 千伏 intact
  // in 一点五千伏. The remainder must still be a complete valid numeral.
  const factors = UNIT_FACTORS[field]
  const unit = Object.keys(factors).sort((a, b) => b.length - a.length).find(word => text.endsWith(word))
  const numeral = unit === undefined ? text : text.slice(0, -unit.length).trimEnd()
  const value = /^[0-9]+(?:\.[0-9]+)?$/.test(numeral)
    ? Number(numeral)
    : /^[零〇一二两三四五六七八九十百千点]+$/.test(numeral) ? parseChineseNumber(numeral) : undefined
  // Validate the entire remaining numeral, so μΩ cannot be accepted as Ω and
  // unknown units cannot fall back to no-unit input. Symbols are case-sensitive.
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined
  // Conversion happens once, before candidates can update the public result.
  const normalized = value * (unit === undefined ? 1 : factors[unit]!)
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : undefined
}

/** Create a stateless, synchronous parser for one transcript segment at a time. */
export function createTextParser(): TextParserModule {
  return {
    /** Return sparse standard-unit values; malformed segment structures throw TypeError. */
    parse(segment: TranscriptSegment): ParseResult {
      if (typeof segment !== 'object' || segment === null || Array.isArray(segment) || typeof segment.text !== 'string') {
        throw new TypeError('A transcript segment with string text is required.')
      }
      const text = segment.text
      const result: ParseResult = {}
      // Longest aliases win at the same position, preventing 耐压 from consuming 耐压值.
      const names = Object.keys(FIELD_ALIASES).sort((a, b) => b.length - a.length)
      const events = [...text.matchAll(new RegExp(`${names.join('|')}|[,，]\\s*不对\\s*[,，]\\s*是`, 'g'))]
      let correctionTarget: MeasurementField | undefined
      for (let index = 0; index < events.length; index++) {
        const event = events[index]!
        const field = FIELD_ALIASES[event[0] as keyof typeof FIELD_ALIASES]
        const correction = field === undefined
        const target = field ?? correctionTarget
        correctionTarget = undefined
        if (!target) continue
        const raw = text.slice(event.index + event[0].length, events[index + 1]?.index)
        // Connector whitespace may include line breaks; consume it before clause boundaries.
        const connected = correction ? raw.trimStart() : raw.replace(/^(?:\s*(?:改成|改为|是|为|：|:))?\s*/, '')
        const part = expressionPart(connected)
        const expression = part.expression
        if (isMeasurement(target)) {
          const value = measurementValue(expression, target)
          // Only valid candidates overwrite; invalid later values preserve previous updates.
          if (value !== undefined) result[target] = value
          // Omitted-field corrections only follow an explicitly named, adjacent expression.
          // Do not chain corrections or carry context across unrelated clauses/other fields.
          // A field mention without a numeric expression cannot establish a target.
          const hasNumericStart = /^(?:负|[-−+])?[0-9零〇一二两三四五六七八九十百千点.]/.test(expression)
          if (!correction && part.adjacent && hasNumericStart) correctionTarget = target
        } else if (target === 'result') {
          const value = RESULT_WORDS[expression.toUpperCase()]
          if (value) result.result = value
        } else if (/^[A-Za-z0-9_-]+$/.test(expression)) {
          result[target] = expression
        }
      }
      return result
    },
  }
}
