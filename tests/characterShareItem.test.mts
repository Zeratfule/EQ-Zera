// ============================================================================
// characterShareItem.test.mts — WHAT EACH WORN ITEM SAYS ON THE WIRE (body v2).
// ============================================================================
//
// The owner's report, 2026-09-09: long item names hid the ` +N` on the share card, and a reader of
// a profile had no way to ask what any of that gear DOES. Body generation 2 answers both by
// carrying each worn item's own reading (`src/shared/characterShareItem.ts`), and this spec is the
// four properties that keeps honest:
//
//   * IT IS THERE, AND IT IS THE ITEM AT ITS OWN RANK. The base name travels beside the rank, and
//     the stats are the ones the item reads at the ` +N` the dump spelled - not its base page.
//   * IT AGREES WITH THE TOTALS, TO THE DIGIT. Both halves go through `wornBlock` once, so the
//     per-item lines a reader can now hover are the numbers the card's total row was summed from.
//     A second scaler anywhere in the app shows up here as a mismatch.
//   * IT CLAIMS NOTHING ABOUT AN ITEM THE DATABASE HAS NOT GOT (law 1). `known:false` travels so a
//     page can say "not in the item database" instead of drawing an empty window.
//   * A STRANGER CANNOT SMUGGLE ANYTHING THROUGH IT. Every new field is rebuilt, capped and
//     bounded, and a v1 body - which carries none of this - still decodes exactly as it always did.
//
// It reads the same joined character `characterShare.test.mts` does (`characterShareFixture.mts`),
// so the two halves of one body are never tested against two different characters.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statInteger } from '../src/shared/characterSheet'
import {
  characterBlock,
  CHARACTER_SHARE_VERSION,
  sanitizeCharacterShare
} from '../src/shared/characterShare'
import { SHARE_LIMITS, canonicalJson, makeEnvelope } from '../src/shared/profiles'
import { decodeCharacterShare, encodeCharacterShare } from '../src/main/characterShare'
import { encodeShareString } from '../src/main/shareCodec'
import { APP, CAPTURED, profileOf } from './characterShareFixture.mjs'

// ---- v2: what each worn item says -------------------------------------------------------
//
// The owner's report, 2026-09-09: long names hid the ` +N`, and a reader of a profile had no way
// to ask what any of that gear DOES. So the body carries each item's own reading, and these are
// the four properties that keeps honest: it is there, it agrees with the totals, it never claims
// anything about an item the database has not got, and a stranger cannot smuggle anything through
// it.

test('every worn cell states its rank, its base name, and what the item reads at that rank', () => {
  const profile = profileOf()
  const hands = profile.cells.find((c) => c.slot === 'hands')
  assert.ok(hands, 'the fixture wears gauntlets')
  assert.equal(hands.item, 'Gauntlets of Fiery Might +5')
  assert.equal(hands.base, 'Gauntlets of Fiery Might', 'the name and the rank travel separately')
  assert.equal(hands.tier, 5)
  assert.equal(hands.known, true)
  // READ AT ITS OWN ` +N` (JOS-416's law, on this path too): the base page states AC 12 / STR +9,
  // and what travels is the +5 reading, which is what the totals were summed from.
  assert.equal(hands.ac, 15)
  const str = hands.stats?.find((s) => s.key === 'STR')
  assert.deepEqual(str, { key: 'STR', label: 'Strength', value: '+12' })
  assert.deepEqual(hands.flags, ['Magic Item'])

  // A weapon states its three numbers and its effect line; nothing else does.
  const primary = profile.cells.find((c) => c.slot === 'primary')
  assert.deepEqual(primary?.weapon, { dmg: 30, delay: 26, skill: '1H Slashing' })
  assert.equal(primary?.effects?.[0]?.kind, 'combat')
  assert.equal(primary?.effects?.[0]?.name, 'Dismiss Summoned')
  assert.equal(profile.cells.find((c) => c.slot === 'neck')?.weapon, undefined)
})

