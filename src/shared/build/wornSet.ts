// THE WORN SET (EQ Zera): the `/outputfile inventory` dump's hosts, read as index rows, scaled to
// the `+N` tier the dump states.
//
// LIFTED OUT OF `features/build/useBuild.ts` UNCHANGED, because it has two readers now: the Build
// tab, which scores the set, and `useUpgradeFinder`, which answers "would this drop improve it?"
// on the Zone Loot rows and the item page. Two copies of "what am I wearing" is two answers to the
// question every one of those surfaces is asking, so there is one, and it is pure and shared.
//
// WHAT A `null` CELL MEANS, and it is two different things on purpose:
//   * the dump named nothing there — that place on your body is BARE, and an upgrade into it costs
//     you nothing;
//   * the dump named something the item index has no row for — we cannot score it, so the cell is
//     `null` AND its name lands in `unknown`. A verdict against a thing we cannot score would be an
//     invented one (law 1), so `unknownCells` hands callers exactly those cells to refuse.
// The two are indistinguishable in `worn` alone, which is why `unknown` is returned beside it and
// never quietly dropped.

import { upgradeStateForTier } from '../itemUpgrade'
import type { GearRow } from '../planner/gear'
import { scaleGearRow } from '../planner/gearScale'
import { isAnyCell, PLAN_SLOTS, type PlanSlotId } from '../planner/types'

/** The cells a build has: every plan cell but the two ANY cells (those are exaltation sockets). */
export const BUILD_CELLS: readonly PlanSlotId[] = PLAN_SLOTS.filter((c) => !isAnyCell(c))

/** A worn item the gear index has no row for. Counted, named, never silently dropped. */
export interface WornUnknown {
  cell: PlanSlotId
  name: string
}

/** cell -> the row worn there, or `null` for a bare cell and for one we could not score. */
export type WornSet = Map<PlanSlotId, GearRow | null>

/** What one host looks like to this fold — the planner's `PlannerInventoryHost`, narrowed. */
export interface WornHost {
  slot: PlanSlotId
  key: string
  name: string
  tier?: number
}

export interface WornReading {
  worn: WornSet
  unknown: WornUnknown[]
}

/** The dump's hosts -> rows by cell, scaled to the tier the dump states. */
export function wornSet(hosts: readonly WornHost[], byKey: ReadonlyMap<string, GearRow>): WornReading {
  const worn: WornSet = new Map()
  const unknown: WornUnknown[] = []
  for (const cell of BUILD_CELLS) worn.set(cell, null)
  for (const host of hosts) {
    if (!worn.has(host.slot) || worn.get(host.slot)) continue
    const row = byKey.get(host.key)
    if (row) worn.set(host.slot, scaleGearRow(row, upgradeStateForTier(host.tier)))
    else unknown.push({ cell: host.slot, name: host.name })
  }
  return { worn, unknown }
}

/** The cells whose worn item could not be scored - the set a verdict must never speak about. */
export function unknownCells(unknown: readonly WornUnknown[]): Set<PlanSlotId> {
  const out = new Set<PlanSlotId>()
  for (const u of unknown) out.add(u.cell)
  return out
}
