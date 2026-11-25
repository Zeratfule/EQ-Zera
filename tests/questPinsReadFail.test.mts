// A FAILED FIRST READ IS NOT A READ (features/quests/useQuestPins.ts).
//
// The tracker is written WHOLE, so an edit folded over an unread placeholder overwrites the stored
// tracker (4d23e5d). A read that FAILS leaves the same placeholder — so it must leave edits refused
// too (`ready` stays false, the quest page's controls stay disabled), and the next refresh signal
// retries the read. Run against the real module with a spied `window.eq` (a separate file from
// questPinsReady.test.mts because the document is module state).
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { QuestPins } from '../src/shared/questPins'

let fail = true
let reads = 0
const writes: QuestPins[] = []
let progress: (() => void) | null = null
const stored: QuestPins = [{ page: "Tarton's Wheel", pinnedAt: 11, ticks: [1] }]
const bridge = {
  getQuestPins: (): Promise<QuestPins> => {
    reads++
    return fail ? Promise.reject(new Error('store unreadable')) : Promise.resolve(stored)
  },
  setQuestPins: (p: QuestPins): Promise<QuestPins> => {
    writes.push(p)
    return Promise.resolve(p)
  },
  onCharacter: (): (() => void) => () => undefined,
  onProgress: (cb: () => void): (() => void) => {
    progress = cb
    return () => undefined
  }
}
;(globalThis as { window?: unknown }).window = { eq: bridge }
const { questPinDoors, questPinsSnapshot, startQuestPins } = await import('../src/renderer/src/features/quests/useQuestPins')
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

test('a failed read leaves the tracker NOT ready, and an edit then writes nothing', async () => {
  startQuestPins()
  await settle()
  assert.equal(reads, 1)
  assert.equal(questPinsSnapshot().ready, false, 'a failed read is not a settled read')
  questPinDoors.toggle('Harvester Quest')
  questPinDoors.tick("Tarton's Wheel", 0, true)
  assert.equal(writes.length, 0, 'no placeholder overwrote the stored tracker')
})

test('the next refresh signal retries the read, and only then do edits land, over the stored rows', async () => {
  fail = false
  progress?.()
  await settle()
  assert.equal(reads, 2)
  assert.equal(questPinsSnapshot().ready, true)
  questPinDoors.toggle('Harvester Quest')
  assert.deepEqual(writes[0]?.map((p) => p.page), ["Tarton's Wheel", 'Harvester Quest'])
  assert.deepEqual(writes[0][0].ticks, [1])
})

test('once ready, a further mount reads nothing more', async () => {
  startQuestPins()
  await settle()
  assert.equal(reads, 2)
})
