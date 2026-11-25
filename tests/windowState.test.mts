// THE WINDOW REMEMBERS ITS SIZE — and its position, and whether it was maximized (JOS-248).
//
// Report 01KZSYHKZDERT9P4YAFJN4N3QP (v0.22.0) asked whether the app could save its window size. It
// half could: a rectangle was persisted and re-applied, but a MAXIMIZED window was the one state
// the old saver deliberately threw away, the write was undebounced, and nothing was written on a
// quit that did not close a window. `src/main/windowState.ts` is the answer and this file is why it
// can be CHECKED: it is pure, so a maximized window, a minimized one and a destroyed one are three
// object literals, and the debounce is armed through an injected timer so the assertion is about
// COALESCING rather than about how long a Windows timer really sleeps (AGENTS.md: it snaps to the
// 15.6 ms tick grid, so a clock-based debounce test would be measuring the platform).
//
// The five properties:
//   1. A stored state is validated on the way in AND on the way out — garbage answers "no
//      remembered state", which the caller answers with today's default size, exactly.
//   2. `maximized` is a FACT kept beside the rectangle, never instead of it: what is remembered is
//      always the NORMAL bounds, so a restore can un-maximize back to what the user chose.
//   3. A minimized (or destroyed) window says nothing at all.
//   4. A burst of geometry events is ONE write, of the LAST state, and a flush writes it now.
//   5. The same state is never written twice.
//
// What is NOT here, because it needs Electron and a real window: that the fit is applied at
// creation, that the store keeps the rectangle the user chose when a monitor goes away, and that a
// second launch comes up where the first one left off. tests/e2e/window-bounds.e2e.mts drives all
// three against the real app; the placement geometry itself is tests/displayFit.test.mts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MAIN_WINDOW_SIZE,
  SAVE_DEBOUNCE_MS,
  ROUNDING_GROWTH_CAP_PX,
  createWindowStateSaver,
  normalizeWindowState,
  placementEnvelope,
  sameWindowState,
  scaleStep,
  windowStateOf,
  withinPlacementEnvelope,
  type ArmTimer,
  type WindowBounds,
  type WindowLike
} from '../src/main/windowState'

/** A window that answers exactly what this module asks of one. */
function fakeWindow(opts: {
  normal: { x: number; y: number; width: number; height: number }
  maximized?: boolean
  minimized?: boolean
  destroyed?: boolean
}): WindowLike {
  return {
    isDestroyed: () => opts.destroyed === true,
    isMinimized: () => opts.minimized === true,
    isMaximized: () => opts.maximized === true,
    getNormalBounds: () => opts.normal
  }
}

/** The rectangle a user dragged the window to, in one place so every test means the same one. */
const CHOSEN = { x: 240, y: 120, width: 1100, height: 780 }

// ---- 1. what a stored state may be ------------------------------------------------------------

test('a whole, sane rectangle is remembered as it was', () => {
  assert.deepEqual(normalizeWindowState(CHOSEN), CHOSEN)
})

test('a maximized state keeps the flag AND the rectangle underneath it', () => {
  assert.deepEqual(normalizeWindowState({ ...CHOSEN, maximized: true }), {
    ...CHOSEN,
    maximized: true
  })
})

test('an ordinary window carries no flag at all — absent is what every older store says', () => {
  const state = normalizeWindowState({ ...CHOSEN, maximized: false })
  assert.deepEqual(state, CHOSEN)
  assert.equal('maximized' in (state as object), false)
})

test('fractional pixels are rounded — a window is a whole number of them', () => {
  assert.deepEqual(normalizeWindowState({ x: 10.4, y: 10.6, width: 800.2, height: 600.5 }), {
    x: 10,
    y: 11,
    width: 800,
    height: 601
  })
})

