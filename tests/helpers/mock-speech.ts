import { vi } from 'vitest'
import type { SpeechError, SpeechRecognitionModule, TranscriptUpdate } from '../../src/contracts/m1-speech-recognition'
import type { MicrophoneState, TranscriptSegment, VoiceCommand } from '../../src/shared/data-models'

/** Contract-shaped M1 boundary: mutations during notifications fail, startup/drain are controllable. */
export function mockSpeech() {
  let state: MicrophoneState = 'IDLE'
  let notifying = false
  let startup: { resolve(): void; reject(error: SpeechError): void } | undefined
  const states = new Set<(state: MicrophoneState) => void>()
  const commands = new Set<(command: VoiceCommand) => void>()
  const updates = new Set<(update: TranscriptUpdate) => void>()
  const completes = new Set<(segment: TranscriptSegment) => void>()
  const errors = new Set<(error: SpeechError) => void>()
  function subscribe<T>(set: Set<(value: T) => void>, callback: (value: T) => void) {
    set.add(callback)
    return vi.fn(() => { set.delete(callback) })
  }
  function emit<T>(set: Set<(value: T) => void>, value: T) {
    notifying = true
    try { for (const callback of [...set]) callback(value) } finally { notifying = false }
  }
  function guard() { if (notifying) throw new Error('Nested speech mutation') }
  function change(next: MicrophoneState) { state = next; emit(states, next) }
  const module: SpeechRecognitionModule = {
    startListening: vi.fn(() => {
      guard()
      return new Promise<void>((resolve, reject) => { startup = { resolve, reject } })
    }),
    stopListening: vi.fn(() => {
      guard()
      startup?.reject({ code: 'RECOGNITION_FAILED', message: '启动已取消' }); startup = undefined
      change('IDLE')
    }),
    startRecording: vi.fn(() => { guard(); change('RECORDING') }),
    stopRecording: vi.fn(guard),
    getState: () => state,
    onStateChange: callback => subscribe(states, callback),
    onCommand: callback => subscribe(commands, callback),
    onTranscriptUpdate: callback => subscribe(updates, callback),
    onTranscriptComplete: callback => subscribe(completes, callback),
    onError: callback => subscribe(errors, callback),
  }
  return {
    module, change,
    ready() { change('LISTENING'); startup?.resolve(); startup = undefined },
    command(command: VoiceCommand) { emit(commands, command) },
    update(confirmedText: string, interimText = '') { emit(updates, { confirmedText, interimText }) },
    complete(text: string) { emit(completes, { text }) },
    fault(message = '麦克风权限被拒绝') {
      const error: SpeechError = { code: 'PERMISSION_DENIED', message }
      change('IDLE'); startup?.reject(error); startup = undefined; emit(errors, error)
    },
    listenerCount: () => states.size + commands.size + updates.size + completes.size + errors.size,
  }
}
