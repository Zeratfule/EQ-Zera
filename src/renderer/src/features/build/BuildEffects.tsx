// build/BuildEffects.tsx — how much of a Build-tab number came from an item's EFFECTS (procs, focus,
// worn), next to the number it is part of (owner, 2026-11-23: "we should account for endurance and
// procs both"). The arithmetic and the words are shared/build/effectScore.ts; this file only draws.
//
// Every figure here is an ESTIMATE (a modelled proc rate, a reference mana pool), so each one carries
// a `~` from `effectPartText` itself. An effect the scoring could not put a number on is named as not
// scored, in the hover, so a proc that only slows is never mistaken for one we forgot.

import type { JSX } from 'react'
import { Tooltip, Typography } from '@mui/material'
import type { GearRow } from '@shared/planner/gear'
import type { BuildWeights } from '../../../../shared/build/profiles'
import { effectPartText, effectReading, rowScore, type EffectReading, type FocusCover } from '../../../../shared/build/effectScore'
import { FONTS } from '../../../../shared/palette'

const SCORE_SX = { fontFamily: FONTS.mono, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const

function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}

/** The breakdown's lines: what each scored effect added, then what was not scored. */
export function effectLines(reading: EffectReading): string[] {
  return [...reading.parts.map(effectPartText), ...reading.unscored.map((u) => `${u} - not scored`)]
}

interface EffectProps {
  row: GearRow
  weights: BuildWeights
  /** the focus the rest of the set holds - a focus adds only what it holds above it */
  cover: FocusCover
}

/** A set row's score. Effects ride in it; when they do, the number reads `~` and the hover says how much. */
export function BuildRowScore({ row, weights, cover }: EffectProps): JSX.Element {
  const reading = effectReading(row, weights, cover)
  const total = rowScore(row, weights, cover)
  const lines = effectLines(reading)
  const text = (
    <Typography variant="caption" sx={{ ...SCORE_SX, color: 'text.secondary' }} data-testid="build-row-score">
      {reading.parts.length > 0 ? '~' : ''}
      {fmt(total)}
    </Typography>
  )
  if (lines.length === 0) return text
  return <Tooltip title={lines.join('\n')} slotProps={{ tooltip: { sx: { whiteSpace: 'pre-line' } } }}>{text}</Tooltip>
}

/** An upgrade option's effect share, as one quiet line under its source. Nothing when it has none. */
export function BuildEffectNote({ row, weights, cover }: EffectProps): JSX.Element | null {
  const reading = effectReading(row, weights, cover)
  if (reading.parts.length === 0) return null
  const lines = effectLines(reading)
  return (
    <Typography variant="caption" color="text.secondary" noWrap title={lines.join('\n')} sx={{ display: 'block' }} data-testid="build-effect-note">
      {reading.parts.map(effectPartText).join(' · ')}
    </Typography>
  )
}
