// ItemProjection.tsx — the item page's "what does this read at +N" control.
//
// Whole tiers only: the merge exp inside a tier is in no file this app can read, so the item page
// projects the tiers a player actually owns. The Gear tab's global slider is where fractions live.

import { type JSX, useMemo, useState } from 'react'
import { Box, Button, Slider, Stack, Typography } from '@mui/material'
import { ITEM_MAX_TIER, type ItemStatBlock } from '@shared/itemStats'
import { percentLabel, upgradeStateForTier } from '@shared/itemUpgrade'
import { blockScalesWithUpgrade, defaultProjectionTier, projectionCaption } from '@shared/itemProjection'

const MONO = '"Consolas","Courier New",monospace'

const TIER_MARKS = Array.from({ length: ITEM_MAX_TIER + 1 }, (_, i) => ({ value: i }))

/** `+7 (+70%)` — the tier and the percent the item window's own slider prints. */
function tierText(tier: number): string {
  return `+${String(tier)} (${percentLabel(upgradeStateForTier(tier))})`
}

export interface ItemProjectionState {
  /** whether the control is drawn at all: the caller allowed it AND some value moves */
  offered: boolean
  /** the tier the rows are drawn at; 0 whenever the control is not offered */
  tier: number
  /** the item's own tier (name suffix, else observed merge, else 0): the start, and reset's target */
  home: number
  onChange: (tier: number) => void
}

/**
 * Projection state for ONE item window. The pick remembers which item it was made on, so a dialog
 * that moves to another item starts that one at its own tier instead of inheriting the last pick.
 */
export function useItemProjection({
  name,
  observedTier,
  block,
  allowed
}: {
  name: string
  observedTier: number | undefined
  block: ItemStatBlock | undefined
  allowed: boolean
}): ItemProjectionState {
  const offered = useMemo(() => allowed && blockScalesWithUpgrade(block), [allowed, block])
  const home = defaultProjectionTier(name, observedTier)
  const [pick, setPick] = useState<{ name: string; tier: number } | null>(null)
  const tier = offered ? (pick?.name === name ? pick.tier : home) : 0
  return {
    offered,
    tier,
    home,
    onChange: (t) => {
      setPick({ name, tier: t })
    }
  }
}

export interface ItemProjectionProps extends Omit<ItemProjectionState, 'offered'> {
  colors: { label: string; value: string; meter: string }
}

export function ItemProjection({ tier, home, onChange, colors }: ItemProjectionProps): JSX.Element {
  const caption = projectionCaption(tier, home)
  return (
    <Box data-testid="item-projection" sx={{ mt: 0.75 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography sx={{ color: colors.label, fontSize: 11, fontFamily: MONO }}>Project upgrade</Typography>
        <Typography data-testid="item-projection-label" sx={{ color: colors.value, fontSize: 12, fontFamily: MONO }}>
          {tierText(tier)}
        </Typography>
      </Stack>
      <Box sx={{ px: 1 }}>
        <Slider
          size="small"
          min={0}
          max={ITEM_MAX_TIER}
          step={1}
          marks={TIER_MARKS}
          value={tier}
          data-testid="item-projection-slider"
          aria-label="Project this item's stats at upgrade level"
          getAriaValueText={tierText}
          onChange={(_e, v) => {
            onChange(typeof v === 'number' ? v : v[0])
          }}
          sx={{ color: colors.meter, py: 1 }}
        />
      </Box>
      {caption !== undefined && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography data-testid="item-projection-caption" sx={{ color: colors.label, fontSize: 11, fontFamily: MONO }}>
            {caption}
          </Typography>
          {tier !== home && (
            <Button
              size="small"
              data-testid="item-projection-reset"
              onClick={() => {
                onChange(home)
              }}
              sx={{ minWidth: 0, p: 0, fontSize: 11, fontFamily: MONO, textTransform: 'none', flexShrink: 0 }}
            >
              reset to +{home}
            </Button>
          )}
        </Stack>
      )}
    </Box>
  )
}
