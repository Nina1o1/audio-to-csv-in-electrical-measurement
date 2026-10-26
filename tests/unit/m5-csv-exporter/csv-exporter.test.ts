import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CsvExportOptions } from '../../../src/contracts/m5-csv-exporter'
import type { InspectionRecord } from '../../../src/shared/data-models'
import { createCsvExporter } from '../../../src/modules/m5-csv-exporter'
import { downloadCsv } from '../../../src/modules/m5-csv-exporter/browser-download'

vi.mock('../../../src/modules/m5-csv-exporter/browser-download', () => ({ downloadCsv: vi.fn() }))

const TIME = '2026-10-26T01:30:00.000Z'
const HEADER = '工单号,零件号,接触电阻值,绝缘电阻值,耐压值,检验结果,创建时间,修改时间'
const exporter = createCsvExporter()
function record(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  return { id: 'r1', workOrder: 'WO-001', partNumber: 'P-007', contactResistance: 0,
    insulationResistance: 200, withstandVoltage: 1500, result: 'PASS',
    createdAt: TIME, updatedAt: TIME, ...overrides }
}
const records = (value: unknown) => value as readonly InspectionRecord[]
const options = (value: unknown) => value as CsvExportOptions

afterEach(() => { vi.mocked(downloadCsv).mockReset(); vi.unstubAllGlobals() })

