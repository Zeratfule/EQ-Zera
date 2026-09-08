// The DPS-over-time CARD, whole: header stats, the three curves, the marker ticks, the elapsed
// axis, the legend, and the hover layer that reads the drawing backwards.
//
// It lives in its own file because TWO surfaces render it now — the Combat dashboard's 2x2 grid
// and the Overview tab's glance row. The ONE-source rule (AGENTS.md) applies to the whole chart,
// not just its colors: a second copy would drift in exactly the places that matter least visibly
// (which marker kinds get a legend entry, whether the peak is `~`-prefixed, where the hover dot
// sits) and most honestly. So the card is extracted, not forked, and `DpsChartCard`
// (CombatDashboard.tsx) is now a thin wrapper over it with the same testid and the same layout.
//
// COMPACT is the only thing the two callers differ on — see the prop's comment for exactly what
// it drops. It never changes the CURVE: same geometry, same markers, same hover, same numbers.
//
// Everything here is cheap inline SVG (no chart libs) and every derivation is a single pass in
// `dashboardData.ts`/`dpsChart.ts`; the memos are keyed on the timeline's IDENTITY, which the
// Combat tab stabilises so a frozen finalized fight doesn't re-derive on every 1s snapshot tick.

import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import type { TimelineView } from '@shared/combat'
import { formatRate } from '../../lib/formatRate'
import type { ChartLineKey, DpsLineKey } from './combatPrefs'
import { ApproxChip, DashCard, QuietNote, fmtDur } from './combatShared'
import { approxNote, buildDpsSeries, type DpsSeries } from './dashboardData'
import {
  CHART_H,
  CHART_W,
  PAD_B,
  PAD_T,
  buildDpsChart,
  drawnMarkers,
  hasDrawnLine,
  placeMarkers,
  type DpsChart,
  type PlacedMarker
} from './dpsChart'
import { DpsCurveHoverLayer, type CurveHoverHandle } from './DpsCurveHoverLayer'
import { MARKER_COLOR, MARKER_WORD } from './markerStyle'
import { Tooltip } from '../../lib/Tooltip'
import { useHiddenChartLines } from './useCombatPrefs'
import { PALETTE } from '../../../../shared/palette'

const OUT_COLOR = PALETTE.accent
const PET_COLOR = PALETTE.cyan
/** Matches KIND_COLOR.member (combatShared.tsx) — the group-mate green. */
const GROUP_COLOR = '#7fbf8f'
const INC_COLOR = PALETTE.red

/** A frozen empty set, so the compact surface's memo dependencies never change identity. */
const NOTHING_HIDDEN: readonly ChartLineKey[] = []

/**
 * The card header's right slot: the inexact-ring chip (ONE chip for both event-ring losses —
 * downsample and/or drop-oldest truncation; the note carries the TRUE instant count, so an
 * overflowed ring can't advertise its own capacity) and the visible-window peak.
 *
 * The PEAK is the outgoing curve's peak, so it stands down with that curve (JOS-264): a card
 * quoting a number in the outgoing colour, for a line it is not drawing, against a y-max scaled
 * to something else would be three statements about three different things on one row.
 */
function ChartHeaderStats({
  tl,
  series,
  chart
}: {
  tl: TimelineView | null
  series: DpsSeries | null
  chart: DpsChart | null
}): React.JSX.Element | null {
  if (!tl || !series || !chart) return null
  const note = approxNote(tl)
  return (
    <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ minWidth: 0 }}>
      {note && <ApproxChip shown={note.shown} raw={note.of} truncated={note.truncated} />}
      {chart.outLine !== null && (
        <Tooltip title={`Peak ${Math.round(series.smoothMs / 1000)}s rolling outgoing rate in the visible window.`}>
          <Typography variant="caption" sx={{ color: OUT_COLOR, whiteSpace: 'nowrap' }}>
            {series.estimated ? '~' : ''}
            {formatRate(chart.peakVis)} peak
          </Typography>
        </Tooltip>
      )}
    </Stack>
  )
}

/**
 * The curves, in painting order: incoming, then the two components of the outgoing sum, then the
 * headline line on top of its own fill.
 *
 * ONE TABLE rather than four hand-written blocks, because each line now has to answer the same
 * question twice over — did this fight have one, and is the legend hiding it — and four copies of
 * that is four places for the answers to diverge. `dpsChart` has already folded both into a single
 * `string | null`, so all this does is draw what is there.
 *
 * The testids name the LINES by the legend's own keys (`dps-line-<key>`): whether a line is on the
 * plot is a user-visible choice now, and an e2e counting `polyline` elements would be counting the
 * marker ticks' pennants too.
 */
