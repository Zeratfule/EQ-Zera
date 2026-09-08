// ============================================================================
// overlaySnapDrag — the Electron half of overlay snapping (JOS-217).
// ============================================================================
//
// `shared/overlaySnap.ts` is the pure geometry (read its header for the design and for what this
// deliberately does not do). This file is the part that has to talk to Electron: it hooks the one
// event a native drag exposes, gathers the rectangles that are on screen right now, and puts the
// window where the geometry says.
//
// THE SEAM IS `will-move`, AND THERE IS NO OTHER ONE. An overlay's title bar is a
// `-webkit-app-region: drag` element (renderer/src/overlay/OverlayHeader.tsx), so the drag is run
// by the WINDOW MANAGER — the renderer never sees a mousemove and has no position to correct.
// `will-move` is Electron's Windows hook into exactly that loop: it fires with the rectangle the
// OS is about to apply, and `preventDefault()` cancels it. So the mechanism is "veto the move the
// OS wanted, apply the one we want". windowPlacement.ts's header predicted this landing spot
// ("and, for a snap, on the user's own move").
//
// …AND THE RECTANGLE IT HANDS US IS NOT THE POINTER (JOS-359). The first build read `will-move`'s
// bounds as the hand's own position; they are not. The Windows move loop keeps a DRAG RECTANGLE
// and offsets it by each mouse message, and the rectangle the app leaves behind is the one it
// keeps — so once we answer a proposal with a snapped rectangle, the loop's baseline IS the snap
// and the hand's travel since is gone. That is why a snapped overlay could not be pulled free, and
// it is why the virtual position is NOT recoverable from the event: the accumulation lives in
// `snapDrag` (shared/overlaySnap.ts), and this file's job is to feed it the two rectangles it
// needs — the proposal, and where the window actually is right now.
//
// OFF MEANS NOTHING RUNS. The listener is installed unconditionally, because a preference that can
// be toggled while an overlay is open must not need the window re-created — but its first line is
// the store read, and with snapping off it returns before touching a rectangle, a display or the
// geometry. That is the owner's "zero behavior change unless enabled" as a single early return.
// HELD (SNAP_RELEASE_HOLD), the listener is not installed at all — see the constant's own comment.
//
// A SNAPPED POSITION IS THE USER'S OWN POSITION, so it is deliberately NOT declared through
// windows.ts's `appliedBounds` marker (JOS-187). That marker exists to stop the app's own
// keep-on-screen corrections overwriting the rectangle somebody chose; this move IS the rectangle
// they chose, only tidied, and it must persist exactly like an unsnapped drag does.
//
// RE-ENTRANCY IS GUARDED, not assumed away. `setBounds` can itself provoke a `will-move` on
// Windows, and a listener that answered its own write would be a feedback loop in the message loop
// the user's cursor is waiting on. The flag is set for the duration of the one synchronous call.
//
// THE REGISTRY IS LENT, NOT IMPORTED. windows.ts owns every BrowserWindow handle in this process
// and that stays true — it passes them in. The alternative (importing `getOverlayWindow` back out
// of windows.ts) would make the two files circular for no gain.

import type { BrowserWindow, Rectangle } from 'electron'
import { snapDrag, SNAP_RELEASE_HOLD, type SnapDragSession } from '../shared/overlaySnap'
import { getOverlaySnap } from './storeOverlaySnap'
import { displayWorkAreas } from './windowPlacement'
import { OVERLAY_KINDS, type OverlayKind } from '../shared/types'

/** The overlay handles, as windows.ts keeps them: one slot per kind, null while that kind is closed. */
export type OverlayRegistry = Readonly<Record<OverlayKind, BrowserWindow | null>>

/**
 * Can this window be lined up against? It has to EXIST and be VISIBLE — an auto-hidden overlay
 * (presence.ts hides them while EverQuest is closed) is still a live BrowserWindow with perfectly
 * good bounds, and snapping to a rectangle the user cannot see is a window that jumps for no
 * reason anybody watching could explain.
 */
function usable(w: BrowserWindow | null): w is BrowserWindow {
  return w !== null && !w.isDestroyed() && w.isVisible() && !w.isMinimized()
}

/** Every window of ours that is on screen right now, except the one being dragged. */
function neighbours(kind: OverlayKind, overlays: OverlayRegistry, mainWindow: () => BrowserWindow | null): Rectangle[] {
  const out: Rectangle[] = []
  for (const k of OVERLAY_KINDS) {
    if (k === kind) continue
    const w = overlays[k]
    if (usable(w)) out.push(w.getBounds())
  }
  // The main Companion window is a snap target too — the second report asked for it by name
  // ("snapping overlays to the side of the MAIN window as well"), and from the geometry's point of
  // view it is simply one more rectangle.
  const main = mainWindow()
  if (usable(main)) out.push(main.getBounds())
  return out
}

/**
 * Give one overlay window its magnetism.
 *
 * Called once per window, at creation, from windows.ts. Four arguments because the registry and
 * the main-window getter are LENT by that module (see the header) — the alternative is a circular
 * import between the two files.
 */
export function installOverlaySnap(
  w: BrowserWindow,
  kind: OverlayKind,
  overlays: OverlayRegistry,
  mainWindow: () => BrowserWindow | null
): void {
  // The release hold, at the only place it can be absolute: no listener, no store read, no chance
  // that a stored `enabled: true` reaches a drag by some path the normalizer does not cover.
  if (SNAP_RELEASE_HOLD) return
  let applying = false
  // The drag's own memory (see `snapDrag`). Null between drags, and re-anchored by that function
  // whenever the window turns out not to be where we left it.
  let session: SnapDragSession | null = null
  w.on('will-move', (event, newBounds) => {
    if (applying || !getOverlaySnap().enabled) {
      session = null
      return
    }
    const step = snapDrag(session, {
      proposal: newBounds,
      // Where the window is BEFORE this proposal is applied — the rectangle the OS offset to
      // reach `newBounds`, and the only way to recover how far the mouse actually travelled.
      current: w.getBounds(),
      targets: { windows: neighbours(kind, overlays, mainWindow), screens: displayWorkAreas() },
      now: Date.now()
    })
    session = step.session
    if (step.apply === null) return
    event.preventDefault()
    applying = true
    try {
      w.setBounds(step.apply)
    } finally {
      applying = false
    }
  })
}
