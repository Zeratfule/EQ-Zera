// ITEM-KNOWLEDGE PARSER TEST (Task #53): the pure wikitext → ItemKnowledge classification
// that answers "what's this lore/quest item for". Fixtures are VERBATIM {{Itempage}}
// wikitext fetched from eqlwiki.com (the real pages the feature parses at runtime):
//   - Coin of Tash              — the "42 tash" (Tashania) spell-quest collectible
//   - Glowing Coin of Tash      — carries an explicit QUEST ITEM flag in statsblock
//   - Sphinx Claw               — a Plane of Sky class-Test drop (piped [[Page|Label]] link)
//   - Water Flask               — NOT lore, but used in MANY quests (multi-link relatedquests)
//   - Golden Earring            — vendor trash: no lore, no relatedquests → not notable
//
// Pins the flag detection (LORE ITEM / QUEST ITEM), the [[Page|Label]] quest-link parsing,
// the notes→summary one-liner, and the not-notable negative.
//
// The STAT-BLOCK and TRADESKILL halves of this suite were split into the sibling files
// tests/itemStatBlock.test.mts and tests/itemTradeskills.test.mts for file mass alone, along
// the seams the section banners already drew, with no assertion changed. Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDropSources,
  parseEraBodyTag,
  parseEraCategory,
  parseEraTag,
  parseItemWikitext,
  parseQuestLinks,
  templateField,
  cleanSummary,
  normalizeItemName
} from '../src/main/itemLookupParse'
import { craftedByLabel } from '../src/shared/itemKnowledge'

// --- verbatim real wikitext (trimmed to the {{Itempage}} template) --------------

const COIN_OF_TASH = `
<onlyinclude>{{Itempage
|notes       =
|itemname    = Coin of Tash
|lucy_img_ID = 646
|statsblock  =
MAGIC ITEM  LORE ITEM  NO DROP<br>
WT: 0.1  Size: TINY<br>
Class: ALL<br>
Race: ALL<br>
|relatedquests =

* [[Coin of Tash (Tashania)]]

|playercrafted =

* Non-Tradeskill (Quest)

}}</onlyinclude>`

const GLOWING_COIN = `
<onlyinclude>{{Itempage
|notes       =
|itemname    = Glowing Coin of Tash
|lucy_img_ID = 646
|statsblock  =
MAGIC ITEM  LORE ITEM  NO DROP  QUEST ITEM<br>
WT: 0.1  Size: TINY<br>
Class: ALL<br>
Race: ALL<br>
|relatedquests =

* [[Coin of Tash (Tashania spell)]]

}}</onlyinclude>`

const SPHINX_CLAW = `
<onlyinclude>{{Itempage
|notes       =
|itemname    = Sphinx Claw
|lucy_img_ID = 801
|statsblock  =
LORE ITEM  NO DROP<br>
Slot: PRIMARY<br>
Skill: 1H Slashing  Atk Delay: 20<br>
DMG: 12 <br>
WT: 2.0  Size: MEDIUM<br>
Class: PAL<br>
Race: ALL<br>
|dropsfrom =

[[Plane of Sky]]

* [[Sister of the Spire]]

|relatedquests =

* [[Paladin Plane of Sky Tests|Paladin Test of Love]]

}}</onlyinclude>`

const WATER_FLASK = `
<onlyinclude>{{Itempage
|notes       = 1sp 1cp per flask
|itemname    = Water Flask
|lucy_img_ID = 584
|statsblock  =
This is a drink.<br>
WT: 0.4  Size: SMALL<br>
Class: ALL<br>
Race: ALL<br>
|dropsfrom =

Various Zones

* Newbie Mobs

|relatedquests =

* [[Quench Lasen's Thirst]]
* [[Trooper Scale Armor Quests|Trooper Scale Pauldron]]
* [[Coldain Prayer Shawl Quests|Coldain Shawl #7: Runed Coldain Prayer Shawl]]
* [[Zimel's Blades (SoulFire)]]

}}</onlyinclude>`

const GOLDEN_EARRING = `
<onlyinclude>{{Itempage
|notes       = Vendor trash.
|itemname    = Golden Earring
|lucy_img_ID = 535
|statsblock  =
Slot: EAR<br>
WT: 0.1  Size: TINY<br>
Class: ALL<br>
Race: ALL<br>
|dropsfrom =

[[Befallen]]

}}</onlyinclude>`

// --- tests ----------------------------------------------------------------------

