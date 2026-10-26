import type {
  RecordErrorCode, RecordManagerError, RecordManagerModule, RecordQuery,
} from '../../contracts/m4-record-manager'
import type { InspectionFields, InspectionRecord } from '../../shared/data-models'

const STORAGE_KEY = 'inspection-records'
const FIELD_KEYS = [
  'workOrder', 'partNumber', 'contactResistance', 'insulationResistance', 'withstandVoltage', 'result',
] as const satisfies readonly (keyof InspectionFields)[]
const RECORD_KEYS = ['id', ...FIELD_KEYS, 'createdAt', 'updatedAt'] as const
const QUERY_KEYS = ['workOrder', 'createdFrom', 'createdTo', 'sortBy', 'sortDirection'] as const

function fail(code: RecordErrorCode, message: string): never {
  const error: RecordManagerError = Object.assign(new Error(message), { name: 'RecordManagerError', code })
  throw error
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key))
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMeasurement(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const time = Date.parse(value)
  // Round-trip comparison rejects calendar overflow that Date.parse otherwise normalizes.
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

/** Validate and copy at the boundary; only the nine persisted primitive fields are retained. */
function readRecord(value: unknown, code: RecordErrorCode): InspectionRecord {
  if (!isObject(value) || !hasOnlyKeys(value, RECORD_KEYS)
    || !RECORD_KEYS.every(key => Object.hasOwn(value, key))) {
    return fail(code, 'A record must contain exactly the InspectionRecord fields.')
  }
  const { id, workOrder, partNumber, contactResistance, insulationResistance, withstandVoltage, result, createdAt, updatedAt } = value
  if (!isRequiredText(id) || !isRequiredText(workOrder) || !isRequiredText(partNumber)
    || !isMeasurement(contactResistance) || !isMeasurement(insulationResistance) || !isMeasurement(withstandVoltage)
    || (result !== 'PASS' && result !== 'FAIL')
    || !isTimestamp(createdAt) || !isTimestamp(updatedAt) || updatedAt < createdAt) {
    return fail(code, 'Invalid record fields or timestamps.')
  }
  return { id, workOrder, partNumber, contactResistance, insulationResistance, withstandVoltage, result, createdAt, updatedAt }
}

function readCollection(value: unknown, code: RecordErrorCode): InspectionRecord[] {
  if (!Array.isArray(value)) return fail(code, 'Stored records must be an array.')
  const ids = new Set<string>()
  const result: InspectionRecord[] = []
  for (const item of value) {
    const record = readRecord(item, code)
    if (ids.has(record.id)) return fail(code, 'Record IDs must be unique.')
    ids.add(record.id)
    result.push(record)
  }
  return result
}

function readQuery(value: unknown): RecordQuery {
  if (!isObject(value) || !hasOnlyKeys(value, QUERY_KEYS)) return fail('INVALID_QUERY', 'Invalid query structure.')
  const { workOrder, createdFrom, createdTo, sortBy, sortDirection } = value
  if ((workOrder !== undefined && typeof workOrder !== 'string')
    || (createdFrom !== undefined && !isTimestamp(createdFrom))
    || (createdTo !== undefined && !isTimestamp(createdTo))
    || (sortBy !== undefined && sortBy !== 'workOrder' && sortBy !== 'createdAt')
    || (sortDirection !== undefined && sortDirection !== 'asc' && sortDirection !== 'desc')) {
    return fail('INVALID_QUERY', 'Invalid query fields.')
  }
  if (createdFrom !== undefined && createdTo !== undefined && createdFrom > createdTo) {
    return fail('INVALID_QUERY', 'The start time must not be after the end time.')
  }
  return { workOrder, createdFrom, createdTo, sortBy, sortDirection }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function snapshot(records: readonly InspectionRecord[], query: RecordQuery = {}): InspectionRecord[] {
  const needle = query.workOrder?.trim().toLowerCase() ?? ''
  const field = query.sortBy ?? 'createdAt'
  const direction = query.sortDirection === 'asc' ? 1 : -1
  // Canonical UTC timestamps have chronological string order. Sort a copied array only.
  return records
    .filter(record => record.workOrder.toLowerCase().includes(needle)
      && (query.createdFrom === undefined || record.createdAt >= query.createdFrom)
      && (query.createdTo === undefined || record.createdAt <= query.createdTo))
    .map(record => ({ ...record }))
    .sort((left, right) => direction * compareText(left[field], right[field]) || compareText(left.id, right.id))
}

function sameRecord(left: InspectionRecord, right: InspectionRecord): boolean {
  return RECORD_KEYS.every(key => left[key] === right[key])
}

function requireId(id: unknown): asserts id is string {
  if (!isRequiredText(id)) fail('INVALID_DATA', 'The record ID must be a nonblank string.')
}

/**
 * Owns one instance's official records and the fixed localStorage key.
 * No Vue, draft logic, ID generation, business-module calls or storage access until initialize.
 */
export function createRecordManager(): RecordManagerModule {
  let records: InspectionRecord[] | undefined
  let storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  let writing = false
  // Separate entries let each subscription be cancelled independently, even for the same callback.
  const subscribers = new Set<{ callback: (records: InspectionRecord[]) => void }>()

  function current(): InspectionRecord[] {
    if (records === undefined) return fail('NOT_INITIALIZED', 'Initialize the record manager before accessing records.')
    return records
  }

  function withWrite<T>(operation: (collection: InspectionRecord[]) => T): T {
    const collection = current()
    // Input getters can call back into M4 before commit, just like subscribers after commit.
    // Guard the entire operation so no nested write can be overwritten by an older collection.
    if (writing) return fail('INVALID_DATA', 'Nested record mutations are not allowed during a write.')
    writing = true
    try {
      return operation(collection)
    } finally {
      // Includes validation failures, idempotent returns, storage failures and notification dispatch.
      writing = false
    }
  }

  function notify(): void {
    // Called inside withWrite: read-only access remains available, nested writes remain rejected.
    // Snapshot subscriber membership for this dispatch; changes apply to subsequent dispatches.
    for (const { callback } of [...subscribers]) {
      try {
        callback(snapshot(current()))
      } catch (error: unknown) {
        // Persistence has already committed. Neither subscribers nor reporting may undo success.
        try { console.error('M4 record change subscriber failed:', error) } catch { /* Reporting is best effort. */ }
      }
    }
  }

  function commit(candidate: InspectionRecord[]): void {
    const prepared = readCollection(candidate, 'INVALID_DATA')
    let serialized: string
    try {
      serialized = JSON.stringify(prepared)
    } catch {
      return fail('STORAGE_WRITE_FAILED', 'Failed to serialize records before writing.')
    }
    if (storage === undefined) return fail('NOT_INITIALIZED', 'Record storage has not been initialized.')
    try {
      storage.setItem(STORAGE_KEY, serialized)
    } catch {
      return fail('STORAGE_WRITE_FAILED', 'Failed to write records to localStorage.')
    }
    // setItem returning normally is the commit boundary; notification errors stay outside its catch.
    records = prepared
    notify()
  }

  return {
    /** Load and validate the entire collection once. Failure preserves storage and the initialization gate. */
    initialize() {
      if (records !== undefined) return snapshot(records)
      let available: Pick<Storage, 'getItem' | 'setItem'>
      try {
        const candidate = globalThis.localStorage
        if (!candidate || typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function') {
          throw new Error('localStorage is unavailable')
        }
        available = candidate
      } catch {
        return fail('STORAGE_UNAVAILABLE', 'localStorage is unavailable.')
      }
      let raw: string | null
      try {
        raw = available.getItem(STORAGE_KEY)
      } catch {
        return fail('STORAGE_READ_FAILED', 'Failed to read records from localStorage.')
      }
      let parsed: unknown = []
      if (raw !== null) {
        try {
          parsed = JSON.parse(raw) as unknown
        } catch {
          return fail('STORAGE_DATA_CORRUPTED', 'Stored records are not valid JSON.')
        }
      }
      const prepared = readCollection(parsed, 'STORAGE_DATA_CORRUPTED')
      storage = available
      records = prepared
      return snapshot(records)
    },

    /** Persist a complete record; first-save timestamps must match. Equal IDs require identical persisted fields. */
    save(record) {
      return withWrite(collection => {
        const input = readRecord(record, 'INVALID_DATA')
        const existing = collection.find(item => item.id === input.id)
        if (existing) {
          if (!sameRecord(existing, input)) return fail('DUPLICATE_ID', 'A different record already uses this ID.')
          return { ...existing }
        }
        // Historical records can have later updatedAt values; only a new ID requires equality.
        if (input.createdAt !== input.updatedAt) return fail('INVALID_DATA', 'New records must have matching creation and update timestamps.')
        commit([...collection, input])
        return { ...input }
      })
    },

    /** Return an independent snapshot in default createdAt DESC, id ASC order. */
    getAll() { return snapshot(current()) },

    /** Match an unmodified nonblank ID; absence is a normal null result. */
    getById(id) {
      const collection = current()
      requireId(id)
      const found = collection.find(record => record.id === id)
      return found ? { ...found } : null
    },

    /** Apply AND filters and deterministic sorting to a snapshot without changing official records. */
    query(query) {
      const collection = current()
      return snapshot(collection, readQuery(query))
    },

    /** Accept only InspectionFields; unchanged values never write, notify or advance updatedAt. */
    update(id, changes) {
      return withWrite(collection => {
        requireId(id)
        if (!isObject(changes) || !hasOnlyKeys(changes, FIELD_KEYS)) {
          return fail('INVALID_DATA', 'Updates may contain only InspectionFields.')
        }
        const existing = collection.find(record => record.id === id)
        if (!existing) return fail('RECORD_NOT_FOUND', 'The record does not exist.')
        // Copy all own allowed fields, including non-enumerable ones, and validate before any mutation.
        const merged = { ...existing }
        for (const key of FIELD_KEYS) {
          if (Object.hasOwn(changes, key)) Object.assign(merged, { [key]: changes[key] })
        }
        const updated = readRecord(merged, 'INVALID_DATA')
        if (sameRecord(existing, updated)) return { ...existing }
        updated.updatedAt = new Date(Math.max(Date.now(), Date.parse(existing.updatedAt))).toISOString()
        commit(collection.map(record => record.id === id ? updated : record))
        return { ...updated }
      })
    },

    /** Delete only after the replacement collection is persisted; a missing ID is an idempotent false. */
    delete(id) {
      return withWrite(collection => {
        requireId(id)
        if (!collection.some(record => record.id === id)) return false
        commit(collection.filter(record => record.id !== id))
        return true
      })
    },

    /** Subscribe before or after initialization. Each delivery is isolated; cancellation is idempotent. */
    onRecordsChange(callback) {
      if (typeof callback !== 'function') throw new TypeError('The record change subscriber must be a function.')
      const subscription = { callback }
      subscribers.add(subscription)
      return () => { subscribers.delete(subscription) }
    },
  }
}
