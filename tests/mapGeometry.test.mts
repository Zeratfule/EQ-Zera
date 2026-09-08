// The map viewer's PURE geometry (src/renderer/src/features/maps/mapGeometry.ts) — the whole
// boundary between "the file says these coordinates" and "the user sees this pane".
//
// WHY THIS BOUNDARY EXISTS. Four things here are silently wrong rather than loudly broken, and
// each of them is a bug you can stare at for an hour:
//
//   * THE COORDINATE CONVENTION. `/loc` prints (North/South, West/East, Elevation) and EQ's
//     world grows larger to the WEST and NORTH, so the map file stores (-EW, -NS, Z) — which
//     grows EAST and SOUTH. Get a sign wrong and the map is mirrored — which looks like a
//     perfectly good map of a zone you have never been to. That is precisely what shipped in
//     v0.6.3 ("North for South. East to West is accurate"), because the plan asserted the world
//     grew south and the render flipped y to compensate. It is pinned below TWICE: by name here,
//     and end-to-end through the real parser on real records from both packs (JOS-65, bottom).
//   * CURSOR-ANCHORED ZOOM. If the anchor drifts, zooming "walks" the map away from the cursor.
//     It still zooms, so nothing looks broken; it just feels wrong forever.
//   * THE CULL. Too eager and walls vanish at the edge of the pane; too lazy and the 26,383
//     segments of everfrost.txt are all drawn every frame.
//   * THE CLAMPS. Without them the map can be flung into empty space with no way back.
//
// Arithmetic only — no React, no DOM, no canvas, no fixture — so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LAYERS,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  clampView,
  cullSegments,
  expandRect,
  fit,
  fitScale,
  isZoomedIn,
  locFromMap,
  mapFromLoc,
  panBy,
  project,
  unproject,
  viewRect,
  visiblePoints,
  zoomAround,
  type LayerMask
} from '../src/renderer/src/features/maps/mapGeometry'
// The MAIN-side parser, imported here on purpose: the JOS-65 golden at the bottom of this file
// asserts what the user sees, and "what the user sees" starts at the bytes on disk. Both halves
// are pure and Electron-free, so the pair drives under plain `node --import tsx --test`.
import { buildMapData, parseMapText } from '../src/main/maps/parseMap'
import type { MapBounds, MapLines, MapPoint } from '../src/shared/maps'

/** 200 wide × 100 tall, centred on the origin — the numbers stay checkable by hand. */
const BOUNDS: MapBounds = { minX: -100, maxX: 100, minY: -50, maxY: 50, minZ: 0, maxZ: 10 }
/** A square pane, so the fit is width-limited and the letterboxing is visible. */
const VP = { w: 400, h: 400 }
/** No breathing room, so `fit` lands on round numbers. */
const NOPAD = 0

function near(a: number, b: number, eps = 1e-9): void {
  assert.ok(Math.abs(a - b) <= eps, `${String(a)} !~= ${String(b)}`)
}

test('the EQ coordinate convention: /loc (N/S, W/E, Z) maps to file (-W/E, -N/S, Z), Z never negated', () => {
  // Yther Ore's canonical worked example, the one the format docs are checked against:
  // a /loc of (155, -411, 15) is written into a map file as `P 411, -155, 15`.
  assert.deepEqual(mapFromLoc({ ns: 155, ew: -411, z: 15 }), { x: 411, y: -155, z: 15 })
  // Elevation is the one field that passes through untouched, in both directions.
  assert.deepEqual(locFromMap({ x: 411, y: -155, z: 15 }), { ns: 155, ew: -411, z: 15 })
  // The pair is an exact round trip, so a future /loc pin cannot drift from the parser.
  const loc = { ns: -1234.5, ew: 678.25, z: -7.5 }
  assert.deepEqual(locFromMap(mapFromLoc(loc)), loc)
  // EQ grows WEST and NORTH; the file therefore grows EAST and SOUTH. Two positive /loc numbers
  // (a north-west reading) are two negative map numbers — up and left of the origin on screen.
  const nw = mapFromLoc({ ns: 100, ew: 200, z: 0 })
  assert.ok(nw.x < 0 && nw.y < 0)
})

