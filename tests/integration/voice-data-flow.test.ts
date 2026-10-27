import { nextTick, reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useManualWorkflow } from '../../src/app/useManualWorkflow'
import { createSpeechRecognition } from '../../src/modules/m1-speech-recognition'
import { captureAudio } from '../../src/modules/m1-speech-recognition/audio'
import { createTextParser } from '../../src/modules/m2-text-parser'
import { createDraftManager } from '../../src/modules/m3-draft-manager'
import { createRecordManager } from '../../src/modules/m4-record-manager'
import type { DraftFields, InspectionFields, ParseResult, TranscriptSegment } from '../../src/shared/data-models'

// Replace external devices/transports only; all four business modules and App are real.
vi.mock('../../src/modules/m1-speech-recognition/audio', () => ({ captureAudio: vi.fn() }))
class Commands {
  static instances: Commands[] = []
  lang = ''; continuous = false; interimResults = false
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null
  private results: { isFinal: boolean; 0: { transcript: string } }[] = []
  start() {}
  abort() {}
  constructor() { Commands.instances.push(this) }
  say(text: string) {
    const resultIndex = this.results.length
    this.results.push({ isFinal: true, 0: { transcript: text } })
    this.onresult?.({ resultIndex, results: [...this.results] })
  }
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
  result(text: string, sn = 0, status = 2, extra: object = {}) {
    this.onmessage?.({ data: JSON.stringify({ code: 0, data: {
      status, result: { sn, ws: [{ cw: [{ w: text }] }], ...extra },
    } }) })
  }
}
const fullText = '工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格'
const full: InspectionFields = {
  workOrder: 'A2301', partNumber: 'C-045', contactResistance: 12,
  insulationResistance: 500, withstandVoltage: 1500, result: 'PASS',
}
const empty: DraftFields = {
  workOrder: null, partNumber: null, contactResistance: null,
  insulationResistance: null, withstandVoltage: null, result: null,
}
const currentCommand = () => Commands.instances.at(-1)!
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await nextTick() }
const cleanup: (() => void)[] = []

