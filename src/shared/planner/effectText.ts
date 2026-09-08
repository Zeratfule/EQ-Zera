// planner/effectText.ts — WHAT AN EFFECT DOES, IN ONE LINE (V6, docs/plans/planner-v2.md).
//
// A proc row said "Nullify Undead" and nothing else, so reading the browser meant a wiki trip per
// row. The committed spell DB already answers three of the four questions a planner asks about an
// effect — is it good or bad, who does it hit, how long does it last — and the fourth (how MUCH)
// is not in the corpus anywhere, so it is not guessed at here or anywhere else.
//
// THE JOIN IS BY NAME, CASE-FOLDED, AT INDEX BUILD (`main/planner/effectIndex.ts`): an item page's
// `Effect: <name>` and a spell page's title are the same string in 94.2% of the 1,560 effect rows
// the committed corpus states (measured 2026-08-05). The 5.8% that miss render NOTHING — no
// placeholder, no "unknown", no fuzzy second pass (law 12). Most of them are the client's own
// annotated spellings (`Healing  as Level 30`, `Frost Strike  Level 51`), and a matcher that
// stripped those would eventually match the wrong spell and state its duration as fact.
//
// COMPOSING IS THE RENDERER'S JOB and the fields ride separately, which is why this module exists
// rather than a `oneLiner` string on the donor row: main serves what the DB SAID, one field per
// fact, and the layout decides how much of it fits.

/** The three facts the spell DB carries for an effect. Every one is absent when the DB is silent. */
export interface EffectFacts {
  /** `spell_type` — "Beneficial" / "Detrimental" */
  spellType?: string
  /** `target_type` — "Self", "Single Hostile", "Group v1"… */
  spellTarget?: string
  /** `duration` as WRITTEN ("Instant", "27 minutes", a level formula) */
  spellDuration?: string
}

/**
 * The one line, or `''` when the DB said nothing about this effect.
 *
 * Type first because it is the fact that changes what a row MEANS (a Detrimental proc and a
 * Beneficial one are different plans), then who it hits, then how long. Interpuncts rather than
 * commas so the parts stay readable when the row ellipsizes mid-line.
 */
export function effectOneLiner(facts: EffectFacts): string {
  return [facts.spellType, facts.spellTarget, facts.spellDuration]
    .map((p) => p?.trim())
    .filter((p): p is string => p !== undefined && p !== '')
    .join(' · ')
}