test('fit centres the zone and letterboxes the loose axis — it never stretches to fill', () => {
  const view = fit(BOUNDS, VP, NOPAD)
  assert.deepEqual({ cx: view.cx, cy: view.cy }, { cx: 0, cy: 0 })
  // Width-limited: 400px / 200 map units = 2. The 100-unit height uses only 200 of 400px.
  near(view.scale, 2)
  near(fitScale(BOUNDS, VP, NOPAD), 2)

  // The exact bounds land on the exact edges of the tight axis...
  near(project(view, VP, { x: BOUNDS.minX, y: 0 }).px, 0)
  near(project(view, VP, { x: BOUNDS.maxX, y: 0 }).px, VP.w)
  // ...and are centred, not scaled, on the other. maxY is the SOUTHERN edge, so it is the LOWER
  // one on screen — map y and screen y grow the same way.
  near(project(view, VP, { x: 0, y: BOUNDS.minY }).py, 100)
  near(project(view, VP, { x: 0, y: BOUNDS.maxY }).py, 300)

  // A fitted view is not "zoomed in" — the Fit / zoom-out controls have nothing to do.
  assert.equal(isZoomedIn(fit(BOUNDS, VP), BOUNDS, VP), false)
})

test('NEITHER axis is flipped: project is scale-and-translate, and round-trips exactly', () => {
  const view = fit(BOUNDS, VP, NOPAD)
  // Map y grows SOUTH and screen y grows down, so a LARGER map y is a LARGER py. The reverse of
  // this line is the JOS-65 defect: it renders a map that is mirrored north-for-south.
  assert.ok(project(view, VP, { x: 0, y: 40 }).py > project(view, VP, { x: 0, y: -40 }).py)
  // X grows east and grows right — the axis that was always correct.
  assert.ok(project(view, VP, { x: -40, y: 0 }).px < project(view, VP, { x: 40, y: 0 }).px)

  const p = { x: -37.5, y: 21.25 }
  const back = unproject(view, VP, project(view, VP, p))
  near(back.x, p.x, 1e-6)
  near(back.y, p.y, 1e-6)

  // The visible rect is the pane, expressed in map units: 400px at 2px/unit = 200 units wide.
  const r = viewRect(view, VP)
  assert.deepEqual(r, { minX: -100, maxX: 100, minY: -100, maxY: 100 })
})

test('cursor-anchored zoom holds the map point under the cursor exactly where it was', () => {
  const view = fit(BOUNDS, VP, NOPAD)
  const anchor = { px: 300, py: 100 }
  const before = unproject(view, VP, anchor)

  const zoomed = zoomAround({ view, bounds: BOUNDS, vp: VP, anchor, factor: ZOOM_STEP })
  const after = unproject(zoomed, VP, anchor)
  near(after.x, before.x, 1e-6)
  near(after.y, before.y, 1e-6)
  near(zoomed.scale, 2 * ZOOM_STEP, 1e-9)

  // And it survives a run of notches, which is how a user actually zooms.
  let v = view
  for (let i = 0; i < 6; i += 1) v = zoomAround({ view: v, bounds: BOUNDS, vp: VP, anchor, factor: ZOOM_STEP })
  const held = unproject(v, VP, anchor)
  near(held.x, before.x, 1e-4)
  near(held.y, before.y, 1e-4)
  assert.equal(isZoomedIn(v, BOUNDS, VP), true)

  // Zooming back out by the same factor returns the same scale — the step is exactly invertible.
  const out = zoomAround({ view: zoomed, bounds: BOUNDS, vp: VP, anchor, factor: 1 / ZOOM_STEP })
  near(out.scale, 2, 1e-9)
})

