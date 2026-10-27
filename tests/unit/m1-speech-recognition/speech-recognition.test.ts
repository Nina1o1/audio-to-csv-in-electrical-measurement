import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpeechRecognition } from '../../../src/modules/m1-speech-recognition'
import { captureAudio } from '../../../src/modules/m1-speech-recognition/audio'
import type { SpeechRecognitionModule } from '../../../src/contracts/m1-speech-recognition'

vi.mock('../../../src/modules/m1-speech-recognition/audio', () => ({ captureAudio: vi.fn() }))

class Commands {
  static instances: Commands[] = []
  lang = ''; continuous = false; interimResults = false
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null
  start = vi.fn()
  abort = vi.fn()
  constructor() { Commands.instances.push(this) }
  ready() { this.onstart?.() }
  result(text: string, isFinal = true, index = 0) {
    const results = Array.from({ length: index + 1 }, () => ({ isFinal, 0: { transcript: text } }))
    this.onresult?.({ resultIndex: index, results })
  }
}
class Socket {
  static instances: Socket[] = []
  readyState = 0
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn<(data: string) => void>()
  close = vi.fn()
  constructor(readonly url: URL) { Socket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  result(text: string, sn = 0, status = 1, extra: object = {}) {
    this.onmessage?.({ data: JSON.stringify({ code: 0, data: { status, result: { sn, ws: [{ cw: [{ w: text }] }], ...extra } } }) })
  }
  end() { this.onmessage?.({ data: JSON.stringify({ code: 0, data: { status: 2 } }) }) }
}

let module: SpeechRecognitionModule
let frame: (data: Uint8Array) => void
let audioFault: () => void
let audioStop: ReturnType<typeof vi.fn>
let signal: AbortSignal
const currentCommand = () => Commands.instances.at(-1)!
const currentSocket = () => Socket.instances.at(-1)!
async function listen() {
  const promise = module.startListening(); currentCommand().ready(); await promise
}
async function record() { await listen(); module.startRecording(); await Promise.resolve(); currentSocket().open() }
function finishSocket() { currentSocket().end(); currentCommand().ready() }
beforeEach(() => {
  vi.useFakeTimers()
  Commands.instances = []; Socket.instances = []
  vi.stubGlobal('SpeechRecognition', Commands)
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('location', { href: 'https://inspection.example/', origin: 'https://inspection.example' })
  audioStop = vi.fn()
  vi.mocked(captureAudio).mockImplementation(async (abort, send, failure, prepared) => {
    signal = abort; frame = send; audioFault = failure
    prepared?.(() => undefined)
    return { stop: audioStop }
  })
  module = createSpeechRecognition()
})
afterEach(() => { module.stopListening(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('M1 public lifecycle', () => {
  it.each(['NOT_SUPPORTED', 'PERMISSION_DENIED', 'MICROPHONE_UNAVAILABLE', 'RECOGNITION_FAILED'] as const)(
    'preserves the validated string error code %s from audio startup', async code => {
      const errors = vi.fn()
      module.onError(errors)
      vi.mocked(captureAudio).mockRejectedValueOnce({ code, message: 'audio startup failed' })
      await listen(); module.startRecording()
      await Promise.resolve(); await Promise.resolve()
      expect(errors).toHaveBeenCalledExactlyOnceWith({ code, message: 'audio startup failed' })
      expect(module.getState()).toBe('IDLE')
    },
  )
  it('does not coerce an object into a public speech error code', async () => {
    const errors = vi.fn(), coerce = vi.fn(() => 'PERMISSION_DENIED')
    module.onError(errors)
    vi.mocked(captureAudio).mockRejectedValueOnce({ code: { toString: coerce }, message: 'invalid code' })
    await listen(); module.startRecording()
    await Promise.resolve(); await Promise.resolve()
    expect(coerce).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledExactlyOnceWith({ code: 'RECOGNITION_FAILED', message: expect.any(String) })
    expect(module.getState()).toBe('IDLE')
  })
  it('exposes exactly the documented module methods', () => {
    expect(Object.keys(module).sort()).toEqual(['startListening', 'stopListening', 'startRecording', 'stopRecording', 'getState', 'onStateChange', 'onCommand', 'onTranscriptUpdate', 'onTranscriptComplete', 'onError'].sort())
    expect(module.getState()).toBe('IDLE')
  })
  it('settles startup only on actual onstart, without IAT or raw microphone capture in LISTENING', async () => {
    const states = vi.fn(), settled = vi.fn()
    module.onStateChange(states)
    const promise = module.startListening().then(settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled(); expect(module.getState()).toBe('IDLE')
    currentCommand().ready(); await promise
    expect(states).toHaveBeenCalledExactlyOnceWith('LISTENING')
    expect(captureAudio).not.toHaveBeenCalled(); expect(Socket.instances).toHaveLength(0)
    module.stopListening(); module.stopListening()
    expect(states.mock.calls.map(call => call[0])).toEqual(['LISTENING', 'IDLE'])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels pending startup immediately and ignores old start/error/end callbacks', async () => {
    const errors = vi.fn(); module.onError(errors)
    const promise = module.startListening()
    const old = currentCommand(), start = old.onstart!, fault = old.onerror!, end = old.onend!
    module.stopListening(); module.stopListening()
    await expect(promise).rejects.toMatchObject({ code: 'RECOGNITION_FAILED', message: expect.stringContaining('取消') })
    const next = module.startListening()
    start(); fault({ error: 'network' }); end()
    expect(module.getState()).toBe('IDLE')
    currentCommand().ready(); await next
    expect(errors).not.toHaveBeenCalled(); expect(module.getState()).toBe('LISTENING')
  })
  it('aborts a late native startup again if the first cancellation abort was rejected', async () => {
    const errors = vi.fn(); module.onError(errors)
    const promise = module.startListening(), old = currentCommand()
    old.abort.mockImplementationOnce(() => { throw new Error('Startup still pending') })
    module.stopListening()
    await expect(promise).rejects.toMatchObject({ code: 'RECOGNITION_FAILED' })
    old.ready()
    expect(old.abort).toHaveBeenCalledTimes(2)
    expect(module.getState()).toBe('IDLE'); expect(errors).not.toHaveBeenCalled()
  })
  it('rejects only the duplicate request without a duplicate error notification', async () => {
    const errors = vi.fn(); module.onError(errors)
    const first = module.startListening()
    await expect(module.startListening()).rejects.toMatchObject({ code: 'RECOGNITION_FAILED' })
    currentCommand().ready(); await first
    await expect(module.startListening()).rejects.toMatchObject({ code: 'RECOGNITION_FAILED' })
    expect(errors).not.toHaveBeenCalled()
  })
  it('rejects startup and reports the same fault once on timeout', async () => {
    const errors = vi.fn(); module.onError(errors)
    const rejected = expect(module.startListening()).rejects.toMatchObject({ code: 'RECOGNITION_FAILED' })
    vi.advanceTimersByTime(10_000); await rejected
    expect(errors).toHaveBeenCalledTimes(1); expect(module.getState()).toBe('IDLE')
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each([
    ['not-allowed', 'PERMISSION_DENIED'], ['audio-capture', 'MICROPHONE_UNAVAILABLE'],
    ['language-not-supported', 'NOT_SUPPORTED'], ['network', 'RECOGNITION_FAILED'],
  ])('maps command startup error %s and settles the promise', async (error, code) => {
    const errors = vi.fn(); module.onError(errors)
    const promise = module.startListening()
    const end = currentCommand().onend!
    currentCommand().onerror?.({ error }); end()
    await expect(promise).rejects.toEqual(errors.mock.calls[0]?.[0])
    expect(errors).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code }))
  })
  it('fails cleanly when recognition is unsupported', async () => {
    vi.stubGlobal('SpeechRecognition', undefined); vi.stubGlobal('webkitSpeechRecognition', undefined)
    await expect(module.startListening()).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
  })
  it('supports the prefixed constructor without assuming local recognition', async () => {
    vi.stubGlobal('SpeechRecognition', undefined); vi.stubGlobal('webkitSpeechRecognition', Commands)
    await listen(); expect(currentCommand().lang).toBe('zh-CN')
  })
  it('rejects nested mutations but permits queries and isolates throwing subscribers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('report failed') })
    module.onStateChange(() => { expect(module.getState()).toBe('LISTENING'); module.stopListening() })
    const other = vi.fn(); module.onStateChange(other)
    await listen(); expect(other).toHaveBeenCalledWith('LISTENING')
  })
  it('allows duplicate callback registrations to unsubscribe independently', async () => {
    const callback = vi.fn()
    const first = module.onStateChange(callback), second = module.onStateChange(callback)
    first(); first(); await listen(); expect(callback).toHaveBeenCalledTimes(1)
    second(); module.stopListening(); expect(callback).toHaveBeenCalledTimes(1)
  })
  it.each(['onStateChange', 'onCommand', 'onTranscriptUpdate', 'onTranscriptComplete', 'onError'] as const)('validates %s subscription parameters', method => {
    // Runtime callers may bypass TS; this does not loosen production typings.
    expect(() => Reflect.apply(module[method], module, [null])).toThrow(TypeError)
  })
  it('ignores invalid recording calls without data or state changes', () => {
    module.startRecording(); module.stopRecording()
    expect(module.getState()).toBe('IDLE'); expect(captureAudio).not.toHaveBeenCalled()
  })
  it('does not execute nested state-changing command handlers or block later subscribers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    module.onCommand(() => module.startRecording())
    const commands = vi.fn(); module.onCommand(commands)
    await listen(); currentCommand().result('开始输入')
    expect(module.getState()).toBe('LISTENING'); expect(captureAudio).not.toHaveBeenCalled()
    expect(commands).toHaveBeenCalledWith('START_INPUT')
  })
})

describe('M1 confirmed voice commands', () => {
  it.each([
    ['开始输入', 'START_INPUT'], ['结束输入', 'STOP_INPUT'], ['结束录入', 'STOP_INPUT'],
    ['保存', 'SAVE'], ['确认保存', 'CONFIRM_SAVE'], ['修改', 'MODIFY'],
    ['删除', 'DELETE'], ['确认删除', 'CONFIRM_DELETE'], ['保留', 'KEEP'],
  ])('recognizes only the complete phrase %s', async (text, command) => {
    const received = vi.fn(); module.onCommand(received)
    await listen()
    currentCommand().result(text, false); expect(received).not.toHaveBeenCalled()
    currentCommand().result(` ${text}。 `)
    currentCommand().result(` ${text}。 `)
    expect(received).toHaveBeenCalledExactlyOnceWith(command)
    expect(module.getState()).toBe('LISTENING') // M1 never executes App's business action.
    currentCommand().result(text, true, 1)
    expect(received).toHaveBeenCalledTimes(2) // A genuinely new utterance is allowed.
  })
  it('diagnoses interim, unmatched final and emitted START_INPUT while still LISTENING', async () => {
    vi.stubGlobal('location', { href: 'https://inspection.example/?m1Debug=1', origin: 'https://inspection.example', search: '?m1Debug=1' })
    const log = vi.spyOn(console, 'debug').mockImplementation(() => undefined), received = vi.fn()
    module.onCommand(received); await listen()
    currentCommand().result('开始输入', false)
    expect(received).not.toHaveBeenCalled()
    currentCommand().result('开始输入接触电阻', true)
    expect(received).not.toHaveBeenCalled()
    currentCommand().result('开始输入。', true, 1)
    expect(received).toHaveBeenCalledExactlyOnceWith('START_INPUT')
    const entries = log.mock.calls.map(call => call[1] as { event: string; listeningId?: number; matched?: boolean; command?: string })
    expect(entries.map(entry => entry.event)).toEqual([
      'command-listening-requested', 'command-listening-started', 'command-result-interim',
      'command-result-final', 'command-result-final', 'command-event-emitted',
    ])
    expect(entries.filter(entry => entry.event === 'command-result-final').map(entry => entry.matched)).toEqual([false, true])
    expect(new Set(entries.map(entry => entry.listeningId)).size).toBe(1)
    expect(JSON.stringify(entries)).not.toMatch(/开始输入|接触电阻/)
    expect(module.getState()).toBe('LISTENING')
  })
  it.each(['不要保存', '确认删除后检查', '今天修改了工单', '保留这个零件', '保存，确认保存'])('does not match a command inside %s', async text => {
    const received = vi.fn(); module.onCommand(received); await listen()
    currentCommand().result(text); expect(received).not.toHaveBeenCalled()
  })
  it('blocks late command callbacks and all non-STOP commands during recording', async () => {
    await listen()
    const late = currentCommand().onresult!
    const received = vi.fn(); module.onCommand(received)
    module.startRecording(); await Promise.resolve(); currentSocket().open()
    late({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '删除' } }] })
    currentSocket().result('保存，删除，确认保存。')
    expect(received).not.toHaveBeenCalled()
  })
})

