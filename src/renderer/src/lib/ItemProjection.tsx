// ItemProjection.tsx — the item page's "what does this read at +N" window and control.
//
// Whole tiers only: the merge exp inside a tier is in no file this app can read, so the item page
// projects the tiers a player actually owns. The Gear tab's global slider is where fractions live.
//
// Kept out of ItemWindow.tsx on purpose: the overlay bundle lazy-loads ItemWindow for its compact
// hover cards and must not pull MUI Slider/Button in with it. Main window only (it subscribes to
// the itemTiers module through ObservedItemWindow's hook).

import { type JSX, useMemo, useState } from 'react'
import { Box, Button, Slider, Stack, Typography } from '@mui/material'
import { ITEM_MAX_TIER, parseStatsBlock } from '@shared/itemStats'
import { percentLabel, upgradeStateForTier } from '@shared/itemUpgrade'
import { defaultProjectionTier, offersProjection, projectionCaption } from '@shared/itemProjection'
import { EQ_ITEM_COLORS, ItemWindow, type ItemWindowProps } from './ItemWindow'
import { observedTierOf, useItemTiers } from './ObservedItemWindow'

const MONO = '"Consolas","Courier New",monospace'

const TIER_MARKS = Array.from({ length: ITEM_MAX_TIER + 1 }, (_, i) => ({ value: i }))

/** `+7 (+70%)` — the tier and the percent the item window's own slider prints. */
function tierText(tier: number): string {
  return `+${String(tier)} (${percentLabel(upgradeStateForTier(tier))})`
}

interface ItemProjectionProps {
  tier: number
  /** the item's own tier (name suffix, else observed merge, else 0): the start, and reset's target */
  home: number
  onChange: (tier: number) => void
}

function ItemProjection({ tier, home, onChange }: ItemProjectionProps): JSX.Element {
  const caption = projectionCaption(tier, home)
  const muted = { color: EQ_ITEM_COLORS.label, fontSize: 11, fontFamily: MONO }
  return (
    <Box data-testid="item-projection" sx={{ mt: 0.75 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography sx={muted}>Project upgrade</Typography>
        <Typography data-testid="item-projection-label" sx={{ ...muted, color: EQ_ITEM_COLORS.value, fontSize: 12 }}>
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
          sx={{ color: EQ_ITEM_COLORS.meter, py: 1 }}
        />
      </Box>
      {caption !== undefined && (
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography data-testid="item-projection-caption" sx={muted}>
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

/**
 * The full item window with the +N projection. The caller must hold the BASE (+0) block, and must
 * mount it with `key={name}`: the pick lives in this instance, so a new item or a reopened dialog
 * starts again at the item's own tier.
 */
export function ProjectableItemWindow(props: Omit<ItemWindowProps, 'compact' | 'projectedTier' | 'projectionSlot'>): JSX.Element {
  const { name, stats, rawStats } = props
  const tiers = useItemTiers()
  const observedTier = props.observedTier ?? observedTierOf(tiers, name)
  const block = useMemo(() => stats ?? (rawStats ? parseStatsBlock(rawStats) : undefined), [stats, rawStats])
  const offered = useMemo(() => offersProjection(block), [block])
  const home = defaultProjectionTier(name, observedTier)
  // null = follow the item's own tier, which can still arrive (observed tiers hydrate late).
  const [pick, setPick] = useState<number | null>(null)
  const tier = offered ? (pick ?? home) : 0
  return (
    <ItemWindow
      {...props}
      stats={block}
      observedTier={observedTier}
      projectedTier={tier}
      projectionSlot={offered ? <ItemProjection tier={tier} home={home} onChange={setPick} /> : undefined}
    />
  )
}
