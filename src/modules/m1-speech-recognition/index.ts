import type {
  MicrophoneState, SpeechError, SpeechErrorCode, SpeechRecognitionModule,
  TranscriptSegment, TranscriptUpdate, VoiceCommand,
} from '../../contracts/m1-speech-recognition'
import { captureAudio, type AudioInput } from './audio'
import { commandRecognition, proxySocket, type CommandRecognition } from './browser'
import { audioFrame, commandOf, decodeIat, IatText, recordingText } from './protocol'

type Timer = ReturnType<typeof setTimeout>
type Listener<T> = { callback: (value: T) => void }
type Session = {
  socket: WebSocket; text: IatText; ready: boolean; first: boolean; ended: boolean;
  draining: boolean; used: boolean; opened: number;
  sendAt?: number;
  timers: Set<Timer>;
}
type Recording = {
  abort: AbortController; audio?: AudioInput; sessions: Session[]; active?: Session; prepared?: Session;
  startAudio?: () => void;
  queue: Uint8Array[]; queuedBytes: number; pump?: Timer; cut?: Timer; prepare?: Timer;
  stopping: boolean; idle: boolean; done: boolean; stopCommand: boolean; cutoff?: number;
}

function speechError(code: SpeechErrorCode, message: string): SpeechError { return { code, message } }
function mapError(error: unknown, fallback = '语音识别失败。'): SpeechError {
  if (typeof error === 'object' && error !== null && 'code' in error
    && ['NOT_SUPPORTED', 'PERMISSION_DENIED', 'MICROPHONE_UNAVAILABLE', 'RECOGNITION_FAILED'].includes(String(error.code))) {
    return { code: error.code as SpeechErrorCode, message: 'message' in error && typeof error.message === 'string' ? error.message : fallback }
  }
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return speechError('PERMISSION_DENIED', '麦克风权限被拒绝。')
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
    return speechError('MICROPHONE_UNAVAILABLE', '麦克风不可用。')
  }
  return speechError('RECOGNITION_FAILED', fallback)
}

/**
 * Independent M1 instance. Only RECORDING opens the same-origin IAT proxy.
 * The factory configures transport location; the returned object's public contract is unchanged.
 */
