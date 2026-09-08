// The THIS WEEK view's clock (JOS-74). The lockout window is a function of the instant and
// nothing else (lockout.ts owns the arithmetic and every fact behind it), so the only stateful
// part of the feature is deciding when to re-read `Date.now()`.
//
// It re-reads once a minute while the week view is up, which does two things: the header's
// countdown stays true, and a session left running past a Tuesday morning rolls itself over to
// the new week instead of showing last week's locks until someone reloads. Idle when the view is
// on OVERALL — there is no window to keep current there.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TargetStatus } from './bossStatus'
import { lockoutWindow, tierLocks, type LockoutWindow, type TierLock } from './lockout'

/** Coarse enough for a countdown in whole minutes, which is all the header states. */
const CLOCK_MS = 60_000

export function useLockoutWeek(active: boolean): {
  week: LockoutWindow
  /** The difficulties one card's kills have you locked at this week (empty = open). */
  lockOf: (s: TargetStatus) => TierLock[]
} {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    // Re-read on entry too: the held instant may be from whenever the tab was last opened.
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), CLOCK_MS)
    return () => {
      window.clearInterval(id)
    }
  }, [active])

  const week = useMemo(() => lockoutWindow(nowMs), [nowMs])
  const lockOf = useCallback((s: TargetStatus): TierLock[] => tierLocks(s.tiers, week), [week])
  return { week, lockOf }
}