test('a hand-edited or half-written state is refused, and the default is what is left', () => {
  for (const raw of [
    undefined,
    null,
    42,
    'maximized',
    {},
    { x: 0, y: 0, width: 800 },
    { x: 0, y: 0, width: 800, height: '600' },
    { x: Number.NaN, y: 0, width: 800, height: 600 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 600 },
    { x: 0, y: 0, width: 0, height: 600 },
    { x: 0, y: 0, width: 800, height: -600 }
  ]) {
    assert.equal(normalizeWindowState(raw), undefined, JSON.stringify(raw) ?? 'undefined')
  }
})

test('an off-screen POSITION is not refused here — an unplugged monitor is a memory, not a typo', () => {
  // Rule 3 of displayFit.ts owns this question; normalizing it away would destroy the layout a
  // re-plugged monitor is supposed to restore.
  assert.deepEqual(normalizeWindowState({ x: 9000, y: 9000, width: 800, height: 600 }), {
    x: 9000,
    y: 9000,
    width: 800,
    height: 600
  })
})

test('no remembered state means TODAY’S DEFAULT SIZE, exactly, and no position', () => {
  assert.deepEqual({ ...DEFAULT_MAIN_WINDOW_SIZE }, { width: 1280, height: 860 })
  assert.equal('x' in DEFAULT_MAIN_WINDOW_SIZE, false)
})

// ---- 2/3. what a window says about itself -----------------------------------------------------

test('an ordinary window is remembered where it is', () => {
  assert.deepEqual(windowStateOf(fakeWindow({ normal: CHOSEN })), CHOSEN)
})

test('a MAXIMIZED window remembers the flag and the rectangle a restore returns to', () => {
  // The defect this ticket is about: the old saver skipped the write entirely while maximized, so
  // the fact was lost and the user re-maximized on every launch.
  const state = windowStateOf(fakeWindow({ normal: CHOSEN, maximized: true }))
  assert.deepEqual(state, { ...CHOSEN, maximized: true })
})

test('a MINIMIZED window says nothing — being in the taskbar is not a placement', () => {
  assert.equal(windowStateOf(fakeWindow({ normal: CHOSEN, minimized: true })), null)
})

test('a destroyed window says nothing, so the teardown paths can ask blind', () => {
  assert.equal(windowStateOf(fakeWindow({ normal: CHOSEN, destroyed: true })), null)
})

test('a window whose bounds are nonsense is refused rather than written', () => {
  assert.equal(windowStateOf(fakeWindow({ normal: { x: 0, y: 0, width: 0, height: 0 } })), null)
})

// ---- the comparison the applied-bounds marker rests on ----------------------------------------

test('a pixel of slack is a placement, not a move — but only when it is asked for', () => {
  const nudged = { ...CHOSEN, x: CHOSEN.x + 1 }
  assert.equal(sameWindowState(CHOSEN, nudged, 1), true)
  assert.equal(sameWindowState(CHOSEN, nudged), false)
  assert.equal(sameWindowState(CHOSEN, { ...CHOSEN, x: CHOSEN.x + 2 }, 1), false)
})

test('maximizing without moving is a CHANGE, however much slack the rectangle is given', () => {
  assert.equal(sameWindowState(CHOSEN, { ...CHOSEN, maximized: true }, 4), false)
})

test('nothing is the same as nothing — an absent state never matches', () => {
  assert.equal(sameWindowState(null, CHOSEN), false)
  assert.equal(sameWindowState(null, null), false)
})

// ---- 4/5. when the write happens --------------------------------------------------------------

/** A timer that fires when the TEST says so. Returns the arm plus the trigger. */
function fakeTimer(): { arm: ArmTimer; fire: () => void; armed: () => number; delays: number[] } {
  let pending: (() => void) | null = null
  let arms = 0
  const delays: number[] = []
  const arm: ArmTimer = (fn, delayMs) => {
    arms += 1
    delays.push(delayMs)
    pending = fn
    return () => {
      pending = null
    }
  }
  return {
    arm,
    fire: () => {
      const fn = pending
      pending = null
      fn?.()
    },
    armed: () => arms,
    delays
  }
}

