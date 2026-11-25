// QUEST LOCATIONS, THE RESOLVER (quest locations wave): src/shared/questLocations.ts,
// questLocZones.ts and questMapPins.ts, driven against the REAL committed catalog — quests.json and
// the bestiary mobs.json — never a fixture, because every rule in them was written against the
// audit of that corpus (scripts/audit-quest-locs.mts) and a toy catalog would pass while the real
// one regressed.
//
// What is pinned: "Hate, Betrayal, and Trust" exactly, step by step; the two witnesses disagreeing
// and agreeing; the refusals (an ambiguous zone, a point outside the zone's known spread, a
// walkthrough that has left its start zone) each producing a coordinate with NO map; items no mob
// drops producing nothing; and parity with the two joins the app already has — the item -> mob
// inversion (lib/itemSources.ts) and the mob -> zone join (features/mobs/mobZone.ts).
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import type { MobData, QuestData, QuestEntry } from '../src/shared/types'
import { buildMobIndex, dropKey, questLocations, type QuestLocChip } from '../src/shared/questLocations'
import { clauseSpan, sentenceSpan } from '../src/shared/questLocZones'
import { questPinsInZone } from '../src/shared/questMapPins'
import { ZONES, zoneKey } from '../src/shared/zones'
import { buildSourceIndex, sourceItemKey } from '../src/renderer/src/lib/itemSources'
import { mobsInZone } from '../src/renderer/src/features/mobs/mobZone'

const quests = (questsJson as unknown as QuestData).quests
const mobs = (mobsJson as unknown as MobData).mobs
const index = buildMobIndex(mobs, quests.map((q) => q.page))
const quest = (page: string): QuestEntry => {
  const q = quests.find((x) => x.page === page)
  assert.ok(q, `quest ${page} is in the catalog`)
  return q
}
const pt = (c: QuestLocChip): string => (c.loc ? `(${[c.loc.ns, c.loc.ew, ...(c.loc.z === undefined ? [] : [c.loc.z])].join(', ')})` : '-')
const brief = (c: QuestLocChip): string => `${c.name ?? '?'}|${c.zone ?? 'NOMAP'}|${pt(c)}|${c.sources.join('+')}`

test('HATE, BETRAYAL, AND TRUST: every step that states a place gets exactly its chips', () => {
  const locs = questLocations(quest('Hate, Betrayal, and Trust'), index)
  assert.deepEqual(locs.steps.map((s) => s.map(brief)), [
    // Two zones in the sentence; Ozval is the giver, and the quest starts in Lake Nerius.
    ['Retainer Ozval|lakenerius|(201, -97, -7)|quest'],
    // THE TWO WITNESSES DISAGREE, and both are shown, each saying who said it.
    ['Corrupted Kedgespawn|lakenerius|(2662, 1238, -119)|quest', 'Corrupted Kedgespawn|lakenerius|(2640, 1226, -120)|npc'],
    // …and here they AGREE, so it is one chip carrying both.
    ['Merchant Tyslin|felwithea|(107, -438)|quest+npc'],
    ['Rylin Coil|akanon|(1469, -190)|quest+npc'],
    [],
    ['High Priestess of Ulkorruuk|hateplane|(-90, 287, 127)|quest', 'High Priestess of Ulkorruuk|hateplane|(-103, 294)|npc'],
    []
  ])
})

test('HATE, BETRAYAL, AND TRUST: the ring has its dropper; the three items nobody drops say nothing', () => {
  const locs = questLocations(quest('Hate, Betrayal, and Trust'), index)
  assert.deepEqual(locs.items.map((i) => i.item), ['Ancient Signet Ring of House Everling'])
  const ring = locs.items[0]
  assert.deepEqual(ring.chips.map(brief), ['Corrupted Kedgespawn|lakenerius|(2640, 1226, -120)|npc'])
  assert.equal(ring.more, 0)
  // The NPC list: the giver first, then the Related NPCs, each with what the bestiary states.
  assert.deepEqual(locs.npcs.map((n) => `${n.name}:${String(n.chips.length)}`), [
    'Retainer Ozval:0',
    'Corrupted Kedgespawn:1',
    'Rylin Coil:1',
    'Merchant Tyslin (North Felwithe):1'
  ])
})

