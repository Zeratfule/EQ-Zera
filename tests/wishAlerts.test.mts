// WHICH WISH-LIST NEWS DESERVES A CARD (EQ Zera, wish-list drop alerts).
//
// `features/wishlist/wishAlerts.ts` is the whole decision behind both wish cards, and it is pure so
// that every rule below is pinned here rather than by standing in Guk with a wish list open. The
// hook around it owns only the live-only baselines, the 30-minute per-zone window and the send.
//
// WHAT IS WORTH PINNING, and why each one is not obvious:
//   * a DESTROY rides the same loot lane as an acquisition (JOS-401). Congratulating somebody for
//     throwing away the thing they wrote down that they wanted is the failure this guards.
//   * an item that is NOT on the list says nothing. The list is the whole subscription.
//   * the join is on `itemKey`, so the card fires for the log's ` +2` spelling of a wished item and
//     prints the LOG'S OWN name on the card (world-model law 2).
//   * the ZONE JOIN reaches through BOTH authorities — the `zoneKey` fold and the verified rename
//     table — because log "The Ruins of Old Paineel" is catalog "The Hole" and a fold alone finds
//     nothing there. Both are driven here through the REAL functions (`zoneKey`, `catalogZonesFor`)
//     rather than through stubs, so this test fails if either fold ever moves.
//   * the GRAMMAR of one versus many, because "1 wished items drop here" reads as a defect.
//   * the "and N more" tail, because a list you write yourself gets long.
//
// No window, no React, no Electron — this suite can never skip.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LootEvent } from '../src/shared/types'
import type { WishEntry } from '../src/shared/planner/wishlist'
import { catalogZonesFor } from '../src/shared/zones'
import { zoneKey } from '../src/renderer/src/features/mobs/mobZone'
import { sourceItemKey } from '../src/renderer/src/lib/itemSources'
import { wishDropRequests, wishZoneItems, wishZoneRequest } from '../src/renderer/src/features/wishlist/wishAlerts'

const BLADE = 'Earthen Blade'
const BLADE_KEY = sourceItemKey(BLADE)

/** One wish, the way the add control writes one (`wishFromGear`). */
function wish(name: string): WishEntry {
  return { itemKey: sourceItemKey(name), name, kind: 'gear', addedAt: 1, source: 'user' }
}

/** One self-loot line, the way the engine hands it to the renderer. */
function loot(item: string, extra: Partial<LootEvent> = {}): LootEvent {
  return { ts: 1_700_000_000_000, item, ...extra }
}

const WISHED = new Map([[BLADE_KEY, wish(BLADE)]])

// ---- 1. it dropped ---------------------------------------------------------------------------

test('a wished item looted LIVE earns a card: the item, where it came from, and the list to click', () => {
  const e = loot(BLADE, { source: 'a shadowed man', zone: 'The Ruins of Old Paineel' })
  const out = wishDropRequests([e], WISHED, sourceItemKey)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], {
    id: `wishDrop:${BLADE_KEY}:1700000000000`,
    kind: 'wishDrop',
    title: 'Earthen Blade dropped',
    subtitle: 'from a shadowed man · The Ruins of Old Paineel',
    // The item card is resolved in main from this NAME, exactly as a Sky reward is.
    itemName: BLADE,
    focus: { view: 'wishlist' }
  })
})

test('the subtitle prints only what the LINE stated - never a corpse it had to invent', () => {
  const sub = (e: LootEvent): string | undefined => wishDropRequests([e], WISHED, sourceItemKey)[0].subtitle
  assert.equal(sub(loot(BLADE, { source: 'a shadowed man' })), 'from a shadowed man')
  assert.equal(sub(loot(BLADE, { zone: 'The Hole' })), 'The Hole')
  assert.equal(sub(loot(BLADE)), undefined)
})

test('an item nobody wished for says NOTHING - the list is the whole subscription', () => {
  assert.deepEqual(wishDropRequests([loot('Rusty Dagger', { source: 'a rat' })], WISHED, sourceItemKey), [])
})

test('a DESTROY is not a drop (JOS-401) - the one card this feature must never draw', () => {
  const destroyed = loot(BLADE, { disposition: 'destroyed', source: 'a shadowed man' })
  assert.deepEqual(wishDropRequests([destroyed], WISHED, sourceItemKey), [])
})

