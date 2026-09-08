// useLevelUnlocks — the renderer's ONE pull of the level-unlock dataset, and the combo join
// every reader of it performs (docs/plans/levelup-whats-new.md).
//
// WHY A MODULE-LEVEL CACHE. The dataset is built in main from two COMPILE-TIME JSONs
// (spells.json + classes.json), so it cannot change while the app runs — there is no delta
// channel to subscribe to and nothing to invalidate. One in-flight promise, shared by every
// caller, means the panel and the always-mounted ding detector cost exactly one IPC between them
// however many times either remounts.
//
// A FAILED PULL IS EMPTY, NEVER A THROW. The panel then renders its "no unlock data" state and
// the toast falls back to celebrating the level alone — the same shapes a class with zero
// unlocks at that level produces, so there is no second failure path to reason about.

import { useEffect, useMemo, useState } from 'react'
import { EMPTY_UNLOCK_DATA, comboClassesOf, type ComboClasses, type LevelUnlockData } from '@shared/levelUnlocks'
import { useComboSnap } from '../profiles/ClassComboData'

let pending: Promise<LevelUnlockData> | null = null

/** The shared pull. Exported for the detector, which needs the data outside React's render. */
export function levelUnlocks(): Promise<LevelUnlockData> {
  pending ??= window.eq.getLevelUnlocks().catch(() => EMPTY_UNLOCK_DATA)
  return pending
}

/** The dataset, or the empty one until it lands. Never null — an unloaded panel shows empty lists. */
export function useLevelUnlocks(): LevelUnlockData {
  const [data, setData] = useState<LevelUnlockData>(EMPTY_UNLOCK_DATA)
  useEffect(() => {
    let live = true
    void levelUnlocks().then((d) => {
      if (live) setData(d)
    })
    return () => {
      live = false
    }
  }, [])
  return data
}

/**
 * The loadout the character is running NOW — the panel's chips ("which of these are mine").
 *
 * The CURRENT interval, not a `Date.now()` join: they answer the same question, and the module's
 * own `current` cannot drift a frame behind the clock. The toast takes the other form
 * (`comboClassesAt(intervals, ding.ts)`, law 10) because a ding is a timestamped record.
 */
export function useCurrentComboClasses(): ComboClasses {
  const snap = useComboSnap()
  return useMemo(() => comboClassesOf(snap.current), [snap])
}
