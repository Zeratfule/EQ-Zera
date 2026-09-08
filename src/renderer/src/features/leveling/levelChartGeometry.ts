// Pure geometry + lookup for the two leveling charts (levelCharts.tsx) and everything
// that has to agree with what they DRAW — the hover layer today, a range/drag selection
// later. No React, no DOM, no MUI, and only TYPE imports from sibling modules, so
// tests/levelHover.test.mts can import it straight under tsx (there is no `@shared/*`
// alias in the node test runner — see AGENTS.md / the hover plan's D6).
//
// Why it exists: `AreaChart` and `LevelStepChart` each used to compute `t0/t1/pad`
// inline. A hover readout derived from a second copy of that arithmetic can silently
// disagree with the pixels it is pointing at. One mapping, one source.

import type { LevelSegment } from './levelSeries'

/** The viewBox width both charts draw at (`viewBox="0 0 720 H"`, preserveAspectRatio="none"). */
export const CHART_W = 720
/** The viewBox height both charts draw at. */
export const CHART_H = 150

/**
 * A chart's X mapping, in USER (viewBox) units. `t0..t1` is the time domain the chart
 * plots; `bucketMs` is the grid that domain is quantized to; `padX` is the horizontal
 * inset; `w` is the viewBox width.
 *
 * THIS OBJECT IS THE ONE TIME BASE (world-model law 9). Both charts take the same instance
 * through `ChartChrome`, and so do the zone strip, the range band, the hover crosshair and
 * its X→time inverse — so a pixel is one instant across the whole leveling tab. The
 * timescale control (chartWindow.ts) replaces it WHOLESALE; nothing ever holds half of it.
 */
export interface ChartScale {
  t0: number
  t1: number
  /** the sampling grid `t0`/`t1` are quantized to — see chartWindow.ts's bucket rule. */
  bucketMs: number
  w: number
  padX: number
}

/**
 * Domain width, guarded. A zero-width domain (every point at one instant) would divide
 * by zero; 1 is the fallback, which is exactly what `AreaChart`'s `Math.max(1, t1 - t0)`
 * did before this module existed (log timestamps are whole milliseconds, so a real
 * non-degenerate AA domain is always >= 1). The level chart's domain always has its 4%
 * trailing pad and so is never degenerate.
 */
function spanOf(s: ChartScale): number {
  return s.t1 > s.t0 ? s.t1 - s.t0 : 1
}

/** Timestamp -> user units (the value that goes into the SVG path). */
export function xOf(s: ChartScale, ts: number): number {
  return s.padX + ((ts - s.t0) / spanOf(s)) * (s.w - 2 * s.padX)
}

/** User units -> timestamp. Exact inverse of `xOf`. */
export function tOf(s: ChartScale, ux: number): number {
  return s.t0 + ((ux - s.padX) / (s.w - 2 * s.padX)) * spanOf(s)
}

/**
 * CSS px -> user units for a `preserveAspectRatio="none"` chart: X is STRETCHED to the
 * element's measured width, so a raw `clientX - rect.left` is not a viewBox coordinate.
 * (Y is 1:1 on these charts — the SVG's `height` attribute equals the viewBox height —
 * so no inverse is needed for it.)
 */
export function pxToUser(cssX: number, rectW: number, w = CHART_W): number {
  return rectW > 0 ? (cssX * w) / rectW : 0
}

/**
 * A chart's VERTICAL mapping: the value domain it plots and the user-unit band it plots it in.
 *
 * WHY THIS EXISTS (JOS-339). Both charts computed their y domain inline as "the data, exactly",
 * and at a short window that is a picture of nothing: the AA chart's top was the last point's own
 * value, so the line was pinned FLAT AGAINST THE TOP EDGE of an empty box, and the level chart's
 * was `[lowest ding - 1, ceil(highest)]`, which spends one whole level below a curve that never
 * goes there and rounds up to another above it — a hairline staircase in dead space. Neither
 * number was wrong; both pictures were unreadable.
 *
 * The rules that replace them are DIFFERENT ON PURPOSE, and the difference is what each axis
 * measures — see `paddedAxis` and `levelAxis` below. They are here, pure, so the shape of a short
 * window is a thing tests can state (tests/levelChartAxis.test.mts) rather than a thing a reviewer
 * has to squint at.
 */
