// ============================================================================
// presenceDip.test.mts — JOS-376: the ring lines up under display scaling.
// ============================================================================
//
// THE REPORT (01M037P83Z3KK4379WWET159B2): two monitors, EverQuest fullscreen on one, and the
// cursor ring draws offset while the pointer is moving on the OTHER screen.
//
// THE MECHANISM IS A UNIT MISMATCH, and it is one line wide. The watcher's rectangle comes from
// `GetWindowRect` (presenceNative.ts) and is PHYSICAL PIXELS, because this process is
// per-monitor-DPI aware; `BrowserWindow` bounds and `screen.getCursorScreenPoint()` are DIP. The
// ring window is created AT the EQ rectangle and the halo is drawn at `cursor - windowOrigin`
// (presenceEffects.ts), so the two spaces meet — and nothing converted between them, anywhere in
// the tree. At 100% scale on the primary monitor the numbers are identical and the ring is
// perfect, which is why this shipped: the defect is invisible on the desk it was written at.
//
// WHAT THIS FILE OWNS: the conversion itself (`eqBoundsInDip`, presenceProtocol.ts) — the pure
// half, driven with a fake `screen`. That it is actually WIRED IN at the one seam that puts a
// rectangle into main's state is pinned as source in tests/overlayFocusPolicy.test.mts, next to
// the other rule about that same line (only the game moves the bounds).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eqBoundsInDip } from '../src/main/presenceProtocol'
import type { PhysicalToDip } from '../src/main/presenceProtocol'
import type { ScreenRect } from '../src/shared/presencePrefs'

/**
 * A stand-in for `screen.screenToDipRect`, which needs a real desktop and so cannot be here.
 * Windows divides by the scale factor of the monitor the rectangle is on, and this models exactly
 * that — the point of these cases is not to re-implement Electron but to pin that the rectangle
 * reaching `eqBounds` is the CONVERTED one, which is the whole of the defect.
 */
const atScale =
  (scale: number): PhysicalToDip =>
  (r) => ({ x: r.x / scale, y: r.y / scale, width: r.width / scale, height: r.height / scale })

test('at 100% the conversion is the identity — which is why this shipped broken', () => {
  // One monitor, no scaling, physical == DIP. Every screenshot of the ring ever taken in review
  // was taken on such a desk, and nothing in it can distinguish the two spaces.
  const rect: ScreenRect = { x: 0, y: 0, width: 2560, height: 1440 }
  assert.deepEqual(eqBoundsInDip(rect, atScale(1)), rect)
})

test('a 150% monitor: physical x=3840 is DIP x=2560, and 3840 wide is 2560 wide', () => {
  // The reported desk. Unconverted, the ring window was created at x=3840 — 1280 DIP past where
  // the game actually is — and 3840 DIP wide, half again the monitor: it spilled onto the
  // neighbour, so a pointer over there read as "inside" the game's bounds and the halo was drawn
  // instead of parked. Converted, the window covers the game's monitor and nothing else.
  assert.deepEqual(eqBoundsInDip({ x: 3840, y: 0, width: 3840, height: 2160 }, atScale(1.5)), {
    x: 2560,
    y: 0,
    width: 2560,
    height: 1440
  })
})

test('a monitor LEFT of the primary keeps its negative origin', () => {
  // Physical coordinates are signed — the desktop origin is the primary monitor's top-left, not
  // the leftmost pixel — and a conversion that only handled the positive quadrant would put the
  // ring on the wrong screen entirely for anyone whose game monitor is the left-hand one.
  assert.deepEqual(eqBoundsInDip({ x: -1920, y: -180, width: 1920, height: 1080 }, atScale(1)), {
    x: -1920,
    y: -180,
    width: 1920,
    height: 1080
  })
  assert.deepEqual(eqBoundsInDip({ x: -2880, y: -270, width: 2880, height: 1620 }, atScale(1.5)), {
    x: -1920,
    y: -180,
    width: 1920,
    height: 1080
  })
})

test('the result is whole pixels — a window rectangle is not a fraction', () => {
  // 125% and 150% turn odd physical coordinates into quarters and halves, and this rectangle is
  // handed straight to `BrowserWindow.setBounds` (windows.ts `setCursorRingBounds`).
  assert.deepEqual(eqBoundsInDip({ x: 1001, y: 1001, width: 1001, height: 1001 }, atScale(1.25)), {
    x: 801,
    y: 801,
    width: 801,
    height: 801
  })
  const negative = eqBoundsInDip({ x: -2881, y: 0, width: 100, height: 100 }, atScale(1.5))
  assert.equal(negative.x, -1921, 'nearest, on the signed side too')
  assert.ok(Number.isInteger(negative.width))
})
