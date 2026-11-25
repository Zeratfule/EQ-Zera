// A MOB PAGE'S `|name = NPC_Name` IS THE TEMPLATE'S PLACEHOLDER, NOT A NAME (src/shared/mobName.ts).
//
// It reached "The Tragic Tale of House Everling" step 1 as a chip reading "NPC_Name · Nektropos
// Castle". Pinned: the word list, the real catalog (two pages carry it today, and no chip or quest
// pin anywhere shows a placeholder), the Mobs/Maps catalog, and the mob parser that writes it.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import type { MobData, QuestData } from '../src/shared/types'
import { isPlaceholderMobName, shownMobName } from '../src/shared/mobName'
import { buildMobIndex, questLocations } from '../src/shared/questLocations'
import { questPinsInZone } from '../src/shared/questMapPins'
import { MOB_CATALOG } from '../src/renderer/src/features/mobs/mobSearch'
import { parseMobPage } from '../scripts/sources/mobPage'

const quests = (questsJson as unknown as QuestData).quests
const mobs = (mobsJson as unknown as MobData).mobs
const index = buildMobIndex(mobs, quests.map((q) => q.page))

test('the placeholder words, and what is NOT one', () => {
  for (const p of ['NPC_Name', 'npc name', '', ' ', '?', '??', 'Unknown', '{{{name}}}']) assert.ok(isPlaceholderMobName(p), p)
  for (const n of ['Lord Ollix Everling', 'a_minnow', 'Clockwork XXD', 'an unknown spirit']) assert.ok(!isPlaceholderMobName(n), n)
  assert.equal(shownMobName('NPC_Name', 'Lord Ollix Everling'), 'Lord Ollix Everling')
  assert.equal(shownMobName('a_minnow', 'A minnow'), 'a_minnow')
})

test('REAL CATALOG: the two NPC_Name pages, and no chip or pin anywhere shows a placeholder', () => {
  assert.deepEqual(mobs.filter((m) => isPlaceholderMobName(m.name)).map((m) => m.page).sort(), ['Head Chef Vy`zen', 'Lord Ollix Everling'])
  const tragic = questLocations(quests.find((q) => q.page === 'The Tragic Tale of House Everling') ?? quests[0], index)
  assert.ok(tragic.steps[0].some((c) => c.name === 'Lord Ollix Everling' && c.zone === 'nektropos'), JSON.stringify(tragic.steps[0]))
  for (const q of quests) {
    const locs = questLocations(q, index)
    const chips = [...locs.steps.flat(), ...locs.npcs.flatMap((n) => n.chips), ...locs.items.flatMap((i) => i.chips)]
    for (const c of chips) if (c.name !== undefined) assert.ok(!isPlaceholderMobName(c.name), `${q.page}: ${c.name}`)
    for (const p of questPinsInZone([{ page: q.page, name: q.name, locs }], 'nektropos')) assert.ok(!p.labels.some((l) => /NPC_Name/.test(l)))
  }
})

test('the Mobs tab / Maps pane catalog shows the page title instead', () => {
  assert.equal(MOB_CATALOG.find((m) => m.page === 'Lord Ollix Everling')?.name, 'Lord Ollix Everling')
  assert.equal(MOB_CATALOG.length, mobs.length)
})

test('THE MOB PARSER stops writing it: a page whose |name is the placeholder takes its title', () => {
  const wt = '{{Namedmobpage\n| name = NPC_Name\n| zone = [[Nektropos Castle]]\n| location = 100% @ (354, -20, -5)\n}}'
  assert.equal(parseMobPage('Lord Ollix Everling', wt)?.name, 'Lord Ollix Everling')
  assert.equal(parseMobPage('Lord Ollix Everling', wt.replace('NPC_Name', 'Lord Ollix Everling'))?.name, 'Lord Ollix Everling')
})
