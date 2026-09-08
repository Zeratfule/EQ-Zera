// THE FLAT WISH LIST — the model and the one-time seed (JOS-326).
//
// Four promises, none of them visible from the renderer, all of them the kind of thing that only
// goes wrong once a user has lived with the list for a week:
//
//  1. THE LIST DEDUPES BY ITEM, and the FIRST line wins. One item is one wish however many ways
//     the corpus offered it — an item's gear row and each of its donor rows all name the same
//     `itemKey` — and re-adding must not silently rewrite the `addedAt` and `source` the earlier
//     line carried.
//  2. A REMOVE FORGETS THE DISMISSAL TOO. A `clearedDone` id outliving its entry would be a
//     tombstone: add the item again and the list would accept the wish and then refuse to draw it.
//  3. THE SEED RUNS EXACTLY ONCE, ON THE FLAG AND NEVER ON EMPTINESS. This is the promise that
//     makes a deletion mean something — "seed when the list is empty" re-offers rows somebody has
//     already declined, forever — and it holds even when the seed imported nothing at all.
//  4. THE SEED IMPORTS UNMET SOCKETS ONLY, LABELLED, DEDUPED. A socket already merged to its
//     extraction tier is finished work; one donor socketed into three cells is one item to go and
//     get; and every imported row says it came from the plan so it can be recognised and deleted.
//
// Pure: `shared/planner/wishlist.ts` has no runtime dependency at all.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_WISHLIST,
  MAX_WISHES,
  addWish,
  applySeed,
  clearDone,
  hasWish,
  removeWish,
  seedWishes,
  type PlannedWish,
  type WishEntry,
  type WishList
} from '../src/shared/planner/wishlist'

const T0 = 1_700_000_000_000

function gearWish(key: string, at = T0): WishEntry {
  return { itemKey: key, name: key, kind: 'gear', addedAt: at, source: 'user' }
}

function donorWish(key: string, effect: string, at = T0): WishEntry {
  return { itemKey: key, name: key, kind: 'donor', effect, socket: 'proc', addedAt: at, source: 'user' }
}

/** A planned socket as the seed's caller decorates it. */
function planned(donorKey: string, effect: string, met = false): PlannedWish {
  return { donorKey, name: `${donorKey} (corpus)`, effect, socket: 'proc', met }
}

// ---- 1. the list dedupes by item -------------------------------------------------------------

test('one item is one wish, however many ways the corpus offered it', () => {
  let list: WishList = EMPTY_WISHLIST
  list = addWish(list, gearWish('blade of light'))
  list = addWish(list, donorWish('blade of light', 'Frost Strike', T0 + 5_000))
  assert.equal(list.entries.length, 1)
  assert.equal(hasWish(list, 'blade of light'), true)
})

test('the FIRST line wins — a re-add rewrites neither addedAt nor source', () => {
  const first = gearWish('batfang headband', T0)
  let list = addWish(EMPTY_WISHLIST, first)
  const before = list
  list = addWish(list, { ...donorWish('batfang headband', 'Bat Fang', T0 + 60_000), source: 'planImport' })
  assert.equal(list, before, 'an add that changes nothing must return the SAME object (no write, no re-render)')
  assert.equal(list.entries[0].addedAt, T0)
  assert.equal(list.entries[0].source, 'user')
  assert.equal(list.entries[0].kind, 'gear')
})

test('the list is bounded — a runaway add cannot grow it past the cap', () => {
  let list: WishList = EMPTY_WISHLIST
  for (let i = 0; i < MAX_WISHES + 20; i++) list = addWish(list, gearWish(`item ${String(i)}`))
  assert.equal(list.entries.length, MAX_WISHES)
})

// ---- 2. remove forgets the dismissal ---------------------------------------------------------