test('REFUSALS: a coordinate whose zone is not settled is shown with NO map', () => {
  const noMap = (page: string, step: number): QuestLocChip[] =>
    questLocations(quest(page), index).steps[step].filter((c) => c.sources.includes('quest'))
  // "in the Bank of Erudin (Erudin Palace)": two zones in one sentence, and no NPC to pick one.
  const bank = noMap('Clear Water Quest', 0)
  assert.equal(bank.length, 1)
  assert.equal(bank[0].zone, undefined)
  assert.equal(bank[0].zoneName, undefined)
  assert.deepEqual(bank[0].loc, { ns: 735, ew: 835 })
  // The start-zone rule refuses a walkthrough that has already left the start zone (Halas → Everfrost).
  const tower = noMap("Ivan McMannus' Remains", 10)
  assert.equal(tower[0].zone, undefined)
  assert.match(tower[0].why, /already left Halas/)
  // …and a point outside every point the bestiary states for the start zone.
  const far = noMap('Temple Blankets Quest', 6)
  assert.equal(far[0].zone, undefined)
  assert.match(far[0].why, /outside it/)
  // A zone named only as the place NEXT to the spot is not the spot's zone.
  const tunic = noMap('Tunic of Ridossan Quest', 12)
  assert.equal(tunic[0].zone, 'feerrott')
})

test('REFUSALS: a city name that is two maps names a zone but opens no map', () => {
  const qeynos = questLocations(quest("Rohand's Brandy"), index).steps[0]
  // "near the Qeynos docks" is beside-wording; the step names no zone, the quest starts in South Qeynos.
  assert.equal(qeynos[0].zone, 'qeynos')
  const bard = questLocations(quest('Bard Mail'), index).steps[3].filter((c) => c.sources.includes('quest'))
  assert.ok(bard.length >= 2)
  for (const c of bard) {
    assert.equal(c.zone, undefined, brief(c))
    assert.equal(c.zoneName, 'Felwithe')
  }
})

test('LAW: a bestiary page that names several zones keeps its points but never gets a map', () => {
  let seen = 0
  for (const q of quests) {
    const locs = questLocations(q, index)
    for (const c of [...locs.steps.flat(), ...locs.npcs.flatMap((n) => n.chips), ...locs.items.flatMap((i) => i.chips)]) {
      if (!c.sources.includes('npc') || c.sources.includes('quest') || c.zoneName?.includes(' or ') !== true || c.loc === undefined) continue
      seen++
      assert.equal(c.zone, undefined, `${q.page}: ${brief(c)}`)
      assert.ok(c.loc, 'the stated point is still shown')
    }
  }
  assert.ok(seen > 0, 'the corpus has multi-zone pages with points')
})

test('LAW: every chip with a map has a point in that map, never a guessed one (all quests)', () => {
  for (const q of quests) {
    const locs = questLocations(q, index)
    for (const c of locs.steps.flat()) {
      if (c.zone === undefined || c.loc === undefined) continue
      assert.notEqual(index.within(c.zone, c.loc), false, `${q.page}: ${brief(c)} lies outside ${c.zone}`)
    }
  }
})

test('PARITY: item droppers are the same mobs lib/itemSources.ts inverts, key for key', () => {
  const lib = buildSourceIndex(mobs)
  let compared = 0
  for (const q of quests) {
    for (const item of q.requiredItems ?? []) {
      assert.equal(dropKey(item), sourceItemKey(item))
      const ours = index.droppers(item).map((m) => m.page).sort()
      const theirs = (lib.get(sourceItemKey(item)) ?? []).map((s) => s.mobPage ?? '').sort()
      assert.deepEqual(ours, theirs, item)
      compared++
    }
  }
  assert.ok(compared > 3000)
})

