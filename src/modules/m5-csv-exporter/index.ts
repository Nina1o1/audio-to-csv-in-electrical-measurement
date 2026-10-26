import type {
  CsvExportError, CsvExportErrorCode, CsvExporterModule, CsvExportOptions,
} from '../../contracts/m5-csv-exporter'
import type { InspectionRecord } from '../../shared/data-models'
import { downloadCsv } from './browser-download'

// Export projection is separate from record validation: IDs remain required internally.
const COLUMNS = [
  ['workOrder', '工单号', ''], ['partNumber', '零件号', ''],
  ['contactResistance', '接触电阻值', 'mΩ'], ['insulationResistance', '绝缘电阻值', 'MΩ'],
  ['withstandVoltage', '耐压值', 'V'], ['result', '检验结果', ''],
  ['createdAt', '创建时间', ''], ['updatedAt', '修改时间', ''],
] as const satisfies readonly (readonly [keyof InspectionRecord, string, string])[]
const RECORD_KEYS = ['id', ...COLUMNS.map(([field]) => field)] as const

class CsvFailure extends Error implements CsvExportError {
  constructor(public readonly code: CsvExportErrorCode, message: string) {
    super(message)
    this.name = 'CsvExportError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMeasurement(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const timestamp = Date.parse(value)
  // Parsing alone accepts calendar overflows such as February 30.
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function readRecord(value: unknown): InspectionRecord {
  if (!isObject(value) || Reflect.ownKeys(value).length !== RECORD_KEYS.length
    || !RECORD_KEYS.every(field => Object.hasOwn(value, field))) {
    throw new CsvFailure('INVALID_RECORD', 'A record must contain exactly the nine InspectionRecord fields.')
  }
  const { id, workOrder, partNumber, contactResistance, insulationResistance, withstandVoltage, result, createdAt, updatedAt } = value
  if (!isText(id) || !isText(workOrder) || !isText(partNumber)
    || !isMeasurement(contactResistance) || !isMeasurement(insulationResistance) || !isMeasurement(withstandVoltage)
    || (result !== 'PASS' && result !== 'FAIL')
    || !isTimestamp(createdAt) || !isTimestamp(updatedAt) || updatedAt < createdAt) {
    throw new CsvFailure('INVALID_RECORD', 'Invalid record fields or timestamps.')
  }
  // Read once into owned primitives: later encoding never rereads caller-owned getters.
  return { id, workOrder, partNumber, contactResistance, insulationResistance, withstandVoltage, result, createdAt, updatedAt }
}

function readRecords(value: unknown): InspectionRecord[] {
  if (!Array.isArray(value)) throw new CsvFailure('INVALID_RECORD', 'Records must be an array.')
  if (value.length === 0) throw new CsvFailure('EMPTY_RECORDS', 'At least one record is required.')
  const records: InspectionRecord[] = []
  const ids = new Set<string>()
  for (const item of value) {
    const record = readRecord(item)
    if (ids.has(record.id)) throw new CsvFailure('INVALID_RECORD', 'Record IDs must be unique.')
    ids.add(record.id)
    records.push(record)
  }
  return records
}

function encodeCell(value: string | number): string {
  if (typeof value === 'number') return String(value)
  // Quoting is not formula protection. Inspect past leading whitespace/control
  // characters (including C1), but prefix the original text so no user content is trimmed.
  const leading = /^[\s\u0000-\u001f\u007f-\u009f]*/.exec(value)?.[0] ?? ''
  const dangerous = /^[=+\-@]/.test(value.slice(leading.length)) || /[\t\r\n]/.test(leading)
  const text = dangerous ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function buildCsv(records: readonly InspectionRecord[]): string {
  const header = COLUMNS.map(([, label]) => label).join(',')
  // Units are display suffixes only; the validated numeric record snapshot stays unchanged.
  return [header, ...records.map(record => COLUMNS.map(([field, , unit]) =>
    encodeCell(unit ? `${record[field]} ${unit}` : record[field]),
  ).join(','))].join('\r\n')
}

function readOptions(value: unknown): Required<CsvExportOptions> {
  if (value !== undefined && !isObject(value)) {
    throw new CsvFailure('CSV_GENERATION_FAILED', 'CSV options must be an object.')
  }
  const providedFilename: unknown = value?.filename
  const filename = providedFilename === undefined ? 'inspection-records.csv' : providedFilename
  if (typeof filename !== 'string' || !/\.csv$/i.test(filename)
    || filename.slice(0, -4).trim().length === 0 || /[/\\\u0000-\u001f\u007f]/.test(filename)) {
    throw new CsvFailure('INVALID_FILENAME', 'A nonempty CSV filename without paths or ASCII control characters is required.')
  }
  const providedBom: unknown = value?.includeBom
  const includeBom = providedBom === undefined ? true : providedBom
  if (typeof includeBom !== 'boolean') throw new CsvFailure('CSV_GENERATION_FAILED', 'includeBom must be a boolean.')
  return { filename, includeBom }
}

function generate<T>(operation: () => T): T {
  try { return operation() } catch (error: unknown) {
    if (error instanceof CsvFailure) throw error
    throw new CsvFailure('CSV_GENERATION_FAILED', 'CSV generation failed.')
  }
}

/** Stateless CSV encoding and download initiation; no Vue, storage, UI selection or M4 access. */
export function createCsvExporter(): CsvExporterModule {
  return {
    /** Return eight-column CRLF CSV without ID or BOM; measurement cells include standard units. */
    generateCsv(records) {
      return generate(() => buildCsv(readRecords(records)))
    },

    /** Validate everything before downloading. Success means initiated, not saved to disk. */
    export(records, options) {
      const prepared = generate(() => {
        const snapshot = readRecords(records)
        const { filename, includeBom } = readOptions(options)
        const csv = buildCsv(snapshot)
        return { csv: includeBom ? `\uFEFF${csv}` : csv, filename, recordCount: snapshot.length }
      })
      try { downloadCsv(prepared.csv, prepared.filename) } catch {
        throw new CsvFailure('DOWNLOAD_FAILED', 'The CSV download could not be initiated.')
      }
      return { filename: prepared.filename, recordCount: prepared.recordCount }
    },
  }
}
