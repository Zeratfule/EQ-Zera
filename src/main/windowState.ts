// ============================================================================
// windowState — what the MAIN window remembers about itself, and when that is written (JOS-248).
// ============================================================================
//
// "Can the app save window size" (report 01KZSYHKZDERT9P4YAFJN4N3QP, v0.22.0). It half could: a
// rectangle was persisted under `windowBounds` and re-applied at creation, but three things were
// missing and each of them is a state the user expressed and the app forgot.
//
//   1. MAXIMIZED WAS NOT REMEMBERED — and worse, it was the one state that was actively DROPPED.
//      The old saver skipped the write while `isMaximized()`, which is right about the RECTANGLE
//      (a maximized window's bounds are the screen, and restoring to them next launch would leave
//      a window that looks maximized, isn't, and cannot be un-maximized back to anything the user
//      chose) and wrong about the fact. So a user who works maximized — which the frameless title
//      bar's double-click makes a one-gesture habit (JOS-204) — re-maximized the window on every
//      single launch. Both halves are now kept, because Electron already separates them:
//      `getNormalBounds()` IS the rectangle a restore would return to, at any moment, whatever the
//      window is doing. There is nothing to reconstruct and no second copy to keep in step.
//   2. THE WRITE WAS UNDEBOUNCED. `moved`/`resized` are end-of-gesture events on Windows, so this
//      was cheap in practice — but it is a synchronous JSON write to disk on an event the window
//      manager owns the frequency of, and a platform that emits them continuously (or a future
//      `resize`-driven caller) turns a drag into a write storm. A trailing debounce says the same
//      thing once.
//   3. NOTHING WAS WRITTEN ON QUIT. `close` was covered; `app.quit()` — the auto-updater's
//      `quitAndInstall`, an OS logoff — is NOT a window close, and Electron does not emit
//      `window-all-closed` on that path (appWindow.mts measured that for the e2e harness). So the
//      launch right after an update came up at whatever the last drag happened to have flushed.
//
// PURE ON PURPOSE, like `displayFit.ts` beside it: nothing here imports Electron. The window is
// taken as the four methods this file actually calls, so tests/windowState.test.mts can describe a
// maximized window, a minimized one and a destroyed one in a few lines — and the debounce is armed
// through an injected timer, so its test asserts the COALESCING rather than waiting on a clock
// (AGENTS.md: a main-process setTimeout snaps to the 15.6 ms tick grid, so a timing-based test of a
// debounce would be measuring Windows).
//
// AND THE PLACEMENT THE APP MAKES IS NOT ALWAYS THE PLACEMENT IT GETS (JOS-187, on a display
// whose scale factor is not a whole number). `setBounds` and the BrowserWindow CONSTRUCTOR both
// round a DIP rectangle through physical pixels, and on a fractional scale factor the value that
// comes back is a pixel or four LARGER than the one that was asked for. Chromium then reports that
// as `resized`/`moved` — indistinguishable, at the listener, from the user pulling a corner. The
// saver wrote it down, so the store stopped holding the rectangle the user chose: every launch
// stored the rectangle the PREVIOUS launch was granted (measured: 1040x720 chosen, 1041x721 shown,
// 1045x725 the launch after that) and the clamp for a monitor that went away was written down as
// if the user had asked for it. That is the JOS-187 promise breaking on 125%/150%/225% scaling,
// which is most Windows laptops. The applied-bounds marker below is what answers it, and the shape
// of its envelope (`placementEnvelope`) is the whole fix: it must be wide enough to cover the
// rounding a placement of ours drags behind it on the display it lands on, and no wider.
//
// WHAT IS NOT HERE. Where the remembered rectangle may go on the screens that exist NOW is
// `displayFit.ts` + `windowPlacement.ts` (JOS-187), unchanged and shared with the overlays; this
// file never decides placement. The one policy the two share is stated at `sameWindowState`'s call
// site in windows.ts: THE STORE KEEPS THE RECTANGLE THE USER CHOSE, and the screen gets the one
// that fits.

import type { Rect } from './displayFit'

/**
 * The persisted main-window state: the rectangle a restore returns to, plus whether the window was
 * maximized over it.
 *
 * `x`/`y`/`width`/`height` are ALWAYS the NORMAL bounds — never the maximized screen rectangle —
 * so the two fields are independent and a restore can apply them in either order. `maximized` is
 * absent rather than `false` when the window was ordinary: absent is what every store written
 * before JOS-248 says, and giving it the same meaning means no migration.
 *
 * The name is unchanged (`WindowBounds`, store key `windowBounds`) because the store key is
 * unchanged — this is the same setting, told the rest of what it knew.
 */
