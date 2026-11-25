// The client resist table: load it once per app run, cache it by the source file's identity.
//
// TWO LAWS ARE BEING OBEYED HERE AT ONCE.
//
//   JOS-371 — nothing multi-megabyte and synchronous happens on the thread that tails the log.
//     The parse runs on `resistTableWorker.js`, a second rollup input beside index.js, and the
//     caller gets a promise. Until it resolves the app is in a well-defined state that the UI can
//     say out loud ("reading spell data"), never a stall.
//
//   JOS-208 — only redo work when the source changed. The parsed table is written to
//     `<userData>/spell-resist-cache.json` keyed by the SIZE and MTIME of the file it came from.
//     A launch where the player has not patched EverQuest reads a ~1 MB cache instead of a 38 MB
//     original; a launch after a patch finds the key stale, re-parses, and rewrites. The key is
//     deliberately not a hash: hashing 38 MB costs most of what parsing it costs.
//
// AND ONE THING IT REFUSES TO DO: crash when the file is not there. `EQ_LOG_PATH`-style overrides
// let a user point this app at a folder of logs with no EverQuest install behind it, and a Wine
// or trimmed install may lack the file. `spellTable()` then resolves to null, `spellDataAvailable`
// on every profile goes false, and the mob page says so instead of showing an empty card.

