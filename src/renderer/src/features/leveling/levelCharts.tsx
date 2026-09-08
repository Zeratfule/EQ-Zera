// The leveling view's two inline SVG chart primitives. They take already-derived
// series (see ./levelSeries.ts for the world model behind the level one) and draw
// them — no data shaping, no MUI, no chart library. Split out of LevelingView.tsx
// for file mass; the drawing rules themselves are unchanged.
//
// Both charts now take ONE `ChartScale` from the view (see ./zoneBands.ts `chartDomain`).
// They used to compute their own, so a zone band or a range selection at the same pixel
// meant two different instants on the two charts. The shared domain is the seam the band
// strip and the drag selection hang off.
//
// THE X DOMAIN IS SHARED; THE Y DOMAINS ARE NOT, and since JOS-339 neither of them is "the data,
// exactly" either. Each chart derives its own vertical axis from levelChartGeometry — `paddedAxis`
// for the AA total, `levelAxis` for the level bar — because they measure different kinds of thing
// and a short window is where the difference stops being academic. That module carries the whole
// argument; this file draws what it decides and states the two bounds beside the plot.
//
// AND NOTHING IN THIS FILE PUTS TEXT INSIDE AN SVG. The plots stretch
// (`preserveAspectRatio="none"`), so a `<text>` node in one is a smeared label at any pane wider
// than 720px. Both the range band's edge ticks and the y-axis marks are HTML overlays for that one
// reason — see `AxisLabels` for why the alternatives were worse.

import { useSyncExternalStore, type CSSProperties, type JSX } from 'react'
import type { LevelSegment } from './levelSeries'
import {
  CHART_H,
  CHART_W,
  levelAxis,
  paddedAxis,
  xOf,
  yOf,
  type AaPoint,
  type ChartScale
} from './levelChartGeometry'
// THE FRACTIONAL CURVE (JOS-292) and the spans it refuses to draw. This file draws what that
// one derives and adds no arithmetic of its own — the y mapping is the only maths left here.
import { gapRect, runArea, runPolyline, type CurveRefusal, type LevelCurve } from './levelCurve'
import { LevelHoverLayer } from './LevelHoverLayer'
import { formatTime } from '../../lib/formatDate'
import { BAND_PAD, PAD_X, bandRects, bandStripStyle, type ZoneBand, type ZoneLegend } from './zoneBands'
import type { ChartSelection, SelectionPointerHandlers } from './useChartSelection'
import type { DraftStore } from './selectionDraft'

const W = CHART_W
const H = CHART_H

/**
 * Everything both charts need in order to agree with each other: the one time domain, the
 * zone bands over it, the current range band, and the drag handlers. Bundled into a single
 * prop so adding a chart-wide concern later is one plumbing change, not two.
 */
export interface ChartChrome {
  scale: ChartScale
  bands: readonly ZoneBand[]
  /** The COMMITTED selection — the SAME band is drawn on both charts. Since JOS-290 it is only
   *  the committed one: the live draft arrives on `draft` instead, so a pointermove no longer
   *  travels through the view that builds this object. */
  range: ChartSelection | null
  /** The live draft, as a SUBSCRIPTION (JOS-290, selectionDraft.ts). `SelectionBand` is the one
   *  subscriber in the app and it outranks `range` while it holds a value. */
  draft: DraftStore
  /** a range drag owns the pointer: the hover tooltip must not render. */
  suppressed: boolean
  pointer: SelectionPointerHandlers
}

/**
 * Positioned ancestor for the hover + selection layers, and the element the drag handlers
 * bind to (see useChartSelection for why it is the wrapper and not the <svg>). A plain
 * `div`, not an MUI `Box`: this file is deliberately MUI-free (see the header), and emotion
 * would serialize a style object on every render of a component that sits directly under a
 * pointermove path. `touchAction`/`userSelect` are what make a horizontal drag a range drag
 * instead of a scroll gesture or a text selection.
 */
const WRAP_STYLE: CSSProperties = { position: 'relative', touchAction: 'none', userSelect: 'none' }

/**
 * The AA chart's headroom rule (JOS-339, levelChartGeometry.paddedAxis).
 *
 * `minSpan: 1` is one AA point — the smallest domain a window can honestly have, and what stops a
 * gainless window collapsing to a zero-height box. `minPad: 0.35` is the number that matters at
 * the reported shape: a +2 AA window's 12% is a quarter of a point, so without a floor the padding
 * would be invisible exactly where it was asked for. Snapping the domain to whole numbers instead
 * would have doubled it and halved the staircase, which is the picture this is fixing.
 */
