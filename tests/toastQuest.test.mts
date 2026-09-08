// THE QUEST-ITEM TOAST'S QUEST BLOCK (EQ Zera, ROADMAP §1) — what the card prints, pinned.
//
// The celebration overlay is MUI-free and fetches NOTHING, so every string in a quest block is
// decided by `toastQuestCard` before the push leaves main. That makes the formatter the ONLY
// place the card's promises can be checked, and this file is where they are checked: which of
// the quest's steps gets lit, which six of sixty get printed, how many the reader is being told
// they cannot see, and what happens when the catalog knows the item on neither side.
//
// THE WINDOW IS THE THING WORTH PINNING. A drop that lands at step 12 of 15 must not print steps
// 1-6; that failure is invisible in a screenshot (six real steps, correctly formatted, about the
// wrong part of the quest) and obvious in an assertion about `before`/`after`.
//
// Plus ONE case over the REAL committed catalog, because a formatter that only ever sees
// synthetic quests proves nothing about quests.json's actual shapes — and `questCatalog.ts` is
// exercised as the SHIPPED index rather than a mirror of it, which it can be only because it
// imports no `electron`.
//
// Pure — no Electron, no fixtures, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  litStepIndex,
  questRoleFor,
  toastQuestCard
} from '../src/shared/toastQuest'
import { questByPage } from '../src/main/questCatalog'
import { TOAST_MAX_QUEST_STEPS, TOAST_MAX_STEP_TEXT, TOAST_MAX_TEXT } from '../src/shared/toast'
import questsRaw from '../src/renderer/src/data/eqlegends/quests.json' with { type: 'json' }
import type { QuestData, QuestEntry } from '../src/shared/types'

/** A catalog-shaped quest, with only the fields the card reads. */
function quest(over: Partial<QuestEntry> = {}): QuestEntry {
  return {
    name: 'Corrupt Guards',
    page: 'Corrupt Guards',
    giver: 'Kaskus Kerra',
    startZone: 'Kaladim',
    requiredItems: ['Guard Bracelet'],
    rewards: [{ name: 'Bunker Battle Blade' }],
    steps: ['Hail Kaskus Kerra', 'Kill the guards', 'Hand Kaskus Kerra 4 Guard Bracelet'],
    ...over
  }
}

/** `count` numbered steps, with `name` planted in the one at `at` (0-based). */
function steps(count: number, at?: number, name = 'Glowing Sceptre'): string[] {
  return Array.from({ length: count }, (_, i) =>
    i === at ? `Hand Vurgo the ${name}` : `Do the ${String(i + 1)} thing`
  )
}

// ---- the role join --------------------------------------------------------------------

test('the role comes from the catalog, both ways round — and is UNDEFINED when it knows neither', () => {
  assert.equal(questRoleFor(quest(), 'Guard Bracelet'), 'required')
  assert.equal(questRoleFor(quest(), 'Bunker Battle Blade'), 'reward')
  assert.equal(questRoleFor(quest(), 'Djarn’s Amethyst Ring'), undefined)
  // The join is `questItemKey`: the tier suffix dropped, case folded. An item the log spelled
  // with a `+2` is the same turn-in, or the Quests tab and this card would disagree.
  assert.equal(questRoleFor(quest(), 'guard bracelet'), 'required')
  assert.equal(questRoleFor(quest(), 'Guard Bracelet +2'), 'required')
})

test('REQUIRED wins when a quest names the same item on both sides', () => {
  // The player is holding the thing they just looted, so the turn-in is the honest reading.
  const both = quest({ requiredItems: ['Gnoll Fang'], rewards: [{ name: 'Gnoll Fang' }] })
  assert.equal(questRoleFor(both, 'Gnoll Fang'), 'required')
})

test('a card whose catalog entry names the item on neither side still says something: required', () => {
  // Something upstream matched this item to this quest; a turn-in is what that match nearly
  // always is, and a blank role is not a thing the overlay can draw.
  const card = toastQuestCard(quest({ requiredItems: [], rewards: [] }), 'Some Unknown Thing')
  assert.equal(card.role, 'required')
})

