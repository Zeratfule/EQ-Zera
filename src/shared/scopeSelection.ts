// scopeSelection.ts — WHICH TIERS, AND PER HOUR OF WHAT: one answer for every window (JOS-332).
//
// THIS FILE OWNS A PAIR AND ITS OPENING, NOT AN ARITHMETIC. `shared/zoneScope.ts` decides what a
// membership IS, `shared/rateBasis.ts` decides what an hour IS, `shared/timeslice.ts` decides which
// stretch of play the numbers are about. This decides only that the first two are ONE FACT the
// whole app agrees on, and what that fact is before anybody has touched a control.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHY THE PAIR EXISTS AT ALL (owner bug report 2026-08-13, with a reproduced scenario).
//
// The owner logged in to open-world `Befallen`, killed for a while, moved to `Befallen 2
// (Adaptive)`, killed for five more minutes, and read `elapsed 27m` off the Leveling tab with
// *this tier* on screen. The 27 minutes is exactly the `allTiers` reading — MEASURED by replaying
// his own log through the real parser + `ProgressionModule` + `rangeStats` at the instant of the
// report: `allTiers` says 29.1 minutes over two rows (`Befallen` 24.8m, `Befallen 2 (Adaptive)`
// 4.3m), `exactTier` says 4.3 minutes over one. So the MODEL was never wrong — `rangeStats` has
// narrowed both the membership AND the denominator under an exact key since JOS-291, because
// `durationMs` is Σ of the admitted VISITS and the visits are what the key filters.
//
// WHAT WAS WRONG IS THAT "THIS TIER" WAS NOT ONE SETTING. The membership lived in TWO places that
// could not see each other:
//
//   • the main window kept it in a module-scope variable inside `useTimeslice.ts` — app-wide across
//     tabs, invisible to any other process;
//   • the XP overlay is a SEPARATE RENDERER and kept its own copy, persisted per window as
//     `OverlayConfig.xpZoneScope`, with `xpBasis` beside it doing the same thing for the hour.
//
// Two states, one label, and the reader has no way to tell which one the numbers in front of them
// obeyed. That is the defect the report is about, and it is not fixable by measuring anything
// differently: it is fixable only by there being one value.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// SO MAIN OWNS IT, EPHEMERALLY, AND FANS IT OUT — the `fightSelection.ts` seam, verbatim.
//
// The windows are separate renderer processes with no shared memory and exactly one thing they all
// already talk to, so the selection lives in main (`src/main/scopeSelection.ts`): one value, one
// setter, one broadcast, and the SAME three bridge members under the SAME names in both preloads so
// ONE renderer hook drives every surface. That is the pattern the global fight selection has used
// since the combat-overlay parity work, and this is the second fact to need it.
//
// EPHEMERAL, LIKE THE FIGHT SELECTION AND UNLIKE THE OVERLAY'S OTHER KNOBS. Both halves of this
// pair were session-lifetime in the app already (`useTimeslice` / `useRateBasis` state the argument:
// a membership and a denominator are things you choose while you are LOOKING, not preferences), and
// the overlay's persisted copies are what this change retires. One fact cannot have two lifetimes,
// and the session-lifetime one is the reading that survives the merge: the OPENING is now the
// answer the owner ruled for, so there is nothing left worth remembering across a launch — a
// reader who never touches the control gets the right read every time the app starts.
//
// The overlay's `xpSlice` is deliberately NOT here. Which STRETCH a floating window measures is its
// own business (`shared/types.ts` states why: a slice chosen on the Loot tab has no business
// re-scoping a window over the game), and it stays persisted per window. It is the two knobs that
// answer "which visits count" and "which hour divides" that had to become one answer.
//
// Pure: no React, no DOM, no Electron, no clock read. Both value imports are relative, so the node
// tests can import this file straight under tsx.

import { RATE_BASIS_OPENING, isRateBasis, type RateBasis } from './rateBasis'
import { ZONE_SCOPE_OPENING, isZoneScope, type ZoneScope } from './zoneScope'

/**
 * The whole app-wide selection. TWO scalars, travelling together, because they are set from the
 * same rows of buttons and read by the same captions — a surface that took one of them from the
 * shared answer and the other from somewhere local would be the defect this file exists to close,
 * halved.
 */
export interface ScopeSelection {
  /** WHICH VISITS of the current camp count (`shared/zoneScope.ts`). */
  zoneScope: ZoneScope
  /** WHICH HOUR every rate divides by (`shared/rateBasis.ts`). */
  basis: RateBasis
}

/**
 * WHAT EVERY WINDOW OPENS ON — this tier, per elapsed hour (owner ruling, JOS-332).
 *
 * Composed from the two vocabularies' own opening constants rather than spelled out here, so a
 * later ruling about either half lands beside that half's definition and this file cannot come to
 * disagree with it. `ZONE_SCOPE_OPENING` carries the argument for the tier half, including why it
 * is safe on a zone with no tier variants and on a slice with no zone at all.
 */
export const SCOPE_SELECTION_OPENING: ScopeSelection = {
  zoneScope: ZONE_SCOPE_OPENING,
  basis: RATE_BASIS_OPENING
}

/** The two selections agree, field for field. A no-op write must broadcast nothing (main) and
 *  re-render nothing (the renderer store), and this is the one test both of them use. */
export function sameScopeSelection(a: ScopeSelection, b: ScopeSelection): boolean {
  return a.zoneScope === b.zoneScope && a.basis === b.basis
}

/**
 * A PATCH, REBUILT RATHER THAN TRUSTED: only the fields this build can name survive, and only when
 * they carry a value it knows.
 *
 * Patches rather than whole selections travel over IPC because each control sets ONE half — the
 * tier toggle must not have to restate the hour it is not touching, or two windows racing a flip
 * would each clobber the other's other knob. Untrusted input by construction (it arrives on an
 * `ipcMain` channel), so an unknown key, a missing one and a bogus value are all the same answer:
 * absent, meaning "this half does not move".
 */
export function normalizeScopePatch(raw: unknown): Partial<ScopeSelection> {
  if (typeof raw !== 'object' || raw === null) return {}
  const src = raw as Record<string, unknown>
  const out: Partial<ScopeSelection> = {}
  if (isZoneScope(src.zoneScope)) out.zoneScope = src.zoneScope
  if (isRateBasis(src.basis)) out.basis = src.basis
  return out
}

/** `current` with a normalized patch applied. The one place a patch becomes a selection, so main's
 *  authority and the renderer's optimistic echo of it can never merge differently. */
export function applyScopePatch(current: ScopeSelection, patch: unknown): ScopeSelection {
  return { ...current, ...normalizeScopePatch(patch) }
}

/**
 * A WHOLE SELECTION, REBUILT — for the two moments a window adopts one it did not compute: the
 * hydrate on mount and the broadcast that follows every change.
 *
 * Anything missing or unknown falls back to the OPENING rather than to the model defaults, because
 * a window that could not read the answer must show what a fresh window shows, not the pre-JOS-291
 * read. (`ZONE_SCOPE_DEFAULT` is the model's "the caller said nothing" and stays `allTiers`
 * forever — see its own doc for why those two constants must not be collapsed.)
 */
export function normalizeScopeSelection(raw: unknown): ScopeSelection {
  return applyScopePatch(SCOPE_SELECTION_OPENING, raw)
}
