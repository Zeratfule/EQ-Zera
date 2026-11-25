// THE QUEST HEADER LABELS AND REWARD TEMPLATES THE PARSER USED TO SKIP (found by the quest data
// health gate's first run, 2026-11-25): "Location", "Reward", "Items Required", "Related Items" and
// "Related Creatures" in the questTopTable, and the `{{Gear Set|…}}` reward box. Each pinned on the
// REAL cached page it was found on (scripts/sources/cache/quests/), then the giver's stated spot
// through the location resolver with the same conservative rules as any quest-page coordinate.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseQuestPage } from '../scripts/sources/questPage'
import { giverLocsOf } from '../scripts/sources/questStepRefs'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import type { MobData, QuestData, QuestEntry } from '../src/shared/types'
import { buildMobIndex, questLocations } from '../src/shared/questLocations'

const CACHE = join(import.meta.dirname, '..', 'scripts', 'sources', 'cache', 'quests')
const page = (id: number): string => readFileSync(join(CACHE, `page-${String(id)}.wikitext`), 'utf8')
const items = new Set(JSON.parse(readFileSync(join(CACHE, 'item-titles.json'), 'utf8')) as string[])
const isItem = (t: string): boolean => items.has(t.toLowerCase().replace(/\s+/g, ' ').trim())
const quests = (questsJson as unknown as QuestData).quests
const index = buildMobIndex((mobsJson as unknown as MobData).mobs, quests.map((q) => q.page))

test('"Reward:" in the header is the reward (Keeper Rott’s Pages: Intensify Death, its only one)', () => {
  assert.deepEqual(parseQuestPage("Keeper Rott's Pages", page(15819), isItem).rewards, ['Intensify Death'])
})

test('"Items Required" / "Related Items" are needed items; "Related Creatures" are its NPCs', () => {
  const bozinite = parseQuestPage('Bozinite Pestle Quest', page(15935), isItem)
  assert.ok(bozinite.requiredItems.includes('Bozinite Pestle'))
  assert.deepEqual(bozinite.relatedNpcs, ['Myre', 'Cleaner VII', 'Giant Rat', 'Infected Rat'])
  const clurg = parseQuestPage("Clurg's New Creation", page(57682), isItem)
  assert.deepEqual(clurg.requiredItems, ['Lizard Tail'])
})

test('{{Gear Set|…}} in the Rewards section lists the reward pieces (ShadowBound, and the class armor pages)', () => {
  assert.deepEqual(parseQuestPage('ShadowBound Armor Quests', page(15779), isItem).rewards, ['ShadowBound Boots', 'ShadowBound Gloves', 'Robe of Enshroudment'])
  assert.deepEqual(parseQuestPage('X', '== Rewards ==\n{{Gear Set\n|Rusty Sword\n|Not An Item\n}}\n', (t) => t === 'Rusty Sword').rewards, ['Rusty Sword'])
  // Only in a Rewards section: a Gear Set elsewhere on the page is not a reward.
  assert.deepEqual(parseQuestPage('X', '== Walkthrough ==\n{{Gear Set\n|Rusty Sword\n}}\n', () => true).rewards, [])
})

test('"Location:" states the giver’s spot: one clean point per segment, and nothing when a segment is ambiguous', () => {
  assert.deepEqual(giverLocsOf('50% @ (1064, 2409)'), [{ ns: 1064, ew: 2409 }])
  // "825,-28, 1100, -300" is two points or one with an elevation of 1100: unreadable, so refused.
  assert.deepEqual(giverLocsOf('890,-75 (inside building); 825,-28, 1100, -300 (after 8PM game time)'), [{ ns: 890, ew: -75 }])
  assert.deepEqual(giverLocsOf('-10, 20, 3'), [{ ns: -10, ew: 20, z: 3 }])
  assert.deepEqual(giverLocsOf('near the bank'), [])
  assert.deepEqual(parseQuestPage('Direwolf Fur Cloak Quest', page(15635), isItem).giverLocs, [{ ns: 1064, ew: 2409 }])
  assert.deepEqual(parseQuestPage('Granite Pebbles', page(15190), isItem).giverLocs, [{ ns: 890, ew: -75 }])
})

test('RESOLVER: the giver’s stated spot is a quest-page chip on the giver, placed by the step rules', () => {
  const q = quests.find((x) => x.page === 'Direwolf Fur Cloak Quest') as QuestEntry
  const giver = questLocations(q, index).npcs.find((n) => n.name === q.giver)
  const fromQuest = giver?.chips.filter((c) => c.sources.includes('quest')) ?? []
  assert.equal(fromQuest.length, 1, JSON.stringify(giver?.chips))
  assert.deepEqual(fromQuest[0].loc, { ns: 1064, ew: 2409 })
  assert.equal(fromQuest[0].zone, 'iceclad', fromQuest[0].why)
})
