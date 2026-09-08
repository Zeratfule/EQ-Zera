// planner/gearSet.ts — THE STORED SHAPE OF A GEAR SET, and nothing else any more (JOS-325).
//
// WHAT THIS FILE WAS, AND WHY IT IS NOW TWO INTERFACES. JOS-286 built a whole document here: a
// cell map over `PLAN_SLOTS`, the "where does a ring land" search, displacement on assign, the
// per-cell plus-state edits, and — next door in `gearSetTotals.ts` — the arithmetic that turned a
// set into a `sumGear` total and diffed it against the body. The owner retired the SETS SURFACE on
// 2026-08-13: the Gear tab is pure search, and acquisition planning is the wish list's job
// (JOS-326). Every fold in this file had exactly one caller — the pane that is gone — so the folds
// went with it rather than sitting here as a library nobody opens.
//
// WHAT SURVIVES IS THE SHAPE, AND IT SURVIVES BECAUSE THE DATA DOES. `ProgressState.gearSets` is
// RETIRED FROM THE UI AND KEPT ON DISK (progressState.ts states the ruling): no deletion, no
// migration, every set the user ever made still in their store file. That promise has a cost and
// this file is it — main still validates the key in both directions
// (`src/main/planner/validate.ts sanitizeGearSets`, `src/main/storePlans.ts`), and a validator
// needs a type to validate TO. So the two interfaces stay, spelled exactly as they were written,
// because a stored document's type is a description of bytes already on disk and rewriting it
// would be rewriting them.
//
// THE IPC PAIR STAYS TOO (`IPC.gearGetSets` / `IPC.gearSetSets`, preload's `getGearSets` /
// `setGearSets`), unread by any renderer today. That is deliberate rather than an oversight: the
// door to a kept document is what makes "kept" true, and re-deriving it later from a store file
// nobody can read would be the expensive half of this removal.
//
// PURE (types only, relative value imports, no React/IPC/fs), so both tsconfigs see it and
// `tests/gearSetStore.test.mts` — the surviving suite, which pins the round trip — can import it
// under the node runner.

import type { ItemUpgradeState } from '../itemUpgrade'
import type { PlanSlotId } from './types'

/**
 * ONE ITEM IN ONE CELL, at the plus-state the plan wanted it at.
 *
 * `key` is `itemKey(name)` — the corpus join key every index in this app shares (the gear index,
 * the ownership fold, the loot history). `name` is carried beside it for the same reason
 * `PlanSlot.hostName` is: a stored set must still read as a plan on a machine whose corpus no
 * longer has the row.
 */
export interface GearAssignment {
  /** `itemKey(name)` — the corpus join key */
  key: string
  /** the item's display name, as the corpus spells it */
  name: string
  /**
   * THIS ITEM'S OWN plus-state. Always stored normalized (`normalizeUpgradeState`, applied by the
   * validator), so no reader has to defend against a fraction its own denominator cannot hold.
   */
  state: ItemUpgradeState
}

/**
 * A named virtual loadout, as the store holds it. Persisted per character under
 * `ProgressState.gearSets` and validated in both directions by `src/main/planner/validate.ts` —
 * the `ExaltPlan` arrangement, deliberately, down to the additive optional store key.
 */
export interface GearSet {
  /** `crypto.randomUUID()` — stable across renames, the CRUD handle */
  id: string
  name: string
  createdAt: number
  updatedAt: number
  /** one item per cell, keyed by `PlanSlotId` — the twenty-three `PLAN_SLOTS` cells */
  slots: Partial<Record<PlanSlotId, GearAssignment>>
}
