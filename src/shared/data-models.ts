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
