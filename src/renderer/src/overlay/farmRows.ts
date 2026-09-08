// farmRows.ts — the PURE shaping behind the FARM METER (roadmap 2 item 8): what this camp is
// paying, per hour, measured over the zone stay you are standing in.
//
// No React, no MUI, no `window.eqOverlay`. VALUE imports are RELATIVE, never `@shared/*` — that
// alias exists only inside the vite build and the node runner would not resolve it — so
// tests/farmRows.test.mts drives every rule here under plain tsx. The same constraint xpRows.ts /
// aaPaceRows.ts / rangeStatsRows.ts already document.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// IT DERIVES NOTHING OF ITS OWN, WITH ONE DECLARED EXCEPTION. Every number below already exists:
//
//   the stay       `currentZoneOf` + `resolveSlice` as a CUSTOM range (shared/timeslice.ts)
//   the pace       `rangeStats` (shared/progressionStats.ts) — the Leveling tab's own query
//   the drops      `windowLootRates` (shared/lootRates.ts) — the loot ledger's own rate
//   the next clock `respawnReading` + `respawnSourceLabel` (shared/respawn.ts) — the Timers tab's
//
// The exception is COIN, and it is the reason this file has a ladder constant in it at all.
// `shared/acquireEvents.ts` states the law: EQ's platinum/gold/silver/copper conversion appears in
// NO line the client prints, so the `coin` module publishes denominations and never a total. A
// consumer that wants coin-per-hour therefore DECLARES ITS OWN RATE, IN THE OPEN. `COIN_LADDER` is
// that declaration and `COIN_LADDER_TEXT` is it worded for a reader — and the row that uses it
// carries the words in its own LABEL, so nobody reads a coin rate without also reading the
// assumption underneath it. That is the whole of the honesty the law asks for: the ladder is a
// stated assumption, never a hidden one.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE SLICE IS "SINCE YOU ZONED IN", AND IT IS THE ONLY ONE THIS WINDOW HAS.
//
// `{ t0: zoneStart[last], t1: the live edge }` — a CUSTOM range with a caption, exactly the composition
// the XP overlay performs for its presets, and the one stretch a farm meter is ever about. There is
// no slice picker: "how is this camp going" is a question about the camp you are standing in, and a
// window that could be pointed at last week would be answering a different one. The MEMBERSHIP is
// the current zone's PLACE fold (`zones.zoneKey`), applied to the drops as well as to the pace, and
// carried to the coin as the set of zones `rangeStats` actually admitted (`coinZoneKeys`) — so a
// rate measured over this stay can never count a drop, or a coin, from the camp before it.
//
// EVERY RATE IS PER HOUR OF ACTIVE TIME. There is no denominator toggle here for the reason there
// is no slice picker: the window's whole subject is a single camp session, and `active` is the
// farming-efficiency reading (`rangeStatsRows.ACTIVE_TIME_TITLE` is what that hour means). The XP
// overlay owns the elapsed/active choice; this one states its hour once, under the rows.
//
// AND IT REFUSES A RATE IT HAS NOT EARNED (`shared/rateBasis.ts`'s just-arrived gate). This window
// opens on a stay that is SECONDS old - you zone in and look at it - so it is the surface most
// exposed to the failure that gate exists for: MEASURED while writing tests/e2e/farm-overlay.e2e.mts,
// a 125 platinum sale one second into a stay read `450,000,000p/h`, which is the clock since you
// arrived, extrapolated. Under `RATE_MIN_MS` every per-hour figure here is an em-dash and the span
// line says `too short to rate` once, in the open, exactly as the XP window does. The COUNTS are
// never gated: "125p in this camp" is a fact about the log that a short stay does not make less true.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// HYDRATION IS A STATE AND THE WINDOW SAYS SO. A fold that has named no zone yet cannot answer any
// of the six questions above, and six em-dashes read as a broken window rather than as a young
// one — so the view collapses to ONE quiet line ("Reading log…"), the same word CombatView and the
// meters already use.

