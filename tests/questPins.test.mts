// ============================================================================
// THE QUEST TRACKER'S DOCUMENT (EQ Zera) — `src/shared/questPins.ts`.
// ============================================================================
//
// A pin is the player's own statement: this is a quest I am running, these are the steps I ticked
// by hand, and this is when it was recorded done. Everything the LOG contributes is re-derived on
// every read (shared/questProgress.ts) and is deliberately not in this file — so what is pinned
// here is exactly the half a store file has to be able to round-trip.
//
// What this suite pins:
//   1. THE FIXED POINT, BOTH WAYS. `sanitizeQuestPins` runs on the write (the IPC handler, because
//      the renderer is untrusted) and on the read (the store accessor, because a progress file is
//      hand-editable), so `sanitize(sanitize(x))` must equal `sanitize(x)` for every input — the
//      `sanitizeExaltPlans`/`sanitizeWishlist` contract, restated over a simpler shape.
//   2. IT STRIPS RATHER THAN REJECTS: a nonsense tick loses the tick, not the pin; one unreadable
//      entry loses that entry, not the player's whole tracker.
//   3. THE CAPS, which are guards on renderer-supplied input reaching the store rather than
//      statements about how many quests a person may run.
//   4. THE FOUR FOLDS — toggle, tick, done, undone — including the two things each of them
//      deliberately does NOT do (untracking keeps no ghost ticks; re-recording a completion keeps
//      the FIRST instant; clearing a completion leaves the hand ticks alone).
//
// Run: `node --import tsx --test tests/questPins.test.mts`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_QUEST_PINS,
  MAX_QUEST_TICKS,
  clearDone,
  markDone,
  sanitizeQuestPins,
  sanitizeTicks,
  setTick,
  togglePin,
  type QuestPins
} from '../src/shared/questPins'

const pin = (page: string, ticks: number[] = [], doneAt?: number): QuestPins[number] =>
  doneAt === undefined ? { page, pinnedAt: 100, ticks } : { page, pinnedAt: 100, ticks, doneAt }

// ── 1. the fixed point ────────────────────────────────────────────────────────────────────────

test('sanitize is a FIXED POINT — the same validator runs on the write and on the read', () => {
  const inputs: unknown[] = [
    null,
    undefined,
    'not a list',
    42,
    {},
    [],
    [{ page: 'A Job for Nanrum', pinnedAt: 1, ticks: [3, 1, 1, -2, 2.7] }],
    [{ page: '  padded  ', pinnedAt: 'nope', ticks: 'nope', doneAt: -1 }],
    [{ page: 'X', pinnedAt: 5, ticks: [0], doneAt: 1234 }, { page: 'X', pinnedAt: 9, ticks: [7] }],
    [1, 'two', null, { nope: true }, { page: '   ' }]
  ]
  for (const input of inputs) {
    const once = sanitizeQuestPins(input)
    assert.deepEqual(sanitizeQuestPins(once), once, `not a fixed point for ${JSON.stringify(input)}`)
  }
})

test('anything that is not a list is an EMPTY tracker, never a throw', () => {
  assert.deepEqual(sanitizeQuestPins(null), [])
  assert.deepEqual(sanitizeQuestPins({ page: 'X' }), [])
  assert.deepEqual(sanitizeQuestPins('[]'), [])
})

// ── 2. it strips rather than rejects ──────────────────────────────────────────────────────────

test('a bad tick loses the TICK, not the pin', () => {
  const [kept] = sanitizeQuestPins([{ page: 'Q', pinnedAt: 7, ticks: [2, 'x', NaN, -1, 0, 2] }])
  assert.equal(kept.page, 'Q')
  assert.equal(kept.pinnedAt, 7)
  assert.deepEqual(kept.ticks, [0, 2], 'unique, ascending, whole and non-negative')
})

test('one unreadable entry loses THAT ENTRY, not the whole tracker', () => {
  const out = sanitizeQuestPins([{ page: 'Keep me', pinnedAt: 1, ticks: [] }, null, { page: '' }, 5, { page: 'And me' }])
  assert.deepEqual(out.map((p) => p.page), ['Keep me', 'And me'])
})

test('an absent doneAt stays ABSENT — the read path must not write a key into a stored file', () => {
  const [kept] = sanitizeQuestPins([{ page: 'Q', pinnedAt: 1, ticks: [] }])
  assert.equal('doneAt' in kept, false)
  assert.equal(sanitizeQuestPins([{ page: 'Q', pinnedAt: 1, ticks: [], doneAt: 900 }])[0].doneAt, 900)
})