test('the per-item stats FOLD BACK into the totals, to the digit', () => {
  const profile = profileOf()
  // The one property that makes the hover card trustworthy: the lines a reader can now see per
  // item are the SAME numbers the card's total row was summed from, because both go through
  // `wornBlock` once. A second scaler anywhere would show up here as a mismatch.
  const summed = new Map<string, number>()
  const add = (label: string, n: number): void => summed.set(label, (summed.get(label) ?? 0) + n)
  let ac = 0
  for (const cell of profile.cells) {
    ac += cell.ac ?? 0
    if (cell.hp !== undefined) add('HP', cell.hp)
    if (cell.mana !== undefined) add('Mana', cell.mana)
    if (cell.endurance !== undefined) add('Endurance', cell.endurance)
    for (const stat of cell.stats ?? []) {
      const n = statInteger(stat.value)
      if (n !== null) add(stat.label, n)
    }
  }
  assert.equal(ac, profile.totals.ac, 'the AC on the card is the AC on the items')
  for (const row of [...profile.totals.stats, ...profile.totals.saves]) {
    assert.equal(summed.get(row.label), row.total, `${row.label} disagrees`)
  }
})

test('an item the database never had says so, and states nothing for it', () => {
  const profile = profileOf()
  // MEASURED, and it is the same one the sheet's own totals count as unknown: the wiki page for
  // `Djarn's Amethyst Ring` is titled without the apostrophe (law 12 forbids closing that with a
  // matcher). The cell still draws, and the body says why it is empty rather than looking empty.
  const unknown: string[] = []
  for (const cell of profile.cells) if (!cell.known) unknown.push(cell.item)
  assert.deepEqual(unknown, ["Djarn's Amethyst Ring +1"])
  const cell = profile.cells.find((c) => !c.known)
  assert.equal(cell?.stats, undefined, 'nothing is invented for an item nothing is known about')
  assert.equal(cell?.ac, undefined)
  assert.equal(cell?.flags, undefined)
  assert.equal(profile.totals.unknown, 1)
})

test('a v1 body still decodes, and claims no per-item facts it never carried', () => {
  const v1 = {
    v: 1,
    capturedAt: CAPTURED,
    name: 'Primitive',
    level: 60,
    classes: ['WAR'],
    look: { race: 'DW', sex: 'F' },
    cells: [
      { slot: 'chest', label: 'Chest', item: 'Red Dragonscale Armor +1', tier: 1, iconId: 7, exaltations: [] }
    ],
    totals: { ac: 21, stats: [{ label: 'HP', total: 80 }], saves: [], unsummed: [], counted: 1, unknown: 0 }
  }
  const back = decodeCharacterShare(encodeShareString(makeEnvelope('character', v1, APP)))
  assert.ok(back.ok, back.ok ? '' : back.error)
  assert.equal(back.profile.cells.length, 1)
  const cell = back.profile.cells[0]
  assert.equal(cell.item, 'Red Dragonscale Armor +1')
  assert.equal(cell.stats, undefined, 'a body that stated no stats gains none here')
  assert.equal(cell.base, undefined)
  // `known` DEFAULTS TO TRUE: a v1 body never claimed an item was missing from the database, and
  // this reader may not claim it on its behalf. Only an explicit `false` says so.
  assert.equal(cell.known, true)
  assert.equal(back.profile.v, CHARACTER_SHARE_VERSION, 'read forward into this generation')
})