test('the clamps: scale is bounded relative to fit, and the pane centre never leaves the zone', () => {
  const base = fitScale(BOUNDS, VP)
  const anchor = { px: VP.w / 2, py: VP.h / 2 }

  let inward = fit(BOUNDS, VP)
  for (let i = 0; i < 200; i += 1) {
    inward = zoomAround({ view: inward, bounds: BOUNDS, vp: VP, anchor, factor: ZOOM_STEP })
  }
  near(inward.scale, base * MAX_ZOOM, 1e-6)

  let outward = fit(BOUNDS, VP)
  for (let i = 0; i < 200; i += 1) {
    outward = zoomAround({ view: outward, bounds: BOUNDS, vp: VP, anchor, factor: 1 / ZOOM_STEP })
  }
  near(outward.scale, base * MIN_ZOOM, 1e-6)

  // Pan limit: the viewport centre is held inside the zone's extent, so the map is always
  // findable however hard it is flung.
  // Dragging LEFT and DOWN drags the MAP left and down, so the window travels the other way:
  // east (+x) and north (-y). Both runs stop at the zone's edge.
  const flung = panBy({ cx: 0, cy: 0, scale: 4 }, BOUNDS, VP, { px: -100000, py: 100000 })
  assert.deepEqual({ cx: flung.cx, cy: flung.cy }, { cx: BOUNDS.maxX, cy: BOUNDS.minY })
  const other = panBy({ cx: 0, cy: 0, scale: 4 }, BOUNDS, VP, { px: 100000, py: -100000 })
  assert.deepEqual({ cx: other.cx, cy: other.cy }, { cx: BOUNDS.minX, cy: BOUNDS.maxY })

  // A drag is stated as a TOTAL delta from the drag's start, so it is exactly reversible.
  const start = { cx: 10, cy: -5, scale: 4 }
  const moved = panBy(start, BOUNDS, VP, { px: 40, py: -20 })
  assert.deepEqual(moved, { cx: 0, cy: 0, scale: 4 })
  assert.deepEqual(panBy(start, BOUNDS, VP, { px: 0, py: 0 }), start)

  // clampView is the one place the limits live; it is idempotent.
  const c = clampView({ cx: 1e9, cy: -1e9, scale: 1e9 }, BOUNDS, VP)
  assert.deepEqual(clampView(c, BOUNDS, VP), c)
})

test('a degenerate zone (zero extent, unmeasured pane) fits at a finite scale instead of Infinity', () => {
  const flat: MapBounds = { minX: 5, maxX: 5, minY: 5, maxY: 5, minZ: 0, maxZ: 0 }
  const v = fit(flat, VP, NOPAD)
  assert.ok(Number.isFinite(v.scale) && v.scale > 0)
  assert.deepEqual({ cx: v.cx, cy: v.cy }, { cx: 5, cy: 5 })
  // Before the first ResizeObserver callback the pane is 0×0 — that must not be a division.
  assert.equal(fitScale(BOUNDS, { w: 0, h: 0 }), 1)
})

// ---- culling ------------------------------------------------------------------------------

interface Seg {
  x1: number
  y1: number
  x2: number
  y2: number
  layer: number
}

/** Hand-build the columnar shape the parser emits, so the cull is tested on the real layout. */
function linesOf(segs: Seg[]): MapLines {
  const coords = new Float32Array(segs.length * 6)
  const layer = new Uint8Array(segs.length)
  segs.forEach((s, i) => {
    coords.set([s.x1, s.y1, 0, s.x2, s.y2, 0], i * 6)
    layer[i] = s.layer
  })
  return {
    coords,
    palette: Uint8Array.from([0, 0, 0]),
    colorIndex: new Uint8Array(segs.length),
    layer,
    count: segs.length
  }
}

const RECT = { minX: -10, maxX: 10, minY: -10, maxY: 10 }
const ALL_LAYERS: LayerMask = [true, true, true, true]

const SEGS: Seg[] = [
  { x1: 0, y1: 0, x2: 5, y2: 5, layer: 0 }, // 0: wholly inside
  { x1: 500, y1: 500, x2: 510, y2: 510, layer: 0 }, // 1: far away
  { x1: -40, y1: 0, x2: 40, y2: 0, layer: 0 }, // 2: crosses the rect end to end
  { x1: 0, y1: 0, x2: 4, y2: 4, layer: 2 }, // 3: inside, but on the LEGEND layer
  { x1: -9, y1: -100, x2: 100, y2: -9, layer: 0 }, // 4: box overlaps, line misses (see below)
  { x1: 0, y1: 40, x2: 0, y2: 200, layer: 0 } // 5: above the rect on both endpoints
]