describe('M1 IAT recording and completion', () => {
  it('diagnoses a failed handshake before cleanup and preserves abnormal close metadata without peer text', async () => {
    vi.stubGlobal('location', { href: 'https://inspection.example/?m1Debug=1', origin: 'https://inspection.example', search: '?m1Debug=1' })
    const log = vi.spyOn(console, 'debug').mockImplementation(() => undefined), errors = vi.fn()
    module.onError(errors)
    await listen(); module.startRecording(); await Promise.resolve()
    const socket = currentSocket()
    socket.readyState = 3
    socket.onerror?.()
    Reflect.apply(socket.onclose!, socket, [{ code: 1006, wasClean: false, reason: 'private-peer-detail' }])
    const entries = log.mock.calls.map(call => call[1])
    expect(entries).toContainEqual(expect.objectContaining({ event: 'websocket-error', state: 'RECORDING', opened: false, readyState: 3 }))
    expect(entries).toContainEqual(expect.objectContaining({ event: 'websocket-closed', code: 1006, clean: false, reasonLength: 19, clientCloseRequested: true }))
    expect(JSON.stringify(entries)).not.toContain('private-peer-detail')
    expect(errors).toHaveBeenCalledOnce(); expect(module.getState()).toBe('IDLE')
    expect(socket.send).not.toHaveBeenCalled(); expect(audioStop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retains confirmed ordinary text that was held as a possible stop-command prefix when interrupted', async () => {
    const complete = vi.fn(); module.onTranscriptComplete(complete)
    await record(); currentSocket().result('普通正文，结束输')
    currentSocket().onerror?.()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '普通正文，结束输' })
  })
  it('retains already confirmed text when a sequence gap is followed by a network fault', async () => {
    const complete = vi.fn(), updates = vi.fn()
    module.onTranscriptComplete(complete); module.onTranscriptUpdate(updates)
    await record(); currentSocket().result('已确认正文，', 0); currentSocket().result('尚缺前文。', 2)
    expect(updates.mock.calls.at(-1)?.[0]).toEqual({ confirmedText: '已确认正文，', interimText: '尚缺前文。' })
    currentSocket().onerror?.()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '已确认正文，' })
  })
  it('ignores repeated recording starts and rejects listening starts during recording', async () => {
    await record(); module.startRecording(); module.startRecording()
    expect(captureAudio).toHaveBeenCalledTimes(1)
    await expect(module.startListening()).rejects.toMatchObject({ code: 'RECOGNITION_FAILED' })
    expect(Socket.instances).toHaveLength(1)
  })
  it('does not mistake a confirmed transport-chunk suffix for a complete stop utterance', async () => {
    const commands = vi.fn(); module.onCommand(commands); await record()
    currentSocket().result('结束输入')
    expect(commands).not.toHaveBeenCalled()
    currentSocket().result('后的说明。', 1)
    expect(commands).not.toHaveBeenCalled()
  })
  it('recognizes an unpunctuated stop phrase at a real natural utterance end', async () => {
    const commands = vi.fn(); module.onCommand(commands); await record()
    currentSocket().result('结束输入', 0, 2)
    expect(commands).toHaveBeenCalledExactlyOnceWith('STOP_INPUT')
    module.stopRecording(); currentCommand().ready()
    expect(module.getState()).toBe('LISTENING')
  })
  it('protects complete/error payloads from subscriber mutation and allows unsubscription', async () => {
    const complete = vi.fn(), errors = vi.fn(), removed = vi.fn()
    module.onTranscriptComplete(value => { value.text = 'tampered' }); module.onTranscriptComplete(complete)
    module.onError(value => { value.message = 'tampered' }); module.onError(errors)
    const unsubscribe = module.onTranscriptUpdate(removed); unsubscribe(); unsubscribe()
    await record(); currentSocket().result('真实正文。'); currentSocket().onerror?.()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '真实正文。' })
    expect(errors.mock.calls[0]?.[0].message).not.toBe('tampered'); expect(removed).not.toHaveBeenCalled()
  })
  it('finishes with confirmed text if a session switches unexpectedly into dynamic mode', async () => {
    const complete = vi.fn(); module.onTranscriptComplete(complete); await record()
    currentSocket().result('保留。'); currentSocket().result('被替换', 1, 1, { pgs: 'rpl', rg: [0, 0] })
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '保留。' }); expect(module.getState()).toBe('IDLE')
  })
  it('sends correct first, middle and last audio frames at real-time cadence', async () => {
    await record()
    frame(new Uint8Array(1280)); frame(new Uint8Array(1280))
    const socket = currentSocket()
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(socket.send.mock.calls[0]![0])).toEqual({ data: {
      status: 0, format: 'audio/L16;rate=16000', encoding: 'raw', audio: expect.any(String),
    } })
    vi.advanceTimersByTime(40)
    expect(JSON.parse(socket.send.mock.calls[1]![0]).data.status).toBe(1)
    module.stopRecording(); vi.advanceTimersByTime(40)
    expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({ data: { status: 2 } })
    expect(signal.aborted).toBe(true); expect(audioStop).toHaveBeenCalledTimes(1)
    finishSocket(); expect(module.getState()).toBe('LISTENING')
  })
  it.each([-60_000, 60_000])('keeps PCM cadence when wall clock moves by %ims', async jump => {
    const errors = vi.fn(), complete = vi.fn()
    module.onError(errors); module.onTranscriptComplete(complete)
    await record(); frame(new Uint8Array(1280))
    vi.advanceTimersByTime(40)
    vi.setSystemTime(Date.now() + jump)
    for (let i = 0; i < 100; i++) { frame(new Uint8Array(1280)); vi.advanceTimersByTime(40) }
    expect(errors).not.toHaveBeenCalled()
    expect(currentSocket().send).toHaveBeenCalledTimes(101)
    module.stopRecording(); currentSocket().result('尾字。', 0, 2); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '尾字。' })
  })
  it('traces sampled frame metadata and synchronous result events without text or audio', async () => {
    vi.stubGlobal('location', { href: 'https://inspection.example/?m1Debug=1', origin: 'https://inspection.example', search: '?m1Debug=1' })
    const log = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    await record()
    for (let i = 0; i < 50; i++) { frame(new Uint8Array(1280)); vi.advanceTimersByTime(40) }
    currentSocket().result('接触电阻十二毫欧。')
    const entries = log.mock.calls.map(call => call[1] as { event: string; atMs: number; recordingId?: number }).filter(entry => entry.recordingId !== undefined)
    expect(entries.filter(entry => entry.event === 'audio-frame-captured')).toHaveLength(3)
    expect(entries.filter(entry => entry.event === 'audio-frame-sent')).toHaveLength(3)
    const received = entries.find(entry => entry.event === 'websocket-message')!
    const emitted = entries.find(entry => entry.event === 'transcript-event-emitted')!
    expect(emitted.atMs - received.atMs).toBe(0)
    expect(new Set(entries.map(entry => entry.recordingId)).size).toBe(1)
    expect(JSON.stringify(entries)).not.toMatch(/接触电阻|audio\/L16|wss:|api_key|secret/)
    module.stopRecording(); vi.advanceTimersByTime(120)
    currentSocket().end(); currentCommand().ready()
    const final = log.mock.calls.map(call => call[1] as { event: string; atMs: number })
    expect(final.find(entry => entry.event === 'transcript-complete-emitted')!.atMs
      - final.find(entry => entry.event === 'recording-stopped')!.atMs).toBe(120)
  })
  it('does not accumulate audio indefinitely from ordinary five-millisecond timer jitter', async () => {
    const errors = vi.fn(); module.onError(errors); await record()
    const timer = setTimeout
    vi.stubGlobal('setTimeout', (callback: () => void, milliseconds: number) =>
      timer(callback, milliseconds === 40 ? 45 : milliseconds))
    const input = setInterval(() => frame(new Uint8Array(1280)), 40)
    vi.advanceTimersByTime(30_000); clearInterval(input)
    expect(errors).not.toHaveBeenCalled(); expect(module.getState()).toBe('RECORDING')
  })
  it('publishes full isolated snapshots and one final result including late tail characters', async () => {
    const updates: string[] = [], complete = vi.fn()
    module.onTranscriptUpdate(value => { updates.push(value.confirmedText); value.confirmedText = 'tampered' })
    module.onTranscriptComplete(complete)
    await record(); frame(new Uint8Array(1280))
    const socket = currentSocket()
    socket.result('工单A1，'); socket.result('工单A1，')
    expect(updates).toEqual(['工单A1，'])
    module.stopRecording(); module.stopRecording()
    socket.result('耐压1500伏。', 1, 2)
    currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '工单A1，耐压1500伏。' })
    expect(updates.at(-1)).toBe('工单A1，耐压1500伏。')
    expect(module.getState()).toBe('LISTENING')
    module.stopRecording(); expect(complete).toHaveBeenCalledTimes(1)
  })
  it('finishes an empty recording exactly once without requiring an IAT result', async () => {
    const complete = vi.fn(); module.onTranscriptComplete(complete)
    await record(); module.stopRecording(); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '' })
  })
  it('recognizes a split stop phrase and excludes the command and following speech', async () => {
    const commands = vi.fn(), complete = vi.fn(), updates = vi.fn()
    module.onCommand(commands); module.onTranscriptComplete(complete); module.onTranscriptUpdate(updates)
    await record(); frame(new Uint8Array(1280))
    const socket = currentSocket()
    socket.result('接触电阻12，结束')
    expect(updates.mock.calls.at(-1)?.[0]).toEqual({ confirmedText: '接触电阻12', interimText: '' })
    socket.result('输入。后面不要录入。', 1)
    socket.result('输入。后面不要录入。', 1)
    expect(commands).toHaveBeenCalledExactlyOnceWith('STOP_INPUT')
    module.stopRecording(); socket.result('还有文字。', 2, 2); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '接触电阻12' })
  })
  it('handles unexpected dynamic replacements as interim until the physical session finalizes', async () => {
    const updates = vi.fn(), commands = vi.fn(), complete = vi.fn()
    module.onTranscriptUpdate(updates); module.onCommand(commands); module.onTranscriptComplete(complete)
    await record(); frame(new Uint8Array(1280))
    const socket = currentSocket()
    socket.result('结束输入。', 1, 1, { pgs: 'apd' })
    expect(commands).not.toHaveBeenCalled()
    expect(updates.mock.calls.at(-1)?.[0]).toEqual({ confirmedText: '', interimText: '结束输入。' })
    socket.result('耐压1500伏。', 2, 1, { pgs: 'rpl', rg: [1, 1] })
    module.stopRecording(); socket.end(); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '耐压1500伏。' })
    expect(commands).not.toHaveBeenCalled()
  })
  it('orders sequence-numbered results without losing legitimately repeated words', async () => {
    const complete = vi.fn(); module.onTranscriptComplete(complete)
    await record(); frame(new Uint8Array(1280))
    currentSocket().result('12，', 2); currentSocket().result('12，', 1)
    module.stopRecording(); finishSocket()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '12，12，' })
  })
  it('clears the old display on a new recording and filters late old-session callbacks', async () => {
    const updates = vi.fn(), complete = vi.fn(); module.onTranscriptUpdate(updates); module.onTranscriptComplete(complete)
    await record(); const old = currentSocket(), late = old.onmessage!
    old.result('旧正文。'); module.stopRecording(); old.end(); currentCommand().ready()
    module.startRecording(); await Promise.resolve(); currentSocket().open()
    late({ data: JSON.stringify({ code: 0, data: { status: 2, result: { sn: 1, ws: [{ cw: [{ w: '迟到文字' }] }] } } }) })
    expect(updates.mock.calls.at(-1)?.[0]).toEqual({ confirmedText: '', interimText: '' })
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('stops listening mid-recording with final-before-IDLE ordering and releases all resources', async () => {
    const events: string[] = []
    module.onTranscriptComplete(() => events.push('complete')); module.onStateChange(value => events.push(value))
    await record(); frame(new Uint8Array(1280)); currentSocket().result('正文')
    module.stopListening(); module.stopListening(); currentSocket().end()
    expect(events.slice(-2)).toEqual(['complete', 'IDLE'])
    expect(currentSocket().close).toHaveBeenCalled(); expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['onerror', 'onclose'] as const)('retains confirmed text, completes once and deduplicates %s plus close', async event => {
    const errors = vi.fn(), complete = vi.fn(); module.onError(errors); module.onTranscriptComplete(complete)
    await record(); currentSocket().result('保留正文。')
    const fault = currentSocket()[event]!, close = currentSocket().onclose!
    fault(); close()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '保留正文。' })
    expect(errors).toHaveBeenCalledTimes(1); expect(module.getState()).toBe('IDLE')
    expect(audioStop).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('enforces the five-second drain timeout and drops interim text', async () => {
    const errors = vi.fn(), complete = vi.fn(); module.onError(errors); module.onTranscriptComplete(complete)
    await record(); frame(new Uint8Array(1280)); currentSocket().result('未确认', 1, 1, { pgs: 'apd' })
    module.stopRecording(); vi.advanceTimersByTime(5000)
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '' })
    expect(errors).toHaveBeenCalledTimes(1); expect(module.getState()).toBe('IDLE')
  })
  it.each(['NotAllowedError', 'NotFoundError', 'NotReadableError', 'OtherError'])('cleans up microphone startup failure %s', async name => {
    vi.mocked(captureAudio).mockRejectedValueOnce({ name })
    const errors = vi.fn(), complete = vi.fn(); module.onError(errors); module.onTranscriptComplete(complete)
    await listen(); module.startRecording(); await Promise.resolve(); await Promise.resolve()
    expect(module.getState()).toBe('IDLE'); expect(errors).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '' }); expect(signal?.aborted ?? true).toBe(true)
  })
  it('disposes an audio lease that arrives after the recording was cancelled', async () => {
    let resolve!: (audio: { stop(): void }) => void
    vi.mocked(captureAudio).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await listen(); module.startRecording(); module.stopListening()
    const lateStop = vi.fn(); resolve({ stop: lateStop }); await Promise.resolve()
    expect(lateStop).toHaveBeenCalledTimes(1); expect(Socket.instances).toHaveLength(0)
    expect(module.getState()).toBe('IDLE')
  })
  it('stops on microphone loss and does not retry', async () => {
    const errors = vi.fn(); module.onError(errors); await record(); audioFault()
    vi.advanceTimersByTime(60_000)
    expect(errors).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'MICROPHONE_UNAVAILABLE' }))
    expect(Socket.instances).toHaveLength(1)
  })
  it('times out microphone startup and aborts the pending capture', async () => {
    vi.mocked(captureAudio).mockImplementationOnce(async abort => { signal = abort; return new Promise(() => undefined) })
    await listen(); module.startRecording(); vi.advanceTimersByTime(10_000)
    expect(signal.aborted).toBe(true); expect(module.getState()).toBe('IDLE')
  })
  it('times out an unopened proxy connection', async () => {
    const errors = vi.fn(); module.onError(errors)
    await listen(); module.startRecording(); await Promise.resolve(); vi.advanceTimersByTime(10_000)
    expect(errors).toHaveBeenCalledTimes(1); expect(currentSocket().close).toHaveBeenCalled()
  })
  it('starts PCM only after a slow initial handshake, without overflowing or losing recorded frames', async () => {
    const activate = vi.fn(), errors = vi.fn(), complete = vi.fn()
    vi.mocked(captureAudio).mockImplementationOnce(async (abort, send, failure, prepared) => {
      signal = abort; frame = send; audioFault = failure
      prepared?.(activate)
      return { stop: audioStop }
    })
    module.onError(errors); module.onTranscriptComplete(complete)
    await listen(); module.startRecording(); await Promise.resolve()
    vi.advanceTimersByTime(7500)
    expect(activate).not.toHaveBeenCalled()
    expect(currentSocket().send).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled(); expect(module.getState()).toBe('RECORDING')
    currentSocket().open()
    expect(activate).toHaveBeenCalledTimes(1)
    frame(new Uint8Array(1280)); currentSocket().result('测试正文。')
    module.stopRecording(); vi.advanceTimersByTime(40); finishSocket()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '测试正文。' })
    expect(errors).not.toHaveBeenCalled(); expect(module.getState()).toBe('LISTENING')
  })
  it.each(['invalid-json', JSON.stringify({ code: 10005, message: 'sensitive vendor message' }), JSON.stringify({ code: 0, data: { status: 1, result: { sn: -1, ws: [] } } })])('rejects invalid service data without leaking server diagnostics', async data => {
    const errors = vi.fn(); module.onError(errors); await record()
    currentSocket().onmessage?.({ data })
    expect(errors).toHaveBeenCalledTimes(1); expect(JSON.stringify(errors.mock.calls)).not.toContain('sensitive')
    expect(module.getState()).toBe('IDLE')
  })
  it('fails on excessive socket backpressure', async () => {
    await record(); currentSocket().bufferedAmount = 100_000; frame(new Uint8Array(1280))
    expect(module.getState()).toBe('IDLE')
  })
  it('bounds the audio queue while the socket is not ready', async () => {
    await listen(); module.startRecording(); await Promise.resolve()
    for (let i = 0; i < 76; i++) frame(new Uint8Array(1280))
    expect(module.getState()).toBe('IDLE'); expect(signal.aborted).toBe(true)
  })
})