const LINE_STYLE: { key: DpsLineKey; color: string; width: number; opacity?: number }[] = [
  { key: 'inc', color: INC_COLOR, width: 1, opacity: 0.5 },
  { key: 'pet', color: PET_COLOR, width: 1.2, opacity: 0.85 },
  // The group's own contribution is drawn like the pet's, for the same reason: the headline curve
  // is the sum, and this says how much of it was somebody else's.
  { key: 'group', color: GROUP_COLOR, width: 1.2, opacity: 0.85 },
  { key: 'out', color: OUT_COLOR, width: 1.8 }
]

function CurveLines({ chart }: { chart: DpsChart }): React.JSX.Element {
  const points: Record<DpsLineKey, string | null> = {
    out: chart.outLine,
    pet: chart.petLine,
    group: chart.groupLine,
    inc: chart.incLine
  }
  return (
    <>
      {chart.outArea !== null && (
        <polygon points={chart.outArea} fill={OUT_COLOR} opacity={0.16} data-testid="dps-area" />
      )}
      {LINE_STYLE.map(({ key, color, width, opacity }) =>
        points[key] === null ? null : (
          <polyline
            key={key}
            points={points[key]}
            fill="none"
            stroke={color}
            strokeWidth={width}
            opacity={opacity}
            vectorEffect="non-scaling-stroke"
            data-testid={`dps-line-${key}`}
          />
        )
      )}
    </>
  )
}

/** The curves + the marker ticks + the y-max readout, in one SVG, under a hover layer. */
function DpsCurve({
  chart,
  series,
  markers,
  startTs,
  a,
  hidden
}: {
  chart: DpsChart
  series: DpsSeries
  /** already narrowed to the ticks this chart draws (`drawnMarkers`). */
  markers: readonly PlacedMarker[]
  startTs: number
  a: string
  hidden: readonly ChartLineKey[]
}): React.JSX.Element {
  const hoverRef = useRef<CurveHoverHandle>(null)
  // HOVER / DRAG SEAM (§7.1): a bare pointermove only. `buttons` is non-zero throughout a drag,
  // so bailing on it keeps the readout out of the way of any future drag interaction here — and
  // of a text selection dragged across the card — with no shared "isDragging" state.
  const onHoverMove = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.buttons !== 0) {
      hoverRef.current?.clear()
      return
    }
    const r = ev.currentTarget.getBoundingClientRect()
    hoverRef.current?.move(ev.clientX - r.left, ev.clientY - r.top, r.width)
  }, [])
  const onHoverLeave = useCallback(() => hoverRef.current?.clear(), [])

  return (
    // flexShrink 0 on every strip: in a short grid cell the card body scrolls, it never
    // squashes the curve into an unreadable sliver.
    <Box sx={{ position: 'relative', flexShrink: 0 }} onPointerMove={onHoverMove} onPointerLeave={onHoverLeave}>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        width="100%"
        height={CHART_H}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
        data-testid="dps-plot"
      >
        <CurveLines chart={chart} />
        {/* Markers LAST so a tick is never buried under the area fill. */}
        <MarkerTicks markers={markers} />
      </svg>
      <Typography
        variant="caption"
        sx={{ position: 'absolute', top: 0, left: 2, color: 'text.disabled', pointerEvents: 'none' }}
      >
        {a}
        {formatRate(chart.yMax)}
      </Typography>
      <DpsCurveHoverLayer
        api={hoverRef}
        chart={chart}
        series={series}
        markers={markers}
        startTs={startTs}
        hidden={hidden}
      />
    </Box>
  )
}

/** The ticks carry NO native `<title>`: the hover layer describes them now, and two tooltips for
 *  one mark is worse than one (the native one also can't say what the rate was at that instant). */
function MarkerTicks({ markers }: { markers: readonly PlacedMarker[] }): React.JSX.Element {
  return (
    <>
      {markers.map(({ m, x }, i) => (
        <g key={`${m.kind}|${m.t}|${i}`} opacity={0.9} data-testid="dps-tick" data-kind={m.kind}>
          <line
            x1={x}
            x2={x}
            y1={PAD_T - 4}
            y2={CHART_H - PAD_B}
            stroke={MARKER_COLOR[m.kind]}
            strokeWidth={1}
            strokeDasharray={m.kind === 'slow' ? undefined : '2 2'}
            vectorEffect="non-scaling-stroke"
          />
          {/* The slow tick is the outcome the tab exists to show, so it also flies a
              flag — solid line + pennant, unmistakable against the dashed settings. */}
          {m.kind === 'slow' && (
            <polygon
              points={`${x.toFixed(1)},${PAD_T - 4} ${(x + 7).toFixed(1)},${PAD_T - 1} ${x.toFixed(1)},${PAD_T + 2}`}
              fill={MARKER_COLOR.slow}
            />
          )}
        </g>
      ))}
    </>
  )
}

