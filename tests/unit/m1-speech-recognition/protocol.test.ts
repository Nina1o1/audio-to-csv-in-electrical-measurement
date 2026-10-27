import { describe, expect, it, vi } from 'vitest'
import { audioFrame, commandOf, decodeIat, IatText, recordingText } from '../../../src/modules/m1-speech-recognition/protocol'
import { proxySocket } from '../../../src/modules/m1-speech-recognition/browser'

function result(sn: number, text: string, status = 1, extra: object = {}) {
  return decodeIat(JSON.stringify({ code: 0, data: { status, result: { sn, ws: [{ cw: [{ w: text }, { w: 'alternative' }] }], ...extra } } }))
}

describe('IAT decoding and text ledger', () => {
  it('uses one candidate per word, including empty punctuation results', () => {
    expect(result(0, '正文').result?.text).toBe('正文')
    expect(result(1, '').result?.text).toBe('')
  })
  it('supports final frames with no result object', () => {
    expect(decodeIat('{"code":0,"data":{"status":2}}')).toEqual({ status: 2, ended: true })
  })
  it.each([
    null, '{}', '{', '{"code":0}', '{"code":1}',
    '{"code":0,"data":{"status":3}}',
    '{"code":0,"data":{"status":1,"result":{"sn":0,"ws":[{"cw":[]}]}}}',
  ])('rejects malformed response %s', value => { expect(() => decodeIat(value)).toThrow() })
  it('requires valid replacement ranges', () => {
    for (const rg of [[2, 1], [-1, 2], [0], ['1', 2]]) {
      expect(() => result(2, 'x', 1, { pgs: 'rpl', rg })).toThrow()
    }
  })
  it('applies replacement ranges once, drops stale replaced content and finalizes only at status=2', () => {
    const ledger = new IatText()
    const first = result(1, '接触电阻1', 1, { pgs: 'apd' })
    ledger.accept(first); expect(ledger.accept(first)).toBe(false)
    const correction = result(2, '接触电阻12', 1, { pgs: 'rpl', rg: [1, 1] })
    ledger.accept(correction); ledger.accept(first); ledger.accept(correction)
    expect(ledger.snapshot()).toEqual({ confirmedText: '', interimText: '接触电阻12' })
    ledger.accept(result(3, '。', 2, { pgs: 'apd' }))
    expect(ledger.snapshot()).toEqual({ confirmedText: '接触电阻12。', interimText: '' })
    expect(ledger.accept(result(4, '迟到'))).toBe(false)
  })
  it('rejects conflicting duplicates rather than corrupting confirmed text', () => {
    const ledger = new IatText(); ledger.accept(result(0, 'one'))
    expect(() => ledger.accept(result(0, 'two'))).toThrow()
  })
  it('replays out-of-order corrections without resurrecting replaced words', () => {
    const ledger = new IatText()
    ledger.accept(result(2, '正确', 1, { pgs: 'rpl', rg: [1, 1] }))
    ledger.accept(result(1, '错误', 1, { pgs: 'apd' }))
    ledger.accept(decodeIat('{"code":0,"data":{"status":2}}'))
    expect(ledger.snapshot()).toEqual({ confirmedText: '正确', interimText: '' })
  })
  it('rejects a switch from immutable to mutable results rather than retracting executed commands', () => {
    const ledger = new IatText(); ledger.accept(result(0, '正文。'))
    expect(() => ledger.accept(result(1, '替换', 1, { pgs: 'rpl', rg: [0, 0] }))).toThrow('mutable')
    expect(ledger.snapshot().confirmedText).toBe('正文。')
  })
  it('does not finalize incomplete sequence results', () => {
    const ledger = new IatText(); ledger.accept(result(3, 'tail'))
    expect(ledger.snapshot()).toEqual({ confirmedText: '', interimText: 'tail' })
    ledger.accept(decodeIat('{"code":0,"data":{"status":2}}'))
    expect(() => ledger.snapshot()).toThrow('Incomplete')
  })
  it('retains the confirmed contiguous prefix while later sequence results have a gap', () => {
    const ledger = new IatText()
    ledger.accept(result(0, '已确认正文，'))
    ledger.accept(result(2, '后续内容。'))
    expect(ledger.snapshot()).toEqual({ confirmedText: '已确认正文，', interimText: '后续内容。' })
    ledger.accept(result(1, '中间内容，'))
    expect(ledger.snapshot()).toEqual({ confirmedText: '已确认正文，中间内容，后续内容。', interimText: '' })
  })
  it('generates credential-free audio frames', () => {
    const message = audioFrame(new Uint8Array([0, 128, 255, 127]), true)
    expect(JSON.parse(message).data.audio).toBe('AID/fw==')
    expect(message).not.toMatch(/api_key|secret|common|business|wpgs/)
  })
})

describe('conservative command boundaries', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('does not recognize inherited object property %s', text => {
    expect(commandOf(text)).toBeUndefined()
  })
  it('keeps interior words unchanged and matches full confirmation words', () => {
    expect(commandOf('确认保存。')).toBe('CONFIRM_SAVE')
    expect(commandOf('确认删除')).toBe('CONFIRM_DELETE')
    expect(commandOf('不要删除')).toBeUndefined()
    expect(recordingText('说明结束输入后检查。', true)).toEqual({ text: '说明结束输入后检查。', stop: false })
  })
  it('holds only incomplete stop-command prefixes and preserves actual ordinary text', () => {
    expect(recordingText('耐压12。结束输', false).text).toBe('耐压12')
    expect(recordingText('耐压12。结束输送', false).text).toBe('耐压12。结束输送')
    expect(recordingText('耐压12。结束输', true).text).toBe('耐压12。结束输')
  })
  it('excludes a complete stop command and all following content', () => {
    expect(recordingText('工单A，结束录入。保存。', true)).toEqual({ text: '工单A', stop: true })
  })
  it('requires a sentence boundary rather than treating a transport chunk end as a command', () => {
    expect(recordingText('结束输入', false)).toEqual({ text: '', stop: false })
    expect(recordingText('结束输入后的说明', false)).toEqual({ text: '结束输入后的说明', stop: false })
    expect(recordingText('结束输入', true)).toEqual({ text: '', stop: true })
  })
})

describe('same-origin proxy URL', () => {
  it.each(['https://attacker.example/iat', '/api/m1/iat?key=secret', '/api/m1/iat#fragment'])('rejects %s', path => {
    vi.stubGlobal('location', { href: 'https://app.example/', origin: 'https://app.example' })
    expect(() => proxySocket(path)).toThrow(); vi.unstubAllGlobals()
  })
  it('uses ws only on localhost for development', () => {
    vi.stubGlobal('location', { href: 'http://localhost:5173/', origin: 'http://localhost:5173' })
    const socket = vi.fn(); vi.stubGlobal('WebSocket', class { constructor(url: URL) { socket(url.href) } })
    proxySocket('/api/m1/iat'); expect(socket).toHaveBeenCalledWith('ws://localhost:5173/api/m1/iat')
    vi.unstubAllGlobals()
  })
})
