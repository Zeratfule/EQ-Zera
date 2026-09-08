// storeItemOverrides.ts — the HAND-STATED HELD COUNT's store accessors (JOS-186).
//
// SPLIT OUT OF store.ts FOR FILE MASS, NOT FOR SCOPE — the storePlans.ts precedent, one file over,
// and the same rule it cites: `src/main/store.ts` sits at the measured 400-code-line ceiling and
// the answer to that is a SPLIT rather than a widened threshold. `setProgress` is still the ONE
// write path into `byCharacter` and it is imported from there; nothing about authority moved.
//
// THE RULES ARE NOT HERE. What a statement is, what it may contain and what replacing one means all
// live in the pure `shared/itemOverrides.ts`, which the renderer imports too — so main sanitizing on
// the way in and the renderer folding on the way out cannot disagree about what the user said. This
// file is the three lines of storage that sit under those rules.
//
// NO SCHEMA BUMP AND NO MIGRATION. `itemOverrides` is an ADDITIVE optional key: every reader
// defaults on its absence and electron-store rewrites the whole parsed object, so the key survives
// a round trip through a build that has never heard of it. tests/skyItemOverrides.test.mts pins
// both halves.

import { applyItemOverride, clearItemOverride, sanitizeItemOverrides } from '../shared/itemOverrides'
import { getProgress, setProgress } from './store'
import type { ItemCountOverride } from '../shared/itemOverrides'
import type { ProgressState } from '../shared/types'

/** This character's statements ([] when it has none, or when the stored value is unusable). */
export function getItemOverrides(charId: string): ItemCountOverride[] {
  return sanitizeItemOverrides(getProgress(charId).itemOverrides)
}

/**
 * State (or take back) one item's held count.
 *
 * `count === null` is the take-back: the witnesses answer for that key again, exactly as they did
 * before the statement was made. Anything else is a statement dated NOW — `Date.now()` is the
 * honest instant for a thing the user is saying right now, and dating it is what lets loot after it
 * still count forward (shared/itemOverrides.ts).
 *
 * The whole progress record comes back, like every other write here, so the renderer never has to
 * refetch to see what it just wrote.
 */
export function setItemOverride(
  charId: string,
  key: string,
  name: string,
  count: number | null
): ProgressState {
  const p = getProgress(charId)
  const list = sanitizeItemOverrides(p.itemOverrides)
  const next =
    count === null
      ? clearItemOverride(list, key)
      : applyItemOverride(list, { key, name, count, setAt: Date.now() })
  return setProgress(charId, { ...p, itemOverrides: next })
}
