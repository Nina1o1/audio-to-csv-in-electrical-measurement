// Shared models from documentation/docs/data-models.md; units are label text only.
export type InspectionResult = 'PASS' | 'FAIL'

export interface InspectionFields {
  workOrder: string
  partNumber: string
  contactResistance: number // mΩ
  insulationResistance: number // MΩ
  withstandVoltage: number // V
  result: InspectionResult
}

export interface InspectionRecord extends InspectionFields {
  id: string
  createdAt: string
  updatedAt: string
}

export type DraftFields = {
  [K in keyof InspectionFields]: InspectionFields[K] | null
}

export interface TranscriptSegment { text: string }
export interface ParseResult {
  workOrder?: string
  partNumber?: string
  contactResistance?: number
  insulationResistance?: number
  withstandVoltage?: number
  result?: InspectionResult
}
export type MicrophoneState = 'IDLE' | 'LISTENING' | 'RECORDING'
export type DraftState = 'IDLE' | 'CONFIRMING_DELETE' | 'CONFIRMING_SAVE' | 'SAVING'
export type VoiceCommand = 'START_INPUT' | 'STOP_INPUT' | 'SAVE' | 'CONFIRM_SAVE' | 'MODIFY' | 'DELETE' | 'CONFIRM_DELETE' | 'KEEP'
