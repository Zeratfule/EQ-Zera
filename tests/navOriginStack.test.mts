// Pure unit tests for the deep-link BACK CONTRACT (src/renderer/src/navOrigin.ts, JOS-43).
//
// No log, no fixture, no DOM — the whole rule is a stack transition, which is why it was lifted
// out of the hook in the first place. What is pinned here is exactly what the owner reported and
// exactly what could quietly rot:
//   1. an ANCHORED cross-view link parks the tab it left, so Back returns THERE and not to the
//      top of the receiving tab's list (the bug: planner → donor → Back → the loot ledger);
//   2. a NATIVE arrival parks nothing, so a drill opened from its own list still backs out to
//      that list — the half of the contract a fix could easily break instead;
//   3. a BARE opener ("All loot") is a tab switch and CLEARS, because there is no drill to press
//      Back in and the parked journey is over;
//   4. links CHAIN and unwind in order — the reason this is a stack and not one slot;
//   5. re-anchoring the view you are already on disturbs nothing;
//   6. the trail is BOUNDED, so a long session cannot grow an array forever.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { View } from '../src/renderer/src/appViews'
import { MAX_ORIGINS, afterBack, afterLink, originTop, type NavOrigin } from '../src/renderer/src/navOrigin'

/** The router builds these from VIEW_LABELS; the label is opaque to the stack itself. */
const at = (view: View, label: string): NavOrigin => ({ view, label })

test('an anchored cross-view link parks the tab it left', () => {
  const s = afterLink([], at('planner', 'Exaltations'), 'loot', true)
  assert.deepEqual(s, [{ view: 'planner', label: 'Exaltations' }])
  assert.deepEqual(originTop(s), { view: 'planner', label: 'Exaltations' })
})

test('a native arrival parks nothing — an empty stack is the "back to my own list" state', () => {
  assert.equal(originTop([]), null)
  // Nothing was ever pushed, so Back has nothing to consume and the receiver keeps its fallback.
  assert.deepEqual(afterBack([]), [])
})

test('a bare opener is a tab switch: it clears whatever was parked', () => {
  const parked = afterLink([], at('planner', 'Exaltations'), 'loot', true)
  // The drops card's "All loot" — same destination, no anchor.
  assert.deepEqual(afterLink(parked, at('overview', 'Overview'), 'loot', false), [])
})

test('links chain, and Back unwinds them in the order they were walked', () => {
  let s = afterLink([], at('planner', 'Exaltations'), 'loot', true)
  s = afterLink(s, at('loot', 'Loot'), 'mobs', true)
  assert.deepEqual(
    s.map((o) => o.view),
    ['planner', 'loot']
  )
  assert.deepEqual(originTop(s), { view: 'loot', label: 'Loot' })
  s = afterBack(s)
  assert.deepEqual(originTop(s), { view: 'planner', label: 'Exaltations' })
  s = afterBack(s)
  assert.equal(originTop(s), null)
})

test('re-anchoring the view you are already on parks nothing and disturbs nothing', () => {
  const parked = afterLink([], at('overview', 'Overview'), 'posky', true)
  // A second celebration toast anchors another quest while Plane of Sky is already open.
  const after = afterLink(parked, at('posky', 'Plane of Sky'), 'posky', true)
  assert.deepEqual(after, parked)
})

test('the trail is bounded — overflow drops the OLDEST hop, never the one Back is about to use', () => {
  let s: NavOrigin[] = []
  for (let i = 0; i < MAX_ORIGINS + 4; i++) {
    // Alternate so no hop is ever a same-view re-anchor.
    s = afterLink(s, at(i % 2 === 0 ? 'loot' : 'mobs', i % 2 === 0 ? 'Loot' : 'Mobs'), i % 2 === 0 ? 'mobs' : 'loot', true)
  }
  assert.equal(s.length, MAX_ORIGINS)
  assert.deepEqual(originTop(s), { view: 'mobs', label: 'Mobs' })
})

test('afterLink never mutates the stack it was handed', () => {
  const before: NavOrigin[] = [at('overview', 'Overview')]
  afterLink(before, at('planner', 'Exaltations'), 'loot', true)
  afterLink(before, at('planner', 'Exaltations'), 'loot', false)
  afterBack(before)
  assert.deepEqual(before, [{ view: 'overview', label: 'Overview' }])
})
