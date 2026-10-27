import { reactive } from 'vue'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { useManualWorkflow } from '../../src/app/useManualWorkflow'
import { createSpeechRecognition } from '../../src/modules/m1-speech-recognition'
import { captureAudio } from '../../src/modules/m1-speech-recognition/audio'
import { createTextParser } from '../../src/modules/m2-text-parser'
import { createDraftManager } from '../../src/modules/m3-draft-manager'
import { createRecordManager } from '../../src/modules/m4-record-manager'
import type { DraftFields, InspectionFields, InspectionRecord, ParseResult, TranscriptSegment } from '../../src/shared/data-models'

vi.mock('../../src/modules/m1-speech-recognition/audio', () => ({ captureAudio: vi.fn() }))
class Commands {
  static instances: Commands[] = []
  lang = ''; continuous = false; interimResults = false
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null
  start() {}
  abort() {}
  constructor() { Commands.instances.push(this) }
  result(text: string) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }) }
}
class Socket {
  static instances: Socket[] = []
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn()
  constructor() { Socket.instances.push(this) }
  result(text: string, sn: number, status: number) {
    this.onmessage?.({ data: JSON.stringify({ code: 0, data: { status, result: { sn, ws: [{ cw: [{ w: text }] }] } } }) })
  }
}
const currentCommand = () => Commands.instances.at(-1)!
const flush = async () => { await Promise.resolve(); await Promise.resolve() }
let dispose: (() => void) | undefined

