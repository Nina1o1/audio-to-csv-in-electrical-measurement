import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { captureAudio, PcmFrames } from '../../../src/modules/m1-speech-recognition/audio'

describe('streaming mono PCM conversion', () => {
  it.each([16000, 44100, 48000])('converts one second at %iHz into 25 little-endian PCM frames', rate => {
    const frames: Uint8Array[] = []
    const packer = new PcmFrames(rate, value => frames.push(value))
    const samples = new Float32Array(rate).fill(0.5)
    // Non-round worklet partitions must not reset the fractional resampling position.
    for (let i = 0; i < samples.length; i += 128) packer.push(samples.slice(i, i + 128))
    packer.flush()
    expect(frames).toHaveLength(25)
    expect(frames.every(frame => frame.length === 1280)).toBe(true)
    expect(new DataView(frames[0]!.buffer).getInt16(0, true)).toBe(16384)
  })
  it('clips signed samples, replaces non-finite input and flushes the final partial frame once', () => {
    const send = vi.fn(), packer = new PcmFrames(16000, send)
    packer.push(new Float32Array([-2, 2, Number.NaN])); packer.flush(); packer.flush()
    expect(send).toHaveBeenCalledTimes(1)
    const view = new DataView((send.mock.calls[0]![0] as Uint8Array).buffer)
    expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)]).toEqual([-32768, 32767, 0])
  })
  it.each([0, 8000, Number.NaN, Number.POSITIVE_INFINITY])('rejects unsupported actual sample rate %s', rate => {
    expect(() => new PcmFrames(rate, vi.fn())).toThrow()
  })
})

class GraphNode {
  connect = vi.fn()
  disconnect = vi.fn()
  frequency = { value: 0 }
  gain = { value: 1 }
  type = ''
}
class Context {
  static instances: Context[] = []
  sampleRate = 48000
  state = 'running'
  destination = new GraphNode()
  source = new GraphNode(); filter = new GraphNode(); mute = new GraphNode()
  onstatechange: (() => void) | null = null
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => { this.state = 'closed' })
  audioWorklet = { addModule: vi.fn(async (): Promise<void> => undefined) }
  createMediaStreamSource = vi.fn(() => this.source)
  createBiquadFilter = vi.fn(() => this.filter)
  createGain = vi.fn(() => this.mute)
  constructor() { Context.instances.push(this) }
}
class Worklet extends GraphNode {
  static instances: Worklet[] = []
  port = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() }
  onprocessorerror: (() => void) | null = null
  constructor() { super(); Worklet.instances.push(this) }
}

