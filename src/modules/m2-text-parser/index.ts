import type { TextParserModule } from '../../contracts/m2-text-parser'
import type { InspectionResult, ParseResult, TranscriptSegment } from '../../shared/data-models'
import { parseChineseNumber } from './chinese-number'

type Field = keyof ParseResult
type MeasurementField = 'contactResistance' | 'insulationResistance' | 'withstandVoltage'

const FIELD_ALIASES: Readonly<Record<string, Field>> = {
  工单号: 'workOrder', 工单: 'workOrder', 零件号: 'partNumber', 零件编号: 'partNumber', 料号: 'partNumber',
  接触电阻: 'contactResistance', 绝缘电阻: 'insulationResistance',
  耐压值: 'withstandVoltage', 耐压: 'withstandVoltage', 耐电压: 'withstandVoltage', 检验结果: 'result', 结果: 'result',
}

const UNIT_FACTORS: Record<MeasurementField, Readonly<Record<string, number>>> = {
  contactResistance: { mΩ: 1, 毫欧: 1, 毫欧姆: 1, Ω: 1000, 欧: 1000, 欧姆: 1000 },
  insulationResistance: { MΩ: 1, 兆欧: 1, 兆欧姆: 1, Ω: 0.000001, 欧: 0.000001, 欧姆: 0.000001, 千欧: 0.001 },
  withstandVoltage: { V: 1, 伏: 1, 伏特: 1, kV: 1000, 千伏: 1000, 千伏特: 1000 },
}
const UNIT_WORDS = [...new Set(Object.values(UNIT_FACTORS).flatMap(units => Object.keys(units)))]
  .sort((a, b) => b.length - a.length)
const RESULT_WORDS: Readonly<Record<string, 'PASS' | 'FAIL'>> = {
  PASS: 'PASS', 合格: 'PASS', 通过: 'PASS', FAIL: 'FAIL', 不合格: 'FAIL', 不通过: 'FAIL',
}
const RESULT_NAMES = Object.keys(RESULT_WORDS).sort((a, b) => b.length - a.length)

function foldResult(text: string): string {
  // Unicode ſ/ß must not expand the fixed ASCII PASS/FAIL vocabulary.
  return text.replace(/[a-z]/g, char => char.toUpperCase())
}

function unsignedNumber(text: string): number | undefined {
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return Number(text)
  return /^[零〇一二两三四五六七八九十百千点]+$/.test(text) ? parseChineseNumber(text) : undefined
}

function isMeasurement(field: Field): field is MeasurementField {
  return field === 'contactResistance' || field === 'insulationResistance' || field === 'withstandVoltage'
}

