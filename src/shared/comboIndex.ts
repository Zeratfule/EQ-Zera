// THE READ SEAM for class-combo intervals (docs/plans/class-combo-inference.md § 5.2).
//
// PURE, no Electron, importable from main AND the renderer — because the answer to "which
// loadout was I running when I killed that?" is a TIME JOIN, never a stamped field.
//
// This is the load-bearing architectural decision of the feature, so it is written down here
// rather than only in the plan. Interval boundaries are FUZZY AND REVISABLE: a `/who` typed an
// hour from now retroactively re-labels the last hour, a user correction re-labels an arbitrary
// span, and the over-determination bisector can split an interval that already "happened". Any
// `comboId` stamped onto a boss kill or an encounter summary at record time goes stale the
// moment the past is revised, and there is no reconciliation path short of a migration per
// revision. Every record we would want to tag ALREADY carries a timestamp, so a join is exact,
// free, and automatically correct after any recompute.
//
// The same reasoning rules out enriching events on the bus: that would force a field onto
// LogEventBase which every parser rule, every fixture expectation and every module's
// discriminated-union narrowing would have to carry — an enormous blast radius for a derived
// fact that changes under them.

import type { ClassAbbr, ComboInterval } from './classCombo'

/**
 * THE CONFIDENCE GATE (JOS-239): may this interval's loadout be read as FACT, or has the model
 * already said it cannot explain the span?
 *
 * THE DEFECT IT EXISTS FOR. The roster showed Lord Nagafen defeated at D4 under a crisp
 * `ENC / WIZ / MNK` header — a trio the owner never ran, over a 4.5-day interval that swallowed two
 * loadout swaps. Every fact needed to refuse that sentence was ALREADY on the interval: it carried
 * `overDetermined` (five classes clearing the sustained-exclusive bar against three slots) and a
 * level range of 11-50 that no single loadout can produce. The surfaces printed the trio anyway.
 * The boundary fix (modules/comboIntervals.ts) is what stops that span existing; this is what stops
 * the NEXT one being stated as fact, and it is cheap enough to be worth having on its own.
 *
 * TWO CONDITIONS, both already modeled:
 *   * `overDetermined` — more classes cleared the sustained-exclusive bar than the loadout has
 *     slots, so at least one resolved slot is the ranking's opinion rather than the log's word.
 *   * `levelRegressed` — the displayed level went BACKWARDS inside the span, which under
 *     min-of-loadout only a swap does.
 *
 * AND IT APPLIES ONLY TO INFERENCE. A `/who` row is the game naming the loadout outright and a user
 * correction is the owner naming it; neither is a guess that surplus evidence can undermine, and
 * gating them would answer "the game said PAL/MNK/ENC" with "we are not sure". Provenance is per
 * slot, so the test is "no slot was ever stated" — a mixed-provenance interval keeps its statement.
 */
export function loadoutUncertain(interval: ComboInterval): boolean {
  if (interval.slots.some((s) => s.provenance !== 'inferred')) return false
  return interval.startAlso?.includes('overDetermined') === true || interval.levelRegressed === true
}

/**
 * COULD THIS LOADOUT STILL BE RUNNING `abbr`? (JOS-305.)
 *
 * The question is deliberately asked in the PERMISSIVE direction, and the asymmetry is the whole
 * point. A slot is a SET of candidates (classCombo.ts `ComboSlot`): resolved when it holds one,
 * ambiguous when it holds several, and UNKNOWN when it holds all sixteen. So "the combo contains
 * ROG" is a claim this model frequently cannot make, while "no slot of this loadout can possibly
 * be ROG" is one it can — every slot has to have RULED ROG OUT for that to come back false.
 *
 * Written this way because the one caller acts on the NEGATIVE (the combat engine strips a
 * rogue's blade coats when the answer is no, JOS-305/coatClass.ts), and a caller that acts on
 * "not known to be ROG" would strip a live rogue's poisons the moment the model went quiet. An
 * unknown slot carries all sixteen candidates, so silence answers YES here and nothing happens —
 * which is the correct behaviour for an inference that is allowed to destroy state.
 */
export function comboMayInclude(interval: ComboInterval, abbr: ClassAbbr): boolean {
  return interval.slots.some((s) => s.candidates.includes(abbr))
}

/**
 * The interval whose ESTIMATE covers `ts`, or null.
 *
 * Deliberately keyed on `[startTs, endTs)` — the estimate — and not on the uncertainty window:
 * a timestamp has to land in exactly one interval for grouping to be a partition. The
 * uncertainty is not discarded, it is DISPLAYED (`startLo`/`startHi` draw as a hatched region),
 * which is the honest version of "this kill might belong to either side".
 */
export function comboAt(intervals: readonly ComboInterval[], ts: number): ComboInterval | null {
  for (let i = intervals.length - 1; i >= 0; i--) {
    const interval = intervals[i]
    if (ts < interval.startTs) continue
    if (interval.endTs === null || ts < interval.endTs) return interval
    return null
  }
  return null
}

/**
 * Group timestamped rows by the interval covering them, in interval order. Rows before the
 * first interval (or outside every one) land in a leading `interval: null` group rather than
 * being dropped — a row we cannot attribute is still a row the user owns.
 */
export function groupByCombo<T extends { ts: number }>(
  intervals: readonly ComboInterval[],
  rows: readonly T[]
): { interval: ComboInterval | null; rows: T[] }[] {
  const groups = new Map<string, { interval: ComboInterval | null; rows: T[] }>()
  const ordered: { interval: ComboInterval | null; rows: T[] }[] = []
  for (const row of [...rows].sort((a, b) => a.ts - b.ts)) {
    const interval = comboAt(intervals, row.ts)
    const key = interval?.id ?? ''
    let group = groups.get(key)
    if (!group) {
      group = { interval, rows: [] }
      groups.set(key, group)
      ordered.push(group)
    }
    group.rows.push(row)
  }
  return ordered
}