test('the join is the corpus key, so a +N spelling still fires - and the card prints the log', () => {
  const out = wishDropRequests([loot('Earthen Blade +2')], WISHED, sourceItemKey)
  assert.equal(out.length, 1)
  assert.equal(out[0].title, 'Earthen Blade +2 dropped', 'law 2: the card prints what the game printed')
  assert.equal(out[0].id, `wishDrop:${BLADE_KEY}:1700000000000`, 'and the id is the canonical key')
})

test('a batch is one card per matching line, in the order the lines arrived', () => {
  const events = [loot(BLADE, { ts: 10 }), loot('Rusty Dagger', { ts: 11 }), loot(BLADE, { ts: 12 })]
  const out = wishDropRequests(events, WISHED, sourceItemKey)
  assert.deepEqual(out.map((r) => r.id), [`wishDrop:${BLADE_KEY}:10`, `wishDrop:${BLADE_KEY}:12`])
})

// ---- 2. it drops here ------------------------------------------------------------------------
//
// The zone half is driven through the REAL folds. `Earthen Blade` is a committed catalog drop whose
// eight sources are all homed in "The Hole", and the log's own spelling of that place is
// "The Ruins of Old Paineel" — the rename `shared/zones.ts` records and `mobsInZone` unions in.

/** The catalog's answer for a key, hand-made: this suite is about the JOIN, not about mobs.json. */
const sourcesFor = (key: string): readonly { zones: readonly string[] }[] =>
  key === BLADE_KEY ? [{ zones: ['The Hole'] }] : []

function zoneArgs(zone: string, wishes: readonly WishEntry[]): Parameters<typeof wishZoneRequest>[0] {
  return { zone, wishes, sourcesFor, zoneKey, aliases: catalogZonesFor(zone), now: 1_700_000_000_000 }
}

test('the zone join folds BOTH sides - the catalog spelling reaches the wish', () => {
  assert.deepEqual(wishZoneItems(zoneArgs('The Hole', [wish(BLADE)])), [BLADE])
  // …instance noise and all, which is what the character module actually carries.
  assert.deepEqual(wishZoneItems(zoneArgs('The Hole - Solo 4 (Refined)', [wish(BLADE)])), [BLADE])
})

test('…and it reaches through a VERIFIED RENAME, which a fold alone cannot', () => {
  // The two names are one place; nothing about "ruins of old paineel" folds onto "hole".
  assert.notEqual(zoneKey('The Ruins of Old Paineel'), zoneKey('The Hole'))
  assert.deepEqual(catalogZonesFor('The Ruins of Old Paineel'), ['The Hole'])
  assert.deepEqual(wishZoneItems(zoneArgs('The Ruins of Old Paineel', [wish(BLADE)])), [BLADE])
})

test('a zone nothing on the list drops in is SILENT, and so is a blank one', () => {
  assert.equal(wishZoneRequest(zoneArgs('Innothule Swamp', [wish(BLADE)])), null)
  assert.equal(wishZoneRequest(zoneArgs('', [wish(BLADE)])), null)
  assert.equal(wishZoneRequest(zoneArgs('The Hole', [])), null, 'no wishes at all is null, not an empty card')
})

test('ONE wished item DROPS here; several DROP - the sentence, not a template', () => {
  const one = wishZoneRequest(zoneArgs('The Hole', [wish(BLADE)]))
  assert.equal(one?.title, '1 wished item drops here')
  assert.equal(one.subtitle, BLADE)
  assert.equal(one.kind, 'wishZone')
  assert.deepEqual(one.focus, { view: 'wishlist' })
  assert.equal(one.id, `wishZone:${zoneKey('The Hole')}:1700000000000`)
  // No item card: a zone is not a thing you can hold, so the CARD is its own click target.
  assert.equal('itemName' in one, false)
})

test('the subtitle names three and COUNTS the rest', () => {
  const many = ['A Blade', 'B Blade', 'C Blade', 'D Blade', 'E Blade']
  const all = (key: string): readonly { zones: readonly string[] }[] =>
    many.some((n) => sourceItemKey(n) === key) ? [{ zones: ['The Hole'] }] : []
  const args = { ...zoneArgs('The Hole', many.map(wish)), sourcesFor: all }
  const req = wishZoneRequest(args)
  assert.equal(req?.title, '5 wished items drop here')
  assert.equal(req.subtitle, 'A Blade · B Blade · C Blade and 2 more')

  const three = { ...args, wishes: many.slice(0, 3).map(wish) }
  assert.equal(wishZoneRequest(three)?.subtitle, 'A Blade · B Blade · C Blade', 'exactly three needs no tail')
})
