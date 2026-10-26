import { describe, expect, it } from 'vitest'
import { createEmptyDraft } from '@/shared/create-empty-draft'

describe('createEmptyDraft', () => {
  it('starts with six empty fields, without default units or a PASS result', () => {
    expect(createEmptyDraft()).toEqual({
      workOrder: null,
      partNumber: null,
      contactResistance: { value: null, unit: null },
      insulationResistance: { value: null, unit: null },
      withstandVoltage: { value: null, unit: null },
      result: null,
    })
  })

  it('keeps existing drafts independent when another draft is edited', () => {
    const first = createEmptyDraft()
    const second = createEmptyDraft()
    first.workOrder = 'A001'
    first.contactResistance.value = 12.5
    first.contactResistance.unit = 'mΩ'
    first.insulationResistance.value = 200
    first.insulationResistance.unit = 'MΩ'
    first.withstandVoltage.value = 1500
    first.withstandVoltage.unit = 'V'

    expect(second).toEqual(createEmptyDraft())
    expect(first).not.toBe(second)
    expect(first.contactResistance).not.toBe(second.contactResistance)
    expect(first.insulationResistance).not.toBe(second.insulationResistance)
    expect(first.withstandVoltage).not.toBe(second.withstandVoltage)
  })

  it('returns a clean state after previous drafts have been changed', () => {
    const previous = createEmptyDraft()
    previous.result = 'FAIL'
    previous.contactResistance.value = 0

    const reset = createEmptyDraft()
    expect(reset.result).toBeNull()
    expect(reset.contactResistance.value).toBeNull()
    expect(previous.result).toBe('FAIL')
    expect(previous.contactResistance.value).toBe(0)
  })

  it('keeps the three measurements independent within the same draft', () => {
    const draft = createEmptyDraft()
    draft.contactResistance.value = 12.5

    expect(draft.insulationResistance.value).toBeNull()
    expect(draft.withstandVoltage.value).toBeNull()
  })
})
