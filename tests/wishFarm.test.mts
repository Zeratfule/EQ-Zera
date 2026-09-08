// THE WISH LIST, TURNED INTO A ROUTE — the derivation and the done detection (JOS-326).
//
// The Farm tab is gone and its arithmetic is not: `plannerFarm.groupNeeds` still decides which
// zone a row is filed under, and `tests/plannerFarm.test.mts` still anchors that on the real mob
// catalog. What is new is the COLLECTION half — wishes in, `FarmNeed`s out — and it has three
// promises the grouping cannot check for itself:
//
//  1. EITHER INDEX MAY ANSWER, AND NEITHER HAS TO. A donor wish resolves by (key, effect) against
//     the donor corpus; a gear wish resolves by key against the gear index; a wish neither carries
//     still produces a row, from the name it was saved with and the mob catalog's own answer.
//  2. THE MERGE COST IS DONOR-ONLY. "needs +4" answers "how far up the ladder before this effect
//     can be EXTRACTED", which a gear wish never asked — so `tierRequired` is absent there and the
//     row prints nothing about merging.
//  3. FULFILLED MEANS TWO DIFFERENT THINGS. A donor wish is done at `ready` and not one tier
//     earlier; a gear wish is done the moment you have one, whatever the merge ladder says. Asking
//     the ladder about a helm you are wearing would leave it in the route forever.
//
// THE ANCHOR IS THE REAL CATALOG, the plannerFarm precedent: Batfang Headband is a committed mob
// row (`src/renderer/src/data/eqlegends/mobs.json`) and the zones below were read out of it. If a
// rescrape moves them this test is supposed to notice.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GearRow } from '../src/shared/planner/gear'
import type { WishEntry } from '../src/shared/planner/wishlist'
import type { DonorRow } from '../src/renderer/src/features/planner/plannerData'
import { indexDonors } from '../src/renderer/src/features/planner/plannerData'
import { groupNeeds } from '../src/renderer/src/features/planner/plannerFarm'
import type { DonorProgress } from '../src/renderer/src/features/planner/plannerProgress'
import {
  collectWishNeeds,
  indexGear,
  wishFulfilled,
  type WishIndices
} from '../src/renderer/src/features/wishlist/wishFarm'

const HEADBAND = 'batfang headband'
/** The one classic-era zone the committed catalog names for the headband. */
const WPK = 'Western Plains of Karana'

const NOTHING_KNOWN: DonorProgress = { state: 'planned', label: 'planned', tierRequired: 4, held: 0, looted: 0 }

function progress(over: Partial<DonorProgress> = {}): DonorProgress {
  return { ...NOTHING_KNOWN, ...over }
}

function donorWish(itemKey: string, effect: string): WishEntry {
  return { itemKey, name: itemKey, kind: 'donor', effect, socket: 'proc', addedAt: 0, source: 'user' }
}

function gearWish(itemKey: string, name = itemKey): WishEntry {
  return { itemKey, name, kind: 'gear', addedAt: 0, source: 'user' }
}

function donorRow(key: string, effect: string): DonorRow {
  return {
    key,
    name: 'Batfang Headband',
    searchKey: `${key} ${effect}`.toLowerCase(),
    slots: ['HEAD'],
    classes: ['WAR', 'ROG'],
    effect,
    socket: 'proc',
    tierRequired: 4,
    hasteLocked: false,
    quest: false,
    playerCrafted: false,
    eraTag: 'Classic'
  }
}

function gearRow(key: string, name: string, over: Partial<GearRow> = {}): GearRow {
  return {
    key,
    name,
    searchKey: name.toLowerCase(),
    slots: ['CHEST'],
    classes: ['WAR'],
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats: {},
    effects: [],
    ...over
  }
}

function indices(donors: DonorRow[] = [], gear: GearRow[] = []): WishIndices {
  return { donors: indexDonors(donors), gear: indexGear(gear) }
}

// ---- 1. either index may answer, and neither has to -------------------------------------------

test('a DONOR wish resolves against the donor corpus by (key, effect)', () => {
  const [need] = collectWishNeeds(
    [donorWish(HEADBAND, 'Bat Fang')],
    indices([donorRow(HEADBAND, 'Bat Fang')]),
    () => progress()
  )
  assert.ok(need)
  assert.equal(need.name, 'Batfang Headband', 'the corpus spelling wins over the stored one')
  assert.equal(need.effect, 'Bat Fang')
  assert.equal(need.tierRequired, 4)
  assert.deepEqual(need.classes, ['WAR', 'ROG'])
  assert.equal(need.id, HEADBAND)
})

test('a GEAR wish resolves against the gear index by key — the other index, the same five facts', () => {
  const [need] = collectWishNeeds(
    [gearWish('reinforced breastplate')],
    indices([], [gearRow('reinforced breastplate', 'Reinforced Breastplate', { quest: true })]),
    () => progress()
  )
  assert.ok(need)
  assert.equal(need.name, 'Reinforced Breastplate')
  assert.equal(need.quest, true)
  assert.deepEqual(need.slots, ['CHEST'])
  assert.equal(need.effect, undefined)
})