describe('M5 CSV public contracts', () => {
  it('generates exactly eight ordered columns without ID, preserves record order and uses CRLF without BOM', () => {
    expect(exporter.generateCsv([record(), record({ id: 'r2', result: 'FAIL' })])).toBe(
      `${HEADER}\r\nWO-001,P-007,0 mΩ,200 MΩ,1500 V,PASS,${TIME},${TIME}\r\nWO-001,P-007,0 mΩ,200 MΩ,1500 V,FAIL,${TIME},${TIME}`,
    )
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  it('omits internal IDs from both generated CSV and downloaded CSV while retaining eight columns', () => {
    const input = [record({ id: 'INTERNAL-ID-NOT-FOR-EXPORT', contactResistance: 12.5 })]
    const expected = `${HEADER}\r\nWO-001,P-007,12.5 mΩ,200 MΩ,1500 V,PASS,${TIME},${TIME}`
    expect(exporter.generateCsv(input)).toBe(expected)
    exporter.export(input)
    expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(`\uFEFF${expected}`, 'inspection-records.csv')
    expect(expected.split('\r\n').map(row => row.split(',').length)).toEqual([8, 8])
    expect(expected).not.toContain(input[0]!.id)
    expect(input[0]).toMatchObject({ contactResistance: 12.5, insulationResistance: 200, withstandVoltage: 1500 })
  })

  it('escapes commas, quotes, CR and LF while preserving Unicode and original cell content', () => {
    expect(exporter.generateCsv([record({ workOrder: '工单,"甲"\r\n乙🙂', partNumber: 'P\rQ\nR' })]))
      .toBe(`${HEADER}\r\n"工单,""甲""\r\n乙🙂","P\rQ\nR",0 mΩ,200 MΩ,1500 V,PASS,${TIME},${TIME}`)
  })

  it.each(['=1+1', '+SUM(A1)', '-1', '@cmd', '  =1', '\u0000\u0001+1', '\u007f@x', '\u00a0=1', '\tplain', '\rplain', '\nplain', ' \tplain'])
  ('protects dangerous text before CSV escaping: %j', value => {
    const csv = exporter.generateCsv([record({ workOrder: value })])
    const protectedValue = `'${value}`
    const encoded = /[",\r\n]/.test(protectedValue) ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue
    expect(csv).toBe(`${HEADER}\r\n${encoded},P-007,0 mΩ,200 MΩ,1500 V,PASS,${TIME},${TIME}`)
  })

  it('protects every user text column and composes formula protection with escaping', () => {
    expect(exporter.generateCsv([record({ id: '=ID', workOrder: '=SUM(1,2)', partNumber: '+"P"' })]))
      .toBe(`${HEADER}\r\n"'=SUM(1,2)","'+""P""",0 mΩ,200 MΩ,1500 V,PASS,${TIME},${TIME}`)
  })

  it.each(Array.from({ length: 32 }, (_, index) => index + 0x80))
  ('protects formulas after C1 control U+%i in both public methods', code => {
    for (const prefix of ['=', '+', '-', '@']) {
      const text = `${String.fromCharCode(code)}${prefix}1`
      const input = [record({ id: text, workOrder: text, partNumber: text })]
      const expected = `${HEADER}\r\n'${text},'${text},0 mΩ,200 MΩ,1500 V,PASS,${TIME},${TIME}`
      expect(exporter.generateCsv(input)).toBe(expected)
      exporter.export(input)
      expect(downloadCsv).toHaveBeenLastCalledWith(`\uFEFF${expected}`, 'inspection-records.csv')
    }
  })

  it('preserves safe C1-prefixed text and protects mixed leading control and whitespace prefixes', () => {
    const input = [record({ workOrder: '\u0085safe', partNumber: ' \u0085\t\u009f=1' })]
    const expected = `${HEADER}\r\n\u0085safe,' \u0085\t\u009f=1,0 mΩ,200 MΩ,1500 V,PASS,${TIME},${TIME}`
    expect(exporter.generateCsv(input)).toBe(expected)
    exporter.export(input)
    expect(downloadCsv).toHaveBeenLastCalledWith(`\uFEFF${expected}`, 'inspection-records.csv')
  })

  it.each(['A-B', "'already safe", ' normal ', '测试🙂', 'A\tB'])('preserves safe text %j', workOrder => {
    expect(exporter.generateCsv([record({ workOrder })])).toContain(`${workOrder},P-007`)
  })

  it('appends standard units without rounding or changing numeric values', () => {
    expect(exporter.generateCsv([record({ contactResistance: 0.015, insulationResistance: Number.MAX_VALUE, withstandVoltage: -0 })]))
      .toContain(',0.015 mΩ,1.7976931348623157e+308 MΩ,0 V,PASS,')
  })

  it.each([undefined, null, {}, 'records', [null], [1], new Array(1)])('rejects malformed collections %j', value => {
    expect(() => exporter.generateCsv(records(value))).toThrowError(expect.objectContaining({ code: 'INVALID_RECORD' }))
    expect(() => exporter.export(records(value))).toThrowError(expect.objectContaining({ code: 'INVALID_RECORD' }))
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  it('rejects empty collections in both methods', () => {
    expect(() => exporter.generateCsv([])).toThrowError(expect.objectContaining({ code: 'EMPTY_RECORDS' }))
    expect(() => exporter.export([])).toThrowError(expect.objectContaining({ code: 'EMPTY_RECORDS' }))
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  const invalidRecords: unknown[] = [
    {}, { ...record(), extra: true }, { ...record(), [Symbol('extra')]: true },
    ...['id', 'workOrder', 'partNumber'].flatMap(field => ['', ' \t ', null, 1].map(value => ({ ...record(), [field]: value }))),
    ...['contactResistance', 'insulationResistance', 'withstandVoltage'].flatMap(field =>
      [-1, NaN, Infinity, -Infinity, '12', null, undefined].map(value => ({ ...record(), [field]: value }))),
    { ...record(), result: 'pass' }, { ...record(), result: null },
    ...['createdAt', 'updatedAt'].flatMap(field => ['2026-02-30T01:30:00.000Z', '2026-10-26T01:30:00Z', '2026-10-26T09:30:00.000+08:00', null]
      .map(value => ({ ...record(), [field]: value }))),
    record({ updatedAt: '2026-10-25T01:30:00.000Z' }),
  ]
  it.each(invalidRecords)('rejects an invalid record atomically: %j', invalid => {
    // Distinct surrounding IDs ensure duplicate rejection cannot mask a missing field validator.
    const before = record({ id: 'valid-before' })
    const after = record({ id: 'valid-after' })
    for (const batch of [[invalid], [invalid, after], [before, invalid, after], [before, invalid]]) {
      expect(() => exporter.generateCsv(records(batch))).toThrowError(expect.objectContaining({ code: 'INVALID_RECORD' }))
      expect(() => exporter.export(records(batch))).toThrowError(expect.objectContaining({ code: 'INVALID_RECORD' }))
    }
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  it('rejects missing or inherited fields and duplicate IDs', () => {
    const missing: Partial<InspectionRecord> = record()
    delete missing.partNumber
    for (const batch of [[missing], [Object.create(record())], [record(), record()]]) {
      expect(() => exporter.generateCsv(records(batch))).toThrowError(expect.objectContaining({ code: 'INVALID_RECORD' }))
      expect(() => exporter.export(records(batch))).toThrowError(expect.objectContaining({ code: 'INVALID_RECORD' }))
    }
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  it('does not mutate or retain records; repeated calls and independent returned objects are isolated', () => {
    const input = Object.freeze([Object.freeze(record({ workOrder: '=1' }))])
    const before = JSON.stringify(input)
    const csv = exporter.generateCsv(input)
    const first = exporter.export(input)
    first.filename = 'changed.csv'
    expect(exporter.export(input)).toEqual({ filename: 'inspection-records.csv', recordCount: 1 })
    expect(exporter.generateCsv(input)).toBe(csv)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('defaults to BOM and returns only the actual filename and count', () => {
    expect(exporter.export([record()])).toEqual({ filename: 'inspection-records.csv', recordCount: 1 })
    expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(`\uFEFF${exporter.generateCsv([record()])}`, 'inspection-records.csv')
  })

  it.each([undefined, {}, { filename: undefined, includeBom: undefined }])('accepts default options %j', value => {
    expect(exporter.export([record()], value)).toEqual({ filename: 'inspection-records.csv', recordCount: 1 })
    expect(downloadCsv).toHaveBeenCalledWith(expect.stringMatching(/^\uFEFF/), 'inspection-records.csv')
  })

  it.each(['质检记录.csv', 'inspection-records.CSV', ' records .csv', 'a.b.csv'])('preserves legal filenames %j', filename => {
    expect(exporter.export([record()], { filename, includeBom: false }).filename).toBe(filename)
    expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(exporter.generateCsv([record()]), filename)
  })

  it.each(['', '.csv', ' .CSV', 'records.txt', 'folder/records.csv', 'folder\\records.csv', 'a.csv ', null, 1,
    ...Array.from({ length: 33 }, (_, index) => `r${String.fromCharCode(index === 32 ? 127 : index)}.csv`),
  ])('rejects invalid filename %j without downloading', filename => {
    expect(() => exporter.export([record()], options({ filename })))
      .toThrowError(expect.objectContaining({ code: 'INVALID_FILENAME' }))
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  it.each([null, [], 'options', 1, { includeBom: null }, { includeBom: 'false' }, { includeBom: 0 }])
  ('rejects malformed options %j without downloading', value => {
    expect(() => exporter.export([record()], options(value)))
      .toThrowError(expect.objectContaining({ code: 'CSV_GENERATION_FAILED' }))
    expect(downloadCsv).not.toHaveBeenCalled()
  })

  it('maps unexpected encoding failures and can subsequently export valid data', () => {
    const broken = Object.defineProperty(record(), 'workOrder', { get() { throw new Error('getter failed') } })
    expect(() => exporter.generateCsv([broken])).toThrowError(expect.objectContaining({ code: 'CSV_GENERATION_FAILED' }))
    expect(() => exporter.export([broken])).toThrowError(expect.objectContaining({ code: 'CSV_GENERATION_FAILED' }))
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(exporter.export([record()])).toEqual({ filename: 'inspection-records.csv', recordCount: 1 })
  })

  it('maps download failures and allows later attempts', () => {
    vi.mocked(downloadCsv).mockImplementationOnce(() => { throw new Error('click failed') })
    expect(() => exporter.export([record()])).toThrowError(expect.objectContaining({ code: 'DOWNLOAD_FAILED' }))
    expect(exporter.export([record()])).toEqual({ filename: 'inspection-records.csv', recordCount: 1 })
  })

  it('does not read localStorage', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    exporter.generateCsv([record()])
    exporter.export([record()])
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
