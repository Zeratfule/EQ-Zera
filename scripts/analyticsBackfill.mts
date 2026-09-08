/**
 * analyticsBackfill.mts — COPY FIRST. NOTHING IS DROPPED UNTIL A VERIFIED COPY EXISTS.
 * ============================================================================================
 *
 * The one-off transition that gives the two usage-counter tables their `cohort` key on a
 * cluster that already has the PRE-COHORT shape — the state the v0.4.0 smoke test proved is
 * live (`column "cohort" does not exist`). Those counters have been accumulating since
 * 2026-08-04 behind a lit client, so they may hold REAL USERS' rows and not only the owner's
 * testing. The previous runbook said to `DROP TABLE usage_daily` and re-migrate. That is a data
 * loss, it was written when the tables were believed to be unapplied, and the owner's
 * instruction is the plain one: **we shouldn't drop anything.**
 *
 * WHY A COPY AND NOT AN `ALTER`. `cohort` is part of the PRIMARY KEY (the ingest path's
 * `ON CONFLICT (day, cohort, metric, dim)` needs those four columns to BE the uniqueness rule),
 * and no PostgreSQL — least of all a distributed one, where the key IS the data's distribution —
 * can add a column to a primary key in place. So the new shape is a NEW TABLE, and the rows are
 * copied into it.
 *
 * WHY THE FINAL NAMES DO NOT CHANGE: **Aurora DSQL supports `ALTER TABLE … RENAME TO`.** It is
 * in the documented supported syntax, verbatim —
 *   ALTER TABLE [ IF EXISTS ] name RENAME TO new_name
 * — and the description says "There is no effect on the stored data"
 * (https://docs.aws.amazon.com/aurora-dsql/latest/userguide/alter-table-syntax-support.html).
 * That is the same page this repo already cites for the fact that DSQL has no `DROP COLUMN`, so
 * it is the same evidence standard. Because the rename exists, the staging tables can be swapped
 * into the real names at the end and NOTHING ELSE MOVES: `infra/schema.sql`, the Lambda's
 * INSERTs, `usageStore.ts`'s SELECTs and every constant in between keep naming `usage_daily` and
 * `usage_funnel_daily`. A world where the rename did not exist would have had to leave the data
 * under `*_v2` and re-point every reader — strictly worse, and unnecessary.
 *
 * GRANTS SURVIVE THE RENAME (privileges attach to the object, not to the name), which is why
 * this file grants `telemetry_ingest` on the STAGING tables: after the swap the Lambda finds the
 * access it needs on the table that now carries the real name. Forgetting that would produce a
 * permission-denied on the first batch after re-opening.
 *
 * FOUR STEPS, EACH SAFE TO STOP AT — nothing here is destructive until the last one, and the
 * last one refuses unless the copy verified:
 *
 *   1. `analytics backfill-cohort`  create the staging tables (shape taken from schema.sql
 *                                   itself, so it cannot drift), grant, fill
 *                                   `analytics_install.cohort`, COPY every counter row.
 *   2. `analytics backfill-verify`  old vs new, per table: row count AND the sum of `n`.
 *   3. `analytics backfill-swap`    re-verifies, REFUSES on any mismatch, then per table:
 *                                   DROP the (now redundant) original, RENAME staging into its
 *                                   place. One DDL per transaction, a DSQL law.
 *   4. (the runbook) `terraform apply` puts the cohort-aware Lambda live, then `analytics open`.
 *
 * THE COHORT IS DERIVED, NEVER GUESSED. A counter row carries no id — that is the whole point of
 * the aggregate-on-arrival design — so the only honest source is `analytics_install`, which
 * states each install's `channel` and its first/last seen day. `cohortForDay` below spells out
 * the rule and its fail-safe direction.
 *
 * WHY THESE STATEMENTS DO NOT LIVE IN `src/main/triage/store.ts` with every other analytics
 * statement: that module is the APP's read surface, compiled into the dev build's main process.
 * A one-off `DROP TABLE`/`RENAME` path has no business being reachable from a panel. It lives
 * here, beside the CLI that runs it, and it takes `Clients` as an argument so it can be driven
 * by a fake in `tests/analyticsBackfill.test.mts` without an AWS credential in sight.
 */