describe('natural utterance completion, command continuation and planned IAT rotation', () => {
  it.each([0, 1200])('keeps sixty seconds of audio under scheduling stalls and %ims connection setup', async connectionDelay => {
    const timer = setTimeout
    let ticks = 0
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback: () => void, milliseconds?: number) => {
      const jitter = milliseconds !== undefined && milliseconds <= 40 ? (++ticks % 50 === 0 ? 120 : 5) : 0
      return timer(callback, (milliseconds ?? 0) + jitter)
    })
    const errors = vi.fn(), complete = vi.fn()
    module.onError(errors); module.onTranscriptComplete(complete)
    await listen(); module.startRecording(); await Promise.resolve()
    const first = currentSocket()
    let opened = false, rotated = false, firstEnded = false
    const sentIds: number[] = []
    const budgets = new Map<Socket, { firstAt: number; bytes: number }>()
    const watch = (socket: Socket) => socket.send.mockImplementation(raw => {
      const data = (JSON.parse(raw) as { data: { status: number; audio?: string } }).data
      if (data.status === 2) return
      const budget = budgets.get(socket) ?? { firstAt: Date.now(), bytes: 0 }
      const binary = atob(data.audio!)
      budget.bytes += binary.length
      sentIds.push(binary.charCodeAt(0) | binary.charCodeAt(1) << 8)
      budgets.set(socket, budget)
      expect(budget.bytes).toBeLessThanOrEqual((Date.now() - budget.firstAt + 250) * 32)
    })
    watch(first)
    for (let i = 0; i < 1500 && module.getState() === 'RECORDING'; i++) {
      const pcm = new Uint8Array(1280)
      new DataView(pcm.buffer).setUint16(0, i, true)
      frame(pcm)
      if (!opened && i * 40 >= connectionDelay) {
        first.open(); first.result('开头。'); opened = true
      }
      vi.advanceTimersByTime(40)
      if (Socket.instances.length === 2 && !rotated) {
        watch(currentSocket()); currentSocket().open(); rotated = true
      }
      if (i >= 1380 && !firstEnded) { first.result('衔接。', 1, 2); firstEnded = true }
    }
    expect(errors).not.toHaveBeenCalled()
    expect(module.getState()).toBe('RECORDING')
    expect(complete).not.toHaveBeenCalled()
    currentSocket().result('末尾。')
    module.stopRecording(); vi.advanceTimersByTime(3000)
    currentSocket().end(); currentCommand().ready()
    expect(errors).not.toHaveBeenCalled()
    expect([...budgets.values()].reduce((sum, value) => sum + value.bytes, 0)).toBe(1500 * 1280)
    expect(sentIds).toEqual(Array.from({ length: 1500 }, (_, i) => i))
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '开头。衔接。末尾。' })
    expect(module.getState()).toBe('LISTENING')
    module.stopListening()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves all 1625 numbered PCM frames across 65 seconds and a retiring final', async () => {
    const complete = vi.fn(), errors = vi.fn(), sentIds: number[] = []
    module.onTranscriptComplete(complete); module.onError(errors)
    await record(); const first = currentSocket()
    const watch = (socket: Socket) => socket.send.mockImplementation(raw => {
      const data = (JSON.parse(raw) as { data: { status: number; audio?: string } }).data
      if (data.status === 2) return
      const binary = atob(data.audio!)
      sentIds.push(binary.charCodeAt(0) | binary.charCodeAt(1) << 8)
    })
    watch(first); first.result('第一段，')
    for (let i = 0; i < 1625; i++) {
      const pcm = new Uint8Array(1280); new DataView(pcm.buffer).setUint16(0, i, true)
      frame(pcm); vi.advanceTimersByTime(40)
      if (i === 1299) { watch(currentSocket()); currentSocket().open() }
      if (i === 1380) first.result('尾字。', 1, 2)
    }
    expect(sentIds).toEqual(Array.from({ length: 1625 }, (_, i) => i))
    expect(complete).not.toHaveBeenCalled(); expect(errors).not.toHaveBeenCalled()
    module.stopRecording(); currentSocket().result('第二段。', 0, 2); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '第一段，尾字。第二段。' })
  })
  it('streams a full sixty seconds at PCM cadence across rotation and completes once on stop', async () => {
    const errors = vi.fn(), complete = vi.fn()
    module.onError(errors); module.onTranscriptComplete(complete)
    await record()
    const first = currentSocket()
    first.result('开头。')
    let rotated = false
    for (let i = 0; i < 1500; i++) {
      frame(new Uint8Array(1280))
      vi.advanceTimersByTime(40)
      if (Socket.instances.length === 2 && !rotated) {
        currentSocket().open()
        rotated = true
      }
      if (i === 1380) first.result('衔接尾字。', 1, 2)
    }
    expect(module.getState()).toBe('RECORDING')
    expect(complete).not.toHaveBeenCalled()
    expect(Socket.instances).toHaveLength(2)
    const audioFrames = Socket.instances.flatMap(socket => socket.send.mock.calls)
      .filter(([raw]) => (JSON.parse(raw) as { data: { status: number } }).data.status !== 2)
    expect(audioFrames).toHaveLength(1500)
    currentSocket().result('末尾。')
    module.stopRecording(); finishSocket()
    expect(module.getState()).toBe('LISTENING')
    expect(errors).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '开头。衔接尾字。末尾。' })
    module.stopListening()
    expect(audioStop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('finishes repeated user recordings independently without paid natural reconnections or accumulated audio', async () => {
    const errors = vi.fn(), complete = vi.fn()
    module.onError(errors); module.onTranscriptComplete(complete); await record()
    for (let round = 0; round < 6; round++) {
      if (round) { module.startRecording(); await Promise.resolve(); currentSocket().open() }
      const input = setInterval(() => frame(new Uint8Array(1280)), 40)
      vi.advanceTimersByTime(4000)
      clearInterval(input)
      currentSocket().result(`已确认第${round}段。`, 0, 2)
      currentCommand().ready(); vi.advanceTimersByTime(1000)
      expect(Socket.instances).toHaveLength(round + 1)
      expect(complete).toHaveBeenNthCalledWith(round + 1, { text: `已确认第${round}段。` })
      expect(module.getState()).toBe('LISTENING')
    }
    expect(complete).toHaveBeenCalledTimes(6); expect(errors).not.toHaveBeenCalled()
    expect(audioStop).toHaveBeenCalledTimes(6); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not emit a second completion if restoring command recognition fails', async () => {
    const errors = vi.fn(), complete = vi.fn()
    module.onError(errors); module.onTranscriptComplete(complete); await record()
    currentSocket().result('正文。'); module.stopRecording()
    currentCommand().onerror?.({ error: 'network' })
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '正文。' })
    expect(errors).toHaveBeenCalledTimes(1); expect(module.getState()).toBe('IDLE')
  })
  it('waits exactly one second after natural command end', async () => {
    await listen(); currentCommand().onend?.()
    vi.advanceTimersByTime(999); expect(Commands.instances).toHaveLength(1)
    vi.advanceTimersByTime(1); expect(Commands.instances).toHaveLength(2)
    currentCommand().ready(); expect(module.getState()).toBe('LISTENING')
  })
  it('stops after three empty restarted command sessions and cancels all timers', async () => {
    const errors = vi.fn(); module.onError(errors); await listen(); currentCommand().onend?.()
    for (let i = 0; i < 3; i++) { vi.advanceTimersByTime(1000); currentCommand().ready(); currentCommand().onend?.() }
    expect(module.getState()).toBe('IDLE'); expect(errors).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('resets the empty-restart count on a new confirmed result', async () => {
    await listen(); currentCommand().onend?.()
    for (let i = 0; i < 2; i++) { vi.advanceTimersByTime(1000); currentCommand().ready(); currentCommand().onend?.() }
    vi.advanceTimersByTime(1000); currentCommand().ready(); currentCommand().result('普通话'); currentCommand().onend?.()
    expect(module.getState()).toBe('LISTENING')
  })
  it('cancels a pending natural restart when listening stops', async () => {
    await listen(); currentCommand().onend?.(); module.stopListening(); vi.advanceTimersByTime(1000)
    expect(Commands.instances).toHaveLength(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('completes on the active service final, not punctuation, before returning to actual command listening', async () => {
    const complete = vi.fn(), commands = vi.fn(), events: string[] = []
    module.onTranscriptComplete(value => { complete(value); events.push('complete') })
    module.onStateChange(value => events.push(value)); module.onCommand(commands)
    await record(); const socket = currentSocket(), late = socket.onmessage!
    socket.result('第一句。')
    expect(complete).not.toHaveBeenCalled(); expect(module.getState()).toBe('RECORDING')
    socket.end()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '第一句。' })
    expect(signal.aborted).toBe(true); expect(audioStop).toHaveBeenCalledTimes(1)
    currentCommand().ready(); vi.advanceTimersByTime(1500)
    late({ data: JSON.stringify({ code: 0, data: { status: 2 } }) })
    module.stopRecording()
    expect(events.slice(-2)).toEqual(['complete', 'LISTENING'])
    expect(complete).toHaveBeenCalledTimes(1); expect(commands).not.toHaveBeenCalled()
    expect(Socket.instances).toHaveLength(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('preopens at 52s, switches at 55s without duplicate audio or user completion, and exceeds 60s', async () => {
    const complete = vi.fn(), updates = vi.fn(); module.onTranscriptComplete(complete); module.onTranscriptUpdate(updates)
    await record(); const first = currentSocket(); frame(new Uint8Array(1280)); first.result('第一段。')
    vi.advanceTimersByTime(52_000)
    const second = currentSocket(); expect(second).not.toBe(first); second.open()
    expect(second.send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(JSON.parse(first.send.mock.calls.at(-1)![0])).toEqual({ data: { status: 2 } })
    frame(new Uint8Array(1280)); expect(second.send).toHaveBeenCalledTimes(1)
    second.result('第二段。'); first.result('尾字。', 1, 2)
    vi.advanceTimersByTime(10_000)
    expect(module.getState()).toBe('RECORDING'); expect(complete).not.toHaveBeenCalled()
    expect(updates.mock.calls.at(-1)?.[0].confirmedText).toBe('第一段。尾字。第二段。')
    module.stopRecording(); second.end(); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '第一段。尾字。第二段。' })
  })
  it('waits for the earlier session tail before consuming a stop command from the next session', async () => {
    const commands = vi.fn(), complete = vi.fn(); module.onCommand(commands); module.onTranscriptComplete(complete)
    await record(); const first = currentSocket(); frame(new Uint8Array(1280)); first.result('正文')
    vi.advanceTimersByTime(52_000); const second = currentSocket(); second.open(); vi.advanceTimersByTime(3000)
    frame(new Uint8Array(1280)); second.result('结束输入。')
    expect(commands).not.toHaveBeenCalled()
    first.result('尾字，', 1, 2)
    expect(commands).toHaveBeenCalledExactlyOnceWith('STOP_INPUT')
    module.stopRecording(); second.end(); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '正文尾字' })
  })
  it('completes an empty natural utterance once without an error or paid reconnection', async () => {
    const errors = vi.fn(), complete = vi.fn(); module.onError(errors); module.onTranscriptComplete(complete)
    await record(); currentSocket().end(); currentCommand().ready(); vi.advanceTimersByTime(5000)
    expect(module.getState()).toBe('LISTENING'); expect(errors).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '' }); expect(Socket.instances).toHaveLength(1)
  })
  it('allows starting recording while waiting for command recognition natural continuation', async () => {
    await listen(); currentCommand().onend?.(); module.startRecording(); await Promise.resolve()
    expect(module.getState()).toBe('RECORDING'); expect(Socket.instances).toHaveLength(1)
  })
  it('cancels command recovery after natural recording completion when listening stops', async () => {
    await record(); currentSocket().end(); const late = currentCommand().onstart!
    module.stopListening(); late(); vi.advanceTimersByTime(1000)
    expect(Socket.instances).toHaveLength(1); expect(module.getState()).toBe('IDLE'); expect(vi.getTimerCount()).toBe(0)
  })
  it('discards unsent audio beyond the service utterance cutoff and does not wait for a dead socket', async () => {
    const errors = vi.fn(), complete = vi.fn(); module.onError(errors); module.onTranscriptComplete(complete)
    await record(); const socket = currentSocket()
    for (let i = 0; i < 20; i++) frame(new Uint8Array(1280))
    const sends = socket.send.mock.calls.length
    socket.result('已确认正文。', 0, 2); currentCommand().ready(); vi.advanceTimersByTime(6000)
    expect(socket.send).toHaveBeenCalledTimes(sends)
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '已确认正文。' })
    expect(errors).not.toHaveBeenCalled(); expect(module.getState()).toBe('LISTENING')
  })
  it('closes an unused prepared socket when the active utterance naturally finishes', async () => {
    const complete = vi.fn(); module.onTranscriptComplete(complete)
    await record(); const active = currentSocket()
    vi.advanceTimersByTime(52_000); const prepared = currentSocket(); prepared.open()
    active.result('本句结束。', 0, 2); currentCommand().ready(); vi.advanceTimersByTime(4000)
    expect(prepared.close).toHaveBeenCalled(); expect(prepared.send).not.toHaveBeenCalled()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '本句结束。' })
    expect(Socket.instances).toHaveLength(2); expect(vi.getTimerCount()).toBe(0)
  })
  it('waits for a retiring rotation tail if the new active session naturally finishes first', async () => {
    const complete = vi.fn(), errors = vi.fn(); module.onTranscriptComplete(complete); module.onError(errors)
    await record(); const first = currentSocket(); frame(new Uint8Array(1280)); first.result('第一段')
    vi.advanceTimersByTime(52_000); const second = currentSocket(); second.open(); vi.advanceTimersByTime(3000)
    frame(new Uint8Array(1280)); second.result('第二段。', 0, 2)
    expect(complete).not.toHaveBeenCalled(); expect(module.getState()).toBe('RECORDING')
    first.result('尾字。', 1, 2); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '第一段尾字。第二段。' })
    expect(errors).not.toHaveBeenCalled(); expect(module.getState()).toBe('LISTENING')
  })
  it('commits unexpected dynamic text only at the active natural final', async () => {
    const complete = vi.fn(); module.onTranscriptComplete(complete); await record()
    currentSocket().result('临时', 0, 1, { pgs: 'apd' }); expect(complete).not.toHaveBeenCalled()
    currentSocket().result('修正正文。', 1, 2, { pgs: 'rpl', rg: [0, 0] }); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '修正正文。' })
  })
  it('fails rather than silently losing audio when the next connection is not ready', async () => {
    const errors = vi.fn(); module.onError(errors); await record(); vi.advanceTimersByTime(55_000)
    expect(module.getState()).toBe('IDLE'); expect(errors).toHaveBeenCalledTimes(1)
    expect(Socket.instances.every(socket => socket.close.mock.calls.length > 0)).toBe(true)
  })
  it('closes a prepared connection when recording is stopped', async () => {
    await record(); vi.advanceTimersByTime(52_000); const prepared = currentSocket()
    module.stopListening()
    expect(prepared.close).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('ignores callbacks from a retired prepared socket after recording has completed', async () => {
    const errors = vi.fn(); module.onError(errors)
    await record(); vi.advanceTimersByTime(52_000)
    const prepared = currentSocket(), late = prepared.onerror!
    module.stopRecording(); currentCommand().ready(); late()
    expect(module.getState()).toBe('LISTENING'); expect(errors).not.toHaveBeenCalled()
  })
  it('drains paid transport after STOP_INPUT but leaves user completion to App', async () => {
    const errors = vi.fn(), complete = vi.fn(); module.onError(errors); module.onTranscriptComplete(complete)
    await record(); frame(new Uint8Array(1280)); currentSocket().result('正文，结束输入。')
    expect(JSON.parse(currentSocket().send.mock.calls.at(-1)![0])).toEqual({ data: { status: 2 } })
    currentSocket().end(); vi.advanceTimersByTime(5000)
    expect(module.getState()).toBe('RECORDING'); expect(errors).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled()
    module.stopRecording(); currentCommand().ready()
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '正文' }); expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects stale delayed timers after the browser has missed the physical-session deadline', async () => {
    await record()
    const elapsed = performance.now()
    vi.spyOn(performance, 'now').mockReturnValue(elapsed + 60_000)
    frame(new Uint8Array(1280))
    expect(module.getState()).toBe('IDLE')
  })
})

