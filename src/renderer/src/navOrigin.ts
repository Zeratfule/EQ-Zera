// navOrigin — the app's ONE back-continuity rule, as pure functions (JOS-43).
//
// THE BUG THIS EXISTS FOR: every cross-view deep link in the app (a planner donor name, an
// Overview drop row, a Sky quest item, a raid card, a toast) drops you into a drill-down whose
// Back button knew only one destination — the TOP OF ITS OWN LIST. Click a donor in the Planner,
// read the item, press Back, and you are staring at the loot ledger you were never in.
//
// THE CONTRACT: a deep link carries its ORIGIN, and Back returns THERE. The list is the
// back-target only when you genuinely came from the list.
//
// A STACK, not a slot, because links chain: a toast can land you on Mobs from Loot, which you
// reached from the Planner. Popping one at a time unwinds the trail in the order you walked it.
//
// WHAT PUSHES AND WHAT CLEARS is the whole design, and it is here rather than in the hook so it
// can be read (and tested) without React:
//   • an ANCHORED cross-view link (one carrying a drill payload — an item, a mob, a fight, a
//     quest, a level) parks the view it is leaving;
//   • a BARE opener is a plain tab switch, not a drill (the drops card's "All loot", the leveling
//     card), so it clears — there is no drill to press Back in, and whatever was parked belongs
//     to a journey the user has just ended;
//   • a link that re-anchors the view you are already ON parks nothing and disturbs nothing: you
//     did not travel, so the trail behind you is still the trail behind you;
//   • MANUAL navigation — a nav-drawer row, the title bar's Preferences — clears, because a
//     hand-driven tab switch is the user saying where they are going;
//   • a NATIVE drill (clicking a row in the list you are standing in) clears, which is the
//     "genuinely came from the list" half of the contract.
//
// SESSION-LIFETIME AND NOTHING ELSE: no localStorage, no IPC, no persistence. A relaunch starts
// you on a tab, not mid-journey.

// TYPE-ONLY, and that is deliberate: `appViews` reaches `devFlags`, which reads
// `import.meta.env` and therefore only evaluates inside a bundler. A type import is erased, so
// this module stays plain enough for `node --test` to load it (AGENTS.md: node-tested pure
// modules). The caller resolves the display label (VIEW_LABELS) and hands it in already formed.
import type { View } from './appViews'

/** Where a drill was deep-linked FROM, with the origin tab's display name already resolved. */
export interface NavOrigin {
  view: View
  /** The origin tab's display name, so a Back affordance can say where it goes. */
  label: string
}

/**
 * How deep the trail may get. Chains longer than a couple of hops do not happen by hand, but a
 * session runs for hours and an unbounded array that only ever grows is a leak with a nicer name.
 * Overflow drops the OLDEST entry: the recent hops are the ones Back is about to use.
 */
export const MAX_ORIGINS = 8

/** The origin the CURRENT view was reached from, or null — the state a receiver's Back reads. */
export function originTop(stack: readonly NavOrigin[]): NavOrigin | null {
  return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null
}

/**
 * The stack after a router opener fired.
 *
 * @param from     the view being left, labelled (the app's current view at click time)
 * @param to       the view the link is opening
 * @param anchored did the link carry a drill payload? (`openLoot(item)` yes, `openLoot()` no)
 */
export function afterLink(
  stack: readonly NavOrigin[],
  from: NavOrigin,
  to: View,
  anchored: boolean
): NavOrigin[] {
  // A bare opener is a tab switch — nothing to come back from, and nothing parked survives it.
  if (!anchored) return []
  // Re-anchoring the view you are on is not travel: leave the trail exactly as it was.
  if (from.view === to) return [...stack]
  const next = [...stack, from]
  return next.length > MAX_ORIGINS ? next.slice(next.length - MAX_ORIGINS) : next
}

/** The stack after a Back consumed its origin. Empty stays empty (the receiver keeps its list). */
export function afterBack(stack: readonly NavOrigin[]): NavOrigin[] {
  return stack.length > 0 ? stack.slice(0, -1) : []
}
