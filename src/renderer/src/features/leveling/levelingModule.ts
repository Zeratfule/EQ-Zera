// The `leveling` module's renderer-side fold — one definition, two callers.
//
// LevelingView draws it and the always-mounted ding detector (useLevelUpToast) watches it, so the
// empty state and the delta merge live here rather than inside either. The module's contract is
// "everything, forever": every delta is pure APPEND, which is exactly why the detector can find a
// new ding by timestamp instead of diffing.

import type { LevelingDelta, LevelingSnap } from '@shared/types'

export const EMPTY_LEVELING: LevelingSnap = { levels: [], aaGains: [], aaSpends: [], aaPotions: [] }

export const applyLevelingDelta = (s: LevelingSnap, d: LevelingDelta): LevelingSnap => ({
  levels: [...s.levels, ...d.levels],
  aaGains: [...s.aaGains, ...d.aaGains],
  aaSpends: [...s.aaSpends, ...d.aaSpends],
  aaPotions: [...s.aaPotions, ...d.aaPotions]
})
