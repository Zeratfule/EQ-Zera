// progressionStats.ts — the PURE range query over ProgressionSnap (see
// docs/plans/leveling-analytics.md §4). No React, no Electron, no I/O: one function over one
// columnar snapshot, so the whole feature's arithmetic is unit-testable without a window.
//
// It lives in src/shared (not src/main) because BOTH tsconfigs must see it: main folds the
// snapshot, the renderer queries it, and the node tests import it directly.
//
// WHAT THE NUMBERS MEAN (law 1 — say what the log cannot say):
//   • `levelEquiv` is Σ of the STATED level-bar percentages / 100 — "levels of progress",
//     NEVER "experience points". The log prints a per-kill percentage of the CURRENT level's
//     bar and nothing else: no raw exp number, no to-next-level total, no bar position. 1% at
//     level 40 is far more raw experience than 1% at level 10, so these are levels, not xp.
//   • An exp line that stated NO percentage (the game prints one only while a level bar
//     exists — in the real log every such line sits inside one contiguous at-the-cap window)
//     contributes to `expUnstated` and to NOTHING else. It is never counted as 0%.
//     When a range's exp samples are ALL unstated, every levels-rate is `null`, not 0.0:
//     unknown is not zero. (This is stricter than the plan text, which nulls the rates only
//     on activeMs === 0 — a "0.0 levels/hr" over a window where the game refused to report
//     progress would be a fabricated number.)
//   • `kills` counts CREDITED kills only (your killing blow + a bound pet's). Kills you
//     merely witnessed are `killsWitnessed` and enter no rate, so a busy zone full of other
//     players cannot inflate your farming numbers.
//   • IDLE is PRESENT-BUT-UNPRODUCTIVE; OFFLINE is ABSENT. These are two different claims and
//     this file keeps them in two different fields.
//
//     Within a session the log records EVENTS, not PRESENCE — medding, banking, crafting,
//     travelling and being AFK at the keyboard are all the same silence, and `idleMs` is that
//     silence. Call it "idle": never "AFK" (the log cannot see a chair) and never "offline"
//     (see below).
//
//     What the log CAN state is a logout, and only in hindsight: the `offlineGap` derived
//     event is emitted after the login line ("Welcome to EverQuest Legends!") that ENDED the
//     absence, carrying the camp line's evidence when there was one. Those intervals are
//     `offlineMs`, they are SUBTRACTED out of `idleMs` (a logout is not medding), and they are
//     the reason a 13.7-hour overnight no longer reads as the largest idle gap of the week.
//
//     THE LIMIT, STATED (laws 1/6): the user may be logged out RIGHT NOW and this app cannot
//     know it — the only evidence would be a login line that has not been written yet. So
//     silence at the LIVE EDGE is still idle, and no surface may call it offline. When the
//     snapshot carries no offline interval at all, every number here is byte-identical to what
//     it was before offline existed.

// Imported from the transport module directly (types.ts re-exports the same names) — a shared
// file importing the barrel it is part of would be a needless cycle.
import type { ProgressionSnap } from './progressionTypes'
import type { RangeStats, RangeStatsArgs, ZoneRangeRow } from './progressionStatsTypes'
// THE MEMBERSHIP TEST for the optional zone filter (JOS-130), and since JOS-291 the CHOICE of
// which of this app's two zone folds it runs on. `zoneAdmits` is the one predicate every surface
// asks; `zoneIdKey` is the row fold, which lives beside it now and is re-exported below so every
// existing importer of `progressionStats.zoneIdKey` is untouched.
import { zoneAdmits, zoneIdKey } from './zoneScope'

