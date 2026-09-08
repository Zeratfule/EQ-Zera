// levelCurve.ts — THE FRACTIONAL LEVEL OVER TIME, and the stretches where the log refuses to
// say (JOS-292).
//
// Pure: no React, no DOM, no MUI, and only TYPE imports from `@shared` — the same constraint
// levelChartGeometry.ts and zoneBands.ts document, so tests/levelCurve.test.mts imports it
// straight under tsx.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHAT IS BEING DRAWN, AND WHY IT IS NOT AN INVENTION
//
// The log never states a bar position. It states a PERCENT OF THE CURRENT BAR per kill
// (`You gain experience! (4.283%)`) and a ding (`Welcome to level 19!`). So the only bar
// position anybody can know is: the last ding, plus every stated percent since it. That is
// exactly what `shared/levelEta.ts` already sums to answer "when will I level", and this file
// is the same arithmetic asked at every instant instead of only at the tail — the ticket's
// "the graph draws the xp rate, not just the stairsteps".
//
// The old picture was the ding series alone: ~60 steps over 1.4M lines, so a whole evening of
// farming was a flat line with a cliff at the end. The curve is the SAME evidence at the
// resolution the log actually carries it (~5,500 stated lines).
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE HONESTY RULE, AND THE FOUR WAYS IT BITES
//
// A curve pixel must never claim a bar position the log did not state. Four things break the
// sum, and each one ENDS the drawn run rather than degrading it — the refusal vocabulary is
// levelEta's own (`EtaBlocked`), because two surfaces refusing the same evidence for the same
// reason must use the same word:
//
//   unstated — an exp line in this bar stated no percent (`You gain experience!` with nothing
//              after it — ~16% of the owner's log, and in the real log they sit inside the
//              AT-THE-CAP window where there is no bar at all). Everything after it in that
//              bar is `Σstated + something unknown and non-negative`, so the true value is
//              only BOUNDED below. Drawing the bound would be drawing a number the log did
//              not state, and interpolating across it would be worse. The run stops.
//   overfull — the percentages since the ding already exceed a full level with no ding to show
//              for it. The model and the log disagree; the honest answer is that we do not
//              know where in the bar you are.
//   clipped  — the exp column is capped drop-oldest (progression.ts EXP_CAP) and the retention
//              floor has risen past this bar's anchor ding, so samples between them are simply
//              gone and the sum silently under-counts. The whole bar refuses.
//   swapped  — the span between the last ding of one loadout and the first ding of the next.
//              The swap itself is NEVER logged (levelSeries.ts's world model), so nothing can
//              date it, and every exp line in that span might belong to either bar. This is
//              the same `swap-gap` arm `levelAt` already reports and the same discontinuity
//              `drawSegments` already refused to draw a stroke across — now it refuses to
//              accumulate through it too. It covers the swap that lands on the level you were
//              ALREADY at as well, which no upstream flag can see (`isUnannouncedRestart`).
//
// A refused span is DRAWN AS ITS OWN THING (an uncertainty band), never as a dashed
// interpolation: "make the span visibly uncertain" and "never interpolate through it" are one
// instruction, and a dashed line between two known endpoints still puts a value under every
// pixel of it.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHY IT IS A STEP FUNCTION, EVEN THOUGH IT READS AS A CURVE
//
// The bar moves at an exp LINE and holds between them. A diagonal from one kill to the next
// would say you were 50.4% into the bar halfway between two mobs, which nothing states — the
// same reason the AA chart is a step function and `cumulativeAt` is a step lookup (law 9's
// index-vs-time scar). At the density the log actually carries (thousands of lines across 720
// user units) the steps are sub-pixel and the result reads as the continuous curve the ticket
// asks for. The two are not in tension; the honest one just happens to look right.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE COST, MEASURED RATHER THAN ASSUMED (the JOS-290 premise correction)
//
// There are no prefix structures to build on and none are needed: the exp column is CAPPED, so
// it is ~7k rows for the owner's 1.64M-line log however long he plays, and `rangeStats` answers
// the widest range over it in 0.93 ms. Building this curve is ONE ascending pass over that same
// column, so it is the same order of work — and it happens in a `useMemo` keyed on the snapshot
// and the scale, never on a pointermove (JOS-290's channel rule: a drag re-renders two bands and
// nothing else). `downsampleCurve` then collapses the vertices to at most two per pixel column,
// which is what keeps the SVG path a few hundred numbers instead of a few thousand.

import type { ProgressionSnap } from '@shared/types'
import type { LevelSegment } from './levelSeries'
import { xOf, type ChartScale } from './levelChartGeometry'

