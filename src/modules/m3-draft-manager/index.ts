import type {
  DraftManagerModule, DraftValidationError, DraftValidationResult,
} from '../../contracts/m3-draft-manager'
import type {
  DraftFields, DraftState, InspectionFields, InspectionRecord,
} from '../../shared/data-models'

const FIELD_KEYS = [
  'workOrder', 'partNumber', 'contactResistance', 'insulationResistance', 'withstandVoltage', 'result',
] as const satisfies readonly (keyof DraftFields)[]

function emptyDraft(): DraftFields {
  return {
    workOrder: null, partNumber: null, contactResistance: null,
    insulationResistance: null, withstandVoltage: null, result: null,
  }
}

function sameDraft(left: DraftFields, right: DraftFields): boolean {
  // Numeric zero has one business value; repeated NaN edits are also unchanged while invalid.
  return FIELD_KEYS.every(field => left[field] === right[field] || Object.is(left[field], right[field]))
}

function isField(field: unknown): field is keyof DraftFields {
  return typeof field === 'string' && FIELD_KEYS.some(key => key === field)
}

/** Manual edits enforce types, allowing incomplete or invalid values to be corrected later. */
function hasFieldType(field: keyof DraftFields, value: unknown): boolean {
  if (value === null) return true
  switch (field) {
    case 'workOrder':
    case 'partNumber': return typeof value === 'string'
    case 'result': return value === 'PASS' || value === 'FAIL'
    default: return typeof value === 'number'
  }
}

