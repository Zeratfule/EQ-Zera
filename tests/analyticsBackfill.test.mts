// THE COPY-FIRST COHORT MIGRATION (scripts/analyticsBackfill.mts) — "we shouldn't drop anything".
//
// The live cluster carries the PRE-COHORT counter tables (the v0.4.0 smoke proved it: `column
// "cohort" does not exist`), and those counters have been accumulating behind a lit client since
// 2026-08-04 — so they may hold real users' rows. The old runbook said DROP and re-migrate. This
// path copies instead, and the assertions below are the properties that make that trustworthy:
//
//   1. THE STAGING SHAPE COMES FROM schema.sql, so the table the rows land in cannot drift from
//      the table the app reads. A schema whose PRIMARY KEY lost `cohort` is refused outright.
//   2. THE COHORT IS DERIVED FROM STATED FACTS — the install's channel and its hand mark — and
//      the fail-safe direction is 'user'. A day a real user could have contributed to is never
//      relabelled as the owner's.
//   3. NOTHING IS DROPPED BEFORE A VERIFIED COPY. The swap re-runs the verification itself and
//      refuses on any mismatch, having touched nothing; on success it emits DROP then RENAME in
//      that order, per table.
//   4. IT IS RE-RUNNABLE at every stage, including a swap interrupted between its two statements.
//
// Driven by a small in-memory fake of `Clients` — every statement the module issues really runs
// against it, so the SQL itself (column lists, parameter order, paging) is under test. No AWS,
// no cluster, no credentials; never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BACKFILL_TABLES,
  PAGE,
  cohortForDay,
  copyTable,
  runBackfill,
  runSwap,
  spanOf,
  stagingDdl,
  verifyTables,
  type InstallSpan
} from '../scripts/analyticsBackfill.mjs'
import type { Clients, Row } from '../src/main/triage/store'

const SCHEMA = readFileSync(join(import.meta.dirname, '..', 'infra', 'schema.sql'), 'utf8')
const USAGE = BACKFILL_TABLES[0]
const FUNNEL = BACKFILL_TABLES[1]

// ---- the in-memory cluster ---------------------------------------------------------------

interface Fake {
  clients: Clients
  tables: Map<string, Row[]>
  ddl: string[]
  telemetryAccepting: boolean
}

const KEYLESS = new Set(['n'])

function undefinedTable(name: string): Error {
  return Object.assign(new Error(`relation "${name}" does not exist`), { code: '42P01' })
}

/**
 * Enough postgres to run this module's statements, and nothing else. Rows come back in INSERTION
 * order (`ORDER BY` is parsed and ignored — the module's paging only needs a stable order), and
 * a table "has" the `cohort` column iff it was created from the cohort-keyed DDL, which is what
 * makes the `42703` probe answerable.
 */