export interface WindowBounds extends Rect {
  maximized?: boolean
}

/**
 * THE SIZE A FRESH INSTALL GETS, and the exact size it got before this ticket. Named here so the
 * "absent stored bounds = today's default" requirement is a value a test can hold, rather than a
 * literal in a BrowserWindow options object that nothing can see. No POSITION: a first launch is
 * placed by the OS, exactly as it always was (windowPlacement.ts `mainWindowBounds` returns
 * `undefined` in, `undefined` out for the same reason).
 */
export const DEFAULT_MAIN_WINDOW_SIZE = { width: 1280, height: 860 } as const

/** How long the window has to hold still before its new geometry is written down. */
export const SAVE_DEBOUNCE_MS = 400

/** A finite number as a whole pixel, or null for anything that is not one. */
function pixel(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

/**
 * A stored (or freshly measured) window state, validated — or `undefined` when it is not one.
 *
 * The repo's store discipline: read through the normalizer, write through the SAME normalizer, so
 * a hand-edited file, an older build and a future migration cannot end up with three ideas of what
 * this setting is. `undefined` out means "no remembered state", which the caller already knows how
 * to answer (the default size above).
 *
 * A zero or negative extent is refused rather than clamped: it is not a window anybody chose, and
 * `fitToDisplays` would refuse it a moment later anyway. Position is NOT range-checked here — an
 * x of 9000 is a perfectly valid memory of a monitor that is currently unplugged, and deciding
 * what to do about that is the placement layer's job, not this one's.
 */
export function normalizeWindowState(raw: unknown): WindowBounds | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const x = pixel(r.x)
  const y = pixel(r.y)
  const width = pixel(r.width)
  const height = pixel(r.height)
  if (x === null || y === null || width === null || height === null) return undefined
  if (width <= 0 || height <= 0) return undefined
  return r.maximized === true ? { x, y, width, height, maximized: true } : { x, y, width, height }
}

/** The four things this module asks a BrowserWindow — Electron's shape, narrowed to what is used. */
export interface WindowLike {
  isDestroyed(): boolean
  isMinimized(): boolean
  isMaximized(): boolean
  /** The rectangle a restore returns to: the normal bounds, whatever the window is doing now. */
  getNormalBounds(): Rect
}

/**
 * What `w` would like to be remembered as, or `null` when the answer is "not this".
 *
 * A MINIMIZED window says nothing. Not because its normal bounds are wrong (they are fine) but
 * because minimizing is not a placement: the state that matters was already captured when the user
 * put the window where it is, and a launch that restores a window to the taskbar would be
 * answering a question nobody asked. A DESTROYED window says nothing for the obvious reason — and
 * saying so here rather than at each call site is why the teardown paths can call this blind.
 */
export function windowStateOf(w: WindowLike): WindowBounds | null {
  if (w.isDestroyed() || w.isMinimized()) return null
  return normalizeWindowState({ ...w.getNormalBounds(), maximized: w.isMaximized() }) ?? null
}

/**
 * Do two states describe the same window position, to within `slackPx`?
 *
 * This is the debounced saver's EXACT question (slack 0): "is there anything new to write". The
 * applied-bounds marker asks a different one — "is the window still where WE put it, give or take
 * the display's rounding" — and that one is `withinPlacementEnvelope`, because the rounding is
 * lopsided (a placement comes back up to eight DIP LARGER, measured; it was never seen smaller or
 * moved) and one symmetric slack cannot say so.
 *
 * `maximized` is compared as a FACT, never with slack: it is the half of the state that a
 * rectangle comparison cannot see, and it is exactly the transition (maximize a window without
 * moving it) that a rectangle-only check would silently drop.
 */
export function sameWindowState(
  a: WindowBounds | null,
  b: WindowBounds | null,
  slackPx = 0
): boolean {
  if (!a || !b) return false
  if ((a.maximized === true) !== (b.maximized === true)) return false
  return (['x', 'y', 'width', 'height'] as const).every((k) => Math.abs(a[k] - b[k]) <= slackPx)
}

/** Cancel a pending fire. Returned by `ArmTimer` so the saver never handles a platform handle. */
export type CancelTimer = () => void
/** Start (or restart) the debounce. Injected so the test can fire it rather than wait for it. */
export type ArmTimer = (fire: () => void, delayMs: number) => CancelTimer