import type { LootEvent, ProgressionSnap } from '@shared/types'
import type { CoinRow } from '@shared/coinTypes'
import type { RangeStats } from '@shared/progressionStats'
import type { RespawnRow, RespawnSnap } from '@shared/respawn'
import { rangeStats } from '../../../shared/progressionStats'
import { currentZoneOf, resolveSlice, type SliceRange } from '../../../shared/timeslice'
import { UNKNOWN_ZONE, windowLootRates } from '../../../shared/lootRates'
import { zoneIdKey } from '../../../shared/zoneScope'
import { respawnInZone, respawnReading, respawnSourceLabel } from '../../../shared/respawn'
import { currentLevelRead, type LevelStatement } from '../../../shared/currentLevel'
// THE JUST-ARRIVED GATE (JOS-288), and the definition of the hour it gates. One seam, imported
// rather than re-worded: `pickRate` hands back null under `RATE_MIN_MS`, so the em-dash rule below
// covers the refusal without a second branch anywhere.
import { basisMs, basisRead, pickRate, type BasisRead, type BasisSpans } from '../../../shared/rateBasis'
import { dataBounds } from '../features/leveling/zoneBands'
import { fmtDuration } from '../features/leveling/levelChartGeometry'
// The m + ss spelling a countdown is read in — the respawn window's own, imported rather than
// re-written so "4m 12s" means the same thing on both surfaces.
import { fmtDuration as fmtClock } from '../features/buffs/format'
import { NONE, basisSpanText } from '../features/leveling/rangeStatsRows'
import { formatDropRate, formatKillRate, formatLevelRate } from '../lib/formatRate'

/** What this window says while the fold has not named a zone yet. State, never process. */
export const FARM_HYDRATING = 'Reading log…'

/** Nothing is being clocked in this camp. */
export const FARM_NO_WATCHES = 'no watched mobs'

/** Something is watched here, but no clock is running on it (no estimate, or long gone). */
export const FARM_NO_CLOCK = 'no clock running'

/**
 * THE DECLARED LADDER — copper per unit of each denomination.
 *
 * It is a CHOICE this file makes out loud, not a fact the log stated (see the header). The values
 * are EverQuest's standard conversion; what matters here is that they are written down in one
 * place, printed on the row that divides by them, and pinned by tests/farmRows.test.mts.
 */
export const COIN_LADDER = { platinum: 1000, gold: 100, silver: 10, copper: 1 } as const

/** The ladder as a reader sees it. It rides the coin row's own LABEL — never a tooltip. */
export const COIN_LADDER_TEXT = '1p=10g=100s=1000c'

/** How the coin row is titled. The assumption travels with the number by construction. */
export const COIN_ROW_LABEL = `Coin/h (${COIN_LADDER_TEXT})`

/** One printed line: `label · value`. Nothing else — this window has no second column. */
export interface FarmRow {
  /** stable id — the React key and the e2e's handle (`farm-row` + `data-row`). */
  id: string
  label: string
  /** the reading, or `-`. Never '0' for something the log did not say. */
  value: string
}

export interface FarmOverlayView {
  /** true ⇒ the fold has named no zone yet; `rows` is empty and the window draws one quiet line. */
  hydrating: boolean
  rows: FarmRow[]
  /** 'over 42m active' — one span for the whole window, stated once under the rows. */
  span: string
  /**
   * false ⇒ this stay is under `RATE_MIN_MS` and every per-hour figure on the window is an em-dash.
   * Surfaced so the window can say so ONCE, beside the span, instead of leaving four blanks.
   */
  measurable: boolean
  /** The camp this is all about, raw as the log spelled it. '' while hydrating. */
  zone: string
  /** The level the log last STATED, or null (the header chip is omitted). */
  level: number | null
  /** '/who' or 'Nh ago' beside that number; '' when the bare number is the whole fact. */
  levelCue: string
}

/**
 * Σ copper of one coin row, on the DECLARED ladder — a field the line did not name contributes
 * nothing, because "the line did not say" is not "you got none" (shared/coinTypes.ts).
 */
