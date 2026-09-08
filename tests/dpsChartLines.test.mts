// Pure unit tests for WHICH LINES THE DPS CURVE DRAWS (JOS-264)
// — `buildDpsChart`'s hidden set, plus the two readers that must agree with it.
//
// No log, no fixture, no DOM, so this file never skips. The vocabulary half (what a stored hidden
// set means, and how it degrades) is pinned in tests/combatPrefs.test.mts; what is pinned HERE is
// the geometry, which is where hiding a line could quietly change something it has no business
// changing:
//   1. HIDING SUBTRACTS A LINE AND NOTHING ELSE. The time base, the vertex count, the marker X
//      positions and the axis are byte-identical with a line switched off — a toggle that re-timed
//      the chart would move every tick under the cursor and reopen the marker-swim bug the
//      one-time-base shape exists to prevent.
//   2. THE Y SCALE IS THE DRAWN LINES'. Hiding the headline curve is asked for precisely when it
//      dwarfs everything else, so what is left has to fill the plot rather than stay flattened
//      against the floor by a line that is no longer on screen.
//   3. …BUT THE PEAK IS STILL THE OUTGOING SERIES'. `peakVis` describes the fight, not the
//      drawing, so it does not move; the card reads `outLine === null` to decide whether quoting
//      it still makes sense.
//   4. AN ABSENT LINE AND A HIDDEN ONE ARE THE SAME SHAPE (`null`), so the SVG asks one question
//      per line and a fight without a pet cannot be told from a pet you put away.
//   5. ALL LINES OFF IS A STATE, NOT A CRASH: the chart still builds, with a valid time base, and
//      says so through `hasDrawnLine` — which is what lets the card show a note and keep the
//      legend that switches one back on.
//   6. THE HIDDEN MARKER KINDS COME OFF THE DRAWING, NOT OFF THE LEGEND. `placeMarkers` still
//      returns them (the legend is built from it, and an entry that deleted itself would be a
//      one-way door); `drawnMarkers` is the filtered view the ticks and the hover share.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { TimelineMarker, TimelineView } from '../src/shared/combat'
import type { DpsSeries } from '../src/renderer/src/features/combat/dashboardData'
import type { ChartLineKey } from '../src/renderer/src/features/combat/combatPrefs'
import {
  CHART_H,
  PAD_B,
  PAD_T,
  buildDpsChart,
  drawnMarkers,
  hasDrawnLine,
  placeMarkers,
  xAtT,
  yAt,
  type DpsChart
} from '../src/renderer/src/features/combat/dpsChart'

const BUCKET = 1000

/** you / pet / group / inc per bucket. `out` (the headline line) is you+pet+group, so this
 *  fixture's outgoing curve towers over each of its own components — which is the shape the
 *  feature was reported against. */
const YOU = [100, 200]
const PET = [50, 50]
const GROUP = [20, 80]
const INC = [10, 10]
/** out = you + pet + group, bucket by bucket. */
const OUT = [170, 330]

function mkSeries(): DpsSeries {
  return {
    bucketMs: BUCKET,
    smoothMs: 5 * BUCKET,
    n: YOU.length,
    you: Float64Array.from(YOU),
    pet: Float64Array.from(PET),
    group: Float64Array.from(GROUP),
    inc: Float64Array.from(INC),
    peakOut: Math.max(...OUT),
    hasPet: true,
    hasGroup: true,
    hasInc: true,
    hasAny: true,
    durationMs: YOU.length * BUCKET,
    estimated: false
  }
}

function mkChart(hidden: ChartLineKey[] = [], series: DpsSeries = mkSeries()): DpsChart {
  const chart = buildDpsChart(series, false, hidden)
  assert.ok(chart, 'the fixture must produce a drawable chart')
  return chart
}

/** The polyline point string, back as numbers — the drawing, read as data. */
function parsePts(s: string | null): { x: number; y: number }[] {
  assert.ok(s, 'the fixture must draw this line')
  return s.split(' ').map((p) => {
    const [x, y] = p.split(',').map(Number)
    return { x, y }
  })
}