/** The four evenly-spaced elapsed labels under the curve — read off the chart's ONE time base
 *  (dpsChart.ts), so they step by whole buckets with the curve instead of re-quoting a wall-clock
 *  right edge that ticked at its own rate. */
function ChartAxis({ chart }: { chart: DpsChart }): React.JSX.Element {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.25, flexShrink: 0 }}>
      {[0, 1, 2, 3].map((k) => (
        <Typography key={k} variant="caption" color="text.disabled">
          {fmtDur((chart.t0 + ((chart.t1 - chart.t0) * k) / 3) / 1000)}
        </Typography>
      ))}
    </Stack>
  )
}

/**
 * THE LEGEND IS THE CONTROL (JOS-264). Every entry is a toggle: click it and its line leaves the
 * plot; the entry STAYS, dimmed and hollow, which is both the record of what you put away and the
 * way to bring it back. Nothing is removed from this strip by hiding — a legend that deleted its
 * own entries would be a one-way door with no handle on the far side.
 *
 * The entries a fight HAS are unchanged: `hasPet`/`hasGroup`/`hasInc` and the marker kinds the
 * fight actually produced. So the strip's contents still describe the fight, and only its
 * appearance describes your choices.
 */
function ChartLegend({
  series,
  chart,
  markers,
  hidden,
  onToggle
}: {
  series: DpsSeries
  chart: DpsChart
  /** every PLACED marker, hidden kinds included — this strip is where a hidden kind comes back. */
  markers: readonly PlacedMarker[]
  hidden: readonly ChartLineKey[]
  onToggle: (k: ChartLineKey) => void
}): React.JSX.Element {
  const entry = (k: ChartLineKey, color: string, label: string): React.JSX.Element => (
    <Legend key={k} id={k} color={color} label={label} hidden={hidden.includes(k)} onToggle={() => { onToggle(k) }} />
  )
  return (
    <Stack
      direction="row"
      spacing={1.25}
      alignItems="center"
      sx={{ mt: 0.25, flexShrink: 0 }}
      flexWrap="wrap"
      useFlexGap
    >
      {/* The headline curve's label names exactly what it sums, so a grouped fight's line is
          never read as "yours". */}
      {entry('out', OUT_COLOR, series.hasGroup ? 'you + pet + group' : 'you + pet')}
      {series.hasPet && entry('pet', PET_COLOR, 'pet')}
      {series.hasGroup && entry('group', GROUP_COLOR, 'group')}
      {series.hasInc && entry('inc', INC_COLOR, 'incoming')}
      {/* One legend entry per marker KIND actually present — an always-on legend for four
          kinds would spend the strip explaining ticks the fight never had. */}
      {(['slow', 'coat', 'stance', 'invocation'] as const)
        .filter((k) => markers.some(({ m }) => m.kind === k))
        .map((k) => entry(k, MARKER_COLOR[k], MARKER_WORD[k]))}
      <Box sx={{ flexGrow: 1 }} />
      <Typography variant="caption" color="text.disabled" noWrap>
        {Math.round(series.smoothMs / 1000)}s rolling
        {chart.scrolling ? ' · last 2:00' : ''}
      </Typography>
    </Stack>
  )
}

/**
 * One legend entry, as a button. HIDDEN says so THREE ways, because the report this came from was
 * a chart read across a room on a 75-inch TV and one subtle cue at that distance is no cue: the
 * whole entry dims, the swatch goes hollow (an outline where a solid bar was), and the label is
 * struck through — the same treatment every charting library's hidden series wears, so it needs
 * no teaching. A dim-only entry reads as a rendering accident rather than as a state.
 */
