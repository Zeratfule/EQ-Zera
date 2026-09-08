// THE ADD CONTROL'S CORPUS SEARCH — two indices, one result list (JOS-326).
//
// The feature this pins is "one add control that searches the WHOLE corpus": a player writing a
// wish list must not have to know whether the thing they want is an equippable gear row or an
// effect-bearing donor row, and a result list that answered from only one index would send them
// back to the tab they came from.
//
// FIXTURES RATHER THAN THE COMMITTED CORPUS, deliberately, and this is the one place in the
// planner suite where that is the right call. `tests/plannerFarm.test.mts` anchors on the real mob
// catalog because the thing under test IS a claim about that data. Here the thing under test is
// the JOIN and the RANKING — which index answered, in what order, adjacent to what — and a fixture
// is what makes "the gear row leads its own donor rows" statable at all. The real corpus is
// exercised end to end by tests/e2e/planner.e2e.mts.
//
// Pure: `wishSearch.ts` takes both row arrays as data and touches no React, IPC or storage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GearRow } from '../src/shared/planner/gear'
import type { DonorRow } from '../src/renderer/src/features/planner/plannerData'
import {
  MIN_WISH_QUERY,
  searchWishCorpus,
  wishFromDonor,
  wishFromGear,
  wishFromHit
} from '../src/renderer/src/features/wishlist/wishSearch'

const T0 = 1_700_000_000_000

/** The minimum a gear row needs to be searched and drawn. `searchKey` is the table's own widened
 *  haystack (gearData.toRow folds the effect names in), which is why it is set explicitly here. */
function gear(name: string, searchKey = name): GearRow {
  return {
    key: name.toLowerCase(),
    name,
    searchKey: searchKey.toLowerCase(),
    slots: ['CHEST'],
    classes: ['WAR'],
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats: {},
    effects: []
  }
}

function donor(name: string, effect: string): DonorRow {
  return {
    key: name.toLowerCase(),
    name,
    searchKey: `${name} ${effect}`.toLowerCase(),
    slots: ['PRIMARY'],
    classes: ['WAR'],
    effect,
    socket: 'proc',
    tierRequired: 4,
    hasteLocked: false,
    quest: false,
    playerCrafted: false
  }
}

// A corpus with all four shapes that matter: an item in BOTH indices, a gear-only item, a
// donor-only item (a potion states no equip slot, so it is not a gear row at all), and an item
// that only matches through its EFFECT text.
const GEAR: GearRow[] = [
  gear('Blade of Light', 'Blade of Light Frost Strike'),
  gear('Blade Guard'),
  gear('Reinforced Breastplate', 'Reinforced Breastplate Improved Healing III')
]
const DONORS: DonorRow[] = [
  donor('Blade of Light', 'Frost Strike'),
  donor('Blade of Light', 'Aura of Battle'),
  donor('Elixir of Speed', 'Improved Healing III')
]

// ---- the union ------------------------------------------------------------------------------

test('one query reaches BOTH indices, and every row says which kind it is', () => {
  const hits = searchWishCorpus(GEAR, DONORS, 'blade')
  const kinds = new Set(hits.map((h) => h.kind))
  assert.ok(kinds.has('gear'), 'no gear row came back')
  assert.ok(kinds.has('donor'), 'no donor row came back')
  assert.ok(
    hits.every((h) => h.kind === 'gear' || h.kind === 'donor'),
    'every hit must be labelled'
  )
})

test('a donor-only item is reachable — a potion states no equip slot and is not a gear row', () => {
  const hits = searchWishCorpus(GEAR, DONORS, 'elixir')
  assert.deepEqual(
    hits.map((h) => `${h.kind}:${h.name}`),
    ['donor:Elixir of Speed']
  )
  assert.equal(hits[0].effect, 'Improved Healing III')
  assert.equal(hits[0].socket, 'proc')
  assert.equal(hits[0].tierRequired, 4)
})

test('searching an EFFECT finds both witnesses to it — the gear row and the donor row', () => {
  const names = searchWishCorpus(GEAR, DONORS, 'improved healing').map((h) => `${h.kind}:${h.name}`)
  assert.ok(names.includes('gear:Reinforced Breastplate'), names.join(', '))
  assert.ok(names.includes('donor:Elixir of Speed'), names.join(', '))
})

// ---- the ranking ----------------------------------------------------------------------------

