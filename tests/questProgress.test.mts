// ============================================================================
// WHAT THE LOG MAY CONCLUDE ABOUT A CATALOG QUEST (EQ Zera) — `src/shared/questProgress.ts`.
// ============================================================================
//
// The Quests tab's checklist is ticked by two authors, and this file is the whole of what the LOG
// is allowed to say. Everything below is pinned against the REAL pure production code, and the
// last case is pinned against the REAL committed catalog, so a re-scrape that changes "A Job for
// Nanrum" fails here rather than on somebody's screen.
//
// What this suite pins:
//   1. THE GIVER FOLD, on the four ugly shapes the catalog actually contains — a comma list, a
//      trailing "(NPC)", a "Loc: -3813, 1668, -102" clause, and an article ("The Great Oowomp",
//      "a skeleton (miner)"). The `loc:` clause and the parenthetical are stripped BEFORE the list
//      is split, because both of them contain commas and splitting first shreds one name into
//      three fragments of which two are numbers.
//   2. THE STEP READING, on the spellings the catalog actually uses — `You say, 'Hail, X'` and
//      `You Say 'Hail X'`, and hand-ins that start Hand / Give / Turn in.
//   3. COMPLETION IS THE `countTurnIns` RULE: every required item reached the giver. A SUPERSET
//      offer completes; a subset does not; a turn-in to a different NPC does nothing; a quest with
//      no `requiredItems` (161 of the 904) can never auto-complete, said plainly.
//   4. THE HAND STEP naming a turned-in item goes auto, and THE HAIL STEP TICKS ITSELF once the
//      `hails` module has a greeting to the NPC the step names (roadmap 2). The seam was typed and
//      silent from the day this file was written; what changed is that a witness now arrives, so
//      the cases below drive the rule through the SAME giver fold the turn-in join runs — a hail
//      that only matched on an exact string would tick "The Great Oowomp" and miss "Great Oowomp".
//   5. THE SILENT BASELINE (`newlyCompleted`), the transition every celebration in this app obeys.
//
// Run: `node --import tsx --test tests/questProgress.test.mts`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyStep,
  giverCandidates,
  giverMatches,
  nameKeys,
  newlyCompleted,
  questProgress
} from '../src/shared/questProgress'
import questsRaw from '../src/renderer/src/data/eqlegends/quests.json' with { type: 'json' }
import type { QuestData, QuestEntry, TurnInEvent } from '../src/shared/types'

const catalog = (questsRaw as unknown as QuestData).quests

/** A hand-built quest: the rules are arithmetic over a giver and an item list. */
const quest = (over: Partial<QuestEntry>): QuestEntry =>
  ({ name: 'Test', page: 'Test', ...over }) as QuestEntry

const turnIn = (npc: string, items: string[], ts = 1000): TurnInEvent => ({ ts, npc, items })

const evidence = (turnIns: TurnInEvent[], held: string[] = []) => ({
  held: new Set(held),
  turnIns
})

/** The `hails` module's rows, as the evidence bundle carries them (`HailRow` is `{npc, ts}`). */
const withHails = (npcs: string[]) => ({
  held: new Set<string>(),
  turnIns: [],
  hails: npcs.map((npc, i) => ({ npc, ts: 1000 + i }))
})

// ── 1. the giver fold ─────────────────────────────────────────────────────────────────────────

test('THE COMMA LIST: "Ostorm, Genni, Gardern, Vilissia" is four givers, not one string', () => {
  assert.deepEqual(giverCandidates('Ostorm, Genni, Gardern, Vilissia'), ['ostorm', 'genni', 'gardern', 'vilissia'])
  assert.equal(giverMatches('Ostorm, Genni, Gardern, Vilissia', 'Gardern'), true)
  assert.equal(giverMatches('Ostorm, Genni, Gardern, Vilissia', 'Ostorma'), false, 'never a substring')
})

test('THE TRAILING PARENTHETICAL: "Trumpy Irontoe (NPC)" and "a skeleton (miner)"', () => {
  assert.deepEqual(giverCandidates('Trumpy Irontoe (NPC)'), ['trumpy irontoe'])
  assert.deepEqual(giverCandidates('a skeleton (miner)'), ['a skeleton'])
  assert.equal(giverMatches('Trumpy Irontoe (NPC)', 'Trumpy Irontoe'), true)
  assert.equal(giverMatches('a skeleton (miner)', 'a skeleton'), true)
})