const AA_PAD = { minSpan: 1, padFrac: 0.12, minPad: 0.35, floor: 0 }

/**
 * Every stroke in these plots takes this.
 *
 * `preserveAspectRatio="none"` scales X and Y differently, and a scaled stroke is scaled with
 * them: at a 970px pane a 2-unit line is 2px thick where it runs horizontally and 2.7px where it
 * runs vertically. On a curve made of horizontal holds and vertical steps that is a stroke that
 * changes weight as it turns a corner — part of what made the level curve read as a ragged
 * hairline at short windows. `non-scaling-stroke` is 2 device pixels everywhere, which is the
 * "curve weight at low vertical range" half of the ticket and costs nothing.
 */
const CRISP = 'non-scaling-stroke'

/**
 * z-order reserved across the chart stack: 1 = range band, 2 = crosshair, 3 = tooltip.
 *
 * `overflow:hidden` is the timescale guard (JOS-71): the band is positioned in PERCENT of the
 * domain, so a selection that ends up outside a narrower window would paint at -400% — over the
 * neighbouring panels. The view drops a selection the new window cannot contain, and this makes
 * that a structural impossibility rather than a promise. The edge tick labels sit inside the
 * band's own edges, so nothing legitimate is clipped.
 */
const SEL_LAYER: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }
const TICK: CSSProperties = { position: 'absolute', bottom: 0, fontSize: 9, lineHeight: '11px', whiteSpace: 'nowrap' }

/**
 * The zone strip: which zone you were in, along the top of the plot.
 *
 * NO `<title>` children on the bands. The hover layer owns tooltips on these charts and a
 * native browser tooltip would race its card — one owner, per the plan's §6.2 arbitration.
 * Identification without hover is the legend's job (ZoneLegendStrip below).
 */
function ZoneBandStrip({ bands, scale }: { bands: readonly ZoneBand[]; scale: ChartScale }): JSX.Element | null {
  const rects = bandRects(bands, scale)
  if (rects.length === 0) return null
  // The strip's weight is a function of whether it is telling anything apart (JOS-339,
  // zoneBands.bandStripStyle). Derived there, not here: it is geometry over the drawn rectangles,
  // and this file's job is to draw what that one decides.
  const strip = bandStripStyle(rects, scale)
  return (
    <g data-testid="leveling-zone-bands" data-strip={strip.kind}>
      {rects.map((r, i) => (
        <rect
          key={`${r.key}-${i}`}
          data-testid="leveling-zone-band"
          x={r.x}
          y={0}
          width={r.w}
          height={strip.height}
          fill={r.color}
          opacity={strip.opacity}
        />
      ))}
    </g>
  )
}

/**
 * THE AXIS LABELS, AS HTML — the one thing in these plots that must NOT stretch (JOS-339).
 *
 * The owner's report named it: `444`/`442` and `23`/`22` come out horizontally smeared. The cause
 * is structural, not a font bug — both plots draw at a fixed 720-unit viewBox with
 * `preserveAspectRatio="none"` and are then scaled to the pane width, so at a 970px pane every
 * glyph inside the SVG is 1.35x wide and the same height.
 *
 * WHY HTML AND NOT A COUNTER-TRANSFORM. A `scale(1/sx, 1)` on each `<text>` needs `sx`, and `sx`
 * is the MEASURED element width — which would put a ResizeObserver into a component that sits
 * directly under a pointermove path, to buy back something the DOM can do for free. And the fixed
 * viewBox is not negotiable: it is the one time base (`pxToUser`, the hover inverse, the selection
 * band) that JOS-290/291/331 all stand on, so the geometry has to keep stretching.
 *
 * `SelectionBand` above already made this exact argument for its edge tick labels and already
 * solved it this way: percent offsets against the stretched viewBox land in the same place the SVG
 * geometry would, and the text stays upright. This is that, for the y axis. Y needs no percent at
 * all — the SVG's `height` attribute equals the viewBox height, so one user unit IS one CSS pixel
 * vertically, which is the same 1:1 that lets the hover layer skip an inverse for Y.
 */