test('a burst of geometry events is ONE write, of where the window ENDED UP', () => {
  const writes: WindowBounds[] = []
  const timer = fakeTimer()
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: timer.arm })
  for (const x of [100, 140, 180, 220]) saver.queue({ ...CHOSEN, x })
  assert.deepEqual(writes, [], 'nothing is written while the window is still moving')
  timer.fire()
  assert.deepEqual(writes, [{ ...CHOSEN, x: 220 }])
  assert.equal(timer.delays[0], SAVE_DEBOUNCE_MS, 'the default debounce is the shared constant')
})

test('a flush writes what is pending immediately, and the cancelled timer cannot write it twice', () => {
  const writes: WindowBounds[] = []
  const timer = fakeTimer()
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: timer.arm })
  saver.queue(CHOSEN)
  saver.flush()
  assert.deepEqual(writes, [CHOSEN], 'the quit path does not wait for a debounce')
  timer.fire()
  assert.deepEqual(writes, [CHOSEN], 'a timer that was cancelled writes nothing')
})

test('a flush with nothing to say writes nothing', () => {
  const writes: WindowBounds[] = []
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: fakeTimer().arm })
  saver.flush()
  saver.flush()
  assert.deepEqual(writes, [])
})

test('the same state is never written twice — a maximize round trip ends where it started', () => {
  const writes: WindowBounds[] = []
  const timer = fakeTimer()
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: timer.arm })
  saver.queue(CHOSEN)
  timer.fire()
  saver.queue({ ...CHOSEN })
  assert.equal(timer.armed(), 1, 'a state identical to the last one written arms no timer')
  assert.deepEqual(writes, [CHOSEN])
  // …and the flag alone is enough to make it a new state.
  saver.queue({ ...CHOSEN, maximized: true })
  timer.fire()
  assert.deepEqual(writes, [CHOSEN, { ...CHOSEN, maximized: true }])
})

test('a move after a write arms the debounce again', () => {
  const writes: WindowBounds[] = []
  const timer = fakeTimer()
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: timer.arm })
  saver.queue(CHOSEN)
  timer.fire()
  saver.queue({ ...CHOSEN, y: 400 })
  assert.equal(timer.armed(), 2)
  timer.fire()
  assert.deepEqual(writes, [CHOSEN, { ...CHOSEN, y: 400 }])
})

// ---- the applied-bounds marker: the rounding envelope, per display --------------------------
//
// The envelope a placement of OURS may come back inside (windowState.ts `placementEnvelope`).
// MEASURED_WORST is the worst constructor growth of width or height, in DIP, for the main
// window's shape on Electron 43.8.12 (~1,500 placements per scale; position never moved and the
// size never shrank). Every scale the app is likely to meet is listed, and the two halves of the
// rule are pinned at each: our worst rounding is absorbed, and a user's 10-DIP gesture is not.

const MEASURED_WORST: readonly (readonly [scale: number, worstGrowth: number])[] = [
  [1.0, 0],
  [1.25, 8],
  [1.5, 5],
  [1.75, 7],
  [2.0, 1],
  [2.25, 8],
  [2.5, 4],
  [2.75, 7],
  [3.0, 0]
]

/** The user's half of the bargain, stated in windowState.ts: always recorded, at every scale. */
const USER_GROWS_PX = 10
const USER_SHRINKS_PX = 5
const USER_MOVES_PX = 5

test('the rounding step is read from the scale factor: whole, half, quarter — or unknown', () => {
  assert.equal(scaleStep(1), 1)
  assert.equal(scaleStep(2), 1)
  assert.equal(scaleStep(3), 1)
  assert.equal(scaleStep(1.5), 2)
  assert.equal(scaleStep(2.5), 2)
  assert.equal(scaleStep(1.25), 4)
  assert.equal(scaleStep(2.25), 4)
  assert.equal(scaleStep(1.75), 4)
  assert.equal(scaleStep(1.1), null, "Windows' custom scaling is off the quarter grid")
  for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(scaleStep(bad), null, String(bad))
  }
})