test('THE LOC CLAUSE is stripped BEFORE the split — its commas are coordinates, not names', () => {
  assert.deepEqual(giverCandidates('Marlyn McMerin Loc: -3813, 1668, -102'), ['marlyn mcmerin'])
  assert.deepEqual(giverCandidates('Jemoz Lerkarson (loc: 59, 350, -27.81)'), ['jemoz lerkarson'])
  assert.deepEqual(giverCandidates('Vegalys Keldrane (310, 200)'), ['vegalys keldrane'])
  assert.equal(giverMatches('Marlyn McMerin Loc: -3813, 1668, -102', 'Marlyn McMerin'), true)
})

test('THE ARTICLE is stripped for MATCHING on both sides (law 2), never from the stored spelling', () => {
  assert.deepEqual(giverCandidates('The Great Oowomp'), ['the great oowomp'], 'the fold keeps it')
  assert.equal(giverMatches('The Great Oowomp', 'Great Oowomp'), true)
  assert.equal(giverMatches('Great Oowomp', 'The Great Oowomp'), true)
  assert.deepEqual(nameKeys('The Great Oowomp'), ['the great oowomp', 'great oowomp'])
  assert.deepEqual(nameKeys('Basher Nanrum'), ['basher nanrum'])
})

test('"and" / "or" separate names too, and a giverless quest matches nobody', () => {
  assert.deepEqual(giverCandidates('Master Xydoz and others'), ['master xydoz', 'others'])
  assert.deepEqual(giverCandidates(undefined), [])
  assert.deepEqual(giverCandidates('   '), [])
  assert.equal(giverMatches(undefined, 'Anybody'), false)
})

test('the fold is `mobKey` — case, whitespace runs and the backtick/apostrophe all fold', () => {
  assert.equal(giverMatches('Ithvol K`Jasn', "ITHVOL K'JASN"), true)
  assert.equal(giverMatches('Basher   Nanrum', ' basher nanrum '), true)
})

// ── 2. the step reading ───────────────────────────────────────────────────────────────────────

test('BOTH hail spellings the catalog uses, comma or no comma', () => {
  assert.deepEqual(classifyStep("You say, 'Hail, Basher Nanrum'"), { kind: 'hail', npc: 'Basher Nanrum' })
  assert.deepEqual(classifyStep("You Say 'Hail Nicholas'"), { kind: 'hail', npc: 'Nicholas' })
  assert.deepEqual(classifyStep("You say, 'Hail, Ernax the Scholar'"), { kind: 'hail', npc: 'Ernax the Scholar' })
})

test('hand-ins start Hand / Give / Turn in', () => {
  assert.equal(classifyStep('Hand in three Fire Beetle Eyes.').kind, 'handin')
  assert.equal(classifyStep('Give Nicholas the Kilij Plans and receive the Mold of Ro Boots.').kind, 'handin')
  assert.equal(classifyStep('Turn in both the Scythe and the Heart to Camlend Serbold.').kind, 'handin')
  assert.equal(classifyStep('Hand Larkon Theardor the combined Air Tight Box').kind, 'handin')
})

test('anything else is "other" — a location line is not an instruction', () => {
  assert.equal(classifyStep('Your location is -4.05, -70.53, 3.81.').kind, 'other')
  assert.equal(classifyStep('The "shinies" include random low-level gems.').kind, 'other')
  assert.equal(classifyStep('Qaelin Hailstorm can be found at 170, 135 in Surefall Glade.').kind, 'other')
})

// ── 3. completion ─────────────────────────────────────────────────────────────────────────────

const TWO_ITEMS = quest({
  giver: 'Basher Nanrum',
  requiredItems: ['Fire Beetle Eye', 'Bone Chips'],
  steps: ['Hand in three Fire Beetle Eyes.', 'Give him the Bone Chips.']
})

test('A SUPERSET COMPLETES — the trade carrying more than the quest asked for still finished it', () => {
  const p = questProgress(
    TWO_ITEMS,
    evidence([turnIn('Basher Nanrum', ['Fire Beetle Eye', 'Bone Chips', 'Rusty Dagger'])]),
    []
  )
  assert.equal(p.complete, true)
  assert.equal(p.completeAt, 1000, 'dated off the turn-in, EQ’s own clock')
  assert.deepEqual([...p.turnedIn].sort(), ['bone chips', 'fire beetle eye'])
})

test('A SUBSET DOES NOT', () => {
  const p = questProgress(TWO_ITEMS, evidence([turnIn('Basher Nanrum', ['Fire Beetle Eye'])]), [])
  assert.equal(p.complete, false)
  assert.equal(p.completeAt, undefined)
  assert.deepEqual([...p.turnedIn], ['fire beetle eye'])
})