/** WHY a stretch of the curve cannot be drawn. Four of levelEta's `EtaBlocked` names, on
 *  purpose — the surfaces must refuse in the same words (see the header). */
export type CurveRefusal = 'unstated' | 'overfull' | 'clipped' | 'swapped'

/** One stated bar position: the value in force FROM `ts` until the next point. */
export interface CurvePoint {
  ts: number
  /** fractional level — `ding level + Σ stated percent since it / 100`. */
  y: number
}

/**
 * A run the log fully states, drawn step-after. `endTs` is how far the LAST point's value is
 * held flat: the instant the evidence ran out, the ding that closed the bar, or the end of the
 * drawn domain. It is a hold, never an extrapolation — nothing happened in that stretch, which
 * is precisely why the value did not move.
 */
export interface CurveRun {
  points: CurvePoint[]
  endTs: number
}

/** A stretch the log cannot place. `level` is the last ding in force — known even where the
 *  fraction is not, which is what lets a readout still name the level. */
export interface CurveGap {
  kind: CurveRefusal
  t0: number
  t1: number
  level: number
}

/** A ding, kept as a MARKER on the curve (the ticket: "dings stay as markers"). */
export interface CurveDing {
  ts: number
  level: number
  /** first ding of a new loadout — the discontinuity, not a level gained. */
  afterSwap: boolean
}

export interface LevelCurve {
  runs: CurveRun[]
  gaps: CurveGap[]
  dings: CurveDing[]
  /** y extent of everything drawn — the chart's own axis is derived from these. */
  loY: number
  hiY: number
}

/** The exp columns this module reads. `ProgressionSnap` is structurally assignable. */
export type ExpColumns = Pick<ProgressionSnap, 'expTs' | 'expPct' | 'expFlag' | 'windowStart'>

export interface LevelCurveArgs {
  snap: ExpColumns
  /** The ding runs, already clipped to the window (`chartWindow.visibleSegments`). */
  segments: readonly LevelSegment[]
  /** The drawn domain — `ChartScale.t0`/`t1`. */
  t0: number
  t1: number
}

const EMPTY: LevelCurve = { runs: [], gaps: [], dings: [], loY: 0, hiY: 0 }