/**
 * No exp / credited-kill / loot event for LONGER than this ⇒ idle.
 *
 * MEASURED, not guessed: over the 9869 post-epoch activity events the inter-activity gap
 * distribution is p50 4s · p75 25s · p90 52s · p95 87s · p99 314s · max 13.7h. 5 minutes sits
 * just above p99, so under 1% of ordinary between-pull gaps get misread as idle, and the
 * sensitivity curve flattens hard right after it (5m → 10m moves only 4 points of a 146h
 * span). It is a CLASSIFIER, not a grace period: a qualifying gap contributes its WHOLE
 * length to idle time, not `gap - threshold`. Surface it (`RangeStats.idleThresholdMs`)
 * wherever an idle number is shown — the threshold is a choice, not a fact.
 */
export const IDLE_GAP_MS = 5 * 60_000

/** The row that covers range time before the first known zone line. */
const UNKNOWN_ZONE = 'unknown'

const MS_PER_HOUR = 3_600_000

/**
 * THE WALL DENOMINATOR, IN ONE PLACE: `durationMs - offlineMs`, floored at 0.
 *
 * It is not a new quantity — `levelsPerHourWall` has divided by exactly this since offline landed,
 * and `lootRates.windowLootRates` (JOS-261) by exactly this again. It is a FUNCTION now because
 * JOS-288 puts the same denominator under the AA rates and under the XP overlay's whole window, and
 * a fourth hand-typed subtraction is how world-model law 12's drift gets a clock in it. Every
 * surface that says "elapsed" divides by this and nothing else.
 *
 * What stays IN is the point of it: medding, banking, looting and travelling are hours you spent,
 * and only a logout the log CLOSED with a login line comes out.
 */
export function wallMs(spans: { durationMs: number; offlineMs: number }): number {
  return Math.max(0, spans.durationMs - spans.offlineMs)
}

// THE SHAPES THIS FILE ANSWERS WITH LIVE NEXT DOOR (JOS-288) — `progressionStatsTypes.ts`, split
// out under the SPLIT-NEVER-RATCHET law when the elapsed halves of three rates pushed this file
// past the measured 400-line ceiling. They are RE-EXPORTED here, so every `@shared/progressionStats`
// importer in the repo is untouched and there is still one name for each shape.
export type {
  ComboInterval,
  ComboSource,
  RangeStats,
  RangeStatsArgs,
  ZoneRangeRow
} from './progressionStatsTypes'

/**
 * The zone restriction, as the segment walk reads it: the PLACE key every admitted visit must fold
 * to, and — under `exactTier` (JOS-291) — the ROW key it must ALSO match. One object because the
 * two travel together or they drift apart, and because `max-params` is 4.
 */
interface ZoneFilter {
  key: string | null
  exact: string | null
}

/** One clipped zone visit inside the range. Contiguous and gapless by construction. */
interface ZoneSeg {
  key: string
  name: string
  start: number
  end: number
}

interface Span {
  start: number
  end: number
}

/**
 * The ROW fold — case-insensitive, instance noise KEPT. `ZoneRangeRow` rows are grouped by it and
 * `lootRates.ts` joins drops onto them by it.
 *
 * It MOVED to `shared/zoneScope.ts` (JOS-291), which is where the full argument for this app's two
 * zone folds now lives: the day membership became a choice BETWEEN them, one file had to own both.
 * Re-exported here rather than relocated in every caller, so `@shared/progressionStats`'s importers
 * are untouched and there is still exactly one name for the fold.
 */
export { zoneIdKey } from './zoneScope'

