// reincarnationXp.ts — THE REINCARNATION EXPERIENCE PENALTY, AS REPORTED. NOT OFFICIAL.
//
// SOURCE: the community planner https://witty-waypoint.pages.dev/reincarnation/ (read 2026-11-23),
// which cites an official Rulers of Kunark FAQ dated 2026-11-14 that we could NOT find. The official
// patch notes (2026-11-10, tests/fixtures/patch-notes/eql-update-notes-11-10-2026.html) describe the
// reincarnation itself and its AAs and say nothing about experience. So every number this file
// produces is COMMUNITY-REPORTED, and every surface that prints one says "reported" (law 1).
//
// THE RULE AS REPORTED:
//   * every completed reincarnation adds +10% to the EXP required for THAT class or race — each
//     class and each race keeps its own counter;
//   * additive, capped at +300% (4x base);
//   * the LARGEST penalty among the loadout's components sets the rate, never the sum (counts
//     3/2/1/0 → +30%, not +60%);
//   * it applies only to levels previously held (in practice 1..50 again), and AA experience is
//     never affected;
//   * a 4th+ reincarnation grants no further AA rank but still counts.
//
// IF THE RULE IS WRONG, IT IS CORRECTED HERE AND NOWHERE ELSE. Nothing else in the tree knows the
// 10% or the cap.
//
// WHAT IT IS NOT: an input to the level ETA. `shared/levelEta.ts` projects from the percentages the
// game STATES per experience line, and those percentages are already of the larger bar — scaling the
// ETA by this multiplier would apply the penalty twice. It feeds only the display of the multiplier
// and the re-level forecast (`reincarnationForecast.ts`), whose input is a PREVIOUS life's
// durations, which were measured under that life's multiplier.
//
// Pure, dependency-free.

/** The one word every surface prints beside a number from this file. */
export const XP_PENALTY_LABEL = 'reported'

/** Where the rule came from, for a link or a hover. */
export const XP_PENALTY_SOURCE_URL = 'https://witty-waypoint.pages.dev/reincarnation/'

/** +10% per completed reincarnation, in tenths so the arithmetic stays exact. */
const TENTHS_PER_REINCARNATION = 1
/** +300% at most: 30 tenths, reached at the 30th reincarnation of a component. */
const CAP_TENTHS = 30

/** One class or race in a loadout, with how many times it has been reincarnated. */
export interface PenaltyComponent {
  component: 'class' | 'race'
  name: string
  count: number
}

/** The XP requirement a loadout levels at, and the component that sets it. */
export interface XpRequirement {
  /** 1 = base; 1.3 = +30% more experience per level. */
  multiplier: number
  /** `multiplier - 1`, the penalty as a fraction (0.3 = +30%). */
  penalty: number
  /** The worst component (the first one on a tie), or null for a loadout with no reincarnation. */
  setBy: PenaltyComponent | null
}

/** One component's own penalty, as a fraction: 0.1 per reincarnation, capped at 3. */
export function componentPenalty(count: number): number {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  return Math.min(n * TENTHS_PER_REINCARNATION, CAP_TENTHS) / 10
}

/** The loadout's requirement: the LARGEST component penalty, never the sum. */
export function xpRequirement(components: readonly PenaltyComponent[]): XpRequirement {
  let setBy: PenaltyComponent | null = null
  let worst = 0
  for (const c of components) {
    const p = componentPenalty(c.count)
    if (p > worst) {
      worst = p
      setBy = c
    }
  }
  return { multiplier: (10 + worst * 10) / 10, penalty: worst, setBy }
}

/** `+30%`, the way every surface writes the penalty. */
export function penaltyText(req: XpRequirement): string {
  return `+${String(Math.round(req.penalty * 100))}%`
}
