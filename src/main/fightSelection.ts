// GLOBAL FIGHT SELECTION — main's copy of the one selected fight, and the fan-out that keeps
// every window agreeing about it (docs/plans/combat-overlay-parity.md P4).
//
// WHY MAIN OWNS IT. The Combat tab and the fight overlays are separate RENDERER PROCESSES with
// no shared memory; the only thing they all already talk to is main. So the selection lives
// here — a single `let`, one setter, one broadcast — rather than in a renderer that the others
// would have to discover and subscribe to.
//
// EPHEMERAL BY DESIGN. Module scope, no electron-store, no migration: it resets to the sentinel
// on every launch (see the shared model's header for why). That is also why this file has no
// store import at all — there is nothing here to persist and nothing to migrate.
//
// IT NEVER TOUCHES SCOPE (P5). This module knows one string. A surface's Fight-vs-Overall scope
// is that surface's own explicit, persisted choice and no code path here can move it.

import { IPC } from '../shared/ipc'
import { LIVE_FIGHT, normalizeFightSelection } from '../shared/fightSelection'
import { OVERLAY_KINDS } from '../shared/types'
import { getMainWindow, getOverlayWindow } from './windows'

/** The whole state. Resets to the sentinel at process start — see the header. */
let fightId: string = LIVE_FIGHT

/** The current selection. Every fight-scoped surface hydrates from this on mount. */
export function getFightSelection(): string {
  return fightId
}

/**
 * Apply a renderer's pick. The argument is UNTRUSTED (it arrives on an ipcMain channel) and is
 * shape-checked by the shared normalizer; anything that is not a fight selection — a
 * zone-session id, a number, a hand-crafted string — is dropped without touching the state or
 * telling anyone. Returns whatever the selection is AFTER the call, so a rejected write reads
 * as "no change" rather than as an error the caller has to handle.
 *
 * A no-op write (picking the fight that is already selected) broadcasts nothing: a surface that
 * re-picks its own current row must not make every other surface re-render.
 */
export function setFightSelection(next: unknown): string {
  const id = normalizeFightSelection(next)
  if (id === null || id === fightId) return fightId
  fightId = id
  broadcastFightSelection()
  return fightId
}

/**
 * Tell every window. The MAIN window and all six overlay kinds get the same payload on the same
 * channel — a surface that is not fight-scoped simply has no listener, which is cheaper and far
 * harder to get wrong than maintaining a subscriber registry of which windows care today.
 */
function broadcastFightSelection(): void {
  const payload = { fightId }
  const targets = [getMainWindow(), ...OVERLAY_KINDS.map((k) => getOverlayWindow(k))]
  for (const w of targets) {
    if (w && !w.isDestroyed()) w.webContents.send(IPC.onFightSelection, payload)
  }
}