function Legend({
  id,
  color,
  label,
  hidden,
  onToggle
}: {
  /** the stored key, which is also the testid — the LABEL is copy and changes with the fight
   *  (`you + pet` gains `+ group`), so a testid built from it would name a moving target. */
  id: ChartLineKey
  color: string
  label: string
  hidden: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    // One clause naming the ACTION, which is what a tooltip is for here: the click target looks
    // like a caption, and nothing else on the strip says it can be pressed. The subject is the
    // entry the tooltip is anchored to, and its label is already the button's accessible name —
    // repeating it here would just be the caption twice.
    <Tooltip title={hidden ? 'Show this line' : 'Hide this line'}>
      <ButtonBase
        onClick={onToggle}
        disableRipple
        aria-pressed={!hidden}
        data-testid={`chart-legend-${id}`}
        data-hidden={hidden ? '1' : '0'}
        sx={{ borderRadius: 1, px: 0.25, opacity: hidden ? 0.55 : 1 }}
      >
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Box
            sx={{
              width: 10,
              height: 3,
              borderRadius: 1,
              bgcolor: hidden ? 'transparent' : color,
              border: hidden ? `1px solid ${color}` : undefined,
              boxSizing: 'border-box'
            }}
          />
          <Typography
            variant="caption"
            color={hidden ? 'text.disabled' : 'text.secondary'}
            sx={{ textDecoration: hidden ? 'line-through' : undefined }}
          >
            {label}
          </Typography>
        </Stack>
      </ButtonBase>
    </Tooltip>
  )
}

export interface DpsOverTimeProps {
  tl: TimelineView | null
  /** a GENUINELY live selection — only then does the visible window follow `now`. */
  live: boolean
  /** What to say when there is no per-event ring at all. The caller owns this sentence because
   *  the two surfaces have different reasons to be empty: Combat knows WHY the ring is missing
   *  (zone session / evicted fight), Overview only knows there are no fights yet. */
  noRing: ReactNode
  /**
   * GLANCE mode. Drops the LEGEND strip and nothing else — the curve, its markers, the y-max
   * readout, the header stats and the whole hover layer are identical. The elapsed axis stays:
   * without it the chart would have no time scale at all, and an unlabelled x is the one thing a
   * DPS curve can't be honest without. The legend is affordable to lose because the hover names
   * every marker it would have explained, and the glance surface links to the full card.
   *
   * IT ALSO DROPS THE HIDING (JOS-264), because the legend is the only way to undo it: a compact
   * card obeying a hidden set would be a surface missing a line with no control on it to say so,
   * let alone bring it back. The glance card draws the whole fight; the tab where you switched a
   * line off is the tab that shows it off.
   */
  compact?: boolean
  title?: string
  testId?: string
  /** Grid-cell mode (see DashCard): 100% of the cell, body scrolls internally. */
  fill?: boolean
}

/**
 * Smoothed damage rate over encounter time. For the LIVE fight the window follows `now`
 * (the last 2 minutes) and advances on the view's existing snapshot cadence — there is no
 * timer here. For a finalized fight the whole encounter is drawn statically.
 */
export function DpsOverTime({
  tl,
  live,
  noRing,
  compact,
  title = 'DPS over time',
  testId,
  fill
}: DpsOverTimeProps): React.JSX.Element {
  const [stored, toggle] = useHiddenChartLines()
  // The glance card has no legend, so it obeys no hidden set — see `compact`. NOTHING is a stable
  // identity, so the memo chain below is unaffected on that surface.
  const hidden = compact ? NOTHING_HIDDEN : stored
  const series = useMemo(() => (tl ? buildDpsSeries(tl, live) : null), [tl, live])
  const chart = useMemo(() => buildDpsChart(series, live, hidden), [series, live, hidden])
  const placed = useMemo(() => placeMarkers(tl, chart), [tl, chart])
  const drawn = useMemo(() => drawnMarkers(placed, hidden), [placed, hidden])
  const a = series?.estimated ? '~' : ''

  return (
    <DashCard title={title} right={<ChartHeaderStats tl={tl} series={series} chart={chart} />} fill={fill} testId={testId}>
      {!tl ? (
        <QuietNote>{noRing}</QuietNote>
      ) : !chart || !series ? (
        <QuietNote>No damage recorded yet - the curve starts with the first hit.</QuietNote>
      ) : (
        <>
          {hasDrawnLine(chart) ? (
            <>
              <DpsCurve chart={chart} series={series} markers={drawn} startTs={tl.startTs} a={a} hidden={hidden} />
              <ChartAxis chart={chart} />
            </>
          ) : (
            // Every line switched off is a legal state, not a broken chart: say so, and leave the
            // legend below to say which ones and to switch one back on. The axis goes with the
            // plot - an elapsed scale under nothing measures nothing.
            <QuietNote>Every line is hidden - pick one in the legend to draw it again.</QuietNote>
          )}
          {!compact && (
            <ChartLegend series={series} chart={chart} markers={placed} hidden={hidden} onToggle={toggle} />
          )}
        </>
      )}
    </DashCard>
  )
}