test('Coin of Tash: LORE + the Tashania spell-quest association (the 42-tash example)', () => {
  const k = parseItemWikitext('Coin of Tash', COIN_OF_TASH)
  assert.equal(k.lore, true)
  assert.equal(k.quest, true) // has a relatedquest even without a QUEST ITEM flag
  assert.deepEqual(
    k.questUses.map((u) => u.quest),
    ['Coin of Tash (Tashania)']
  )
  assert.equal(k.questUses[0].source, 'wiki')
  // statsblock <br> collapse to newlines, flags preserved
  assert.match(k.statsBlock ?? '', /LORE ITEM/)
})

test('Glowing Coin of Tash: explicit QUEST ITEM flag + spell-quest link', () => {
  const k = parseItemWikitext('Glowing Coin of Tash', GLOWING_COIN)
  assert.equal(k.lore, true)
  assert.equal(k.quest, true)
  assert.deepEqual(
    k.questUses.map((u) => u.quest),
    ['Coin of Tash (Tashania spell)']
  )
})

test('Sphinx Claw: LORE Sky drop, piped [[Page|Label]] quest link resolves to the label', () => {
  const k = parseItemWikitext('Sphinx Claw', SPHINX_CLAW)
  assert.equal(k.lore, true)
  assert.equal(k.quest, true)
  assert.equal(k.questUses.length, 1)
  assert.equal(k.questUses[0].quest, 'Paladin Test of Love')
  assert.equal(k.questUses[0].page, 'Paladin Plane of Sky Tests')
})

test('Water Flask: NOT lore, but used in multiple quests (all links captured)', () => {
  const k = parseItemWikitext('Water Flask', WATER_FLASK)
  assert.equal(k.lore, false)
  assert.equal(k.quest, true) // relatedquests present → quest-relevant
  assert.equal(k.questUses.length, 4)
  const labels = k.questUses.map((u) => u.quest)
  assert.ok(labels.includes("Quench Lasen's Thirst"))
  assert.ok(labels.includes('Trooper Scale Pauldron')) // the piped label, not the page
  assert.equal(k.summary, '1sp 1cp per flask')
})

test('Golden Earring: vendor trash — not lore, no quests → not notable', () => {
  const k = parseItemWikitext('Golden Earring', GOLDEN_EARRING)
  assert.equal(k.lore, false)
  assert.equal(k.quest, false)
  assert.equal(k.questUses.length, 0)
  assert.equal(k.summary, 'Vendor trash.')
  // "not notable" is the (lore || quest || uses) predicate the UI uses:
  assert.equal(k.lore || k.quest || k.questUses.length > 0, false)
})

test('templateField isolates a single field and stops at the next pipe', () => {
  const sb = templateField(SPHINX_CLAW, 'statsblock')
  assert.match(sb ?? '', /LORE ITEM/)
  assert.doesNotMatch(sb ?? '', /relatedquests/)
  assert.doesNotMatch(sb ?? '', /Sister of the Spire/) // dropsfrom is a later field
})

test('parseQuestLinks handles plain and piped links, dedupes', () => {
  const uses = parseQuestLinks('* [[A Quest]]\n* [[Page X|Label X]]\n* [[A Quest]]')
  assert.deepEqual(
    uses.map((u) => u.quest),
    ['A Quest', 'Label X']
  )
  assert.equal(uses[1].page, 'Page X')
})

test('cleanSummary strips markup + caps to one sentence', () => {
  const s = cleanSummary("'''Bone Chips''' are used as a [[Necromancer]] reagent. And more prose here.")
  assert.equal(s, 'Bone Chips are used as a Necromancer reagent.')
})

test('normalizeItemName strips a trailing +N upgrade suffix only', () => {
  assert.equal(normalizeItemName('Sphinx Claw +1'), 'Sphinx Claw')
  assert.equal(normalizeItemName('Coin of Tash'), 'Coin of Tash')
})

// =================================================================================
// DROP SOURCES (`|dropsfrom`) — the field the parser read past for two tasks, now the item
// page's own answer to "where does this come from". Blocks below are VERBATIM values pulled
// from the scrape cache (scripts/sources/cache/items, 2026-08-04); only Loaf of Bread's list
// is trimmed, to the two zones that carry the shapes under test.
//
// Every structural variant the census in itemLookupParse.ts measured is represented here, so a
// future edit to the parser has to answer to the real corpus, not to an invented shape.
// =================================================================================

