import type { DraftFields } from './data-models'

/** Create the agreed initial state; never share mutable measurement objects. */
export function createEmptyDraft(): DraftFields {
  return {
    workOrder: null,
    partNumber: null,
    contactResistance: { value: null, unit: null },
    insulationResistance: { value: null, unit: null },
    withstandVoltage: { value: null, unit: null },
    result: null,
  }
}
