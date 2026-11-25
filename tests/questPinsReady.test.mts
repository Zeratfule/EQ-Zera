// AN EDIT BEFORE THE FIRST READ MUST NOT OVERWRITE THE STORED TRACKER (features/quests/useQuestPins.ts).
//
// The tracker is one document, written WHOLE. Before the first `getQuestPins` settles the renderer
// holds an empty placeholder; an edit folded over THAT and written would replace a character's whole
// stored tracker with one row (review 2026-11-25). So edits wait for `ready`: before it they change
// nothing and write nothing (and the page's controls are disabled, so a click cannot be lost
// silently). Run against the real module with a spied `window.eq`.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { QuestPins } from '../src/shared/questPins'

let resolveRead: ((p: QuestPins) => void) | null = null
const writes: QuestPins[] = []
const bridge = {
  getQuestPins: (): Promise<QuestPins> => new Promise((r) => (resolveRead = r)),
  setQuestPins: (p: QuestPins): Promise<QuestPins> => {
    writes.push(p)
    return Promise.resolve(p)
  },
  onCharacter: (): (() => void) => () => undefined,
  onProgress: (): (() => void) => () => undefined
}
;(globalThis as { window?: unknown }).window = { eq: bridge }
const { questPinDoors, questPinsSnapshot, startQuestPins } = await import('../src/renderer/src/features/quests/useQuestPins')

const stored: QuestPins = [
  { page: 'Hate, Betrayal, and Trust', pinnedAt: 10, ticks: [0] },
  { page: "Tarton's Wheel", pinnedAt: 11, ticks: [] }
]

test('before the first read settles, every edit is refused: nothing changes and nothing is written', () => {
  startQuestPins()
  questPinDoors.toggle('Harvester Quest')
  questPinDoors.tick('Hate, Betrayal, and Trust', 1, true)
  questPinDoors.markDone("Tarton's Wheel", 5)
  questPinDoors.clearDone("Tarton's Wheel")
  assert.equal(writes.length, 0, 'no write of a placeholder tracker')
  assert.equal(questPinsSnapshot().ready, false)
  assert.deepEqual(questPinsSnapshot().pins, [])
})

test('once it settles, an edit folds over the STORED tracker and keeps every row', async () => {
  resolveRead?.(stored)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(questPinsSnapshot().ready, true)
  questPinDoors.toggle('Harvester Quest')
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].map((p) => p.page), ['Hate, Betrayal, and Trust', "Tarton's Wheel", 'Harvester Quest'])
  assert.deepEqual(writes[0][0].ticks, [0], 'the stored tick survives')
})