/** SEVERAL zone headings on one page — the zone is the NEAREST PRECEDING heading, nothing more. */
const MULTI_ZONE = `[[Lake of Ill Omen]]
* [[a Sarnak flunkie]]

[[Overthere]]
* [[a Sarnak flunkie]]`

/** No heading at all: mobs with an honestly UNKNOWN zone (the brief's Alania Peaceheart shape). */
const MOB_ONLY = `

* [[Alania Peaceheart]]

`

/** `{{VeliousGray|…}}` wraps rows for styling; `<s>…</s>` strikes one out. Both unwrap to the row. */
const WRAPPED = `[[Lake Rathetear]]

* [[a gnoll high shaman]]

{{VeliousGray| [[Velketor's Labyrinth]] }}

* {{VeliousGray| [[a cold shade]] }}
* <s>[[a cold spectre]]</s>`

/** A heading trailing prose, a `{{Loc}}` bullet naming no page, and `**` sub-rows under it. */
const GROUND_SPAWN = `[[Misty Thicket]] As of some previous patch, groundspawns are now random... the locs below are not reliable sources of misty acorns :/
* {{Loc|Misty Thicket|(284, -1810)(-233, -1616)|Ground Spawns}}
** {{Loc|Misty Thicket|284, -1810|(284, -1810)}}
** {{Loc|Misty Thicket|-233, -1616|(-233, -1616)}}`

/** A prose heading ("Various Zones") must CLEAR the zone, never let its mobs inherit the one above. */
const PROSE_HEADING = `[[Befallen]]

* [[a necro theurgist]]

Various Zones

* [[a shadowed man]]
* Newbie Mobs`

test('parseDropSources: zone headings, mob bullets, and the identity of a source', () => {
  // The plain shape, through the whole parser: one heading, one bullet under it.
  const claw = parseItemWikitext('Sphinx Claw', SPHINX_CLAW)
  assert.deepEqual(claw.dropsFrom, [{ mob: 'Sister of the Spire', zone: 'Plane of Sky' }])

  assert.deepEqual(parseDropSources(MULTI_ZONE), [
    { mob: 'a Sarnak flunkie', zone: 'Lake of Ill Omen' },
    { mob: 'a Sarnak flunkie', zone: 'Overthere' }
  ])
  // …which is the point of `(mob, zone)` being the identity: the same mob in two zones is two
  // facts. The same pair twice is one.
  assert.deepEqual(parseDropSources('[[Overthere]]\n* [[a Sarnak flunkie]]\n* [[a Sarnak flunkie]]'), [
    { mob: 'a Sarnak flunkie', zone: 'Overthere' }
  ])

  // No heading ⇒ no zone key at all. Absent means UNKNOWN, and the object must not carry
  // `zone: undefined` (it is serialized into the committed DB).
  const bare = parseDropSources(MOB_ONLY)
  assert.deepEqual(bare, [{ mob: 'Alania Peaceheart' }])
  assert.equal('zone' in bare[0], false)
})

test('parseDropSources: markup is decoration — wrappers, strikeouts, piped links', () => {
  assert.deepEqual(parseDropSources(WRAPPED), [
    { mob: 'a gnoll high shaman', zone: 'Lake Rathetear' },
    { mob: 'a cold shade', zone: "Velketor's Labyrinth" },
    { mob: 'a cold spectre', zone: "Velketor's Labyrinth" }
  ])
  // A piped link states a page and a DISPLAY name; the display name is what the page calls the
  // place, so that is what is kept (law 2 — display raw).
  assert.deepEqual(parseDropSources('[[Freeport|East Freeport]]\n* [[Gregor Nasin]]'), [
    { mob: 'Gregor Nasin', zone: 'East Freeport' }
  ])
})

test('parseDropSources: what it REFUSES to read — sub-rows, prose bullets, prose headings', () => {
  // A `{{Loc}}` bullet and its `**` coordinate sub-rows name no mob. Zero entries, not a guess.
  assert.deepEqual(parseDropSources(GROUND_SPAWN), [])

  // "Various Zones" names no page, so it CLEARS the zone rather than lending Befallen to the
  // shadowed man; "* Newbie Mobs" names no page at all and is dropped (law 1).
  assert.deepEqual(parseDropSources(PROSE_HEADING), [
    { mob: 'a necro theurgist', zone: 'Befallen' },
    { mob: 'a shadowed man' }
  ])

  // Water Flask is that shape end to end (prose heading + prose bullet) and Golden Earring is a
  // heading with nothing under it: both state no source, so both leave the field OFF.
  assert.equal(parseItemWikitext('Water Flask', WATER_FLASK).dropsFrom, undefined)
  assert.equal(parseItemWikitext('Golden Earring', GOLDEN_EARRING).dropsFrom, undefined)
  // Nothing here throws, whatever the field holds — the file's standing contract.
  assert.deepEqual(parseDropSources(''), [])
  assert.deepEqual(parseDropSources('|Description: drops off random goblins\n<br>\n***'), [])
})