test('a page is trimmed, and a blank one is not a pin at all', () => {
  assert.equal(sanitizeQuestPins([{ page: '  A Job for Nanrum ' }])[0].page, 'A Job for Nanrum')
  assert.deepEqual(sanitizeQuestPins([{ page: '   ' }]), [])
})

test('DEDUPED BY PAGE, first entry wins — a hand-edited repeat keeps the one nearest the top', () => {
  const out = sanitizeQuestPins([pin('X', [1]), pin('Y'), pin('X', [9])])
  assert.deepEqual(out.map((p) => p.page), ['X', 'Y'])
  assert.deepEqual(out[0].ticks, [1])
})

// ── 3. the caps ───────────────────────────────────────────────────────────────────────────────

test('the tracker is capped at MAX_QUEST_PINS', () => {
  const many: QuestPins = []
  for (let i = 0; i < MAX_QUEST_PINS + 20; i++) many.push(pin(`Q${String(i)}`))
  assert.equal(sanitizeQuestPins(many).length, MAX_QUEST_PINS)
})

test('one pin is capped at MAX_QUEST_TICKS', () => {
  const ticks: number[] = []
  for (let i = 0; i < MAX_QUEST_TICKS + 50; i++) ticks.push(i)
  assert.equal(sanitizeTicks(ticks).length, MAX_QUEST_TICKS)
  assert.equal(sanitizeQuestPins([{ page: 'Q', pinnedAt: 0, ticks }])[0].ticks.length, MAX_QUEST_TICKS)
})

test('a pin past the cap is REFUSED rather than evicting somebody else', () => {
  const full: QuestPins = []
  for (let i = 0; i < MAX_QUEST_PINS; i++) full.push(pin(`Q${String(i)}`))
  const after = togglePin(full, 'One More', 500)
  assert.equal(after.length, MAX_QUEST_PINS)
  assert.equal(after.some((p) => p.page === 'One More'), false)
  assert.equal(after[0].page, 'Q0', 'the oldest row was not silently thrown away')
})

// ── 4. the four folds ─────────────────────────────────────────────────────────────────────────

test('togglePin adds, then removes — and untracking keeps NO ghost ticks', () => {
  const on = togglePin([], 'A Job for Nanrum', 1234)
  assert.deepEqual(on, [{ page: 'A Job for Nanrum', pinnedAt: 1234, ticks: [] }])
  const ticked = setTick(on, 'A Job for Nanrum', 1, true)
  assert.deepEqual(ticked[0].ticks, [1])
  assert.deepEqual(togglePin(ticked, 'A Job for Nanrum', 9999), [], 'the row went whole')
})

test('a blank page is not something you can track', () => {
  assert.deepEqual(togglePin([], '   ', 1), [])
})

test('setTick ticks and un-ticks, and leaves an untracked quest alone', () => {
  const base = togglePin([], 'Q', 1)
  const one = setTick(base, 'Q', 3, true)
  assert.deepEqual(one[0].ticks, [3])
  assert.deepEqual(setTick(one, 'Q', 3, true)[0].ticks, [3], 'ticking twice is one tick')
  assert.deepEqual(setTick(one, 'Q', 3, false)[0].ticks, [])
  assert.deepEqual(setTick(base, 'Not tracked', 0, true), base, 'no pin, nowhere to put it')
  assert.deepEqual(setTick(base, 'Q', -1, true)[0].ticks, [], 'a negative step index is not a step')
})

test('markDone records the instant ONCE — re-recording keeps the first', () => {
  const base = togglePin([], 'Q', 1)
  const done = markDone(base, 'Q', 5000)
  assert.equal(done[0].doneAt, 5000)
  assert.equal(markDone(done, 'Q', 9000)[0].doneAt, 5000)
  assert.equal(markDone(base, 'Nope', 5000)[0].doneAt, undefined, 'an untracked quest records nothing')
})

test('clearDone takes the note off and leaves the hand ticks — two different statements', () => {
  const done = markDone(setTick(togglePin([], 'Q', 1), 'Q', 2, true), 'Q', 5000)
  const cleared = clearDone(done, 'Q')
  assert.equal('doneAt' in cleared[0], false)
  assert.deepEqual(cleared[0].ticks, [2])
  assert.deepEqual(clearDone(cleared, 'Q'), cleared, 'clearing twice changes nothing')
})

test('every fold hands back a SANITIZED list, so a fold over junk cannot store junk', () => {
  const junk = [{ page: 'Q', pinnedAt: 'x', ticks: [1, -5] }, null] as unknown as QuestPins
  for (const out of [
    togglePin(junk, 'Q', 1),
    setTick(junk, 'Q', 0, true),
    markDone(junk, 'Q', 10),
    clearDone(junk, 'Q')
  ]) {
    assert.deepEqual(sanitizeQuestPins(out), out)
  }
})
