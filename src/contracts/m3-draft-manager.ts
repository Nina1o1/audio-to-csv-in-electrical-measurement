// Source: documentation/docs/public-interface.md. No business implementation.

import type { DraftFields, DraftState, InspectionRecord, ParseResult } from '../shared/data-models'

export type SimpleDraftField =
  | "workOrder"
  | "partNumber"
  | "result";

export type MeasurementField =
  | "contactResistance"
  | "insulationResistance"
  | "withstandVoltage";

export type MeasurementProperty =
  | "value"
  | "unit";

export type DraftValidationErrorCode =
  | "REQUIRED"
  | "INVALID_VALUE"
  | "INVALID_UNIT";

export interface DraftValidationError {
  field: keyof DraftFields;
  property?: MeasurementProperty;
  code: DraftValidationErrorCode;
  message: string;
}

export interface DraftValidationResult {
  valid: boolean;
  errors: DraftValidationError[];
}

export interface DraftManagerModule {

  getDraft(): DraftFields;

  getState(): DraftState;

  applyParseResult(
    result: ParseResult
  ): DraftFields;

  updateField<K extends SimpleDraftField>(
    field: K,
    value: DraftFields[K]
  ): DraftFields;

  updateMeasurement<
    K extends MeasurementField,
    P extends MeasurementProperty
  >(
    field: K,
    property: P,
    value: DraftFields[K][P]
  ): DraftFields;

  validate(): DraftValidationResult;

  requestDelete(): void;

  confirmDelete(): void;

  cancelDelete(): void;

  requestSave(): DraftValidationResult;

  cancelSave(): void;

  confirmSave(): InspectionRecord;

  completeSave(): void;

  failSave(): void;

  onDraftChange(
    callback: (draft: DraftFields) => void
  ): () => void;

  onStateChange(
    callback: (state: DraftState) => void
  ): () => void;
}
