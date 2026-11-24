// RebirthMarker — where a new life began on the level chart (shared/reincarnation.ts).
//
// Not a swap marker: a reincarnation keeps the classes and restarts the level, so it gets its own
// hue and its own word. A confirmed one is a solid rule; a possible (inferred) one is dashed, the
// same "the log did not say this" grammar the swap rule speaks.

import type { JSX } from 'react'
import { PALETTE } from '../../../../shared/palette'
import { rebirthLabel, type RebirthMark } from './levelSeries'

/** The reincarnation hue — the feed row and the chart rule share it. */
export const REBIRTH_COLOR = PALETTE.amber

export function RebirthMarker(p: { x: number; top: number; floor: number; cy: number; mark: RebirthMark }): JSX.Element {
  const label = rebirthLabel(p.mark)
  return (
    <g data-testid="leveling-level-rebirth" data-inferred={p.mark.inferred ? 'true' : 'false'}>
      <title>{label}</title>
      <line
        x1={p.x}
        y1={p.top}
        x2={p.x}
        y2={p.floor}
        stroke={REBIRTH_COLOR}
        strokeWidth={1.25}
        strokeDasharray={p.mark.inferred ? '3 4' : undefined}
        opacity={0.9}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={p.x} cy={p.cy} r={3.5} fill={p.mark.inferred ? 'none' : REBIRTH_COLOR} stroke={REBIRTH_COLOR} strokeWidth={1.5} />
      <text x={p.x + 4} y={p.top + 9} fill={REBIRTH_COLOR} fontSize={10}>
        {p.mark.life != null ? `life ${String(p.mark.life)}` : 'reborn'}
      </text>
    </g>
  )
}
