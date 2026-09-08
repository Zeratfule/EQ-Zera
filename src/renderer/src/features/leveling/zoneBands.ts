// zoneBands.ts — the progression snapshot turned into leveling-chart GEOMETRY: the one
// time domain both charts share, the zone band strip, its palette, and the legend rows.
//
// Pure: no React, no DOM, no MUI, and only TYPE imports from `@shared`, so
// tests/zoneBands.test.mts can import it straight under tsx (there is no `@shared/*` alias
// in the node test runner — same constraint levelChartGeometry.ts documents).
//
// WHY THE MERGE EXISTS. The log's zone intervals are `[zoneLine[i].ts, zoneLine[i+1].ts)`
// and 81 of the 344 real post-epoch intervals are shorter than 60 s — zone-line bounces and
// instance re-entries of the SAME place (the `(Awakened|Adaptive|Fused|Refined)` tier
// suffix and the `- Solo/Group N` selector are instance noise, not a different zone).
// Drawn unmerged they are sub-pixel slivers between two halves of one visit. So consecutive
// intervals that fold to the same zone key are merged into ONE band BEFORE drawing, and
// only what survives the merge and is still under a pixel wide is dropped — from the
// DRAWING only. Nothing is dropped from the data: `rangeStats` reads the snapshot's own
// columns and still counts every visit.
//
// WHY THE COLOR IS OURS. The log carries no zone color of any kind. The palette below is a
// PRESENTATION CHOICE — exactly the posture `CONSIDER_FACTION_COLOR` takes about faction
// hues (shared/logEvents.ts): the game states no such thing, we picked these to be
// distinguishable. A stable hash keeps a zone the same color across sessions, panels and
// the (wave 3) per-zone table, which is the only property that matters.

import type { ProgressionSnap } from '@shared/types'
// The renderer's ONE zone-name fold (features/mobs/mobZone.ts): instance noise stripped,
// leading article folded, separators normalized, case-insensitive. Imported rather than
// re-implemented — two different "same zone?" answers in one app is exactly the drift that
// rule exists to prevent. It is a pure, node-testable function with only a type import.
import { zoneKey } from '../mobs/mobZone'
import { CHART_W, xOf, type ChartScale } from './levelChartGeometry'
// The window/bucket derivation (JOS-71). It knows nothing about a snapshot — this module owns
// "where does the data start and end", that one owns "which slice of it are we looking at".
import { windowFor, type TimescaleId } from './chartWindow'

/** The band strip's height, in viewBox units. */
export const BAND_H = 8
/** Top padding a chart must ADD to make room for the strip: the strip plus a 2u gap. */
export const BAND_PAD = BAND_H + 2
/** The horizontal inset both charts draw with. One value, so one domain maps to one pixel. */
export const PAD_X = 8
/**
 * OUR palette, not the game's (see the header). Twelve hues chosen to stay distinguishable
 * side by side in an 8px strip on the dark theme. This is the ONLY place in this feature
 * that introduces a color literal.
 */
export const ZONE_PALETTE: readonly string[] = [
  '#5b8ff9',
  '#61ddaa',
  '#f6bd16',
  '#7262fd',
  '#78d3f8',
  '#9661bc',
  '#f6903d',
  '#3ba7a5',
  '#f08bb4',
  '#5ad8a6',
  '#d96a6a',
  '#8ca0b3'
]

/** One drawable zone visit: already clipped to the domain and merged with its neighbours. */
export interface ZoneBand {
  /** the folded key the merge ran on (see zoneKey). */
  key: string
  /** RAW display name, first-seen casing (law 2: canonicalize at boundaries, display raw). */
  name: string
  start: number
  end: number
}

/** A band's rectangle in viewBox units. Sub-pixel bands never make it into this list. */
export interface ZoneBandRect {
  key: string
  name: string
  color: string
  x: number
  w: number
}

export interface ZoneLegendRow {
  key: string
  name: string
  color: string
  /** total dwell inside the visible domain, summed over every visit. */
  ms: number
}

export interface ZoneLegend {
  rows: ZoneLegendRow[]
  /** distinct zones beyond the row cap — rendered as `+N more`, never silently dropped. */
  more: number
}

/** FNV-1a, 32-bit. Any stable string hash would do; this one is short and dependency-free. */
function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A zone's color. Accepts a RAW zone name or an already-folded key — `zoneKey` is
 * idempotent, so the band strip, the legend and a stats table row all land on the same hue
 * whichever one they happen to hold.
 */
export function zoneColor(zone: string): string {
  const key = zoneKey(zone) || zone.trim().toLowerCase()
  return ZONE_PALETTE[hash32(key) % ZONE_PALETTE.length]
}

