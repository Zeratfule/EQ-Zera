// Pure unit tests for the leveling charts' VERTICAL geometry — the half of JOS-339 that is
// arithmetic rather than taste (src/renderer/src/features/leveling/levelChartGeometry.ts's
// `paddedAxis` / `levelAxis` / `yOf`, and zoneBands' `bandStripStyle`).
//
// No log, no fixture, no DOM — so this file never skips.
//
// WHAT WENT WRONG, AND THEREFORE WHAT IS PINNED HERE. The owner reported both plots reading as
// edge-pinned hairlines in empty boxes at short windows, with a screenshot: a +2 AA window whose
// line lay flat along the TOP EDGE, and a level 22→23 window whose fractional curve was a hairline
// staircase in dead space. Both were the y domain being computed as "the data, exactly":
//
//   • the AA chart's top was the last point's own value, so the maximum mapped to the top inset —
//     there was no headroom above the data ANYWHERE, at any window, ever. Full history hid it
//     because the curve climbs across the whole box; a short window is where it shows.
//   • the level chart's domain was `[lowest ding - 1, ceil(highest drawn)]` — one whole level of
//     dead space below a curve that never goes there, and a round-up above it. A twelve-minute
//     window inside one level therefore got the middle fifth of the plot.
//
// THE TWO RULES ARE DELIBERATELY DIFFERENT and the tests say why: a running AA total has no
// natural quantum to snap to, so it takes proportional headroom; a level does — the bar you are
// filling — so its axis IS that bar, which is also what makes the two integers the chart already
// prints land where they claim to be.
//
// NOTHING HERE IS ABOUT A NUMBER THE CHART STATES. Every test below is about where a value is
// DRAWN. The label text is unchanged by this ticket and is asserted as such.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHART_W,
  levelAxis,
  paddedAxis,
  yOf,
  type PlotBand
} from '../src/renderer/src/features/leveling/levelChartGeometry'
import { BAND_H, PAD_X, bandStripStyle, type ZoneBandRect } from '../src/renderer/src/features/leveling/zoneBands'

/** The AA chart's band and its padding rule, as levelCharts.tsx configures them. */
const AA_BAND: PlotBand = { top: 18, bottom: 142 }
const AA_PAD = { minSpan: 1, padFrac: 0.12, minPad: 0.35, floor: 0 }
/** …and the level chart's. */
const LEVEL_BAND: PlotBand = { top: 24, bottom: 136 }

/** How far a value sits from the top of the band, as a fraction of the band's height. 0 is the
 *  top edge, 1 the bottom. The whole ticket is about this number not being 0 or 1. */
function place(axis: { lo: number; hi: number; top: number; bottom: number }, v: number): number {
  return (yOf(axis, v) - axis.top) / (axis.bottom - axis.top)
}

// ── 1. THE AA AXIS: headroom above AND below, at the reported shape ─────────────────────────

test('the reported +2 AA window gets air at both ends instead of a line on the top edge', () => {
  // The owner's screenshot: a window holding two AA, domain stated 442 to 444.
  const axis = paddedAxis(442, 444, AA_BAND, AA_PAD)
  assert.ok(axis.hi > 444, `the top of the axis is above the top of the data (${String(axis.hi)})`)
  assert.ok(axis.lo < 442, `and its bottom is below the bottom (${String(axis.lo)})`)

  const top = place(axis, 444)
  const base = place(axis, 442)
  assert.ok(top > 0.04, `the maximum is off the top edge — sat at ${top.toFixed(3)} of the band`)
  assert.ok(base < 0.96, `the floor is off the bottom edge — sat at ${base.toFixed(3)}`)
  // …and the two AA still fill most of the box. Headroom that swallowed the shape would have
  // traded one unreadable picture for another.
  assert.ok(base - top > 0.6, `the gain still owns the plot — ${(base - top).toFixed(3)} of it`)
})

test('a small integer domain is padded by the FLOOR, not by the fraction', () => {
  // 12% of a span of 2 is a quarter of one AA point — invisible exactly where it was asked for.
  const axis = paddedAxis(442, 444, AA_BAND, AA_PAD)
  assert.equal(Number((axis.hi - 444).toFixed(3)), AA_PAD.minPad)
  assert.equal(Number((442 - axis.lo).toFixed(3)), AA_PAD.minPad)
})

test('a large domain is padded by the FRACTION, so full history keeps its shape', () => {
  const axis = paddedAxis(0, 3000, AA_BAND, AA_PAD)
  assert.equal(axis.hi, 3000 + 3000 * AA_PAD.padFrac)
  // `floor: 0` holds the bottom at zero: a cumulative total has no ground below it, and the
  // full-history picture has always opened there.
  assert.equal(axis.lo, 0)
})

test('a window with no gain at all draws its flat line across the MIDDLE, not along an edge', () => {
  // The old rule divided by `max(1, top - base)` with the data at the bottom of it, so a gainless
  // window put the line on the floor — indistinguishable from "you have nothing".
  const axis = paddedAxis(442, 442, AA_BAND, AA_PAD)
  assert.ok(Math.abs(place(axis, 442) - 0.5) < 0.001, `sat at ${place(axis, 442).toFixed(3)} of the band`)
  assert.ok(axis.hi - axis.lo >= AA_PAD.minSpan, 'and the box has a domain to be a box over')
})