import { cohortForChannel, cohortOf, type UsageCohort } from '../src/shared/telemetryRollup'
import type { Clients, Row } from '../src/main/triage/store'

/**
 * THE TWO TABLES THAT NEED A NEW KEY, and the staging name each is copied into. A closed list:
 * every table name below reaches SQL as an identifier (they cannot be parameters), so the only
 * thing that keeps that safe is that no caller can add one.
 */
export const BACKFILL_TABLES = [
  { table: 'usage_daily', staging: 'usage_daily_v2', columns: ['day', 'metric', 'dim', 'n'] },
  {
    table: 'usage_funnel_daily',
    staging: 'usage_funnel_daily_v2',
    columns: ['day', 'funnel', 'step', 'outcome', 'app_version', 'n']
  }
] as const

export type BackfillTable = (typeof BACKFILL_TABLES)[number]

/**
 * Rows per SELECT page and per INSERT statement. DSQL caps a TRANSACTION at 3,000 MODIFIED
 * ROWS and node-postgres runs each statement in its own implicit transaction, so 500 leaves the
 * cap a wide margin while keeping the number of round trips sane. (Same reasoning, same margin
 * as the ingest handler's `UPSERT_CHUNK` and db.ts's sweep bound.)
 */
export const PAGE = 500

/** A runaway guard, not a policy: 90 days of counters is thousands of rows, not millions. */
const MAX_ROWS = 500_000

/** `bigint` arrives as a number (store.ts sets the int8 parser); `sum()` arrives as NUMERIC,
 *  which node-postgres hands over as a STRING. Both are counters here and both are exact. */
export const big = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v !== 'string') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

// ---- the staging DDL, taken FROM schema.sql ---------------------------------------------------

/**
 * The `CREATE TABLE` for `table`, with the table name swapped for the staging one — read out of
 * infra/schema.sql rather than written again here.
 *
 * THAT IS THE POINT: the staging table must have EXACTLY the shape the final schema declares,
 * because it is about to BE the final table. A second hand-authored copy of those columns is a
 * drift waiting to happen (the two would have to be edited together forever, and nothing would
 * notice if they were not). schema.sql is authored so no string literal ends a line with a
 * semicolon, so a `CREATE TABLE … ;` is safely delimited by the first `;` after it.
 */
export function stagingDdl(schemaSql: string, t: BackfillTable): string {
  const head = `CREATE TABLE IF NOT EXISTS ${t.table} (`
  const at = schemaSql.indexOf(head)
  if (at < 0) throw new Error(`schema.sql has no "${head}…" statement to derive ${t.staging} from`)
  const end = schemaSql.indexOf(';', at)
  if (end < 0) throw new Error(`schema.sql's ${t.table} CREATE is unterminated`)
  const create = schemaSql.slice(at, end)
  if (!/PRIMARY KEY \([^)]*\bcohort\b/.test(create)) {
    // The tripwire. If schema.sql ever stops keying these tables on the cohort, copying into a
    // table built from it would silently produce the OLD shape under a new name.
    throw new Error(`schema.sql's ${t.table} does not carry cohort in its PRIMARY KEY`)
  }
  return create.replace(head, `CREATE TABLE IF NOT EXISTS ${t.staging} (`)
}

// ---- the cohort derivation --------------------------------------------------------------------

/** One install's contribution window and which side of the split it is on. */
export interface InstallSpan {
  firstSeenDay: string
  lastSeenDay: string
  cohort: UsageCohort
}

/**
 * One `analytics_install` row -> a span. TWO STATED FACTS, no inference:
 *   * `channel` — 'dev' can only be the author's own machine (`cohortForChannel`, the same
 *     function the ingest path derives a live batch's cohort with).
 *   * `cohort` — a hand mark placed by `analytics owner-add`, which wins if it is there.
 * Anything else is a user. NULL reads as 'user' (`cohortOf`), the fail-safe direction.
 */