const AXIS_LAYER: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }
/** `translateY(-100%)` puts the box's BOTTOM on `top`, which is where an SVG `y` puts a baseline —
 *  so a mark reads at the same height it did as a `<text>`, only unsmeared. */
const AXIS_TEXT: CSSProperties = {
  position: 'absolute',
  left: `${(PAD_X / CHART_W) * 100}%`,
  fontSize: 10,
  lineHeight: '11px',
  whiteSpace: 'nowrap',
  opacity: 0.7,
  transform: 'translateY(-100%)'
}

/** One value marked on the y axis: what it says, and the user unit (== CSS pixel) it says it at. */
interface AxisMark {
  text: string
  y: number
}

function AxisLabels({ marks, color }: { marks: readonly AxisMark[]; color: string }): JSX.Element | null {
  if (marks.length === 0) return null
  return (
    <div style={AXIS_LAYER} data-testid="leveling-axis-labels">
      {marks.map((m) => (
        <div key={m.text} data-testid="leveling-axis-label" style={{ ...AXIS_TEXT, top: m.y, color }}>
          {m.text}
        </div>
      ))}
    </div>
  )
}

/**
 * The range band, as HTML rather than SVG. The plots are `preserveAspectRatio="none"`, so
 * anything drawn inside them is horizontally STRETCHED — fine for a rect, ruinous for the
 * edge tick labels. Percent offsets against the stretched viewBox width land in exactly the
 * same place as the SVG geometry would, and the text stays upright.
 *
 * `pointerEvents:'none'` throughout: the band must never steal a hover target, so the
 * tooltip stays fully live over a committed selection.
 *
 * THIS IS THE DRAG HANDLE, AND IT IS THE ONLY THING A POINTERMOVE RE-RENDERS (JOS-290). It
 * subscribes to the draft store directly rather than being handed a value from the view, which
 * is what took 284 ms of tab re-render off every single move; the precedence is unchanged —
 * a live draft outranks the committed selection, exactly as the old `draft ?? sel` did.
 */
function SelectionBand({
  scale,
  committed,
  draft,
  color
}: {
  scale: ChartScale
  committed: ChartSelection | null
  draft: DraftStore
  color: string
}): JSX.Element | null {
  const live = useSyncExternalStore(draft.subscribe, draft.get, draft.get)
  const range = live ?? committed
  if (!range) return null
  const l = (xOf(scale, range.t0) / scale.w) * 100
  const r = (xOf(scale, range.t1) / scale.w) * 100
  const edge: CSSProperties = { position: 'absolute', top: 0, bottom: 0, width: 1, background: color, opacity: 0.75 }
  return (
    <div style={SEL_LAYER}>
      <div
        style={{ position: 'absolute', left: `${l}%`, width: `${Math.max(0, r - l)}%`, top: 0, bottom: 0, background: color, opacity: 0.14 }}
      />
      <div style={{ ...edge, left: `${l}%` }} />
      <div style={{ ...edge, left: `${r}%` }} />
      <div style={{ ...TICK, left: `${l}%`, color, transform: 'translateX(2px)' }}>{formatTime(range.t0)}</div>
      <div style={{ ...TICK, left: `${r}%`, color, transform: 'translateX(calc(-100% - 2px))' }}>
        {formatTime(range.t1)}
      </div>
    </div>
  )
}

const LEGEND_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2px 10px',
  fontSize: 11,
  // NO CLAMP SINCE JOS-289. It was `maxHeight: 40` + `overflowY: auto` — two rows visible, the
  // rest scrolled — on the reasoning that a wrapped legend must not push the chart column around
  // as the visible zone mix changes. Pushing the column around is now free (the page scrolls), and
  // a legend is an INDEX of what was drawn: half of it hidden behind a 40px scroller made it a
  // worse answer than the hover it exists to be independent of. It wraps as far as it needs.
  opacity: 0.85
}
const SWATCH: CSSProperties = { width: 9, height: 9, borderRadius: 2, flexShrink: 0 }
const LEGEND_ITEM: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }

/**
 * The zones on screen, by dwell. This is the identification path that does NOT depend on
 * hover, so it survives whatever the tooltip does. Plain HTML with inherited type: this
 * file stays MUI-free, and the strip reads as a caption under the plot it belongs to.
 */