function mkView(markers: TimelineMarker[]): TimelineView {
  return {
    id: 'enc-1',
    name: 'a froglok tad',
    startTs: 0,
    durationMs: YOU.length * BUCKET,
    lanes: [],
    events: [],
    stanceSpans: [],
    markers,
    downsampled: false,
    rawCount: 0,
    totalCount: 0,
    truncated: false
  }
}

// ── 1. hiding subtracts a line and nothing else ──────────────────────────────────────────

test('hiding a line drops exactly that line, and leaves the other three untouched', () => {
  const all = mkChart()
  const noPet = mkChart(['pet'])
  assert.ok(all.petLine, 'the fixture has a pet line to hide')
  assert.equal(noPet.petLine, null)
  // The other lines are byte-identical: nothing about the pet's absence may re-place a vertex,
  // and here the Y scale is unchanged too (the pet was never what set it).
  assert.equal(noPet.outLine, all.outLine)
  assert.equal(noPet.groupLine, all.groupLine)
  assert.equal(noPet.incLine, all.incLine)
  assert.equal(noPet.outArea, all.outArea)
})

test('the OUTGOING line takes its area fill with it, and nothing else with that', () => {
  const noOut = mkChart(['out'])
  assert.equal(noOut.outLine, null)
  assert.equal(noOut.outArea, null, 'the fill is the outgoing line shaded, not a fifth line')
  assert.ok(noOut.petLine)
  assert.ok(noOut.groupLine)
  assert.ok(noOut.incLine)
})

test('hiding a line does not re-time the chart — the axis, the vertices and the ticks do not move', () => {
  const all = mkChart()
  const markers: TimelineMarker[] = [
    { t: 0, kind: 'stance', label: 'Berserker' },
    { t: 1400, kind: 'slow', label: 'a froglok tad' }
  ]
  const before = placeMarkers(mkView(markers), all)
  for (const hidden of [['out'], ['pet', 'inc'], ['out', 'pet', 'group']] as ChartLineKey[][]) {
    const chart = mkChart(hidden)
    assert.equal(chart.t0, all.t0, `t0 must not move (hidden: ${hidden.join()})`)
    assert.equal(chart.t1, all.t1, `t1 must not move (hidden: ${hidden.join()})`)
    assert.equal(chart.i0, all.i0)
    assert.equal(chart.count, all.count)
    assert.equal(chart.bucketMs, all.bucketMs)
    assert.equal(chart.scrolling, all.scrolling)
    // The X mapping is the axis, the markers and the hover's inverse all at once.
    for (const t of [0, 700, 1400, chart.t1]) assert.equal(xAtT(chart, t), xAtT(all, t))
    assert.deepEqual(placeMarkers(mkView(markers), chart), before)
  }
})

// ── 2 & 3. the scale is the drawn lines'; the peak is the fight's ────────────────────────

test('the Y scale is measured over the DRAWN lines, so what is left fills the plot', () => {
  const all = mkChart()
  assert.equal(all.yMax, Math.max(...OUT), 'with everything visible the outgoing peak sets the ceiling')

  // Hide the headline curve and the ceiling drops to the tallest line still on screen — the group
  // at 80, an inch off the floor at the old scale.
  const noOut = mkChart(['out'])
  assert.equal(noOut.yMax, Math.max(...GROUP))
  const group = parsePts(noOut.groupLine)
  assert.equal(group[1].y, yAt(noOut.yMax, Math.max(...GROUP)))
  assert.ok(Math.abs(group[1].y - PAD_T) < 1e-9, 'the tallest visible sample now reaches the top of the plot')

  // Hiding a line that never set the ceiling changes nothing about the scale.
  assert.equal(mkChart(['inc']).yMax, all.yMax)
  // And with the two tallest gone, the next one down sets it.
  assert.equal(mkChart(['out', 'group']).yMax, Math.max(...PET))
})