export function coinCopper(row: CoinRow): number {
  return (
    (row.platinum ?? 0) * COIN_LADDER.platinum +
    (row.gold ?? 0) * COIN_LADDER.gold +
    (row.silver ?? 0) * COIN_LADDER.silver +
    (row.copper ?? 0) * COIN_LADDER.copper
  )
}

/**
 * A copper amount as denominations, biggest first, zeroes dropped: `12p 5g 3s`.
 *
 * A whole number of copper in, so the caller decides the rounding. Exactly zero prints `0c` rather
 * than an empty string — a measured nothing is a fact and looks like one.
 */
export function coinText(copper: number): string {
  const total = Math.max(0, Math.round(copper))
  if (total === 0) return '0c'
  let left = total
  const parts: string[] = []
  for (const [unit, per] of [
    ['p', COIN_LADDER.platinum],
    ['g', COIN_LADDER.gold],
    ['s', COIN_LADDER.silver],
    ['c', COIN_LADDER.copper]
  ] as const) {
    const n = Math.floor(left / per)
    if (n > 0) parts.push(`${n.toLocaleString()}${unit}`)
    left -= n * per
  }
  return parts.join(' ')
}

/**
 * What the coin module said about one window, on the declared ladder — and how fast that was, said
 * over BOTH denominators.
 *
 * TWO RATES, exactly like `windowLootRates` beside it and for the same reason (JOS-261 rule 5):
 * neither reading may pass for the other, and a consumer picks the half its own basis is in force
 * (`rateBasis.pickRate`) rather than dividing again. The farm overlay is always `active`; the
 * Leveling tab's coin tile follows the tab's own toggle.
 */
export interface CoinWindow {
  /** Σ copper of every income row inside the window. */
  copper: number
  /** how many rows contributed. 0 ⇒ the log said nothing about coin here. */
  rows: number
  /** copper per hour of ACTIVE time. Null when there is no active time to divide by (rule 3). */
  copperPerHourActive: number | null
  /** copper per hour of ONLINE WALL time (`durationMs - offlineMs`). Null when that is 0. */
  copperPerHourWall: number | null
}

const MS_PER_HOUR = 3_600_000

/**
 * WHICH ZONES A COIN ROW MAY HAVE COME FROM: exactly the ones `rangeStats` admitted.
 *
 * The membership is taken from `RangeStats.zones` rather than re-derived from a slice, and that is
 * the point — `rangeStats` has already applied the whole membership (place fold, tier fold, the
 * pre-first-zone-line `unknown` remainder and all), so a numerator built on this set and the
 * `activeMs` it is divided by admit the same instants BY CONSTRUCTION. Two surfaces read it: the
 * farm overlay, whose stats are the current zone stay, and the Leveling tab's coin tile, whose
 * stats are whatever the tab's slice or drag is scoped to. Neither has to know a fold's name.
 *
 * The keys are the ROW fold (`zoneScope.zoneIdKey`), which is the identity `rangeStats` groups its
 * zone rows by — so a camp the log spelled two ways is two keys here, exactly as it is there.
 */
export function coinZoneKeys(zones: readonly { zone: string }[]): Set<string> {
  const keys = new Set<string>()
  for (const z of zones) keys.add(zoneIdKey(z.zone))
  return keys
}

/**
 * Coin in one window, summed and divided — the ONE place this repo turns denominations into a
 * single number, and it does it against `COIN_LADDER` in the open.
 *
 * A row folded before the scan reached a zone line arrives as `unknown`, exactly as a loot row
 * does, and it is admitted only where `rangeStats` admitted the same remainder (law 1: never guess
 * where it happened).
 *
 * A `for` loop rather than filter/reduce: the renderer never munges domain data
 * (eslint.domainMunging.mjs), and `windowLootRates` beside it counts the same way for the same
 * reason.
 */
