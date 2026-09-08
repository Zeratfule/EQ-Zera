// APP-WIDE SCOPE SELECTION — main's copy of "which tiers, and per hour of what", and the fan-out
// that keeps every window agreeing about it (JOS-332).
//
// WHY MAIN OWNS IT. The Leveling tab and the XP overlay are separate RENDERER PROCESSES with no
// shared memory; the only thing they both already talk to is main. So the selection lives here — a
// single value, one setter, one broadcast — rather than in a renderer the other would have to
// discover and subscribe to. It is `fightSelection.ts` beside this file, one fact over, and it is
// deliberately the same shape down to the member names: a second pattern for the same problem is
// how two windows end up disagreeing again in a year.
//
// EPHEMERAL BY DESIGN. Module scope, no electron-store, no migration: it resets to the OPENING on
// every launch (shared/scopeSelection.ts states the argument — both halves were session-lifetime in
// the app already, and the opening is now the read the owner ruled for, so there is nothing left
// worth remembering across a launch). That is also why this file has no store import at all.
//
// IT NEVER TOUCHES THE SLICE. This module knows two enum values. WHICH STRETCH of play a surface is
// looking at is `shared/timeslice.ts`'s question, kept per surface (the tab's app-wide pick, the
// overlay's own persisted `xpSlice`), and no code path here can move it.

import { IPC } from '../shared/ipc'
import {
  SCOPE_SELECTION_OPENING,
  applyScopePatch,
  sameScopeSelection,
  type ScopeSelection
} from '../shared/scopeSelection'
import { OVERLAY_KINDS } from '../shared/types'
import { getMainWindow, getOverlayWindow } from './windows'

/** The whole state. Resets to the opening at process start — see the header. */
let selection: ScopeSelection = SCOPE_SELECTION_OPENING

/** The current selection. Every scoped surface hydrates from this on mount. */
export function getScopeSelection(): ScopeSelection {
  return selection
}

/**
 * Apply a renderer's flip. The argument is UNTRUSTED (it arrives on an ipcMain channel) and is
 * rebuilt by the shared normalizer; a half this build cannot name is dropped without touching the
 * state or telling anyone, and a PARTIAL leaves the other half exactly where it was — which is the
 * whole reason the wire carries patches and not selections.
 *
 * A no-op write (pressing the membership already in force — MUI's toggle groups do exactly that)
 * broadcasts nothing: a control re-asserting its own state must not make every other surface in
 * every other window re-render.
 */
export function setScopeSelection(patch: unknown): ScopeSelection {
  const next = applyScopePatch(selection, patch)
  if (sameScopeSelection(next, selection)) return selection
  selection = next
  broadcastScopeSelection()
  return selection
}

/** Back to the opening. Exported for the same reason `resetTimeslice` is — nothing in the app
 *  calls it today, and a test that moves the selection must be able to put it back. */
export function resetScopeSelection(): void {
  selection = SCOPE_SELECTION_OPENING
}

/**
 * Tell every window. The MAIN window and all overlay kinds get the same payload on the same
 * channel — a window with no scoped surface simply has no listener, which is cheaper and far
 * harder to get wrong than maintaining a registry of which windows care today.
 */
function broadcastScopeSelection(): void {
  const targets = [getMainWindow(), ...OVERLAY_KINDS.map((k) => getOverlayWindow(k))]
  for (const w of targets) {
    if (w && !w.isDestroyed()) w.webContents.send(IPC.onScopeSelection, selection)
  }
}
