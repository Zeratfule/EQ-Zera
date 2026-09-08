// useUpgradeFinder — ONE hook, every surface that shows an "upgrade" chip (EQ Zera).
//
// The Zone Loot table asks it once per row and the item page asks it once; both are asking the
// same question the Build tab's Upgrades column answers, under the same profile, against the same
// worn set. So it is one hook, and it reads exactly what the Build tab reads: the gear index
// (`useGearIndex`, one cached fetch per window), the `/outputfile inventory` dump
// (`usePlannerInventory`), the class loadout, and the profile the Build tab remembers
// (`eq.build.profile`, restart tier, so a chip on Zone Loot agrees with the gauges next door).
//
// IT DOES NOT CALL `useBuild()`, and that is the point of it being separate: `useBuild` runs
// `bestBuild` over 6.7k rows three times (one per profile) to draw its meters, which is a fine
// price for one panel and an absurd one for a chip on a table that re-renders on a keystroke. A
// verdict needs the worn set and the weights and nothing else (upgradeFinder.ts's header).
//
// THE ERA FILTER IS ALWAYS ON HERE. `useEraHidden` is the app's one era verdict asked with
// `eraOnly: true`, and an out-of-era item is not an upgrade you can go and get on this server. The
// Build tab has a toggle because it is a planning surface; a chip is a claim, and this one only
// makes the claim it can stand behind.
//
// THE JOIN IS `sourceItemKey`, WHICH IS `GearRow.key`. A caller holds a display NAME (a Zone Loot
// row's `item`, a loot ledger's item), and Zone Loot's own `itemKey` keeps the ` +N` suffix on
// purpose - so the fold has to be re-applied here rather than borrowed (law 2).

import { useCallback, useMemo } from 'react'
import type { GearRow } from '@shared/planner/gear'
import type { BuildProfile } from '../../../../shared/build/profiles'
import { profileWeights } from '../../../../shared/build/profiles'
import { upgradeVerdict, type UpgradeContext, type UpgradeVerdict } from '../../../../shared/build/upgradeFinder'
import { unknownCells, wornSet } from '../../../../shared/build/wornSet'
import { sanitizeBuildProfile } from '../gear/areaMemory'
import { useEraHidden, useGearClasses, useGearIndex } from '../gear/gearData'
import { useRemembered } from '../gear/useAreaMemory'
import { usePlannerInventory } from '../planner/plannerInventory'
import { sourceItemKey } from '../../lib/itemSources'

export interface UpgradeFinder {
  /** false until the index and the dump have both settled - a chip is drawn on neither before then */
  ready: boolean
  /** no dump means every cell is empty, which is not a comparison. Surfaces say so rather than claim. */
  hasDump: boolean
  /** the profile the Build tab is on, so a chip can name it */
  profile: BuildProfile
  verdictFor: (name: string) => UpgradeVerdict | null
  rowFor: (name: string) => GearRow | undefined
}

export function useUpgradeFinder(): UpgradeFinder {
  const index = useGearIndex()
  const { inventory, ready: inventoryReady } = usePlannerInventory()
  const { classes } = useGearClasses()
  const { eraHidden } = useEraHidden()
  const [profile] = useRemembered<BuildProfile>('eq.build.profile', sanitizeBuildProfile)

  // Keyed on the ARRAY identity, which `useGearIndex` holds stable for the window's life.
  const byKey = useMemo(() => new Map(index.rows.map((r) => [r.key, r])), [index.rows])
  const reading = useMemo(() => wornSet(inventory?.hosts ?? [], byKey), [inventory, byKey])

  const ctx = useMemo<UpgradeContext>(
    () => ({
      classes,
      weights: profileWeights(profile, classes),
      worn: reading.worn,
      unknownCells: unknownCells(reading.unknown),
      excluded: eraHidden
    }),
    [classes, profile, reading, eraHidden]
  )

  const hasDump = inventory !== null
  const verdictFor = useCallback(
    (name: string): UpgradeVerdict | null => {
      if (!hasDump) return null
      const row = byKey.get(sourceItemKey(name))
      return row === undefined ? null : upgradeVerdict(row, ctx)
    },
    [byKey, ctx, hasDump]
  )
  const rowFor = useCallback((name: string): GearRow | undefined => byKey.get(sourceItemKey(name)), [byKey])

  return { ready: index.ready && inventoryReady, hasDump, profile, verdictFor, rowFor }
}
