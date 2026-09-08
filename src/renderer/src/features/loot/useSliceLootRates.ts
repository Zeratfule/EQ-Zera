// useSliceLootRates — the loot ledger's own loot-per-hour, for whatever slice is in force (JOS-261).
//
// The sibling of `useItemZoneRates`, one level up: that hook asks "where does THIS ITEM drop and how
// often", this one asks the aggregate question the ledger caption states — how fast is the stretch
// I am looking at paying, in loot per hour. Same two modules, same join, no third store: the `loot`
// history supplies the drops and the `progression` snapshot supplies the denominators, through the
// very same `rangeStats` query the Leveling tab's range panel reads. Nothing here divides anything
// by anything; `shared/lootRates.windowLootRates` does the arithmetic.
//
// THE SNAPSHOT IS PASSED IN, NOT SUBSCRIBED TO. `useTimeslice` already hands its caller the
// `progression` snapshot it resolved the slice against, for exactly this case (`TimesliceState.prog`
// says so) — and taking it as an argument is also what makes the numerator and the denominators
// provably one slice: the range, the zone filter and the snapshot all arrive from the same resolve.
//
// THE HISTORY IS THE WHOLE ONE, UNSLICED. `windowLootRates` applies the slice itself, through the
// same membership test `timeslice.inSlice` applies to the ledger's rows, so the caption's count and
// the caption's rate can never disagree about what "inside" means. Handing in a pre-sliced list
// would work today and would silently double-cut the moment a caller sliced by something else.

import { useMemo } from 'react'
import type { LootEvent, ProgressionSnap } from '@shared/types'
import type { Timeslice } from '@shared/timeslice'
import { rangeStats } from '@shared/progressionStats'
import { windowLootRates, type WindowLootRates } from '@shared/lootRates'

/**
 * Loot per hour over the slice, both denominators, or null when there is no history at all.
 *
 * Null is the "nothing parsed yet" state and nothing else: a slice that merely holds no drops still
 * returns an answer (`drops: 0`), because the surfaces have their own words for an empty slice and
 * this hook must not decide which of them fires.
 */
export function useSliceLootRates(
  history: readonly LootEvent[],
  slice: Timeslice,
  prog: ProgressionSnap
): WindowLootRates | null {
  return useMemo(() => {
    if (history.length === 0) return null
    // ONE query, over the slice's OWN range and zone — the denominators are then the same spans
    // every other number about this slice divides by, on this tab and on the Leveling one.
    const spans = rangeStats({
      snap: prog,
      range: slice.range,
      // BOTH halves of the zone membership (JOS-130 / JOS-291), so the denominator below is the
      // time spent in exactly the visits the rows are counted from.
      zoneKey: slice.zoneKey,
      zoneExactKey: slice.zoneExactKey
    })
    return windowLootRates({
      events: history,
      t0: slice.range.t0,
      t1: slice.range.t1,
      spans,
      zoneKey: slice.zoneKey,
      zoneExactKey: slice.zoneExactKey
    })
  }, [history, slice, prog])
}
