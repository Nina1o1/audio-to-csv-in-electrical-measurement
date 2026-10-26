import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordManagerModule, RecordQuery, RecordUpdate } from '../../../src/contracts/m4-record-manager'
import type { InspectionRecord } from '../../../src/shared/data-models'
import { createRecordManager } from '../../../src/modules/m4-record-manager'

const KEY = 'inspection-records'
const TIME = '2026-10-26T01:30:00.000Z'

function record(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    id: 'r-1', workOrder: 'WO-001', partNumber: 'P-007', contactResistance: 0,
    insulationResistance: 200, withstandVoltage: 1500, result: 'PASS',
    createdAt: TIME, updatedAt: TIME, ...overrides,
  }
}

// Only the browser storage boundary is replaced; assertions use the public module API.
function storageWith(raw: string | null = null) {
  const data = new Map<string, string>()
  if (raw !== null) data.set(KEY, raw)
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value) }),
  }
  vi.stubGlobal('localStorage', storage)
  return { ...storage, data }
}

function ready(records: InspectionRecord[] = []) {
  const storage = storageWith(JSON.stringify(records))
  const manager = createRecordManager()
  manager.initialize()
  return { manager, storage }
}

function expectCode(operation: () => unknown, code: string) {
  let caught: unknown
  try { operation() } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(Error)
  expect(caught).toMatchObject({ code })
}