test('the floor never lets a cumulative axis go negative', () => {
  assert.equal(paddedAxis(0, 4, AA_BAND, AA_PAD).lo, 0)
  assert.equal(paddedAxis(0, 0, AA_BAND, AA_PAD).lo, 0)
})

// ── 2. THE LEVEL AXIS: the bar you are filling ──────────────────────────────────────────────

test('a window inside one level is that level and the next — not the one below it as well', () => {
  // The reported shape: dings at 22, the fractional curve reaching 22.4.
  const axis = levelAxis(22, 22.4, LEVEL_BAND)
  assert.deepEqual({ lo: axis.lo, hi: axis.hi }, { lo: 22, hi: 23 })
  // Which is the whole point: the curve now covers 40% of the plot instead of a fifth of it.
  assert.ok(place(axis, 22) - place(axis, 22.4) > 0.35, 'the curve owns a readable share of the box')
})

test('the bottom of the axis is the level the bottom LABEL names', () => {
  // The old baseline was `lo - 1`, so the chart printed 22 at a floor that was really 21 — the
  // drawn axis and the printed one disagreed by a whole level. Same two integers, true positions.
  const axis = levelAxis(22, 22.4, LEVEL_BAND)
  assert.equal(yOf(axis, axis.lo), axis.bottom)
  assert.equal(yOf(axis, axis.hi), axis.top)
})

test('a ding at a whole level lands ON the top of the axis rather than pushing it out a level', () => {
  // Dinging 23 at the end of the window makes the drawn maximum exactly 23. Rounding "up to the
  // next whole level" there would buy a second empty level above a curve that just reached its top.
  const axis = levelAxis(22, 23, LEVEL_BAND)
  assert.deepEqual({ lo: axis.lo, hi: axis.hi }, { lo: 22, hi: 23 })
})

test('a swap window spanning several levels keeps every one of them, and no phantom below', () => {
  const axis = levelAxis(44, 50.2, LEVEL_BAND)
  assert.deepEqual({ lo: axis.lo, hi: axis.hi }, { lo: 44, hi: 51 })
  assert.ok(place(axis, 44) <= 1 && place(axis, 50.2) >= 0, 'everything drawn is inside the band')
})

test('the axis always spans at least one level, so a domain can never collapse', () => {
  const axis = levelAxis(22, 22, LEVEL_BAND)
  assert.equal(axis.hi - axis.lo, 1)
  assert.ok(Number.isFinite(yOf(axis, 22)))
})

// ── 3. yOf: one mapping, both charts ────────────────────────────────────────────────────────

test('yOf is linear, inclusive of both ends, and never divides by zero', () => {
  const axis = levelAxis(22, 22.5, LEVEL_BAND)
  const mid = (axis.lo + axis.hi) / 2
  assert.ok(Math.abs(yOf(axis, mid) - (axis.top + axis.bottom) / 2) < 1e-9)
  // A degenerate axis cannot be produced by either rule, but the mapping still refuses to explode.
  assert.ok(Number.isFinite(yOf({ lo: 5, hi: 5, top: 0, bottom: 100 }, 5)))
})

// ── 4. THE BAND STRIP: loud when it is distinguishing, quiet when it is not ─────────────────

const SCALE = { t0: 0, t1: 1, bucketMs: 1, w: CHART_W, padX: PAD_X }
const PLOT_W = CHART_W - 2 * PAD_X

function rect(x: number, w: number, key = 'z'): ZoneBandRect {
  return { key, name: key, color: '#fff', x, w }
}

test('one zone covering the whole window is drawn as quiet context, not a slab', () => {
  const style = bandStripStyle([rect(PAD_X, PLOT_W)], SCALE)
  assert.equal(style.kind, 'quiet')
  assert.ok(style.height < BAND_H, `${String(style.height)}u tall, against ${String(BAND_H)}u`)
  assert.ok(style.opacity < 0.75, `and ${String(style.opacity)} alpha`)
})

test('two zones put it back to full weight — that strip is telling something apart', () => {
  const style = bandStripStyle([rect(PAD_X, PLOT_W / 2), rect(PAD_X + PLOT_W / 2, PLOT_W / 2, 'y')], SCALE)
  assert.equal(style.kind, 'full')
  assert.equal(style.height, BAND_H)
})

test('a single band that does NOT cover the window stays full weight', () => {
  // Half the window in one zone and the rest unlogged is a real edge, and the strip is where it
  // is visible — quieting that would hide the one thing it is saying.
  assert.equal(bandStripStyle([rect(PAD_X, PLOT_W / 2)], SCALE).kind, 'full')
})

test('the coverage test tolerates the sliver a clipped zone line leaves behind', () => {
  assert.equal(bandStripStyle([rect(PAD_X, PLOT_W * 0.99)], SCALE).kind, 'quiet')
  assert.equal(bandStripStyle([rect(PAD_X, PLOT_W * 0.9)], SCALE).kind, 'full')
})

test('an empty strip is nobody’s special case', () => {
  assert.equal(bandStripStyle([], SCALE).kind, 'full')
})