test('the envelope: whole 5 · half 7 · quarter 9 · unknown 9, and never wider than the cap', () => {
  assert.deepEqual(placementEnvelope(1), { grow: 5, shrink: 4, move: 4 })
  assert.deepEqual(placementEnvelope(1.5), { grow: 7, shrink: 4, move: 4 })
  assert.deepEqual(placementEnvelope(2.25), { grow: 9, shrink: 4, move: 4 })
  assert.deepEqual(placementEnvelope(1.1), { grow: 9, shrink: 4, move: 4 })
  assert.deepEqual(placementEnvelope(null), { grow: 9, shrink: 4, move: 4 }, 'unknown is the WIDEST')
  for (const s of [0.5, 1, 1.1, 1.25, 1.5, 3.5, 4, 5]) {
    assert.ok(placementEnvelope(s).grow <= ROUNDING_GROWTH_CAP_PX, String(s))
  }
  assert.ok(ROUNDING_GROWTH_CAP_PX < USER_GROWS_PX, 'the cap sits below the user boundary')
})

for (const [scale, worst] of MEASURED_WORST) {
  test(`at ${String(scale)}x our worst measured rounding (+${String(worst)}) is ours, and a user's gesture is theirs`, () => {
    const env = placementEnvelope(scale)
    const placed = { ...CHOSEN }
    // OUR placement, at its measured worst, on either axis or both: still ours.
    assert.ok(withinPlacementEnvelope(placed, { ...placed, width: placed.width + worst }, env))
    assert.ok(withinPlacementEnvelope(placed, { ...placed, height: placed.height + worst }, env))
    assert.ok(
      withinPlacementEnvelope(placed, { ...placed, width: placed.width + worst, height: placed.height + worst }, env)
    )
    assert.ok(worst < env.grow, `at least one DIP of margin over the measurement (envelope ${String(env.grow)})`)
    // The USER: 10 DIP bigger, 2 smaller or 3 moved, on any one axis, is a gesture to record.
    for (const k of ['width', 'height'] as const) {
      assert.equal(withinPlacementEnvelope(placed, { ...placed, [k]: placed[k] + USER_GROWS_PX }, env), false, `${k} +10`)
      assert.equal(withinPlacementEnvelope(placed, { ...placed, [k]: placed[k] - USER_SHRINKS_PX }, env), false, `${k} -5`)
    }
    for (const k of ['x', 'y'] as const) {
      assert.equal(withinPlacementEnvelope(placed, { ...placed, [k]: placed[k] + USER_MOVES_PX }, env), false, `${k} +5`)
      assert.equal(withinPlacementEnvelope(placed, { ...placed, [k]: placed[k] - USER_MOVES_PX }, env), false, `${k} -5`)
    }
  })
}

test('growth is sized from the scale; shrink and move keep the previous, known-good four DIP', () => {
  const env = placementEnvelope(2.25)
  assert.ok(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, width: CHOSEN.width + 9 }, env))
  assert.equal(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, width: CHOSEN.width - 9 }, env), false)
  assert.ok(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, width: CHOSEN.width - 4 }, env), 'four DIP of shrink, as before')
  assert.equal(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, height: CHOSEN.height - 5 }, env), false)
  assert.ok(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, x: CHOSEN.x - 4, y: CHOSEN.y + 4 }, env), 'four DIP of move')
  assert.equal(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, x: CHOSEN.x + 5 }, env), false)
  // …and on a whole-scale display, where growth is tight, shrink and move are still the old four.
  const whole = placementEnvelope(1)
  assert.ok(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, width: CHOSEN.width - 4, y: CHOSEN.y + 4 }, whole))
})

