// mobLootLinks.test.mts — a mob page's loot written as `[[Item]]` LINKS, not `{{:Item}}`
// transclusions.
//
// The wiki increasingly writes `|known_loot` as plain links (2026-10-18 cache: 317 mob pages
// link-only, 548 mixing both forms), and `parseMobLoot` used to read transclusions alone, so a
// page rewritten to links lost every drop (Tae Ew Archon, rev 2026-09-04). A loot field also links
// group pages ("Fine Steel Weapons"), zones and spells, so a link counts ONLY when its target is a
// page in the committed item corpus. Every wikitext below is VERBATIM from that cache.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMobLoot, parseMobWikitext } from '../src/main/mobLookupParse'
import { corpusItemTest, corpusScrollTest, itemKey, type ItemDbFile } from '../src/main/itemsDb'
import itemsRaw from '../src/main/data/items.json' with { type: 'json' }
import mobsRaw from '../src/renderer/src/data/eqlegends/mobs.json' with { type: 'json' }
import type { MobEntry } from '../src/shared/types'

const isItem = corpusItemTest((itemsRaw as unknown as ItemDbFile).items)
const isScroll = corpusScrollTest((itemsRaw as unknown as ItemDbFile).items)
const MOBS = (mobsRaw as unknown as { mobs: MobEntry[] }).mobs

// Tae Ew Archon (Temple of Cazic-Thule), page 41606, `|known_loot` verbatim.
const ARCHON_LOOT = `<ul style="column-count: 1;">
<li>[[Rubicite Vambraces]] <span class="drare">(Rare)</span><br><span style="white-space: nowrap;">(Confirmed 9/4/2026)</span></li>
<li>[[Ravenscale Armguards]] <span class="drare">(Rare)</span><br><span style="white-space: nowrap;">(Confirmed 9/4/2026)</span></li>
<li>Various [[Fine Steel Weapons]] <span class="drare">(Common)</span></li>
<li>[[Lizardscale Belt]] <span class="drare">(Common)</span></li>
<li>[[Lizard Meat]] <span class="drare">(Uncommon)</span></li>
</ul>

</li></ul>`

test('the link form is read: Tae Ew Archon states four item drops with their rarities', () => {
  assert.deepEqual(parseMobLoot(ARCHON_LOOT, { isItem }), [
    { item: 'Rubicite Vambraces', rarity: 'Rare' },
    { item: 'Ravenscale Armguards', rarity: 'Rare' },
    { item: 'Lizardscale Belt', rarity: 'Common' },
    { item: 'Lizard Meat', rarity: 'Uncommon' }
  ])
})

test('a non-item link in the loot section is ignored, never guessed into a drop', () => {
  // "Fine Steel Weapons" (a group page) is in the Archon list above and must not appear.
  assert.ok(!isItem('Fine Steel Weapons'), 'the corpus grew a "Fine Steel Weapons" item page')
  const drops = parseMobLoot(ARCHON_LOOT, { isItem }).map((d) => d.item)
  assert.ok(!drops.includes('Fine Steel Weapons'))
  // A zone link reads as nothing; the scroll link beside it reads as the SCROLL (tests below).
  assert.deepEqual(parseMobLoot('* Found in [[Lower Guk]]\n</li><li> [[Cripple|Spell: Cripple]]         <span class=\'drare\'>(Rare)</span>', { isItem }), [
    { item: 'Spell: Cripple', rarity: 'Rare' }
  ])
})

// ---- scroll links: `[[Spell page|Spell: Item]]` -----------------------------------------------
// The wiki links a scroll drop to the SPELL and labels it with the ITEM. 2,382 links in the
// 2026-11-25 cache are labelled `Spell:`/`Song:`; 329 of those labels are an item page.

test('a scroll link reads as the scroll item its LABEL names, never the spell page', () => {
  assert.ok(!isItem('Cripple'), 'the corpus grew a "Cripple" item page')
  assert.ok(isItem('Spell: Cripple'))
  const block = `</li><li> [[Cripple|Spell: Cripple]] (Rare)
</li><li> [[Cripple|Spell:Cripple]] (Common)
</li><li> [[Spirit of Scale|Song: Spirit of Scale]]`
  // Spacing after the colon is folded; a `Song:` label with no such item page reads as nothing.
  assert.deepEqual(parseMobLoot(block, { isItem, isScroll }), [{ item: 'Spell: Cripple', rarity: 'Rare' }])
})

test('a scroll label with no item page falls back to its target ONLY when the target is the scroll', () => {
  // `Improved Invis vs Undead` IS the scroll's page (no `Spell: ` prefix, `Mana Cost` in its
  // statsblock); `Tears of Prexus` is a research component, a different item. Both verbatim.
  assert.ok(isScroll('Improved Invis vs Undead'))
  assert.ok(isItem('Tears of Prexus') && !isScroll('Tears of Prexus'))
  const block = `</li><li> [[Improved Invis vs Undead|Spell: Improved Invis vs Undead]]<span class='drare'>(Ultra Rare)</span> <span class='ddb'>[3] 1x 15% (25%)</span>
</li><li> [[Tears of Prexus|Spell: Tears of Prexus]]               <span class='drare'>(Ultra Rare)</span>`
  assert.deepEqual(parseMobLoot(block, { isItem, isScroll }), [{ item: 'Improved Invis vs Undead', rarity: 'Ultra Rare' }])
  // Without the scroll test the fallback refuses: no guess.
  assert.deepEqual(parseMobLoot(block, { isItem }), [])
})