test('the PEAK is the outgoing series own number and does not move when its line is hidden', () => {
  // It describes the fight, not the drawing — so it stays put, and the card decides whether to
  // quote a figure for a line that is not on the plot (it does not: `outLine === null`).
  const all = mkChart()
  assert.equal(all.peakVis, Math.max(...OUT))
  for (const hidden of [['out'], ['out', 'pet', 'group', 'inc']] as ChartLineKey[][]) {
    assert.equal(mkChart(hidden).peakVis, all.peakVis, `hidden: ${hidden.join()}`)
  }
})

// ── 4. absent and hidden are the same shape ──────────────────────────────────────────────

test('a line the fight never had reads exactly like a line you put away', () => {
  const solo: DpsSeries = { ...mkSeries(), hasPet: false, hasGroup: false, hasInc: false }
  const chart = mkChart([], solo)
  assert.equal(chart.petLine, null)
  assert.equal(chart.groupLine, null)
  assert.equal(chart.incLine, null)
  // …and hiding what was never there is a no-op rather than a second kind of absent.
  assert.deepEqual(mkChart(['pet', 'group', 'inc'], solo), chart)
})

// ── 5. all lines off is a state ──────────────────────────────────────────────────────────

test('every line hidden still builds a chart — with a time base, and no line on it', () => {
  const chart = mkChart(['out', 'pet', 'group', 'inc'])
  assert.equal(hasDrawnLine(chart), false)
  assert.equal(chart.outLine, null)
  assert.equal(chart.outArea, null)
  assert.equal(chart.petLine, null)
  assert.equal(chart.groupLine, null)
  assert.equal(chart.incLine, null)
  // The time base survives, which is what keeps the empty state from being a different chart: the
  // markers a hidden plot still holds are placed on the same X they always were.
  assert.equal(chart.t0, 0)
  assert.equal(chart.t1, YOU.length * BUCKET)
  assert.equal(placeMarkers(mkView([{ t: 500, kind: 'coat', label: 'Neurotoxic' }]), chart).length, 1)
  // A degenerate scale must still be a usable number rather than 0 or NaN — `yAt` divides by it.
  assert.ok(chart.yMax > 0)
  assert.ok(Number.isFinite(yAt(chart.yMax, 0)))
  assert.equal(yAt(chart.yMax, 0), CHART_H - PAD_B)
})

test('all-but-one hidden draws that one, at its own full height', () => {
  const chart = mkChart(['out', 'pet', 'group'])
  assert.equal(hasDrawnLine(chart), true)
  assert.equal(chart.outLine, null)
  assert.equal(chart.yMax, Math.max(...INC))
  for (const p of parsePts(chart.incLine)) assert.ok(Math.abs(p.y - PAD_T) < 1e-9, 'a flat line at its own peak')
})

// ── 6. hidden marker kinds ───────────────────────────────────────────────────────────────

test('a hidden marker kind comes off the ticks, and stays in the set the legend is built from', () => {
  const chart = mkChart(['coat'])
  const markers: TimelineMarker[] = [
    { t: 100, kind: 'coat', label: 'Neurotoxic' },
    { t: 900, kind: 'slow', label: 'a froglok tad' },
    { t: 1500, kind: 'coat', label: 'Neurotoxic' }
  ]
  const placed = placeMarkers(mkView(markers), chart)
  assert.equal(placed.length, 3, 'placeMarkers still answers for the legend — hidden is not gone')
  const drawn = drawnMarkers(placed, ['coat'])
  assert.deepEqual(
    drawn.map(({ m }) => m.kind),
    ['slow']
  )
  // The survivors keep their own X: filtering is not re-placing.
  assert.equal(drawn[0].x, placed[1].x)
})

test('nothing hidden hands the placed markers straight back, same array', () => {
  // The ticks and the hover share this list through a memo; a fresh array on every render would
  // re-derive both for a set that did not change.
  const placed = placeMarkers(mkView([{ t: 100, kind: 'slow', label: 'x' }]), mkChart())
  assert.equal(drawnMarkers(placed, []), placed)
  // A curve key in the hidden set is not a marker kind, so it takes no tick with it.
  assert.equal(drawnMarkers(placed, ['out', 'pet']).length, 1)
})
