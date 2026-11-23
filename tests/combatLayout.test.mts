// THE COMBAT TAB'S RESIZABLE LAYOUT - the stored vocabulary (features/combat/combatLayout.ts).
//
// What is worth pinning, and why each one is not obvious:
//   * an absent key IS the default, and the default serializes back to an ABSENT key - so Reset
//     layout leaves the store exactly as a fresh install found it, and an upgrade moves nobody;
//   * parsing is TOTAL and PER FIELD: one hand-edited value degrades alone, the other splits keep
//     what the player chose;
//   * fractions stay inside FRACTION_MIN..FRACTION_MAX whatever was stored, so no panel can be
//     dragged (or edited) out of reach of its own handle;
//   * the DRAWN fraction honours a per-panel minimum at the measured size without rewriting the
//     stored one, and a box too small for both minimums draws an even split;
//   * the log never leaves the body less than BODY_MIN_H when there is room for both.
//
// No window, no React - this suite can never skip. The drag, the persistence across a restart and
// the reset are the real app's and live in tests/e2e/combat-layout.e2e.mts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BODY_MIN_H,
  DEFAULT_LAYOUT,
  FRACTION_MAX,
  FRACTION_MIN,
  HANDLE_PX,
  LOG_MAX,
  LOG_MIN,
  effectiveFraction,
  effectiveLog,
  fractionBounds,
  isDefaultLayout,
  logBounds,
  parseLayout,
  resetSplit,
  serializeLayout,
  withSplit
} from '../src/renderer/src/features/combat/combatLayout'

test('absent, empty and unreadable values are the default layout', () => {
  for (const raw of [null, '', 'not json', '[]', '"x"', '42', 'null']) {
    assert.deepEqual(parseLayout(raw), DEFAULT_LAYOUT, String(raw))
  }
})

test('the default is stored as an absent key, and a changed layout round-trips', () => {
  assert.equal(serializeLayout(DEFAULT_LAYOUT), null)
  const l = withSplit(withSplit(DEFAULT_LAYOUT, 'col', 0.62), 'log', 300)
  const raw = serializeLayout(l)
  assert.notEqual(raw, null)
  assert.deepEqual(parseLayout(raw), l)
})

test('each split degrades on its own', () => {
  const l = parseLayout(JSON.stringify({ col: 0.7, left: 'big', right: null, log: 260 }))
  assert.deepEqual(l, { col: 0.7, left: DEFAULT_LAYOUT.left, right: DEFAULT_LAYOUT.right, log: 260 })
})

test('stored values are clamped into their bands', () => {
  const l = parseLayout(JSON.stringify({ col: 0, left: 5, right: -1, log: 10_000 }))
  assert.equal(l.col, FRACTION_MIN)
  assert.equal(l.left, FRACTION_MAX)
  assert.equal(l.right, FRACTION_MIN)
  assert.equal(l.log, LOG_MAX)
  assert.equal(parseLayout(JSON.stringify({ log: 1 })).log, LOG_MIN)
})

test('withSplit returns the same object for a no-op, and resetSplit restores one split only', () => {
  assert.equal(withSplit(DEFAULT_LAYOUT, 'col', DEFAULT_LAYOUT.col), DEFAULT_LAYOUT)
  const l = withSplit(withSplit(DEFAULT_LAYOUT, 'col', 0.3), 'right', 0.7)
  const r = resetSplit(l, 'col')
  assert.equal(r.col, DEFAULT_LAYOUT.col)
  assert.equal(r.right, 0.7)
  assert.equal(isDefaultLayout(resetSplit(r, 'right')), true)
})

test('the drawn fraction keeps each panel its minimum without rewriting the stored value', () => {
  // 600px track, 220px minimum: the band is 220/600 .. 380/600.
  const b = fractionBounds(600, 220)
  assert.ok(Math.abs(b.lo - 220 / 600) < 1e-9 && Math.abs(b.hi - 380 / 600) < 1e-9)
  assert.equal(effectiveFraction(0.15, 600, 220), b.lo)
  assert.equal(effectiveFraction(0.5, 600, 220), 0.5)
  // a box too small for both minimums favours neither panel
  assert.equal(effectiveFraction(0.8, 300, 220), 0.5)
  // unmeasured (first render) falls back to the stored band
  assert.equal(effectiveFraction(0.8, 0, 220), 0.8)
})

test('the log leaves the body its minimum when there is room for both', () => {
  const frame = 600
  assert.equal(logBounds(frame).hi, frame - HANDLE_PX - BODY_MIN_H)
  assert.equal(effectiveLog(900, frame), frame - HANDLE_PX - BODY_MIN_H)
  assert.equal(effectiveLog(220, frame), 220)
  // a frame too short for both keeps the log's floor
  assert.equal(effectiveLog(220, 200), LOG_MIN)
  // unmeasured: the stored value as-is
  assert.equal(effectiveLog(300, 0), 300)
})
