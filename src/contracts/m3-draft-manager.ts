import type { DraftFields, DraftState, InspectionRecord, ParseResult } from '../shared/data-models'

export type DraftValidationErrorCode = 'REQUIRED' | 'INVALID_VALUE'

export interface DraftValidationError {
  field: keyof DraftFields
  code: DraftValidationErrorCode
  message: string
}

export interface DraftValidationResult {
  valid: boolean
  errors: DraftValidationError[]
}

export interface DraftManagerModule {
  getDraft(): DraftFields
  getState(): DraftState
  applyParseResult(result: ParseResult): DraftFields
  updateField<K extends keyof DraftFields>(field: K, value: DraftFields[K]): DraftFields
  validate(): DraftValidationResult
  requestDelete(): void
  confirmDelete(): void
  cancelDelete(): void
  requestSave(): DraftValidationResult
  cancelSave(): void
  confirmSave(): InspectionRecord
  completeSave(): void
  failSave(): void
  onDraftChange(callback: (draft: DraftFields) => void): () => void
  onStateChange(callback: (state: DraftState) => void): () => void
}