afterEach(() => { dispose?.(); dispose = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('real M1 → App → M2 → M3 → App → M4, with browser/audio boundaries replaced', () => {
  it('recovers explicitly through proxy login after a failed handshake, ignoring duplicate commands and old callbacks', async () => {
    vi.useFakeTimers(); Commands.instances = []; Socket.instances = []
    vi.stubGlobal('SpeechRecognition', Commands); vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('location', { href: 'https://inspection.example/', origin: 'https://inspection.example' })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const login = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', login)
    const leases: { stop: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; send: (frame: Uint8Array) => void }[] = []
    vi.mocked(captureAudio).mockImplementation(async (_abort, send, _fault, prepared) => {
      const lease = { stop: vi.fn(), start: vi.fn(), send }; leases.push(lease)
      prepared?.(lease.start); return lease
    })
    const speech = createSpeechRecognition(), errors = vi.fn(), complete = vi.fn()
    speech.onError(errors); speech.onTranscriptComplete(complete)
    const ui = reactive(useManualWorkflow({ speechRecognition: speech }))
    dispose = ui.dispose; ui.initialize()
    const first = ui.toggleListening(); currentCommand().onstart?.(); await first
    const oldCommand = currentCommand(), lateError = oldCommand.onerror!, lateEnd = oldCommand.onend!
    oldCommand.result('开始输入'); oldCommand.result('开始输入'); await flush()
    expect(leases).toHaveLength(1); expect(Socket.instances).toHaveLength(1)
    lateError({ error: 'aborted' }); lateEnd()
    expect(ui.microphone).toBe('RECORDING'); expect(errors).not.toHaveBeenCalled()
    const old = Socket.instances[0]!, oldFault = old.onerror!, oldClose = old.onclose!
    oldFault(); oldClose(); await flush()
    expect(ui.microphone).toBe('IDLE'); expect(errors).toHaveBeenCalledOnce()
    expect(old.send).not.toHaveBeenCalled(); expect(leases[0]!.start).not.toHaveBeenCalled()
    expect(leases[0]!.stop).toHaveBeenCalledOnce(); expect(complete).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await ui.loginVoice('test-access-password-only')
    expect(login).toHaveBeenCalledOnce(); expect(ui.authMessage).toContain('登录成功')
    const next = ui.toggleListening(); currentCommand().onstart?.(); await next
    currentCommand().result('开始输入'); await flush()
    const socket = Socket.instances[1]!
    oldFault(); oldClose(); lateError({ error: 'network' }); lateEnd()
    expect(ui.microphone).toBe('RECORDING'); expect(errors).toHaveBeenCalledOnce()
    expect(socket.send).not.toHaveBeenCalled()
    socket.onopen?.(); expect(leases[1]!.start).toHaveBeenCalledOnce()
    leases[1]!.send(new Uint8Array(1280)); expect(socket.send).toHaveBeenCalledOnce()
    socket.result('工单A2301，', 0, 1); expect(ui.confirmedText).toBe('工单A2301，')
    socket.result('接触电阻12毫欧。', 1, 1); expect(ui.confirmedText).toContain('12毫欧')
    socket.result('结束输入。', 2, 2); await flush(); currentCommand().onstart?.(); await flush()
    expect(ui.draft).toMatchObject({ workOrder: 'A2301', contactResistance: 12 })
    expect(complete).toHaveBeenCalledTimes(2); expect(errors).toHaveBeenCalledOnce()
    expect(ui.microphone).toBe('LISTENING'); expect(ui.speechError).toBe('')
    currentCommand().result('开始输入'); await flush()
    expect(Socket.instances).toHaveLength(3)
    ui.stopInput(); currentCommand().onstart?.(); await flush()
    ui.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['natural', 'voice-stop', 'interrupted', 'offline'] as const)('preserves data contracts and save ordering after %s completion', async ending => {
    vi.useFakeTimers(); Commands.instances = []; Socket.instances = []
    vi.stubGlobal('SpeechRecognition', Commands); vi.stubGlobal('WebSocket', Socket)
    vi.stubGlobal('location', { href: 'https://inspection.example/', origin: 'https://inspection.example' })
    const storage = { getItem: () => null, setItem: vi.fn<(key: string, value: string) => void>() }
    vi.stubGlobal('localStorage', storage)
    const network = new EventTarget()
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('addEventListener', network.addEventListener.bind(network))
    const removeOffline = vi.fn(network.removeEventListener.bind(network))
    vi.stubGlobal('removeEventListener', removeOffline)
    const stopAudio = vi.fn()
    let frame!: (data: Uint8Array) => void
    vi.mocked(captureAudio).mockImplementation(async (_abort, send, _fault, prepared) => {
      frame = send; prepared?.(() => undefined); return { stop: stopAudio }
    })
    const parser = createTextParser()
    const originalParse = parser.parse.bind(parser), parse = vi.spyOn(parser, 'parse')
    const speech = createSpeechRecognition(), draft = createDraftManager(), records = createRecordManager()
    expectTypeOf(speech.onTranscriptComplete).parameter(0).parameter(0).toEqualTypeOf<TranscriptSegment>()
    expectTypeOf(parser.parse).parameter(0).toEqualTypeOf<TranscriptSegment>()
    expectTypeOf(parser.parse).returns.toEqualTypeOf<ParseResult>()
    expectTypeOf(draft.applyParseResult).parameter(0).toEqualTypeOf<ParseResult>()
    expectTypeOf(draft.getDraft).returns.toEqualTypeOf<DraftFields>()
    expectTypeOf(draft.confirmSave).returns.toEqualTypeOf<InspectionRecord>()
    expectTypeOf(records.save).parameter(0).toEqualTypeOf<InspectionRecord>()
    const segments: TranscriptSegment[] = []
    const subscribeComplete = speech.onTranscriptComplete.bind(speech)
    vi.spyOn(speech, 'onTranscriptComplete').mockImplementation(callback => subscribeComplete(segment => {
      segments.push(segment)
      // Freeze the exact object received by App so mutations fail instead of going unnoticed.
      Object.freeze(segment)
      callback(segment)
    }))
    const apply = vi.spyOn(draft, 'applyParseResult')
    let parsed: ParseResult | undefined
    parse.mockImplementation(segment => {
      parsed = originalParse(segment)
      Object.freeze(parsed)
      return parsed
    })
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ui = reactive(useManualWorkflow({ speechRecognition: speech, textParser: parser, draftManager: draft, createRecords: () => records }))
    dispose = ui.dispose; ui.initialize(); ui.updateField('workOrder', 'MANUAL')
    const listening = ui.toggleListening(); currentCommand().onstart?.(); await listening
    currentCommand().result('开始输入'); await flush()
    const socket = Socket.instances[0]!
    socket.onopen?.(); frame(new Uint8Array(1280))
    socket.result('接触电阻0.012欧姆，', 0, 1)
    expect(parse).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled(); expect(ui.draft.contactResistance).toBeNull()
    if (ending === 'voice-stop') {
      socket.result('结束输入。', 1, 1)
      await flush(); socket.result('', 2, 2)
    } else if (ending === 'natural') socket.result('', 1, 2)
    else if (ending === 'offline') network.dispatchEvent(new Event('offline'))
    else socket.onerror?.()
    const failed = ending === 'interrupted' || ending === 'offline'
    if (!failed) currentCommand().onstart?.()
    await flush()
    expect(ui.draft).toMatchObject({ workOrder: 'MANUAL', contactResistance: 12 })
    expect(parse).toHaveBeenCalledOnce(); expect(report).not.toHaveBeenCalled()
    expect(segments).toHaveLength(1)
    expect(segments[0]).toStrictEqual({ text: ending === 'voice-stop' ? '接触电阻0.012欧姆' : '接触电阻0.012欧姆，' })
    expect(parse.mock.calls[0]?.[0]).toBe(segments[0])
    expect(parsed).toStrictEqual({ contactResistance: 12 })
    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0]?.[0]).toBe(parsed)
    expect(stopAudio).toHaveBeenCalledOnce()
    expect(ui.microphone).toBe(failed ? 'IDLE' : 'LISTENING')
    if (ending === 'offline') {
      expect(ui.speechError).toContain('网络已断开')
      expect(ui.editable).toBe(true)
      ui.updateField('partNumber', 'AFTER-OFFLINE')
      expect(ui.draft.partNumber).toBe('AFTER-OFFLINE')
      expect(removeOffline).toHaveBeenCalledOnce()
    }
    else if (ending === 'interrupted') expect(ui.speechError).toContain('中断')
    else expect(ui.speechError).toBe('')

    ui.updateField('partNumber', 'P-007')
    ui.updateField('insulationResistance', 200)
    ui.updateField('withstandVoltage', 1500)
    ui.updateField('result', 'PASS')
    const fields: InspectionFields = {
      workOrder: 'MANUAL', partNumber: 'P-007', contactResistance: 12,
      insulationResistance: 200, withstandVoltage: 1500, result: 'PASS',
    }
    const complete = vi.spyOn(draft, 'completeSave')
    const originalConfirm = draft.confirmSave.bind(draft)
    let generated: InspectionRecord | undefined
    vi.spyOn(draft, 'confirmSave').mockImplementation(() => {
      generated = originalConfirm()
      Object.freeze(generated)
      return generated
    })
    const originalSave = records.save.bind(records)
    const save = vi.spyOn(records, 'save').mockImplementation(record => {
      expect(record).toBe(generated)
      const saved = originalSave(record)
      // Persistence has returned, but App must still wait for this M4 call to return.
      expect(draft.getDraft()).toStrictEqual(fields)
      expect(draft.getState()).toBe('SAVING')
      expect(complete).not.toHaveBeenCalled()
      return saved
    })
    storage.setItem.mockImplementation((_key, value) => {
      const persisted: unknown = JSON.parse(value)
      expect(persisted).toStrictEqual([generated])
      expect(draft.getDraft()).toStrictEqual(fields)
      expect(draft.getState()).toBe('SAVING')
      expect(complete).not.toHaveBeenCalled()
    })
    ui.requestSave()
    expect(draft.getState()).toBe('CONFIRMING_SAVE')
    expect(save).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled()
    ui.confirmSave()
    expect(generated).toStrictEqual({
      ...fields, id: expect.any(String), createdAt: expect.any(String), updatedAt: expect.any(String),
    })
    expect(generated?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(generated?.createdAt).toBe(generated?.updatedAt)
    expect(new Date(generated!.createdAt).toISOString()).toBe(generated?.createdAt)
    expect(save).toHaveBeenCalledOnce(); expect(storage.setItem).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
    expect(records.getAll()).toStrictEqual([generated])
    expect(draft.getDraft()).toStrictEqual({
      workOrder: null, partNumber: null, contactResistance: null,
      insulationResistance: null, withstandVoltage: null, result: null,
    })
    ui.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
})