describe('browser offline signal with an otherwise open localhost socket', () => {
  let network: EventTarget
  let online: { onLine: boolean }
  let add: ReturnType<typeof vi.fn>
  let remove: ReturnType<typeof vi.fn>
  beforeEach(() => {
    network = new EventTarget()
    online = { onLine: true }
    add = vi.fn(network.addEventListener.bind(network))
    remove = vi.fn(network.removeEventListener.bind(network))
    vi.stubGlobal('navigator', online)
    vi.stubGlobal('addEventListener', add)
    vi.stubGlobal('removeEventListener', remove)
  })
  function offline() { online.onLine = false; network.dispatchEvent(new Event('offline')) }

  it('ends recording immediately, retains only confirmed text once, and permits explicit online recovery', async () => {
    const complete = vi.fn(), errors = vi.fn()
    module.onTranscriptComplete(complete); module.onError(errors)
    await record()
    const socket = currentSocket(), late = socket.onmessage!
    frame(new Uint8Array(1280))
    socket.result('接触电阻12，', 0)
    socket.result('未确认耐压。', 2)
    offline(); offline()
    expect(module.getState()).toBe('IDLE')
    expect(complete).toHaveBeenCalledExactlyOnceWith({ text: '接触电阻12，' })
    expect(errors).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'RECOGNITION_FAILED', message: expect.stringContaining('网络已断开') }))
    expect(audioStop).toHaveBeenCalledOnce(); expect(socket.close).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledOnce()
    late({ data: JSON.stringify({ code: 0, data: { status: 2 } }) })
    vi.advanceTimersByTime(60_000)
    expect(complete).toHaveBeenCalledOnce(); expect(Commands.instances).toHaveLength(1)
    online.onLine = true; network.dispatchEvent(new Event('online'))
    expect(module.getState()).toBe('IDLE')
    const retry = module.startListening(); currentCommand().ready(); await retry
    expect(module.getState()).toBe('LISTENING')
    expect(add).toHaveBeenCalledTimes(2)
  })

  it('rejects startup while already offline without acquiring a microphone or starting a command engine', async () => {
    online.onLine = false
    const errors = vi.fn(); module.onError(errors)
    await expect(module.startListening()).rejects.toMatchObject({ code: 'RECOGNITION_FAILED' })
    expect(errors).toHaveBeenCalledOnce(); expect(module.getState()).toBe('IDLE')
    expect(Commands.instances).toHaveLength(0); expect(captureAudio).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
  })

  it('settles pending startup on offline and ignores its late native ready callback', async () => {
    const errors = vi.fn(); module.onError(errors)
    const startup = module.startListening(), old = currentCommand()
    offline()
    await expect(startup).rejects.toMatchObject({ code: 'RECOGNITION_FAILED' })
    old.ready()
    expect(module.getState()).toBe('IDLE'); expect(errors).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops command listening on offline without a completion or automatic retry', async () => {
    const complete = vi.fn(), errors = vi.fn()
    module.onTranscriptComplete(complete); module.onError(errors)
    await listen(); offline(); vi.advanceTimersByTime(60_000)
    expect(module.getState()).toBe('IDLE'); expect(complete).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalledOnce(); expect(Commands.instances).toHaveLength(1)
    expect(remove).toHaveBeenCalledOnce()
  })

  it('removes the listener on stop and does not let a stale offline callback stop a newer request', async () => {
    const errors = vi.fn(); module.onError(errors)
    await listen()
    const stale = add.mock.calls[0]![1] as EventListener
    module.stopListening(); module.stopListening()
    expect(remove).toHaveBeenCalledOnce()
    const retry = module.startListening()
    stale(new Event('offline'))
    currentCommand().ready(); await retry
    expect(module.getState()).toBe('LISTENING'); expect(errors).not.toHaveBeenCalled()
    module.stopListening(); offline()
    expect(remove).toHaveBeenCalledTimes(2); expect(errors).not.toHaveBeenCalled()
  })

  it('removes the offline listener when stopListening finishes an active recording', async () => {
    await record(); module.stopListening()
    expect(module.getState()).toBe('IDLE'); expect(remove).toHaveBeenCalledOnce()
    offline(); expect(vi.getTimerCount()).toBe(0)
  })
})