// Deliberately malformed runtime inputs must cross the static type boundary in tests.
const asRecord = (value: unknown) => value as InspectionRecord
const asQuery = (value: unknown) => value as RecordQuery
const asUpdate = (value: unknown) => value as RecordUpdate

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TIME)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('M4 initialization and storage protection', () => {
  it('creates an isolated instance without accessing storage; absent key initializes without writing', () => {
    const storage = storageWith()
    storage.data.set('inspection-records:v1', JSON.stringify([record()]))
    const manager = createRecordManager()
    expect(storage.getItem).not.toHaveBeenCalled()
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    expect(manager.initialize()).toEqual([])
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(KEY)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    expect(storage.data.get('inspection-records:v1')).toBe(JSON.stringify([record()]))
  })

  it('loads the entire collection, isolates snapshots and does not reread on repeated initialize', () => {
    const storage = storageWith(JSON.stringify([record()]))
    const manager = createRecordManager()
    const snapshot = manager.initialize()
    snapshot[0]!.partNumber = 'external'
    snapshot.push(record({ id: 'external' }))
    storage.data.set(KEY, 'broken')
    expect(manager.initialize()).toEqual([record()])
    expect(storage.getItem).toHaveBeenCalledTimes(1)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  const corruptValues: unknown[] = [
    null, {}, { records: [record()] }, [null], [record(), record()], [record(), { ...record({ id: 'invalid' }), result: null }],
    [{ ...record(), partNumber: null }], [{ ...record(), extra: 'forbidden' }],
    [{ ...record(), createdAt: '2026-02-30T01:30:00.000Z' }],
    [{ ...record(), updatedAt: '2026-10-25T01:30:00.000Z' }],
  ]
  it.each(['', '{broken', ...corruptValues.map(value => JSON.stringify(value))])(
    'rejects corrupt storage %j, preserves its exact contents and blocks all business operations', raw => {
      const storage = storageWith(raw)
      const manager = createRecordManager()
      expectCode(() => manager.initialize(), 'STORAGE_DATA_CORRUPTED')
      assertUninitialized(manager)
      expect(storage.data.get(KEY)).toBe(raw)
      expect(storage.setItem).not.toHaveBeenCalled()
    },
  )

  it('blocks all queries and writes before initialization', () => {
    storageWith()
    assertUninitialized(createRecordManager())
  })

  it('reports unavailable storage without trying to write', () => {
    vi.stubGlobal('localStorage', undefined)
    const manager = createRecordManager()
    expectCode(() => manager.initialize(), 'STORAGE_UNAVAILABLE')
    assertUninitialized(manager)
  })

  it('reports a storage getter failure as unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('denied') } })
    try {
      expectCode(() => createRecordManager().initialize(), 'STORAGE_UNAVAILABLE')
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else Reflect.deleteProperty(globalThis, 'localStorage')
    }
  })

  it('rejects reads, allows retry after external repair, and never partially loads', () => {
    const storage = storageWith(JSON.stringify([record()]))
    storage.getItem.mockImplementation(() => { throw new Error('read failed') })
    const manager = createRecordManager()
    expectCode(() => manager.initialize(), 'STORAGE_READ_FAILED')
    assertUninitialized(manager)
    storage.getItem.mockImplementation(key => storage.data.get(key) ?? null)
    expect(manager.initialize()).toEqual([record()])
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('allows reinitialization after corrupt data is repaired externally', () => {
    const storage = storageWith('broken')
    const manager = createRecordManager()
    expectCode(() => manager.initialize(), 'STORAGE_DATA_CORRUPTED')
    storage.data.set(KEY, JSON.stringify([record()]))
    expect(manager.initialize()).toEqual([record()])
  })
})

function assertUninitialized(manager: RecordManagerModule) {
  const operations = [
    () => manager.getAll(), () => manager.getById('r-1'), () => manager.query({}),
    () => manager.save(record()), () => manager.update('r-1', {}), () => manager.delete('r-1'),
  ]
  for (const operation of operations) expectCode(operation, 'NOT_INITIALIZED')
}

describe('M4 record validation and save identity', () => {
  it('persists exactly nine fields, accepts zero and preserves identifier text and supplied identity', () => {
    const { manager, storage } = ready()
    const input = Object.freeze(record({ workOrder: ' aB-007 X ', result: 'FAIL' }))
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    const saved = manager.save(input)
    expect(saved).toEqual(input)
    expect(saved).not.toBe(input)
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(KEY, JSON.stringify([input]))
    expect(Object.keys(saved)).toHaveLength(9)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(manager.getAll()).toEqual([input])
  })

  const invalidRecords: unknown[] = [
    null, undefined, [], {}, 'record',
    ...['id', 'workOrder', 'partNumber', 'contactResistance', 'insulationResistance', 'withstandVoltage', 'result', 'createdAt', 'updatedAt']
      .map(key => { const value: Record<string, unknown> = { ...record() }; delete value[key]; return value }),
    ...['id', 'workOrder', 'partNumber'].flatMap(key => ['', ' \t ', null, 123].map(value => ({ ...record(), [key]: value }))),
    ...['contactResistance', 'insulationResistance', 'withstandVoltage'].flatMap(key =>
      [-1, NaN, Infinity, -Infinity, '12', null, undefined].map(value => ({ ...record(), [key]: value }))),
    ...['pass', 'UNKNOWN', null].map(result => ({ ...record(), result })),
    ...['2026-02-30T00:00:00.000Z', '2026-10-26T01:30:00Z', '2026-10-26T09:30:00.000+08:00', 'invalid']
      .flatMap(value => [{ ...record(), createdAt: value }, { ...record(), updatedAt: value }]),
    { ...record(), updatedAt: '2026-10-25T01:30:00.000Z' },
    { ...record(), unit: 'V' },
  ]
  it.each(invalidRecords.map((value, index) => ({ value, index })))('rejects invalid record case $index atomically', ({ value }) => {
    const { manager, storage } = ready([record({ id: 'existing' })])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    const before = storage.data.get(KEY)
    expectCode(() => manager.save(asRecord(value)), 'INVALID_DATA')
    expect(manager.getAll()).toEqual([record({ id: 'existing' })])
    expect(storage.data.get(KEY)).toBe(before)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })

  it('accepts a valid leap day and large finite fractional measurements without rounding', () => {
    const { manager } = ready()
    const input = record({ createdAt: '2024-02-29T23:59:59.999Z', updatedAt: '2024-02-29T23:59:59.999Z', contactResistance: Number.MAX_VALUE, withstandVoltage: 0.123456789 })
    expect(manager.save(input)).toEqual(input)
  })

  it('treats equal persisted fields as idempotent regardless of property order', () => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    const { id, ...rest } = record()
    expect(manager.save({ ...rest, id })).toEqual(record())
    expect(manager.save(record())).not.toBe(manager.getById(id))
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })

  it.each([
    { workOrder: 'different' }, { partNumber: 'different' }, { contactResistance: 1 },
    { insulationResistance: 1 }, { withstandVoltage: 1 }, { result: 'FAIL' as const },
    { createdAt: '2026-10-25T00:00:00.000Z' }, { updatedAt: '2026-10-27T00:00:00.000Z' },
  ])('rejects a same-ID conflict %j', changes => {
    const { manager, storage } = ready([record()])
    expectCode(() => manager.save(record(changes)), 'DUPLICATE_ID')
    expect(manager.getAll()).toEqual([record()])
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})

describe('M4 review regressions: first-save time and input reentrancy', () => {
  it('rejects unequal first-save timestamps atomically and permits a valid retry', () => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    const before = storage.data.get(KEY)
    expectCode(() => manager.save(record({ id: 'new', updatedAt: '2026-10-27T00:00:00.000Z' })), 'INVALID_DATA')
    expect(manager.getAll()).toEqual([record()])
    expect(storage.data.get(KEY)).toBe(before)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    expect(manager.save(record({ id: 'new' }))).toEqual(record({ id: 'new' }))
  })

  it('loads, idempotently saves and updates existing history with unequal timestamps', () => {
    const existing = record({ createdAt: '2026-10-25T00:00:00.000Z' })
    const { manager, storage } = ready([existing])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    expect(manager.save(existing)).toEqual(existing)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    vi.setSystemTime('2026-10-27T00:00:00.000Z')
    const updated = manager.update(existing.id, { partNumber: 'changed' })
    expect(updated.createdAt).toBe(existing.createdAt)
    expect(updated.updatedAt).toBe('2026-10-27T00:00:00.000Z')
    expect(manager.save(updated)).toEqual(updated)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  const reentrantCases = (['save', 'update'] as const).flatMap(outer =>
    (['save', 'update', 'delete'] as const).map(nested => ({ outer, nested })))
  it.each(reentrantCases)('rejects nested $nested from a $outer getter without losing records', ({ outer, nested }) => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    const errors: unknown[] = []
    const reads: InspectionRecord[][] = []
    const input = {
      get partNumber() {
        reads.push(manager.getAll())
        try {
          if (nested === 'save') manager.save(record({ id: 'inner' }))
          else if (nested === 'update') manager.update('r-1', { workOrder: 'inner' })
          else manager.delete('r-1')
        } catch (error) { errors.push(error) }
        return 'outer-part'
      },
    }
    // Preserve the getter: spreading input would execute it before entering M4.
    const result = outer === 'save'
      ? manager.save(Object.defineProperty(record({ id: 'outer' }), 'partNumber', Object.getOwnPropertyDescriptor(input, 'partNumber')!))
      : manager.update('r-1', input)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    expect(errors[0]).toMatchObject({ code: 'INVALID_DATA' })
    expect(reads).toEqual([[record()]])
    const expected = outer === 'save'
      ? [record({ id: 'outer', partNumber: 'outer-part' }), record()]
      : [record({ partNumber: 'outer-part' })]
    expect(result.partNumber).toBe('outer-part')
    expect(manager.getAll()).toEqual(expected)
    expect(JSON.parse(storage.data.get(KEY)!)).toEqual(expect.arrayContaining(expected))
    expect(JSON.parse(storage.data.get(KEY)!)).toHaveLength(expected.length)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledExactlyOnceWith(expected)
    expect(manager.save(record({ id: 'after' })).id).toBe('after')
  })

  it.each(['save', 'update'] as const)('aborts outer %s on a propagated nested-write rejection, then releases the guard', outer => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    const before = storage.data.get(KEY)
    const input = {
      get partNumber(): string {
        manager.save(record({ id: 'inner' }))
        return 'unreachable'
      },
    }
    const invoke = () => outer === 'save'
      ? manager.save(Object.defineProperty(record({ id: 'outer' }), 'partNumber', Object.getOwnPropertyDescriptor(input, 'partNumber')!))
      : manager.update('r-1', input)
    expectCode(invoke, 'INVALID_DATA')
    expect(manager.getAll()).toEqual([record()])
    expect(storage.data.get(KEY)).toBe(before)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    expect(manager.delete('r-1')).toBe(true)
  })

  it('releases the guard after no-ops, conflicts, missing records and invalid updates', () => {
    const { manager } = ready([record()])
    expect(manager.save(record())).toEqual(record())
    expect(manager.update('r-1', {})).toEqual(record())
    expect(manager.delete('missing')).toBe(false)
    expectCode(() => manager.save(record({ partNumber: 'conflict' })), 'DUPLICATE_ID')
    expectCode(() => manager.update('missing', {}), 'RECORD_NOT_FOUND')
    expectCode(() => manager.update('r-1', { contactResistance: -1 }), 'INVALID_DATA')
    expect(manager.save(record({ id: 'after' })).id).toBe('after')
  })
})

describe('M4 update and delete', () => {
  it('updates every allowed field, preserves identity and uses current time only for an actual change', () => {
    const { manager, storage } = ready([record()])
    const now = '2026-10-27T00:00:00.000Z'
    vi.setSystemTime(now)
    const changes = Object.freeze({ workOrder: ' NEW ', partNumber: 'new', contactResistance: 1.2, insulationResistance: 0, withstandVoltage: 0, result: 'FAIL' as const })
    const result = manager.update('r-1', changes)
    expect(result).toEqual({ ...record(), ...changes, updatedAt: now })
    expect(JSON.parse(storage.data.get(KEY)!)).toEqual([result])
    result.partNumber = 'external'
    expect(manager.getById('r-1')?.partNumber).toBe('new')
  })

  it('does not write, timestamp or notify on empty or identical changes', () => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    vi.setSystemTime('2026-10-27T00:00:00.000Z')
    expect(manager.update('r-1', {})).toEqual(record())
    expect(manager.update('r-1', { workOrder: 'WO-001', contactResistance: 0 })).toEqual(record())
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })

  it('does not move updatedAt backwards when the device clock rolls back', () => {
    const { manager } = ready([record()])
    vi.setSystemTime('2025-01-01T00:00:00.000Z')
    expect(manager.update('r-1', { partNumber: 'changed' }).updatedAt).toBe(TIME)
  })

  it.each([
    null, [], 'changes', { id: 'new' }, { createdAt: TIME }, { updatedAt: TIME },
    { other: 1 }, { partNumber: 'allowed', id: 'forbidden' }, { result: 'unknown' },
    { workOrder: '' }, { insulationResistance: -1 }, { partNumber: undefined },
    { contactResistance: '12' }, { withstandVoltage: null },
  ])('rejects an illegal update %j without partial changes', changes => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    expectCode(() => manager.update('r-1', asUpdate(changes)), 'INVALID_DATA')
    expect(manager.getById('r-1')).toEqual(record())
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })

  it('reports missing updates; missing and repeated deletes return false without writing', () => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    expectCode(() => manager.update('missing', {}), 'RECORD_NOT_FOUND')
    expect(manager.delete('missing')).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(manager.delete('r-1')).toBe(true)
    expect(manager.delete('r-1')).toBe(false)
    expect(manager.getById('r-1')).toBeNull()
    expect(manager.getAll()).toEqual([])
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(KEY, '[]')
    expect(callback).toHaveBeenCalledExactlyOnceWith([])
  })

  it.each([undefined, null, 1, '', ' \t '])('rejects illegal IDs %j in reads, updates and deletes', value => {
    const { manager, storage } = ready([record()])
    const id = value as string
    for (const operation of [() => manager.getById(id), () => manager.update(id, {}), () => manager.delete(id)]) {
      expectCode(operation, 'INVALID_DATA')
    }
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('matches IDs exactly without trimming', () => {
    const { manager } = ready([record({ id: ' r-1 ' })])
    expect(manager.getById('r-1')).toBeNull()
    expect(manager.getById(' r-1 ')?.id).toBe(' r-1 ')
  })
})

describe('M4 persistence commit boundary', () => {
  it.each(['save', 'update', 'delete'] as const)('%s does not commit or notify when setItem fails, and can be retried', operation => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    const before = storage.data.get(KEY)
    storage.setItem.mockImplementation(() => { throw new Error('quota') })
    const mutate = () => {
      if (operation === 'save') return manager.save(record({ id: 'r-2' }))
      if (operation === 'update') return manager.update('r-1', { partNumber: 'new' })
      return manager.delete('r-1')
    }
    expectCode(mutate, 'STORAGE_WRITE_FAILED')
    expect(manager.getAll()).toEqual([record()])
    expect(storage.data.get(KEY)).toBe(before)
    expect(callback).not.toHaveBeenCalled()
    storage.setItem.mockImplementation((key, value) => {
      // Reads during the storage call must still see the previous committed collection.
      expect(manager.getAll()).toEqual([record()])
      storage.data.set(key, value)
    })
    mutate()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(manager.getAll()).toEqual(JSON.parse(storage.data.get(KEY)!))
  })

  it('reports serialization failure before attempting storage and leaves state untouched', () => {
    const { manager, storage } = ready([record()])
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    vi.spyOn(JSON, 'stringify').mockImplementation(() => { throw new Error('serialize') })
    expectCode(() => manager.save(record({ id: 'r-2' })), 'STORAGE_WRITE_FAILED')
    expect(manager.getAll()).toEqual([record()])
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })

  it('new instances reload persisted data and have independent memory snapshots', () => {
    const { manager } = ready()
    manager.save(record())
    const fresh = createRecordManager()
    expect(fresh.initialize()).toEqual([record()])
    fresh.update('r-1', { partNumber: 'new' })
    expect(manager.initialize()).toEqual([record()])
    expect(fresh.getById('r-1')?.partNumber).toBe('new')
  })
})

describe('M4 query and snapshot immutability', () => {
  const rows = [
    record({ id: 'z', workOrder: 'A2', createdAt: '2026-10-25T00:00:00.000Z' }),
    record({ id: 'b', workOrder: 'A10' }),
    record({ id: 'a', workOrder: 'A10' }),
    record({ id: 'c', workOrder: 'a10' }),
  ]
  it('defaults to createdAt descending, keeps ID ascending on ties and returns null for missing ID', () => {
    const { manager } = ready(rows)
    expect(manager.getAll().map(row => row.id)).toEqual(['a', 'b', 'c', 'z'])
    expect(manager.query({})).toEqual(manager.getAll())
    expect(manager.getById('missing')).toBeNull()
  })

  it.each([
    ['createdAt', 'asc', ['z', 'a', 'b', 'c']],
    ['createdAt', 'desc', ['a', 'b', 'c', 'z']],
    ['workOrder', 'asc', ['a', 'b', 'z', 'c']],
    ['workOrder', 'desc', ['c', 'z', 'a', 'b']],
  ] as const)('sorts %s %s deterministically without mutating memory or storage', (sortBy, sortDirection, ids) => {
    const { manager, storage } = ready(rows)
    const before = manager.getAll()
    const raw = storage.data.get(KEY)
    expect(manager.query(Object.freeze({ sortBy, sortDirection })).map(row => row.id)).toEqual(ids)
    expect(manager.getAll()).toEqual(before)
    expect(storage.data.get(KEY)).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('combines case-insensitive substring and inclusive UTC boundaries with AND', () => {
    const { manager } = ready(rows)
    expect(manager.query({ workOrder: '  a1  ', createdFrom: TIME, createdTo: TIME }).map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(manager.query({ workOrder: 'A2', createdFrom: TIME })).toEqual([])
    expect(manager.query({ workOrder: 'missing' })).toEqual([])
    expect(manager.query({ workOrder: ' \t ' })).toEqual(manager.getAll())
    expect(manager.query({ createdTo: '2026-10-25T00:00:00.000Z' }).map(row => row.id)).toEqual(['z'])
    expect(manager.query({ workOrder: undefined, sortBy: undefined, sortDirection: undefined })).toEqual(manager.getAll())
  })

  it.each([
    null, undefined, [], 'query', { extra: true }, { workOrder: 1 }, { workOrder: null },
    { createdFrom: null }, { createdTo: '' }, { sortBy: 'id' }, { sortDirection: 'ASC' },
    { createdFrom: '2026-02-30T00:00:00.000Z' }, { createdTo: '2026-10-26T01:30:00Z' },
    { createdFrom: TIME, createdTo: '2026-10-25T00:00:00.000Z' },
  ])('rejects illegal query %j with no side effects', query => {
    const { manager, storage } = ready(rows)
    const before = manager.getAll()
    expectCode(() => manager.query(asQuery(query)), 'INVALID_QUERY')
    expect(manager.getAll()).toEqual(before)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('isolates save inputs, all returned records and arrays from subsequent external mutations', () => {
    const { manager } = ready()
    const input = record()
    const saved = manager.save(input)
    input.workOrder = 'input changed'
    saved.workOrder = 'saved changed'
    const byId = manager.getById('r-1')!
    byId.workOrder = 'lookup changed'
    const all = manager.getAll()
    all[0]!.partNumber = 'all changed'
    all.length = 0
    const queried = manager.query({})
    queried[0]!.result = 'FAIL'
    queried.push(record({ id: 'outside' }))
    expect(manager.getAll()).toEqual([record()])
  })
})

describe('M4 notification isolation and reentrancy', () => {
  it('reports a throwing subscriber separately, notifies others and returns successful mutations', () => {
    const { manager, storage } = ready()
    const error = new Error('subscriber')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    manager.onRecordsChange(() => { throw error })
    const next = vi.fn()
    manager.onRecordsChange(next)
    expect(manager.save(record())).toEqual(record())
    expect(manager.update('r-1', { partNumber: 'new' }).partNumber).toBe('new')
    expect(manager.delete('r-1')).toBe(true)
    expect(report).toHaveBeenCalledTimes(3)
    expect(report).toHaveBeenCalledWith(expect.any(String), error)
    expect(next).toHaveBeenCalledTimes(3)
    expect(storage.data.get(KEY)).toBe('[]')
  })

  it('even a failing error reporter cannot turn a committed save into a failure', () => {
    const { manager } = ready()
    vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('reporter') })
    manager.onRecordsChange(() => { throw new Error('subscriber') })
    const next = vi.fn()
    manager.onRecordsChange(next)
    expect(manager.save(record())).toEqual(record())
    expect(next).toHaveBeenCalledOnce()
  })

  it('gives each subscriber an independent snapshot and permits reads of committed data', () => {
    const { manager, storage } = ready()
    manager.onRecordsChange(snapshot => { snapshot[0]!.workOrder = 'external'; snapshot.length = 0 })
    const observations: unknown[] = []
    const next = vi.fn((snapshot: InspectionRecord[]) => {
      // Assert outside the callback: subscriber exceptions are intentionally contained by M4.
      observations.push(snapshot, manager.getAll(), manager.getById('r-1'), manager.query({}),
        manager.initialize(), JSON.parse(storage.data.get(KEY)!))
    })
    manager.onRecordsChange(next)
    manager.save(record())
    expect(next).toHaveBeenCalledOnce()
    expect(observations).toEqual([[record()], [record()], record(), [record()], [record()], [record()]])
    expect(manager.getAll()).toEqual([record()])
  })

  it('contains an uncaught reentrant-write error and can write again after dispatch', () => {
    const { manager, storage } = ready()
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cancel = manager.onRecordsChange(() => { manager.delete('r-1') })
    const next = vi.fn()
    manager.onRecordsChange(next)
    expect(manager.save(record())).toEqual(record())
    expect(report).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'INVALID_DATA' }))
    expect(next).toHaveBeenCalledExactlyOnceWith([record()])
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    cancel()
    expect(manager.delete('r-1')).toBe(true)
    expect(next).toHaveBeenLastCalledWith([])
  })

  it('rejects nested writes including no-ops, and restores the guard after notifications', () => {
    const { manager, storage } = ready()
    const nested: (() => unknown)[] = [
      () => manager.save(record({ id: 'nested' })), () => manager.save(record()),
      () => manager.update('r-1', {}), () => manager.delete('missing'), () => manager.delete('r-1'),
    ]
    const errors: unknown[] = []
    const unsubscribe = manager.onRecordsChange(() => {
      for (const operation of nested) {
        try { operation() } catch (error) { errors.push(error) }
      }
    })
    manager.save(record())
    expect(errors).toHaveLength(nested.length)
    for (const error of errors) expect(error).toMatchObject({ code: 'INVALID_DATA' })
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(manager.update('r-1', { partNumber: 'after' }).partNumber).toBe('after')
  })

  it('allows subscription before initialization and makes cancellation idempotent', () => {
    storageWith()
    const manager = createRecordManager()
    const first = vi.fn()
    const second = vi.fn()
    const cancel = manager.onRecordsChange(first)
    manager.onRecordsChange(second)
    manager.initialize()
    manager.getAll()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    cancel()
    cancel()
    manager.save(record())
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('cancels duplicate callback subscriptions independently', () => {
    const { manager } = ready()
    const callback = vi.fn()
    const cancelFirst = manager.onRecordsChange(callback)
    manager.onRecordsChange(callback)
    cancelFirst()
    manager.save(record())
    expect(callback).toHaveBeenCalledExactlyOnceWith([record()])
  })

  it('rejects non-function subscribers without changing subscriptions', () => {
    const { manager } = ready()
    expect(() => manager.onRecordsChange(null as unknown as (records: InspectionRecord[]) => void)).toThrow(TypeError)
    const callback = vi.fn()
    manager.onRecordsChange(callback)
    manager.save(record())
    expect(callback).toHaveBeenCalledOnce()
  })
})
