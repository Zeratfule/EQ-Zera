// HAND TICKS ARE STEP INDEXES, SO A TICK MUST NOT OUTLIVE THE STEP IT WAS MADE ON
// (src/shared/questStepsSig.ts).
//
// Harvester Quest's steps went from 4 to 7 on 2026-11-25: an old tick on step 1 would have ticked
// "Shadowed Scythe (drops off a shadowed man)" as had. But most step-text changes are NOT changes of
// meaning — 25 quests re-rendered a step in place between v1.30.1 and this build — and those must keep
// their ticks. Pinned: the normalisation on verbatim before/after pairs, the read reconcile (count
// changed, one ticked step changed, nothing changed, a pin stored before keys), the write path, the
// sanitizer, and the generated legacy set.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import type { QuestData } from '../src/shared/types'
import { sanitizeQuestPins, setTick, type QuestPin } from '../src/shared/questPins'
import { LEGACY_CHANGED_PAGES, adoptStepsKeys, normaliseStep, reconcileQuestTicks, stepHash, stepsKeyFor } from '../src/shared/questStepsSig'

const quests = (questsJson as unknown as QuestData).quests
const stepsOf = (page: string): readonly string[] | undefined => quests.find((q) => q.page === page)?.steps
const pin = (page: string, ticks: number[], extra: Partial<QuestPin> = {}): QuestPin => ({ page, pinnedAt: 1, ticks, ...extra })

test('IN-PLACE RE-RENDERS ARE THE SAME STEP: verbatim v1.30.1 -> today pairs hash equal', () => {
  const pairs: [string, string][] = [
    // a {{Loc}} written out bare, and with the zone name in front of it
    ['The Nybright sisters can be found at a camp located within the Lesser Faydark at , near the entrance to Mistmoore Castle.', 'The Nybright sisters can be found at a camp located within the Lesser Faydark at (-802, 2682, -2), near the entrance to Mistmoore Castle.'],
    ['Daleen Leafsway may be found in the garden at outside the Druid guild.', 'Daleen Leafsway may be found in the garden at Rivervale (-85, -345) outside the Druid guild.'],
    ['You receive A Note, which you need to deliver to Deputy Tagil, who is guarding the entrance to Rivervale in . ', 'You receive A Note, which you need to deliver to Deputy Tagil, who is guarding the entrance to Rivervale in Misty Thicket (480, -2480).'],
    ['Turn Blanket in to Garadain Glacierbane ( ) to receive Ring', 'Turn Blanket in to Garadain Glacierbane (Eastern Wastes -2714, -390) to receive Ring'],
    ['Byzar Bloodforge is located at or as he paths between two rooms in the Kaladim Warrior\'s Guild.', 'Byzar Bloodforge is located at South Kaladim (-108, 381, 3) or South Kaladim (-38, 400, 3) as he paths between two rooms in the Kaladim Warrior\'s Guild.'],
    ['Bixie in Misty Thicket:', 'Bixie (600, -50), (400, -1250), (-385, 675) in Misty Thicket:'],
    ['Turn in to Xiblin Fizzlebik', 'Turn in to Xiblin Fizzlebik Timorous Deep (-5778, 2943)'],
    ['Give Ostorm ( ) a Ruby', 'Give Ostorm (Temple of Solusek Ro 430, -80, 35) a Ruby'],
    // a heading line reformatted
    ['==== Dreadscale Helm ====', 'Dreadscale Helm:'],
    ['===Ivy Etched Tunic===', 'Ivy Etched Tunic:']
  ]
  for (const [a, b] of pairs) assert.equal(stepHash(a), stepHash(b), `${a}\n${b}\n${normaliseStep(a)}\n${normaliseStep(b)}`)
})

test('A DIFFERENT STEP IS DIFFERENT: Harvester’s old steps against its new ones, and a changed word', () => {
  const old = ["You Say 'Hail Vurgo'", "You Say 'What harvester?'", 'Hand Vurgo the Shadowed Scythe']
  const now = stepsOf('Harvester Quest') ?? []
  for (let i = 0; i < old.length; i++) assert.notEqual(stepHash(old[i]), stepHash(now[i]), `step ${String(i)}`)
  assert.notEqual(stepHash('Kill the orc'), stepHash('Kill the gnoll'))
})

test('READ: a changed step COUNT drops every hand tick of that quest', () => {
  const steps = stepsOf("Tarton's Wheel") ?? []
  const stored = pin("Tarton's Wheel", [0, 2], { stepsKey: { n: steps.length + 1, at: {} } })
  const out = reconcileQuestTicks([stored], stepsOf, new Set())
  assert.deepEqual(out[0].ticks, [])
  assert.equal(out[0].stepsKey?.n, steps.length)
})

