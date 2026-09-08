// THE BUILD TAB (EQ Zera, 2026-09-06) — the character builder, in the gear area beside Gear.
//
// WHAT IT ANSWERS. "What am I wearing, what is it worth, and what should I swap in to be tankier,
// hit harder or heal better?" — plus a solo-capability reading. It is Magelo's profile page with
// an optimizer under it: the worn set comes off the `/outputfile inventory` dump the Character
// tab already reads, the candidates come off the gear index the Gear tab already searches, and
// the profiles (shared/build/profiles.ts) turn both into one number per role.
//
// THE METERS ARE RELATIVE, AND SAY SO. 100% is "the best set the same rows and the same filters
// could reach", not a game value — the app cannot know your AC, only what your items say (the
// character sheet's standing rule). Toggling in-era or owned-only moves the ceiling, so it moves
// the number; that is the point of the toggles.
//
// AND WHERE TO FARM (the upgrade finder) IS THE THIRD PANEL: the zones that drop the upgrades this
// tab just found, ranked by the gain each holds, with the mobs that drop them. It states no rarity
// and no drop rate because the catalog states neither; summed gain is the only ordering there is
// evidence for. Its own fixed height and its own scrollbar, per the app's growing-list law.
//
// SWAPS ARE A SANDBOX. "Swap in" replaces a cell in the set the meters read; nothing is written
// anywhere, and Reset puts the dump back. Every item name links out to the Loot drill-down.

import type { JSX } from 'react'
import { Chip, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material'
import { BuildMeters } from './BuildMeters'
import { BuildSetPanel, BuildUpgradesPanel } from './BuildPanels'
import { FarmPanel } from './FarmPanel'
import { useBuild, type BuildState } from './useBuild'
import { outputAgeLabel } from '../../lib/outputFreshness'

/** The Mobs-tab opener, threaded from App. Optional with a no-op default so a caller that has not
 *  wired it yet still compiles; the panel's mob names simply do nothing until it is. */
const NO_MOB = (): void => {
  /* no opener wired */
}

function Toolbar({ build }: { build: BuildState }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap data-testid="build-toolbar">
      <Chip size="small" variant="outlined" label={build.classes.length > 0 ? `Loadout · ${build.classes.join(' / ')}` : 'Loadout unknown - every item counts'} />
      <FormControlLabel
        control={<Switch size="small" checked={build.eraOnly} onChange={(e) => build.setEraOnly(e.target.checked)} />}
        label={<Typography variant="caption">In-era items only</Typography>}
      />
      <FormControlLabel
        control={<Switch size="small" checked={build.ownedOnly} onChange={(e) => build.setOwnedOnly(e.target.checked)} />}
        label={<Typography variant="caption">Owned or looted only</Typography>}
      />
      <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto' }}>
        your inventory dump · {outputAgeLabel(build.exportedAt)}
      </Typography>
    </Stack>
  )
}

function NoDump(): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="build-no-dump">
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        No inventory dump yet
      </Typography>
      <Typography variant="body2" color="text.secondary">
        In game, type <code>/outputfile inventory</code>. The app reads the file it writes, the Character tab shows what you wear, and this tab
        scores it and finds the swaps. It re-reads on its own each time you export again.
      </Typography>
    </Paper>
  )
}

export default function BuildView({
  onOpenLoot,
  onOpenMob = NO_MOB
}: {
  onOpenLoot: (item?: string) => void
  onOpenMob?: (t: { mob: string }) => void
}): JSX.Element {
  const build = useBuild()
  if (!build.ready) {
    return (
      <Typography variant="caption" color="text.disabled">
        Reading the item index and your inventory dump...
      </Typography>
    )
  }
  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }} data-testid="build-view">
      <Toolbar build={build} />
      {!build.hasDump && <NoDump />}
      <BuildMeters build={build} />
      <Stack direction="row" spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
        <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <BuildSetPanel build={build} onOpenLoot={onOpenLoot} />
        </Stack>
        <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <BuildUpgradesPanel build={build} onOpenLoot={onOpenLoot} />
        </Stack>
      </Stack>
      {/* A growing list in a FIXED-height scroll box (AGENTS.md): its own maxHeight and its own
          overflow, so it can never squeeze the two panels above it to nothing. */}
      <FarmPanel build={build} handlers={{ onOpenLoot, onOpenMob }} />
    </Stack>
  )
}

/** The App.tsx mount, a sibling of the other view branches (PlainView is at its complexity ceiling). */
export function BuildBranch({
  view,
  viewKey,
  onOpenLoot,
  onOpenMob
}: {
  view: string
  viewKey: string
  onOpenLoot: (item?: string) => void
  /** `routing.openMob` — optional so App compiles before the integrator threads it through. */
  onOpenMob?: (t: { mob: string }) => void
}): JSX.Element | null {
  return view === 'build' ? <BuildView key={viewKey} onOpenLoot={onOpenLoot} onOpenMob={onOpenMob} /> : null
}