function fakeCluster(seed: Record<string, Row[]>): Fake {
  const tables = new Map<string, Row[]>(Object.entries(seed).map(([k, v]) => [k, [...v]]))
  const cohorted = new Set(Object.keys(seed).filter((k) => k.endsWith('_v2')))
  const ddl: string[] = []
  const state = { telemetryAccepting: false }
  const rowsOf = (name: string): Row[] => {
    const t = tables.get(name)
    if (!t) throw undefinedTable(name)
    return t
  }
  /** DDL. `null` means "not one of mine", which is how the three halves chain. */
  const runDdl = (text: string): Row[] | null => {
    let m = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(text)
    if (m) {
      ddl.push(text)
      if (!tables.has(m[1])) tables.set(m[1], [])
      if (/\bcohort\b/.test(text)) cohorted.add(m[1])
      return []
    }
    if (/^GRANT /.test(text)) {
      ddl.push(text)
      return []
    }
    m = /^DROP TABLE (\w+)$/.exec(text)
    if (m) {
      ddl.push(text)
      rowsOf(m[1])
      tables.delete(m[1])
      cohorted.delete(m[1])
      return []
    }
    m = /^ALTER TABLE (\w+) RENAME TO (\w+)$/.exec(text)
    if (!m) return null
    ddl.push(text)
    tables.set(m[2], rowsOf(m[1]))
    tables.delete(m[1])
    // Postgres renames the OBJECT; its columns (and its grants) come with it.
    if (cohorted.delete(m[1])) cohorted.add(m[2])
    return []
  }

  const runRead = (text: string, params: unknown[]): Row[] | null => {
    if (/^SELECT telemetry_accepting FROM feedback_config/.test(text)) {
      return [{ telemetry_accepting: state.telemetryAccepting }]
    }
    let m = /^SELECT cohort FROM (\w+) LIMIT 1$/.exec(text)
    if (m) {
      const rows = rowsOf(m[1])
      if (cohorted.has(m[1])) return rows.slice(0, 1)
      throw Object.assign(new Error('column "cohort" does not exist'), { code: '42703' })
    }
    m = /^SELECT 1 FROM (\w+) LIMIT 1$/.exec(text)
    if (m) return rowsOf(m[1]).slice(0, 1)
    m = /^SELECT count\(\*\) AS rows, COALESCE\(sum\(n\), 0\) AS total FROM (\w+)$/.exec(text)
    if (m) {
      const rows = rowsOf(m[1])
      // NUMERIC comes back from node-postgres as a STRING; the module's `big()` is what copes.
      return [{ rows: rows.length, total: String(rows.reduce((sum, r) => sum + Number(r.n ?? 0), 0)) }]
    }
    m = /^SELECT (.+) FROM (\w+) ORDER BY .+ LIMIT \$1 OFFSET \$2$/.exec(text)
    if (!m) return null
    const cols = m[1].split(',').map((s) => s.trim())
    const page = rowsOf(m[2]).slice(Number(params[1]), Number(params[1]) + Number(params[0]))
    return page.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])))
  }

  const runWrite = (text: string, params: unknown[]): Row[] | null => {
    let m = /^UPDATE analytics_install SET cohort = \$1 WHERE cohort IS NULL AND analytics_id = ANY/.exec(text)
    if (m) {
      const ids = params[1] as string[]
      const hit = rowsOf('analytics_install').filter((r) => r.cohort === null && ids.includes(String(r.analytics_id)))
      for (const r of hit) r.cohort = params[0]
      return hit
    }
    m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES .* ON CONFLICT \(([^)]+)\) DO UPDATE SET n = EXCLUDED\.n$/.exec(text)
    if (!m) return null
    const cols = m[2].split(',').map((s) => s.trim())
    const dest = rowsOf(m[1])
    const written: Row[] = []
    for (let i = 0; i < params.length; i += cols.length) {
      const row = Object.fromEntries(cols.map((c, k) => [c, params[i + k]]))
      // ON CONFLICT: the key is every column but `n`, and the action is ASSIGNMENT.
      const same = dest.find((d) => cols.every((c) => KEYLESS.has(c) || d[c] === row[c]))
      if (same) same.n = row.n
      else dest.push(row)
      written.push(row)
    }
    return written
  }

  const run = (sql: string, params: unknown[]): Row[] => {
    const text = sql.replace(/\s+/g, ' ').trim()
    const out = runDdl(text) ?? runRead(text, params) ?? runWrite(text, params)
    if (out === null) throw new Error(`the fake cluster does not implement: ${text}`)
    return out
  }
  const clients = {
    query: (sql: string, params: unknown[] = []) => Promise.resolve(run(sql, params)),
    execute: (sql: string, params: unknown[] = []) => Promise.resolve(run(sql, params).length),
    s3: {},
    stack: {},
    close: () => Promise.resolve()
  } as unknown as Clients
  return {
    clients,
    tables,
    ddl,
    get telemetryAccepting(): boolean {
      return state.telemetryAccepting
    },
    set telemetryAccepting(v: boolean) {
      state.telemetryAccepting = v
    }
  }
}

const counter = (day: string, metric: string, dim: string, n: number): Row => ({ day, metric, dim, n })

interface FakeInstall {
  id: string
  channel: string
  seen: [string, string]
  cohort?: string | null
}

const installRow = ({ id, channel, seen, cohort = null }: FakeInstall): Row => ({
  analytics_id: id,
  channel,
  first_seen_day: seen[0],
  last_seen_day: seen[1],
  cohort,
  days_seen: 1,
  app_version: '0.3.2'
})

/** The live shape: the two counter tables WITHOUT cohort, plus the install rows. */
function preCohortCluster(): Fake {
  return fakeCluster({
    feedback_config: [{ id: 'FEEDBACK', telemetry_accepting: false }],
    analytics_install: [
      installRow({ id: 'a-dev', channel: 'dev', seen: ['2026-08-04', '2026-08-05'] }),
      installRow({ id: 'a-user', channel: 'prod', seen: ['2026-08-05', '2026-08-05'] })
    ],
    usage_daily: [
      counter('2026-08-04', 'sessions', '-', 12),
      counter('2026-08-04', 'featureUse', 'mapOpen', 30),
      counter('2026-08-05', 'sessions', '-', 4)
    ],
    usage_funnel_daily: [
      { day: '2026-08-04', funnel: 'firstRun', step: 'notice', outcome: 'ok', app_version: '0.3.2', n: 2 }
    ]
  })
}

