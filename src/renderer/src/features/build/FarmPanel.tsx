// WHERE TO FARM (EQ Zera) — the Build tab's third panel: the zones that drop the upgrades this
// tab just found, ranked by how much gear score is standing around in each of them.
//
// IT INVENTS NOTHING, AND THAT IS MOST OF THE DESIGN. The mob catalog states who drops what and
// where; it states no rarity and no drop rate (lib/itemSources.ts). So the only ordering this panel
// has any evidence for is SUMMED GAIN, an item dropping off three mobs in one zone counts once, and
// a source whose page names no zone is filed under "Zone not stated" rather than guessed at. There
// is no "best camp" here because the corpus does not contain one.
//
// BOTH WITNESSES TO "WHO DROPS THIS". `sourcesFor` inverts the mob catalog; `GearRow.wikiSources`
// is the item page's own `|dropsfrom`; `mergeItemSources` is the one place that puts them together
// (its header measures why both are needed). This panel calls it and never re-decides the join.
//
// THE ERA FILTER IS APPLIED HERE TOO. `useBuild`'s `excluded` already drops out-of-era rows when
// the tab's toggle is on, so this is belt and braces — but the panel states what it shows, and a
// panel that depended on a filter happening upstream would show out-of-era camps the day the
// upstream changed.

import { type JSX, useMemo } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { GearRow } from '@shared/planner/gear'
import { planSlotLabel } from '@shared/planner/types'
import type { CellUpgrade } from '../../../../shared/build/optimizer'
import { farmPlan, type FarmItem, type FarmZone } from '../../../../shared/build/upgradeFinder'
import { FONTS } from '../../../../shared/palette'
import { mergeItemSources, sourcesFor } from '../../lib/itemSources'
import { eraHides } from '../planner/plannerData'
import type { BuildState } from './useBuild'

/** How many mob names one item lists before it says how many more there are. */
const MAX_MOBS = 3
const SCORE_SX = { fontFamily: FONTS.mono, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const

function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}

/** A clickable name. The Zone Loot tab's `LinkText`, in this panel's own type scale. */
function LinkText({ text, onOpen, dim }: { text: string; onOpen: () => void; dim?: boolean }): JSX.Element {
  return (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
      sx={{
        color: dim === true ? 'text.secondary' : 'text.primary',
        cursor: 'pointer',
        textDecoration: 'underline dotted',
        textUnderlineOffset: 2,
        '&:hover': { color: 'primary.main' }
      }}
    >
      {text}
    </Box>
  )
}

export interface FarmHandlers {
  onOpenLoot: (item: string) => void
  onOpenMob: (t: { mob: string }) => void
}

/** The mobs that drop one item in one zone, capped, each a link into the Mobs tab. */
function MobLinks({ mobs, onOpenMob }: { mobs: readonly string[]; onOpenMob: (t: { mob: string }) => void }): JSX.Element {
  const shown = mobs.slice(0, MAX_MOBS)
  const more = mobs.length - shown.length
  return (
    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
      {shown.map((mob, i) => (
        <Box component="span" key={mob} data-testid="build-farm-mob">
          {i > 0 && ', '}
          <LinkText text={mob} dim onOpen={() => onOpenMob({ mob })} />
        </Box>
      ))}
      {more > 0 && ` +${String(more)} more`}
    </Typography>
  )
}

function FarmItemRow({ item, handlers }: { item: FarmItem; handlers: FarmHandlers }): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ py: 0.25, minWidth: 0 }} data-testid="build-farm-item">
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography variant="body2" noWrap component="div">
          <LinkText text={item.row.name} onOpen={() => handlers.onOpenLoot(item.row.name)} />
        </Typography>
        <MobLinks mobs={item.mobs} onOpenMob={handlers.onOpenMob} />
      </Box>
      <Typography variant="caption" sx={{ ...SCORE_SX, color: 'success.main' }}>
        +{fmt(item.delta)} {planSlotLabel(item.cell)}
      </Typography>
    </Stack>
  )
}

function FarmZoneBlock({ zone, handlers }: { zone: FarmZone; handlers: FarmHandlers }): JSX.Element {
  return (
    <Box sx={{ mb: 1 }} data-testid="build-farm-zone">
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography variant="caption" className="eq-display-label" sx={{ color: 'text.secondary', flexGrow: 1, minWidth: 0 }} noWrap>
          {zone.zone}
        </Typography>
        <Typography variant="caption" sx={{ ...SCORE_SX, color: 'success.main' }}>
          +{fmt(zone.totalDelta)}
        </Typography>
      </Stack>
      {zone.items.map((item) => (
        <FarmItemRow key={item.row.key} item={item} handlers={handlers} />
      ))}
    </Box>
  )
}

/** The upgrade options this panel will group, era-filtered, with the rows they name. */
interface Pruned {
  upgrades: CellUpgrade[]
  byKey: Map<string, GearRow>
  options: number
}

function prune(upgrades: readonly CellUpgrade[], eraOnly: boolean): Pruned {
  const kept: CellUpgrade[] = []
  const byKey = new Map<string, GearRow>()
  let options = 0
  for (const up of upgrades) {
    const list: CellUpgrade['options'] = []
    for (const option of up.options) {
      if (eraHides(option.row, eraOnly)) continue
      byKey.set(option.row.key, option.row)
      list.push(option)
    }
    if (list.length > 0) kept.push({ ...up, options: list })
    options += list.length
  }
  return { upgrades: kept, byKey, options }
}

/** The quiet line that stands in for the list. Each one names what would change it. */
function emptyText(hasDump: boolean, options: number): string | null {
  if (!hasDump) return 'Load an inventory dump to see what to farm.'
  if (options === 0) return 'Nothing in the item database beats what you wear under this profile.'
  return 'No drop sources are stated for your upgrades.'
}

export function FarmPanel({ build, handlers }: { build: BuildState; handlers: FarmHandlers }): JSX.Element {
  const { upgrades, eraOnly, hasDump } = build
  const pruned = useMemo(() => prune(upgrades, eraOnly), [upgrades, eraOnly])
  const zones = useMemo(
    () => farmPlan(pruned.upgrades, (key) => mergeItemSources(sourcesFor(key), pruned.byKey.get(key)?.wikiSources)),
    [pruned]
  )
  const empty = zones.length === 0 ? emptyText(hasDump, pruned.options) : null
  return (
    <Paper variant="outlined" sx={{ p: 1.25, display: 'flex', flexDirection: 'column', maxHeight: 260, flexShrink: 0 }} data-testid="build-farm">
      <Typography variant="caption" className="eq-display-label eq-card-rule" sx={{ display: 'block', color: 'text.secondary', pb: 0.5, mb: 0.75 }}>
        Where to farm · {zones.length} {zones.length === 1 ? 'zone' : 'zones'}
      </Typography>
      <Box sx={{ overflow: 'auto', minHeight: 0 }}>
        {empty === null ? (
          zones.map((zone) => <FarmZoneBlock key={zone.zone} zone={zone} handlers={handlers} />)
        ) : (
          <Typography variant="caption" color="text.disabled">
            {empty}
          </Typography>
        )}
      </Box>
    </Paper>
  )
}
