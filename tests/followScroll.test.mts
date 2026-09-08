// followScroll — the Combat log card's follow decision (JOS-95).
//
// The report this pins: "Combat log screen will keep jumping to the bottom so you can't scroll
// up and check things out." (report 01KZFFGBC7BEKATQ81B3WXG1ET, 0.10.0). The card used to
// scroll unconditionally on every append; now it follows only a reader who is at the bottom,
// and `isAtBottom` is the whole decision.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FOLLOW_THRESHOLD_PX, isAtBottom } from '../src/renderer/src/features/combat/followScroll'

test('pinned to the exact bottom is at the bottom', () => {
  // 1000px of content, 220px viewport, scrolled all the way: 1000 - 780 - 220 = 0.
  assert.equal(isAtBottom(780, 1000, 220), true)
})

test('sub-pixel and rounding drift still counts as the bottom', () => {
  // Zoom/DPI leaves fractional remainders well inside the threshold.
  assert.equal(isAtBottom(779.5, 1000, 220), true)
  assert.equal(isAtBottom(780 - FOLLOW_THRESHOLD_PX, 1000, 220), true)
})

test('one wheel notch up is scrolled-up — the reader keeps their place', () => {
  // A notch is ~50-100px, far past the threshold: the yank this fix removes.
  assert.equal(isAtBottom(780 - 50, 1000, 220), false)
})

test('scrolled to the top of a long ring is scrolled-up', () => {
  assert.equal(isAtBottom(0, 1000, 220), false)
})

test('content shorter than the box follows — an empty log never pins itself', () => {
  // No scrollbar: scrollHeight == clientHeight, scrollTop 0.
  assert.equal(isAtBottom(0, 180, 220), true)
  assert.equal(isAtBottom(0, 220, 220), true)
})
