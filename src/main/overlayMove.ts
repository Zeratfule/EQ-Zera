// ============================================================================
// overlayMove — MOVING A STRIP IS A BUTTON, NOT A SWITCH (2026-09-10).
// ============================================================================
//
// THE REPORT: "We need a way to move the celebration overlays" (owner). There already was one. The
// three strips - the celebration toast, the alert banner and the con card - have carried a "Move
// it" switch in Preferences, Overlays since JOS-378, and unlocking one paints a dashed frame you
// drag. The owner could not find it, and every reason is a design fault rather than a missing
// feature:
//
//   * A LOCKED STRIP IS AN INVISIBLE, CLICK-THROUGH WINDOW. There is nothing on screen to discover,
//     so the control in Preferences is the whole feature, and it was labelled like a preference.
//   * A SWITCH DESCRIBES A STATE; THIS IS AN ACTION. "Move it: off" reads as a setting somebody
//     might want left alone, not as "press here and drag the thing".
//   * THERE WAS NO WAY BACK. A strip dragged onto a monitor that is now unplugged, or parked
//     somewhere unusable, had no shipped position to return to short of editing the store.
//   * AND NO WAY TO SEE WHERE A CARD WOULD LAND. You positioned an empty rectangle and then waited
//     for a raid target to die to find out whether you had put it somewhere sensible.
//
// So this module is the three verbs Preferences now offers per strip, and every one of them is here
// rather than in the renderer for the same reason: THE RENDERER NEVER COMPUTES A RECTANGLE. The
// default position is `overlayLayout.ts`'s, what reaches a window is `overlayBounds.ts`'s, and what
// a sample card says is `shared/overlayPreview.ts`'s. This file owns the WINDOW half and no policy.
//
// ITS OWN MODULE because windows.ts is AT the repo's 400-code-line ceiling and none of this is
// about Electron's window factory - the same split, and the same argument, as overlayBounds.ts and
// OVERLAY_TITLE before it.
//
// WHAT IS DELIBERATELY NOT HERE: a new store shape. Positions still live in `overlays.<kind>.bounds`
// exactly as they always have, so there is nothing to migrate and a user who has already placed a
// strip keeps it.

import { ipcMain, type Rectangle } from 'electron'
import { IPC } from '../shared/ipc'
import { E2E } from './e2e'
import { logError } from './errorLog'
import { isStripKind } from './overlayLayout'
import { applyOverlayBounds, overlayAppliedBounds } from './overlayBounds'
import { overlayFittedBounds } from './windowPlacement'
import { setOverlayConfig } from './store'
import { assertTopmost, raiseTopmost } from './topmost'
import {
  applyOverlayLocked,
  getCursorRingWindow,
  getOverlayWindow,
  isOverlayOpen,
  setOverlayOpen
} from './windows'
import {
  previewBannerPayload,
  previewConCardPayload,
  previewToastPayload
} from '../shared/overlayPreview'
import type { OverlayKind } from '../shared/types'

/**
 * THE STRIPS THIS PRESS OPENED FOR THE USER, so Done can put them back.
 *
 * Pressing Move on a strip that is switched OFF has to show it - positioning a window you cannot
 * see is not positioning - and the honest way to do that is to OPEN it, through the one door that
 * opens an overlay (`setOverlayOpen`), so every surface that reflects an overlay's open-state says
 * the same thing while the frame is up. Done closes it again. A set rather than a flag per kind
 * because all three can be in this state at once.
 *
 * IT IS SESSION STATE AND NOT A SETTING. If the app goes away mid-positioning the strip is simply
 * left on, which is a visible, correctable state rather than a silent one.
 */
const openedForMove = new Set<OverlayKind>()

/** Bring a kind's window to the front of the always-on-top band, once. */
function raiseOverlay(kind: OverlayKind): void {
  const w = getOverlayWindow(kind)
  if (!w || w.isDestroyed()) return
  // E2E never shows a window (src/main/e2e.ts) - an always-on-top window over a test run is the
  // one thing that mode exists to prevent, and the frame is asserted in the DOM either way.
  if (!E2E && !w.isVisible()) w.showInactive()
  assertTopmost(w)
  // …and the ring keeps its claim to being the most recent assertion in the shared level, exactly
  // as it does after every other overlay show (windows.ts).
  const ring = getCursorRingWindow()
  if (ring && !ring.isDestroyed() && ring.isVisible()) raiseTopmost(ring)
}

/** Write a kind's lock, apply it to the live window, and tell that window - the `overlay:setLocked`
 *  handler's three lines, reached from here as well because Move owns the lock now. */
function applyLock(kind: OverlayKind, locked: boolean): void {
  const next = setOverlayConfig(kind, { locked })
  applyOverlayLocked(kind, locked)
  getOverlayWindow(kind)?.webContents.send(IPC.onOverlayConfig, { kind, config: next })
}

/**
 * BEGIN or END positioning a strip.
 *
 * Beginning: unlock FIRST (so a window opened a line later comes up already wearing its frame
 * rather than painting locked and correcting itself), open the window if the strip is off, put it
 * back on a display that exists, and raise it over the game.
 *
 * Ending: lock it, and close whatever this press opened.
 *
 * STRIPS ONLY. The ten meters are visible windows with their own chrome and their own pin button;
 * there is nothing here they need, and refusing the kind keeps this door as narrow as its purpose.
 */