export function coinWindow(args: {
  rows: readonly CoinRow[]
  range: SliceRange
  /** `rangeStats(...)` for THIS window, assignable verbatim — never a second query over a wider
   *  one. The whole spans object rather than a bare `activeMs` for `windowLootRates`' reason: the
   *  two denominators travel together or they drift apart. */
  spans: BasisSpans
  /** `coinZoneKeys(stats.zones)` — the zones that window's own denominator was measured over. */
  zoneKeys: ReadonlySet<string>
}): CoinWindow {
  let copper = 0
  let rows = 0
  for (const row of args.rows) {
    if (row.ts < args.range.t0 || row.ts >= args.range.t1) continue
    if (!args.zoneKeys.has(zoneIdKey(row.zone ?? UNKNOWN_ZONE))) continue
    copper += coinCopper(row)
    rows += 1
  }
  return {
    copper,
    rows,
    copperPerHourActive: copperPerHour(copper, basisMs('active', args.spans)),
    copperPerHourWall: copperPerHour(copper, basisMs('elapsed', args.spans))
  }
}

/** One division, guarded. Null is "there was no hour to divide by", never a zero somebody stated. */
function copperPerHour(copper: number, ms: number): number | null {
  return ms > 0 ? (copper * MS_PER_HOUR) / ms : null
}

/** A rate, or the em-dash. Null is "there was no hour to divide by", never zero. */
function rate(n: number | null | undefined, fmt: (v: number) => string): string {
  return n == null ? NONE : fmt(n)
}

/**
 * THE CLOCK THAT MATTERS NEXT — the watched mob in THIS camp whose estimate has least left.
 *
 * Zone-scoped through `respawnInZone`, the respawn module's own helper, for the ruling the respawn
 * window carries in its header: a Befallen camp does not want four Guk clocks. Rows with no running
 * clock (no estimate, or an estimate that elapsed long enough ago to have stopped meaning anything)
 * are not candidates — a "next respawn" that is hours past is not next.
 *
 * The provenance is `respawnSourceLabel`, so the number is never printed without the log's own
 * account of where it came from: `your kills (3 gaps)` is a measured GAP and an upper bound on the
 * respawn, which is exactly what a farm meter must not quietly present as a spawn time.
 */
function nextRespawnValue(snap: RespawnSnap, nowMs: number): string {
  const here = respawnInZone(snap.rows, snap.zone)
  if (here.length === 0) return FARM_NO_WATCHES
  let best: { row: RespawnRow; leftMs: number } | null = null
  for (const row of here) {
    const read = respawnReading(row, nowMs)
    if (read.stale || read.remainingMs === undefined) continue
    if (best === null || read.remainingMs < best.leftMs) best = { row, leftMs: read.remainingMs }
  }
  if (best === null) return FARM_NO_CLOCK
  return `${best.row.display} · ~${fmtClock(best.leftMs)} · ${respawnSourceLabel(best.row)}`
}

/**
 * The coin row's value: what came in, and - once the stay has earned it - what that is per hour on
 * the declared ladder.
 *
 * THE TOTAL IS NEVER GATED, only the rate. "125p in this camp" is a fact about the log that ninety
 * seconds does not make less true; "450,000,000p/h" over those ninety seconds is the extrapolation
 * (the WindowDropsPanel rule, in a floating window).
 */
function coinValue(coin: CoinWindow, read: BasisRead): string {
  if (coin.rows === 0) return NONE
  const perHour = pickRate(read, coin.copperPerHourActive, coin.copperPerHourWall)
  return perHour === null
    ? coinText(coin.copper)
    : `${coinText(coin.copper)} · ${coinText(perHour)}/h`
}

export interface FarmRowsArgs {
  snap: ProgressionSnap
  /** Every loot event this character has, oldest first (the `loot` module's snapshot). */
  loot: readonly LootEvent[]
  /** Every coin sentence this character has (the `coin` module's rows). */
  coin: readonly CoinRow[]
  /** The `respawn` module's snapshot — its rows and the zone it says the fold is in. */
  respawn: RespawnSnap
  /** `CharacterSnap.level` — the stated level fact. Absent ⇒ the ding tail stands in. */
  level?: LevelStatement | null
  /** The instant the countdown is read against. Absent ⇒ `snap.lastTs`, the LOG's own clock. */
  nowMs?: number
}

/** The six readings, in the order a farmer asks for them. Its own function so `farmOverlayView`
 *  stays a composition and inside the measured complexity ceiling. */
