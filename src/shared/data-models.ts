// Source: documentation/docs/data-models.md. Keep shared types unchanged.

export interface TranscriptSegment {
  text: string;
}

export type InspectionResult = "PASS" | "FAIL";

export interface Measurement<Unit extends string> {
  value: number;
  unit: Unit;
}

export interface InspectionFields {
  workOrder: string;
  partNumber: string;

  contactResistance: Measurement<"mΩ">;
  insulationResistance: Measurement<"MΩ">;
  withstandVoltage: Measurement<"V">;

  result: InspectionResult;
}

export interface InspectionRecord extends InspectionFields {
  id: string; // unique
  createdAt: string;
  updatedAt: string;
}

export interface DraftMeasurement<Unit extends string> {
  value: number | null;
  unit: Unit | null;
}

export interface DraftFields {
  workOrder: string | null;
  partNumber: string | null;

  contactResistance: DraftMeasurement<"mΩ">;
  insulationResistance: DraftMeasurement<"MΩ">;
  withstandVoltage: DraftMeasurement<"V">;

  result: InspectionResult | null;
}

export type MeasurementUpdate<Unit extends string> =
  Partial<DraftMeasurement<Unit>>;

export interface ParseResult {
  workOrder?: string;
  partNumber?: string;

  contactResistance?: MeasurementUpdate<"mΩ">;
  insulationResistance?: MeasurementUpdate<"MΩ">;
  withstandVoltage?: MeasurementUpdate<"V">;

  result?: InspectionResult;
}

export type MicrophoneState =
  | "IDLE"
  | "LISTENING"
  | "RECORDING";

export type DraftState =
  | "IDLE"
  | "CONFIRMING_DELETE"
  | "CONFIRMING_SAVE"
  | "SAVING";

export type VoiceCommand =
  | "START_INPUT"
  | "STOP_INPUT"
  | "SAVE"
  | "CONFIRM_SAVE"
  | "MODIFY"
  | "DELETE"
  | "CONFIRM_DELETE"
  | "KEEP";
