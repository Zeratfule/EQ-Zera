// useRateBasis — WHICH HOUR THE RATES ARE PER, app-wide (JOS-288; one window wider since JOS-332).
//
// The sibling of `useTimeslice`, one question over: that hook keeps WHICH STRETCH a reader is
// looking at, this one keeps WHICH DENOMINATOR its rates are divided by. The vocabulary, the
// default and the just-arrived gate are all `shared/rateBasis.ts`'s; this file is the one thing a
// renderer has to add to them — a hook with the app's own words on it.
//
// WHY IT IS APP-WIDE AND NOT PER PANEL. It is `useTimeslice`'s argument verbatim: a reader who
// flips the Leveling hero to active time and then looks down at the per-zone table or across at the
// AA pace is asking ONE question, and a page whose halves divide by different hours is the exact
// thing the two-denominator vocabulary exists to prevent. One flip, one hour, every rate on the tab.
//
// AND SINCE JOS-332, EVERY WINDOW. The XP overlay used to keep its own persisted copy of this knob,
// on the argument that an overlay remembers everything about itself (its position, its rows, its
// slice) because it is a window you set up once and leave floating over the game, while a tab is a
// place you visit. That argument survives for the SLICE, which is still per window — but it does
// not survive for a knob whose whole job is to say what the number in front of you means. The
// owner's report was about the tier half of the same pair: two states, one label, `elapsed 27m` on
// a tab that had never heard about the *this tier* showing over the game. So both halves became ONE
// fact, held in main and fanned out (`shared/scopeSelection.ts` carries the whole argument), and
// one lifetime had to win. SESSION-LIFETIME did: the opening is the reading the owner ruled for, so
// a launch that forgets is a launch that starts you in the right place.
//
// THE STORE IS `useScopeSelection`'s, shared with the membership beside it, for that file's own
// reason: half this tab reads these two scalars and an optimistic write must move the buttons and
// the numbers in the SAME commit.

import { useCallback } from 'react'
import { RATE_BASIS_OPENING, toggleRateBasis, type RateBasis } from '@shared/rateBasis'
import { resetScopeSelection, useScopeSelection } from './useScopeSelection'

/** Reset to the ruled opening. Exported for tests, exactly like `resetTimeslice` — and now the same
 *  one call, because the two knobs are one value. */
export function resetRateBasis(): void {
  resetScopeSelection()
}

/** The opening this hook comes up on, re-exported so a caller does not have to know that the
 *  app-wide selection is where it now comes from. */
export const RATE_BASIS_INITIAL: RateBasis = RATE_BASIS_OPENING

export interface RateBasisState {
  /** The hour in force. Every rate on the surface divides by this one. */
  basis: RateBasis
  /** Flip to the other one — there are exactly two, so this is the whole control. */
  toggle: () => void
  /** Set it outright, for a control that renders both options rather than a flip. */
  setBasis: (next: RateBasis) => void
}

export function useRateBasis(): RateBasisState {
  const { basis, setBasis } = useScopeSelection(window.eq)
  const toggle = useCallback(() => {
    setBasis(toggleRateBasis(basis))
  }, [basis, setBasis])
  return { basis, toggle, setBasis }
}