export function ZoneLegendStrip({
  legend,
  fmtDuration
}: {
  legend: ZoneLegend
  /** the view's duration formatter, injected so there is no second one in this feature. */
  fmtDuration: (ms: number) => string
}): JSX.Element | null {
  if (legend.rows.length === 0) return null
  return (
    <div style={LEGEND_STYLE} data-testid="leveling-zone-legend">
      {legend.rows.map((row) => (
        <span key={row.key} style={LEGEND_ITEM} data-testid="leveling-zone-legend-row">
          <span style={{ ...SWATCH, background: row.color }} />
          <span>{row.name}</span>
          <span style={{ opacity: 0.6 }}>{fmtDuration(row.ms)}</span>
        </span>
      ))}
      {legend.more > 0 && <span style={{ opacity: 0.6 }}>+{legend.more} more</span>}
    </div>
  )
}

/**
 * Simple filled area chart of a cumulative series over time.
 *
 * `points` is the WINDOWED series (chartWindow.ts `visibleFrom`): everything inside the chosen
 * timescale plus the anchor gain that preceded it. One point is enough to draw — the trailing
 * plateau below carries it across the window — because at a narrow scale "no gains in this hour"
 * is a real answer and an unmounting chart would be a worse one. Nothing at all still draws
 * nothing.
 *
 * THE FLOOR IS THE TOTAL BEFORE THE WINDOW OPENED, so a zoomed view shows the gains it contains
 * instead of a flat line pinned to the top of a 3,000-point cumulative. At full history that
 * value is 0 — the anchor IS the first gain line, so subtracting its own `gain` lands on zero —
 * which is why the full-history picture is unchanged to the pixel.
 */
