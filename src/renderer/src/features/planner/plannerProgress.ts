// planner/plannerProgress.ts — "how far along are you already?", joined onto a planned socket.
//
// DECORATION, NEVER A PREREQUISITE (design D6). Three independent sources answer three different
// questions, and every one of them is allowed to know nothing:
//   * the INVENTORY dump — do you hold a copy right now,
//   * your LOOT HISTORY — have you ever looted one (a copy you sold, gave away or merged still
//     proves the camp works),
//   * the OBSERVED MERGE TIER — how far up the upgrade ladder this character has actually taken
//     it, straight from the log's own merge lines (`useItemTiers`).
// A character with zero dumps, zero loot and zero merges renders every socket as `planned`. That
// is the correct state, not a degraded one, and nothing here throws to say so.
//
// ONE CHIP PER SOCKET, and it is derived law-1-honestly. The tier the log SAW always wins over
// the counts, because "+2 of the +4 you need" is a strictly better answer than "you have one":
// it is the only number that says how much farming is left. An unseen merge is UNDEFINED, never
// 0 — a donor you have never merged shows `have donor`, not `+0/+4`, because we did not observe
// a +0 (observedTierOf's contract).
//
// KEY FAMILY. `PlannerDonor.key`, `itemCountKey` and `itemTierKey` are the same spelling —
// lowercased, ` +N` stripped — so all three joins hit without a translation table. The ONE
// exception is the inventory dump, whose keys are lowercased but NOT `+N`-stripped
// (main/inventory/parseInventory.ts): a dumped "Ghoulbane +2" would key as `ghoulbane +2` and
// silently miss. It is re-folded through `itemCountKey` here, which is also what makes an
// upgraded copy count as the copy it is.

import { useMemo } from 'react'
import type { ExtractTier } from '@shared/planner/types'
import { observedTierOf, useItemTiers } from '../../lib/ObservedItemWindow'
import { itemCountKey } from '../../lib/itemName'
import { computeHeldCounts } from '../posky/heldCounts'
import { useProgress } from '../posky/useProgress'

/**
 * How far a planned donor has got. Ordered by how much it settles: `ready` ends the question,
 * `partial` states the remaining merges, `have` says you hold the item, `planned` says we know
 * nothing about it yet.
 */
export type DonorState = 'planned' | 'have' | 'partial' | 'ready'

export interface DonorProgress {
  state: DonorState
  /** the ONE chip's text — `planned` / `have donor` / `+2/+4` / `ready` */
  label: string
  /** the tier the log observed this character merge it to; undefined = never seen merged */
  tier?: number
  tierRequired: ExtractTier
  /** copies in the latest inventory dump (0 = none, or no dump has ever been loaded) */
  held: number
  /** copies this character has ever looted (0 = none, or the log has not been read that far) */
  looted: number
}

/** The joined counts, keyed the donor way. Both maps are empty on a machine with no data. */
export interface PlannerProgressApi {
  /** the state chip for one planned donor — pure, cheap, and safe to call per row */
  of: (donorKey: string, tierRequired: ExtractTier) => DonorProgress
}

/** The three joined sources, already keyed the donor way — what `donorProgress` reads. */
export interface ProgressSources {
  held: Readonly<Record<string, number>>
  looted: Readonly<Record<string, number>>
  /** the observed merge tier for the key being asked about; undefined = never seen merged */
  tier: number | undefined
}

/** The pure derivation, exported so the chip's rule is one testable function. */
export function donorProgress(
  donorKey: string,
  tierRequired: ExtractTier,
  sources: ProgressSources
): DonorProgress {
  const { held, looted, tier } = sources
  const base = { tier, tierRequired, held: held[donorKey] ?? 0, looted: looted[donorKey] ?? 0 }
  if (tier !== undefined && tier >= tierRequired) return { ...base, state: 'ready', label: 'ready' }
  if (tier !== undefined) {
    return { ...base, state: 'partial', label: `+${String(tier)}/+${String(tierRequired)}` }
  }
  if (base.held > 0 || base.looted > 0) return { ...base, state: 'have', label: 'have donor' }
  return { ...base, state: 'planned', label: 'planned' }
}

/** Re-key an inventory dump onto the donor key family (see the header's KEY FAMILY note). */
export function foldInventory(inventory: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [name, count] of Object.entries(inventory)) {
    const key = itemCountKey(name)
    out[key] = (out[key] ?? 0) + count
  }
  return out
}

/**
 * The planner's progress join. Mounted ONCE by PlannerView and handed down, so Inventory and Farm
 * read the same three sources rather than subscribing twice.
 */
export function usePlannerProgress(): PlannerProgressApi {
  const { progress, lootHistory } = useProgress()
  const tiers = useItemTiers()

  const held = useMemo(() => foldInventory(progress?.inventory ?? {}), [progress])
  const looted = useMemo(() => computeHeldCounts(lootHistory), [lootHistory])

  return useMemo(
    () => ({
      of: (donorKey: string, tierRequired: ExtractTier) =>
        donorProgress(donorKey, tierRequired, { held, looted, tier: observedTierOf(tiers, donorKey) })
    }),
    [held, looted, tiers]
  )
}
