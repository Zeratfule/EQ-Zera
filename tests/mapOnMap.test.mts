// THE MAP'S OWN EXTENT (quest locations, review of 4b66753): src/renderer/src/features/maps/onMap.ts
// decides whether a quest point is drawn on the map at all. The axes are mapFromLoc's (x = -ew,
// y = -ns) and the margin is 5% of the drawn span; a point past it is never drawn or centred.
// The e2e (quest-locations.e2e.mts) proves the same on the real Najena map.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { ON_MAP_MARGIN, onMap } from '../src/renderer/src/features/maps/onMap'

const b = { minX: -100, maxX: 100, minY: -400, maxY: 0, minZ: 0, maxZ: 0 }

test('a point inside the drawn extent is on the map, in /loc order', () => {
  // ns 200 -> y -200, ew -50 -> x 50
  assert.equal(onMap(b, { ns: 200, ew: -50 }), true)
})

test('the margin is 5% of the span on each axis, and one step past it is off', () => {
  assert.equal(ON_MAP_MARGIN, 0.05)
  assert.equal(onMap(b, { ns: 0, ew: -109 }), true) // x 109, margin 10
  assert.equal(onMap(b, { ns: 0, ew: -111 }), false)
  assert.equal(onMap(b, { ns: 419, ew: 0 }), true) // y -419, margin 20
  assert.equal(onMap(b, { ns: 421, ew: 0 }), false)
  assert.equal(onMap(b, { ns: -21, ew: 0 }), false) // y 21 > 0 + 20
})