function farmRows(args: {
  zone: string
  stats: RangeStats
  read: BasisRead
  drops: { active: number | null; wall: number | null }
  coin: CoinWindow
  respawn: RespawnSnap
  nowMs: number
}): FarmRow[] {
  const { stats, read } = args
  return [
    {
      id: 'here',
      label: 'Here',
      value: `${args.zone} · ${fmtDuration(stats.durationMs)} since zoning`
    },
    {
      id: 'kills',
      label: 'Kills/h',
      value: rate(pickRate(read, stats.killsPerHourActive, stats.killsPerHourWall), formatKillRate)
    },
    {
      id: 'xp',
      label: 'XP/h',
      value: rate(pickRate(read, stats.levelsPerHourActive, stats.levelsPerHourWall), formatLevelRate)
    },
    {
      id: 'drops',
      label: 'Drops/h',
      value: rate(pickRate(read, args.drops.active, args.drops.wall), formatDropRate)
    },
    { id: 'coin', label: COIN_ROW_LABEL, value: coinValue(args.coin, read) },
    { id: 'respawn', label: 'Next respawn', value: nextRespawnValue(args.respawn, args.nowMs) }
  ]
}

/**
 * The whole window, from four snapshots and the current zone stay. EXACTLY ONE `rangeStats` call:
 * the pace, the drops' denominator and the coin's denominator all read the same object, so nothing
 * on screen can be measured over a different stretch than the span line claims.
 */
export function farmOverlayView(args: FarmRowsArgs): FarmOverlayView {
  const { snap, respawn } = args
  const zone = currentZoneOf(snap)
  const n = snap.zoneStart.length
  const read = currentLevelRead(args.level, snap)
  if (zone === null || n === 0) {
    return {
      hydrating: true,
      rows: [],
      span: '',
      measurable: false,
      zone: '',
      level: read?.level ?? null,
      levelCue: read?.cue ?? ''
    }
  }
  const bounds = dataBounds(snap, [])
  // THE STAY, as a CUSTOM slice with a caption (see the header). `resolveSlice` clamps it inside the
  // record and words it; the zone half is this camp's own PLACE fold, applied below.
  // THE OPEN END IS `Infinity`, NOT `lastTs`, and the difference is the newest line in the log.
  // `resolveSlice`'s clamp resolves `+Infinity` to the record's own end — `lastTs + TAIL_MS` — which
  // is what makes the range HOLD the last event rather than stopping half-open one millisecond
  // short of it. Every preset slice in this app ends there for the same reason; spelling `lastTs`
  // here would drop the coin sentence the player is watching for, until the next line arrived.
  const slice = resolveSlice({
    snap,
    bounds,
    id: 'custom',
    custom: { t0: snap.zoneStart[n - 1], t1: Infinity },
    customCaption: 'since zoning in'
  })
  const stats = rangeStats({ snap, range: slice.range, zoneKey: zone.key })
  const drops = windowLootRates({
    events: args.loot,
    t0: slice.range.t0,
    t1: slice.range.t1,
    spans: stats,
    zoneKey: zone.key
  })
  const coin = coinWindow({
    rows: args.coin,
    range: slice.range,
    spans: stats,
    zoneKeys: coinZoneKeys(stats.zones)
  })
  // ONE BASIS READ FOR THE WHOLE WINDOW, resolved beside the one `rangeStats` call and handed to
  // every row: the span line states the denominator, and a row measured over a different one than
  // the caption claims is the exact drift that line exists to prevent.
  const basis = basisRead('active', stats)
  return {
    hydrating: false,
    rows: farmRows({
      zone: zone.name,
      stats,
      read: basis,
      drops: { active: drops.dropsPerHourActive, wall: drops.dropsPerHourWall },
      coin,
      respawn,
      nowMs: args.nowMs ?? snap.lastTs
    }),
    span: basisSpanText(basis),
    measurable: basis.measurable,
    zone: zone.name,
    level: read?.level ?? null,
    levelCue: read?.cue ?? ''
  }
}