test('parseEraTag reads the page-top banner, and refuses everything that only looks like one', () => {
  // The shape, verbatim from Engraved Bone Pauldrons: the template, then the item template.
  assert.equal(parseEraTag('{{Velious Era}}\n\n\n<onlyinclude>{{Itempage\n|notes = \n}}'), 'Velious')
  // The corpus's three spelling accidents, folded to one token each (case is NOT folded here —
  // that is the mapping table's job, so this function keeps reporting what the page said).
  assert.equal(parseEraTag('{{Velious  Era}}\n{{Itempage}}'), 'Velious')
  assert.equal(parseEraTag('{{Kunark_Era}}\n{{Itempage}}'), 'Kunark')
  assert.equal(parseEraTag('{{kunark Era}}\n{{Itempage}}'), 'kunark')
  // Two-word tokens survive whole; a leading `__NOTOC__`/comment before the banner is fine.
  assert.equal(parseEraTag('{{Chardok Revamp Era}}\n{{Itempage}}'), 'Chardok Revamp')
  assert.equal(parseEraTag('<!-- x -->\n{{Sky Era}}\n{{Itempage}}'), 'Sky')

  // REFUSALS. `{{Era|Velious}}` is a different template whose 8 uses sit inline in prose; a
  // banner BELOW the item template (36 pages paste one inside `|playercrafted`) is not a page-top
  // banner; a page with no {{Itempage}} at all has no head to read; and `P99 Era Header` is a
  // date banner that merely contains the word.
  assert.equal(parseEraTag('{{Era|Velious}}\n{{Itempage}}'), undefined)
  assert.equal(parseEraTag('{{Era}}\n{{Itempage}}'), undefined)
  assert.equal(parseEraTag('{{Itempage\n|playercrafted = \n{{Classic Era}}\n}}'), undefined)
  assert.equal(parseEraTag('{{Velious Era}}\nnot an item page'), undefined)
  assert.equal(parseEraTag('{{P99 Era Header| Nov | 2000 }}\n{{Itempage}}'), undefined)
  assert.equal(parseEraTag(''), undefined)

  // And end to end: the trimmed fixtures in this file open at `{{Itempage`, so they state none.
  assert.equal(parseItemWikitext('Sphinx Claw', SPHINX_CLAW).eraTag, undefined)
  assert.equal(parseItemWikitext('Sphinx Claw', `{{Fear Era}}\n${SPHINX_CLAW}`).eraTag, 'Fear')
})

// ---- the two era claims that are NOT in the page head (JOS-328) ---------------------------
//
// The verbatim shapes, from the two families the corpus-wide sweep found: `Small Fine Steel
// Breastplate` puts its `{{Classic Era}}` inside `|playercrafted`, and `Flowing Red Silk Sash`
// writes `[[Category:Kunark Era]]` at the foot with no banner anywhere. Both render an era claim on
// the live page; neither is visible to the head-anchored reader above.

/** Verbatim head of Small Fine Steel Breastplate (the banner-in-the-body family, 36 pages). */
const BODY_BANNER = `{{delete}} not relevent in EQ legends

<onlyinclude>{{Itempage
|notes       = Part of the [[Fine Plate#Small|Small Fine Plate Armor]] set.
|itemname    = Small Fine Steel Breastplate
|statsblock  =
Slot: CHEST<br>
AC: 19<br>
|playercrafted =
{{Classic Era}}
* [[Blacksmithing]] (Trivial: 228)
}}</onlyinclude>

[[Category:Cleric Equipment]]`

/** Verbatim foot of Flowing Red Silk Sash (the hand-written-category family, 8 read pages). */
const FOOT_CATEGORY = `
<onlyinclude>{{Itempage
|itemname    = Flowing Red Silk Sash
|statsblock  =
Slot: WAIST<br>
Haste: +6%  <br>
}}</onlyinclude>

[[Category:Kunark Era]]
[[Category:Waist]]
[[Category:Timorous Deep]]`