/** Fold one timestamp into a running min/max. 0 means "no timestamp" everywhere in this app. */
function widen(bounds: { lo: number; hi: number }, ts: number): void {
  if (ts <= 0) return
  if (ts < bounds.lo) bounds.lo = ts
  if (ts > bounds.hi) bounds.hi = ts
}

/** The first and last instant this character's history holds. `hi - lo` is the span every
 *  timescale decision is measured against (chartWindow.ts `availableTimescales`). */
export interface DataBounds {
  lo: number
  hi: number
}

/**
 * WHERE THE DATA STARTS AND ENDS: the extremes of every progression timestamp plus whatever
 * series the caller draws (level dings, AA gains).
 *
 * Returns null when nothing has a timestamp at all — the caller renders its empty state
 * rather than a chart over a fabricated axis.
 */
export function dataBounds(snap: ProgressionSnap, extraTs: readonly number[]): DataBounds | null {
  const b = { lo: Infinity, hi: -Infinity }
  for (const ts of extraTs) widen(b, ts)
  // Columns are ascending (log order is time order), so the ends are the extremes.
  for (const col of [snap.expTs, snap.killTs, snap.witnessTs, snap.lootTs, snap.zoneStart, snap.levelTs, snap.aaGainTs]) {
    if (col.length > 0) {
      widen(b, col[0])
      widen(b, col[col.length - 1])
    }
  }
  widen(b, snap.lastTs)
  return Number.isFinite(b.lo) && Number.isFinite(b.hi) ? { lo: b.lo, hi: b.hi } : null
}

/**
 * THE ONE TIME DOMAIN (plan §6.1). Both charts used to compute their own `t0/t1` from their
 * own points, so the AA chart and the level chart were on DIFFERENT x axes: a zone band or a
 * drag selection at the same pixel meant two different instants. This computes one domain
 * from `dataBounds`, cut to the requested TIMESCALE (JOS-71), and both charts take it as a prop.
 *
 * The default is `full`, which is the domain these charts have always drawn — so a caller that
 * never mentions a timescale, and a user who never touches the control, get exactly what they
 * had. Returns null when there is nothing to draw over.
 */
export function chartDomain(
  snap: ProgressionSnap,
  extraTs: readonly number[],
  scale: TimescaleId = 'full'
): ChartScale | null {
  const b = dataBounds(snap, extraTs)
  return b ? { ...windowFor(b.lo, b.hi, scale), w: CHART_W, padX: PAD_X } : null
}

/** The zone columns this module reads. `ProgressionSnap` is structurally assignable. */
export type ZoneColumns = Pick<ProgressionSnap, 'zoneStart' | 'zoneEnd' | 'zoneName' | 'lastTs'>

/**
 * The bands covering `[t0,t1]`, clipped and merged.
 *
 * The still-open final interval (`zoneEnd === 0`) is clamped to `lastTs` — the snapshot's
 * last folded event — and then to the domain: we know you were there through the last thing
 * the log said, and nothing after that.
 *
 * ZONE ATTRIBUTION GUARD: this renders exactly what the snapshot HOLDS. The zone column is
 * capped drop-oldest (`ZONE_CAP`), so a strip that starts partway across the chart is not a
 * claim that you were nowhere before it — the snapshot's `windowStart` is where that is
 * stated, and `rangeStats` reports it as `clipped`. The strip and the legend say nothing
 * about earlier.
 */
export function mergeZoneBands(cols: ZoneColumns, t0: number, t1: number): ZoneBand[] {
  const out: ZoneBand[] = []
  for (let i = 0; i < cols.zoneName.length; i++) {
    const open = cols.zoneEnd[i] === 0
    const rawEnd = open ? Math.max(cols.lastTs, cols.zoneStart[i]) : cols.zoneEnd[i]
    const start = Math.max(cols.zoneStart[i], t0)
    const end = Math.min(rawEnd, t1)
    if (end <= start) continue
    const key = zoneKey(cols.zoneName[i]) || cols.zoneName[i].trim().toLowerCase()
    const prev = out[out.length - 1]
    // Intervals are contiguous and half-open by construction, so consecutive same-key
    // visits are one stay that the log happened to re-announce (an instance bounce).
    if (prev?.key === key) {
      prev.end = Math.max(prev.end, end)
      continue
    }
    out.push({ key, name: cols.zoneName[i], start, end })
  }
  return out
}