describe('browser audio ownership', () => {
  const track = { stop: vi.fn(), onended: null as (() => void) | null }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  let getUserMedia: ReturnType<typeof vi.fn>
  let revoke: MockInstance<(url: string) => void>
  beforeEach(() => {
    Context.instances = []; Worklet.instances = []; track.stop.mockClear(); track.onended = null
    getUserMedia = vi.fn(async () => stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('AudioContext', Context); vi.stubGlobal('AudioWorkletNode', Worklet)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:m1-worklet')
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('captures, resamples, flushes and releases every owned resource idempotently', async () => {
    const send = vi.fn(), fault = vi.fn(), abort = new AbortController()
    const audio = await captureAudio(abort.signal, send, fault)
    const context = Context.instances[0]!, node = Worklet.instances[0]!
    expect(context.mute.gain.value).toBe(0)
    node.port.onmessage?.({ data: new Float32Array(1920) })
    expect(send).toHaveBeenCalledTimes(1)
    audio.stop(); audio.stop(); abort.abort()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect([context.source, context.filter, context.mute, node].every(item => item.disconnect.mock.calls.length === 1)).toBe(true)
    expect(node.port.close).toHaveBeenCalledTimes(1); expect(node.port.onmessage).toBeNull()
    expect(track.onended).toBeNull(); expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:m1-worklet')
    expect(fault).not.toHaveBeenCalled()
  })
  it('rejects unsupported browsers without requesting a microphone', async () => {
    vi.stubGlobal('AudioWorkletNode', undefined)
    await expect(captureAudio(new AbortController().signal, vi.fn(), vi.fn())).rejects.toMatchObject({ code: 'NOT_SUPPORTED' })
    expect(getUserMedia).not.toHaveBeenCalled()
  })
  it.each([
    ['NotAllowedError', 'PERMISSION_DENIED', '浏览器的网站设置'],
    ['NotFoundError', 'MICROPHONE_UNAVAILABLE', '未检测到可用麦克风，请检查设备连接后重试。'],
    ['NotReadableError', 'MICROPHONE_UNAVAILABLE', '关闭可能占用麦克风的应用'],
    ['SecurityError', 'MICROPHONE_UNAVAILABLE', '安全策略限制'],
    ['AbortError', 'MICROPHONE_UNAVAILABLE', '操作系统麦克风隐私权限'],
    ['OverconstrainedError', 'MICROPHONE_UNAVAILABLE', '设备设置'],
  ])('classifies %s and releases the context before retry', async (name, code, message) => {
    getUserMedia.mockRejectedValueOnce({ name })
    await expect(captureAudio(new AbortController().signal, vi.fn(), vi.fn())).rejects.toMatchObject({ code, message: expect.stringContaining(message!) })
    expect(Context.instances[0]!.close).toHaveBeenCalledOnce()
    const audio = await captureAudio(new AbortController().signal, vi.fn(), vi.fn())
    audio.stop(); expect(track.stop).toHaveBeenCalledOnce()
  })
  it('rejects insecure contexts before requesting audio', async () => {
    vi.stubGlobal('isSecureContext', false)
    await expect(captureAudio(new AbortController().signal, vi.fn(), vi.fn())).rejects.toMatchObject({ code: 'NOT_SUPPORTED', message: expect.stringContaining('HTTPS') })
    expect(getUserMedia).not.toHaveBeenCalled(); expect(Context.instances).toHaveLength(0)
  })
  it('rejects website policy restrictions before requesting audio', async () => {
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } })
    await expect(captureAudio(new AbortController().signal, vi.fn(), vi.fn())).rejects.toMatchObject({ code: 'MICROPHONE_UNAVAILABLE', message: expect.stringContaining('管理员') })
    expect(getUserMedia).not.toHaveBeenCalled()
  })
  it('releases an unusable stream with no audio tracks', async () => {
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [track], getAudioTracks: () => [] })
    await expect(captureAudio(new AbortController().signal, vi.fn(), vi.fn())).rejects.toMatchObject({ code: 'MICROPHONE_UNAVAILABLE', message: expect.stringContaining('未检测到可用麦克风') })
    expect(track.stop).toHaveBeenCalledOnce(); expect(Context.instances[0]!.close).toHaveBeenCalledOnce()
  })
  it('prepares audio in the user gesture but connects the graph only when transport is ready', async () => {
    let start!: () => void
    const audio = await captureAudio(new AbortController().signal, vi.fn(), vi.fn(), value => { start = value })
    const context = Context.instances[0]!
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.source.connect).not.toHaveBeenCalled()
    start(); start()
    expect(context.source.connect).toHaveBeenCalledTimes(1)
    audio.stop()
  })
  it('cannot activate prepared audio after cancellation while waiting for transport', async () => {
    let start!: () => void
    const abort = new AbortController()
    const audio = await captureAudio(abort.signal, vi.fn(), vi.fn(), value => { start = value })
    abort.abort(); start(); audio.stop()
    expect(Context.instances[0]!.source.connect).not.toHaveBeenCalled()
    expect(Context.instances[0]!.close).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
  it('stops tracks from a permission grant arriving after cancellation', async () => {
    let grant!: (value: typeof stream) => void
    getUserMedia.mockImplementationOnce(() => new Promise(resolve => { grant = resolve }))
    const abort = new AbortController()
    const promise = captureAudio(abort.signal, vi.fn(), vi.fn())
    await Promise.resolve(); abort.abort(); grant(stream)
    await expect(promise).rejects.toThrow('cancelled')
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(Context.instances[0]!.close).toHaveBeenCalledTimes(1)
    expect(Worklet.instances).toHaveLength(0)
  })
  it('releases the context when getUserMedia rejects', async () => {
    getUserMedia.mockRejectedValueOnce({ name: 'NotAllowedError' })
    await expect(captureAudio(new AbortController().signal, vi.fn(), vi.fn())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(Context.instances[0]!.close).toHaveBeenCalledTimes(1)
  })
  it('cleans up a failed worklet load', async () => {
    let reject!: (reason: Error) => void
    const promise = captureAudio(new AbortController().signal, vi.fn(), vi.fn())
    await Promise.resolve()
    Context.instances[0]!.audioWorklet.addModule.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    await Promise.resolve(); reject(new Error('worklet failed'))
    await expect(promise).rejects.toThrow('worklet failed')
    expect(track.stop).toHaveBeenCalledTimes(1); expect(revoke).toHaveBeenCalled()
  })
  it('does not create graph nodes after cancellation during worklet loading', async () => {
    const abort = new AbortController()
    let ready!: () => void
    const promise = captureAudio(abort.signal, vi.fn(), vi.fn())
    await Promise.resolve()
    Context.instances[0]!.audioWorklet.addModule.mockImplementationOnce(() => new Promise<void>(resolve => { ready = resolve }))
    await Promise.resolve(); abort.abort(); ready()
    await expect(promise).rejects.toThrow('cancelled')
    expect(Worklet.instances).toHaveLength(0); expect(track.stop).toHaveBeenCalledTimes(1)
  })
  it.each(['device', 'processor', 'context'])('reports %s interruptions and ignores events after release', async kind => {
    const fault = vi.fn()
    const audio = await captureAudio(new AbortController().signal, vi.fn(), fault)
    const context = Context.instances[0]!, node = Worklet.instances[0]!
    const late = kind === 'device' ? track.onended! : kind === 'processor' ? node.onprocessorerror! : context.onstatechange!
    context.state = 'suspended'; late(); expect(fault).toHaveBeenCalledTimes(1)
    audio.stop(); late(); expect(fault).toHaveBeenCalledTimes(1)
  })
})
