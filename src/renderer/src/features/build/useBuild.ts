// THE BUILD TAB'S STATE (EQ Zera, 2026-09-06): the worn set read off the inventory dump, the
// swaps the player is trying, and everything the three profiles say about both — computed here,
// drawn by the panels.
//
// WHAT IT READS, and from where it already exists:
//   - the gear index (`useGearIndex`, main's 6.7k equippable rows with numeric stats),
//   - the worn hosts (`usePlannerInventory`, the `/outputfile inventory` dump by cell), each
//     scaled to the tier the dump states (`scaleGearRow`), the way the character sheet totals,
//   - the class loadout the Gear tab filters by (`useGearClasses`), the era rule the Exaltations
//     tab uses (`useEraOnly` + `eraHides`), and the owned/looted join (`useGearOwnership`).
//
// WHAT IT COMPUTES: for each profile, the set's score and the best score the same rows could
// reach under the same filters (`bestBuild`) — a meter is the ratio; and for the SELECTED profile,
// the upgrades per cell. Candidates are scored at their BASE tier, worn items at theirs; the
// panel says so.

import { useCallback, useMemo, useState } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
import type { GearRow } from '@shared/planner/gear'
import type { PlanSlotId } from '@shared/planner/types'
import {
  BUILD_PROFILES,
  meterPercent,
  profileWeights,
  soloKit,
  soloReading,
  type BuildProfile,
  type BuildWeights,
  type SoloKit,
  type SoloReading
} from '../../../../shared/build/profiles'
import { bestBuild, buildScore, upgradesFor, type BuildSet, type CellUpgrade } from '../../../../shared/build/optimizer'
// THE WORN READ IS SHARED NOW (shared/build/wornSet.ts). `useUpgradeFinder` asks the same question
// from the Zone Loot rows and the item page, and two spellings of "what am I wearing" would be two
// answers to it. `BUILD_CELLS` and `WornUnknown` are re-exported below for this tab's importers.
import { BUILD_CELLS, wornSet, type WornUnknown } from '../../../../shared/build/wornSet'
import { useEraHidden, useGearClasses, useGearIndex, useGearOwnership, useOwnedOrLooted } from '../gear/gearData'
import { useRemembered } from '../gear/useAreaMemory'
import { sanitizeBuildProfile } from '../gear/areaMemory'
import { useEraOnly } from '../planner/plannerData'
import { usePlannerInventory } from '../planner/plannerInventory'
import { outputUpdatedMillis } from '../../lib/outputFreshness'

export { BUILD_CELLS }
export type { WornUnknown }

const UPGRADES_PER_CELL = 3

export type Meters = Record<BuildProfile, number>

export interface BuildState {
  ready: boolean
  hasDump: boolean
  exportedAt: number | undefined
  classes: ClassAbbr[]
  profile: BuildProfile
  setProfile: (p: BuildProfile) => void
  eraOnly: boolean
  setEraOnly: (v: boolean) => void
  ownedOnly: boolean
  setOwnedOnly: (v: boolean) => void
  /** the dump's worn items, as index rows scaled to their tier; null where empty or unknown */
  worn: BuildSet
  /** worn items the index has no row for — counted, never silently dropped */
  unknown: WornUnknown[]
  /** worn + swaps */
  set: BuildSet
  swaps: ReadonlyMap<PlanSlotId, GearRow>
  swap: (cell: PlanSlotId, row: GearRow) => void
  unswap: (cell: PlanSlotId) => void
  reset: () => void
  weights: BuildWeights
  meters: Meters
  /** the selected profile's score, and the best it could reach */
  score: { current: number; best: number }
  kit: SoloKit
  solo: SoloReading
  upgrades: CellUpgrade[]
}

export function useBuild(): BuildState {
  const index = useGearIndex()
  const { inventory, ready: inventoryReady } = usePlannerInventory()
  const { classes } = useGearClasses()
  const { eraHidden } = useEraHidden()
  const [eraOnly, setEraOnly] = useEraOnly()
  const ownership = useGearOwnership()
  const { ownedOrLooted } = useOwnedOrLooted(ownership.map)
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [profile, setProfile] = useRemembered<BuildProfile>('eq.build.profile', sanitizeBuildProfile)
  const [swaps, setSwaps] = useState<ReadonlyMap<PlanSlotId, GearRow>>(() => new Map())

  const byKey = useMemo(() => new Map(index.rows.map((r) => [r.key, r])), [index.rows])
  const { worn, unknown } = useMemo(() => wornSet(inventory?.hosts ?? [], byKey), [inventory, byKey])
  const set = useMemo(() => {
    const out = new Map(worn)
    for (const [cell, row] of swaps) out.set(cell, row)
    return out
  }, [worn, swaps])

  const excluded = useCallback(
    (row: GearRow) => (eraOnly && eraHidden(row)) || (ownedOnly && !ownedOrLooted(row)),
    [eraOnly, eraHidden, ownedOnly, ownedOrLooted]
  )

  // Every profile's weights, current score and best reachable score — the three meters.
  const readings = useMemo(() => {
    const out = {} as Record<BuildProfile, { weights: BuildWeights; current: number; best: number }>
    for (const p of BUILD_PROFILES) {
      const weights = profileWeights(p, classes)
      const ctx = { classes, weights, excluded }
      out[p] = { weights, current: buildScore(set, weights), best: buildScore(bestBuild(index.rows, BUILD_CELLS, ctx), weights) }
    }
    return out
  }, [index.rows, classes, excluded, set])

  const meters = useMemo(() => {
    const out = {} as Meters
    for (const p of BUILD_PROFILES) out[p] = meterPercent(readings[p].current, readings[p].best)
    return out
  }, [readings])

  const kit = useMemo(() => soloKit(classes), [classes])
  const solo = useMemo(() => soloReading(kit, meters), [kit, meters])

  const weights = readings[profile].weights
  const upgrades = useMemo(
    () => upgradesFor(index.rows, set, BUILD_CELLS, { classes, weights, excluded, perCell: UPGRADES_PER_CELL }),
    [index.rows, set, classes, weights, excluded]
  )

  const swap = useCallback((cell: PlanSlotId, row: GearRow) => {
    setSwaps((prev) => new Map(prev).set(cell, row))
  }, [])
  const unswap = useCallback((cell: PlanSlotId) => {
    setSwaps((prev) => {
      const next = new Map(prev)
      next.delete(cell)
      return next
    })
  }, [])
  const reset = useCallback(() => {
    setSwaps(new Map())
  }, [])

  return {
    ready: index.ready && inventoryReady,
    hasDump: inventory !== null,
    exportedAt: outputUpdatedMillis(inventory?.loadedAt),
    classes,
    profile,
    setProfile,
    eraOnly,
    setEraOnly,
    ownedOnly,
    setOwnedOnly,
    worn,
    unknown,
    set,
    swaps,
    swap,
    unswap,
    reset,
    weights,
    meters,
    score: { current: readings[profile].current, best: readings[profile].best },
    kit,
    solo,
    upgrades
  }
}
