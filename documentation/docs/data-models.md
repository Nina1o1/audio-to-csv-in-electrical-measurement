# Data Models

测量字段仅记录数值，草稿未填写时为 null。mΩ、MΩ、V 说明字段含义，不作为数据字段保存；解析结果和正式记录均不包含单位属性。CSV 导出时将测量值格式化为带标准单位的文本（如 12.5 mΩ、200 MΩ、1500 V），不导出 ID；具体八列规则见 Public Interface，不改变共享类型或存储结构。


```text
interface TranscriptSegment {
  text: string;
}
```
```
type InspectionResult = "PASS" | "FAIL";

// 已确认的检测字段
interface InspectionFields {
  workOrder: string;
  partNumber: string;

  contactResistance: number;    // mΩ
  insulationResistance: number; // MΩ
  withstandVoltage: number;     // V

  result: InspectionResult;
}

// 已保存的检测记录
interface InspectionRecord extends InspectionFields {
  id: string; // unique
  createdAt: string;
  updatedAt: string;
}
```
```
// 尚未完成的草稿
type DraftFields = {
  [K in keyof InspectionFields]: InspectionFields[K] | null;
};
```
```
const emptyDraftFields: DraftFields = {
  workOrder: null,
  partNumber: null,

  contactResistance: null,

  insulationResistance: null,

  withstandVoltage: null,

  result: null
};
```
```
interface ParseResult {
  workOrder?: string;
  partNumber?: string;

  contactResistance?: number;
  insulationResistance?: number;
  withstandVoltage?: number;

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