/**
 * The default arm: an UNREF'D `setTimeout`. Unref'd because a pending write must never be the
 * reason this process stays alive — the two paths that matter (the window's `close`, and
 * `before-quit`) flush synchronously, so there is nothing for a live timer to protect.
 */
const armWithTimeout: ArmTimer = (fire, delayMs) => {
  const t = setTimeout(fire, delayMs)
  t.unref()
  return () => {
    clearTimeout(t)
  }
}

/**
 * THE DPI-ROUNDING ENVELOPE: how far a window may be from where we PUT it and still be counted as
 * sitting exactly there. One-sided, and DERIVED FROM THE SCALE FACTOR OF THE DISPLAY IT LANDS ON.
 *
 * A fixed four pixels was the second answer (one was the first), sized from a handful of
 * placements on one display, and it was already too narrow. MEASURED with Electron 43.8.12 (43.2.0
 * differs only in where the worst cases fall): the main window's own shape — frameless, 900x600
 * minimum — constructed ~1,500 times per scale across six sizes and a grid of positions, with
 * `--force-device-scale-factor` standing in for the displays this machine does not have (forced
 * 2.25 reproduces the owner's real 2.25 display exactly). WORST GROWTH of width or height, in DIP:
 *
 *   1.0 -> 0    1.25 -> 8    1.5 -> 5    1.75 -> 7    2.0 -> 1
 *   2.25 -> 8   2.5  -> 4    2.75 -> 7   3.0  -> 0
 *
 * In every one of ~13,000 placements the POSITION came back exact and the size never came back
 * SMALLER. So the error is not proportional to the scale factor (3.0 is as exact as 1.0); it
 * follows the factor's fractional STEP — whole, half or quarter — which is what `scaleStep` reads.
 * The envelope is therefore:
 *
 *   grow   min(ROUNDING_GROWTH_CAP_PX, 2*step + 3):  whole 5 · half 7 · quarter (and unknown) 9
 *   shrink 4   (KEPT at the previous fixed envelope, deliberately not narrowed)
 *   move   4   (KEPT at the previous fixed envelope, deliberately not narrowed)
 *
 * Shrink and move were never seen above zero, but every measurement above is ONE uniform display
 * (real or forced) with its origin at 0,0. A mixed-DPI secondary monitor with a non-zero origin —
 * where an origin conversion is the likeliest thing to round — was not measured, so those two
 * stay at the four DIP that is known to work there rather than at a number nobody has tested.
 * Only GROWTH, the axis that was measured, is sized from the measurement.
 *
 * THE BOUNDARY, stated exactly because it is the user's half of the bargain: at EVERY scale
 * factor, a gesture that grows the window by 10 DIP or more on either axis, shrinks it by 5 or
 * more, or moves it by 5 or more is the USER'S, and is recorded. Smaller ones are absorbed while
 * the marker stands: from the app's placement UNTIL A REPORT LEAVES THE ENVELOPE — any number of
 * in-envelope reports, and the close flush, are all treated as the app's own placement — and the
 * marker is dropped the moment anything outside the envelope arrives. The cap is what holds the
 * 10-DIP promise on a display whose step was not measured (Windows' custom scaling, say 110%),
 * where the envelope is the widest one rather than a guess. Pinned: tests/windowState.test.mts.
 */
export interface PlacementEnvelope {
  /** Largest growth of width or height, in DIP, that still counts as our own placement. */
  readonly grow: number
  /** Largest SHRINK of width or height that still counts (never measured above 0; kept at 4). */
  readonly shrink: number
  /** Largest move of x or y that still counts (never measured above 0; kept at 4). */
  readonly move: number
}

/** No rounding growth above this is ever absorbed — the "a 10-DIP resize is always the user's" line. */
export const ROUNDING_GROWTH_CAP_PX = 9

/**
 * The scale factor's rounding STEP: 1 for a whole factor, 2 for a half, 4 for a quarter — the
 * smallest `d` with `scaleFactor * d` whole. `null` when there is no usable factor or it is off the
 * quarter grid (Windows' custom scaling), which the envelope reads as "widest".
 */
export function scaleStep(scaleFactor: number | null | undefined): 1 | 2 | 4 | null {
  if (typeof scaleFactor !== 'number' || !Number.isFinite(scaleFactor) || scaleFactor <= 0) return null
  for (const d of [1, 2, 4] as const) {
    const scaled = scaleFactor * d
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return d
  }
  return null
}