test('parseEraBodyTag reads a banner BELOW the item template, and only when they agree', () => {
  assert.equal(parseEraBodyTag(BODY_BANNER), 'Classic')
  assert.equal(parseEraBodyTag('{{Itempage\n|playercrafted = \n{{Kunark_Era}}\n}}'), 'Kunark')
  // The same token twice is one claim, however it is spelled.
  assert.equal(parseEraBodyTag('{{Itempage}}{{Velious Era}} x {{Velious  Era}}'), 'Velious')

  // REFUSALS. Two body banners that DISAGREE state nothing — a page arguing with itself is not
  // evidence, and taking the first would be a coin toss. `{{Era|Kunark}}` is the argument form the
  // pattern cannot match at all. A page with no {{Itempage}} has no body to read. And the head
  // banner is NOT the body: it sits above the anchor and belongs to `parseEraTag`.
  assert.equal(parseEraBodyTag('{{Itempage}}{{Classic Era}}\n{{Velious Era}}'), undefined)
  assert.equal(parseEraBodyTag('{{Itempage}}{{Era|Kunark}}'), undefined)
  assert.equal(parseEraBodyTag('{{Classic Era}}\nnot an item page'), undefined)
  assert.equal(parseEraBodyTag('{{Classic Era}}\n{{Itempage}}'), undefined)
})

test('parseEraCategory reads the page filing, and refuses the ones the register never named', () => {
  assert.equal(parseEraCategory(FOOT_CATEGORY), 'Kunark')
  assert.equal(parseEraCategory('[[Category:Velious Era]]'), 'Velious')
  assert.equal(parseEraCategory('[[Category:Chardok Revamp Era|*]]'), 'Chardok Revamp')

  // THE LAW-1 CLAUSE. `{{P99 Era Header| Nov | 2000 }}` files 8 corpus pages under a category that
  // LOOKS like an era and names none; unlike a banner, a category renders nothing, so an unknown
  // key is silence rather than the register's `#default`.
  assert.equal(parseEraCategory('[[Category:Nov 2000 Era]]'), undefined)
  assert.equal(parseEraCategory('[[Category:Mar 2000 Era]]'), undefined)
  assert.equal(parseEraCategory('[[Category:May 1999 Era]]'), undefined)
  // Two eras filed on one page, and the non-era categories every page carries.
  assert.equal(parseEraCategory('[[Category:Classic Era]]\n[[Category:Kunark Era]]'), undefined)
  assert.equal(parseEraCategory('[[Category:Waist]]\n[[Category:Quest Items]]'), undefined)
  assert.equal(parseEraCategory(''), undefined)
})

test('the three era readers layer strongest-first, and each speaks only into silence', () => {
  // End to end through the shipped `parseItemWikitext`: head > body > category, and a page that
  // states none of the three keeps `eraTag` OFF rather than guessing (law 1).
  assert.equal(parseItemWikitext('Small Fine Steel Breastplate', BODY_BANNER).eraTag, 'Classic')
  assert.equal(parseItemWikitext('Flowing Red Silk Sash', FOOT_CATEGORY).eraTag, 'Kunark')
  assert.equal(parseItemWikitext('Sphinx Claw', SPHINX_CLAW).eraTag, undefined)

  // The head wins over both, and the body wins over the category — the order is the strength of
  // the evidence: what the page OPENS with, then what it renders anywhere, then how it is filed.
  const all = `{{Sky Era}}\n{{Itempage\n|playercrafted = {{Classic Era}}\n}}\n[[Category:Kunark Era]]`
  assert.equal(parseItemWikitext('x', all).eraTag, 'Sky')
  const bodyAndCat = `{{Itempage\n|playercrafted = {{Classic Era}}\n}}\n[[Category:Kunark Era]]`
  assert.equal(parseItemWikitext('x', bodyAndCat).eraTag, 'Classic')
})

// The tradeskill NEGATIVE for this page lives here rather than in the tradeskill file
// because its evidence is the Coin of Tash fixture above.
test('a non-tradeskill |playercrafted stays PROSE — playerCrafted is never inferred', () => {
  // Coin of Tash's field is literally `* Non-Tradeskill (Quest)`: no link, no tradeskill.
  const k = parseItemWikitext('Coin of Tash', COIN_OF_TASH)
  assert.equal(k.playerCrafted, undefined)
  assert.equal(k.craftedBy, undefined)
  assert.equal(k.craftedNote, 'Non-Tradeskill (Quest)')
  assert.equal(
    craftedByLabel({ name: 'Coin of Tash', lore: false, quest: false, questUses: [], cached: false, ...k }),
    'Non-Tradeskill (Quest)'
  )
})