// ---- where ----------------------------------------------------------------------------

test('`where` prints only the halves the catalog knows, and is ABSENT when it knows neither', () => {
  assert.equal(toastQuestCard(quest(), 'Guard Bracelet').where, 'Kaskus Kerra · Kaladim')
  assert.equal(toastQuestCard(quest({ startZone: undefined }), 'Guard Bracelet').where, 'Kaskus Kerra')
  assert.equal(toastQuestCard(quest({ giver: undefined }), 'Guard Bracelet').where, 'Kaladim')
  const nowhere = toastQuestCard(quest({ giver: undefined, startZone: undefined }), 'Guard Bracelet')
  assert.equal(nowhere.where, undefined)
  assert.equal('where' in nowhere, false, 'an unknown place is an ABSENT field, never an empty string')
})

// ---- the step window ------------------------------------------------------------------

test('a short quest prints all of itself: no window, nothing hidden either side', () => {
  const card = toastQuestCard(quest(), 'Guard Bracelet')
  assert.deepEqual(card.steps, ['Hail Kaskus Kerra', 'Kill the guards', 'Hand Kaskus Kerra 4 Guard Bracelet'])
  assert.equal(card.before, 0)
  assert.equal(card.after, 0)
  assert.equal(card.litStep, 2)
  // Exactly at the cap is still "all of it".
  const six = toastQuestCard(quest({ steps: steps(TOAST_MAX_QUEST_STEPS) }), 'Guard Bracelet')
  assert.equal(six.steps.length, TOAST_MAX_QUEST_STEPS)
  assert.equal(six.before, 0)
  assert.equal(six.after, 0)
})

test('a drop at step 12 of 15 prints the steps AROUND it, and counts what it is not printing', () => {
  const long = quest({ steps: steps(15, 11), requiredItems: ['Glowing Sceptre'] })
  const card = toastQuestCard(long, 'Glowing Sceptre')
  assert.equal(card.steps.length, TOAST_MAX_QUEST_STEPS)
  assert.ok(card.litStep !== undefined, 'the step naming the item must be lit')
  assert.equal(card.steps[card.litStep], 'Hand Vurgo the Glowing Sceptre')
  // The lit step is INSIDE the printed window, not an index into the full list.
  assert.ok(card.litStep >= 0 && card.litStep < card.steps.length)
  // …and the reader is told the whole truth about the list they are seeing a slice of.
  assert.equal(card.before + card.steps.length + card.after, 15)
  assert.equal(card.before, 9)
  assert.equal(card.after, 0)
})

test('a drop in the MIDDLE is centred, with steps left on both sides', () => {
  const card = toastQuestCard(quest({ steps: steps(20, 9) }), 'Glowing Sceptre')
  assert.equal(card.steps.length, TOAST_MAX_QUEST_STEPS)
  assert.equal(card.before, 7)
  assert.equal(card.after, 20 - 7 - TOAST_MAX_QUEST_STEPS)
  assert.equal(card.litStep, 2)
  assert.ok(card.before > 0 && card.after > 0, 'a mid-quest window is open at both ends')
})

test('no step names the item: the card shows the quest’s OPENING and lights nothing', () => {
  const card = toastQuestCard(quest({ steps: steps(15) }), 'Glowing Sceptre')
  assert.deepEqual(card.steps, steps(15).slice(0, TOAST_MAX_QUEST_STEPS))
  assert.equal(card.litStep, undefined)
  assert.equal('litStep' in card, false, 'nothing lit is an ABSENT field, never a 0 that lights step 1')
  assert.equal(card.before, 0)
  assert.equal(card.after, 9)
})

test('a key under three characters lights NOTHING — a confident wrong highlight is the worse bug', () => {
  assert.equal(litStepIndex(['Kill a kaskus', 'Hand it over'], 'Ka'), undefined)
  assert.equal(litStepIndex(['Kill a kaskus', 'Hand it over'], 'Kas'), 0)
  assert.equal(litStepIndex([], 'Guard Bracelet'), undefined)
})