/**
 * The merged band covering `ts`, or null.
 *
 * Reads the SAME merged list the strip draws, so the hover readout and the band under the
 * cursor can never disagree — an instance bounce that merged into its neighbours reports the
 * base zone, which is exactly what the strip is showing there.
 *
 * Intervals are HALF-OPEN `[start, end)`: the instant you zone out belongs to the new zone,
 * never to both. `mergeZoneBands` emits them ascending and disjoint (log order is time
 * order), so this is a binary search.
 *
 * null is a real answer, not a fallback: before the first zone line in the window — and
 * anywhere the capped zone column has aged out (`windowStart`) — the log does not say where
 * you were, so the caller renders NO zone row rather than guessing (world-model law 1).
 */
export function zoneAt(bands: readonly ZoneBand[], ts: number): ZoneBand | null {
  let lo = 0
  let hi = bands.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const b = bands[mid]
    if (ts < b.start) hi = mid - 1
    else if (ts >= b.end) lo = mid + 1
    else return b
  }
  return null
}

/**
 * Bands as rectangles, dropping anything under `minW`. The threshold is in VIEWBOX units,
 * which is one screen pixel at the 720u reference width and slightly less than one on a
 * wider panel — the charts stretch (`preserveAspectRatio="none"`), so an exact pixel
 * threshold would need the measured element width for a distinction nobody can see.
 */
export function bandRects(bands: readonly ZoneBand[], scale: ChartScale, minW = 1): ZoneBandRect[] {
  const out: ZoneBandRect[] = []
  for (const b of bands) {
    const x = xOf(scale, b.start)
    const w = xOf(scale, b.end) - x
    if (w < minW) continue
    out.push({ key: b.key, name: b.name, color: zoneColor(b.key), x, w })
  }
  return out
}

/** How the strip is DRAWN: its height in user units, the alpha its rectangles take, and which of
 *  the two jobs it is doing — carried so a test and the DOM can name it rather than infer it. */
export interface BandStripStyle {
  kind: 'full' | 'quiet'
  height: number
  opacity: number
}

/** The strip doing its ordinary job — telling several zones apart along the top of a plot. */
const STRIP_NORMAL: BandStripStyle = { kind: 'full', height: BAND_H, opacity: 0.75 }
/** …and the strip with nothing to distinguish: one zone, the whole window. */
const STRIP_QUIET: BandStripStyle = { kind: 'quiet', height: 3, opacity: 0.4 }
/** How much of the plot one band must cover before it counts as "the whole window". Not 100%:
 *  the merge clips to the domain and a zone line landing a second inside it leaves a sliver. */
const FULL_COVERAGE = 0.98

/**
 * THE STRIP'S WEIGHT, WHICH DEPENDS ON WHETHER IT IS SAYING ANYTHING (JOS-339).
 *
 * The owner's report: a single zone covering the whole window renders as a thick slab across the
 * top of both plots — it reads as chrome, or worse as a bar of its own, when it is context. And it
 * is context with nothing to contrast against: one band spanning everything distinguishes NOTHING.
 * The legend under the lower plot already names the zone and its dwell, so at full coverage the
 * strip's whole job is "and you were somewhere the entire time", which a 3-unit rule at 0.4 says
 * as well as an 8-unit slab at 0.85 and without shouting over the curve beneath it.
 *
 * TWO ZONES AND IT IS BACK TO FULL WEIGHT, because then the strip is doing the job it exists for:
 * where one zone ends and the next begins is a real edge and the eye has to be able to find it.
 */
export function bandStripStyle(rects: readonly ZoneBandRect[], scale: ChartScale): BandStripStyle {
  if (rects.length !== 1) return STRIP_NORMAL
  const plotW = scale.w - 2 * scale.padX
  return plotW > 0 && rects[0].w >= plotW * FULL_COVERAGE ? STRIP_QUIET : STRIP_NORMAL
}

/**
 * The legend rows: the top `limit` zones by dwell inside the visible domain, plus how many
 * distinct zones did not fit. This is the identification path that does NOT depend on hover
 * — the bands themselves carry no native `<title>` (the hover layer owns tooltips on these
 * charts, and a browser tooltip would race its card).
 */
export function zoneLegend(bands: readonly ZoneBand[], limit = 8): ZoneLegend {
  const by = new Map<string, ZoneLegendRow>()
  for (const b of bands) {
    const row = by.get(b.key)
    if (row) row.ms += b.end - b.start
    else by.set(b.key, { key: b.key, name: b.name, color: zoneColor(b.key), ms: b.end - b.start })
  }
  const all = [...by.values()].sort((a, z) => z.ms - a.ms || (a.name < z.name ? -1 : 1))
  return { rows: all.slice(0, limit), more: Math.max(0, all.length - limit) }
}