export function setOverlayMoving(kind: OverlayKind, moving: boolean): void {
  if (!isStripKind(kind)) return
  if (moving) {
    applyLock(kind, false)
    if (!isOverlayOpen(kind)) {
      openedForMove.add(kind)
      setOverlayOpen(kind, true)
    }
    // THE FRAME HAS TO BE ON SCREEN TO BE DRAGGED. A rectangle remembered from a monitor that is
    // gone is exactly the state somebody presses this button in, so the window is re-placed through
    // the same fit every open goes through rather than left wherever the store says.
    const b = overlayAppliedBounds(kind)
    if (b) applyOverlayBounds(kind, b)
    raiseOverlay(kind)
    return
  }
  applyLock(kind, true)
  endMoveIfOpened(kind)
}

/**
 * CLOSE A STRIP THIS FEATURE OPENED, if it opened one — the other Done.
 *
 * There are TWO Done buttons by design (the frame carries one so you can finish in the window you
 * are dragging, and Preferences carries its mirror so the two halves are not in different places
 * any more), and only one of them comes through `setOverlayMoving`. The frame's goes down the
 * ordinary `overlay:setLocked` path, which knows nothing about this module — so that handler calls
 * this on its way past, and a strip that was switched OFF is put back whichever Done was pressed.
 *
 * A no-op for every other case, which is nearly all of them: pinning a meter, locking a strip the
 * user has switched on, or any lock at all on a kind this module never opened.
 */
export function endMoveIfOpened(kind: OverlayKind): void {
  if (!openedForMove.delete(kind)) return
  setOverlayOpen(kind, false)
}

/**
 * PUT A STRIP BACK WHERE IT SHIPPED, and answer where that was.
 *
 * The default is `overlayLayout.ts`'s `defaultOverlayBounds` for this kind on the primary work area
 * - reached through `overlayFittedBounds(kind, undefined)`, which is the one function that already
 * spells "no stored rectangle means the shipped one" and clamps it. The store then holds that
 * exactly as it holds a drag (it is a LAYOUT BOX for a strip, JOS-406), and the live window is moved
 * through `applyOverlayBounds` so the move is marked as OURS and is not written back as a drag.
 *
 * `null` on a machine with no display information at all, which is the same "we cannot know, so
 * change nothing" every other placement gives - never an invented rectangle. And `null` for a kind
 * that is not a strip: `kind` arrives from a renderer and is checked here rather than trusted,
 * which is also what keeps an unknown string from becoming a key in `overlays`.
 */
export function resetOverlayBounds(kind: OverlayKind): Rectangle | null {
  if (!isStripKind(kind)) return null
  const bounds = overlayFittedBounds(kind, undefined)
  if (!bounds) return null
  setOverlayConfig(kind, { bounds })
  // What reaches the SCREEN is that box grown to the text size the strip is drawing at (JOS-406),
  // which is `overlayAppliedBounds`' job and not this one's.
  const applied = overlayAppliedBounds(kind) ?? bounds
  applyOverlayBounds(kind, applied)
  return applied
}

/**
 * Push a finished preview payload at a strip's window.
 *
 * A window still loading its page would silently drop the send - the toast learned this first, and
 * pressing Preview moments after Move opened the window is exactly that case.
 */
function sendToStrip(kind: OverlayKind, channel: string, payload: unknown): void {
  const w = getOverlayWindow(kind)
  if (!w || w.isDestroyed()) return
  const wc = w.webContents
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(channel, payload))
  else wc.send(channel, payload)
}

/**
 * SHOW THIS STRIP'S SAMPLE, so the user can see where a real one will land.
 *
 * IT BYPASSES THE PRODUCER PATH BY CONSTRUCTION, exactly as the updater's card does: the payload is
 * built in main from a pure module with no input at all (shared/overlayPreview.ts), so there is
 * nothing to validate and nothing a renderer could smuggle. `showToast` / `showAlertBanner` are the
 * doors for things that HAPPENED - they gate on the overlay being switched on and they exist to
 * relay events - and a preview is not an event: nothing is written to any history, ledger or count
 * on either side of this call.
 *
 * IT WORKS LOCKED OR UNLOCKED. The strips render their cards the same way in both modes; the lock
 * decides who gets the mouse, not what is drawn.
 */
export function previewOverlay(kind: OverlayKind): void {
  const now = Date.now()
  if (kind === 'toast') sendToStrip(kind, IPC.onToast, previewToastPayload())
  else if (kind === 'alertBanner') sendToStrip(kind, IPC.onAlertBanner, previewBannerPayload(now))
  else if (kind === 'conCard') sendToStrip(kind, IPC.onConCard, previewConCardPayload(now))
}

export function registerOverlayMoveIpc(): void {
  // `moving` is typed `unknown` and coerced here rather than trusted, the posture every renderer
  // input on this boundary takes: anything that is not a literal true ends the positioning, which is
  // the safe answer (a strip left unlocked is a window eating the mouse over a running game).
  ipcMain.on(IPC.overlayMove, (_e, kind: OverlayKind, moving: unknown) => {
    try {
      setOverlayMoving(kind, moving === true)
    } catch (err: unknown) {
      logError('main:overlayMove', err)
    }
  })
  ipcMain.handle(IPC.overlayResetBounds, (_e, kind: OverlayKind) => resetOverlayBounds(kind))
  ipcMain.on(IPC.overlayPreview, (_e, kind: OverlayKind) => {
    try {
      previewOverlay(kind)
    } catch (err: unknown) {
      logError('main:overlayPreview', err)
    }
  })
}