import { app } from 'electron'
import { readFileSync, statSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { effectiveEqRoot } from '../log/config'
import { logError } from '../errorLog'
import type { SpellResistTable } from '../../shared/resistTypes'
import { readError, spellsUsHealth } from '../../shared/gameFileDetect'
import { fileVersion, type GameFileReport } from '../../shared/gameFileHealth'
import { KNOWN_ROW_LENGTHS } from './spellsUsParse'
import { readSpellsUsMeta, runResistWorker, writeSpellsUsMeta, type SpellsUsMeasured, type Stamp } from './spellsUsMeta'
import { spellsUsMetaKey } from './spellsUsSemantics'

/**
 * Bump to invalidate every cached table in the field (a parser change, not a game patch).
 *
 *   1  JOS-382, the original table.
 *   2  JOS-396 — every effect-0 slot and the client's duration statement (`hp`, `hpDuration`). A
 *      version-1 cache is not upgradeable in place: the fields were never read out of the file, so
 *      the only way to get them is the re-parse this bump forces. It costs one launch's worth of
 *      worker time per install, once.
 *   3  JOS-444 - the re-use timer (`recastMs`, field 10). The same argument as 2: a version-2
 *      cache was written before anything read that column, so the field can only come from a
 *      re-parse, and a sustained dps with a missing denominator is a wrong number rather than an
 *      absent one.
 *   4  JOS-449 - the AE target cap (`aeMaxTargets`, field 143). MISSED AT MERGE and caught by the
 *      owner in the field the same day: his AOE tab read Supernova at the default four targets
 *      (4,848 at rank VII) instead of the client's eight, because his machine held a version-3
 *      cache written before anything read that column. The parser change shipped without this
 *      bump, which is exactly the staleness this constant exists to make impossible.
 *   5  JOS-451 - the mana column (`mana`, field 14) and TWO MORE HITPOINT EFFECT IDS in `hp` (100
 *      heal-over-time, 334 the bard pulse). Both halves are unreachable from a version-4 cache for
 *      the same reason 2, 3 and 4 were: the fields were never written into it. And the second half
 *      is what the owner's own report turns on - a version-4 cache carries no effect-100 slot for
 *      `Ethereal Cleansing`, so the client curve that fixes his 40-instead-of-400 heal-over-time
 *      would simply not be there to read. Bumped in the SAME commit as the parser change, which is
 *      the whole lesson of 4.
 *   6  EQ Zera 2026-11-25 - the bump the 174- and 190-field layout fixes should have made. Neither did, so an
 *      install that read the 190-field file before the fix cached an EMPTY table under a file stamp
 *      that never changes again, and the fixed build would have kept reading that empty cache. An
 *      empty table is no longer cached at all (see `load`), so this cannot recur.
 */
export const SPELL_RESIST_CACHE_VERSION = 6

/**
 * Which parser a layout sidecar was measured by: the cache version, the widths it reads and the
 * semantic checks' version. A build that parses differently never trusts an old measurement.
 */
const META_KEY = spellsUsMetaKey(SPELL_RESIST_CACHE_VERSION, KNOWN_ROW_LENGTHS)

interface CacheFile {
  version: number
  size: number
  mtimeMs: number
  table: SpellResistTable
}

interface Parsed {
  table: SpellResistTable
  measured?: SpellsUsMeasured
}

/** The client file, as it sits in the install this app resolved. */
export function spellsUsPath(): string {
  return join(effectiveEqRoot(), 'spells_us.txt')
}

function cachePath(): string {
  return join(app.getPath('userData'), 'spell-resist-cache.json')
}

function sourceStamp(path: string): Stamp | null {
  try {
    const st = statSync(path)
    return { size: st.size, mtimeMs: Math.round(st.mtimeMs) }
  } catch {
    return null
  }
}

function readCache(stamp: Stamp): Parsed | null {
  try {
    const file = JSON.parse(readFileSync(cachePath(), 'utf8')) as CacheFile
    if (file.version !== SPELL_RESIST_CACHE_VERSION) return null
    if (file.size !== stamp.size || file.mtimeMs !== stamp.mtimeMs) return null
    return { table: file.table }
  } catch {
    return null
  }
}

function writeCache(stamp: Stamp, table: SpellResistTable): void {
  const path = cachePath()
  const tmp = `${path}.tmp`
  const file: CacheFile = { version: SPELL_RESIST_CACHE_VERSION, ...stamp, table }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(tmp, JSON.stringify(file), 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    // Best-effort: a failed cache write costs one re-parse next launch, nothing else.
    logError('main:resistTable', { message: 'spell-resist-cache write failed', err })
  }
}

async function parseOnWorker(path: string): Promise<Parsed | null> {
  const reply = await runResistWorker({ path, job: 'table' })
  if (!reply?.table) return null
  const entries = Object.keys(reply.table).length
  const measured = reply.layout && reply.semantics ? { layout: reply.layout, semantics: reply.semantics, entries } : undefined
  return measured ? { table: reply.table, measured } : { table: reply.table }
}

/**
 * WHY THE FAILURE HAS TWO NAMES (JOS-385). "Spell data unavailable — this needs your EverQuest
 * install's spells_us.txt" was one sentence for two unrelated problems, and it blamed the install
 * for both. The owner hit the SECOND one after a dev restart (the file was right where it always
 * is; the worker had not come back) and was told to go find his EverQuest folder.
 *
 *   'missing'    — nothing at the resolved path. The user's problem, and the path is the fix, so
 *                  the message says which folder was looked in.
 *   'unloadable' — the file is there and the parse did not produce a table (a worker that failed
 *                  to start, a parse error, a cache write that came back malformed). OUR problem,
 *                  and the error log is where it is written down.
 */
export type SpellTableState = 'loading' | 'ok' | 'missing' | 'unloadable'

let pending: Promise<SpellResistTable | null> | null = null
let loaded: SpellResistTable | null = null
let sourceMtime: number | null = null
let state: SpellTableState = 'loading'
/** The stamp the last load saw, so a failed load can be retried once the file changes. */
let loadedStampKey = ''

const stampKey = (s: Stamp | null): string => (s ? `${String(s.size)}-${String(s.mtimeMs)}` : 'none')

/**
 * The table, loaded at most once per app run. Null means the client file is unreadable — a
 * SUPPORTED state (see the header), never an error the caller has to handle.
 *
 * ONE EXCEPTION TO "ONCE": a load that found nothing usable (no file, or an empty or half-written
 * one while a patch was copying it in) is retried when the file's size or mtime has moved since.
 * A good table is never re-read; a patch over a good table still waits for the next launch.
 */
export function spellTable(): Promise<SpellResistTable | null> {
  const existing = pending
  const failed = state === 'missing' || state === 'unloadable'
  if (existing && !(failed && stampKey(sourceStamp(spellsUsPath())) !== loadedStampKey)) return existing
  const created = load()
  pending = created
  return created
}

async function load(): Promise<SpellResistTable | null> {
  const path = spellsUsPath()
  const stamp = sourceStamp(path)
  loadedStampKey = stampKey(stamp)
  if (!stamp) {
    state = 'missing'
    return null
  }
  sourceMtime = stamp.mtimeMs
  // No layout sidecar from THIS build means this parser has not measured this file: skip the cache,
  // so the one worker pass produces the table and the measurements together.
  const cached = readSpellsUsMeta(stamp, META_KEY) ? readCache(stamp) : null
  const parsed = cached ?? (await parseOnWorker(path))
  if (parsed?.measured) writeSpellsUsMeta(stamp, META_KEY, parsed.measured)
  // AN EMPTY TABLE IS NOT A TABLE. It is what an unmeasured layout parses to (every row skipped),
  // and serving it as 'ok' is how a patch silently switched resist estimates off for everyone. It
  // reads as 'unloadable', and it is never cached, so the build that learns the layout re-parses.
  if (!parsed || Object.keys(parsed.table).length === 0) {
    state = 'unloadable'
    return null
  }
  loaded = parsed.table
  if (!cached) writeCache(stamp, parsed.table)
  state = 'ok'
  return parsed.table
}

/**
 * The game-file health verdict on `spells_us.txt` (shared/gameFileHealth.ts). Usually WITHOUT
 * loading the table: the measurements come from the small sidecar the last parse wrote
 * (./spellsUsMeta.ts). Only when this build has no sidecar for this file version (the first launch
 * after a patch, or after a parser change) does it ask for the table itself, so ONE worker pass
 * produces the table and the measurements and nothing reads and splits the 38 MB file twice. An
 * empty file is `pending` (a patcher mid-copy), never a verdict.
 */
export async function spellsUsHealthNow(): Promise<GameFileReport> {
  if (pending) await pending
  const path = spellsUsPath()
  const stamp = sourceStamp(path)
  if (!stamp) return { id: 'spellsUs', status: 'missing', signature: 'none', facts: {}, version: '' }
  const version = fileVersion(stamp.size, stamp.mtimeMs)
  if (stamp.size === 0) return { id: 'spellsUs', status: 'pending', signature: 'empty', facts: {}, version }
  let measured = readSpellsUsMeta(stamp, META_KEY)
  if (!measured) {
    await spellTable()
    measured = readSpellsUsMeta(stamp, META_KEY)
  }
  if (!measured) return readError('spellsUs', 'unloadable', version)
  return spellsUsHealth({ ...measured, version }, KNOWN_ROW_LENGTHS)
}

/** Where the table stands right now, and the path it was looked for at. See `SpellTableState`. */
export function spellTableStatus(): { state: SpellTableState; path: string } {
  return { state, path: spellsUsPath() }
}

/** The table if it is already resolved, else null. For synchronous readers (the fold). */
export function spellTableNow(): SpellResistTable | null {
  return loaded
}

/** The `spells_us.txt` mtime this run's table was read from — stamped into a generated baseline. */
export function spellsUsMtime(): number | null {
  return sourceMtime
}

/** Test seam: install a table without touching the filesystem. */
export function installSpellTable(table: SpellResistTable | null, why: SpellTableState = 'unloadable'): void {
  loaded = table
  pending = Promise.resolve(table)
  state = table ? 'ok' : why
}
