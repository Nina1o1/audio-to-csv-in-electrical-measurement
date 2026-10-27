import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from '../../../src/modules/m5-csv-exporter/browser-download'
import { createCsvExporter } from '../../../src/modules/m5-csv-exporter'

function browser() {
  const links: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[] = []
  const createElement = vi.fn(() => {
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    links.push(link)
    return link
  })
  const appendChild = vi.fn()
  const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValueOnce('blob:1').mockReturnValue('blob:2')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('document', { createElement, body: { appendChild } })
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  return { links, createElement, appendChild, createObjectURL, revokeObjectURL }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('M5 browser download resource lifecycle', () => {
  it.each([undefined, false])('exports through the real adapter with includeBom=%j and releases resources', async includeBom => {
    const env = browser()
    const time = '2026-10-26T01:30:00.000Z'
    const input = Object.freeze([Object.freeze({
      id: 'r1', workOrder: '\u0085=1', partNumber: '零件,"甲"\r\n乙',
      contactResistance: 0.015, insulationResistance: 200, withstandVoltage: 1500,
      result: 'PASS' as const, createdAt: time, updatedAt: time,
    })])
    const filename = ' 质检 .CSV'
    const result = createCsvExporter().export(input, { filename, includeBom })
    const csv = '工单,料号,接触电阻,绝缘电阻,耐电压,检验结果,创建时间,修改时间'
      + `\r\n'\u0085=1,"零件,""甲""\r\n乙",0.015 mΩ,200 MΩ,1500 V,PASS,${time},${time}`
    const expected = includeBom === false ? csv : `\uFEFF${csv}`
    const blob = env.createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new TextEncoder().encode(expected))
    expect(result).toEqual({ filename, recordCount: 1 })
    expect(env.links[0]).toMatchObject({ href: 'blob:1', download: filename })
    expect(env.links[0]?.click).toHaveBeenCalledOnce()
    expect(env.revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(env.links[0]?.remove).toHaveBeenCalledOnce()
    expect(env.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1')
    expect(input[0]?.workOrder).toBe('\u0085=1')
  })

  it('creates a UTF-8 CSV Blob and initiates download with the unchanged filename, then releases resources', async () => {
    const env = browser()
    downloadCsv('\uFEFFheader\r\ndata', ' 质检 .CSV')
    const blob = env.createObjectURL.mock.calls[0]?.[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob?.type).toBe('text/csv;charset=utf-8')
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer())).slice(0, 3)).toEqual([239, 187, 191])
    expect(env.createElement).toHaveBeenCalledExactlyOnceWith('a')
    expect(env.appendChild).toHaveBeenCalledExactlyOnceWith(env.links[0])
    expect(env.links[0]).toMatchObject({ href: 'blob:1', download: ' 质检 .CSV' })
    expect(env.links[0]?.click).toHaveBeenCalledOnce()
    expect(env.revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(env.links[0]?.remove).toHaveBeenCalledOnce()
    expect(env.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1')
  })

  it.each(['createElement', 'appendChild', 'click'])('cleans created resources when %s fails', stage => {
    const env = browser()
    if (stage === 'createElement') env.createElement.mockImplementation(() => { throw new Error(stage) })
    if (stage === 'appendChild') env.appendChild.mockImplementation(() => { throw new Error(stage) })
    if (stage === 'click') env.appendChild.mockImplementation(() => {
      env.links[0]?.click.mockImplementation(() => { throw new Error(stage) })
    })
    expect(() => downloadCsv('csv', 'a.csv')).toThrow(stage)
    expect(env.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1')
    if (env.links[0]) expect(env.links[0].remove).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not attempt to revoke an uncreated URL when URL creation fails', () => {
    const env = browser()
    env.createObjectURL.mockReset().mockImplementation(() => { throw new Error('URL failed') })
    expect(() => downloadCsv('csv', 'a.csv')).toThrow('URL failed')
    expect(env.revokeObjectURL).not.toHaveBeenCalled()
    expect(env.appendChild).not.toHaveBeenCalled()
  })

  it('does not create URLs or links when Blob creation fails', () => {
    const env = browser()
    vi.stubGlobal('Blob', class { constructor() { throw new Error('Blob failed') } })
    expect(() => downloadCsv('csv', 'a.csv')).toThrow('Blob failed')
    expect(env.createObjectURL).not.toHaveBeenCalled()
    expect(env.appendChild).not.toHaveBeenCalled()
  })

  it('isolates delayed cleanup across repeated downloads', () => {
    const env = browser()
    downloadCsv('first', 'a.csv')
    downloadCsv('second', 'b.csv')
    vi.runAllTimers()
    expect(env.revokeObjectURL.mock.calls).toEqual([['blob:1'], ['blob:2']])
    expect(env.links).toHaveLength(2)
    for (const link of env.links) expect(link.remove).toHaveBeenCalledOnce()
  })

  it('attempts both cleanup actions even when removal or reporting throws', () => {
    const env = browser()
    vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('report failed') })
    downloadCsv('csv', 'a.csv')
    env.links[0]?.remove.mockImplementation(() => { throw new Error('remove failed') })
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(env.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:1')
  })

  it('reports revocation failure without changing the completed download outcome', () => {
    const env = browser()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    env.revokeObjectURL.mockImplementation(() => { throw new Error('revoke failed') })
    downloadCsv('csv', 'a.csv')
    expect(() => vi.runAllTimers()).not.toThrow()
    expect(env.links[0]?.remove).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledOnce()
  })
})