export function spanOf(row: Row): InstallSpan {
  const marked = cohortOf(row.cohort) === 'owner'
  const dev = cohortForChannel(str(row.channel)) === 'owner'
  return {
    firstSeenDay: str(row.first_seen_day),
    lastSeenDay: str(row.last_seen_day),
    cohort: marked || dev ? 'owner' : 'user'
  }
}

/**
 * WHICH COHORT A PRE-SPLIT DAY'S COUNTERS BELONG TO. The counters carry no id, so this is the
 * whole of what can be known — and the rule is deliberately conservative in the direction that
 * cannot invent a user:
 *
 *   * If ANY user-cohort install could have reported that day (its first..last span covers it),
 *     the day is 'user'. Splitting a day's sums between two installs is not possible — there is
 *     nothing in the row to split ON — so the alternative would be to invent one.
 *   * Otherwise, if an OWNER install's span covers the day, only the owner can have produced
 *     those rows, so the day is 'owner'. That is a derivation, not a guess.
 *   * A day no install's span covers (a counter older than any surviving install row) is 'user',
 *     the same fail-safe every other reader of a NULL cohort takes.
 *
 * THE CONSEQUENCE, STATED PLAINLY AND REPEATED IN THE RUNBOOK: on days where the owner and a
 * real user were both present, the owner's own use stays folded into the user cohort forever.
 * That is the honest limit of aggregates-on-arrival, and it is why the split had to become a
 * KEY going forward rather than a report-time filter. Everything from the swap onward is exact.
 */
export function cohortForDay(spans: readonly InstallSpan[], day: string): UsageCohort {
  const covers = (s: InstallSpan): boolean => s.firstSeenDay <= day && day <= s.lastSeenDay
  if (spans.some((s) => s.cohort === 'user' && covers(s))) return 'user'
  return spans.some((s) => s.cohort === 'owner' && covers(s)) ? 'owner' : 'user'
}

// ---- statements -------------------------------------------------------------------------------

/** Every table name below comes from BACKFILL_TABLES, never from an argument. */
function assertKnown(name: string): void {
  const ok = BACKFILL_TABLES.some((t) => t.table === name || t.staging === name)
  if (!ok) throw new Error(`refusing to touch an unlisted table: ${name}`)
}

/** postgres `42P01`: the relation is not there. Probed, because DSQL's catalogs are not a
 *  contract this file wants to depend on and one bounded SELECT answers it exactly. */
async function tableExists(c: Clients, name: string): Promise<boolean> {
  assertKnown(name)
  try {
    await c.query(`SELECT 1 FROM ${name} LIMIT 1`)
    return true
  } catch (err) {
    const code: unknown = (err as { code?: unknown }).code
    if (code === '42P01') return false
    throw err
  }
}

/**
 * Does this table have the `cohort` column — i.e. is it the NEW shape?
 *
 * THE STATE MACHINE NEEDS THIS AND A ROW COUNT CANNOT PROVIDE IT. After a completed swap the
 * final name exists again (it is the renamed staging table), so "original present, staging
 * absent" describes BOTH "nothing has been copied yet" and "everything is done". The column is
 * what tells them apart — and it is the same `42703 undefined_column` the Analytics tab already
 * classifies, which is what made the live cluster's state visible in the first place.
 */
async function hasCohort(c: Clients, name: string): Promise<boolean> {
  assertKnown(name)
  try {
    await c.query(`SELECT cohort FROM ${name} LIMIT 1`)
    return true
  } catch (err) {
    const code: unknown = (err as { code?: unknown }).code
    if (code === '42703') return false
    throw err
  }
}

export interface TableTotals {
  rows: number
  total: number
}

/** Row count AND the sum of `n` — a copy that moved every row but mangled a counter is not a
 *  copy, and a row count alone cannot see that. */
export async function totalsOf(c: Clients, name: string): Promise<TableTotals> {
  assertKnown(name)
  const rows = await c.query(`SELECT count(*) AS rows, COALESCE(sum(n), 0) AS total FROM ${name}`)
  return { rows: big(rows[0]?.rows), total: big(rows[0]?.total) }
}

