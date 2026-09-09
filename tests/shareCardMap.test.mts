// ============================================================================
// shareCardMap.test.mts — the card's hotspot map, as untrusted input.
// ============================================================================
//
// `sanitizeCardMap` stands where the capture rectangle's own validator stands: the renderer is the
// only side with layout, so it measures the boxes, and everything it says about them is checked
// here before it becomes a wire field a stranger's browser draws over a picture.
//
// What is guarded, and why each one is load-bearing:
//
//   * A SLOT THE PROFILE DOES NOT CARRY IS NOT A HOTSPOT. The map names cells of the envelope; a
//     name that is not in it would be a tooltip for an item the page was never served.
//   * A FRACTION IS A FRACTION. Negative, past the edge, zero-sized, NaN, a string: all refused,
//     because the page multiplies these by the picture's real width.
//   * …EXCEPT THE ROUNDING ARTEFACT. A box ending 1.00005 of the way across is a division, not a
//     claim, so it is clamped to the edge rather than thrown away with the cell it describes.
//   * ONE ENTRY PER SLOT, AND FORTY AT MOST. Both are bounds on a body that crosses the network.
//   * NOTHING THROWS. This runs on the publish path, where a throw is an IPC rejection.
//
// No Electron, no DOM, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CARD_MAP, sanitizeCardMap, type CardMapEntry } from '../src/shared/shareCardMap'

const SLOTS = new Set(['head', 'chest', 'ear1', 'hands'])

/** A whole entry, so each case below can state only the field it is about. */
function entry(over: Partial<CardMapEntry>): unknown {
  return { slot: 'head', x: 0.1, y: 0.2, w: 0.3, h: 0.4, ...over }
}

test('a measured map survives whole, rounded to four decimals', () => {
  const map = sanitizeCardMap(
    [
      { slot: 'head', x: 0.123_456_7, y: 0.25, w: 0.301_2, h: 0.1 },
      { slot: 'chest', x: 0, y: 0, w: 1, h: 1 }
    ],
    SLOTS
  )
  assert.deepEqual(map, [
    { slot: 'head', x: 0.1235, y: 0.25, w: 0.3012, h: 0.1 },
    { slot: 'chest', x: 0, y: 0, w: 1, h: 1 }
  ])
})

test('anything that is not an array of entries is an empty map, not a throw', () => {
  for (const raw of [undefined, null, 0, 'head', { slot: 'head' }, [null, 7, 'x', [], { }]]) {
    assert.deepEqual(sanitizeCardMap(raw, SLOTS), [], JSON.stringify(raw ?? null))
  }
})

test('a slot the profile does not carry is dropped, whatever its box says', () => {
  for (const slot of ['boots', '', 'HEAD', ' head', 42, null, undefined]) {
    assert.deepEqual(sanitizeCardMap([entry({ slot: slot as string })], SLOTS), [], String(slot))
  }
  // …and an empty slot set is a profile with nothing to point at.
  assert.deepEqual(sanitizeCardMap([entry({})], new Set<string>()), [])
})

test('a number that is not a fraction of the picture is dropped', () => {
  const bad: Partial<CardMapEntry>[] = [
    { x: -0.001 },
    { y: -1 },
    { x: 1.5 },
    { y: 2 },
    { w: 0 },
    { h: 0 },
    { w: -0.2 },
    { h: -0.2 },
    { w: 1.5 },
    { h: 1.5 },
    { x: Number.NaN },
    { w: Number.POSITIVE_INFINITY },
    { x: '0.1' as unknown as number },
    { h: null as unknown as number },
    // …and a box that starts inside the card but ends well outside it.
    { x: 0.9, w: 0.5 },
    { y: 0.9, h: 0.5 }
  ]
  for (const over of bad) {
    assert.deepEqual(sanitizeCardMap([entry(over)], SLOTS), [], JSON.stringify(over))
  }
  // A missing field is a missing number.
  assert.deepEqual(sanitizeCardMap([{ slot: 'head', x: 0.1, y: 0.1 }], SLOTS), [])
})

test('a box that overshoots the edge by a rounding artefact is clamped, not dropped', () => {
  const map = sanitizeCardMap([{ slot: 'head', x: 0.9, y: 0.94, w: 0.100_05, h: 0.060_04 }], SLOTS)
  assert.deepEqual(map, [{ slot: 'head', x: 0.9, y: 0.94, w: 0.1, h: 0.06 }])
  const one = map[0]
  assert.ok(one)
  assert.ok(one.x + one.w <= 1)
  assert.ok(one.y + one.h <= 1)
})

test('a slot measured twice keeps the first box', () => {
  const map = sanitizeCardMap(
    [entry({ slot: 'head', x: 0.1 }), entry({ slot: 'head', x: 0.7 }), entry({ slot: 'chest' })],
    SLOTS
  )
  assert.deepEqual(
    map.map((e) => `${e.slot} ${String(e.x)}`),
    ['head 0.1', 'chest 0.1']
  )
})

test('a map longer than the card could ever be is capped', () => {
  const slots = new Set<string>()
  const raw: unknown[] = []
  for (let i = 0; i < MAX_CARD_MAP * 3; i++) {
    slots.add(`slot${String(i)}`)
    raw.push(entry({ slot: `slot${String(i)}` }))
  }
  assert.equal(sanitizeCardMap(raw, slots).length, MAX_CARD_MAP)
})

test('the good entries of a mixed map are kept and the junk between them is not', () => {
  const map = sanitizeCardMap(
    [
      'nonsense',
      entry({ slot: 'ear1', x: 0.05, y: 0.05, w: 0.2, h: 0.05 }),
      entry({ slot: 'boots' }),
      null,
      entry({ slot: 'hands', x: -3 }),
      entry({ slot: 'chest', x: 0.4, y: 0.5, w: 0.2, h: 0.05 })
    ],
    SLOTS
  )
  assert.deepEqual(
    map.map((e) => e.slot),
    ['ear1', 'chest']
  )
})