// ---- 1. the staging shape comes from schema.sql -------------------------------------------

test('the staging DDL is schema.sql’s own CREATE with only the NAME changed', () => {
  const sql = stagingDdl(SCHEMA, USAGE)
  assert.match(sql, /^CREATE TABLE IF NOT EXISTS usage_daily_v2 \(/)
  // Every column and the four-part key come across verbatim — this is what makes the staging
  // table safe to rename INTO the name the app reads.
  for (const col of ['day', 'cohort', 'metric', 'dim', 'n']) assert.match(sql, new RegExp(`\\b${col}\\b`))
  assert.match(sql, /PRIMARY KEY \(day, cohort, metric, dim\)/)
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS usage_daily \(/)
  assert.match(stagingDdl(SCHEMA, FUNNEL), /PRIMARY KEY \(day, cohort, funnel, step, outcome, app_version\)/)
})

test('a schema whose PRIMARY KEY lost `cohort` is REFUSED — copying into it would be a silent no-op', () => {
  const stale = SCHEMA.replace('PRIMARY KEY (day, cohort, metric, dim)', 'PRIMARY KEY (day, metric, dim)')
  assert.throws(() => stagingDdl(stale, USAGE), /does not carry cohort/)
  assert.throws(() => stagingDdl('-- nothing here', USAGE), /no "CREATE TABLE/)
})

// ---- 2. the cohort is derived, never guessed ----------------------------------------------

test('a span is OWNER when the row SAYS so — dev channel, or a hand mark. Never otherwise', () => {
  assert.equal(spanOf(installRow({ id: 'x', channel: 'dev', seen: ['1', '2'] })).cohort, 'owner')
  assert.equal(spanOf(installRow({ id: 'x', channel: 'prod', seen: ['1', '2'], cohort: 'owner' })).cohort, 'owner')
  assert.equal(spanOf(installRow({ id: 'x', channel: 'prod', seen: ['1', '2'] })).cohort, 'user')
  assert.equal(spanOf(installRow({ id: 'x', channel: 'prod', seen: ['1', '2'], cohort: 'user' })).cohort, 'user')
})

test('a day a USER could have contributed to stays USER — the fail-safe direction', () => {
  const owner: InstallSpan = { firstSeenDay: '2026-08-01', lastSeenDay: '2026-08-09', cohort: 'owner' }
  const user: InstallSpan = { firstSeenDay: '2026-08-05', lastSeenDay: '2026-08-06', cohort: 'user' }
  // Only the owner was there: those counters can only be his, and that is a derivation.
  assert.equal(cohortForDay([owner, user], '2026-08-04'), 'owner')
  // Both were there. The rows carry no id, so splitting them would be inventing a number.
  assert.equal(cohortForDay([owner, user], '2026-08-05'), 'user')
  // Nobody's span covers it (an install row was wiped): the same fail-safe every reader takes.
  assert.equal(cohortForDay([owner, user], '2026-07-01'), 'user')
  assert.equal(cohortForDay([], '2026-08-04'), 'user')
})

// ---- 3. the copy, end to end ----------------------------------------------------------------

test('the copy carries every row, with the derived cohort, and the totals match', async () => {
  const f = preCohortCluster()
  const out = await runBackfill(f.clients, SCHEMA)
  assert.deepEqual(out.tables.map((t) => t.copied), [3, 1])
  // Aug 4: only the dev install's span covers it -> owner. Aug 5: a prod install is there too.
  const copied = f.tables.get('usage_daily_v2') ?? []
  assert.deepEqual(
    copied.map((r) => [r.day, r.cohort, r.metric, r.n]),
    [
      ['2026-08-04', 'owner', 'sessions', 12],
      ['2026-08-04', 'owner', 'featureUse', 30],
      ['2026-08-05', 'user', 'sessions', 4]
    ]
  )
  // The originals are untouched — that is the whole promise of this step.
  assert.equal((f.tables.get('usage_daily') ?? []).length, 3)
  assert.equal(out.installs, 2, 'both install rows were given an explicit cohort')
  const verified = await verifyTables(f.clients)
  assert.deepEqual(verified.map((v) => v.ok), [true, true])
  assert.deepEqual(verified[0].from, verified[0].to)
})

test('running the copy TWICE is the same cluster — assignment upsert, not addition', async () => {
  const f = preCohortCluster()
  await runBackfill(f.clients, SCHEMA)
  const first = await verifyTables(f.clients)
  await runBackfill(f.clients, SCHEMA)
  assert.deepEqual(await verifyTables(f.clients), first)
  assert.equal((f.tables.get('usage_daily_v2') ?? []).length, 3)
})

test('the copy PAGES — more rows than one page still land, exactly once each', async () => {
  const rows: Row[] = []
  for (let i = 0; i < PAGE + 7; i++) rows.push(counter('2026-08-04', 'featureUse', `dim${String(i).padStart(4, '0')}`, i))
  const f = fakeCluster({
    feedback_config: [{ id: 'FEEDBACK', telemetry_accepting: false }],
    analytics_install: [installRow({ id: 'a-dev', channel: 'dev', seen: ['2026-08-04', '2026-08-04'] })],
    usage_daily: rows,
    usage_daily_v2: []
  })
  const copied = await copyTable(f.clients, USAGE, [{ firstSeenDay: '2026-08-04', lastSeenDay: '2026-08-04', cohort: 'owner' }])
  assert.equal(copied, PAGE + 7)
  assert.equal((f.tables.get('usage_daily_v2') ?? []).length, PAGE + 7)
})

test('the copy REFUSES to run while telemetry is open — it is a snapshot, not a mirror', async () => {
  const f = preCohortCluster()
  f.telemetryAccepting = true
  await assert.rejects(() => runBackfill(f.clients, SCHEMA), /still OPEN/)
  assert.equal(f.tables.has('usage_daily_v2'), false, 'it stopped before creating anything')
})

// ---- 4. the swap ------------------------------------------------------------------------------

test('the swap DROPS THEN RENAMES, in that order, and only after re-verifying', async () => {
  const f = preCohortCluster()
  await runBackfill(f.clients, SCHEMA)
  const steps = await runSwap(f.clients)
  assert.deepEqual(steps.map((s) => s.sql), [
    'DROP TABLE usage_daily',
    'ALTER TABLE usage_daily_v2 RENAME TO usage_daily',
    'DROP TABLE usage_funnel_daily',
    'ALTER TABLE usage_funnel_daily_v2 RENAME TO usage_funnel_daily'
  ])
  // The real names now hold the cohort-keyed rows, and the staging names are gone.
  assert.equal(f.tables.has('usage_daily_v2'), false)
  assert.equal((f.tables.get('usage_daily') ?? [])[0]?.cohort, 'owner')
})

test('a MISMATCH refuses the swap and drops NOTHING', async () => {
  const f = preCohortCluster()
  await runBackfill(f.clients, SCHEMA)
  // A row that never made it across — the exact failure the verification exists to catch.
  ;(f.tables.get('usage_daily_v2') ?? []).pop()
  await assert.rejects(() => runSwap(f.clients), /refusing to swap/)
  assert.equal((f.tables.get('usage_daily') ?? []).length, 3, 'the original is still there')
  assert.equal(f.tables.has('usage_daily_v2'), true)
})

test('a swap INTERRUPTED between its two statements finishes on a re-run', async () => {
  const f = preCohortCluster()
  await runBackfill(f.clients, SCHEMA)
  // Exactly the state a crash after the DROP leaves: the data is safe under the staging name and
  // every reader answers 42P01, which the CLI and the tab both render as a NAMED state.
  f.tables.delete('usage_daily')
  const steps = await runSwap(f.clients)
  assert.deepEqual(steps.map((s) => s.sql), [
    'ALTER TABLE usage_daily_v2 RENAME TO usage_daily',
    'DROP TABLE usage_funnel_daily',
    'ALTER TABLE usage_funnel_daily_v2 RENAME TO usage_funnel_daily'
  ])
  assert.equal((f.tables.get('usage_daily') ?? []).length, 3)
})

test('a swap that already happened is a no-op, not an error', async () => {
  const f = preCohortCluster()
  await runBackfill(f.clients, SCHEMA)
  await runSwap(f.clients)
  const again = await runSwap(f.clients)
  assert.deepEqual(again.map((s) => s.done), [false, false])
})