/** `($1,$2,$3),($4,$5,$6)…` — one placeholder per value, in the order the params are pushed. */
function tuples(rows: number, columns: number): string {
  const out: string[] = []
  for (let r = 0; r < rows; r++) {
    const cells: string[] = []
    for (let col = 0; col < columns; col++) cells.push(`$${String(r * columns + col + 1)}`)
    out.push(`(${cells.join(',')})`)
  }
  return out.join(',')
}

/**
 * The copy statement. `DO UPDATE SET n = EXCLUDED.n` is ASSIGNMENT, not the ingest path's
 * addition: this is a COPY, and a copy run twice must leave the destination identical rather
 * than doubled. That is what makes the whole command re-runnable — and it is also why the
 * runbook has the telemetry switch CLOSED while it runs (see `assertClosed`): once the new
 * Lambda is adding live rows, re-copying would overwrite them with the frozen legacy value.
 */
function copySql(t: BackfillTable, rows: number): string {
  const cols = ['day', 'cohort', ...t.columns.slice(1)]
  const key = cols.filter((c) => c !== 'n').join(', ')
  return (
    `INSERT INTO ${t.staging} (${cols.join(', ')}) VALUES ${tuples(rows, cols.length)}` +
    ` ON CONFLICT (${key}) DO UPDATE SET n = EXCLUDED.n`
  )
}

// ---- step 1: create, grant, fill, copy ---------------------------------------------------------

export interface BackfillReport {
  table: string
  copied: number
  created: boolean
}

/** The telemetry ingest role — the grants have to be placed on the staging table BEFORE the
 *  rename, because that is the object the Lambda will be writing to afterwards. */
const INGEST_ROLE = 'telemetry_ingest'

/**
 * DDL, one statement per transaction (a DSQL law). "Already there" is success — this command is
 * re-runnable by construction, and a half-finished first attempt must be resumable.
 */
async function ddl(c: Clients, sql: string, alreadyThere: readonly string[]): Promise<boolean> {
  try {
    await c.execute(sql)
    return true
  } catch (err) {
    const code: unknown = (err as { code?: unknown }).code
    if (typeof code === 'string' && alreadyThere.includes(code)) return false
    throw err
  }
}

/** 42P07 duplicate_table, 42710 duplicate_object (a grant already held). */
const EXISTS_CODES = ['42P07', '42710'] as const

async function createStaging(c: Clients, schemaSql: string, t: BackfillTable): Promise<boolean> {
  const created = await ddl(c, stagingDdl(schemaSql, t), EXISTS_CODES)
  try {
    await ddl(c, `GRANT SELECT, INSERT, UPDATE ON ${t.staging} TO ${INGEST_ROLE}`, EXISTS_CODES)
  } catch (err) {
    const code: unknown = (err as { code?: unknown }).code
    // 42704 undefined_object: the role is not there, which means `migrate` has not run against
    // this cluster. Say so — the alternative is a permission denied on the first live batch,
    // long after this command reported success.
    if (code !== '42704') throw err
    throw new Error(
      `the database role '${INGEST_ROLE}' does not exist on this cluster — run ` +
        '`triage-feedback migrate --refresh` first (it creates the role and its grants), ' +
        'then re-run this command.'
    )
  }
  return created
}

/**
 * `analytics_install.cohort`, filled from what the row already states. This is the ONE cohort
 * column an ALTER could add (it is not in a key), so it exists after `migrate`; what it does not
 * have is a value on rows written before the split. Two keyed UPDATEs, batched under the
 * 3,000-row cap, and idempotent (the WHERE stops matching once the value is there).
 */
export async function fillInstallCohorts(c: Clients): Promise<number> {
  let filled = 0
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const rows = await c.query(
      'SELECT analytics_id, channel, cohort, first_seen_day, last_seen_day FROM analytics_install' +
        ' ORDER BY analytics_id LIMIT $1 OFFSET $2',
      [PAGE, offset]
    )
    if (rows.length === 0) break
    for (const cohort of ['owner', 'user'] as const) {
      const ids = rows.filter((r) => r.cohort === null && spanOf(r).cohort === cohort).map((r) => str(r.analytics_id))
      if (ids.length === 0) continue
      filled += await c.execute(
        'UPDATE analytics_install SET cohort = $1 WHERE cohort IS NULL AND analytics_id = ANY($2::text[])',
        [cohort, ids]
      )
    }
    if (rows.length < PAGE) break
  }
  return filled
}