export function createSpeechRecognition(options: { proxyPath?: string } = {}): SpeechRecognitionModule {
  let state: MicrophoneState = 'IDLE'
  let generation = 0
  let notifying = false
  let recognition: CommandRecognition | undefined
  let recording: Recording | undefined
  let pending: { resolve: () => void; reject: (error: SpeechError) => void } | undefined
  let emptyRestarts = 0
  let update: TranscriptUpdate = { confirmedText: '', interimText: '' }
  const timers = new Set<Timer>()
  const states = new Set<Listener<MicrophoneState>>()
  const commands = new Set<Listener<VoiceCommand>>()
  const updates = new Set<Listener<TranscriptUpdate>>()
  const completes = new Set<Listener<TranscriptSegment>>()
  const errors = new Set<Listener<SpeechError>>()

  function subscribe<T>(listeners: Set<Listener<T>>, callback: (value: T) => void): () => void {
    if (typeof callback !== 'function') throw new TypeError('The subscriber must be a function.')
    const listener = { callback }; listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  function emit<T>(listeners: Set<Listener<T>>, snapshot: () => T): void {
    const previous = notifying; notifying = true
    try {
      for (const { callback } of [...listeners]) {
        try { callback(snapshot()) }
        catch { try { console.error('M1 subscriber failed.') } catch { /* Notification must remain isolated. */ } }
      }
    } finally { notifying = previous }
  }
  function guard(): void { if (notifying) throw new Error('Nested speech mutations are not allowed.') }
  function change(next: MicrophoneState): void {
    if (next === state) return
    state = next; emit(states, () => state)
  }
  function later(callback: () => void, ms: number, owner?: Set<Timer>): Timer {
    const timer = setTimeout(() => { timers.delete(timer); owner?.delete(timer); callback() }, ms)
    timers.add(timer); owner?.add(timer); return timer
  }
  function cancel(timer: Timer | undefined): void {
    if (timer !== undefined) { clearTimeout(timer); timers.delete(timer) }
  }
  function cancelAll(): void { for (const timer of timers) clearTimeout(timer); timers.clear() }
  function detachCommands(): void {
    const old = recognition; recognition = undefined
    if (old) {
      // Some engines reject abort while permission/startup is pending. A late native start
      // must release its microphone, even though this operation is already logically cancelled.
      old.onstart = () => { try { old.abort() } catch { /* Native engine has not become stoppable. */ } }
      old.onend = () => { old.onstart = null; old.onend = null }
      old.onerror = null; old.onresult = null
      try { old.abort() } catch { /* Already stopped. */ }
    }
  }
  function closeSession(session: Session): void {
    session.ended = true
    for (const timer of session.timers) cancel(timer)
    session.timers.clear()
    session.socket.onopen = null; session.socket.onmessage = null
    session.socket.onclose = null; session.socket.onerror = null
    try { session.socket.close(1000) } catch { /* A failed/connecting socket can already be closed. */ }
  }
  function release(rec: Recording): void {
    rec.startAudio = undefined
    rec.abort.abort(); rec.audio?.stop(); rec.audio = undefined
    for (const session of rec.sessions) closeSession(session)
    if (rec.prepared && !rec.sessions.includes(rec.prepared)) closeSession(rec.prepared)
    rec.queue = []; rec.queuedBytes = 0
  }
  function publish(confirmedText: string, interimText = ''): void {
    if (update.confirmedText === confirmedText && update.interimText === interimText) return
    update = { confirmedText, interimText }; emit(updates, () => ({ ...update }))
  }
  function textOf(rec: Recording): TranscriptUpdate {
    let confirmedText = '', interimText = '', blocked = false
    for (const [index, session] of rec.sessions.entries()) {
      const text = session.text.snapshot()
      // Later physical sessions cannot become confirmed ahead of an earlier uncertain session.
      if (blocked) {
        blocked = true; interimText += text.confirmedText + text.interimText
      } else {
        confirmedText += text.confirmedText; interimText += text.interimText
        blocked = Boolean(text.interimText)
      }
      // A draining predecessor can still insert tail words before the next session's text.
      if (index < rec.sessions.length - 1 && !session.ended) blocked = true
    }
    const body = recordingText(confirmedText, rec.stopping || rec.sessions.every(session => session.ended))
    if (rec.cutoff !== undefined) return { confirmedText: body.text.slice(0, rec.cutoff), interimText: '' }
    return { confirmedText: body.text, interimText }
  }
  function finish(rec: Recording): void {
    if (recording !== rec || rec.done) return
    const text = textOf(rec).confirmedText
    rec.done = true; recording = undefined
    release(rec); cancelAll()
    publish(text)
    emit(completes, () => ({ text }))
    if (rec.idle) { generation++; change('IDLE') }
    else { emptyRestarts = 0; startCommands(false) }
  }
  function fail(error: SpeechError): void {
    if (!pending && state === 'IDLE' && !recording && !recognition) return
    generation++; detachCommands(); cancelAll()
    const request = pending; pending = undefined
    const rec = recording
    if (rec) {
      // A fault is a real recording boundary: release held immutable prefixes, never interim text.
      rec.stopping = true
      // A protocol fault must not turn previously displayed confirmed text into interim text.
      let text = update.confirmedText
      try { text = textOf(rec).confirmedText } catch { /* Retain the last valid snapshot. */ }
      rec.done = true; recording = undefined; release(rec)
      publish(text); emit(completes, () => ({ text }))
    }
    change('IDLE')
    request?.reject(error)
    emit(errors, () => ({ ...error }))
  }
  function restart(callback: () => void, retry: boolean, hadResult: boolean): void {
    if (hadResult) emptyRestarts = 0
    else if (retry) emptyRestarts++
    if (emptyRestarts >= 3) return fail(speechError('RECOGNITION_FAILED', '连续续接没有新的确认结果，已停止监听。'))
    later(callback, 1000)
  }
  function startCommands(retry: boolean): void {
    const token = generation
    let engine: CommandRecognition
    try { engine = commandRecognition() } catch (error: unknown) { fail(mapError(error)); return }
    recognition = engine
    let hadResult = false, started = false
    const consumed = new Map<number, string>()
    const timeout = later(() => {
      if (recognition === engine && generation === token) fail(speechError('RECOGNITION_FAILED', '语音监听启动超时。'))
    }, 10_000)
    const live = () => recognition === engine && generation === token
    engine.onstart = () => {
      if (!live()) { try { engine.abort() } catch { /* Stale native startup. */ } return }
      cancel(timeout); started = true
      const request = pending; pending = undefined
      change('LISTENING'); request?.resolve()
    }
    engine.onresult = event => {
      if (!live() || !started || state !== 'LISTENING') return
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        if (!result?.isFinal || consumed.has(index)) continue
        const text = result[0].transcript
        consumed.set(index, text)
        if (text.trim()) { hadResult = true; emptyRestarts = 0 }
        const command = commandOf(text)
        if (command) emit(commands, () => command)
      }
    }
    engine.onerror = event => {
      if (!live()) return
      // no-speech is a natural, empty recognition end, not a network retry.
      if (event.error === 'no-speech') return
      const code = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'PERMISSION_DENIED'
        : event.error === 'audio-capture' ? 'MICROPHONE_UNAVAILABLE'
          : event.error === 'language-not-supported' ? 'NOT_SUPPORTED' : 'RECOGNITION_FAILED'
      fail(speechError(code, '语音命令监听失败。'))
    }
    engine.onend = () => {
      if (!live()) return
      detachCommands(); cancel(timeout)
      if (!started) return fail(speechError('RECOGNITION_FAILED', '语音监听未能启动。'))
      restart(() => { if (generation === token && state === 'LISTENING') startCommands(true) }, retry, hadResult)
    }
    try { engine.start() } catch (error: unknown) { fail(mapError(error)) }
  }

  function live(rec: Recording): boolean { return recording === rec && !rec.done }
  function refresh(rec: Recording): void {
    if (!live(rec)) return
    const raw = rec.sessions.map(session => session.text.snapshot().confirmedText).join('')
    const body = recordingText(raw, rec.sessions.every(session => session.ended))
    // Never search interim text, or a later session beyond an earlier unconfirmed result.
    const snapshot = textOf(rec)
    if (body.stop && !snapshot.interimText && !rec.stopCommand && !rec.stopping) {
      rec.stopCommand = true; rec.cutoff = body.text.length
      publish(body.text)
      emit(commands, () => 'STOP_INPUT' as const)
      // App normally stops in a microtask. Stop adding audio immediately at the command boundary.
      rec.audio?.stop(); rec.audio = undefined
      rec.queue = []; rec.queuedBytes = 0; cancel(rec.pump); rec.pump = undefined
      cancel(rec.prepare); cancel(rec.cut)
      if (rec.prepared) { closeSession(rec.prepared); rec.prepared = undefined }
      // Release paid transport even if App handles the event later. Only App's stop ends the user segment.
      for (const session of rec.sessions) drain(rec, session)
    } else publish(snapshot.confirmedText, snapshot.interimText)
  }
  function drain(rec: Recording, session: Session): void {
    if (session.ended || session.draining) return
    if (!session.used || !session.ready) { session.ended = true; closeSession(session); return }
    session.draining = true
    try { session.socket.send(JSON.stringify({ data: { status: 2 } })) }
    catch { fail(speechError('RECOGNITION_FAILED', '无法结束语音会话。')); return }
    later(() => { if (live(rec) && !session.ended) fail(speechError('RECOGNITION_FAILED', '语音会话收尾超时。')) }, 5000, session.timers)
  }
  function maybeFinish(rec: Recording): void {
    if (!live(rec) || !rec.stopping || rec.queue.length) return
    for (const session of rec.sessions) drain(rec, session)
    if (rec.sessions.every(session => session.ended)) finish(rec)
  }
  function scheduleRotation(rec: Recording, session: Session): void {
    cancel(rec.prepare); cancel(rec.cut)
    const elapsed = Date.now() - session.opened
    rec.prepare = later(() => {
      if (live(rec) && !rec.stopping && !rec.stopCommand && rec.active === session) {
        rec.prepared = connect(rec, false)
      }
    }, Math.max(0, 52_000 - elapsed))
    rec.cut = later(() => {
      if (!live(rec) || rec.stopping || rec.stopCommand || rec.active !== session) return
      const next = rec.prepared
      if (!next?.ready) return fail(speechError('RECOGNITION_FAILED', '下一语音会话未及时就绪。'))
      rec.prepared = undefined; rec.active = next; rec.sessions.push(next)
      drain(rec, session); scheduleRotation(rec, next)
    }, Math.max(0, 55_000 - elapsed))
  }
  function connect(rec: Recording, active: boolean): Session | undefined {
    let socket: WebSocket
    try { socket = proxySocket(options.proxyPath ?? '/api/m1/iat') }
    catch { fail(speechError('RECOGNITION_FAILED', '无法建立安全语音代理连接。')); return }
    const session: Session = {
      socket, text: new IatText(), ready: false, first: true, ended: false, draining: false,
      used: false, opened: Date.now(), timers: new Set(),
    }
    if (active) { rec.sessions.push(session); rec.active = session }
    const valid = () => live(rec) && !session.ended
    const timeout = later(() => { if (valid()) fail(speechError('RECOGNITION_FAILED', '语音连接启动超时。')) }, 10_000, session.timers)
    socket.onopen = () => {
      if (!valid()) return
      cancel(timeout); session.ready = true
      if (rec.active === session && rec.startAudio) {
        const start = rec.startAudio; rec.startAudio = undefined; start()
      }
      if (rec.active === session) { scheduleRotation(rec, session); pump(rec) }
    }
    socket.onmessage = event => {
      if (!valid()) return
      try {
        const message = decodeIat(event.data as unknown)
        const changed = session.text.accept(message)
        if (message.ended) session.ended = true
        if (changed) refresh(rec)
        if (!live(rec)) return
        if (message.ended) {
          closeSession(session)
          if (rec.active === session) {
            // The active service final is the utterance cutoff. Queued PCM beyond
            // that boundary is not a new utterance; never reopen IAT to send it.
            rec.queue = []; rec.queuedBytes = 0
            cancel(rec.pump); rec.pump = undefined
            if (!rec.stopping && !rec.stopCommand) stop(rec, false)
          }
          // A retiring rotation session must still deliver its tail before completion.
          if (rec.stopping) maybeFinish(rec)
        }
      } catch { fail(speechError('RECOGNITION_FAILED', '语音服务返回了无效或不完整的识别结果。')) }
    }
    socket.onerror = () => { if (valid()) fail(speechError('RECOGNITION_FAILED', '语音连接中断。')) }
    socket.onclose = () => { if (valid()) fail(speechError('RECOGNITION_FAILED', '语音连接在最终结果返回前关闭。')) }
    return session
  }
  function pump(rec: Recording): void {
    if (!live(rec) || rec.pump !== undefined) return
    const session = rec.active
    if (!session?.ready || session.ended) { maybeFinish(rec); return }
    if (Date.now() - session.opened >= 58_000) return fail(speechError('RECOGNITION_FAILED', '语音会话超过安全发送时限。'))
    const frame = rec.queue.shift()
    if (!frame) { maybeFinish(rec); return }
    rec.queuedBytes -= frame.byteLength
    if (session.socket.bufferedAmount > 96_000) return fail(speechError('RECOGNITION_FAILED', '语音网络积压，已停止录入。'))
    try {
      session.socket.send(audioFrame(frame, session.first))
      session.first = false; session.used = true
    } catch { fail(speechError('RECOGNITION_FAILED', '语音音频发送失败。')); return }
    // Preserve the original deadline across stalls. Clamping the deadline to "now"
    // forgets missed time and permanently adds each stall to the audio queue.
    // Limit each catch-up step to 10ms; a new physical socket gets its own cadence.
    const now = Date.now()
    const duration = frame.length / 32
    session.sendAt = (session.sendAt ?? now) + duration
    rec.pump = later(() => { rec.pump = undefined; pump(rec) }, Math.max(0, duration - 10, session.sendAt - now))
  }
  function stop(rec: Recording, idle: boolean): void {
    rec.idle ||= idle
    if (rec.stopping) return
    rec.stopping = true
    cancel(rec.prepare); cancel(rec.cut)
    if (rec.prepared) { closeSession(rec.prepared); rec.prepared = undefined }
    // stop() flushes complete PCM samples; the abort then prevents a late permission grant.
    rec.audio?.stop(); rec.audio = undefined; rec.abort.abort()
    if (!live(rec)) return
    if (!rec.active?.ready) { rec.queue = []; rec.queuedBytes = 0 }
    later(() => { if (live(rec)) fail(speechError('RECOGNITION_FAILED', '录入收尾超时。')) }, 5000)
    pump(rec); maybeFinish(rec)
  }

  return {
    /** Start command recognition. Paid IAT connections are never opened here. */
    startListening() {
      if (notifying || state !== 'IDLE' || pending) {
        return Promise.reject(speechError('RECOGNITION_FAILED', '当前状态不允许重复启动监听。'))
      }
      generation++; emptyRestarts = 0
      return new Promise<void>((resolve, reject) => { pending = { resolve, reject }; startCommands(false) })
    },
    /** Cancel pending startup immediately, otherwise finish recording before entering IDLE. */
    stopListening() {
      guard()
      if (pending) {
        const request = pending; pending = undefined
        generation++; detachCommands(); cancelAll()
        request.reject(speechError('RECOGNITION_FAILED', '语音监听启动已取消。'))
        change('IDLE'); return
      }
      if (recording) { stop(recording, true); return }
      generation++; detachCommands(); cancelAll(); change('IDLE')
    },
    /** Begin a fresh user recording; startup failures are reported asynchronously through onError. */
    startRecording() {
      guard()
      if (state !== 'LISTENING' || recording) return
      generation++; detachCommands(); cancelAll(); emptyRestarts = 0
      const rec: Recording = {
        abort: new AbortController(), sessions: [], queue: [], queuedBytes: 0,
        stopping: false, idle: false, done: false, stopCommand: false,
      }
      recording = rec; change('RECORDING'); publish('')
      const timeout = later(() => { if (live(rec) && !rec.audio) fail(speechError('RECOGNITION_FAILED', '音频采集启动超时。')) }, 10_000)
      void captureAudio(rec.abort.signal, frame => {
        if (!live(rec) || rec.stopCommand || (rec.stopping && rec.active?.ended)) return
        rec.queue.push(frame); rec.queuedBytes += frame.length
        if (rec.queuedBytes > 96_000) return fail(speechError('RECOGNITION_FAILED', '音频缓冲已满，已停止录入。'))
        pump(rec)
      }, () => { if (live(rec)) fail(speechError('MICROPHONE_UNAVAILABLE', '音频采集中断。')) }, start => {
        if (!live(rec) || rec.stopping) return
        rec.startAudio = start
        connect(rec, true)
      })
        .then(audio => {
          cancel(timeout)
          if (!live(rec) || rec.stopping) { audio.stop(); return }
          rec.audio = audio
        })
        .catch((error: unknown) => { cancel(timeout); if (live(rec) && !rec.stopping) fail(mapError(error)) })
    },
    /** Drain the current recording once; the normal destination is command listening. */
    stopRecording() { guard(); if (recording) stop(recording, false) },
    /** Query public state, including during event notifications. */
    getState() { return state },
    /** Subscribe independently; cancelling the same subscription twice is harmless. */
    onStateChange(callback) { return subscribe(states, callback) },
    /** Receive confirmed commands only; schedule state-changing responses after notification. */
    onCommand(callback) { return subscribe(commands, callback) },
    /** Receive isolated complete display snapshots. */
    onTranscriptUpdate(callback) { return subscribe(updates, callback) },
    /** Receive one isolated final segment per recording, including empty/interrupted recordings. */
    onTranscriptComplete(callback) { return subscribe(completes, callback) },
    /** Receive each real failure once; explicit cancellation has no error event. */
    onError(callback) { return subscribe(errors, callback) },
  }
}