/** First index i with arr[i] >= v (arr ascending). */
function lowerBound(arr: readonly number[], v: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** First index i with arr[i] > v (arr ascending). */
function upperBound(arr: readonly number[], v: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The last value strictly before `t`, or null. */
function prevBefore(arr: readonly number[], t: number): number | null {
  const i = lowerBound(arr, t)
  return i > 0 ? arr[i - 1] : null
}

/** The first value at or after `t`, or null. */
function nextFrom(arr: readonly number[], t: number): number | null {
  const i = lowerBound(arr, t)
  return i < arr.length ? arr[i] : null
}

/**
 * The zone visits covering [t0,t1), clipped, in order. The pre-first-zone remainder gets its
 * own `unknown` segment and the still-open final interval runs to the end of the SELECTION
 * (you never left it) — together those two rules are what make `Σ zones[].spanMs ==
 * durationMs` an identity rather than an approximation.
 */
function zoneSegments(snap: ProgressionSnap, t0: number, t1: number, only?: ZoneFilter): ZoneSeg[] {
  const segs: ZoneSeg[] = []
  const n = snap.zoneName.length
  const headEnd = Math.min(n > 0 ? snap.zoneStart[0] : t1, t1)
  const admits = (name: string): boolean => zoneAdmits(name, only?.key, only?.exact)
  // The pre-first-zone remainder is a NAMED row (`unknown`) and a zone filter judges it like any
  // other: asking for one zone never quietly re-admits the stretch the log could not place.
  if (headEnd > t0 && admits(UNKNOWN_ZONE)) {
    segs.push({ key: UNKNOWN_ZONE, name: UNKNOWN_ZONE, start: t0, end: headEnd })
  }
  // The last interval starting at/before t0 is the one we are inside when the range opens.
  for (let i = Math.max(0, upperBound(snap.zoneStart, t0) - 1); i < n && snap.zoneStart[i] < t1; i++) {
    const start = Math.max(snap.zoneStart[i], t0)
    const end = Math.min(snap.zoneEnd[i] === 0 ? t1 : snap.zoneEnd[i], t1)
    const name = snap.zoneName[i]
    // Grouped by the ROW fold, admitted by the MEMBERSHIP test — see `RangeStatsArgs.zoneKey`.
    if (end > start && admits(name)) {
      segs.push({ key: zoneIdKey(name), name, start, end })
    }
  }
  return segs
}

/**
 * Index of the segment containing `ts`, or -1 when no segment does.
 *
 * EXACT CONTAINMENT, never a clamp. Unfiltered the two are the same test — `zoneSegments` covers
 * `[t0,t1)` contiguously and gaplessly, so every in-range sample lands inside a segment and the
 * `Σ zones[].kills == kills` identity holds exactly as before. Under a zone filter the segments
 * are disjoint but NOT contiguous, and a clamp would file a kill from the zone next door into the
 * nearest visit of the zone you asked about.
 */
function segAt(segs: readonly ZoneSeg[], ts: number): number {
  let lo = 0
  let hi = segs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (segs[mid].end <= ts) lo = mid + 1
    else hi = mid
  }
  return lo < segs.length && segs[lo].start <= ts ? lo : -1
}

/**
 * `spans` ∩ `segs` — both ascending and disjoint. This is what keeps a zone-filtered range's idle
 * and offline inside the visits they are being attributed to, so the Σ identity still holds when
 * the range is full of holes.
 */
function intersectSpans(spans: readonly Span[], segs: readonly ZoneSeg[]): Span[] {
  const out: Span[] = []
  for (const s of spans) {
    for (const g of segs) {
      const start = Math.max(s.start, g.start)
      const end = Math.min(s.end, g.end)
      if (end > start) out.push({ start, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * The idle spans inside [t0,t1]. The stream is exp ∪ credited kill ∪ loot; the samples
 * BRACKETING the range are pulled in unconditionally (not merely padded by the threshold) so
 * a gap that STRADDLES a selection edge is measured instead of the edge manufacturing
 * activity. When no bracketing sample exists the edge itself anchors the walk — silence with
 * nothing before it is still silence.
 */
function idleSpans(snap: ProgressionSnap, t0: number, t1: number): Span[] {
  const cols = [snap.expTs, snap.killTs, snap.lootTs]
  const stream: number[] = []
  for (const col of cols) for (let i = lowerBound(col, t0); i < lowerBound(col, t1); i++) stream.push(col[i])
  stream.sort((a, b) => a - b)
  const prev = cols.map((c) => prevBefore(c, t0)).filter((v): v is number => v !== null)
  const next = cols.map((c) => nextFrom(c, t1)).filter((v): v is number => v !== null)
  const walk = [prev.length ? Math.max(...prev) : t0, ...stream, next.length ? Math.min(...next) : t1]
  const spans: Span[] = []
  for (let i = 1; i < walk.length; i++) {
    if (walk[i] - walk[i - 1] <= IDLE_GAP_MS) continue
    const start = Math.max(walk[i - 1], t0)
    const end = Math.min(walk[i], t1)
    if (end > start) spans.push({ start, end })
  }
  return spans
}

/**
 * The offline intervals overlapping [t0,t1), clipped to it. Ascending and disjoint by
 * construction (each row is one `offlineGap`, and a gap ends where the session that ended it
 * begins), so no merging is needed — and none is invented: an interval is quoted exactly as
 * the log's two lines stated it.
 */
function offlineSpansIn(snap: ProgressionSnap, t0: number, t1: number): Span[] {
  const out: Span[] = []
  const n = snap.offlineStart.length
  for (let i = Math.max(0, upperBound(snap.offlineStart, t0) - 1); i < n && snap.offlineStart[i] < t1; i++) {
    const start = Math.max(snap.offlineStart[i], t0)
    const end = Math.min(snap.offlineEnd[i], t1)
    if (end > start) out.push({ start, end })
  }
  return out
}

/**
 * How much of [t0,t1) the log says you were logged out. Exported because the Overview card's
 * per-level history needs the same subtraction over spans this file never sees (a level took
 * 13.9 hours only if you were there for them).
 */
export function offlineMsIn(snap: ProgressionSnap, t0: number, t1: number): number {
  return offlineSpansIn(snap, t0, t1).reduce((n, s) => n + (s.end - s.start), 0)
}

/**
 * `spans` minus `cuts` — both ascending and disjoint. This is what makes idle and offline
 * DISJOINT rather than double-counted: an offline interval always sits inside a silence (you
 * killed nothing while logged out), so without the subtraction the same hours would be both,
 * and `active + idle + offline == duration` could not hold.
 *
 * A cut through the middle of a silence SPLITS it, which is honest: the minutes before you
 * camped and the minutes after you logged back in are separate stretches of being present and
 * quiet, and neither is the logout.
 */
function subtractSpans(spans: readonly Span[], cuts: readonly Span[]): Span[] {
  if (cuts.length === 0) return [...spans]
  const out: Span[] = []
  for (const s of spans) {
    let start = s.start
    for (const c of cuts) {
      if (c.end <= start || c.start >= s.end) continue
      if (c.start > start) out.push({ start, end: c.start })
      start = c.end
    }
    if (start < s.end) out.push({ start, end: s.end })
  }
  return out
}

/** How much of `spans` falls inside [start,end). Spans are disjoint, so this is a plain Σ. */
function overlapMs(spans: readonly Span[], start: number, end: number): number {
  let total = 0
  for (const s of spans) {
    const overlap = Math.min(s.end, end) - Math.max(s.start, start)
    if (overlap > 0) total += overlap
  }
  return total
}

function newRow(zone: string): ZoneRangeRow {
  return {
    zone,
    spanMs: 0,
    activeMs: 0,
    idleMs: 0,
    offlineMs: 0,
    visits: 0,
    kills: 0,
    killsSelf: 0,
    killsPet: 0,
    levelEquiv: 0,
    expUnstated: 0,
    expSamples: 0,
    levelsPerHourActive: null,
    levelsPerHourWall: null,
    killsPerHourActive: null,
    killsPerHourWall: null
  }
}

/**
 * A rate per hour, or null when the window is zero-length. `perHour` is deliberately NOT
 * called for the levels rates when the range's exp samples were all unstated — see
 * `levelsUnknown`.
 */
function perHour(amount: number, windowMs: number): number | null {
  return windowMs > 0 ? amount / (windowMs / MS_PER_HOUR) : null
}

/** True when the log gained experience here but never stated how much (law 1: unknown ≠ 0). */
function levelsUnknown(expSamples: number, expUnstated: number): boolean {
  return expSamples > 0 && expSamples === expUnstated
}

/** Rows in segment order, one per distinct zone key, with spanMs/visits/idle/offline folded in. */
function buildRows(
  segs: readonly ZoneSeg[],
  idle: readonly Span[],
  offline: readonly Span[]
): { rows: ZoneRangeRow[]; of: number[] } {
  const index = new Map<string, number>()
  const rows: ZoneRangeRow[] = []
  const of: number[] = []
  for (const seg of segs) {
    let at = index.get(seg.key)
    if (at === undefined) {
      at = rows.length
      index.set(seg.key, at)
      rows.push(newRow(seg.name))
    }
    of.push(at)
    rows[at].spanMs += seg.end - seg.start
    rows[at].visits += 1
    // Split every idle AND offline span at the zone boundaries it crosses, so per-zone idle
    // and offline each sum to the range's own total EXACTLY (the attribution is exact — a zone
    // line is a real event — even though WHY you were idle there is not in the log at all).
    // In practice an offline span never crosses one: the login writes a fresh zone line, so
    // the whole absence belongs to the camp you left.
    rows[at].idleMs += overlapMs(idle, seg.start, seg.end)
    rows[at].offlineMs += overlapMs(offline, seg.start, seg.end)
  }
  return { rows, of }
}

/** The per-range scratch every fold writes through: the clipped visits, their rows, and the
 *  segment→row index. Bundled because ESLint `max-params` is 4 and each fold also needs the
 *  snapshot and the bounds. */
interface FoldCtx {
  segs: readonly ZoneSeg[]
  rows: ZoneRangeRow[]
  of: readonly number[]
  t0: number
  t1: number
}

/** The row a sample at `ts` belongs to, or null when no segment holds that instant. */
function rowAt(ctx: FoldCtx, ts: number): ZoneRangeRow | null {
  const at = segAt(ctx.segs, ts)
  return at < 0 ? null : ctx.rows[ctx.of[at]]
}

/**
 * Third-party kills inside the range. Unfiltered this is the O(1) index subtraction it always
 * was; a zone filter costs a walk, because a witnessed kill carries only a timestamp and the
 * segments it must be tested against are no longer contiguous.
 */
function witnessedIn(snap: ProgressionSnap, ctx: FoldCtx, filtered: boolean): number {
  const lo = lowerBound(snap.witnessTs, ctx.t0)
  const hi = lowerBound(snap.witnessTs, ctx.t1)
  if (!filtered) return hi - lo
  let n = 0
  for (let i = lo; i < hi; i++) if (segAt(ctx.segs, snap.witnessTs[i]) >= 0) n++
  return n
}

/**
 * The range's silence and its logouts — both already clipped to `segs` when a zone filter is in
 * force. Bundled because `max-params` is 4 and because the two are derived TOGETHER: offline is
 * carved out of the silence it sits in (see `subtractSpans`) before either is clipped, so a zone
 * row's idle and its offline can never claim the same instant.
 */
function rangeSpans(o: {
  snap: ProgressionSnap
  segs: readonly ZoneSeg[]
  t0: number
  t1: number
  filtered: boolean
}): { idle: Span[]; offline: Span[] } {
  const { snap, segs, t0, t1, filtered } = o
  if (t1 <= t0) return { idle: [], offline: [] }
  const offline = offlineSpansIn(snap, t0, t1)
  const idle = subtractSpans(idleSpans(snap, t0, t1), offline)
  return filtered
    ? { idle: intersectSpans(idle, segs), offline: intersectSpans(offline, segs) }
    : { idle, offline }
}

/** Fold the credited kills of [t0,t1) into the range totals and their zone rows. */
function foldKills(snap: ProgressionSnap, ctx: FoldCtx): Pick<RangeStats, 'kills' | 'killsSelf' | 'killsPet'> {
  let kills = 0
  let killsSelf = 0
  let killsPet = 0
  for (let i = lowerBound(snap.killTs, ctx.t0); i < lowerBound(snap.killTs, ctx.t1); i++) {
    // The ROW decides membership, not the range: unfiltered every in-range sample has one (the
    // segments are contiguous), and under a zone filter a sample with no row happened somewhere
    // this slice is not about, so it enters neither the row nor the total.
    const row = rowAt(ctx, snap.killTs[i])
    if (!row) continue
    const pet = snap.killCredit[i] === 1
    kills++
    if (pet) killsPet++
    else killsSelf++
    row.kills++
    if (pet) row.killsPet++
    else row.killsSelf++
  }
  return { kills, killsSelf, killsPet }
}

/** Fold the experience samples of [t0,t1) into the range totals and their zone rows. */
function foldExp(
  snap: ProgressionSnap,
  ctx: FoldCtx
): Pick<RangeStats, 'expSamples' | 'expParty' | 'expUnstated' | 'levelEquiv'> {
  let expSamples = 0
  let expParty = 0
  let expUnstated = 0
  let levelEquiv = 0
  for (let i = lowerBound(snap.expTs, ctx.t0); i < lowerBound(snap.expTs, ctx.t1); i++) {
    // Membership is the row's, exactly as in `foldKills` — see the note there.
    const row = rowAt(ctx, snap.expTs[i])
    if (!row) continue
    const unstated = (snap.expFlag[i] & 1) !== 0
    const equiv = unstated ? 0 : snap.expPct[i] / 100
    expSamples++
    if ((snap.expFlag[i] & 2) !== 0) expParty++
    if (unstated) expUnstated++
    levelEquiv += equiv
    row.expSamples++
    row.levelEquiv += equiv
    if (unstated) row.expUnstated++
  }
  return { expSamples, expParty, expUnstated, levelEquiv }
}

/** Dings in range (and inside the range's segments, which is the same set unless a zone filter
 *  is in force), plus the disjoint runs a loadout swap splits them into. */
function levelSeriesIn(snap: ProgressionSnap, ctx: FoldCtx): Pick<RangeStats, 'levelUps' | 'levelRuns'> {
  const { t0, t1, segs } = ctx
  const levelUps: RangeStats['levelUps'] = []
  const levelRuns: RangeStats['levelRuns'] = []
  for (let i = lowerBound(snap.levelTs, t0); i < lowerBound(snap.levelTs, t1); i++) {
    const ts = snap.levelTs[i]
    if (segAt(segs, ts) < 0) continue
    const level = snap.levelValue[i]
    levelUps.push({ ts, level })
    const run = levelRuns[levelRuns.length - 1]
    if (!run || level < run.toLevel) levelRuns.push({ fromLevel: level, toLevel: level, startTs: ts, endTs: ts })
    else {
      run.toLevel = level
      run.endTs = ts
    }
  }
  return { levelUps, levelRuns }
}

/** Fill in each row's derived activeMs + rates. Mutates in place. */
function finishRows(rows: ZoneRangeRow[]): void {
  for (const row of rows) {
    row.activeMs = Math.max(0, row.spanMs - row.idleMs - row.offlineMs)
    // ONLINE wall: the hours you were logged out of this camp are not hours it paid badly in. The
    // row's wall clock is its `spanMs` (Σ of its visits), so that is what goes in as `durationMs`.
    const wall = wallMs({ durationMs: row.spanMs, offlineMs: row.offlineMs })
    const unknown = levelsUnknown(row.expSamples, row.expUnstated)
    row.levelsPerHourActive = unknown ? null : perHour(row.levelEquiv, row.activeMs)
    row.levelsPerHourWall = unknown ? null : perHour(row.levelEquiv, wall)
    row.killsPerHourActive = perHour(row.kills, row.activeMs)
    row.killsPerHourWall = perHour(row.kills, wall)
  }
}

/**
 * Everything a drag-selected time range says about progression. Pure: same snapshot + same
 * range ⇒ same answer, no clock read, no I/O. `RangeStatsArgs` is a single object because the
 * repo's ESLint `max-params` is 4 and this would otherwise be at the ceiling.
 */
export function rangeStats(args: RangeStatsArgs): RangeStats {
  const { snap, range, combo, zoneKey } = args
  const t0 = range.t0
  const t1 = Math.max(range.t0, range.t1)
  // THE EXACT KEY NARROWS; IT NEVER STANDS ALONE (JOS-291). Absent ⇒ this query is byte-identical
  // to the one this file has answered since JOS-130 — which is what the golden windows pin.
  const zoneExactKey = args.zoneExactKey ?? null
  const filtered = zoneKey != null || zoneExactKey != null
  const segs = zoneSegments(snap, t0, t1, { key: zoneKey ?? null, exact: zoneExactKey })
  // WHAT THE RANGE IS WORTH IN TIME. Unfiltered the segments tile `[t0,t1)` exactly, so this is
  // the wall clock it has always been; under a zone filter it is Σ of the visits, which is the
  // only denominator a per-zone rate may divide by.
  const durationMs = filtered ? segs.reduce((n, s) => n + (s.end - s.start), 0) : t1 - t0
  const { idle: spans, offline } = rangeSpans({ snap, segs, t0, t1, filtered })
  const { rows, of } = buildRows(segs, spans, offline)
  const idleMs = spans.reduce((n, s) => n + (s.end - s.start), 0)
  const offlineMs = offline.reduce((n, s) => n + (s.end - s.start), 0)
  const activeMs = Math.max(0, durationMs - idleMs - offlineMs)
  // The ONLINE WALL denominator, computed ONCE for every rate below that divides by it (JOS-288's
  // `wallMs` — see that function for why it is not spelled out four times).
  const wall = wallMs({ durationMs, offlineMs })
  const ctx: FoldCtx = { segs, rows, of, t0, t1 }
  const kills = foldKills(snap, ctx)
  const exp = foldExp(snap, ctx)
  finishRows(rows)
  const unknown = levelsUnknown(exp.expSamples, exp.expUnstated)
  let aaGained = 0
  let aaEvents = 0
  for (let i = lowerBound(snap.aaGainTs, t0); i < lowerBound(snap.aaGainTs, t1); i++) {
    if (segAt(segs, snap.aaGainTs[i]) < 0) continue
    aaGained += snap.aaGainAmount[i]
    aaEvents++
  }
  return {
    t0,
    t1,
    durationMs,
    activeMs,
    idleMs,
    idleGaps: spans.length,
    idleThresholdMs: IDLE_GAP_MS,
    offlineMs,
    offlineGaps: offline.length,
    ...kills,
    killsWitnessed: witnessedIn(snap, ctx, filtered),
    ...exp,
    levelsPerHourActive: unknown ? null : perHour(exp.levelEquiv, activeMs),
    // ONLINE wall (duration - offline): a rate whose denominator counted a logout is a
    // statement about an empty chair. See the field's doc.
    levelsPerHourWall: unknown ? null : perHour(exp.levelEquiv, wall),
    killsPerHourActive: perHour(kills.kills, activeMs),
    killsPerHourWall: perHour(kills.kills, wall),
    ...levelSeriesIn(snap, ctx),
    aaGained,
    aaGainEvents: aaEvents,
    aaPerHourActive: perHour(aaEvents, activeMs),
    aaPointsPerHourActive: perHour(aaGained, activeMs),
    // The wall halves (JOS-288). Same numerators, the other honest denominator — so a surface can
    // show the pair the way the loot ledger shows its pair, and neither reading passes for the other.
    aaPerHourWall: perHour(aaEvents, wall),
    aaPointsPerHourWall: perHour(aaGained, wall),
    zones: rows,
    combos: combo ? combo.intervalsIn(t0, t1) : [],
    clipped: snap.windowStart > 0 && t0 < snap.windowStart
  }
}