test("an item's offers are ADJACENT, gear row first — three results with one name is not three answers", () => {
  const hits = searchWishCorpus(GEAR, DONORS, 'blade of light')
  const light = hits.filter((h) => h.name === 'Blade of Light')
  assert.equal(light.length, 3, 'one gear row plus its two donor rows')
  const first = hits.findIndex((h) => h.name === 'Blade of Light')
  assert.deepEqual(hits.slice(first, first + 3), light, "the item's offers must not be scattered")
  assert.equal(light[0].kind, 'gear')
  // The donor rows are ordered by their own effect name, so the list is stable across runs.
  assert.deepEqual(
    light.slice(1).map((h) => h.effect),
    ['Aura of Battle', 'Frost Strike']
  )
})

test('a NAME match outranks an effect-only match — typing a name meant the names', () => {
  // "Frostbrand" starts with the needle; "Blade of Light" reaches it only through the effect text
  // its own donor row carries ("Frost Strike"). Both are real answers; one is what was typed.
  const rows = [...GEAR, gear('Frostbrand')]
  const hits = searchWishCorpus(rows, DONORS, 'frost')
  assert.equal(hits[0].name, 'Frostbrand', hits.map((h) => h.name).join(', '))
  assert.ok(
    hits.some((h) => h.name === 'Blade of Light'),
    'the effect-only match is still an answer, just not the leading one'
  )
})

test('a name SUBSTRING sits between a prefix and an effect-only match', () => {
  const rows = [gear('Frostbrand'), gear('Blade of Frost'), gear('Plain Helm', 'Plain Helm Frost Strike')]
  assert.deepEqual(
    searchWishCorpus(rows, [], 'frost').map((h) => h.name),
    ['Frostbrand', 'Blade of Frost', 'Plain Helm']
  )
})

test('the shortest name wins a tie, then alphabetical — main`s own picker rule, restated once', () => {
  const rows = [gear('Ring of Pureblood'), gear('Ring'), gear('Ring of Ash')]
  assert.deepEqual(
    searchWishCorpus(rows, [], 'ring').map((h) => h.name),
    ['Ring', 'Ring of Ash', 'Ring of Pureblood']
  )
})

// ---- the bounds -----------------------------------------------------------------------------

test('a query shorter than the floor answers with NOTHING, not with the whole corpus', () => {
  assert.deepEqual(searchWishCorpus(GEAR, DONORS, 'b'), [])
  assert.deepEqual(searchWishCorpus(GEAR, DONORS, '   '), [])
  assert.equal(MIN_WISH_QUERY, 2)
})

test('the result list is capped — a longer query is how you narrow, not a scrollbar', () => {
  const rows = Array.from({ length: 200 }, (_, i) => gear(`Ring ${String(i).padStart(3, '0')}`))
  assert.equal(searchWishCorpus(rows, [], 'ring', 12).length, 12)
})

// ---- what a taken offer becomes ---------------------------------------------------------------

test('a taken GEAR offer records the item and claims nothing about an effect', () => {
  const entry = wishFromGear({ key: 'blade guard', name: 'Blade Guard' }, T0)
  assert.deepEqual(entry, {
    itemKey: 'blade guard',
    name: 'Blade Guard',
    kind: 'gear',
    addedAt: T0,
    source: 'user'
  })
})

test('a taken DONOR offer carries the effect AND the socket — the socket is what prices the merge', () => {
  const entry = wishFromDonor(DONORS[0], T0)
  assert.deepEqual(entry, {
    itemKey: 'blade of light',
    name: 'Blade of Light',
    kind: 'donor',
    effect: 'Frost Strike',
    socket: 'proc',
    addedAt: T0,
    source: 'user'
  })
})

test('`wishFromHit` dispatches on the hit`s own kind, and both are labelled `user`', () => {
  const hits = searchWishCorpus(GEAR, DONORS, 'blade of light')
  const entries = hits.map((h) => wishFromHit(h, T0))
  assert.deepEqual(
    entries.map((e) => e.kind),
    hits.map((h) => h.kind)
  )
  assert.ok(entries.every((e) => e.source === 'user'), 'nothing the user clicked may claim to be an import')
  // Every offer for one item lands on the SAME key, which is what makes the list dedupe them.
  const light = entries.filter((e) => e.name === 'Blade of Light')
  assert.equal(new Set(light.map((e) => e.itemKey)).size, 1)
})