export function AreaChart({
  points,
  color,
  chrome
}: {
  points: AaPoint[]
  color: string
  chrome: ChartChrome
}): JSX.Element | null {
  if (points.length === 0) return null
  const pad = PAD_X
  // The X mapping is the SHARED scale, so the hover layer below reads the cursor back
  // through the same domain the level chart plots and neither can drift from the other.
  const scale = chrome.scale
  const padTop = pad + BAND_PAD
  const first = points[0]
  const base = Math.max(0, first.y - (first.gain ?? first.y))
  const top = points[points.length - 1].y
  // THE DOMAIN IS THE DATA PLUS AIR (JOS-339, levelChartGeometry.paddedAxis). It used to be the
  // data exactly, so `top` mapped to `padTop` and the line was pinned flat against the top edge of
  // an otherwise empty box — which at a short window is the whole picture. `floor: 0` keeps a
  // cumulative total off negative ground, so full history still opens at zero.
  const axis = paddedAxis(base, top, { top: padTop, bottom: H - pad }, AA_PAD)
  const x = (t: number): number => xOf(scale, t)
  const y = (v: number): number => yOf(axis, v)
  const line = points.map((p) => `${x(p.ts).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')
  // Hold the curve flat to the end of the shared domain. Cumulative AA is a STEP function
  // between gain lines (that is what `cumulativeAt` reads), so the plateau is what the
  // series actually says — and it is the same trailing-plateau rule the level chart uses.
  const tail = `${x(scale.t1).toFixed(1)},${y(points[points.length - 1].y).toFixed(1)}`
  const floor = axis.bottom
  const area = `${x(points[0].ts).toFixed(1)},${floor} ${line} ${tail} ${x(scale.t1).toFixed(1)},${floor}`
  return (
    <div style={WRAP_STYLE} data-testid="leveling-aa-chart" {...chrome.pointer}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <ZoneBandStrip bands={chrome.bands} scale={scale} />
        <polygon points={area} fill={color} opacity={0.18} />
        <polyline points={`${line} ${tail}`} fill="none" stroke={color} strokeWidth={2} vectorEffect={CRISP} />
      </svg>
      {/* Drawn exactly when the floor is NOT zero, which is exactly when it needs stating: a
          windowed view whose baseline is the total you already had. Marked at the values' OWN
          heights now that the domain has air around them — the labels are the axis, not corners. */}
      <AxisLabels
        color={color}
        marks={base > 0 ? [{ text: top.toLocaleString(), y: y(top) }, { text: base.toLocaleString(), y: y(base) }] : []}
      />
      <SelectionBand scale={scale} committed={chrome.range} draft={chrome.draft} color={color} />
      <LevelHoverLayer
        scale={scale}
        height={H}
        color={color}
        aaPoints={points}
        bands={chrome.bands}
        suppressed={chrome.suppressed}
      />
    </div>
  )
}

/** The hue this feature uses for "the log cannot see here" — the swap rule since the chart
 *  existed, and since JOS-292 every uncertainty band too. One meaning, one colour, no new hue. */
export const SWAP_COLOR = '#8fa3b8'

const PAD_TOP = 14 + BAND_PAD
/**
 * 8 UNTIL JOS-339. The level axis now bottoms out on a whole level the curve genuinely reaches
 * (`levelAxis`), so a window that opens exactly on a ding draws its first vertex AT the floor —
 * six more units of inset is the "headroom below" half of the ticket, and it is also what keeps
 * the bottom axis label off the frame.
 */
const PAD_BOTTOM = 14

/**
 * The spans the curve refuses to draw (levelCurve.ts's four refusals), as bands over the plot.
 *
 * A BAND, NOT A DASHED LINE. "Make the span visibly uncertain" and "never interpolate through
 * it" are one instruction: a dashed stroke between the last stated value and the next one still
 * puts a bar position under every pixel of itself. A band claims nothing on the value axis — it
 * says where the evidence stops and where it resumes, which is the whole of what is known.
 * `data-kind` carries the reason, so the readout and the e2e read the same word the geometry did.
 */
function CurveGaps({ curve, scale }: { curve: LevelCurve; scale: ChartScale }): JSX.Element | null {
  const floor = H - PAD_BOTTOM
  const top = PAD_TOP - 6
  const rects = curve.gaps
    .map((g) => {
      const r = gapRect(g, scale)
      return r ? { kind: g.kind, t0: g.t0, x: r.x, w: r.w } : null
    })
    .filter((r): r is { kind: CurveRefusal; t0: number; x: number; w: number } => r !== null)
  if (rects.length === 0) return null
  return (
    <g data-testid="leveling-curve-gaps">
      {rects.map((r, i) => (
        <g key={`${r.kind}-${r.t0}-${i}`}>
          <rect
            data-testid="leveling-curve-gap"
            data-kind={r.kind}
            x={r.x}
            y={top}
            width={r.w}
            height={floor - top}
            fill={SWAP_COLOR}
            opacity={0.1}
          />
          <line
            x1={r.x}
            y1={floor}
            x2={r.x + r.w}
            y2={floor}
            stroke={SWAP_COLOR}
            strokeWidth={1.5}
            strokeDasharray="3 4"
            opacity={0.85}
            vectorEffect={CRISP}
          />
        </g>
      ))}
    </g>
  )
}

/**
 * Level over time — the FRACTIONAL curve, with the dings kept as markers (JOS-292).
 *
 * What it draws and why each piece is honest (levelCurve.ts carries the full argument):
 *   • the CURVE is `last ding + Σ stated percent since it`, drawn step-after. It moves at an
 *     exp line and holds between them, because that is the only thing the log states — a
 *     diagonal between two kills would claim a bar position nothing reported. At the density
 *     the log carries (thousands of lines over 720 user units) those steps are sub-pixel, which
 *     is why the honest shape and the readable one are the same shape.
 *   • the DINGS are markers on it. They were the whole picture before this ticket; they are now
 *     the anchors the curve is measured from, and they stay visible as themselves.
 *   • an UNCERTAIN span is a band and a gap in the stroke, never a dashed interpolation.
 *   • a LOADOUT SWAP is the discontinuity it is: no stroke crosses it, no percentage accumulates
 *     through it, and the dashed rule + hollow marker at the new run's first ding are unchanged.
 *     The swap has no log line at all, so nothing can date it and everything between the last
 *     ding of one loadout and the first of the next is refused.
 * Cheap inline SVG (these surfaces are render-bound; no chart libs).
 */
export function LevelStepChart({
  segments,
  curve,
  color,
  aaPoints,
  chrome
}: {
  segments: LevelSegment[]
  /** The drawn curve — already windowed and down-sampled by the view (levelCurve.ts). */
  curve: LevelCurve
  color: string
  /** Cumulative AA series — context only ("AA gained by then"), never drawn here. */
  aaPoints: AaPoint[]
  chrome: ChartChrome
}): JSX.Element | null {
  // `segments` is the WINDOWED run list (chartWindow.ts `visibleSegments`). One ding is enough
  // to draw: the anchor plus the trailing plateau is the honest picture of "you held this level
  // the whole hour", and a chart that unmounted at a narrow timescale would answer a question
  // with a blank. Nothing at all still draws nothing.
  const all = segments.flatMap((s) => s.points)
  if (all.length === 0) return null
  const scale = chrome.scale
  const hi = all.reduce((m, p) => Math.max(m, p.level), all[0].level)
  const lo = all.reduce((m, p) => Math.min(m, p.level), all[0].level)
  // THE AXIS IS THE BAR (JOS-339, levelChartGeometry.levelAxis): the whole level the curve sits in,
  // and the one it is filling toward. It used to open at `lo - 1` — a whole level of dead space
  // under a curve that never goes there — and ceil up from the top, so a twelve-minute window
  // inside one level got the middle fifth of the plot and read as a hairline. The two integers the
  // chart prints are unchanged; the bottom one is now where it says it is instead of a level high.
  // An empty curve keeps its own extent out of it: `loY`/`hiY` are 0 there, not "level zero".
  const drawn = curve.runs.length > 0 || curve.dings.length > 0
  const axis = levelAxis(drawn ? Math.min(lo, curve.loY) : lo, drawn ? Math.max(hi, curve.hiY) : hi, {
    top: PAD_TOP,
    bottom: H - PAD_BOTTOM
  })
  const y = (v: number): number => yOf(axis, v)
  const floor = axis.bottom

  return (
    <div style={WRAP_STYLE} data-testid="leveling-level-chart" {...chrome.pointer}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <ZoneBandStrip bands={chrome.bands} scale={scale} />
        <CurveGaps curve={curve} scale={scale} />
        <g data-testid="leveling-level-curve">
          {curve.runs.map((run, i) => (
            <g key={`r${i}`}>
              <polygon points={runArea(run, scale, y, floor)} fill={color} opacity={0.12} />
              <polyline
                data-testid="leveling-curve-run"
                points={runPolyline(run, scale, y)}
                fill="none"
                stroke={color}
                strokeWidth={2}
                vectorEffect={CRISP}
              />
            </g>
          ))}
        </g>
        {curve.dings.map((d, i) => (
          <g key={`d${i}`}>
            {/* A swap's first ding is NOT a level gained — it is where the bar restarted at a
                level the log re-reported. It keeps the hollow marker and the dashed rule; a
                filled dot beside the others would read as one more step up the same ladder. */}
            {d.afterSwap ? (
              <>
                <line
                  x1={xOf(scale, d.ts)}
                  y1={PAD_TOP - 6}
                  x2={xOf(scale, d.ts)}
                  y2={floor}
                  stroke={SWAP_COLOR}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  opacity={0.9}
                  vectorEffect={CRISP}
                />
                <circle
                  data-testid="leveling-level-swap"
                  cx={xOf(scale, d.ts)}
                  cy={y(d.level)}
                  r={3.5}
                  fill="none"
                  stroke={SWAP_COLOR}
                  strokeWidth={1.5}
                />
              </>
            ) : (
              <circle data-testid="leveling-level-ding" cx={xOf(scale, d.ts)} cy={y(d.level)} r={2.5} fill={color} />
            )}
          </g>
        ))}
      </svg>
      {/* BOTH ENDS, ALWAYS, since JOS-339. The old pair was `top` and — only when they differed —
          `lo`, because with a `lo - 1` baseline a plateau window would have printed the same number
          at both ends and claimed a range that wasn't one. The axis is now the level's own bar, so
          the two bounds always differ by construction and both of them mean something: the level
          you are in, and the one you are filling toward. Same integers, honest positions, and out
          of the stretched SVG so they read as numbers rather than smears. */}
      <AxisLabels color={color} marks={[{ text: String(axis.hi), y: y(axis.hi) }, { text: String(axis.lo), y: y(axis.lo) }]} />
      <SelectionBand scale={scale} committed={chrome.range} draft={chrome.draft} color={color} />
      <LevelHoverLayer
        scale={scale}
        height={H}
        color={color}
        aaPoints={aaPoints}
        bands={chrome.bands}
        segments={segments}
        curve={curve}
        suppressed={chrome.suppressed}
      />
    </div>
  )
}