test('the cull keeps every segment that could be seen, drops the ones that provably cannot', () => {
  const lines = linesOf(SEGS)
  const out = new Uint32Array(lines.count)
  const n = cullSegments(lines, RECT, ALL_LAYERS, out)
  // 4 is the CONSERVATIVE keep: its bounding box straddles the rect, its line passes x≈99 at
  // y=-10 and never enters. Four comparisons per segment beat an exact clip, and the canvas
  // discards the handful of false keeps for free — a cull may never drop a visible wall.
  assert.deepEqual([...out.slice(0, n)], [0, 2, 3, 4])
})

test('the layer mask is applied inside the cull, so a hidden legend costs nothing to hide', () => {
  const lines = linesOf(SEGS)
  const out = new Uint32Array(lines.count)
  // DEFAULT_LAYERS has the legend (layer 2) off — measured reason: brewall\airplane_2.txt spans
  // y[-250..4800] against a map of y[-1668..1737].
  assert.equal(DEFAULT_LAYERS[2], false)
  const n = cullSegments(lines, RECT, DEFAULT_LAYERS, out)
  assert.deepEqual([...out.slice(0, n)], [0, 2, 4])
})

test('the cull writes into the CALLER’s buffer and truncates rather than overrunning it', () => {
  const lines = linesOf(SEGS)
  const small = new Uint32Array(2)
  assert.equal(cullSegments(lines, RECT, ALL_LAYERS, small), 2)
  assert.deepEqual([...small], [0, 2])
  // An empty map is an answer, not a crash.
  assert.equal(cullSegments(linesOf([]), RECT, ALL_LAYERS, new Uint32Array(0)), 0)
})

// ---- points -------------------------------------------------------------------------------

function pt(x: number, y: number, layer: MapPoint['layer'], label = 'a_b'): MapPoint {
  return { x, y, z: 0, r: 0, g: 0, b: 0, size: 2, label, display: label.replace(/_/g, ' '), layer }
}

test('visible points carry their ORIGINAL index, so a React key survives panning', () => {
  const points = [pt(0, 0, 0), pt(900, 900, 0), pt(5, -5, 1), pt(1, 1, 2)]
  const vis = visiblePoints(points, RECT, DEFAULT_LAYERS)
  // Index 1 is off-screen; index 3 is on the hidden legend layer.
  assert.deepEqual(
    vis.map((v) => v.index),
    [0, 2]
  )
  assert.equal(vis[0].point.display, 'a b')

  // Overscan is what stops a label popping out of existence when its anchor leaves the pane.
  const wide = visiblePoints(points, expandRect(RECT, 1000), DEFAULT_LAYERS)
  assert.deepEqual(
    wide.map((v) => v.index),
    [0, 1, 2]
  )
})

// ---- JOS-65: north is north, in both packs, through the whole transform ---------------------
//
// THE DEFECT THIS PINS (user report, v0.6.3): "The maps all appear inverted. North for South.
// East to West is accurate, but N-S is reversed." The plan (§2.1) said EQ's world grew west AND
// SOUTH, so map-file y — which is `-NS` — would grow north and the renderer flipped y to put it
// on screen. The west half was right; the south half was not. One wrong word, one spurious
// negation, every zone mirrored on one axis only.
//
// WHY IT IS PINNED END TO END rather than on `project` alone: the sign lives in the file, and a
// unit test written against the same wrong belief passes just as happily. So these records are
// REAL BYTES, copied verbatim out of a live `<eqRoot>\maps` (two P records per case, cited by
// pack and file), driven through the real main-side parser and the real renderer transform —
// `parseMapText` → `buildMapData` → `fit` → `project` — and the assertion is about the SCREEN.
// Both packs are covered because a pack-specific convention was a live hypothesis until measured;
// they agree exactly, so the seam is one transform and never a per-pack correction.
//
// WHY OASIS OF MARR. The Desert of Ro runs North Ro → Oasis → South Ro, so the zone's two exits
// are a compass with no ambiguity to argue about, and both packs label them in their own words.
// Corroborated (not duplicated) by North Karana, which states its southern and its eastern and
// western exits in one file and so pins BOTH axes from one zone — including the axis that was
// never broken, which is what stops a future "fix" from over-rotating the map.