/** Every install's span, for the day-level derivation. Paged for the same reason as above. */
export async function readSpans(c: Clients): Promise<InstallSpan[]> {
  const spans: InstallSpan[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const rows = await c.query(
      'SELECT channel, cohort, first_seen_day, last_seen_day FROM analytics_install' +
        ' ORDER BY first_seen_day, last_seen_day LIMIT $1 OFFSET $2',
      [PAGE, offset]
    )
    for (const row of rows) spans.push(spanOf(row))
    if (rows.length < PAGE) break
  }
  return spans
}

/**
 * The copy itself: read a page of the ORIGINAL, write it to the staging table with the derived
 * cohort inserted after `day`, repeat. Every statement goes through `Clients.query`/`execute`,
 * which already wrap the bounded, jittered OCC retry (`40001` is a DSQL fact of life, not an
 * outage) — so this loop does not re-implement one.
 *
 * The paging is `ORDER BY` the primary key + LIMIT/OFFSET, which is stable precisely because the
 * runbook freezes writes first. A moving table would need a keyset walk; a frozen one does not,
 * and the simpler statement is the one whose behaviour is obvious at 3am.
 */
export async function copyTable(
  c: Clients,
  t: BackfillTable,
  spans: readonly InstallSpan[]
): Promise<number> {
  const cols = t.columns.join(', ')
  const order = t.columns.filter((col) => col !== 'n').join(', ')
  let copied = 0
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const rows = await c.query(
      `SELECT ${cols} FROM ${t.table} ORDER BY ${order} LIMIT $1 OFFSET $2`,
      [PAGE, offset]
    )
    if (rows.length === 0) break
    const params: unknown[] = []
    for (const row of rows) {
      const day = str(row.day)
      params.push(day, cohortForDay(spans, day))
      for (const col of t.columns.slice(1)) params.push(col === 'n' ? big(row[col]) : str(row[col]))
    }
    await c.execute(copySql(t, rows.length), params)
    copied += rows.length
    if (rows.length < PAGE) break
  }
  return copied
}

/** The kill switch has to be CLOSED: this is a snapshot copy, and a live writer would land rows
 *  after the page that read past them. `analytics close` is one statement and needs no deploy. */
export async function assertClosed(c: Clients): Promise<void> {
  const rows = await c.query(`SELECT telemetry_accepting FROM feedback_config WHERE id = 'FEEDBACK'`)
  if (rows[0]?.telemetry_accepting !== true) return
  throw new Error(
    'telemetry is still OPEN. This copy is a snapshot — a batch landing mid-copy would be ' +
      'missed, and re-running the copy after the new Lambda is live would overwrite its rows.\n' +
      'Run `triage-feedback analytics close` first (one statement, no deploy); the client ' +
      'treats 503 as "not now" and keeps its buffer, so a short close costs nothing.'
  )
}

export async function runBackfill(
  c: Clients,
  schemaSql: string
): Promise<{ installs: number; tables: BackfillReport[] }> {
  await assertClosed(c)
  const created = new Map<string, boolean>()
  for (const t of BACKFILL_TABLES) created.set(t.table, await createStaging(c, schemaSql, t))
  // The install rows first: the day-level derivation below reads what this writes.
  const installs = await fillInstallCohorts(c)
  const spans = await readSpans(c)
  const tables: BackfillReport[] = []
  for (const t of BACKFILL_TABLES) {
    tables.push({
      table: t.table,
      created: created.get(t.table) === true,
      copied: await copyTable(c, t, spans)
    })
  }
  return { installs, tables }
}

// ---- step 2: verification ----------------------------------------------------------------------