test('the marker stands UNTIL A REPORT LEAVES THE ENVELOPE: many in-envelope reports and the close flush are ours', () => {
  const writes: WindowBounds[] = []
  const timer = fakeTimer()
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: timer.arm })
  const placed = { x: 391, y: 96, width: 1040, height: 720 }
  saver.applied(placed, false, 2.25)
  // Several geometry reports inside the envelope (the constructor's rounding, a re-layout, a
  // four-DIP nudge): none is written, and none drops the marker.
  for (const shown of [
    { ...placed, width: 1046, height: 722 },
    { ...placed, width: 1044, height: 722 },
    { ...placed, x: 395, width: 1046, height: 722 },
    { ...placed, width: 1049, height: 729 }
  ]) {
    saver.queue(shown)
  }
  assert.equal(timer.armed(), 0, 'no in-envelope report arms a write')
  saver.flush()
  assert.deepEqual(writes, [], 'the close flush writes nothing either — the store keeps the user rectangle')
  // The first report OUTSIDE the envelope is the user's, is written, and ends the marker…
  const outside = { ...placed, width: 1050 }
  saver.queue(outside)
  saver.flush()
  assert.deepEqual(writes, [outside])
  // …so a later report back inside the old envelope is the user's too.
  saver.queue({ ...placed, width: 1044 })
  saver.flush()
  assert.deepEqual(writes, [outside, { ...placed, width: 1044 }])
})

test('maximized stays a FACT inside the envelope, and nothing matches nothing', () => {
  const env = placementEnvelope(2.25)
  assert.equal(withinPlacementEnvelope(CHOSEN, { ...CHOSEN, maximized: true }, env), false)
  assert.equal(withinPlacementEnvelope(null, CHOSEN, env), false)
  assert.equal(withinPlacementEnvelope(CHOSEN, null, env), false)
})

test('THE LOST MONITOR at 2.25x: our clamp, rounded +6 by the display, is never written down', () => {
  // window-bounds.e2e's launch 3 on Electron 43.8.12: placed 391,96 1040x720, shown 1046x722 —
  // outside the old fixed four pixels, so the clamp overwrote the remembered monitor.
  const writes: WindowBounds[] = []
  const timer = fakeTimer()
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: timer.arm })
  const fitted = { x: 391, y: 96, width: 1040, height: 720 }
  saver.applied(fitted, false, 2.25)
  saver.queue({ x: 391, y: 96, width: 1046, height: 722 })
  saver.flush()
  assert.deepEqual(writes, [], 'the rounded clamp is the app talking, not the user')
})

test("…and the user's first real resize after it IS written, and drops the marker for good", () => {
  const writes: WindowBounds[] = []
  const timer = fakeTimer()
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: timer.arm })
  const fitted = { x: 391, y: 96, width: 1040, height: 720 }
  saver.applied(fitted, false, 2.25)
  const resized = { x: 391, y: 96, width: 1050, height: 720 }
  saver.queue(resized)
  saver.flush()
  assert.deepEqual(writes, [resized], 'ten DIP wider is a gesture, at the widest envelope')
  // The marker is gone: even a state back inside the old envelope is now the user's.
  saver.queue({ ...fitted, width: 1044 })
  saver.flush()
  assert.deepEqual(writes, [resized, { ...fitted, width: 1044 }])
})

test('a whole-scale display keeps the tight envelope: 6 DIP of growth at 1.0x is the user', () => {
  const writes: WindowBounds[] = []
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: fakeTimer().arm })
  saver.applied(CHOSEN, false, 1)
  saver.queue({ ...CHOSEN, width: CHOSEN.width + 6 })
  saver.flush()
  assert.deepEqual(writes, [{ ...CHOSEN, width: CHOSEN.width + 6 }])
})

test('a placement declared with no scale factor gets the widest envelope, not the narrowest', () => {
  const writes: WindowBounds[] = []
  const saver = createWindowStateSaver((s) => writes.push(s), { arm: fakeTimer().arm })
  saver.applied(CHOSEN, false)
  saver.queue({ ...CHOSEN, width: CHOSEN.width + 8, height: CHOSEN.height + 8 })
  saver.flush()
  assert.deepEqual(writes, [])
})
