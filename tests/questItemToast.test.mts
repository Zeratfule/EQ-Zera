// WHICH LOOT LINES DESERVE A QUEST CARD (ROADMAP §1).
//
// `features/quests/questItemToast.ts` is the whole decision behind the quest-item pop-up, and it
// is pure so that every rule below is pinned here rather than by looting things in the game. The
// hook around it owns only the live-only baseline and the send.
//
// WHAT IS WORTH PINNING, and why each one is not obvious:
//   * a DESTROY rides the same loot lane as an acquisition (JOS-401), and congratulating somebody
//     for throwing a quest item away is the failure this guards.
//   * an item the catalog does not name pops NOTHING. No card beats a card about a quest we made
//     up (world-model law 1).
//   * MY CLASSES narrows and never hides: it drops a quest the catalog positively says is
//     somebody else's, and drops nothing at all with the switch off or with no resolved loadout.
//   * REQUIRED BEFORE REWARD, whatever order the catalog happened to be built in.
//   * THREE QUESTS MAX, because an item feeding nine of them is a page and not a card.
//   * the REPEAT WINDOW is keyed on the ITEM: a stack looted forty times in an hour is one card.
//   * the four SUBTITLE wordings, which are the sentence the player actually reads.
//
// The title is the LOG'S OWN spelling (law 2) while the join and the id use `questItemKey`, so the
// ids below are built from that function rather than from a hand-typed lower-cased guess.
//
// No window, no React, no Electron — this suite can never skip.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LootEvent, QuestEntry } from '../src/shared/types'
import { buildQuestsByItem, questItemKey, type QuestItemRef } from '../src/shared/questIndex'
import { questItemToastRequests } from '../src/renderer/src/features/quests/questItemToast'
import { DEFAULT_QUEST_TOAST_PREFS, type QuestToastPrefs } from '../src/renderer/src/features/quests/questToastPrefs'

const CHIPS = 'Bone Chips'
const CHIPS_KEY = questItemKey(CHIPS)
const TRINKET = 'Shiny Trinket'

/**
 * Three hand-made quests over one item: one open to every class, one the wiki restricts to
 * Clerics, and one that only REWARDS it. The reward quest is FIRST in the catalog on purpose —
 * that is what makes "required before reward" a claim about the sort rather than about the input.
 */
const REWARDS_CHIPS: QuestEntry = { name: 'Bone Boon', page: 'Bone Boon', rewards: [{ name: CHIPS }, { name: TRINKET }] }
const OPEN_QUEST: QuestEntry = { name: 'Rusty Errand', page: 'Rusty Errand', requiredItems: [CHIPS] }
const CLERIC_QUEST: QuestEntry = { name: 'Cleric Test', page: 'Cleric Test', classes: ['Cleric'], requiredItems: [CHIPS] }

const BY_ITEM = buildQuestsByItem({ quests: [REWARDS_CHIPS, OPEN_QUEST, CLERIC_QUEST] })

function loot(item: string, ts: number, extra: Partial<LootEvent> = {}): LootEvent {
  return { ts, item, ...extra }
}

/** One call with everything defaulted to "on, no class filter, a fresh memory". */
function run(
  events: readonly LootEvent[],
  opts: {
    byItem?: ReadonlyMap<string, QuestItemRef[]>
    classes?: readonly string[]
    prefs?: Partial<QuestToastPrefs>
    recent?: Map<string, number>
    now?: number
  } = {}
): ReturnType<typeof questItemToastRequests> {
  return questItemToastRequests({
    events,
    byItem: opts.byItem ?? BY_ITEM,
    classes: opts.classes ?? [],
    prefs: { ...DEFAULT_QUEST_TOAST_PREFS, ...opts.prefs },
    recent: opts.recent ?? new Map<string, number>(),
    now: opts.now ?? 1_000_000
  })
}

// ── the card itself ──────────────────────────────────────────────────────────────────────

test('a quest item fires one request, titled the way the log spelled it and anchored at the first quest', () => {
  const reqs = run([loot(CHIPS, 42)])
  assert.equal(reqs.length, 1)
  const r = reqs[0]
  assert.equal(r.id, `questItem:${CHIPS_KEY}:42`)
  assert.equal(r.kind, 'questItem')
  assert.equal(r.title, CHIPS)
  assert.equal(r.itemName, CHIPS)
  assert.deepEqual(r.questPages, ['Rusty Errand', 'Cleric Test', 'Bone Boon'])
  assert.deepEqual(r.focus, { view: 'quests', quest: 'Rusty Errand' })
})

test("the log's own spelling survives the join — a `+N` item still keys to its base", () => {
  const reqs = run([loot(`${CHIPS} +2`, 7)])
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].title, `${CHIPS} +2`)
  assert.equal(reqs[0].itemName, `${CHIPS} +2`)
  assert.equal(reqs[0].id, `questItem:${CHIPS_KEY}:7`)
})

test('an item the catalog does not know fires nothing', () => {
  assert.deepEqual(run([loot('Rat Ear', 1)]), [])
})

test('a DESTROY is not a loot — throwing a quest item away celebrates nothing', () => {
  assert.deepEqual(run([loot(CHIPS, 1, { disposition: 'destroyed' })]), [])
})

// ── the class filter ─────────────────────────────────────────────────────────────────────

test('my classes drops the Cleric quest for a Warrior and keeps the ones open to everyone', () => {
  const reqs = run([loot(CHIPS, 1)], { classes: ['WAR'] })
  assert.equal(reqs.length, 1)
  assert.deepEqual(reqs[0].questPages, ['Rusty Errand', 'Bone Boon'])
  assert.deepEqual(reqs[0].focus, { view: 'quests', quest: 'Rusty Errand' })
})