/** The envelope for a placement on a display with this scale factor. See the table above. */
export function placementEnvelope(scaleFactor: number | null | undefined): PlacementEnvelope {
  const step = scaleStep(scaleFactor)
  const grow = step === null ? ROUNDING_GROWTH_CAP_PX : Math.min(ROUNDING_GROWTH_CAP_PX, 2 * step + 3)
  return { grow, shrink: 4, move: 4 }
}

/**
 * Is the window that is SHOWN still the one we PLACED, given the display's rounding? `maximized`
 * is a FACT, compared exactly: maximizing without moving is a change, whatever the envelope.
 */
export function withinPlacementEnvelope(
  placed: WindowBounds | null,
  shown: WindowBounds | null,
  envelope: PlacementEnvelope
): boolean {
  if (!placed || !shown) return false
  if ((placed.maximized === true) !== (shown.maximized === true)) return false
  if (Math.abs(shown.x - placed.x) > envelope.move || Math.abs(shown.y - placed.y) > envelope.move) {
    return false
  }
  return (['width', 'height'] as const).every((k) => {
    const delta = shown[k] - placed[k]
    return delta <= envelope.grow && delta >= -envelope.shrink
  })
}

/** A trailing debounce over one store key: `queue` whenever it might have changed, `flush` on the
 *  way out. */
export interface WindowStateSaver {
  /** Record the window's current state. The write happens `delayMs` after the LAST such call. */
  queue(state: WindowBounds): void
  /** Write anything still pending, right now. Idempotent, and a no-op when nothing changed. */
  flush(): void
  /**
   * Declare the rectangle the APP just applied to the window, so the save that follows it is not
   * mistaken for the user's own choice. `null` (or an absent rect) clears the declaration.
   *
   * THE STORE KEEPS THE RECTANGLE THE USER CHOSE; THE SCREEN GETS THE ONE THAT FITS. Without this,
   * the keep-on-screen fit would eat the memory it corrected: launch with the second monitor
   * unplugged, the window is clamped onto the remaining display, the first save writes THAT down —
   * and plugging the monitor back in returns a window that has forgotten it ever lived there. The
   * declaration is dropped the moment the window reports anything else, so a user who drags the
   * window somewhere new is recorded immediately.
   *
   * `scaleFactor` is that of the display the rectangle lands on, and sizes the envelope
   * (`placementEnvelope`). Absent or unknown means the widest envelope, never the narrowest.
   */
  applied(rect: Rect | undefined, maximized: boolean, scaleFactor?: number | null): void
}

/**
 * A saver over `save`, coalescing a burst of geometry events into ONE write.
 *
 * Trailing, not leading: the interesting value is where the window ENDED UP. And it never writes
 * the same state twice — a `resized` that follows an `unmaximize` describes a rectangle the
 * `unmaximize` already queued, and a maximize/restore round trip ends where it started.
 */
export function createWindowStateSaver(
  save: (state: WindowBounds) => void,
  opts: { delayMs?: number; arm?: ArmTimer } = {}
): WindowStateSaver {
  const delayMs = opts.delayMs ?? SAVE_DEBOUNCE_MS
  const arm = opts.arm ?? armWithTimeout
  let cancel: CancelTimer | null = null
  let pending: WindowBounds | null = null
  let written: WindowBounds | null = null
  let applied: WindowBounds | null = null
  let envelope: PlacementEnvelope = placementEnvelope(null)

  const write = (): void => {
    cancel = null
    const next = pending
    pending = null
    if (!next) return
    written = next
    save(next)
  }

  return {
    queue(state: WindowBounds): void {
      // Still exactly where the app put it: that is our placement, not the user's, and it must
      // never overwrite the rectangle they chose (see `applied`).
      if (withinPlacementEnvelope(applied, state, envelope)) return
      applied = null
      // Nothing new to say — compared against what is already on its way to disk when there is
      // one, and against the last thing written otherwise.
      if (sameWindowState(pending ?? written, state)) return
      pending = state
      cancel?.()
      cancel = arm(write, delayMs)
    },
    flush(): void {
      cancel?.()
      write()
    },
    applied(rect: Rect | undefined, maximized: boolean, scaleFactor?: number | null): void {
      applied = rect ? normalizeWindowState({ ...rect, maximized }) ?? null : null
      envelope = placementEnvelope(scaleFactor)
    }
  }
}