export interface YAxis {
  /** the value at the BOTTOM of the drawn band. */
  lo: number
  /** the value at the TOP of the drawn band. */
  hi: number
  /** user-unit y of `hi` — the top inset the caller reserved (band strip, labels). */
  top: number
  /** user-unit y of `lo` — the bottom inset. */
  bottom: number
}

/** The user-unit band a chart draws its values inside. */
export interface PlotBand {
  top: number
  bottom: number
}

/** Value -> user units. The one y mapping both charts use, so a value and a label cannot disagree
 *  about where they are. */
export function yOf(a: YAxis, v: number): number {
  const span = a.hi > a.lo ? a.hi - a.lo : 1
  return a.bottom - ((v - a.lo) / span) * (a.bottom - a.top)
}

export interface PadOpts {
  /** the narrowest domain worth drawing — a window whose data does not move still needs a box. */
  minSpan: number
  /** headroom at each end, as a fraction of the span. */
  padFrac: number
  /** …and never less than this, in the value's own units. */
  minPad: number
  /** a value the domain may not go below — 0 for a cumulative total, which cannot be negative. */
  floor?: number
}

/**
 * A PROPORTIONALLY PADDED axis: the data, plus headroom above and below.
 *
 * This is the rule for a running total (the AA chart). Cumulative AA has no natural quantum to
 * snap an axis to — 442 is not a boundary of anything — so the honest treatment is to draw the
 * range the window actually covers and leave air at both ends, which is the difference between a
 * line pinned to the frame and a line with somewhere to have come from and somewhere to go.
 *
 * `minPad` is what makes a SMALL INTEGER domain readable: +2 AA over a window is a span of 2, and
 * 12% of 2 is a quarter of one point — visually nothing. The floor of 0.35 gives that window real
 * headroom without snapping the domain out to whole numbers, which would halve the staircase it
 * exists to show. A window with NO gain at all grows to `minSpan` about its own midpoint, so the
 * flat line sits across the MIDDLE of the box instead of glued to its bottom edge.
 */
export function paddedAxis(dataLo: number, dataHi: number, band: PlotBand, opts: PadOpts): YAxis {
  const mid = (dataLo + dataHi) / 2
  const span = Math.max(dataHi - dataLo, opts.minSpan)
  const pad = Math.max(span * opts.padFrac, opts.minPad)
  const lo = mid - span / 2 - pad
  return {
    lo: opts.floor !== undefined ? Math.max(lo, opts.floor) : lo,
    hi: mid + span / 2 + pad,
    top: band.top,
    bottom: band.bottom
  }
}

/**
 * A WHOLE-LEVEL axis: the bar you are filling, and the one above it.
 *
 * This is the rule for the level chart, and it is deliberately not the padded one. A level HAS a
 * natural quantum: the fractional curve is `last ding + the percentages since it`, so the
 * meaningful bounds are the whole levels either side of it. Snapping to them makes the axis mean
 * something ("this is level 22's bar, filling toward 23") instead of being an arbitrary window on
 * a number line.
 *
 * IT ALSO MAKES THE LABELS TRUE. The chart already prints these two integers at the top and bottom
 * of the plot; before this rule the bottom one sat at a floor that was actually `lo - 1`, so the
 * printed axis and the drawn axis disagreed by a whole level. Nothing the chart states changes —
 * the same two numbers are printed — they are simply where they say they are, and the curve gets
 * the whole box instead of the middle fifth of it.
 */
export function levelAxis(dataLo: number, dataHi: number, band: PlotBand): YAxis {
  const lo = Math.floor(dataLo)
  return { lo, hi: Math.max(Math.ceil(dataHi), lo + 1), top: band.top, bottom: band.bottom }
}

/**
 * The level in effect at `ts`, HONESTLY.
 *
 * The `swap-gap` arm deliberately carries NO `level` field: between the last ding of one
 * loadout and the first ding of the next, the level is genuinely unknown — the swap
 * itself is never logged (levelSeries.ts's world model, and the same reason
 * `levelFeedEntries` suppresses `sinceMs` across a swap). A caller therefore CANNOT
 * render a level there; TypeScript enforces the honesty rather than a comment asking for it.
 */
export type LevelAt =
  | { kind: 'level'; level: number; sinceTs: number; nextTs: number | null }
  | { kind: 'swap-gap'; beforeLevel: number; afterLevel: number; gapMs: number }
  | { kind: 'before-first' }

