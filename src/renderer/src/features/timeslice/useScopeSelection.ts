// useScopeSelection — THE RENDERER HALF of the app-wide scope selection (JOS-332).
//
// ONE HOOK, BOTH BUNDLES. The Leveling tab's `every tier | this tier` group, its `elapsed | active`
// group and the XP overlay's two footer buttons are four chromes over TWO facts: which visits of
// the camp count, and which hour every rate divides by. They all call this, because the two preload
// bridges expose the SAME three members under the SAME names (`getScopeSelection` /
// `setScopeSelection` / `onScopeSelection` — see preload/windows.ts and preload/overlay.ts). The
// bridge is a PARAMETER rather than a `window.*` read so this file stays honest in both entries.
//
// It is `useGlobalFight` applied to the second cross-window fact, deliberately down to the shape:
// hydrate then subscribe, optimistic write, degrade to the opening with no bridge at all.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHY THERE IS A MODULE-SCOPE STORE HERE AND NOT JUST `useState`.
//
// `useGlobalFight` can hold its value in component state because ONE component reads it. This pair
// is read by half the Leveling tab at once — `useTimeslice` resolves the slice with the membership,
// `ZoneScopeBar` renders the buttons, `RangeStatsPanel` and every rate row read the basis — and if
// each of them kept its own copy, an optimistic write in the button would move the button one frame
// before it moved the numbers. A caption that disagrees with the row under it, for a frame, is a
// smaller version of the exact defect this ticket is about. So there is ONE value per WINDOW,
// published through `useSyncExternalStore` over a VERSION counter (a getSnapshot returning a fresh
// object would re-render forever — `useTimeslice`'s store, same five lines, same reason), and every
// consumer in the window moves in the same commit.
//
// THE STORE IS A CACHE, NOT AN AUTHORITY. Main owns the value; this holds the last one it heard and
// writes through. A local write is applied optimistically so a click never waits on a round trip,
// and main's echo of the same value is a no-op here by `sameScopeSelection` — so the flip costs
// exactly one render in the window that made it and one in every other.
//
// MUI-FREE (the overlay bundle imports it) and value-imports `shared/*` RELATIVELY — the overlay
// entry and node both resolve no `@shared` alias for values (the repo-wide mobSearch precedent).

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { RateBasis } from '../../../../shared/rateBasis'
import type { ZoneScope } from '../../../../shared/zoneScope'
import {
  SCOPE_SELECTION_OPENING,
  normalizeScopeSelection,
  sameScopeSelection,
  type ScopeSelection
} from '../../../../shared/scopeSelection'

/**
 * The three bridge members this needs. Both preloads satisfy it structurally, so neither bundle has
 * to adapt anything — `useScopeSelection(window.eq)` and `useScopeSelection(window.eqOverlay)` are
 * the two call sites.
 */
export interface ScopeSelectionBridge {
  getScopeSelection: () => Promise<ScopeSelection>
  setScopeSelection: (patch: Partial<ScopeSelection>) => void
  onScopeSelection: (cb: (s: ScopeSelection) => void) => () => void
}

/** The window's one copy. Starts on the OPENING, so the first frame — before the hydrate lands —
 *  is already the read the owner ruled for rather than a flicker through the old default. */
let selection: ScopeSelection = SCOPE_SELECTION_OPENING
let version = 0
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getVersion(): number {
  return version
}

function emit(): void {
  version++
  for (const cb of [...listeners]) cb()
}

/**
 * Take a value from somewhere else (the hydrate, or main's broadcast) — rebuilt, never trusted, and
 * silent when it changes nothing. The equality check is what makes main's echo of this window's own
 * optimistic write cost zero renders.
 */
function adopt(raw: unknown): void {
  const next = normalizeScopeSelection(raw)
  if (sameScopeSelection(next, selection)) return
  selection = next
  emit()
}

/** THE WIRE, AT MOST ONCE PER BRIDGE. Every consumer calls the hook, so the effect below runs many
 *  times; the subscription must not. Keyed on the bridge object because an HMR reload hands over a
 *  new one and the old listener is then attached to a dead preload. */
let wiredTo: ScopeSelectionBridge | null = null
let unwire: (() => void) | null = null

function wire(bridge: ScopeSelectionBridge): void {
  if (wiredTo === bridge) return
  unwire?.()
  wiredTo = bridge
  // HYDRATE THEN SUBSCRIBE: a window that opened after the last flip (a freshly spawned overlay)
  // must not sit on the opening while the tab shows something else, so it asks once and then rides
  // the broadcast. A rejection is not an error state — it is a window whose preload is not there
  // yet, and the opening is the honest thing to show meanwhile.
  void bridge.getScopeSelection().then(adopt, () => undefined)
  const off = bridge.onScopeSelection(adopt)
  unwire = off
}

/** Back to the opening, and forget the wire. Exported for tests, exactly like `resetTimeslice`. */
export function resetScopeSelection(): void {
  unwire?.()
  unwire = null
  wiredTo = null
  selection = SCOPE_SELECTION_OPENING
  emit()
}

export interface ScopeSelectionState extends ScopeSelection {
  /** Move the membership. The hour does not move with it — the wire carries PARTIALS. */
  setZoneScope: (next: ZoneScope) => void
  /** Move the denominator. Same rule, other half. */
  setBasis: (next: RateBasis) => void
}

/**
 * The membership and the hour in force in THIS app, and the two setters every control calls.
 *
 * `bridge` is optional because an HMR reload can render a frame before the preload has re-run. With
 * no bridge the hook is a local-only store on the opening — the surface renders the right default
 * and the flip still moves this window, which is the same honest degradation `useGlobalFight` takes.
 */
export function useScopeSelection(bridge: ScopeSelectionBridge | undefined): ScopeSelectionState {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  useEffect(() => {
    if (bridge) wire(bridge)
  }, [bridge])

  // OPTIMISTIC, THEN AUTHORITATIVE: the local store moves this frame so the button never lags its
  // own click, and main echoes the same value back to every window including this one — where
  // `adopt`'s equality check makes it free.
  const patch = useCallback(
    (p: Partial<ScopeSelection>): void => {
      adopt({ ...selection, ...p })
      bridge?.setScopeSelection(p)
    },
    [bridge]
  )
  const setZoneScope = useCallback((next: ZoneScope) => { patch({ zoneScope: next }) }, [patch])
  const setBasis = useCallback((next: RateBasis) => { patch({ basis: next }) }, [patch])

  return { ...selection, setZoneScope, setBasis }
}
