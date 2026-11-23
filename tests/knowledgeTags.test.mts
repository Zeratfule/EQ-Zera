// knowledgeTags: every tag a loot row's item earns, none overwriting another (GitHub #16 - a
// quest item that is also a recipe ingredient used to lose its tradeskill tag).
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ItemKnowledge } from '../src/shared/types'
import { knowledgeTags } from '../src/renderer/src/lib/itemKnowledgeView'
import { buildItemDbIndex, itemKey, knowledgeFromDb, type ItemDbFile } from '../src/main/itemsDb'
import itemsJson from '../src/main/data/items.json'

const index = buildItemDbIndex(itemsJson as unknown as ItemDbFile)
const fromDb = (name: string): ItemKnowledge | undefined => {
  const entry = index.get(itemKey(name))
  return entry ? { ...knowledgeFromDb(entry), cached: true } : undefined
}

const BASE: ItemKnowledge = { name: 'x', lore: false, quest: false, questUses: [], cached: false }
const ON = { isPosky: false, showTradeskill: true }
const KABOBS = { recipe: 'Gnome Kabobs', tradeskill: 'Baking', trivial: 56 }
const CURES = { quest: 'Cures', source: 'wiki' as const }

const kinds = (k: ItemKnowledge, opts = ON): string[] => knowledgeTags(k, opts).map((t) => t.kind)

test('a quest item that a recipe also consumes carries BOTH tags, quest first', () => {
  assert.deepEqual(kinds({ ...BASE, quest: true, questUses: [CURES], recipes: [KABOBS] }), ['quest', 'tradeskill'])
})

test('every combination keeps the fixed order LORE, quest, tradeskill', () => {
  assert.deepEqual(kinds({ ...BASE, lore: true, quest: true, questUses: [CURES], recipes: [KABOBS] }), [
    'lore',
    'quest',
    'tradeskill'
  ])
  assert.deepEqual(kinds({ ...BASE, lore: true, recipes: [KABOBS] }), ['lore', 'tradeskill'])
  assert.deepEqual(kinds({ ...BASE, lore: true }), ['lore'])
  assert.deepEqual(kinds({ ...BASE, questUses: [CURES] }), ['quest'])
  assert.deepEqual(kinds(BASE), [])
})

test('a bare QUEST ITEM flag on a recipe component no quest uses reads as tradeskill only', () => {
  assert.deepEqual(kinds({ ...BASE, quest: true, recipes: [KABOBS] }), ['tradeskill'])
  // ...and with no recipes the flag is all there is, so it stays a quest tag.
  assert.deepEqual(kinds({ ...BASE, quest: true }), ['quest'])
})

test('the Preferences switch drops only the tradeskill tag', () => {
  const off = { isPosky: false, showTradeskill: false }
  assert.deepEqual(kinds({ ...BASE, quest: true, questUses: [CURES], recipes: [KABOBS] }, off), ['quest'])
  assert.deepEqual(kinds({ ...BASE, quest: true, recipes: [KABOBS] }, off), [])
  assert.deepEqual(kinds({ ...BASE, lore: true, recipes: [KABOBS] }, off), ['lore'])
})

test('a PoSky row drops the quest tag (its PoSky chip says it) but keeps tradeskill', () => {
  const posky = { isPosky: true, showTradeskill: true }
  assert.deepEqual(kinds({ ...BASE, quest: true, questUses: [CURES], recipes: [KABOBS] }, posky), ['tradeskill'])
})

test('titles name what the tag is for, one clause, first use plus a count', () => {
  const tags = knowledgeTags(
    {
      ...BASE,
      questUses: [CURES, { quest: 'Curscale Shield', source: 'wiki' }],
      recipes: [KABOBS]
    },
    ON
  )
  assert.deepEqual(
    tags.map((t) => [t.label, t.title]),
    [
      ['quest', 'Quest: Cures +1 more'],
      ['tradeskill', 'Tradeskill: Gnome Kabobs (Baking 56)']
    ]
  )
})

test('the committed item DB: a real quest + recipe item gets both, Gnome Meat gets tradeskill only', () => {
  const sac = fromDb('Asp Poison Sac')
  const meat = fromDb('Gnome Meat')
  assert.ok(sac && meat, 'both items are in items.json')
  assert.deepEqual(kinds(sac), ['quest', 'tradeskill'])
  assert.deepEqual(kinds(meat), ['tradeskill'])
})