function isValidValue(field: keyof DraftFields, value: unknown): boolean {
  if (value === null || !hasFieldType(field, value)) return false
  if (typeof value === 'string') return value.trim().length > 0
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validateDraft(draft: DraftFields): DraftValidationResult {
  const errors: DraftValidationError[] = []
  for (const field of FIELD_KEYS) {
    const value = draft[field]
    if (value === null || (typeof value === 'string' && value.trim() === '')) {
      errors.push({ field, code: 'REQUIRED', message: `${field} is required.` })
    } else if (!isValidValue(field, value)) {
      errors.push({ field, code: 'INVALID_VALUE', message: `${field} has an invalid value.` })
    }
  }
  return { valid: errors.length === 0, errors }
}

type Subscription<T> = { callback: (value: T) => void }

function subscribe<T>(subscribers: Set<Subscription<T>>, callback: (value: T) => void): () => void {
  if (typeof callback !== 'function') throw new TypeError('The subscriber must be a function.')
  // Separate entries allow identical callbacks to be cancelled independently.
  const subscription = { callback }
  subscribers.add(subscription)
  return () => { subscribers.delete(subscription) }
}

function notify<T>(subscriptions: Subscription<T>[], snapshot: () => T): void {
  for (const { callback } of subscriptions) {
    try {
      callback(snapshot())
    } catch (error: unknown) {
      // The operation already committed; even a broken reporter must not turn it into a failure.
      try { console.error('M3 subscriber failed:', error) } catch { /* Reporting is best effort. */ }
    }
  }
}

/**
 * Owns one in-memory draft, confirmation state and pending record per instance.
 * No Vue, DOM, storage or other business-module calls. Persistence outcomes come from the caller.
 */
export function createDraftManager(): DraftManagerModule {
  let draft = emptyDraft()
  let state: DraftState = 'IDLE'
  let pending: InspectionRecord | undefined
  let changing = false
  const draftSubscribers = new Set<Subscription<DraftFields>>()
  const stateSubscribers = new Set<Subscription<DraftState>>()

  function mutate<T>(requiredState: DraftState, operation: () => T): T {
    if (changing) throw new Error('Nested draft mutations are not allowed.')
    if (state !== requiredState) throw new Error(`This operation requires ${requiredState}; current state is ${state}.`)
    // Guard input getters and identity generation as well as notification delivery.
    // Otherwise reentrant changes could be overwritten by a candidate built from old data.
    changing = true
    try { return operation() } finally { changing = false }
  }

  function commit(nextDraft: DraftFields, nextState: DraftState, nextPending: InspectionRecord | undefined): void {
    const draftChanged = !sameDraft(draft, nextDraft)
    const stateChanged = state !== nextState
    draft = nextDraft
    state = nextState
    pending = nextPending
    // Commit all owned data before either event. Subscription changes apply on the next commit.
    const draftListeners = [...draftSubscribers]
    const stateListeners = [...stateSubscribers]
    if (draftChanged) notify(draftListeners, () => ({ ...draft }))
    if (stateChanged) notify(stateListeners, () => state)
  }

  function edit(candidate: DraftFields): DraftFields {
    const changed = !sameDraft(draft, candidate)
    commit(candidate, state, changed ? undefined : pending)
    return { ...draft }
  }

  return {
    /** Return an independent snapshot in any state, including during notifications. */
    getDraft() { return { ...draft } },

    /** Read the current state without changing the draft or pending identity. */
    getState() { return state },

    /** Merge a valid sparse voice update atomically; runtime null values never clear fields. */
    applyParseResult(result) {
      return mutate('IDLE', () => {
        if (typeof result !== 'object' || result === null || Array.isArray(result)
          || !Reflect.ownKeys(result).every(isField)) {
          throw new TypeError('A parse result must contain only draft fields.')
        }
        const candidate = { ...draft }
        for (const field of FIELD_KEYS) {
          if (!Object.hasOwn(result, field)) continue
          const value: unknown = result[field]
          if (value === null) continue
          if (!isValidValue(field, value)) throw new TypeError(`Invalid parsed value for ${field}.`)
          Object.assign(candidate, { [field]: value })
        }
        return edit(candidate)
      })
    },

    /** Edit one typed field in IDLE; null clears it. Full validity is checked separately. */
    updateField(field, value) {
      return mutate('IDLE', () => {
        if (!isField(field) || !hasFieldType(field, value)) throw new TypeError('Invalid draft field or value type.')
        return edit({ ...draft, [field]: value })
      })
    },

    /** Report all missing and invalid values without changing data or state. */
    validate() { return validateDraft(draft) },

    /** Freeze the draft for deletion confirmation; retain pending until confirmation. */
    requestDelete() {
      mutate('IDLE', () => { commit(draft, 'CONFIRMING_DELETE', pending) })
    },

    /** Clear both draft and pending only from CONFIRMING_DELETE. */
    confirmDelete() {
      mutate('CONFIRMING_DELETE', () => { commit(emptyDraft(), 'IDLE', undefined) })
    },

    /** Cancel deletion, preserving the draft and any retry identity. */
    cancelDelete() {
      mutate('CONFIRMING_DELETE', () => { commit(draft, 'IDLE', pending) })
    },

    /** Validate the whole draft; freeze only on success, without generating an identity yet. */
    requestSave() {
      return mutate('IDLE', () => {
        const validation = validateDraft(draft)
        if (validation.valid) commit(draft, 'CONFIRMING_SAVE', pending)
        return validation
      })
    },

    /** Return to editing while preserving the draft and any still-valid pending record. */
    cancelSave() {
      mutate('CONFIRMING_SAVE', () => { commit(draft, 'IDLE', pending) })
    },

    /** Create or reuse the entire pending record, then enter SAVING and return a copy. */
    confirmSave() {
      return mutate('CONFIRMING_SAVE', () => {
        let record = pending
        if (record === undefined) {
          // requestSave validated every field and confirmation freezes edits. The cast only
          // narrows nullable fields after that gate; partial drafts never reach this branch.
          const fields = draft as InspectionFields
          const id = globalThis.crypto.randomUUID()
          const timestamp = new Date().toISOString()
          record = { ...fields, id, createdAt: timestamp, updatedAt: timestamp }
        }
        // All fallible generation precedes commit: failure preserves confirmation and draft.
        commit(draft, 'SAVING', record)
        return { ...record }
      })
    },

    /** Call only after explicit persistence success; clear both draft and pending. */
    completeSave() {
      mutate('SAVING', () => { commit(emptyDraft(), 'IDLE', undefined) })
    },

    /** Call only after explicit persistence failure; retain every pending field for retry. */
    failSave() {
      mutate('SAVING', () => { commit(draft, 'IDLE', pending) })
    },

    /** Subscribe to actual draft changes without initial delivery; cancellation is idempotent. */
    onDraftChange(callback) { return subscribe(draftSubscribers, callback) },

    /** Subscribe to actual state changes; callback failures cannot undo a committed operation. */
    onStateChange(callback) { return subscribe(stateSubscribers, callback) },
  }
}