// ---- the caps -------------------------------------------------------------------------

test('a walkthrough paragraph masquerading as a step is CUT, not wrapped forever', () => {
  const paragraph = `Hand Vurgo the Glowing Sceptre ${'and then keep walking '.repeat(20)}`
  const card = toastQuestCard(quest({ steps: [paragraph] }), 'Glowing Sceptre')
  assert.ok(paragraph.length > 300, 'the fixture must actually be long')
  assert.equal(card.steps[0].length, TOAST_MAX_STEP_TEXT)
  assert.ok(card.steps[0].endsWith('…'), `expected an ellipsis, got: ${card.steps[0].slice(-10)}`)
  assert.ok(card.steps[0].startsWith('Hand Vurgo the Glowing Sceptre'))
})

test('whitespace the wiki left in a step is collapsed before it is measured', () => {
  const card = toastQuestCard(quest({ steps: ['  Hail   Kaskus\n\tKerra  '] }), 'Guard Bracelet')
  assert.deepEqual(card.steps, ['Hail Kaskus Kerra'])
})

test('the quest name is capped like every other string a window draws', () => {
  const card = toastQuestCard(quest({ name: 'q'.repeat(5000) }), 'Guard Bracelet')
  assert.equal(card.name.length, TOAST_MAX_TEXT)
})

// ---- the real catalog -------------------------------------------------------------------
//
// Synthetic quests prove the arithmetic; only quests.json proves the join survives contact with
// the wiki's actual spellings ("Hand Yeolarn Bronzeleaf 4 Bone Chips, unstacked.").

const catalog = questsRaw as unknown as QuestData

test('a REAL Bone Chips quest lights its real hand-in step', () => {
  const q = catalog.quests.find(
    (x) =>
      (x.requiredItems ?? []).includes('Bone Chips') &&
      (x.steps ?? []).some((s) => s.toLowerCase().includes('bone chips'))
  )
  assert.ok(q, 'the committed catalog must still carry a Bone Chips turn-in with steps')
  const card = toastQuestCard(q, 'Bone Chips')
  assert.equal(card.role, 'required')
  assert.ok(card.litStep !== undefined, `nothing lit for ${q.page}: ${JSON.stringify(card.steps)}`)
  assert.match(card.steps[card.litStep].toLowerCase(), /bone chips/)
  assert.equal(card.before + card.steps.length + card.after, (q.steps ?? []).length)
})

test('…and the four-line Felwithe one prints whole, with its giver and zone', () => {
  const q = questByPage('Bone Chips Felwithe')
  assert.ok(q, 'quests.json must still carry the Felwithe Bone Chips quest')
  const card = toastQuestCard(q, 'Bone Chips')
  assert.equal(card.name, 'Bone Chips Felwithe')
  assert.equal(card.page, 'Bone Chips Felwithe')
  assert.equal(card.role, 'required')
  assert.equal(card.where, 'Yeolarn Bronzeleaf · Northern Felwithe')
  assert.equal(card.before, 0)
  assert.equal(card.after, 0)
  assert.equal(card.litStep, card.steps.length - 1)
  assert.match(card.steps[card.steps.length - 1], /Hand Yeolarn Bronzeleaf 4 Bone Chips/)
})

// ---- the page index (src/main/questCatalog.ts) -----------------------------------------

test('questByPage answers on the exact title, and retries case-insensitively', () => {
  assert.equal(questByPage('Bone Chips Felwithe')?.page, 'Bone Chips Felwithe')
  // MediaWiki titles differ in case constantly; a block that vanished over a capital letter
  // would look exactly like a bug.
  assert.equal(questByPage('bone chips felwithe')?.page, 'Bone Chips Felwithe')
  assert.equal(questByPage('  Bone Chips Felwithe  ')?.page, 'Bone Chips Felwithe')
})

test('an unknown page yields NOTHING rather than a fabricated quest', () => {
  assert.equal(questByPage('A Quest That Was Never Scraped'), undefined)
  assert.equal(questByPage(''), undefined)
  assert.equal(questByPage('   '), undefined)
})
