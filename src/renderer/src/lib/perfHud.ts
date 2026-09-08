// lib/perfHud.ts — the renderer's half of the performance HUD (docs/plans/perf-profiling.md).
//
// Main owns the numbers it can see (CPU, memory, main-process event-loop lag) and pushes them.
// This file owns the two things main CANNOT see:
//
//   * LONG TASKS. `PerformanceObserver('longtask')` is a renderer API — it reports every block
//     of the RENDERER's main thread over 50 ms, which is exactly the jank the user feels as "the
//     UI went unresponsive" and which main's own loop-lag probe is blind to. The count rides the
//     next arriving sample rather than being round-tripped through main.
//   * THE RING. Sixty samples (two minutes) live here and nowhere else — no history, no file,
//     nothing transmitted (plan P6). Closing the window is how you clear it.
//
// AND IT COSTS NOTHING WHEN THE HUD IS OFF. The subscription is to a channel main leaves
// genuinely silent (it creates no timer at all until the switch is on), and the observer is
// created only while enabled and disconnected the moment it is not.

import { useEffect, useRef, useState } from 'react'
import { pushSample, type PerfHudSample } from '@shared/perf'

/**
 * The `rendererHydrated` startup mark — sent ONCE per window, from module scope of the hook's
 * first mount, so a React StrictMode double-mount costs one IPC message rather than two.
 *
 * IT IS MODULE SCOPE, WHICH MEANS A RELOAD RESETS IT, and that is fine now (JOS-99): the send is
 * idempotent at the far end. Main's IPC handler ignores a repeat because a reloaded window
 * re-reporting hydration is the expected consequence of a reload — the dev watcher's, the
 * did-fail-load retry's, or the crash recovery's — and the launch keeps the FIRST mark. Before
 * that, every reload in the fleet spent a line of errors.log on a refused duplicate. The phase
 * accounting itself is as strict as it ever was for the phases main marks itself.
 */
let hydrationReported = false

export interface PerfHudState {
  /** Is the HUD on? Seeded from the stored pref, then kept in step by the pushes themselves. */
  enabled: boolean
  /** Oldest first, at most `PERF_RING_SIZE`. Empty until the first sample lands. */
  ring: PerfHudSample[]
  /** The newest sample, or null while the HUD has just been switched on. */
  latest: PerfHudSample | null
}

/**
 * Subscribe to the live samples. Mounted once, in the title bar, for the whole app lifetime.
 *
 * The `enabled` flag is hydrated from the store AND driven by the pushes: a sample means on, the
 * single `null` push main sends when the switch is flipped off means off. That is what lets the
 * chip appear and disappear the instant the Preferences toggle moves, with no second channel and
 * no polling.
 */
export function usePerfHud(): PerfHudState {
  const [enabled, setEnabled] = useState(false)
  const [ring, setRing] = useState<PerfHudSample[]>([])
  /** Long tasks observed since the last sample; drained by each arriving sample. */
  const longtasks = useRef(0)

  useEffect(() => {
    if (!hydrationReported) {
      hydrationReported = true
      window.eq.reportRendererHydrated()
    }
    void window.eq.getPerfPrefs().then((prefs) => setEnabled(prefs.enabled))
    return window.eq.onPerfSample((sample) => {
      if (!sample) {
        setEnabled(false)
        setRing([])
        return
      }
      const observed = longtasks.current
      longtasks.current = 0
      setEnabled(true)
      setRing((r) => pushSample(r, { ...sample, longtasks: observed }))
    })
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    // Not every Chromium build exposes the longtask entry type; an absent observer means the
    // count stays 0, which the popover renders as "0" rather than as a failure. A HUD must never
    // be the thing that breaks the window it is measuring.
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        longtasks.current += list.getEntries().length
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      observer = null
    }
    return () => {
      observer?.disconnect()
    }
  }, [enabled])

  return { enabled, ring, latest: ring[ring.length - 1] ?? null }
}