function expressionPart(text: string): { expression: string; adjacent: boolean } {
  // A line break is whitespace inside a candidate, not proof that its unit is absent.
  // Preserve it so split numbers/ranges fail whole-expression validation instead of joining.
  for (const match of text.matchAll(/[,，;；。!?！？]/g)) {
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

function measurementCandidate(text: string, field: MeasurementField): { value?: number; identifiable: boolean; result?: InspectionResult } {
  const factors = UNIT_FACTORS[field]
  let statedResult: InspectionResult | undefined
  if (field === 'withstandVoltage') {
    // Only a complete voltage + supported unit may carry an attached result word.
    const word = RESULT_NAMES.find(name => foldResult(text).endsWith(name)
      && Object.keys(factors).some(unit => text.slice(0, -name.length).trimEnd().endsWith(unit)))
    if (word) {
      statedResult = RESULT_WORDS[word]
      text = text.slice(0, -word.length).trimEnd()
    }
  }
  const matching = UNIT_WORDS.filter(word => text.endsWith(word))
  // Prefer a compatible, fully parsed unit. In 接触电阻一千欧, 千 belongs to
  // the Chinese numeral and 欧 is the unit; do not let the new 千欧 word steal it.
  const units = [...matching.filter(word => factors[word] !== undefined), ...matching.filter(word => factors[word] === undefined)]
  if (!units.length) units.push('')
  for (const unit of units) {
    const numeral = unit ? text.slice(0, -unit.length).trimEnd() : text
    const unsigned = numeral.replace(/^(?:负|[-−+])/, '')
    const value = unsignedNumber(unsigned)
    if (value === undefined) continue
    const factor = unit ? factors[unit] : 1
    // Structure can identify a correction target even when the value cannot update.
    if (unsigned !== numeral || !Number.isFinite(value) || factor === undefined) return { identifiable: true }
    const normalized = value * factor
    // Convert once; invalid voltage measurements cannot manufacture an attached result.
    if (!Number.isFinite(normalized) || normalized < 0) return { identifiable: true }
    return { value: normalized, identifiable: true, ...(statedResult ? { result: statedResult } : {}) }
  }
  return { identifiable: false }
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
      const resultClause = `(?:^|(?<=[,，;；。!?！？]))\\s*(?:(?:改成|改为)\\s*)?(?:${RESULT_NAMES.join('|')})\\s*(?=$|[,，;；。!?！？])`
      const events = [...text.matchAll(new RegExp(`${names.join('|')}|[,，]\\s*不对\\s*[,，]\\s*是|${resultClause}`, 'gi'))]
      let correctionTarget: MeasurementField | undefined
      let recordSeen = false
      let allowBareResult = false
      let allowResultCorrection = false
      for (let index = 0; index < events.length; index++) {
        const event = events[index]!
        const field = FIELD_ALIASES[event[0]]
        const correction = field === undefined && /^[,，]/.test(event[0])
        const target = field ?? correctionTarget
        correctionTarget = undefined
        const previousBareResult = allowBareResult
        const previousResultCorrection = allowResultCorrection
        allowBareResult = false
        allowResultCorrection = false
        const raw = text.slice(event.index + event[0].length, events[index + 1]?.index)
        if (!field && !correction) {
          const clause = event[0].trim()
          const modifying = /^(?:改成|改为)/.test(clause)
          const value = RESULT_WORDS[foldResult(clause.replace(/^(?:改成|改为)\s*/, ''))]
          // Complete standalone words need adjacent record context; corrections need
          // an adjacent valid result. Unrelated clauses and intervening fields block both.
          if (value && (modifying ? previousResultCorrection : previousBareResult)) {
            result.result = value
            recordSeen = true
            allowBareResult = expressionPart(raw).adjacent
            allowResultCorrection = allowBareResult
          }
          continue
        }
        if (!target) continue
        // Connector whitespace may include line breaks; consume it before clause boundaries.
        const connected = correction ? raw.trimStart() : raw.replace(/^(?:\s*(?:改成|改为|是|为|：|:))?\s*/, '')
        const part = expressionPart(connected)
        const expression = part.expression
        if (isMeasurement(target)) {
          const candidate = measurementCandidate(expression, target)
          // Only valid candidates overwrite; invalid later values preserve previous updates.
          if (candidate.value !== undefined) {
            result[target] = candidate.value
            recordSeen = true
          }
          if (candidate.result) {
            result.result = candidate.result
            allowResultCorrection = part.adjacent
          }
          // Omitted-field corrections only follow an explicitly named, adjacent expression.
          // Do not chain corrections or carry context across unrelated clauses/other fields.
          // Numeric prefixes alone do not prove that an expression has a clear owner.
          if (!correction && part.adjacent && candidate.identifiable) correctionTarget = target
        } else if (target === 'result') {
          const value = RESULT_WORDS[foldResult(expression)]
          if (value) {
            result.result = value
            recordSeen = true
            allowResultCorrection = part.adjacent
          }
        } else if (/^[A-Za-z0-9_-]+$/.test(expression)) {
          result[target] = expression
          recordSeen = true
        }
        allowBareResult = recordSeen && part.adjacent
      }
      return result
    },
  }
}
