import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'

/** Every paid attempt is committed before dialing; uncertain failures are never refunded. */
export class Quota {
  private readonly db: DatabaseSync
  constructor(path: string, private readonly daily: number, private readonly monthly: number, initialize = false) {
    if (![daily, monthly].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid quota.')
    if (!initialize && !existsSync(path)) throw new Error('Quota ledger is missing.')
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA busy_timeout = 5000')
    if (!initialize) {
      try {
        this.db.prepare('SELECT period, used FROM usage LIMIT 1').get()
        this.db.prepare('SELECT day FROM clock LIMIT 1').get()
        if (this.db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('Invalid ledger.')
      } catch (error) { this.db.close(); throw error }
    }
    this.db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL')
    this.db.exec('CREATE TABLE IF NOT EXISTS usage (period TEXT PRIMARY KEY, used INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS clock (id INTEGER PRIMARY KEY CHECK(id=1), day TEXT NOT NULL)')
  }
  reserve(now = new Date()): boolean {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    const periods = [[`day:${day}`, this.daily], [`month:${day.slice(0, 7)}`, this.monthly]] as const
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const allowed = (() => {
      const clock = this.db.prepare('SELECT day FROM clock WHERE id=1').get() as { day: string } | undefined
      if (clock && day < clock.day) return false // Do not mint quota after a clock rollback.
      for (const [period, limit] of periods) {
        const row = this.db.prepare('SELECT used FROM usage WHERE period=?').get(period) as { used: number } | undefined
        if ((row?.used ?? 0) >= limit) return false
      }
      this.db.prepare('INSERT INTO clock VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET day=excluded.day').run(day)
      for (const [period] of periods) this.db.prepare('INSERT INTO usage VALUES (?, 1) ON CONFLICT(period) DO UPDATE SET used=used+1').run(period)
      return true
      })()
      this.db.exec('COMMIT')
      return allowed
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  close(): void { this.db.close() }
}

/** Bounded keys and expiry prevent anonymous identifiers from exhausting memory. */
export class RateWindow {
  private readonly entries = new Map<string, { count: number; until: number }>()
  constructor(private readonly limit: number, private readonly capacity = 4096) {}
  allow(key: string, now = Date.now()): boolean {
    for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id)
    let entry = this.entries.get(key)
    if (!entry) {
      if (this.entries.size >= this.capacity) return false
      entry = { count: 0, until: now + 60_000 }; this.entries.set(key, entry)
    }
    return ++entry.count <= this.limit
  }
}
