/** Streaming area resampling keeps fractional input positions across worklet messages. */
export class PcmFrames {
  private total = 0
  private weight = 0
  private frame = new Uint8Array(1280)
  private offset = 0
  private readonly ratio: number

  constructor(sampleRate: number, private readonly send: (frame: Uint8Array) => void) {
    if (!Number.isFinite(sampleRate) || sampleRate < 16000) throw new Error('Unsupported microphone sample rate.')
    this.ratio = sampleRate / 16000
  }

  push(samples: Float32Array): void {
    for (const raw of samples) {
      const sample = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
      let remaining = 1
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight)
        this.total += sample * take
        this.weight += take
        remaining -= take
        if (this.weight >= this.ratio - 1e-9) {
          const value = this.total / this.ratio
          const pcm = Math.round(value * (value < 0 ? 32768 : 32767))
          this.frame[this.offset++] = pcm & 255
          this.frame[this.offset++] = (pcm >> 8) & 255
          this.total = 0
          this.weight = 0
          if (this.offset === this.frame.length) {
            const complete = this.frame
            this.frame = new Uint8Array(1280)
            this.offset = 0
            this.send(complete)
          }
        }
      }
    }
  }

  /** Preserve the last complete PCM samples without padding invented audio. */
  flush(): void {
    if (this.offset) this.send(this.frame.slice(0, this.offset))
    this.offset = 0
  }
}

export interface AudioInput { stop(): void }

const processor = `
class M1Capture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) { const copy = new Float32Array(channel); this.port.postMessage(copy, [copy.buffer]); }
    return true;
  }
}
registerProcessor('m1-capture', M1Capture);
`

/** Own one stream/context/graph; cancellation also disposes a late permission grant. */
export async function captureAudio(
  signal: AbortSignal,
  onFrame: (frame: Uint8Array) => void,
  onFailure: () => void,
  onPrepared?: (start: () => void) => void,
): Promise<AudioInput> {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia || !globalThis.AudioContext || !globalThis.AudioWorkletNode) {
    throw { code: 'NOT_SUPPORTED', message: '当前浏览器不支持音频采集。' }
  }
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let filter: BiquadFilterNode | undefined
  let node: AudioWorkletNode | undefined
  let mute: GainNode | undefined
  let packer: PcmFrames | undefined
  let stopped = false
  let url: string | undefined
  const stop = () => {
    if (stopped) return
    stopped = true
    signal.removeEventListener('abort', stop)
    for (const track of stream?.getTracks() ?? []) { track.onended = null; track.stop() }
    if (node) { node.port.onmessage = null; node.onprocessorerror = null; node.port.close() }
    source?.disconnect(); filter?.disconnect(); node?.disconnect(); mute?.disconnect()
    if (context) { context.onstatechange = null; void context.close().catch(() => undefined) }
    if (url) URL.revokeObjectURL(url)
    packer?.flush()
  }
  const check = () => { if (signal.aborted || stopped) throw new Error('Audio capture cancelled.') }
  signal.addEventListener('abort', stop, { once: true })
  try {
    check()
    // Resume while still in the caller's gesture when possible; never force a browser permission.
    context = new AudioContext()
    await context.resume()
    check()
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false })
    if (stopped || signal.aborted) {
      for (const track of stream.getTracks()) track.stop()
      throw new Error('Audio capture cancelled.')
    }
    packer = new PcmFrames(context.sampleRate, onFrame)
    url = URL.createObjectURL(new Blob([processor], { type: 'text/javascript' }))
    await context.audioWorklet.addModule(url)
    check()
    URL.revokeObjectURL(url); url = undefined
    source = context.createMediaStreamSource(stream)
    // Filter before downsampling to reduce aliasing; the worklet is explicitly mono.
    filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 7000
    node = new AudioWorkletNode(context, 'm1-capture', { channelCount: 1, channelCountMode: 'explicit' })
    mute = context.createGain(); mute.gain.value = 0
    node.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!stopped && event.data instanceof Float32Array) packer?.push(event.data)
    }
    node.onprocessorerror = () => { if (!stopped) onFailure() }
    for (const track of stream.getAudioTracks()) track.onended = () => { if (!stopped) onFailure() }
    context.onstatechange = () => {
      if (!stopped && context?.state !== 'running') onFailure()
    }
    let started = false
    const start = () => {
      if (stopped || signal.aborted || started) return
      started = true
      source!.connect(filter!); filter!.connect(node!); node!.connect(mute!); mute!.connect(context!.destination)
    }
    // Resume/permission preparation stays in the original gesture, but a slow initial
    // handshake must not fill the PCM queue before there is a socket to consume it.
    if (onPrepared) onPrepared(start)
    else start()
    return { stop }
  } catch (error: unknown) {
    stop()
    throw error
  }
}
