// planner/plannerClasses.ts — THE SET'S CLASS TRIO IS A FILTER, NOT A RULE (V2, docs/plans/planner-v2.md).
//
// The shipped planner seeded a set's classes ONCE, at creation, from the inferred combo — and then
// orphaned them. The owner's live case is the whole argument: after a loadout switch and a Sky
// clear the app knew the trio was `pal enc mnk` and the planner still filtered on `rog pal ber`,
// with no way to say so. So a set now declares WHERE its trio came from (`ExaltPlan
// .classesProvenance`) and the two answers behave differently:
//
//   detected → the filter FOLLOWS live inference. A loadout switch rewrites it, silently and
//              correctly, because nobody has said otherwise yet.
//   user     → the filter is PINNED. Detection never overwrites it; when the two disagree the
//              toolbar offers "detected: PAL ENC MNK — apply", which is one click and reversible.
//
// AND NOTHING IS EVER ENFORCED BY IT. That is the other half of V2 and the reason this module has
// a mismatch function rather than a validity function: a donor outside the filter is HIDDEN by the
// browser like any other filtered row, and a donor already sitting in the build that no longer
// matches is KEPT and highlighted (`classesMismatch`, drawn as a chip in the same family as the
// era chip). Re-inference must never be able to invalidate work — it can only ever point at it.
//
// PURE AND NODE-TESTABLE (`tests/plannerClasses.test.mts`), the plannerGroups precedent: value
// imports are RELATIVE, nothing here touches React, storage or the corpus.

import type { ClassAbbr } from '../../../../shared/classCombo'
import type { ClassesProvenance, ExaltPlan } from '../../../../shared/planner/types'

/**
 * Where this set's trio came from. ABSENT MEANS `user`: every set stored before the field existed
 * carries a trio a person accepted at creation time, and re-binding those to today's detection
 * would rewrite work nobody asked us to touch (types.ts states the same rule at the type).
 */
export function provenanceOf(plan: Pick<ExaltPlan, 'classesProvenance'>): ClassesProvenance {
  return plan.classesProvenance ?? 'user'
}

/** Same trio? A SET comparison — the picker's order is an editing artefact, never a difference. */
export function sameClasses(a: readonly ClassAbbr[], b: readonly ClassAbbr[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c))
}

/**
 * The trio a `detected` set should be carrying right now, or `null` when nothing needs writing.
 *
 * Null on three distinct grounds, and they are not the same thing:
 *   * the set is PINNED — detection is not entitled to touch it;
 *   * detection knows NOTHING yet (an empty answer is "we have not inferred a combo", law 1, and
 *     an empty filter means "all classes" — so writing it in would widen the set on a fact nobody
 *     stated);
 *   * detection already agrees, in which case a write would be pure churn through the debounced
 *     save and a fresh `updatedAt` on a set nobody edited.
 */
export function boundClasses(
  plan: Pick<ExaltPlan, 'classes' | 'classesProvenance'>,
  detected: readonly ClassAbbr[]
): ClassAbbr[] | null {
  if (provenanceOf(plan) !== 'detected') return null
  if (detected.length === 0 || sameClasses(plan.classes, detected)) return null
  return [...detected]
}

/**
 * What the disagree chip offers, or `null` when there is nothing to offer.
 *
 * Only a PINNED set ever gets one — a following set has already taken the answer — and only when
 * detection has actually resolved a trio that differs. Applying it does NOT un-pin the set: the
 * user is accepting one answer, not handing the filter back to inference forever.
 */
export function detectedOffer(
  plan: Pick<ExaltPlan, 'classes' | 'classesProvenance'>,
  detected: readonly ClassAbbr[]
): ClassAbbr[] | null {
  if (provenanceOf(plan) !== 'user') return null
  if (detected.length === 0 || sameClasses(plan.classes, detected)) return null
  return [...detected]
}

/**
 * R2's class half, as a MISMATCH rather than a verdict: do these two class lists provably share
 * nobody?
 *
 * Both empties are unknowns and neither is a mismatch (law 1) — an empty plan trio asks for no
 * class filter at all, and a donor whose page stated no class list is a page that stayed silent,
 * not an item nobody can use. This is the one rule; `plannerData.classFit` reads it out as its
 * three-valued answer so the browser filter and the mismatch chip can never drift apart.
 */
export function classesMismatch(
  donorClasses: readonly ClassAbbr[],
  planClasses: readonly ClassAbbr[]
): boolean {
  if (donorClasses.length === 0 || planClasses.length === 0) return false
  return !donorClasses.some((c) => planClasses.includes(c))
}
