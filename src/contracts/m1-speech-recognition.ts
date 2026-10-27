import type { MicrophoneState, TranscriptSegment, VoiceCommand } from '../shared/data-models'

export type { MicrophoneState, TranscriptSegment, VoiceCommand } from '../shared/data-models'

export interface TranscriptUpdate { confirmedText: string; interimText: string }
export type SpeechErrorCode = 'NOT_SUPPORTED' | 'PERMISSION_DENIED' | 'MICROPHONE_UNAVAILABLE' | 'RECOGNITION_FAILED'
export interface SpeechError { code: SpeechErrorCode; message: string }

export interface SpeechRecognitionModule {
  /** Start command listening; settles once on real startup, failure or cancellation. */
  startListening(): Promise<void>
  /** Cancel startup, or finish the current recording and release all listening resources. */
  stopListening(): void
  /** Start a fresh recording only from LISTENING; enter RECORDING once microphone preparation succeeds. */
  startRecording(): void
  /** Stop audio and drain final results; repeated stops do not duplicate completion. */
  stopRecording(): void
  /** Read the current public state without changing it. */
  getState(): MicrophoneState
  /** Subscribe to actual state changes; unsubscribe is idempotent. */
  onStateChange(callback: (state: MicrophoneState) => void): () => void
  /** Subscribe to confirmed commands; business execution belongs to App. */
  onCommand(callback: (command: VoiceCommand) => void): () => void
  /** Subscribe to complete display snapshots, never incremental append operations. */
  onTranscriptUpdate(callback: (update: TranscriptUpdate) => void): () => void
  /** Subscribe to at most one confirmed, command-free segment per recording. */
  onTranscriptComplete(callback: (segment: TranscriptSegment) => void): () => void
  /** Subscribe to faults; explicit startup cancellation does not emit an error. */
  onError(callback: (error: SpeechError) => void): () => void
}
