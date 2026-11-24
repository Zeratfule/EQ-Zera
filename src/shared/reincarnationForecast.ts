// reincarnationForecast.ts — HOW LONG THIS LIFE TO THE CAP, from how long the last one took.
//
// An ESTIMATE, and every surface says so. The previous life's per-level ONLINE times (consecutive
// dings exactly one level apart, logouts removed) are scaled by the ratio of this life's reported
// XP multiplier to that life's (shared/reincarnationXp.ts — the penalty is community-reported, so
// the forecast is too). Your pace is assumed unchanged: same camps, same group, same gear.
//
// HIDDEN rather than guessed when the previous life is too thin to stand on: fewer than
// `MIN_COVERAGE` of the levels still ahead have a measured time in it.
//
// The level ETA is deliberately NOT built on this. It projects from the percentages the game states
// per experience line, which already describe the larger bar; scaling it would double the penalty.
//
// Pure: type imports plus one value import from progressionStats (relative, the node-test rule).

import type { ProgressionSnap } from './progressionTypes'
import { offlineMsIn } from './progressionStats'
import { LEVEL_CAP } from './reincarnation'

/** At least this share of the levels still ahead must have a time in the previous life. */
export const MIN_COVERAGE = 0.8

export interface ReLevelForecast {
  /** Estimated ONLINE ms from the current level to the cap. */
  ms: number
  /** The level the estimate starts from, and the cap it reaches. */
  fromLevel: number
  toLevel: number
  /** How many of the levels ahead had a measured time last life, of how many. */
  measured: number
  levels: number
  /** this life's multiplier / the previous life's. */
  ratio: number
}

/** The previous life's measured ONLINE ms per level reached (`2` = the 1→2 bar), inside (from, to). */
export function perLevelMs(snap: ProgressionSnap, from: number, to: number): Map<number, number> {
  const out = new Map<number, number>()
  const { levelTs, levelValue } = snap
  for (let i = 1; i < levelTs.length; i++) {
    const t0 = levelTs[i - 1]
    const t1 = levelTs[i]
    if (t0 <= from || t1 >= to || levelValue[i] !== levelValue[i - 1] + 1) continue
    // The last time a level was reached wins: an earlier pass belongs to another loadout's run.
    out.set(levelValue[i], Math.max(0, t1 - t0 - offlineMsIn(snap, t0, t1)))
  }
  return out
}

/** The 1→2 bar of the life that began at `rebirth`, when its first ding is a 2. */
function firstBarMs(snap: ProgressionSnap, rebirth: number, to: number): number | null {
  const i = snap.levelTs.findIndex((t) => t > rebirth && t < to)
  if (i < 0 || snap.levelValue[i] !== 2) return null
  return Math.max(0, snap.levelTs[i] - rebirth - offlineMsIn(snap, rebirth, snap.levelTs[i]))
}

/** Per-level times of the life that ended at the latest reincarnation (its 1→2 bar included). */
function previousLifeTimes(snap: ProgressionSnap, rebirths: readonly number[]): Map<number, number> {
  const last = rebirths[rebirths.length - 1]
  const prev = rebirths.length > 1 ? rebirths[rebirths.length - 2] : Number.NEGATIVE_INFINITY
  const times = perLevelMs(snap, prev, last)
  const first = Number.isFinite(prev) ? firstBarMs(snap, prev, last) : null
  if (first !== null && !times.has(2)) times.set(2, first)
  return times
}

/**
 * The forecast for the life in progress, or null. `ratio` is this life's multiplier over the
 * previous life's (`xpRequirement(...).multiplier` of each); `currentLevel` is the stated level.
 */
export function reLevelForecast(
  snap: ProgressionSnap,
  currentLevel: number,
  ratio: number
): ReLevelForecast | null {
  const rebirths = snap.rebirthTs ?? []
  if (rebirths.length === 0 || !(ratio > 0) || currentLevel >= LEVEL_CAP) return null
  const times = previousLifeTimes(snap, rebirths)
  let known = 0
  let measured = 0
  const levels = LEVEL_CAP - currentLevel
  for (let level = currentLevel + 1; level <= LEVEL_CAP; level++) {
    const ms = times.get(level)
    if (ms === undefined) continue
    known += ms
    measured++
  }
  if (measured === 0 || measured / levels < MIN_COVERAGE) return null
  // The unmeasured few are filled at the measured levels' average, which the `measured` count states.
  const ms = (known / measured) * levels * ratio
  return { ms, fromLevel: currentLevel, toLevel: LEVEL_CAP, measured, levels, ratio }
}