test('PARITY: a bestiary chip placed in a map is a mob the Maps tab lists for that zone', () => {
  const nameOf = new Map(ZONES.map((z) => [z.short, z.name]))
  const inZone = new Map<string, Set<string>>()
  const listed = (stem: string): Set<string> => {
    let s = inZone.get(stem)
    if (!s) {
      s = new Set(mobsInZone(nameOf.get(stem) ?? stem, mobs).map((m) => m.name))
      inZone.set(stem, s)
    }
    return s
  }
  const aliasKeys = new Map(ZONES.map((z) => [z.short, new Set((z.aliases ?? []).map(zoneKey))]))
  let checked = 0
  let aliasOnly = 0
  const placed = quests.flatMap((q) => questLocations(q, index).npcs.flatMap((n) => n.chips.map((c) => ({ npc: n.name, c }))))
  for (const { npc, c } of placed) {
    if (c.zone === undefined || c.name === undefined || !c.why.endsWith("'s page")) continue
    checked++
    if (listed(c.zone).has(c.name)) continue
    // THE ONE KNOWN GAP, and it is the mob join's, not ours: `mobsInZone` folds a zone's NAME and
    // its catalog spellings but not its ALIASES, so a mob whose page says "Mistmoore Castle" (an
    // alias of Castle Mistmoore) is placed by the zone table and missing from that pane.
    const spelled = zoneKey(index.npc(npc)?.zones?.[0] ?? '')
    assert.ok(aliasKeys.get(c.zone)?.has(spelled), `${c.name} -> ${c.zone} (page says "${spelled}")`)
    aliasOnly++
  }
  assert.ok(checked > 500, `checked ${String(checked)}`)
  assert.ok(aliasOnly < checked / 10, `alias-only placements ${String(aliasOnly)} of ${String(checked)}`)
})

test('SCOPES: a sentence ends at a full stop that is not inside a number; a clause at a non-coordinate comma', () => {
  const t = 'Your location is -4.05, -70.53. Then go on.'
  assert.deepEqual(sentenceSpan(t, 18), [0, 31])
  const s = 'Linadian is located at -142, -545, 161 in Kelethin, two platforms over - alternatively - in West Freeport at loc (56, -299).'
  const [a, b] = clauseSpan(s, s.indexOf('-142'), [0, s.length])
  assert.equal(s.slice(a, b), 'Linadian is located at -142, -545, 161 in Kelethin')
})

test('QUEST PINS: a tracked quest pins its places in the zone on screen, labelled with quest and role', () => {
  const q = quest('Hate, Betrayal, and Trust')
  const forPins = [{ page: q.page, name: q.name, locs: questLocations(q, index) }]
  const akanon = questPinsInZone(forPins, 'akanon')
  assert.equal(akanon.length, 1)
  assert.deepEqual(akanon[0].loc, { ns: 1469, ew: -190 })
  assert.ok(akanon[0].labels.includes('Hate, Betrayal, and Trust - step 4: Rylin Coil'), akanon[0].labels.join(' | '))
  assert.ok(akanon[0].labels.includes('Hate, Betrayal, and Trust - Rylin Coil'))
  const lake = questPinsInZone(forPins, 'lakenerius')
  assert.deepEqual(lake.map((p) => `${String(p.loc.ns)},${String(p.loc.ew)}`).sort(), ['201,-97', '2640,1226', '2662,1238'])
  assert.deepEqual(questPinsInZone(forPins, 'freportw'), [])
  assert.deepEqual(questPinsInZone(forPins, null), [])
})

test('COVERAGE floors over the real catalog (identities, not frozen counts)', () => {
  let coords = 0
  let mapped = 0
  let withChip = 0
  let itemsWithSource = 0
  for (const q of quests) {
    const locs = questLocations(q, index)
    const quoted = locs.steps.flat().filter((c) => c.sources.includes('quest'))
    coords += quoted.length
    mapped += quoted.filter((c) => c.zone !== undefined).length
    if (locs.steps.flat().length + locs.npcs.flatMap((n) => n.chips).length > 0) withChip++
    itemsWithSource += locs.items.length
  }
  assert.ok(coords >= 700, `coordinates ${String(coords)}`)
  assert.ok(mapped / coords > 0.85, `mapped ${String(mapped)}/${String(coords)}`)
  assert.ok(withChip >= 750, `quests with a chip ${String(withChip)}`)
  assert.ok(itemsWithSource >= 2000, `items with a source ${String(itemsWithSource)}`)
})