test('a remove drops the entry AND its dismissal — no tombstone survives the row', () => {
  let list = addWish(EMPTY_WISHLIST, gearWish('rusty short sword'))
  list = clearDone(list, ['rusty short sword'])
  assert.deepEqual(list.clearedDone, ['rusty short sword'])

  list = removeWish(list, 'rusty short sword')
  assert.deepEqual(list.entries, [])
  assert.deepEqual(list.clearedDone, [], 'a cleared id outliving its row would swallow the wish on re-add')

  // …and re-adding it is a wish that DRAWS, which is the failure the assertion above prevents.
  list = addWish(list, gearWish('rusty short sword'))
  assert.equal(hasWish(list, 'rusty short sword'), true)
  assert.equal(list.clearedDone.includes('rusty short sword'), false)
})

test('dismissing is idempotent and order-preserving', () => {
  let list = addWish(addWish(EMPTY_WISHLIST, gearWish('a')), gearWish('b'))
  list = clearDone(list, ['b', 'a'])
  const again = clearDone(list, ['a', 'b'])
  assert.equal(again, list, 'a dismissal that changes nothing must return the SAME object')
  assert.deepEqual(list.clearedDone, ['b', 'a'])
})

// ---- 3. the seed runs exactly once -----------------------------------------------------------

test('the seed runs ONCE — a second run imports nothing, even after every row is deleted', () => {
  const seeds = seedWishes([planned('batfang headband', 'Bat Fang')], T0)
  let list = applySeed(EMPTY_WISHLIST, seeds)
  assert.equal(list.entries.length, 1)
  assert.equal(list.seededFromPlans, true)

  // The user deletes what was offered. That is a decision, and re-offering it would overrule them.
  list = removeWish(list, 'batfang headband')
  assert.deepEqual(list.entries, [])
  const after = applySeed(list, seeds)
  assert.equal(after, list, 'a seeded list must come back identical — same object, nothing written')
  assert.deepEqual(after.entries, [])
})

test('the flag is set even when the seed imported NOTHING — "we looked" is the fact worth keeping', () => {
  const list = applySeed(EMPTY_WISHLIST, [])
  assert.equal(list.seededFromPlans, true)
  assert.deepEqual(list.entries, [])
  // A set planned AFTER the seed ran must not be silently imported later.
  const later = applySeed(list, seedWishes([planned('glowing bone collar', 'Bone')], T0 + 86_400_000))
  assert.deepEqual(later.entries, [])
})

test('a hand-typed wish survives the seed with its own label and instant', () => {
  const mine = gearWish('batfang headband', T0)
  const list = applySeed(addWish(EMPTY_WISHLIST, mine), seedWishes([planned('batfang headband', 'Bat Fang')], T0 + 1))
  assert.equal(list.entries.length, 1)
  assert.equal(list.entries[0].source, 'user')
  assert.equal(list.entries[0].addedAt, T0)
})

// ---- 4. what the seed imports ----------------------------------------------------------------

test('the seed imports UNMET sockets only — finished work is not a wish', () => {
  const seeds = seedWishes(
    [planned('batfang headband', 'Bat Fang', false), planned('glowing bone collar', 'Bone', true)],
    T0
  )
  assert.deepEqual(
    seeds.map((s) => s.itemKey),
    ['batfang headband']
  )
})

test('every imported row is LABELLED, carries its effect context, and names the corpus spelling', () => {
  const [seed] = seedWishes([planned('batfang headband', 'Bat Fang')], T0)
  assert.ok(seed)
  assert.equal(seed.source, 'planImport')
  assert.equal(seed.kind, 'donor')
  assert.equal(seed.effect, 'Bat Fang')
  assert.equal(seed.socket, 'proc')
  assert.equal(seed.name, 'batfang headband (corpus)')
  assert.equal(seed.addedAt, T0)
})

test('the seed DEDUPES by item — one donor socketed into three cells is one thing to go and get', () => {
  const seeds = seedWishes(
    [
      planned('batfang headband', 'Bat Fang'),
      planned('batfang headband', 'Bat Fang'),
      planned('batfang headband', 'Some Other Effect'),
      planned('glowing bone collar', 'Bone')
    ],
    T0
  )
  assert.deepEqual(
    seeds.map((s) => s.itemKey),
    ['batfang headband', 'glowing bone collar']
  )
  // The FIRST occurrence keeps its effect context, so the walk order is the choice.
  assert.equal(seeds[0].effect, 'Bat Fang')
})
