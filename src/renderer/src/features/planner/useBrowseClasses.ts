// planner/useBrowseClasses.ts — WHICH CLASSES THE EFFECT BROWSER IS FILTERING FOR, now that there
// is no set to hang them on (JOS-326).
//
// THE FILTER SURVIVED THE SETS. Until this ticket the class trio was a field on the SELECTED
// exaltation set, and the toolbar's set switcher is what made "which set's trio" a meaningful
// question. The board and the switcher are gone; the trio is not, because it is the R2 half of the
// browser's own filter — the wide-class donors lighting up is the signal the browse exists for —
// and the ticket makes retaining the browser's filters a hard constraint.
//
// SO IT MOVES DOWN A TIER, TO EXACTLY THE TIER IT ALWAYS BELONGED TO. `usePlans.ts` described two:
// character-scoped KNOWLEDGE in the electron-store, and machine-class UI PREFERENCES in raw
// `localStorage` under `eq.planner.*` (beside the era toggle, the non-equippable toggle and the
// per-socket group-by axis). A browse filter with no document under it is the second kind, and it
// joins its three neighbours under the same prefix.
//
// V2's TWO ANSWERS COME WITH IT, UNCHANGED IN SUBSTANCE (`plannerClasses.ts` owns both rules and is
// not touched by this move):
//   detected → the filter FOLLOWS live class-combo inference. A loadout switch rewrites it,
//              silently and correctly, because nobody has said otherwise yet.
//   user     → the filter is PINNED. Detection never overwrites it; when the two disagree the
//              toolbar offers "detected: PAL ENC MNK - apply", which is one click and reversible.
//
// A FRESH INSTALL IS `detected` WITH NOTHING IN IT, which is what `freshPlan` seeded a brand-new
// set with and for the same reason: an empty trio means "no class filter" everywhere downstream
// (law 1), and following inference from empty is how the browser starts answering for the loadout
// the app has actually inferred without ever guessing one.
//
// AN ABSENT STORED VALUE MEANS `detected` HERE, WHICH IS THE OPPOSITE READING FROM `ExaltPlan`'s —
// and deliberately. There, absent meant a trio a person had accepted at creation before the field
// existed, so re-binding it would rewrite somebody's work. Here there is no prior value to
// respect: nothing has ever written this key, so the honest state is "nobody has said anything
// yet", which is what following inference means.

import { useCallback, useState } from 'react'
import type { ClassAbbr } from '@shared/classCombo'
import { CLASS_ABBRS, MAX_COMBO_SLOTS } from '@shared/classCombo'
import type { ClassesProvenance } from '@shared/planner/types'

const CLASSES_KEY = 'eq.planner.classes'
const PROVENANCE_KEY = 'eq.planner.classesFrom'

/**
 * The stored trio, filtered to the sixteen known abbreviations and capped — the same closed
 * allowlist `src/main/planner/validate.ts` applies to a stored plan, applied here because
 * `localStorage` is a file a user can edit and this build is the only thing checking it.
 */
function loadClasses(): ClassAbbr[] {
  const raw = localStorage.getItem(CLASSES_KEY)
  if (raw === null) return []
  const out: ClassAbbr[] = []
  for (const token of raw.split(',')) {
    const abbr = token.trim() as ClassAbbr
    if (CLASS_ABBRS.includes(abbr) && !out.includes(abbr) && out.length < MAX_COMBO_SLOTS) out.push(abbr)
  }
  return out
}

/** Where it came from. Absent (or anything else) reads as `detected` — see the header. */
function loadProvenance(): ClassesProvenance {
  return localStorage.getItem(PROVENANCE_KEY) === 'user' ? 'user' : 'detected'
}

export interface BrowseClassesApi {
  classes: ClassAbbr[]
  provenance: ClassesProvenance
  /** Edit the trio BY HAND, which PINS it. One-way: nothing hands the filter back to inference. */
  set: (classes: readonly ClassAbbr[]) => void
  /** Write the trio WITHOUT restamping where it came from — the binding and the disagree chip. */
  adopt: (classes: readonly ClassAbbr[]) => void
}

/**
 * The browser's class filter, remembered across sessions. Mount ONCE per view (PlannerView owns
 * it): two mounts would each hold their own copy and only one of them would re-read storage after
 * the other wrote it.
 */
export function useBrowseClasses(): BrowseClassesApi {
  const [classes, setClasses] = useState<ClassAbbr[]>(loadClasses)
  const [provenance, setProvenance] = useState<ClassesProvenance>(loadProvenance)

  const write = useCallback((next: readonly ClassAbbr[], from: ClassesProvenance) => {
    localStorage.setItem(CLASSES_KEY, next.join(','))
    localStorage.setItem(PROVENANCE_KEY, from)
    setClasses([...next])
    setProvenance(from)
  }, [])

  const set = useCallback((next: readonly ClassAbbr[]) => {
    write(next, 'user')
  }, [write])

  // `adopt` deliberately re-writes the CURRENT provenance rather than taking one: a following
  // filter stays following, and a pinned one that accepts today's detection stays pinned — the
  // user accepted one answer, not handed the filter back forever (plannerClasses.ts states the
  // rule; this is the write half of it).
  const adopt = useCallback((next: readonly ClassAbbr[]) => {
    write(next, provenance)
  }, [write, provenance])

  return { classes, provenance, set, adopt }
}