export interface VerifyRow {
  table: string
  staging: string
  /** Null when the table is not there at all — after a swap, the original is gone BY DESIGN. */
  from: TableTotals | null
  to: TableTotals | null
  ok: boolean
  note: string
}

/**
 * OLD vs NEW, per table, on both numbers. The mapping old -> new is injective (the new key adds
 * `cohort`, which is a function of `day`, to a key that was already unique), so a correct copy
 * has EXACTLY the same row count and EXACTLY the same sum. Anything else is a refusal.
 *
 * FIVE STATES, because a re-runnable migration has to be able to recognise every point it could
 * have been stopped at — including the two that look identical from a row count alone (see
 * `hasCohort`). Only a genuine mismatch, and "you have not copied yet", are `ok: false`.
 */
async function verifyOne(c: Clients, t: BackfillTable): Promise<VerifyRow> {
  const row = (from: TableTotals | null, to: TableTotals | null, ok: boolean, note: string): VerifyRow => ({
    table: t.table,
    staging: t.staging,
    from,
    to,
    ok,
    note
  })
  const staged = await tableExists(c, t.staging)
  if (!(await tableExists(c, t.table))) {
    if (!staged) return row(null, null, true, 'neither table exists — this cluster needs `migrate`, not a backfill')
    return row(null, await totalsOf(c, t.staging), true, 'original dropped — the rename is still to do')
  }
  const from = await totalsOf(c, t.table)
  if (!staged) {
    return (await hasCohort(c, t.table))
      ? row(from, null, true, 'already swapped — this table is the cohort-keyed one')
      : row(from, null, false, 'no staging table — run backfill-cohort')
  }
  const to = await totalsOf(c, t.staging)
  const ok = from.rows === to.rows && from.total === to.total
  return row(from, to, ok, ok ? 'copy verified' : 'MISMATCH — do not swap')
}

export async function verifyTables(c: Clients): Promise<VerifyRow[]> {
  const out: VerifyRow[] = []
  for (const t of BACKFILL_TABLES) out.push(await verifyOne(c, t))
  return out
}

// ---- step 3: the swap ---------------------------------------------------------------------------

export interface SwapStep {
  sql: string
  done: boolean
}

/**
 * DROP the original, RENAME the staging table into its place. IN THAT ORDER and not before the
 * verification above passed — which this re-runs itself, because a swap that trusted a
 * verification somebody ran an hour ago is a swap that trusts a stale fact.
 *
 * SAFE TO STOP BETWEEN THE TWO. If the process dies after the DROP, the data is intact in the
 * staging table and the readers answer `42P01` — which the CLI and the Analytics tab both render
 * as the NAMED "this cluster is not migrated" state, not as a crash. Re-running finishes the
 * rename. If it dies after the rename, re-running finds nothing to do and says so.
 *
 * ONE DDL PER TRANSACTION, which is a DSQL law and is satisfied by never batching: node-postgres
 * gives each `execute` its own implicit transaction.
 */
export async function runSwap(c: Clients): Promise<SwapStep[]> {
  const verified = await verifyTables(c)
  const bad = verified.filter((v) => !v.ok)
  if (bad.length > 0) {
    throw new Error(
      `refusing to swap: ${bad.map((b) => `${b.table} (${b.note})`).join('; ')}.\n` +
        'Nothing has been dropped. Fix the copy (re-run `analytics backfill-cohort`) and verify again.'
    )
  }
  const steps: SwapStep[] = []
  for (const t of BACKFILL_TABLES) {
    if (await tableExists(c, t.staging)) {
      if (await tableExists(c, t.table)) {
        // The original is redundant HERE and only here: its rows are already in the staging
        // table and the counts matched a moment ago.
        await c.execute(`DROP TABLE ${t.table}`)
        steps.push({ sql: `DROP TABLE ${t.table}`, done: true })
      }
      await c.execute(`ALTER TABLE ${t.staging} RENAME TO ${t.table}`)
      steps.push({ sql: `ALTER TABLE ${t.staging} RENAME TO ${t.table}`, done: true })
    } else {
      steps.push({ sql: `-- ${t.table}: already swapped`, done: false })
    }
  }
  return steps
}