function setup() {
  vi.useFakeTimers(); Commands.instances = []; Socket.instances = []
  vi.stubGlobal('SpeechRecognition', Commands); vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('location', { href: 'https://inspection.example/', origin: 'https://inspection.example' })
  let contents: string | null = null
  const storage = {
    getItem: vi.fn(() => contents),
    setItem: vi.fn((_key: string, value: string) => { contents = value }),
  }
  vi.stubGlobal('localStorage', storage)
  let frame: (data: Uint8Array) => void = () => { throw new Error('Audio has not started') }
  const stopAudio = vi.fn()
  vi.mocked(captureAudio).mockImplementation(async (_signal, send, _fault, prepared) => {
    frame = send; prepared?.(() => undefined); return { stop: stopAudio }
  })
  const speech = createSpeechRecognition(), parser = createTextParser()
  const draft = createDraftManager(), records = createRecordManager()
  const cancellations: (() => void)[] = []
  function track(unsubscribe: () => void) {
    const release = vi.fn(unsubscribe)
    cancellations.push(release)
    return release
  }
  const subscribeState = speech.onStateChange.bind(speech), subscribeCommand = speech.onCommand.bind(speech)
  const subscribeUpdate = speech.onTranscriptUpdate.bind(speech), subscribeError = speech.onError.bind(speech)
  vi.spyOn(speech, 'onStateChange').mockImplementation(callback => track(subscribeState(callback)))
  vi.spyOn(speech, 'onCommand').mockImplementation(callback => track(subscribeCommand(callback)))
  vi.spyOn(speech, 'onTranscriptUpdate').mockImplementation(callback => track(subscribeUpdate(callback)))
  vi.spyOn(speech, 'onError').mockImplementation(callback => track(subscribeError(callback)))
  const segments: TranscriptSegment[] = []
  const subscribeComplete = speech.onTranscriptComplete.bind(speech)
  vi.spyOn(speech, 'onTranscriptComplete').mockImplementation(callback => track(subscribeComplete(segment => {
    segments.push(segment); Object.freeze(segment); callback(segment)
  })))
  const originalParse = parser.parse.bind(parser)
  const results: ParseResult[] = []
  const parse = vi.spyOn(parser, 'parse').mockImplementation(segment => {
    const result = originalParse(segment)
    results.push(result); Object.freeze(result); return result
  })
  const apply = vi.spyOn(draft, 'applyParseResult')
  const confirm = vi.spyOn(draft, 'confirmSave'), complete = vi.spyOn(draft, 'completeSave')
  const fail = vi.spyOn(draft, 'failSave'), save = vi.spyOn(records, 'save')
  const ui = reactive(useManualWorkflow({
    speechRecognition: speech, textParser: parser, draftManager: draft, createRecords: () => records,
  }))
  cleanup.push(ui.dispose); ui.initialize()
  async function listen() {
    const started = ui.toggleListening(); currentCommand().onstart?.(); await started
  }
  async function command(text: string) { currentCommand().say(text); await flush() }
  async function begin() {
    await command('开始输入')
    expect(speech.getState()).toBe('RECORDING')
    const socket = Socket.instances.at(-1)!
    socket.onopen?.(); frame(new Uint8Array(1280)); vi.advanceTimersByTime(40)
    await flush()
    return socket
  }
  async function finish(socket: Socket, text: string) {
    socket.result(text)
    currentCommand().onstart?.()
    await flush()
    expect(speech.getState()).toBe('LISTENING')
  }
  async function record(text: string) { const socket = await begin(); await finish(socket, text); return socket }
  function boundary(index: number, text: string, result: ParseResult) {
    expect(segments[index]).toStrictEqual({ text })
    expect(parse.mock.calls[index]?.[0]).toBe(segments[index])
    expect(results[index]).toStrictEqual(result)
    expect(apply.mock.calls[index]?.[0]).toBe(results[index])
  }
  return { ui, speech, draft, records, storage, parse, apply, confirm, complete, fail, save,
    segments, cancellations, boundary, listen, command, begin, finish, record, stopAudio, read: () => contents }
}
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('Checkpoint B: continuous real M1–M4 data flow', () => {
  it('Test 1: routes the full utterance through every boundary into the Vue draft snapshot', async () => {
    const { ui, draft, boundary, listen, record, parse, apply } = setup()
    await listen(); await record(fullText)
    boundary(0, fullText, full)
    expect(parse).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce()
    expect(draft.getDraft()).toStrictEqual(full); expect(ui.draft).toStrictEqual(full)
  })

  it('Test 2: accumulates three successive utterances without resetting earlier fields', async () => {
    const { ui, draft, listen, record, boundary, parse, apply } = setup()
    await listen()
    await record('工单A2301，接触电阻12毫欧')
    boundary(0, '工单A2301，接触电阻12毫欧', { workOrder: 'A2301', contactResistance: 12 })
    expect(ui.draft).toStrictEqual({ ...empty, workOrder: 'A2301', contactResistance: 12 })
    await record('料号C-045，绝缘电阻500兆欧')
    boundary(1, '料号C-045，绝缘电阻500兆欧', { partNumber: 'C-045', insulationResistance: 500 })
    expect(ui.draft).toStrictEqual({ ...empty, ...full, withstandVoltage: null, result: null })
    await record('耐电压1500伏，合格')
    boundary(2, '耐电压1500伏，合格', { withstandVoltage: 1500, result: 'PASS' })
    expect(ui.draft).toStrictEqual(full); expect(draft.getDraft()).toStrictEqual(full)
    expect(parse).toHaveBeenCalledTimes(3); expect(apply).toHaveBeenCalledTimes(3)
  })

  it('Test 3: replaces only the corrected voice field', async () => {
    const { ui, listen, record, boundary } = setup()
    await listen(); await record('工单A2301，接触电阻12毫欧')
    const before = { ...ui.draft }
    await record('接触电阻改成15毫欧')
    boundary(1, '接触电阻改成15毫欧', { contactResistance: 15 })
    expect(ui.draft).toStrictEqual({ ...before, contactResistance: 15 })
  })

  it('Test 4: retains a manual numeric correction when the next utterance updates another field', async () => {
    const { ui, draft, listen, record, boundary } = setup()
    await listen(); await record('接触电阻12毫欧')
    ui.updateField('contactResistance', 18)
    await record('绝缘电阻500兆欧')
    boundary(1, '绝缘电阻500兆欧', { insulationResistance: 500 })
    expect(draft.getDraft()).toStrictEqual({ ...empty, contactResistance: 18, insulationResistance: 500 })
    expect(ui.draft).toStrictEqual(draft.getDraft())
  })

  it('Test 5: confirms once, persists the M3 record, displays history and reloads from storage', async () => {
    const context = setup()
    const { ui, draft, records, storage, listen, record, confirm, complete, save, read } = context
    await listen(); await record(fullText)
    const write = storage.setItem.getMockImplementation()!
    storage.setItem.mockImplementation((key, value) => {
      expect(draft.getDraft()).toStrictEqual(full)
      expect(draft.getState()).toBe('SAVING'); expect(complete).not.toHaveBeenCalled()
      write(key, value)
    })
    ui.requestSave(); expect(ui.draftState).toBe('CONFIRMING_SAVE')
    expect(confirm).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
    ui.confirmSave(); ui.confirmSave()
    expect(confirm).toHaveBeenCalledOnce(); expect(save).toHaveBeenCalledOnce()
    const generated = confirm.mock.results[0]?.value
    expect(save.mock.calls[0]?.[0]).toBe(generated)
    expect(generated).toStrictEqual({ ...full, id: expect.any(String), createdAt: expect.any(String), updatedAt: expect.any(String) })
    const saved = records.getAll()[0]!
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(new Date(saved.createdAt).toISOString()).toBe(saved.createdAt)
    expect(saved.updatedAt).toBe(saved.createdAt)
    expect(JSON.parse(read() ?? 'null')).toStrictEqual([saved])
    expect(ui.rows).toStrictEqual([saved]); expect(ui.draft).toStrictEqual(empty)
    expect(complete).toHaveBeenCalledOnce(); expect(storage.setItem).toHaveBeenCalledOnce()
    ui.dispose()
    const reloaded = createRecordManager()
    expect(reloaded.initialize()).toStrictEqual([saved])
    const refreshed = reactive(useManualWorkflow({ createRecords: () => reloaded }))
    cleanup.push(refreshed.dispose); refreshed.initialize()
    expect(refreshed.rows).toStrictEqual([saved]); expect(refreshed.draft).toStrictEqual(empty)
    expect(storage.setItem).toHaveBeenCalledOnce()
  })

  it('normalizes units inside M2 before handing numeric fields to M3', async () => {
    const { ui, boundary, listen, record } = setup()
    const text = '接触电阻0.012欧，绝缘电阻500000000欧，耐压一点五千伏'
    await listen(); await record(text)
    boundary(0, text, { contactResistance: 12, insulationResistance: 500, withstandVoltage: 1500 })
    expect(ui.draft).toStrictEqual({ ...empty, contactResistance: 12, insulationResistance: 500, withstandVoltage: 1500 })
  })

  it.each([
    ['', {}], ['今天检查完成', {}], ['工单A2301，耐压5安培', { workOrder: 'A2301' }],
  ] satisfies [string, ParseResult][])('retains existing fields with empty, unrelated or partially valid text: %j', async (text, result) => {
    const { ui, boundary, listen, record } = setup()
    await listen(); ui.updateField('contactResistance', 18)
    await record(text)
    boundary(0, text, result)
    expect(ui.draft).toStrictEqual({ ...empty, contactResistance: 18, ...result })
  })

  it('does not parse repeated live updates and completes once after repeated stop operations', async () => {
    const { ui, listen, begin, parse, apply, segments, speech } = setup()
    await listen(); const socket = await begin()
    const late = socket.onmessage!
    for (let repeat = 0; repeat < 4; repeat++) socket.result('接触电阻12毫欧', 0, 1)
    expect(ui.confirmedText).toBe('接触电阻12毫欧')
    expect(parse).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled()
    ui.stopInput(); ui.stopInput(); speech.stopRecording()
    socket.result('', 1, 2); currentCommand().onstart?.(); await flush()
    late({ data: JSON.stringify({ code: 0, data: { status: 2 } }) })
    await flush()
    expect(segments).toStrictEqual([{ text: '接触电阻12毫欧' }])
    expect(parse).toHaveBeenCalledOnce(); expect(ui.draft.contactResistance).toBe(12)
  })

  it('retains confirmed text and drops interim text on an unexpected M1 interruption', async () => {
    const { ui, listen, begin, boundary, segments } = setup()
    await listen(); const socket = await begin()
    socket.result('工单A2301，', 0, 1)
    socket.result('耐压1500伏', 2, 1) // A sequence gap is unconfirmed until the missing result arrives.
    expect(ui.interimText).toBe('耐压1500伏')
    socket.onerror?.(); await flush()
    boundary(0, '工单A2301，', { workOrder: 'A2301' })
    expect(segments).toHaveLength(1); expect(ui.microphone).toBe('IDLE')
    expect(ui.draft).toStrictEqual({ ...empty, workOrder: 'A2301' })
    expect(ui.speechError).toContain('中断')
  })

  it('processes rapid recordings in order while ignoring retired socket callbacks', async () => {
    const { ui, listen, begin, finish, parse, segments } = setup()
    await listen()
    for (let index = 1; index <= 12; index++) {
      const socket = await begin(), late = socket.onmessage!
      await finish(socket, `接触电阻${index}毫欧`)
      late({ data: JSON.stringify({ code: 0, data: { status: 2, result: { sn: 1, ws: [{ cw: [{ w: '工单OLD' }] }] } } }) })
      expect(ui.draft.contactResistance).toBe(index)
      expect(ui.draft.workOrder).toBeNull()
    }
    expect(parse).toHaveBeenCalledTimes(12); expect(segments).toHaveLength(12)
  })

  it('rejects saving an incomplete voice draft without generating a formal identity', async () => {
    const { ui, listen, record, confirm, save, storage } = setup()
    const identity = vi.spyOn(globalThis.crypto, 'randomUUID')
    await listen(); await record('接触电阻12毫欧')
    ui.requestSave(); ui.confirmSave()
    expect(ui.errors).toHaveLength(5); expect(ui.draftState).toBe('IDLE')
    expect(identity).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('retains the complete voice draft on write failure and retries the same pending identity once', async () => {
    const { ui, listen, record, storage, confirm, complete, fail, records } = setup()
    await listen(); await record(fullText)
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    ui.requestSave(); ui.confirmSave()
    const pending = { ...ui.pending }
    expect(ui.draft).toStrictEqual(full); expect(ui.draftState).toBe('IDLE')
    expect(records.getAll()).toStrictEqual([]); expect(fail).toHaveBeenCalledOnce()
    expect(complete).not.toHaveBeenCalled()
    ui.requestSave(); ui.confirmSave(); ui.confirmSave()
    expect(confirm.mock.results[1]?.value).toStrictEqual(pending)
    expect(records.getAll()).toStrictEqual([pending]); expect(ui.rows).toStrictEqual([pending])
    expect(ui.draft).toStrictEqual(empty); expect(complete).toHaveBeenCalledOnce()
  })

  it('does not restore a deleted draft from a delayed old socket result', async () => {
    const { ui, listen, begin, finish, parse } = setup()
    await listen(); const socket = await begin(), late = socket.onmessage!
    await finish(socket, '接触电阻12毫欧')
    ui.requestDelete(); ui.confirmDelete()
    late({ data: JSON.stringify({ code: 0, data: { status: 2, result: { sn: 1, ws: [{ cw: [{ w: '接触电阻99毫欧' }] }] } } }) })
    await flush()
    expect(ui.draft).toStrictEqual(empty); expect(parse).toHaveBeenCalledOnce()
  })

  it('unsubscribes all M1 events on disposal and rejects an already queued final segment', async () => {
    const { ui, speech, draft, listen, begin, parse, cancellations, stopAudio } = setup()
    await listen(); const socket = await begin(), late = socket.onmessage!
    socket.result('接触电阻12毫欧')
    ui.dispose(); ui.dispose(); await flush()
    expect(cancellations).toHaveLength(5)
    for (const unsubscribe of cancellations) expect(unsubscribe).toHaveBeenCalledOnce()
    late({ data: JSON.stringify({ code: 0, data: { status: 2 } }) })
    draft.updateField('workOrder', 'AFTER-UNMOUNT')
    await flush()
    expect(parse).not.toHaveBeenCalled(); expect(ui.draft).toStrictEqual(empty)
    expect(speech.getState()).toBe('IDLE'); expect(stopAudio).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