test('with the switch off, nothing is dropped even with a loadout resolved', () => {
  const reqs = run([loot(CHIPS, 1)], { classes: ['WAR'], prefs: { myClasses: false } })
  assert.deepEqual(reqs[0].questPages, ['Rusty Errand', 'Cleric Test', 'Bone Boon'])
})

test('with no resolved loadout, nothing is dropped even with the switch on', () => {
  const reqs = run([loot(CHIPS, 1)], { classes: [], prefs: { myClasses: true } })
  assert.deepEqual(reqs[0].questPages, ['Rusty Errand', 'Cleric Test', 'Bone Boon'])
})

test('a class the filter keeps sees its own quest', () => {
  const reqs = run([loot(CHIPS, 1)], { classes: ['CLR'] })
  assert.deepEqual(reqs[0].questPages, ['Rusty Errand', 'Cleric Test', 'Bone Boon'])
})

// ── ordering and the cap ─────────────────────────────────────────────────────────────────

test("'required' quests come before 'reward' ones, whatever order the catalog was built in", () => {
  // The reward quest is the FIRST entry in the catalog above, so this is the sort talking.
  const pages = run([loot(CHIPS, 1)])[0].questPages
  assert.deepEqual(pages, ['Rusty Errand', 'Cleric Test', 'Bone Boon'])
})

test('an item feeding five quests names three of them', () => {
  const many: QuestEntry[] = []
  for (let i = 1; i <= 5; i++) many.push({ name: `Errand ${String(i)}`, page: `Errand ${String(i)}`, requiredItems: [CHIPS] })
  const reqs = run([loot(CHIPS, 1)], { byItem: buildQuestsByItem({ quests: many }) })
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].questPages?.length, 3)
  assert.deepEqual(reqs[0].questPages, ['Errand 1', 'Errand 2', 'Errand 3'])
})

// ── the repeat window ────────────────────────────────────────────────────────────────────

const MIN = 60_000

test('at five minutes, the same item four minutes later says nothing and six minutes later says it again', () => {
  const recent = new Map<string, number>()
  const t0 = 5_000_000
  assert.equal(run([loot(CHIPS, 1)], { recent, now: t0 }).length, 1)
  assert.equal(run([loot(CHIPS, 2)], { recent, now: t0 + 4 * MIN }).length, 0)
  assert.equal(run([loot(CHIPS, 3)], { recent, now: t0 + 6 * MIN }).length, 1)
})

test('two lines of one stack in the same batch are one card', () => {
  const reqs = run([loot(CHIPS, 1), loot(CHIPS, 2), loot(CHIPS, 3)])
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].id, `questItem:${CHIPS_KEY}:1`)
})

test('the window is keyed on the ITEM, so a different quest item still pops', () => {
  const recent = new Map<string, number>()
  const reqs = run([loot(CHIPS, 1), loot(TRINKET, 2)], { recent })
  assert.equal(reqs.length, 2)
  assert.equal(recent.size, 2)
})

test('a one-minute window lets the same item back after ninety seconds', () => {
  const recent = new Map<string, number>()
  const t0 = 9_000_000
  assert.equal(run([loot(CHIPS, 1)], { recent, prefs: { repeatMin: 1 }, now: t0 }).length, 1)
  assert.equal(run([loot(CHIPS, 2)], { recent, prefs: { repeatMin: 1 }, now: t0 + 90_000 }).length, 1)
})

test('a suppressed loot does not extend the window — the clock runs from the card that showed', () => {
  const recent = new Map<string, number>()
  const t0 = 3_000_000
  run([loot(CHIPS, 1)], { recent, now: t0 })
  run([loot(CHIPS, 2)], { recent, now: t0 + 4 * MIN })
  assert.equal(recent.get(CHIPS_KEY), t0)
})

// ── the four subtitle wordings ───────────────────────────────────────────────────────────

test('one quest that needs it names the quest', () => {
  const only = buildQuestsByItem({ quests: [OPEN_QUEST] })
  assert.equal(run([loot(CHIPS, 1)], { byItem: only })[0].subtitle, 'Quest item · needed for Rusty Errand')
})

test('one quest that gives it names the quest the other way round', () => {
  const only = buildQuestsByItem({ quests: [REWARDS_CHIPS] })
  assert.equal(run([loot(TRINKET, 1)], { byItem: only })[0].subtitle, 'Quest item · reward from Bone Boon')
})

test('several quests are a count, and any required one decides the verb', () => {
  assert.equal(run([loot(CHIPS, 1)])[0].subtitle, 'Quest item · needed for 3 quests')
})

test('several quests that only give it are a count the other way round', () => {
  const givers = buildQuestsByItem({
    quests: [
      { name: 'Bone Boon', page: 'Bone Boon', rewards: [{ name: CHIPS }] },
      { name: 'Bone Bounty', page: 'Bone Bounty', rewards: [{ name: CHIPS }] }
    ]
  })
  assert.equal(run([loot(CHIPS, 1)], { byItem: givers })[0].subtitle, 'Quest item · reward from 2 quests')
})

test('no subtitle anywhere uses an em dash (the repo copy law)', () => {
  for (const r of run([loot(CHIPS, 1)])) {
    assert.equal(/[–—]/.test(r.subtitle ?? ''), false)
    assert.equal(/[–—]/.test(r.title), false)
  }
})