test('a wish NEITHER index carries still produces a row — the saved name, and nothing claimed', () => {
  const [need] = collectWishNeeds([gearWish('a thing', 'A Thing')], indices(), () => progress())
  assert.ok(need)
  assert.equal(need.name, 'A Thing')
  assert.deepEqual(need.classes, [])
  assert.deepEqual(need.slots, [])
  assert.equal(need.quest, false)
  assert.equal(need.playerCrafted, false)
  assert.deepEqual(need.subject, { key: 'a thing' })
})

test('the CATALOG still answers for a wish the item corpus lost — the zones survive the row', () => {
  // No donor row, no gear row: everything below comes from the committed mob catalog alone, which
  // is exactly what a rescrape that dropped a page must not be allowed to erase.
  const [need] = collectWishNeeds([donorWish(HEADBAND, 'Bat Fang')], indices(), () => progress())
  assert.ok(need)
  assert.ok(need.zones.includes(WPK), `zones were ${need.zones.join(', ')}`)
  // The tier falls back to the SOCKET's own (R1: proc extracts at +4), so the cost still prints.
  assert.equal(need.tierRequired, 4)
})

// ---- 2. the merge cost is donor-only ----------------------------------------------------------

test('a GEAR wish states NO merge tier — looting it is the whole job', () => {
  const [need] = collectWishNeeds(
    [gearWish('reinforced breastplate')],
    indices([], [gearRow('reinforced breastplate', 'Reinforced Breastplate')]),
    () => progress()
  )
  assert.equal(need.tierRequired, undefined)
  assert.equal(need.socket, undefined)
})

// ---- the grouping is the old one, unchanged ---------------------------------------------------

test('wishes group by zone exactly as planned sockets did, and each appears EXACTLY once', () => {
  const needs = collectWishNeeds(
    [donorWish(HEADBAND, 'Bat Fang'), donorWish('glowing bone collar', 'Bone'), gearWish('an item nobody drops')],
    indices(),
    () => progress()
  )
  for (const eraOnly of [true, false]) {
    const rows = groupNeeds(needs, { eraOnly }).flatMap((g) => g.rows)
    assert.equal(rows.length, needs.length)
    assert.equal(new Set(rows.map((r) => r.id)).size, needs.length)
  }
  // With the era filter on, the headband leads with the zone you can actually reach (JOS-42's
  // trust invariant, asked here about a wish rather than a socket).
  const groups = groupNeeds(needs, { eraOnly: true })
  const headband = groups.find((g) => g.rows.some((r) => r.itemKey === HEADBAND))
  assert.equal(headband?.title, WPK)
})

test('an item nothing places keeps an honest non-zone heading rather than an invented zone', () => {
  const needs = collectWishNeeds([gearWish('an item nobody drops')], indices(), () => progress())
  const groups = groupNeeds(needs, { eraOnly: true })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].kind, 'unknown')
})

test('a crafted wish files under Crafted — the flag comes from whichever index answered', () => {
  const needs = collectWishNeeds(
    [gearWish('a crafted thing')],
    indices([], [gearRow('a crafted thing', 'A Crafted Thing', { playerCrafted: true })]),
    () => progress()
  )
  assert.equal(groupNeeds(needs, { eraOnly: true })[0].kind, 'crafted')
})

// ---- 3. done detection ------------------------------------------------------------------------

test('a DONOR wish is done at `ready`, and NOT one tier earlier', () => {
  const wish = donorWish(HEADBAND, 'Bat Fang')
  assert.equal(wishFulfilled(wish, progress({ state: 'ready', label: 'ready', tier: 4 })), true)
  assert.equal(
    wishFulfilled(wish, progress({ state: 'partial', label: '+2/+4', tier: 2 })),
    false,
    '"+2 of the +4 you need" is how much farming is LEFT — moving it to the done strip deletes that'
  )
  assert.equal(
    wishFulfilled(wish, progress({ state: 'have', label: 'have donor', held: 1 })),
    false,
    'holding an unmerged donor is not the effect extracted'
  )
  assert.equal(wishFulfilled(wish, progress()), false)
})

test('a GEAR wish is done the moment you HAVE one — the merge ladder is not consulted', () => {
  const wish = gearWish('reinforced breastplate')
  assert.equal(wishFulfilled(wish, progress({ held: 1 })), true)
  assert.equal(wishFulfilled(wish, progress({ looted: 3 })), true)
  assert.equal(wishFulfilled(wish, progress()), false)
  // A `+0` observation on an item you own cannot un-own it: the state says `partial`, and a gear
  // wish does not read the state at all.
  assert.equal(wishFulfilled(wish, progress({ state: 'partial', label: '+0/+4', tier: 0, held: 1 })), true)
})

test('the two rules disagree on the SAME progress, which is the whole reason there are two', () => {
  const held = progress({ state: 'have', label: 'have donor', held: 1 })
  assert.equal(wishFulfilled(gearWish('x'), held), true)
  assert.equal(wishFulfilled(donorWish('x', 'Some Effect'), held), false)
})

test('a gear wish is asked about progress at tier 1 — a formality its verdict never reads', () => {
  const asked: number[] = []
  collectWishNeeds([gearWish('x')], indices(), (_key, tier) => {
    asked.push(tier)
    return progress()
  })
  assert.deepEqual(asked, [1], 'anything higher would draw an owned helm as "+0/+4"')
})
