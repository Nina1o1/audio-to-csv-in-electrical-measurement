import type { TextParserModule } from '../../contracts/m2-text-parser'
import type { InspectionResult, ParseResult, TranscriptSegment } from '../../shared/data-models'
import { parseChineseNumber } from './chinese-number'

type Field = keyof ParseResult
type MeasurementField = 'contactResistance' | 'insulationResistance' | 'withstandVoltage'
type ParserEvent = { name: string; index: number; field?: Field }

const FIELD_ALIASES: Readonly<Record<string, Field>> = {
  工单号: 'workOrder', 工单: 'workOrder', 零件号: 'partNumber', 零件编号: 'partNumber', 料号: 'partNumber',
  // Consume only approved field-name stutters; never deduplicate identifier characters.
  工工单: 'workOrder', 工工工单: 'workOrder', 工单单: 'workOrder', 料料号: 'partNumber', 料号号: 'partNumber',
  接触电阻: 'contactResistance', 绝缘电阻: 'insulationResistance',
  耐压值: 'withstandVoltage', 耐压: 'withstandVoltage', 耐电压: 'withstandVoltage', 检验结果: 'result', 检测结果: 'result', 结果: 'result',
}

const UNIT_FACTORS: Record<MeasurementField, Readonly<Record<string, number>>> = {
  contactResistance: { mΩ: 1, 毫欧: 1, 毫欧姆: 1, Ω: 1000, 欧: 1000, 欧姆: 1000 },
  insulationResistance: { MΩ: 1, 兆欧: 1, 兆欧姆: 1, Ω: 0.000001, 欧: 0.000001, 欧姆: 0.000001, 千欧: 0.001 },
  withstandVoltage: { V: 1, 伏: 1, 伏特: 1, kV: 1000, 千伏: 1000, 千伏特: 1000 },
}
const UNIT_WORDS = [...new Set(Object.values(UNIT_FACTORS).flatMap(units => Object.keys(units)))]
  .sort((a, b) => b.length - a.length)
const RESULT_WORDS: Readonly<Record<string, 'PASS' | 'FAIL'>> = {
  PASS: 'PASS', 合格: 'PASS', FAIL: 'FAIL', 不合格: 'FAIL', 不通过: 'FAIL',
}
const RESULT_NAMES = Object.keys(RESULT_WORDS).sort((a, b) => b.length - a.length)
// A process description can preserve a voltage without stating the final result.
const VOLTAGE_SUFFIXES = [...RESULT_NAMES, '通过'].sort((a, b) => b.length - a.length)

function withoutConnector(text: string): string {
  return text.replace(/^(?:\s*(?:改成|改为|是|为|：|:))?\s*/, '')
}

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

function expressionPart(text: string, measurement = true): { expression: string; adjacent: boolean } {
  // A line break is whitespace inside a candidate, not proof that its unit is absent.
  // Preserve it so split numbers/ranges fail whole-expression validation instead of joining.
  for (const match of text.matchAll(/[,，;；。!?！？]/g)) {
    const index = match.index
    // Keep numeric separators inside the candidate so 1,000 cannot become 1.
    if (measurement && /[,，]/.test(match[0]) && /[0-9]/.test(text[index - 1] ?? '') && /[0-9]/.test(text[index + 1] ?? '')) continue
    return {
      expression: text.slice(0, index).trim(),
      adjacent: /^[\s,，;；。!?！？]*$/.test(text.slice(index)),
    }
  }
  return { expression: text.trim(), adjacent: true }
}

function withPartAliases(text: string, events: ParserEvent[]): ParserEvent[] {
  return events.flatMap((event, index) => {
    if (event.field !== 'workOrder') return [event]
    const start = event.index + event.name.length
    const raw = text.slice(start, events[index + 1]?.index)
    // Inspect only the next work-order candidate. Never replace ordinary 6号 globally.
    const aliases = [...raw.matchAll(/6号|六号/g)].filter(alias => {
      const prefix = withoutConnector(raw.slice(0, alias.index))
      if (!/^[A-Za-z0-9_-]+[\s,，;；。!?！？]*$/.test(prefix)) return false
      const suffix = withoutConnector(raw.slice(alias.index + alias[0].length))
      return /^[A-Za-z][A-Za-z0-9_-]*$/.test(expressionPart(suffix, false).expression)
    })
    // Ambiguous or incomplete candidates do not establish a field boundary.
    if (aliases.length !== 1) return [event]
    const alias = aliases[0]!
    return [event, { name: alias[0], index: start + alias.index, field: 'partNumber' as const }]
  })
}

function measurementCandidate(text: string, field: MeasurementField): { value?: number; identifiable: boolean; result?: InspectionResult } {
  const factors = UNIT_FACTORS[field]
  let statedResult: InspectionResult | undefined
  if (field === 'withstandVoltage') {
    // Only a complete voltage + supported unit may carry an attached result word.
    const word = VOLTAGE_SUFFIXES.find(name => foldResult(text).endsWith(name)
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
      const events = withPartAliases(text, [...text.matchAll(new RegExp(`${names.join('|')}|[,，]\\s*不对\\s*[,，]\\s*是|${resultClause}`, 'gi'))]
        .map(event => ({ name: event[0], index: event.index, field: FIELD_ALIASES[event[0]] })))
      let correctionTarget: MeasurementField | undefined
      let recordSeen = false
      let allowBareResult = false
      let allowResultCorrection = false
      for (let index = 0; index < events.length; index++) {
        const event = events[index]!
        const field = event.field
        const correction = field === undefined && /^[,，]/.test(event.name)
        const target = field ?? correctionTarget
        correctionTarget = undefined
        const previousBareResult = allowBareResult
        const previousResultCorrection = allowResultCorrection
        allowBareResult = false
        allowResultCorrection = false
        const raw = text.slice(event.index + event.name.length, events[index + 1]?.index)
        if (!field && !correction) {
          const clause = event.name.trim()
          const modifying = /^(?:改成|改为)/.test(clause)
          const value = RESULT_WORDS[foldResult(clause.replace(/^(?:改成|改为)\s*/, ''))]
          // Explicit Chinese judgements can stand alone; other vocabulary keeps its
          // record context requirement. Corrections still need an adjacent valid result.
          const explicitJudgement = clause === '合格' || clause === '不合格'
          if (value && (modifying ? previousResultCorrection : explicitJudgement || previousBareResult)) {
            result.result = value
            recordSeen = true
            allowBareResult = expressionPart(raw).adjacent
            allowResultCorrection = allowBareResult
          }
          continue
        }
        if (!target) continue
        // Connector whitespace may include line breaks; consume it before clause boundaries.
        const connected = correction ? raw.trimStart() : withoutConnector(raw)
        const part = expressionPart(connected, isMeasurement(target))
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