test('only Spell:/Song: labels are scroll labels: an ordinary alias still reads its target', () => {
  // `[[Raw-Hide_Armor_Set|Raw-Hide Armor]]` (a group page) and an item link whose label merely
  // differs — both verbatim shapes — keep the target rule.
  assert.deepEqual(
    parseMobLoot("</li><li> [[Raw-Hide_Armor_Set|Raw-Hide Armor]] (Common)\n</li><li> [[lizard_Meat|Spellbound Lizard Meat]] (Rare)", { isItem, isScroll }),
    [{ item: 'Lizard Meat', rarity: 'Rare' }]
  )
})

// A Sebilite Golem (Old Sebilis), page 40325, `|known_loot` verbatim. `Spell: Gift of Xev` has no
// item page on the wiki, so it stays unread.
const GOLEM_LOOT = `<ul></li><li> [[Froglok Scale Chestplate|Froglok Scale Chestplate]] <span class='drare'>(Rare)</span> <span class='ddb'>[1] 1x 10% (50%)</span><li>  [[Cripple|Spell: Cripple]]         <span class='drare'>(Rare)</span> <span class='ddb'>[1] 1x 10% (50%)</span>
</li><li> [[Gift of Xev|Spell: Gift of Xev]] <span class='drare'>(Rare)</span> <span class='ddb'>[1] 1x 10% (50%)</span>
</li><li> [[Worn Cloth Mantle|Worn Cloth Mantle]] <span class='drare'>(Rare)</span> <span class='ddb'>[1] 1x 10% (50%)</span>
</li><li> {{:Fire Opal}}                     <span class='drare'>(Uncommon)</span> <span class='ddb'>[2] 1x 55% (50%)</span>
</li><li> {{:Fire Emerald}}                  <span class='drare'>(Uncommon)</span> <span class='ddb'>[2] 1x 55% (50%)</span>
</li></ul>`

test('a real page: A Sebilite Golem drops Spell: Cripple, in page order', () => {
  assert.deepEqual(parseMobLoot(GOLEM_LOOT, { isItem, isScroll }), [
    { item: 'Froglok Scale Chestplate', rarity: 'Rare' },
    { item: 'Spell: Cripple', rarity: 'Rare' },
    { item: 'Worn Cloth Mantle', rarity: 'Rare' },
    { item: 'Fire Opal', rarity: 'Uncommon' },
    { item: 'Fire Emerald', rarity: 'Uncommon' }
  ])
})

test('the committed catalog carries the scroll drops, joined to their item records', () => {
  const golem = MOBS.find((m) => m.page === 'A Sebilite Golem')
  assert.deepEqual(golem?.drops, ['Froglok Scale Chestplate', 'Spell: Cripple', 'Worn Cloth Mantle', 'Fire Opal', 'Fire Emerald'])
  // Admiral Tylix's `[[Tears of Prexus|Spell: Tears of Prexus]]` is not the research component.
  assert.ok(!MOBS.find((m) => m.page === 'Admiral Tylix')?.drops?.includes('Tears of Prexus'))
  // Every `Spell:`/`Song:` drop in the catalog names a record in the item corpus (measured 322 edges
  // added by this rule, 2026-11-25; a floor, not an equality, so a wiki growth does not rot it).
  const items = (itemsRaw as unknown as ItemDbFile).items
  const scrollDrops = MOBS.flatMap((m) => (m.drops ?? []).filter((d) => /^(?:Spell|Song): /.test(d)))
  assert.ok(scrollDrops.length >= 300, `only ${String(scrollDrops.length)} scroll drops`)
  assert.deepEqual(scrollDrops.filter((d) => !(itemKey(d) in items)), [])
})

test('the corpus test is by PAGE title: an `|itemname` alias is not a page a link can reach', () => {
  // `quiver of marr` keys the record whose PAGE is "Quiver of Marr (Item)"; the loot link on
  // "A bottomless feaster" points at the SPELL page. Matching item keys read it as the quiver.
  assert.ok(!isItem('Quiver of Marr'))
  assert.ok(isItem('Quiver of Marr (Item)'))
  assert.deepEqual(parseMobLoot("</li><li> [[Quiver of Marr|Spell: Quiver of Marr]]               <span class='drare'>(Rare)</span>", { isItem }), [])
  // MediaWiki title rules: `_` is a space and the FIRST letter is case-insensitive.
  assert.ok(isItem('lizard_Meat'))
  assert.ok(!isItem('Lizard meat'), 'only the first letter of a title is case-insensitive')
})

test('a link and a transclusion of the same item count ONCE, keeping the first rarity', () => {
  const block = `<ul><li> {{:Lizard Meat}} <span class='drare'>(Common)</span>
</li><li> [[lizard_Meat|Lizard Meat]] <span class='drare'>(Rare)</span>
</li><li> [[Lizardscale Belt]] (Uncommon)
</li><li> {{:Lizardscale_Belt}}
</li></ul>`
  assert.deepEqual(parseMobLoot(block, { isItem }), [
    { item: 'Lizard Meat', rarity: 'Common' },
    { item: 'Lizardscale Belt', rarity: 'Uncommon' }
  ])
})

test('without a corpus test, links are not read at all (transclusions only, as before)', () => {
  assert.deepEqual(parseMobLoot(ARCHON_LOOT), [])
  const wt = `{{Namedmobpage\n| name = Tae Ew Archon\n| known_loot =\n${ARCHON_LOOT}\n| factions = \n}}`
  assert.equal(parseMobWikitext(wt).dropsWiki, undefined)
  assert.equal(parseMobWikitext(wt, { isItem }).dropsWiki?.length, 4)
})

test('the committed catalog: Tae Ew Archon has its drops back', () => {
  const archon = MOBS.find((m) => m.page === 'Tae Ew Archon')
  assert.ok(archon, 'Tae Ew Archon left the mob catalog')
  assert.deepEqual(archon.drops, ['Rubicite Vambraces', 'Ravenscale Armguards', 'Lizardscale Belt', 'Lizard Meat'])
})
