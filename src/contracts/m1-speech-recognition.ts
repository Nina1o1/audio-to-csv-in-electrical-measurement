// Source: documentation/docs/public-interface.md. No business implementation.

import type { MicrophoneState, TranscriptSegment, VoiceCommand } from '../shared/data-models'

export interface TranscriptUpdate {
  confirmedText: string;
  interimText: string;
}

export type SpeechErrorCode =
  | "NOT_SUPPORTED"
  | "PERMISSION_DENIED"
  | "MICROPHONE_UNAVAILABLE"
  | "RECOGNITION_FAILED";

export interface SpeechError {
  code: SpeechErrorCode;
  message: string;
}

export interface SpeechRecognitionModule {

  startListening(): Promise<void>;

  stopListening(): void;

  startRecording(): void;

  stopRecording(): void;

  getState(): MicrophoneState;

  onStateChange(
    callback: (state: MicrophoneState) => void
  ): () => void;

  onCommand(
    callback: (command: VoiceCommand) => void
  ): () => void;

  onTranscriptUpdate(
    callback: (update: TranscriptUpdate) => void
  ): () => void;

  onTranscriptComplete(
    callback: (segment: TranscriptSegment) => void
  ): () => void;

  onError(
    callback: (error: SpeechError) => void
  ): () => void;
}
