// AN ITEM'S LOOK, BY NAME (EQ Zera, "preview this item on my character"): the committed game item
// table is keyed by the game's own item id, and `src/main/ipc/itemLookIndex.ts` re-keys it by name
// so an item PAGE - which has no id - can ask what it would look like on the model.
//
// The real committed table is the fixture. That is the point: the fold, the rename overlay and the
// rule for a name several item ids answer to are only interesting against the data actually
// shipped, and a re-scrape that moved one of these facts should say so here.
//
// (The handler itself, `src/main/ipc/itemLook.ts`, imports `ipcMain` and so cannot be loaded by a
// node test at all - it is three lines around `lookupItemLook`, which is what this file exercises.)

import test from 'node:test'
import assert from 'node:assert/strict'
import { lookupItemLook } from '../src/main/ipc/itemLookIndex'
import { ITEM_RENAMES, renameItemName } from '../src/shared/itemRenames'

test('the committed table answers by NAME the same look it answers by id', () => {
  // The exact expectation `tests/eqAssets.test.mts` pins on the id side: item 27715 is a monk fist
  // weapon and draws as IT68, not as a mace. Reached here through the name alone.
  assert.equal(lookupItemLook("Wu's Fist of Mastery")?.model, 'IT68', 'the monk fist weapon, by name')

  const ykesha = lookupItemLook('Short Sword of the Ykesha')
  assert.deepEqual(ykesha, { model: 'IT87', material: 0, color: 0xff000000, looks: 1 })
})

test('the name is folded the way every other item key is: the ` +N` tier comes off and case does not matter', () => {
  const base = lookupItemLook('Short Sword of the Ykesha')
  assert.ok(base)
  assert.deepEqual(lookupItemLook('Short Sword of the Ykesha +3'), base, 'a +3 is the same item (law 2)')
  assert.deepEqual(lookupItemLook('SHORT SWORD OF THE YKESHA'), base)
  assert.deepEqual(lookupItemLook('short sword of the ykesha'), base)
  assert.deepEqual(lookupItemLook('  Short Sword of the Ykesha  '), base, 'and the edges are trimmed')
})

test('a name the table does not know, and a name that is not a name, are both null rather than a guess', () => {
  assert.equal(lookupItemLook('Sword of a Thousand Truths'), null)
  assert.equal(lookupItemLook(''), null)
  assert.equal(lookupItemLook('   '), null)
  assert.equal(lookupItemLook('x'.repeat(121)), null, 'an implausibly long name is refused before it is looked up')
  for (const bad of [42, null, undefined, {}, ['Short Sword of the Ykesha']]) {
    assert.equal(lookupItemLook(bad), null, `${typeof bad} is not a name`)
  }
})

test('when the ids under one name DISAGREE, the count says so and the lowest id is the stated answer', () => {
  // Ten item ids spell "Golden Efreeti Boots" and they carry four distinct (model, material, dye)
  // triples - the same name re-used across eras. Law 12: no closest match, no invented winner. The
  // look is the LOWEST id's (4407), and `looks` is what lets the UI say "one of 4".
  const boots = lookupItemLook('Golden Efreeti Boots')
  assert.deepEqual(boots, { model: 'IT63', material: 3, color: 0xffd5be00, looks: 4 })

  const agreed = lookupItemLook('Short Sword of the Ykesha')
  assert.equal(agreed?.looks, 1, 'two ids that agree are one look, and nothing to report')
})

test('the rename overlay is folded into the index - and today it renames nothing, which is the honest answer', () => {
  // `src/shared/itemRenames.ts` is EMPTY as of 2026-08-22 (its one row retired when the rescrape
  // landed the rename upstream), so there is no item in the committed table whose two spellings
  // this test could pin. Asserting the emptiness is the honest version of that: it fails the day a
  // row lands, and whoever lands it can pin both spellings here.
  assert.equal(ITEM_RENAMES.length, 0, 'no rename rows today; add a both-spellings case when one lands')
  assert.equal(renameItemName('Short Sword of the Ykesha'), 'Short Sword of the Ykesha', 'identity for everything unnamed')

  // What the index does with a rename is still worth stating: a renamed row keys under BOTH
  // spellings, so a player's log or a stale share bundle spelling the old name still resolves.
  // With an empty table every row keys once, under its own spelling, which is what this checks.
  assert.ok(lookupItemLook('Valorium Helmet'), 'a plain name resolves under its own spelling')
})