/** First index i with `arr[i] > v` (arr ascending). */
function firstAfter(arr: readonly number[], v: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The dings, flattened out of the runs, with the swap flag on each run's FIRST ding. */
function flattenDings(segments: readonly LevelSegment[]): CurveDing[] {
  const out: CurveDing[] = []
  for (const seg of segments) {
    for (let i = 0; i < seg.points.length; i++) {
      out.push({ ts: seg.points[i].ts, level: seg.points[i].level, afterSwap: i === 0 && seg.afterSwap })
    }
  }
  return out
}

/** What the accumulation over one bar produced. */
interface BarWalk {
  points: CurvePoint[]
  /** the instant the evidence ran out, with the reason — null when the bar states all of itself. */
  refusal: { kind: CurveRefusal; ts: number } | null
}

/**
 * Accumulate one bar: every stated percent in `(dingTs, endTs)`, in order, as step points.
 *
 * STRICTLY BETWEEN, both ends, and that is `levelEta.statedSinceDing`'s rule rather than a new
 * one. EQ stamps whole seconds, so the exp line that pushed you over sits in the SAME second as
 * the ding it caused: counting it against the new bar would credit the old bar's last kill to
 * it, and counting it against the old bar would put a vertex above the ding it produced. It is
 * excluded from both — the conservative choice levelEta already documents and prices.
 */
function walkBar(snap: ExpColumns, dingTs: number, level: number, endTs: number): BarWalk {
  const points: CurvePoint[] = [{ ts: dingTs, y: level }]
  let equiv = 0
  for (let i = firstAfter(snap.expTs, dingTs); i < snap.expTs.length && snap.expTs[i] < endTs; i++) {
    const ts = snap.expTs[i]
    // Flag bit 1 is "the line stated no percent" (progression.ts pushExp). `expPct` is -1
    // there, never 0 — unknown is not zero, and this is where that matters most.
    if ((snap.expFlag[i] & 1) !== 0) return { points, refusal: { kind: 'unstated', ts } }
    equiv += snap.expPct[i] / 100
    if (equiv >= 1) return { points, refusal: { kind: 'overfull', ts } }
    points.push({ ts, y: level + equiv })
  }
  return { points, refusal: null }
}

/** True when the capped exp column no longer reaches back to this bar's anchor. */
function clippedAt(snap: ExpColumns, dingTs: number): boolean {
  return snap.windowStart > 0 && dingTs < snap.windowStart
}

/**
 * Is the ding that closes this bar a BAR THAT FILLED, or a level the game merely RE-REPORTED?
 *
 * `buildLevelSegments` splits the ding series only on a STRICT decrease, because that is the
 * shape a loadout swap usually takes (…50, then 11 — levelSeries.ts's world model). It is blind
 * to the swap that lands on the level you were ALREADY at, and the owner's log contains exactly
 * one: `You have gained a level! Welcome to level 11!` at Tue Jul 28 2026 15:51:40, and again at
 * 16:46:22 (the log's own local stamps — 22:51:40Z and 23:46:22Z) — 95.302% of a bar stated in
 * between, and the series carrying on to 12 afterwards. No level was gained at the second one.
 * The number was re-announced.
 *
 * Before JOS-331 every `next` that was not flagged `afterSwap` was taken for a bar filling and
 * appended as the run's closing vertex, so that run rose to 11.95302 and then DROPPED to 11 in
 * one stroke — a pixel claiming the bar EMPTIED, which is the precise lie the header's honesty
 * rule exists to forbid, and which nothing in the log states.
 *
 * It is also what turned the down-sample tripwire red, and only in August: the column collapse
 * keeps the FIRST and LAST vertex of each pixel column, which is lossless exactly while a run
 * never descends. While the peak (23:44:15Z) and the re-report (23:46:22Z) sat in different
 * columns the descent cost nothing visible; the day the log grew to Aug 13 the `All` window
 * re-scaled, both fell into column 15, and the collapse dropped that column's real maximum. The
 * defect was three weeks old — the grid moved, not the arithmetic.
 *
 * So: a ding that does not RAISE the level is not evidence that a bar filled. It is the same
 * unannounced discontinuity `afterSwap` names, it refuses in the same word, and every exp line
 * in the span might belong to either bar for the same reason WL44's does.
 *
 * BOTH ARMS ARE KEPT because neither subsumes the other. An equal-level re-report lives inside
 * one segment and is never flagged. And `visibleSegments` can drop whole segments when the
 * window is narrow, which can leave a HIGHER post-swap ding sitting after a lower surviving
 * anchor — flagged, but not a decrease.
 */
function isUnannouncedRestart(ding: CurveDing, next: CurveDing): boolean {
  return next.afterSwap || next.level <= ding.level
}

/**
 * One bar's contribution: a run, or the gap that stands in for it.
 *
 * The three refusals that kill the WHOLE bar are tested before a single percent is summed
 * (`swapped` and `clipped`); `unstated`/`overfull` cut the bar where the evidence stops, so the
 * part in front of them is still drawn — that stretch really was stated.
 */
function foldBar(o: {
  snap: ExpColumns
  ding: CurveDing
  next: CurveDing | undefined
  domainEnd: number
  out: { runs: CurveRun[]; gaps: CurveGap[] }
}): void {
  const { snap, ding, next, domainEnd, out } = o
  const barEnd = next ? next.ts : domainEnd
  if (next !== undefined && isUnannouncedRestart(ding, next)) {
    out.gaps.push({ kind: 'swapped', t0: ding.ts, t1: next.ts, level: ding.level })
    return
  }
  if (clippedAt(snap, ding.ts)) {
    out.gaps.push({ kind: 'clipped', t0: ding.ts, t1: barEnd, level: ding.level })
    return
  }
  const walk = walkBar(snap, ding.ts, ding.level, barEnd)
  if (walk.refusal) {
    out.runs.push({ points: walk.points, endTs: walk.refusal.ts })
    out.gaps.push({ kind: walk.refusal.kind, t0: walk.refusal.ts, t1: barEnd, level: ding.level })
    return
  }
  if (next) {
    // The ding is a POINT OF THE RUN, which is what makes the step-after render hold flat to it
    // and then jump: the bar filled at an instant the log stated, so the vertical is evidence.
    //
    // The vertical is always UPWARD here, and that is a guarantee rather than a hope:
    // `isUnannouncedRestart` has already sent every `next.level <= ding.level` away as a refusal,
    // so `next.level >= ding.level + 1`, while `walkBar` returns `overfull` the moment `equiv`
    // reaches 1 — so the last accumulated vertex is strictly below `ding.level + 1`. That is the
    // non-decreasing precondition `downsamplePoints` is exact under, established HERE, at the
    // only place in this file that can append a vertex below the one before it.
    out.runs.push({ points: [...walk.points, { ts: next.ts, y: next.level }], endTs: next.ts })
    return
  }
  // The live bar: held flat to the end of the drawn domain, exactly as the AA curve's trailing
  // plateau is. Nothing has happened since the last line, which is what a plateau says.
  out.runs.push({ points: walk.points, endTs: Math.max(domainEnd, walk.points[walk.points.length - 1].ts) })
}

/**
 * Clip a run to `[t0, ∞)` keeping the last point at or before `t0` — `chartWindow.visibleFrom`'s
 * anchor rule, applied to curve vertices. The anchor keeps its OWN timestamp and plots off-plot
 * to the left where the viewBox clips it, so the run enters the left edge at the value actually
 * in force there and nothing claims to have happened AT the edge.
 *
 * Returns null when the whole run is behind the window.
 */
function clipRun(run: CurveRun, t0: number): CurveRun | null {
  if (run.endTs < t0) return null
  let anchor = -1
  for (let i = 0; i < run.points.length; i++) {
    if (run.points[i].ts <= t0) anchor = i
    else break
  }
  if (anchor <= 0) return run
  return { points: run.points.slice(anchor), endTs: run.endTs }
}

/** The y extent of everything drawn — runs, their held tails, and the ding markers. */
function extentOf(curve: Omit<LevelCurve, 'loY' | 'hiY'>): { loY: number; hiY: number } {
  let lo = Infinity
  let hi = -Infinity
  const widen = (v: number): void => {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (const run of curve.runs) for (const p of run.points) widen(p.y)
  for (const d of curve.dings) widen(d.level)
  for (const g of curve.gaps) widen(g.level)
  return Number.isFinite(lo) ? { loY: lo, hiY: hi } : { loY: 0, hiY: 0 }
}

/**
 * THE FULL-RESOLUTION CURVE: one vertex per stated exp line. This is the reference the
 * down-sampler is proven against (tests/levelCurve.test.mts) and is not what the chart draws —
 * see `levelCurve` below.
 */
export function levelCurveFull(args: LevelCurveArgs): LevelCurve {
  const { snap, segments, t0, t1 } = args
  const dings = flattenDings(segments)
  if (dings.length === 0) return EMPTY
  const out: { runs: CurveRun[]; gaps: CurveGap[] } = { runs: [], gaps: [] }
  for (let k = 0; k < dings.length; k++) {
    foldBar({ snap, ding: dings[k], next: dings[k + 1], domainEnd: t1, out })
  }
  const runs = out.runs.map((r) => clipRun(r, t0)).filter((r): r is CurveRun => r !== null)
  const gaps = out.gaps
    .map((g) => ({ ...g, t0: Math.max(g.t0, t0), t1: Math.min(g.t1, t1) }))
    .filter((g) => g.t1 > g.t0)
  const body = { runs, gaps, dings: dings.filter((d) => d.ts >= t0 && d.ts <= t1) }
  return { ...body, ...extentOf(body) }
}

/**
 * PER-PIXEL DOWN-SAMPLING, and why keeping the first and last of each column is EXACT.
 *
 * Inside one run the curve is monotonically NON-DECREASING (a stated percent is positive and a
 * closing ding always RAISES the level), so within any x-column the first point carries that
 * column's minimum and the last carries its maximum. Rendering the pair reproduces the column's
 * whole vertical extent, and every retained vertex is a REAL sample — nothing is averaged,
 * nothing is invented, and the reduced path is the full-resolution path at the resolution the
 * chart can show.
 *
 * THAT PRECONDITION IS A CONTRACT, NOT AN OBSERVATION, and JOS-331 is the scar: a run that
 * descends breaks first+last silently — the column holding the descent reports the wrong maximum
 * and nothing else complains. `foldBar` is what establishes it (see the note on its closing-ding
 * arm), and tests/levelCurve.test.mts asserts it directly over the fixtures and the real log so
 * the next data shape that breaks it fails by NAME rather than as a mystery column mismatch.
 * Do not relax it here by widening the collapse to four vertices per column: two per column is
 * the budget the whole reduction exists for, and a descending run is a lie upstream regardless
 * of whether the collapse happens to preserve it.
 *
 * `colW` is in viewBox user units; the default 1 is one pixel at the 720u reference width. The
 * charts stretch (`preserveAspectRatio="none"`), so an exact device-pixel column would need the
 * measured element width for a distinction nobody can see — the same argument `bandRects` makes
 * about its sub-pixel drop.
 */
export function downsampleCurve(curve: LevelCurve, scale: ChartScale, colW = 1): LevelCurve {
  const runs = curve.runs.map((run) => ({ points: downsamplePoints(run.points, scale, colW), endTs: run.endTs }))
  return { ...curve, runs }
}

/** The column-collapse itself — see `downsampleCurve` for why first+last is lossless here. */
export function downsamplePoints(points: readonly CurvePoint[], scale: ChartScale, colW = 1): CurvePoint[] {
  if (points.length <= 2) return [...points]
  const out: CurvePoint[] = []
  const col = (p: CurvePoint): number => Math.floor(xOf(scale, p.ts) / Math.max(0.001, colW))
  let runStart = 0
  for (let i = 1; i <= points.length; i++) {
    if (i < points.length && col(points[i]) === col(points[runStart])) continue
    out.push(points[runStart])
    if (i - 1 > runStart) out.push(points[i - 1])
    runStart = i
  }
  return out
}

/** The curve the chart draws: full resolution, then collapsed to the pixel columns it has. */
export function levelCurve(args: LevelCurveArgs, scale: ChartScale, colW = 1): LevelCurve {
  return downsampleCurve(levelCurveFull(args), scale, colW)
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// GEOMETRY — the same `xOf` every other reader of this chart uses (law 9: one time base).

/**
 * A run as SVG polyline points, drawn step-after: hold the old value across to the next
 * instant, then jump. `yOf` is the chart's own level→user-unit mapping.
 */
export function runPolyline(run: CurveRun, scale: ChartScale, yOf: (v: number) => number): string {
  const out: string[] = []
  let py = yOf(run.points[0].y)
  for (const p of run.points) {
    const px = xOf(scale, p.ts)
    if (out.length) out.push(`${px.toFixed(1)},${py.toFixed(1)}`)
    py = yOf(p.y)
    out.push(`${px.toFixed(1)},${py.toFixed(1)}`)
  }
  if (run.endTs > run.points[run.points.length - 1].ts) {
    out.push(`${xOf(scale, run.endTs).toFixed(1)},${py.toFixed(1)}`)
  }
  return out.join(' ')
}

/** The filled area under a run, closed to `floor`. */
export function runArea(run: CurveRun, scale: ChartScale, yOf: (v: number) => number, floor: number): string {
  const line = runPolyline(run, scale, yOf)
  const x0 = xOf(scale, run.points[0].ts).toFixed(1)
  const x1 = xOf(scale, Math.max(run.endTs, run.points[run.points.length - 1].ts)).toFixed(1)
  return `${x0},${floor} ${line} ${x1},${floor}`
}

/** An uncertainty band's rectangle, or null when it is narrower than `minW` user units. */
export function gapRect(gap: CurveGap, scale: ChartScale, minW = 1): { x: number; w: number } | null {
  const x = xOf(scale, gap.t0)
  const w = xOf(scale, gap.t1) - x
  return w >= minW ? { x, w } : null
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// LOOKUP — what the hover readout reads, from the SAME object the pixels were drawn from.

/** The bar position at `ts`: stated, refused, or nothing drawn there at all. */
export type CurveAt =
  | { kind: 'stated'; y: number; level: number }
  | { kind: 'refused'; refusal: CurveRefusal; level: number }
  | null

/**
 * Resolve `ts` against the drawn curve. The gaps are checked FIRST: a refused span is the
 * answer wherever it covers, and a run held flat into it would otherwise report the value the
 * evidence stopped at as though it still held.
 */
export function curveAt(curve: LevelCurve, ts: number): CurveAt {
  for (const g of curve.gaps) {
    if (ts >= g.t0 && ts <= g.t1) return { kind: 'refused', refusal: g.kind, level: g.level }
  }
  for (const run of curve.runs) {
    if (ts < run.points[0].ts || ts > Math.max(run.endTs, run.points[run.points.length - 1].ts)) continue
    let at = run.points[0]
    for (const p of run.points) {
      if (p.ts > ts) break
      at = p
    }
    return { kind: 'stated', y: at.y, level: Math.floor(at.y) }
  }
  return null
}

/** The refusal's one clause, for the hover readout. Mirrors `levelEta.ETA_BLOCKED_TITLE`'s
 *  wording for the three names they share; `swapped` says the same thing that one does. */
export const CURVE_REFUSAL_NOTE: Record<CurveRefusal, string> = {
  unstated: 'experience lines here stated no percentage - unknown, not zero',
  overfull: 'the percentages since the last level-up already exceed a full level',
  clipped: 'the retained record no longer reaches back to the level-up this bar started at',
  swapped: 'the bar restarted at a class swap the log never announced'
}