test('READ: a ticked step whose meaning changed loses THAT tick only; the others stay', () => {
  const steps = stepsOf("Tarton's Wheel") ?? []
  const key = stepsKeyFor(steps, [0, 2])
  key.at['2'] = stepHash('a step that said something else entirely')
  const out = reconcileQuestTicks([pin("Tarton's Wheel", [0, 2], { stepsKey: key })], stepsOf, new Set())
  assert.deepEqual(out[0].ticks, [0])
  assert.deepEqual(Object.keys(out[0].stepsKey?.at ?? {}), ['0'])
})

test('READ: an unchanged quest keeps its ticks and is not rewritten (the SAME array back)', () => {
  const steps = stepsOf("Tarton's Wheel") ?? []
  const pins = [pin("Tarton's Wheel", [0, 2], { stepsKey: stepsKeyFor(steps, [0, 2]) })]
  assert.equal(reconcileQuestTicks(pins, stepsOf), pins)
  const gone = [pin('Not A Quest', [0])]
  assert.equal(reconcileQuestTicks(gone, stepsOf), gone, 'a page the catalog lacks is left as stored')
})

test('READ, A PIN STORED BEFORE KEYS: a quest whose steps moved in ANY release since v1.19.0 loses its ticks; others keep them', () => {
  const out = reconcileQuestTicks([pin('Harvester Quest', [1, 3]), pin('The Betrayer', [2]), pin("Tarton's Wheel", [0, 2])], stepsOf)
  assert.deepEqual(out[0].ticks, [], 'Harvester (moved in this release)')
  assert.deepEqual(out[1].ticks, [], 'The Betrayer (44 -> 8 steps before v1.30.1)')
  assert.deepEqual(out[2].ticks, [0, 2], 'an unmoved quest keeps every tick')
  for (const p of out) assert.ok(p.stepsKey, 'and every pin is keyed, so this happens once')
  assert.deepEqual(reconcileQuestTicks([{ ...out[0], ticks: [] }], stepsOf)[0].ticks, [])
})

test('WRITE: the renderer ticked against this catalog, so a write keys it and drops nothing', () => {
  const ticked = setTick([pin('Harvester Quest', [])], 'Harvester Quest', 1, true)
  const stored = adoptStepsKeys(ticked, stepsOf)
  assert.deepEqual(stored[0].ticks, [1])
  assert.equal(stored[0].stepsKey?.at['1'], stepHash((stepsOf('Harvester Quest') ?? [])[1]))
  assert.deepEqual(reconcileQuestTicks(stored, stepsOf)[0].ticks, [1], 'and the next read keeps it')
})

test('the sanitizer keeps a well-formed key through both directions and drops junk', () => {
  const key = { n: 3, at: { '0': 'deadbeef' } }
  assert.deepEqual(sanitizeQuestPins([pin('A', [0], { stepsKey: key })])[0].stepsKey, key)
  assert.equal(sanitizeQuestPins([{ page: 'A', pinnedAt: 1, ticks: [0], stepsKey: 'x' }])[0].stepsKey, undefined)
  assert.deepEqual(sanitizeQuestPins([{ page: 'A', pinnedAt: 1, ticks: [0], stepsKey: { n: 3, at: { '0': 'nope', x: 'deadbeef', '1': 'cafef00d' } } }])[0].stepsKey, { n: 3, at: { '1': 'cafef00d' } })
  assert.deepEqual(setTick([pin('A', [], { stepsKey: key })], 'A', 0, true)[0].stepsKey, key, 'a tick fold carries it')
})

test('THE LEGACY SET (generated from every release since v1.19.0): the five pre-v1.30.1 movers and Harvester, not the in-place re-renders', () => {
  for (const p of ['Harvester Quest', 'Respecialization', 'Something Fishy', 'The Betrayer', 'The Tragic Tale of House Everling', 'Thex Dagger Quest']) assert.ok(LEGACY_CHANGED_PAGES.has(p), p)
  for (const p of ['Hungry Deputy', 'Dreadscale Armor', "Sebilis and Veeshan's Peak Key Quest"]) assert.ok(!LEGACY_CHANGED_PAGES.has(p), p)
  for (const p of LEGACY_CHANGED_PAGES) assert.ok(stepsOf(p) !== undefined, `${p} is a catalog quest`)
})