test('…but two trades that together carry the list DO — a quest is done, not run', () => {
  const p = questProgress(
    TWO_ITEMS,
    evidence([turnIn('Basher Nanrum', ['Fire Beetle Eye'], 100), turnIn('Basher Nanrum', ['Bone Chips'], 200)]),
    []
  )
  assert.equal(p.complete, true)
  assert.equal(p.completeAt, 200, 'the instant the LAST required item landed')
})

test('A TURN-IN TO SOMEBODY ELSE DOES NOTHING', () => {
  const p = questProgress(TWO_ITEMS, evidence([turnIn('Some Other Guy', ['Fire Beetle Eye', 'Bone Chips'])]), [])
  assert.equal(p.complete, false)
  assert.equal(p.turnedIn.size, 0)
})

test('NO requiredItems CAN NEVER AUTO-COMPLETE (161 of the 904 quests) — stated, not approximated', () => {
  const q = quest({ giver: 'Basher Nanrum', steps: ["You say, 'Hail, Basher Nanrum'"] })
  const p = questProgress(q, evidence([turnIn('Basher Nanrum', ['Anything At All'])]), [])
  assert.equal(p.complete, false)
  assert.equal(p.completeAt, undefined)
  let none = 0
  for (const e of catalog) if ((e.requiredItems ?? []).length === 0) none++
  assert.equal(none, 161, 'the count this rule is about, off the committed catalog')
})

// ── 4. the steps the log ticks ────────────────────────────────────────────────────────────────

test('THE HAND STEP NAMING A TURNED-IN ITEM GOES AUTO, the others do not', () => {
  const p = questProgress(TWO_ITEMS, evidence([turnIn('Basher Nanrum', ['Fire Beetle Eye'])]), [])
  assert.deepEqual([...p.auto], [0], 'the eye step only — the chips have not been handed over')
})

test('a hand step naming NO item of the quest waits for the whole quest', () => {
  const q = quest({
    giver: 'Basher Nanrum',
    requiredItems: ['Fire Beetle Eye'],
    steps: ['Give him the eyes.', 'Hand over the coin purse and take your reward.']
  })
  const half = questProgress(q, evidence([]), [])
  assert.equal(half.auto.has(1), false)
  const done = questProgress(q, evidence([turnIn('Basher Nanrum', ['Fire Beetle Eye'])]), [])
  assert.equal(done.complete, true)
  assert.equal(done.auto.has(1), true, 'the quest being finished is the only evidence there is')
})

test('LIT is the held-item rule, and it is NOT the same signal as ticked', () => {
  const q = quest({ requiredItems: ['Fire Beetle Eye'], steps: ['Loot a Fire Beetle Eye.', 'Go to Grobb.'] })
  const p = questProgress(q, evidence([], ['fire beetle eye']), [])
  assert.deepEqual([...p.lit], [0])
  assert.equal(p.auto.size, 0, 'holding it is not handing it over')
})

test('THE HAIL STEP TICKS ITSELF — no hails, no tick; a hail to that NPC, a tick', () => {
  const q = quest({ giver: 'Basher Nanrum', steps: ["You say, 'Hail, Basher Nanrum'"] })
  assert.equal(questProgress(q, evidence([]), []).auto.size, 0, 'an empty log ticks nothing')
  assert.deepEqual([...questProgress(q, withHails(['Basher Nanrum']), []).auto], [0])
})

test('…and a hail to somebody ELSE ticks nothing, however many of them there are', () => {
  const q = quest({ giver: 'Basher Nanrum', steps: ["You say, 'Hail, Basher Nanrum'"] })
  const p = questProgress(q, withHails(['Trumpy Irontoe', 'Nicholas', 'Basher Nanrums']), [])
  assert.equal(p.auto.size, 0, 'never a substring, and never the nearest name')
})

test('THE HAIL GOES THROUGH THE GIVER FOLD, not through string equality', () => {
  // Every one of these is a shape `giverCandidates` already handles for the TURN-IN join; the
  // point of this case is that the hail rule reaches the same answer, because it calls the same
  // `giverMatches`. A second name matcher for hails is exactly the drift that fold exists to stop.
  const article = quest({ steps: ["You say, 'Hail, The Great Oowomp'"] })
  assert.deepEqual([...questProgress(article, withHails(['Great Oowomp']), []).auto], [0], 'leading article')
  const cased = quest({ steps: ["You Say 'Hail Nicholas'"] })
  assert.deepEqual([...questProgress(cased, withHails(['nicholas']), []).auto], [0], 'casing')
  const paren = quest({ steps: ["You say, 'Hail, Trumpy Irontoe (NPC)'"] })
  assert.deepEqual([...questProgress(paren, withHails(['Trumpy Irontoe']), []).auto], [0], 'parenthetical')
})