const OASIS_DEFAULT = `P 58.7071, -2413.2568, 34.3489,  150, 0, 200,  3,  to_The_Northern_Desert_of_Ro
P -169.0031, 1859.4617, 1.6049,  150, 0, 200,  3,  to_The_Southern_Desert_of_Ro`

const OASIS_BREWALL = `P 729.5562, -2528.1421, 5.9739, 255, 0, 0, 3, to_North_Desert_of_Ro
P -165.1611, 1931.1563, 6.1756, 255, 0, 0, 3, to_South_Desert_of_Ro`

const NKARANA_DEFAULT = `P -3157.6912, 1416.7402, -4.7389,  150, 0, 200,  3,  to_The_Western_Plains_of_Karana
P 3060.4275, -1.4579, -38.1451,  150, 0, 200,  3,  to_The_Eastern_Plains_of_Karana
P -1205.2698, 4464.4009, -35.2076,  150, 0, 200,  3,  to_The_Southern_Plains_of_Karana`

const NKARANA_BREWALL = `P -3030.1037, 1535.0552, -0.1864, 255, 0, 0, 3, to_The_Western_Plains_of_Karana
P 3071.1369, -11.8329, -36.7176, 255, 0, 0, 3, to_The_Eastern_Plains_of_Karana
P -1211.2083, 4355.5541, -33.7801, 255, 0, 0, 3, to_The_Southern_Plains_of_Karana`

/** A realistic pane — the numbers below are about ORDER, so any non-degenerate size will do. */
const PANE = { w: 900, h: 600 }

/**
 * One zone's labels as the user would see them: parsed by the shipping parser, fitted to a pane,
 * and projected to CSS pixels. Keyed by label so a case reads as the map does.
 */
function onScreen(text: string, zone: string): Map<string, { px: number; py: number }> {
  const data = buildMapData([parseMapText(text, 1)], { zone, sources: [] })
  const view = fit(data.bounds, PANE)
  const out = new Map<string, { px: number; py: number }>()
  for (const p of data.points) out.set(p.label, project(view, PANE, p))
  return out
}

test('JOS-65 the map is not mirrored: north renders ABOVE south, in both packs', () => {
  for (const [pack, text, north, south] of [
    ['default', OASIS_DEFAULT, 'to_The_Northern_Desert_of_Ro', 'to_The_Southern_Desert_of_Ro'],
    ['brewall', OASIS_BREWALL, 'to_North_Desert_of_Ro', 'to_South_Desert_of_Ro']
  ] as const) {
    const at = onScreen(text, 'oasis')
    const n = at.get(north)
    const s = at.get(south)
    assert.ok(n && s, `${pack}: both exits parsed`)
    // The whole ticket, in one comparison: SMALLER py is HIGHER on screen.
    assert.ok(n.py < s.py, `${pack}: ${north} (py=${String(n.py)}) must be above ${south} (py=${String(s.py)})`)
    // And they are genuinely apart — a degenerate fit that collapsed both to the pane centre
    // would satisfy nothing while passing a lazier assertion.
    assert.ok(s.py - n.py > PANE.h / 2, `${pack}: the two exits span the pane`)
  }
})

test('JOS-65 …and east-to-west is left untouched, which is why the report named only N-S', () => {
  for (const [pack, text] of [
    ['default', NKARANA_DEFAULT],
    ['brewall', NKARANA_BREWALL]
  ] as const) {
    const at = onScreen(text, 'northkarana')
    const east = at.get('to_The_Eastern_Plains_of_Karana')
    const west = at.get('to_The_Western_Plains_of_Karana')
    const south = at.get('to_The_Southern_Plains_of_Karana')
    assert.ok(east && west && south, `${pack}: three exits parsed`)
    assert.ok(east.px > west.px, `${pack}: east must render right of west`)
    // North Karana's only stated N-S exit is its southern one, and it must sit BELOW the pair
    // that straddles the zone's middle — the same fact as the Oasis case, from other bytes.
    assert.ok(south.py > east.py && south.py > west.py, `${pack}: the southern exit is at the bottom`)
  }
})