const BEFORE_FIRST: LevelAt = { kind: 'before-first' }

/**
 * Resolve `ts` against the drawn segments. The gap arm starts AT the last pre-swap ding
 * (not one millisecond after it): a `level` arm there would have to name a `nextTs`, and
 * the only candidate is the post-swap ding — which is precisely the fabricated
 * "time to level" the feed refuses to print.
 */
export function levelAt(segments: readonly LevelSegment[], ts: number): LevelAt {
  let si = -1
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].points[0].ts > ts) break
    si = i
  }
  if (si < 0) return BEFORE_FIRST

  const pts = segments[si].points
  let pi = 0
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].ts > ts) break
    pi = i
  }
  const p = pts[pi]
  const next = si + 1 < segments.length ? segments[si + 1].points[0] : null
  if (pi === pts.length - 1 && next) {
    return { kind: 'swap-gap', beforeLevel: p.level, afterLevel: next.level, gapMs: next.ts - p.ts }
  }
  return {
    kind: 'level',
    level: p.level,
    sinceTs: p.ts,
    nextTs: pi + 1 < pts.length ? pts[pi + 1].ts : null
  }
}

/** A cumulative-AA plot point. `nowHave` is the "you now have N" balance reported by the
 *  gain line that produced this step — absent when the caller has only the curve. */
export interface AaPoint {
  ts: number
  y: number
  nowHave?: number
  /**
   * The points THIS gain line reported. Carried rather than re-derived as `y - points[i-1].y`
   * because a windowed curve (chartWindow.ts) opens on an ANCHOR — a gain that happened before
   * the window — and there is no `i-1` in front of it to subtract. The difference used to be
   * invisible only because the array always started at the character's first gain.
   */
  gain?: number
}

/**
 * Index of the last point at or before `ts` (-1 when `ts` precedes the series). Shared
 * step lookup: the curve is a STEP function between gain lines, so this is the only
 * correct "value at t" — never an interpolation between two gains.
 */
export function stepIndexAt(points: readonly { ts: number }[], ts: number): number {
  let lo = 0
  let hi = points.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (points[mid].ts <= ts) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** Cumulative AA gained at `ts`; null before the first gain. */
export function cumulativeAt(points: readonly { ts: number; y: number }[], ts: number): number | null {
  const i = stepIndexAt(points, ts)
  return i < 0 ? null : points[i].y
}

/**
 * The leveling view's one duration formatter (minutes -> hours -> days). Lives here
 * rather than in the view so the hover layer and the progress feed print the same shape
 * for the same span; there is no fourth elapsed formatter in this feature.
 */
export function fmtDelta(ms: number): string {
  if (ms <= 0) return '-'
  const mins = ms / 60000
  if (mins < 60) return `${Math.round(mins)}m`
  const hrs = mins / 60
  if (hrs < 48) return `${hrs.toFixed(1)}h`
  return `${(hrs / 24).toFixed(1)}d`
}

/**
 * The same feature's SPAN formatter: `2h 41m` / `38m` / `45s` / `3d 4h`.
 *
 * Why two, and why both live HERE. `fmtDelta` above answers "how long since the last ding" —
 * one magnitude, one decimal (`2.7h`), which is the right shape for a feed line, a hover
 * readout and a legend row, and it is pinned by tests/levelHover.test.mts. A range readout
 * asks a different question — "how much time is IN this selection" — and `2.7h` there is a
 * worse answer than `2h 41m`: the user picked the boundaries, so the panel owes them the
 * minutes. Widening `fmtDelta` itself would silently restate every existing caption in the
 * feature, so the pair sits in ONE file instead: this module is the leveling feature's
 * duration home, and there is still no third formatter anywhere in it.
 *
 * Days roll over at 48h for the same reason `fmtDelta` does — a multi-day drag would
 * otherwise read `169h 30m`.
 */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hrs = Math.floor(total / 3600)
  if (hrs >= 48) return `${Math.floor(hrs / 24)}d ${hrs % 24}h`
  const mins = Math.floor((total % 3600) / 60)
  if (hrs > 0) return `${hrs}h ${mins}m`
  return mins > 0 ? `${mins}m` : `${total % 60}s`
}