test('a hail step that NAMES NOBODY stays manual — there is nothing for a witness to match', () => {
  const q = quest({ steps: ["You say, 'Hail'"] })
  assert.equal(classifyStep("You say, 'Hail'").npc, undefined)
  assert.equal(questProgress(q, withHails(['Basher Nanrum']), []).auto.size, 0)
})

test('done counts the UNION of the log’s ticks and the player’s, and ignores out-of-range ticks', () => {
  const p = questProgress(TWO_ITEMS, evidence([turnIn('Basher Nanrum', ['Fire Beetle Eye'])]), [0, 1, 99])
  assert.equal(p.total, 2)
  assert.equal(p.done, 2, 'step 0 is in both lists; step 99 does not exist')
})

// ── 5. the silent baseline ────────────────────────────────────────────────────────────────────

test('THE BASELINE RUN (prev === null) CELEBRATES NOTHING', () => {
  assert.deepEqual(newlyCompleted(null, new Map([['A', true], ['B', true]])), [])
})

test('…and a page that BECOMES complete afterwards is news exactly once', () => {
  const prev = new Map([['A', true], ['B', false]])
  assert.deepEqual(newlyCompleted(prev, new Map([['A', true], ['B', true]])), ['B'])
  const after = new Map([['A', true], ['B', true]])
  assert.deepEqual(newlyCompleted(after, after), [], 'the same map twice is not two completions')
})

test('a page seen for the FIRST time already complete is still news — it was not there to be false', () => {
  assert.deepEqual(newlyCompleted(new Map([['A', true]]), new Map([['A', true], ['C', true]])), ['C'])
})

// ── THE REAL CATALOG CASE ─────────────────────────────────────────────────────────────────────

test('A REAL QUEST, END TO END: "A Job for Nanrum" completes on one Fire Beetle Eye', () => {
  let nanrum: QuestEntry | undefined
  for (const e of catalog) if (e.name === 'A Job for Nanrum') nanrum = e
  assert.ok(nanrum, 'the committed catalog still has this quest')
  const q = nanrum as QuestEntry
  assert.equal(q.giver, 'Basher Nanrum')
  assert.deepEqual(q.requiredItems, ['Fire Beetle Eye'])

  const p = questProgress(q, evidence([turnIn('Basher Nanrum', ['Fire Beetle Eye'], 4242)]), [])
  assert.equal(p.complete, true, 'the giver received every item it requires')
  assert.equal(p.completeAt, 4242)

  const steps = q.steps ?? []
  let handIn = -1
  for (let i = 0; i < steps.length; i++) if (steps[i] === 'Hand in three Fire Beetle Eyes.') handIn = i
  assert.ok(handIn >= 0, 'the walkthrough still has its hand-in step')
  assert.equal(p.auto.has(handIn), true, 'the step naming the item that was turned in is ticked by the log')

  let hail = -1
  for (let i = 0; i < steps.length; i++) if (classifyStep(steps[i]).kind === 'hail') hail = i
  assert.ok(hail >= 0, 'and it still has a hail step')
  assert.equal(p.auto.has(hail), false, 'which stays manual while the log holds no greeting')

  // …and ticks itself the moment one arrives, on the REAL catalog step rather than a hand-built
  // one — the whole path the roadmap item asked for, over the spelling this quest actually uses.
  const greeted = questProgress(q, withHails(['Basher Nanrum']), [])
  assert.equal(greeted.auto.has(hail), true, 'the hails module witnesses the greeting the step names')
})

test('THE WIKI-PLURAL MISS IS DOCUMENTED, NOT DE-PLURALIZED (law 12)', () => {
  // The catalog asks for "Infected Rat Livers"; the log offers "Infected Rat Liver". Guessing the
  // singular is a fuzzy cross-source name matcher, so this quest simply never auto-completes, and
  // the miss is pinned here so nobody "fixes" it with a stemmer.
  const q = quest({ giver: 'Someone', requiredItems: ['Infected Rat Livers'], steps: ['Hand them over.'] })
  const p = questProgress(q, evidence([turnIn('Someone', ['Infected Rat Liver'])]), [])
  assert.equal(p.complete, false)
  assert.equal(p.turnedIn.size, 0)
})
