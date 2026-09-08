// GLOBAL FIGHT SELECTION — the renderer half (docs/plans/combat-overlay-parity.md P4/P5/P6).
//
// ONE HOOK, BOTH BUNDLES. The Combat tab's fight picker, the 'fight' overlay's selector and the
// 'heal-fight' overlay's selector are three different chromes over one fact: which fight the app
// is looking at. They all call this, because the two preload bridges expose the SAME three
// members under the SAME names (`getFightSelection` / `setFightSelection` / `onFightSelection` —
// see preload/windows.ts and preload/overlay.ts). The bridge is a PARAMETER rather than a
// `window.*` read so this file stays honest in both entries and testable in neither's presence.
//
// It is the `petRows.meterPanel` pattern applied to selection: one implementation, three
// surfaces, no place left for a second answer to live.
//
// MUI-FREE (the overlay bundle imports it) and value-imports `shared/*` RELATIVELY (the overlay
// entry and node both resolve no `@shared` alias for values — the repo-wide mobSearch precedent).
//
// WHAT IT DOES NOT DO: it never touches a surface's Fight-vs-Overall SCOPE (P5), and a
// zone-session selector never calls it at all (the ruling's carve-out — 'overall' and
// 'heal-overall' keep their own per-overlay selection).

import { useCallback, useEffect, useState } from 'react'
import { LIVE_FIGHT, isFightSelection } from '../../../../shared/fightSelection'

/**
 * The three bridge members this needs. Both preloads satisfy it structurally, so neither bundle
 * has to adapt anything — `useGlobalFight(window.eq)` and `useGlobalFight(window.eqOverlay)` are
 * the two call sites.
 */
export interface FightSelectionBridge {
  getFightSelection: () => Promise<string>
  setFightSelection: (id: string) => void
  onFightSelection: (cb: (s: { fightId: string }) => void) => () => void
}

/**
 * The selected fight, and the setter every fight-scoped selector calls.
 *
 * HYDRATE THEN SUBSCRIBE: a window that opens after the last change (a freshly spawned overlay)
 * must not sit on the sentinel while every other surface shows fight 41, so it asks once and
 * then rides the broadcast.
 *
 * THE WRITE IS OPTIMISTIC: local state moves this frame and main echoes the same value back to
 * every window including this one, so the selector never lags its own click by a round trip and
 * there is still exactly one authority.
 *
 * `bridge` is optional because an HMR reload can render a frame before the preload has re-run.
 * With no bridge the hook is a constant sentinel — the surface renders its default, which is
 * the same honest degradation a stale id gets (P6).
 */
export function useGlobalFight(bridge: FightSelectionBridge | undefined): {
  fightId: string
  selectFight: (id: string) => void
} {
  const [fightId, setLocal] = useState<string>(LIVE_FIGHT)

  useEffect(() => {
    if (!bridge) return
    let alive = true
    // A malformed value can only come from a broken build, but the guard costs nothing and keeps
    // the invariant ("this state is always a valid selection") true by construction.
    const adopt = (id: string): void => {
      if (alive && isFightSelection(id)) setLocal(id)
    }
    void bridge.getFightSelection().then(adopt, () => undefined)
    const off = bridge.onFightSelection((s) => adopt(s.fightId))
    return () => {
      alive = false
      off()
    }
  }, [bridge])

  const selectFight = useCallback(
    (id: string): void => {
      // A zone-session id reaching here is a caller bug (an Overall selector wired to the wrong
      // setter), and dropping it locally is the same verdict main's handler would return.
      if (!isFightSelection(id)) return
      setLocal(id)
      bridge?.setFightSelection(id)
    },
    [bridge]
  )

  return { fightId, selectFight }
}
