// THE COMBAT TAB'S RESIZABLE FRAME (a player's ask: "resize the different windows - dps over time,
// procs, damage by mob, combat log"). Two layout components and the Reset button; the panels
// themselves arrive as ELEMENT PROPS, so a drag re-renders the frame and never the meter tree
// beneath it (React skips an element whose identity did not change).
//
//   DashSplit     - the 2x2 dashboard as two columns: a width split between them, and a height
//                   split inside each (meter over procs, DPS curve over damage by mob). Below md it
//                   is the single scrolling column it always was: the column wrappers become
//                   `display: contents`, the cells keep the old reading order, the handles hide.
//   BodyLogFrame  - the dashboard (or timeline) over the combat log, split by the log's height.
//
// Every track is `minmax(0, …)`, the load-bearing rule the 2x2 grid already lived by: no panel's
// content may size its own box. The minimum a panel keeps is enforced on the VALUE (combatLayout's
// effective* helpers, against the measured box), never by a CSS min-size that could overflow.

import { useRef, type ReactNode } from 'react'
import { Box, Button } from '@mui/material'
import {
  HANDLE_PX,
  PANEL_MIN_H,
  PANEL_MIN_W,
  effectiveFraction,
  effectiveLog,
  fractionBounds,
  logBounds,
  type SplitKey
} from './combatLayout'
import { Splitter, useBoxSize } from './Splitter'
import { useCombatLayout, type CombatLayoutApi } from './useCombatLayout'

/** fr weights that sum to 100, never to 1 - grid tracks whose flex factors sum BELOW 1 leave the
 *  remainder empty, and float error on `f` + `1 - f` could land there. */
function tracks(f: number): string {
  return `minmax(0, ${String(f * 100)}fr) ${String(HANDLE_PX)}px minmax(0, ${String((1 - f) * 100)}fr)`
}

/** The handle's wiring for one fraction split in a track of `trackPx`. */
function fractionHandle(api: CombatLayoutApi, k: SplitKey, value: number, track: { px: number; min: number }) {
  const trackPx = track.px
  return {
    value,
    bounds: fractionBounds(trackPx, track.min),
    perPx: trackPx > 0 ? 1 / trackPx : 0,
    onPreview: (v: number) => {
      api.preview(k, v)
    },
    onCommit: (v: number) => {
      api.commit(k, v)
    },
    onReset: () => {
      api.reset(k)
    },
    unit: 'percent' as const,
    wideOnly: true
  }
}

/** One cell. `order` is the narrow layout's reading order (meter, DPS, procs, mobs - the order the
 *  single column has always stacked in), and means nothing at md where cells sit in columns. */
function Cell({ order, name, children }: { order: number; name: string; children: ReactNode }): React.JSX.Element {
  return <Box data-testid={`dash-cell-${name}`} sx={{ minWidth: 0, minHeight: 0, order: { xs: order, md: 0 } }}>{children}</Box>
}

function Column({
  frac,
  handle,
  top,
  bottom
}: {
  frac: number
  handle: ReactNode
  top: ReactNode
  bottom: ReactNode
}): React.JSX.Element {
  return (
    <Box
      sx={{
        display: { xs: 'contents', md: 'grid' },
        gridTemplateRows: { md: tracks(frac) },
        minWidth: 0,
        minHeight: 0
      }}
    >
      {top}
      {handle}
      {bottom}
    </Box>
  )
}

export function DashSplit({
  meter,
  dps,
  procs,
  mobs
}: {
  meter: ReactNode
  dps: ReactNode
  procs: ReactNode
  mobs: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const box = useBoxSize(ref)
  const api = useCombatLayout()
  const trackW = box.w - HANDLE_PX
  const trackH = box.h - HANDLE_PX
  const col = effectiveFraction(api.layout.col, trackW, PANEL_MIN_W)
  const left = effectiveFraction(api.layout.left, trackH, PANEL_MIN_H)
  const right = effectiveFraction(api.layout.right, trackH, PANEL_MIN_H)
  return (
    <Box
      ref={ref}
      data-testid="combat-dashboard"
      sx={{
        display: 'grid',
        gap: { xs: 1.5, md: 0 },
        flexGrow: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: { xs: 'auto', md: 'hidden' },
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: tracks(col) },
        gridTemplateRows: { xs: 'none', md: 'minmax(0, 1fr)' },
        // xs rows are a DEFINITE height on purpose: `auto` would let the meter's row list size
        // the track (an append-only panel sizing its own box is the Task #56 bug), so each
        // stacked panel gets a comfortable fixed box and scrolls inside it.
        gridAutoRows: { xs: '320px', md: 'minmax(0, 1fr)' }
      }}
    >
      <Column
        frac={left}
        top={<Cell order={1} name="meter">{meter}</Cell>}
        handle={<Splitter axis="y" label="Resize the meter and procs panels" testId="split-left" {...fractionHandle(api, 'left', left, { px: trackH, min: PANEL_MIN_H })} />}
        bottom={<Cell order={3} name="procs">{procs}</Cell>}
      />
      <Splitter axis="x" label="Resize the dashboard columns" testId="split-col" {...fractionHandle(api, 'col', col, { px: trackW, min: PANEL_MIN_W })} />
      <Column
        frac={right}
        top={<Cell order={2} name="dps">{dps}</Cell>}
        handle={<Splitter axis="y" label="Resize the DPS over time and damage by mob panels" testId="split-right" {...fractionHandle(api, 'right', right, { px: trackH, min: PANEL_MIN_H })} />}
        bottom={<Cell order={4} name="mobs">{mobs}</Cell>}
      />
    </Box>
  )
}

/** The body (dashboard, timeline, or a quiet state) over the combat log. The log's handle sits on
 *  its TOP edge, so dragging it down makes the log shorter - hence the negative `perPx`. */
export function BodyLogFrame({ body, log }: { body: ReactNode; log: ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const box = useBoxSize(ref)
  const api = useCombatLayout()
  const h = effectiveLog(api.layout.log, box.h)
  return (
    <Box ref={ref} sx={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: '1 1 0', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{body}</Box>
      <Splitter
        axis="y"
        label="Resize the combat log"
        testId="split-log"
        value={h}
        bounds={logBounds(box.h)}
        perPx={-1}
        onPreview={(v) => {
          api.preview('log', v)
        }}
        onCommit={(v) => {
          api.commit('log', v)
        }}
        onReset={() => {
          api.reset('log')
        }}
        unit="px"
      />
      <Box data-testid="combat-log-frame" sx={{ flex: `0 0 ${String(h)}px`, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {log}
      </Box>
    </Box>
  )
}

/** Every split back to its default. Drawn only while there is something to reset, so an untouched
 *  layout carries no extra control. */
export function ResetLayoutButton(): React.JSX.Element | null {
  const { isDefault, resetAll } = useCombatLayout()
  if (isDefault) return null
  return (
    <Button
      size="small"
      variant="text"
      onClick={resetAll}
      data-testid="combat-reset-layout"
      sx={{ py: 0, minWidth: 0, fontSize: 11, textTransform: 'none', whiteSpace: 'nowrap' }}
    >
      Reset layout
    </Button>
  )
}
