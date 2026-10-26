import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftManagerModule } from '../../../src/contracts/m3-draft-manager'
import type { DraftFields, DraftState, InspectionFields, ParseResult } from '../../../src/shared/data-models'
import { createDraftManager } from '../../../src/modules/m3-draft-manager'

const TIME = '2026-10-26T01:30:00.000Z'
const EMPTY: DraftFields = {
  workOrder: null, partNumber: null, contactResistance: null,
  insulationResistance: null, withstandVoltage: null, result: null,
}
const FIELDS: InspectionFields = {
  workOrder: ' aB-007 X ', partNumber: 'P-007', contactResistance: 0,
  insulationResistance: 200, withstandVoltage: 1500, result: 'PASS',
}

// Malformed runtime data intentionally crosses the static contract only in tests.
const asParse = (value: unknown) => value as ParseResult
function ready(): DraftManagerModule {
  const manager = createDraftManager()
  manager.applyParseResult(Object.freeze({ ...FIELDS }))
  return manager
}
function save(manager: DraftManagerModule) {
  expect(manager.requestSave()).toEqual({ valid: true, errors: [] })
  return manager.confirmSave()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TIME)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('M3 draft editing and validation', () => {
  it('starts empty and IDLE, reports every missing field and keeps validation read-only', () => {
    const manager = createDraftManager()
    const draftChange = vi.fn()
    const stateChange = vi.fn()
    manager.onDraftChange(draftChange)
    manager.onStateChange(stateChange)
    expect(manager.getDraft()).toEqual(EMPTY)
    expect(manager.getState()).toBe('IDLE')
    const validation = manager.validate()
    expect(validation.valid).toBe(false)
    expect(validation.errors).toHaveLength(6)
    expect(validation.errors.map(error => error.field)).toEqual(Object.keys(EMPTY))
    for (const error of validation.errors) {
      expect(error.code).toBe('REQUIRED')
      expect(error.message.trim()).not.toBe('')
    }
    expect(manager.requestSave()).toEqual(validation)
    expect(manager.getState()).toBe('IDLE')
    expect(draftChange).not.toHaveBeenCalled()
    expect(stateChange).not.toHaveBeenCalled()
    validation.errors[0]!.message = 'external'
    validation.errors.length = 0
    expect(manager.validate().errors).toHaveLength(6)
  })

  it('merges sparse fields, preserves exact text, ignores voice null and permits explicit manual clearing', () => {
    const manager = createDraftManager()
    const input = { workOrder: ' aB-007 X ', contactResistance: 12.125 }
    const returned = manager.applyParseResult(input)
    expect(returned).toEqual({ ...EMPTY, ...input })
    input.workOrder = 'external'
    returned.workOrder = 'external'
    expect(manager.applyParseResult(asParse({ workOrder: null, partNumber: 'P-007' })))
      .toEqual({ ...EMPTY, workOrder: FIELDS.workOrder, contactResistance: 12.125, partNumber: 'P-007' })
    expect(manager.updateField('contactResistance', null).contactResistance).toBeNull()
    expect(manager.getDraft().workOrder).toBe(FIELDS.workOrder)
    expect(manager.getState()).toBe('IDLE')
  })

  it('separates typed manual edits from whole-draft validation without coercing or rounding', () => {
    const manager = createDraftManager()
    manager.updateField('workOrder', '')
    manager.updateField('partNumber', ' \t ')
    manager.updateField('contactResistance', -1)
    manager.updateField('insulationResistance', NaN)
    manager.updateField('withstandVoltage', Infinity)
    manager.updateField('result', 'FAIL')
    const before = manager.getDraft()
    const validation = manager.validate()
    expect(validation.valid).toBe(false)
    expect(validation.errors).toHaveLength(5)
    expect(validation.errors.map(error => error.field)).toEqual(Object.keys(EMPTY).slice(0, 5))
    expect(validation.errors.filter(error => ['contactResistance', 'insulationResistance', 'withstandVoltage'].includes(error.field)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INVALID_VALUE' })]))
    expect(manager.requestSave()).toEqual(validation)
    expect(manager.getDraft()).toEqual(before)
    expect(manager.getState()).toBe('IDLE')
    manager.applyParseResult(FIELDS)
    manager.updateField('contactResistance', 0.123456789)
    manager.updateField('insulationResistance', Number.MAX_VALUE)
    manager.updateField('withstandVoltage', 0)
    expect(manager.validate()).toEqual({ valid: true, errors: [] })
    expect(manager.getDraft().contactResistance).toBe(0.123456789)
    expect(manager.getDraft().insulationResistance).toBe(Number.MAX_VALUE)
  })

  it.each([
    null, undefined, [], 'text', 1, { extra: true }, { result: 'pass' },
    { contactResistance: -1 }, { contactResistance: NaN }, { contactResistance: Infinity },
    { workOrder: '' }, { partNumber: '  ' }, { workOrder: undefined },
    { contactResistance: '12' }, { result: undefined }, { [Symbol('extra')]: 1 },
  ])('rejects invalid voice data %j atomically, retaining pending for retry', input => {
    const manager = ready()
    const pending = save(manager)
    manager.failSave()
    const callback = vi.fn()
    manager.onDraftChange(callback)
    expect(() => manager.applyParseResult(asParse(input))).toThrow(TypeError)
    expect(manager.getDraft()).toEqual(FIELDS)
    expect(callback).not.toHaveBeenCalled()
    expect(save(manager)).toEqual(pending)
  })

  it('does not partially merge when a later field is invalid', () => {
    const manager = ready()
    expect(() => manager.applyParseResult(asParse({ workOrder: 'changed', withstandVoltage: -1 }))).toThrow(TypeError)
    expect(manager.getDraft()).toEqual(FIELDS)
  })

  it.each([
    ['unknown', 1], ['id', 'forbidden'], [null, 1], ['workOrder', 1],
    ['workOrder', undefined], ['result', 'unknown'], ['result', undefined],
    ['contactResistance', ''], ['insulationResistance', {}], ['withstandVoltage', false],
  ])('rejects invalid manual field/value %j / %j without changing draft or pending', (field, value) => {
    const manager = ready()
    const pending = save(manager)
    manager.failSave()
    expect(() => manager.updateField(field as keyof DraftFields, value as DraftFields[keyof DraftFields])).toThrow(TypeError)
    expect(manager.getDraft()).toEqual(FIELDS)
    expect(save(manager)).toEqual(pending)
  })

  it('isolates instances and all returned draft snapshots', () => {
    const first = ready()
    const second = createDraftManager()
    first.getDraft().partNumber = 'external'
    first.updateField('partNumber', 'changed').partNumber = 'external'
    expect(first.getDraft().partNumber).toBe('changed')
    expect(second.getDraft()).toEqual(EMPTY)
    save(first)
    expect(second.getState()).toBe('IDLE')
  })

  it('treats repeated NaN edits as unchanged, while validation continues to reject the value', () => {
    const manager = ready()
    manager.updateField('contactResistance', NaN)
    const callback = vi.fn()
    manager.onDraftChange(callback)
    manager.updateField('contactResistance', NaN)
    expect(callback).not.toHaveBeenCalled()
    expect(manager.validate().errors).toEqual([
      expect.objectContaining({ field: 'contactResistance', code: 'INVALID_VALUE' }),
    ])
  })
})

describe('M3 save identity and deletion', () => {
  it('creates exactly nine record fields only at confirmation, and isolates pending snapshots', () => {
    const manager = ready()
    const id = vi.spyOn(globalThis.crypto, 'randomUUID')
    expect(manager.requestSave()).toEqual({ valid: true, errors: [] })
    expect(id).not.toHaveBeenCalled()
    manager.cancelSave()
    expect(manager.getDraft()).toEqual(FIELDS)
    const pending = save(manager)
    expect(pending).toEqual({ ...FIELDS, id: expect.any(String), createdAt: TIME, updatedAt: TIME })
    expect(pending.id.trim()).not.toBe('')
    expect(Object.keys(pending)).toHaveLength(9)
    expect(manager.getState()).toBe('SAVING')
    const original = { ...pending }
    pending.id = 'external'
    pending.partNumber = 'external'
    pending.createdAt = 'external'
    manager.failSave()
    expect(save(manager)).toEqual(original)
    expect(id).toHaveBeenCalledTimes(1)
  })

  it('reuses all pending fields through failures, no-op edits, save cancellations and delete cancellations', () => {
    const manager = ready()
    const pending = save(manager)
    manager.failSave()
    vi.setSystemTime('2027-01-01T00:00:00.000Z')
    manager.applyParseResult({})
    manager.applyParseResult({ ...FIELDS })
    manager.applyParseResult(asParse({ workOrder: null, contactResistance: null }))
    manager.updateField('partNumber', FIELDS.partNumber)
    manager.requestSave()
    manager.cancelSave()
    manager.requestDelete()
    manager.cancelDelete()
    expect(save(manager)).toEqual(pending)
    manager.failSave()
    expect(save(manager)).toEqual(pending)
  })

  it('keeps pending identity when zero is edited to negative zero', () => {
    const manager = ready()
    const pending = save(manager)
    manager.failSave()
    const callback = vi.fn()
    manager.onDraftChange(callback)
    manager.updateField('contactResistance', -0)
    expect(manager.validate().valid).toBe(true)
    expect(callback).not.toHaveBeenCalled()
    expect(save(manager)).toEqual(pending)
  })

  it('gives independent instances independent pending identities', () => {
    const first = ready()
    const second = ready()
    const firstPending = save(first)
    const secondPending = save(second)
    expect(secondPending.id).not.toBe(firstPending.id)
    first.completeSave()
    expect(second.getState()).toBe('SAVING')
    second.failSave()
    expect(save(second)).toEqual(secondPending)
  })

  it.each(['manual', 'voice', 'clear', 'change-back'] as const)('invalidates old pending on actual %s changes', source => {
    const manager = ready()
    const old = save(manager)
    manager.failSave()
    vi.setSystemTime('2027-01-01T00:00:00.000Z')
    if (source === 'voice') manager.applyParseResult({ partNumber: 'new' })
    else if (source === 'clear') {
      manager.updateField('partNumber', null)
      expect(manager.requestSave().valid).toBe(false)
      manager.updateField('partNumber', FIELDS.partNumber)
    } else {
      manager.updateField('partNumber', 'new')
      if (source === 'change-back') manager.updateField('partNumber', FIELDS.partNumber)
    }
    const next = save(manager)
    expect(next.id).not.toBe(old.id)
    expect(next.createdAt).toBe('2027-01-01T00:00:00.000Z')
    expect(next.updatedAt).toBe(next.createdAt)
    expect(next.partNumber).toBe(source === 'clear' || source === 'change-back' ? FIELDS.partNumber : 'new')
  })

  it.each(['complete', 'delete'] as const)('%s clears draft and pending, permitting a fresh identity next time', action => {
    const manager = ready()
    const previous = save(manager)
    if (action === 'complete') manager.completeSave()
    else {
      manager.failSave()
      manager.requestDelete()
      expect(manager.getDraft()).toEqual(FIELDS)
      manager.confirmDelete()
    }
    expect(manager.getDraft()).toEqual(EMPTY)
    expect(manager.getState()).toBe('IDLE')
    manager.applyParseResult(FIELDS)
    expect(save(manager).id).not.toBe(previous.id)
  })

  it('allows confirming deletion of an empty draft', () => {
    const manager = createDraftManager()
    manager.requestDelete()
    manager.confirmDelete()
    expect(manager.getDraft()).toEqual(EMPTY)
    expect(manager.getState()).toBe('IDLE')
  })

  it('keeps an uncertain save frozen indefinitely until explicitly resolved', () => {
    const manager = ready()
    const pending = save(manager)
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(manager.getState()).toBe('SAVING')
    expect(manager.getDraft()).toEqual(FIELDS)
    manager.failSave()
    expect(save(manager)).toEqual(pending)
  })

  it('keeps confirmation intact if identity or time generation fails, then allows retry', () => {
    const manager = ready()
    manager.requestSave()
    const id = vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementationOnce(() => { throw new Error('id failed') })
    expect(() => manager.confirmSave()).toThrow('id failed')
    expect(manager.getState()).toBe('CONFIRMING_SAVE')
    expect(manager.getDraft()).toEqual(FIELDS)
    id.mockRestore()
    const time = vi.spyOn(Date.prototype, 'toISOString').mockImplementationOnce(() => { throw new Error('time failed') })
    expect(() => manager.confirmSave()).toThrow('time failed')
    expect(manager.getState()).toBe('CONFIRMING_SAVE')
    time.mockRestore()
    expect(manager.confirmSave()).toMatchObject(FIELDS)
    expect(manager.getState()).toBe('SAVING')
  })
})

const operations = {
  applyParseResult: (m: DraftManagerModule) => m.applyParseResult({}),
  updateField: (m: DraftManagerModule) => m.updateField('workOrder', FIELDS.workOrder),
  requestSave: (m: DraftManagerModule) => m.requestSave(),
  cancelSave: (m: DraftManagerModule) => m.cancelSave(),
  confirmSave: (m: DraftManagerModule) => m.confirmSave(),
  completeSave: (m: DraftManagerModule) => m.completeSave(),
  failSave: (m: DraftManagerModule) => m.failSave(),
  requestDelete: (m: DraftManagerModule) => m.requestDelete(),
  confirmDelete: (m: DraftManagerModule) => m.confirmDelete(),
  cancelDelete: (m: DraftManagerModule) => m.cancelDelete(),
}
type Operation = keyof typeof operations
const allowed: Record<DraftState, readonly Operation[]> = {
  IDLE: ['applyParseResult', 'updateField', 'requestSave', 'requestDelete'],
  CONFIRMING_SAVE: ['cancelSave', 'confirmSave'],
  CONFIRMING_DELETE: ['confirmDelete', 'cancelDelete'],
  SAVING: ['completeSave', 'failSave'],
}
function inState(state: DraftState) {
  const manager = ready()
  if (state === 'CONFIRMING_SAVE') manager.requestSave()
  if (state === 'CONFIRMING_DELETE') manager.requestDelete()
  if (state === 'SAVING') save(manager)
  return manager
}

describe('M3 public state machine', () => {
  const cases = (Object.keys(allowed) as DraftState[]).flatMap(state =>
    (Object.keys(operations) as Operation[]).map(operation => ({ state, operation })))
  it.each(cases)('$state / $operation obeys the state gate, including repeated and no-op operations', ({ state, operation }) => {
    const manager = inState(state)
    const draftChange = vi.fn()
    const stateChange = vi.fn()
    manager.onDraftChange(draftChange)
    manager.onStateChange(stateChange)
    expect(manager.validate()).toEqual({ valid: true, errors: [] })
    expect(manager.getDraft()).toEqual(FIELDS)
    if (allowed[state].includes(operation)) {
      expect(() => operations[operation](manager)).not.toThrow()
    } else {
      expect(() => operations[operation](manager)).toThrow(Error)
      expect(manager.getState()).toBe(state)
      expect(manager.getDraft()).toEqual(FIELDS)
      expect(draftChange).not.toHaveBeenCalled()
      expect(stateChange).not.toHaveBeenCalled()
    }
  })
})

describe('M3 notifications and reentrancy', () => {
  it('notifies only actual changes, commits both values before draft-then-state delivery, and isolates snapshots', () => {
    const manager = ready()
    const observations: unknown[] = []
    manager.onDraftChange(draft => { draft.partNumber = 'external' })
    manager.onDraftChange(draft => { observations.push(['draft', draft, manager.getDraft(), manager.getState()]) })
    manager.onStateChange(state => { observations.push(['state', state, manager.getDraft()]) })
    manager.applyParseResult({})
    manager.updateField('partNumber', FIELDS.partNumber)
    expect(observations).toEqual([])
    manager.requestDelete()
    manager.confirmDelete()
    expect(observations).toEqual([
      ['state', 'CONFIRMING_DELETE', FIELDS],
      ['draft', EMPTY, EMPTY, 'IDLE'],
      ['state', 'IDLE', EMPTY],
    ])
  })

  it.each(['draft', 'state'] as const)('isolates %s subscriber and reporting errors from successful operations', channel => {
    const manager = ready()
    const report = vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('report failed') })
    const fail = () => { throw new Error('subscriber failed') }
    const next = vi.fn()
    if (channel === 'draft') {
      manager.onDraftChange(fail)
      manager.onDraftChange(next)
      expect(manager.updateField('partNumber', 'new').partNumber).toBe('new')
    } else {
      manager.onStateChange(fail)
      manager.onStateChange(next)
      expect(manager.requestSave().valid).toBe(true)
      expect(manager.getState()).toBe('CONFIRMING_SAVE')
    }
    expect(report).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledOnce()
  })

  it.each(['draft', 'state'] as const)('rejects every nested mutation during %s notifications but allows reads', channel => {
    const manager = ready()
    const errors: unknown[] = []
    const reads: unknown[] = []
    const callback = () => {
      reads.push(manager.getDraft(), manager.getState(), manager.validate())
      for (const operation of Object.values(operations)) {
        try { operation(manager) } catch (error) { errors.push(error) }
      }
    }
    const cancel = channel === 'draft' ? manager.onDraftChange(callback) : manager.onStateChange(callback)
    if (channel === 'draft') manager.updateField('partNumber', 'new')
    else manager.requestDelete()
    expect(errors).toHaveLength(Object.keys(operations).length)
    for (const error of errors) expect(error).toBeInstanceOf(Error)
    expect(reads).toHaveLength(3)
    cancel()
    if (channel === 'state') manager.cancelDelete()
    expect(manager.updateField('workOrder', 'after').workOrder).toBe('after')
  })

  it('guards input getters against nested mutations and releases the guard after failure', () => {
    const manager = ready()
    const input = { get partNumber(): string { manager.requestDelete(); return 'unreachable' } }
    expect(() => manager.applyParseResult(input)).toThrow(Error)
    expect(manager.getDraft()).toEqual(FIELDS)
    expect(manager.getState()).toBe('IDLE')
    expect(manager.updateField('partNumber', 'after').partNumber).toBe('after')
  })

  it.each(['draft', 'state'] as const)('validates %s callbacks, cancels idempotently and keeps duplicate subscriptions independent', channel => {
    const manager = ready()
    const subscribe = channel === 'draft' ? manager.onDraftChange : manager.onStateChange
    expect(() => subscribe(null as unknown as () => void)).toThrow(TypeError)
    const callback = vi.fn()
    const cancel = subscribe(callback)
    subscribe(callback)
    expect(callback).not.toHaveBeenCalled()
    cancel()
    cancel()
    if (channel === 'draft') manager.updateField('partNumber', 'new')
    else manager.requestDelete()
    expect(callback).toHaveBeenCalledOnce()
  })

  it('contains uncaught nested mutation errors without preventing subsequent notifications', () => {
    const manager = ready()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cancel = manager.onDraftChange(() => manager.requestDelete())
    const next = vi.fn()
    manager.onDraftChange(next)
    manager.updateField('partNumber', 'new')
    expect(next).toHaveBeenCalledOnce()
    expect(manager.getState()).toBe('IDLE')
    cancel()
    manager.requestDelete()
    expect(manager.getState()).toBe('CONFIRMING_DELETE')
  })

  it('makes subscription membership changes effective on the next commit', () => {
    const manager = ready()
    const later = vi.fn()
    const existing = vi.fn()
    let cancelExisting = () => {}
    const cancelFirst = manager.onDraftChange(() => {
      manager.onDraftChange(later)
      cancelExisting()
    })
    cancelExisting = manager.onDraftChange(existing)
    manager.updateField('partNumber', 'first')
    expect(existing).toHaveBeenCalledOnce()
    expect(later).not.toHaveBeenCalled()
    cancelFirst()
    manager.updateField('partNumber', 'second')
    expect(existing).toHaveBeenCalledOnce()
    expect(later).toHaveBeenCalledExactlyOnceWith({ ...FIELDS, partNumber: 'second' })
  })
})
