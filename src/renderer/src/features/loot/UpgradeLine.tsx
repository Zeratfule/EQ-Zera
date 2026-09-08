// UpgradeLine / UpgradeChip — the upgrade verdict, wherever an item is named (EQ Zera).
//
// TWO SHAPES, ONE SENTENCE. A dense table row can afford a chip ("+14 Chest"); an item page has
// room for the whole clause ("Upgrade for Chest under DPS: +14"). Both say the same thing, both
// name the CELL rather than the slot, and both are ABSENT rather than disabled when there is
// nothing to say - the app's standing rule for a per-row claim (PreviewButton.tsx argues it).
//
// NO TOOLTIP ON THE LINE. The tooltip diet: the sentence already names the profile, so a hover
// explaining it would be a footnote about our own arithmetic. The chip keeps a native `title`
// because it is an abbreviation of that same sentence and a chip is not a sentence.

import type { JSX } from 'react'
import { Chip, Typography } from '@mui/material'
import { planSlotLabel, type PlanSlotId } from '@shared/planner/types'
import { PROFILE_LABEL, type BuildProfile } from '../../../../shared/build/profiles'
import { useUpgradeFinder } from '../build/useUpgradeFinder'

function gain(delta: number): string {
  return `+${Math.round(delta).toLocaleString()}`
}

export interface UpgradeChipProps {
  cell: PlanSlotId
  delta: number
  profile: BuildProfile
}

/** The dense form: `+14 Chest`, success-coloured, with the profile in a native title. */
export function UpgradeChip({ cell, delta, profile }: UpgradeChipProps): JSX.Element {
  return (
    <Chip
      size="small"
      color="success"
      variant="outlined"
      label={`${gain(delta)} ${planSlotLabel(cell)}`}
      title={`Upgrade under ${PROFILE_LABEL[profile]}`}
      data-testid="zoneloot-upgrade"
      sx={{ height: 18, fontSize: 10, ml: 0.75 }}
    />
  )
}

/** The item page's form. Draws nothing at all when this item does not beat what you wear. */
export function UpgradeLine({ item }: { item: string }): JSX.Element | null {
  const { verdictFor, profile } = useUpgradeFinder()
  const verdict = verdictFor(item)
  if (verdict === null) return null
  const nothing = verdict.againstNothing ? ' (nothing worn there)' : ''
  return (
    <Typography variant="caption" data-testid="loot-upgrade" sx={{ color: 'success.main', flexShrink: 0 }}>
      {`Upgrade for ${planSlotLabel(verdict.cell)} under ${PROFILE_LABEL[profile]}: ${gain(verdict.delta)}${nothing}`}
    </Typography>
  )
}