test('junk in the per-item facts is dropped, never drawn', () => {
  const clean = sanitizeCharacterShare({
    ...profileOf(),
    cells: [
      {
        slot: 'chest',
        label: 'Chest',
        item: 'Breastplate +2',
        exaltations: [],
        known: 'yes please',
        base: 'x'.repeat(5_000),
        ac: Number.POSITIVE_INFINITY,
        hp: '80',
        stats: [
          { key: 'STR', label: 'Strength', value: '+15' },
          { key: 'STR', value: '+15' },
          { key: '', label: 'Nothing', value: '+1' },
          { key: 'HP', label: 'HP', value: '' },
          'not an object',
          null
        ],
        effects: [
          { kind: 'combat', name: 'Haste II', detail: 'Worn' },
          { kind: 'telepathy', name: 'Mind Control' },
          { kind: 'focus', name: '' }
        ],
        flags: ['Magic Item', '', 'x'.repeat(200), 42],
        weapon: { dmg: 'lots', delay: 26, skill: 'javascript:alert(1)' }
      }
    ]
  })
  assert.ok(clean)
  const cell = clean.cells[0]
  assert.equal(cell.known, true, 'anything that is not `false` is not a denial')
  assert.equal(cell.base?.length, SHARE_LIMITS.maxNameChars)
  assert.equal(cell.ac, undefined, 'Infinity is not an AC')
  assert.equal(cell.hp, undefined, 'a string is not a number of hit points')
  assert.deepEqual(cell.stats, [
    { key: 'STR', label: 'Strength', value: '+15' },
    { key: 'STR', label: 'STR', value: '+15' }
  ], 'a row missing its label keeps its key; a row missing key or value is not a row')
  assert.deepEqual(cell.effects, [{ kind: 'combat', name: 'Haste II', detail: 'Worn' }])
  assert.equal(cell.flags?.length, 2, 'an empty flag and a non-string are not flags')
  assert.equal(cell.flags?.[1].length, 24, 'and a flag is bounded')
  assert.deepEqual(cell.weapon, { delay: 26, skill: 'javascript:alert(1)' }, 'the skill is text, never a URL')
  assert.ok(!canonicalJson(clean).includes('telepathy'), 'a socket this build cannot name is dropped')
})

test('the per-item lists are capped', () => {
  const clean = sanitizeCharacterShare({
    ...profileOf(),
    cells: [
      {
        slot: 'chest',
        label: 'Chest',
        item: 'Breastplate',
        exaltations: [],
        known: true,
        stats: Array.from({ length: 500 }, () => ({ key: 'STR', label: 'Strength', value: '+1' })),
        effects: Array.from({ length: 500 }, () => ({ kind: 'worn', name: 'Haste' })),
        flags: Array.from({ length: 500 }, () => 'Magic Item')
      }
    ]
  })
  assert.ok(clean)
  assert.equal(clean.cells[0].stats?.length, SHARE_LIMITS.maxCellStats)
  assert.equal(clean.cells[0].effects?.length, SHARE_LIMITS.maxCellEffects)
  assert.equal(clean.cells[0].flags?.length, 8)
})

test('characterBlock is the totals, said once, with HP / Mana / Endurance picked out', () => {
  const profile = profileOf()
  const block = characterBlock(profile)
  assert.equal(block.ac, profile.totals.ac)
  assert.equal(block.level, 60)
  assert.deepEqual(block.classes, ['WAR', 'CLR', 'SHM'])
  assert.deepEqual(block.saves, profile.totals.saves)
  const byLabel = new Map(profile.totals.stats.map((s) => [s.label, s.total]))
  assert.equal(block.hp, byLabel.get('HP'))
  assert.equal(block.mana, byLabel.get('Mana'))
  assert.ok(block.hp > 0 && block.mana > 0, 'the fixture wears both, or this proves nothing')
  for (const row of block.stats) {
    assert.ok(!['HP', 'Mana', 'Endurance'].includes(row.label), 'the three fields are not also rows')
    assert.equal(byLabel.get(row.label), row.total, 'and every other row is the totals verbatim')
  }
  // A DERIVED VIEW, NOT A FIELD: nothing about the character block is on the wire.
  assert.ok(!canonicalJson(profile).includes('"character"'))
})

test('the fixture profile still fits in a chat message with every item stated', () => {
  const text = encodeCharacterShare(profileOf(), APP)
  assert.ok(text)
  console.log(`  v2 character share string: ${String(text.length)} chars for the 22-item fixture`)
  // The bar is 16 KB rather than the 64 KB decode cap so that growth is NOTICED here, in a test
  // naming a number, rather than at the share service's own limit.
  assert.ok(text.length < 16 * 1024, `${String(text.length)} chars`)
})

