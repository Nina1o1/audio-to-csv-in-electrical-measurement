# Data Models


```text
interface TranscriptSegment {
  text: string;
}
```
```
type InspectionResult = "PASS" | "FAIL";

interface Measurement<Unit extends string> {
  value: number;
  unit: Unit;
}

interface InspectionFields {
  workOrder: string;
  partNumber: string;

  contactResistance: Measurement<"mΩ">;
  insulationResistance: Measurement<"MΩ">;
  withstandVoltage: Measurement<"V">;

  result: InspectionResult;
}

interface InspectionRecord extends InspectionFields {
  id: string; // unique
  createdAt: string;
  updatedAt: string;
}
```
```
interface DraftMeasurement<Unit extends string> {
  value: number | null;
  unit: Unit | null;
}

interface DraftFields {
  workOrder: string | null;
  partNumber: string | null;

  contactResistance: DraftMeasurement<"mΩ">;
  insulationResistance: DraftMeasurement<"MΩ">;
  withstandVoltage: DraftMeasurement<"V">;

  result: InspectionResult | null;
}
```
```
const emptyDraftFields: DraftFields = {
  workOrder: null,
  partNumber: null,

  contactResistance: {
    value: null,
    unit: null
  },

  insulationResistance: {
    value: null,
    unit: null
  },

  withstandVoltage: {
    value: null,
    unit: null
  },

  result: null
};
```
```
type MeasurementUpdate<Unit extends string> =
  Partial<DraftMeasurement<Unit>>;

interface ParseResult {
  workOrder?: string;
  partNumber?: string;

  contactResistance?: MeasurementUpdate<"mΩ">;
  insulationResistance?: MeasurementUpdate<"MΩ">;
  withstandVoltage?: MeasurementUpdate<"V">;

  result?: InspectionResult;
}
```
```
type MicrophoneState =
  | "IDLE"
  | "LISTENING"
  | "RECORDING";

type DraftState =
  | "IDLE"
  | "CONFIRMING_DELETE"
  | "CONFIRMING_SAVE"
  | "SAVING";

type VoiceCommand =
  | "START_INPUT"
  | "STOP_INPUT"
  | "SAVE"
  | "CONFIRM_SAVE"
  | "MODIFY"
  | "DELETE"
  | "CONFIRM_DELETE"
  | "KEEP";
```
