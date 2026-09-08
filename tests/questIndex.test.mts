// THE QUESTS TAB'S JOINS (EQ Zera, 2026-09-06): the item key, the class reader, the loot join,
// and the search — each against the committed catalog where the fact is the catalog's, and
// against small fixtures where the fact is the function's.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { LootEvent, QuestEntry } from '../src/shared/types'
import {
  CLASS_NAMES,
  buildQuestsByItem,
  joinLootToQuests,
  questClasses,
  questItemKey,
  questOpenTo
} from '../src/shared/questIndex'
import { questItemKey as mainQuestItemKey } from '../src/main/questItemIndex'
import { QUEST_CATALOG, QUEST_ZONES, searchQuests } from '../src/renderer/src/features/quests/questSearch'

test('questItemKey is the SAME key main indexes with — one spelling of "the same item" app-wide', () => {
  for (const name of ['Crown of Narandi', 'Bone Chips', 'Shorn Head of Narandi', 'Fine Steel Long Sword +2', '  Odd  ']) {
    assert.equal(questItemKey(name), mainQuestItemKey(name), name)
  }
  assert.equal(questItemKey('Crown of Narandi +1'), 'crown of narandi', 'the tier suffix is not part of the item')
})

test('questClasses reads the catalog\'s sixty spellings into one of two shapes', () => {
  assert.equal(questClasses({ classes: ['All'] }), 'all')
  assert.equal(questClasses({ classes: ['ALL'] }), 'all')
  assert.equal(questClasses({ classes: ['Any'] }), 'all')
  assert.equal(questClasses({ classes: ['All (Iksar)'] }), 'all', 'a race note is not a class restriction')
  assert.equal(questClasses({ classes: ['?'] }), 'all', 'unknown never hides a quest')
  assert.equal(questClasses({}), 'all')
  assert.deepEqual(questClasses({ classes: ['Cleric'] }), ['Cleric'])
  assert.deepEqual(questClasses({ classes: ['SK'] }), ['Shadow Knight'])
  assert.deepEqual(questClasses({ classes: ['Shadowknight'] }), ['Shadow Knight'])
  assert.deepEqual(questClasses({ classes: ['WAR PAL RNG SHD BRD ROG'] }), ['Bard', 'Paladin', 'Ranger', 'Rogue', 'Shadow Knight', 'Warrior'])
  assert.deepEqual(questClasses({ classes: ['Priests'] }), ['Cleric', 'Druid', 'Shaman'])
  const notCasters = questClasses({ classes: ['All except NEC WIZ MAG ENC'] })
  assert.notEqual(notCasters, 'all')
  assert.ok(!(notCasters as string[]).includes('Wizard') && (notCasters as string[]).includes('Cleric'))
  // Every entry in the real catalog resolves — no spelling throws or yields an empty set.
  for (const q of QUEST_CATALOG) {
    const open = questClasses(q)
    assert.ok(open === 'all' || open.length > 0, q.name)
    if (open !== 'all') for (const c of open) assert.ok((CLASS_NAMES as readonly string[]).includes(c))
  }
})

test('questOpenTo: no loadout sees everything; a loadout sees any of its classes\' quests and the open ones', () => {
  const cleric: Pick<QuestEntry, 'classes'> = { classes: ['Cleric'] }
  assert.equal(questOpenTo(cleric, null), true)
  assert.equal(questOpenTo(cleric, []), true)
  assert.equal(questOpenTo(cleric, 'Cleric'), true)
  assert.equal(questOpenTo(cleric, ['CLR', 'WAR', 'SHD']), true, 'the log spells the loadout in abbreviations')
  assert.equal(questOpenTo(cleric, ['WAR', 'SHD']), false)
  assert.equal(questOpenTo({ classes: ['All'] }, ['WAR']), true)
  assert.equal(questOpenTo(cleric, ['BST']), true, 'a class this catalog never names is not filtered against')
})

test('joinLootToQuests: counts stack, newest first, and the quest view sees the same rows', () => {
  const a: QuestEntry = { name: 'Ring Ten', page: 'Ring Ten', requiredItems: ['Crown of Narandi', 'Eye of Narandi'] }
  const b: QuestEntry = { name: 'Bone Chips', page: 'Bone Chips', requiredItems: ['Bone Chips'], rewards: [{ name: 'Crown of Narandi' }] }
  const byItem = buildQuestsByItem({ quests: [a, b] })
  assert.equal(byItem.get('crown of narandi')?.length, 2, 'required by one, rewarded by another')
  const loot: LootEvent[] = [
    { ts: 10, item: 'Bone Chips', count: 4 },
    { ts: 20, item: 'Rusty Dagger' },
    { ts: 30, item: 'Bone Chips' },
    { ts: 40, item: 'Crown of Narandi +1' }
  ]
  const { items, byQuest } = joinLootToQuests(loot, byItem)
  assert.deepEqual(
    items.map((i) => [i.item, i.count, i.lastTs]),
    [
      ['Crown of Narandi +1', 1, 40],
      ['Bone Chips', 5, 30]
    ]
  )
  assert.deepEqual(byQuest.get('Ring Ten')?.map((i) => i.key), ['crown of narandi'])
  assert.deepEqual(byQuest.get('Bone Chips')?.map((i) => i.key), ['crown of narandi', 'bone chips'])
})

test('searchQuests finds a quest by its name, its giver, its zone and an item it needs', () => {
  const byName = searchQuests('coldain ring')
  assert.ok(byName.length > 0 && /Coldain Ring/.test(byName[0].entry.name))
  const byItem = searchQuests('Crown of Narandi')
  assert.ok(byItem.some((h) => h.entry.name === '10th Coldain Ring Quest'))
  assert.equal(searchQuests('').length, 0)
  assert.ok(QUEST_ZONES.length > 50 && QUEST_ZONES[0].count >= QUEST_ZONES[1].count, 'zones come most-quests-first')
})
