// wishlist/wishSeed.ts — WHAT THE PLAN BOARD LEFT BEHIND (JOS-326).
//
// The board is gone; the decisions somebody made on it are not. Every socket a user planned names
// a donor item they had decided to go and farm, which is precisely what a wish is — so the FIRST
// time this character's wish list opens, those donors are offered as rows, each labelled
// `planImport` so the list can say where they came from, and each deletable one by one.
//
// THE PLAN STORE IS STILL THERE AND STILL VALIDATED (`ProgressState.exaltPlans`,
// `IPC.plannerGetPlans`). Nothing writes it any more and nothing else reads it; it survives the
// board deliberately, because deleting a user's stored plans to tidy up after a UI removal would
// be destroying their work to make our diff smaller, and this seed is the reason to keep it.
//
// UNMET ONLY. A socket whose donor the log has already seen merged to its extraction tier is
// finished work, not something to go and get, so it is not imported. The verdict comes from the
// same progress join the wish list itself uses, handed in as a predicate — `seedWishes`
// (shared/planner/wishlist.ts) is pure and takes the answer rather than computing it.
//
// AND IT CAN ONLY EVER OVER-IMPORT, WHICH IS THE SAFE DIRECTION. The join reads three sources that
// arrive asynchronously (the inventory dump, the loot history, the observed merge tiers), so a
// seed that runs before they have all answered may call a met socket unmet. That row then lands in
// the wish list, where the SAME join immediately files it under the done strip — visible, correct
// and one click from dismissed. The opposite bet (wait for a readiness signal the join does not
// publish) would risk never seeding at all.
//
// PURE AND NODE-TESTABLE (`tests/wishSeed.test.mts`): plans in, `PlannedWish[]` out, no React.

import type { ExaltPlan, ExtractTier, SocketType } from '@shared/planner/types'
import type { PlannedWish } from '@shared/planner/wishlist'
// RELATIVE value imports (the mobSearch house law) — the node runner drives this file.
import { extractionTier } from '../../../../shared/planner/rules'
import { donorFor, type DonorRow } from '../planner/plannerData'

/** What the seed needs to know about the world, so the fold itself stays pure. */
export interface SeedContext {
  /** `indexDonors(donors)` — resolves a planned (key, effect) pair to its corpus row */
  donors: ReadonlyMap<string, DonorRow[]>
  /** the progress join: has this donor already reached the tier its effect extracts at? */
  progressOf: (donorKey: string, tierRequired: ExtractTier) => { state: string }
}

/**
 * Every planned socket across every stored set, decorated with the display name and the join's
 * verdict — the input `seedWishes` folds into wish entries.
 *
 * WALKED IN STORE ORDER, set by set and cell by cell, because the dedupe downstream keeps the
 * FIRST occurrence of each item and a stable walk makes that a stable choice. Nothing here sorts:
 * the order the plans are in is the order the user built them in.
 *
 * A SOCKET THE CORPUS NO LONGER CARRIES STILL SEEDS. The name falls back to the key and the tier
 * to the socket's own (R1), which is exactly the pair of fallbacks the farm rollup made for the
 * same case — a rescrape that dropped a page must not silently delete somebody's plan.
 */
/** One cell's planned sockets, decorated. Split out because the walk is three levels deep and the
 *  measured `max-depth` ceiling is three — the rule here is to split, never to ratchet. */
function cellWishes(sockets: Partial<Record<SocketType, { effect: string; donorKey: string }>>, ctx: SeedContext): PlannedWish[] {
  const out: PlannedWish[] = []
  for (const [socketName, planned] of Object.entries(sockets)) {
    if (!planned) continue
    const socket = socketName as SocketType
    const donor = donorFor(ctx.donors, planned.donorKey, planned.effect)
    const tierRequired = donor?.tierRequired ?? extractionTier(socket)
    out.push({
      donorKey: planned.donorKey,
      name: donor?.name ?? planned.donorKey,
      effect: planned.effect,
      socket,
      met: ctx.progressOf(planned.donorKey, tierRequired).state === 'ready'
    })
  }
  return out
}

export function plannedWishes(plans: readonly ExaltPlan[], ctx: SeedContext): PlannedWish[] {
  const out: PlannedWish[] = []
  for (const plan of plans) {
    for (const planSlot of Object.values(plan.slots)) {
      if (planSlot) out.push(...cellWishes(planSlot.sockets, ctx))
    }
  }
  return out
}
