// HAND TICKS ARE STEP INDEXES, SO A CHANGED STEP LIST MUST NOT INHERIT THEM (src/shared/questStepsSig.ts).
//
// Harvester Quest's steps went from 4 to 7 when its checklist heading became readable (2026-11-25):
// an old tick on step 1 ("You Say 'What harvester?'") would now tick "Shadowed Scythe (drops off a
// shadowed man)" — a claim the player never made. Pinned: the signature, the two paths of the read
// reconcile (a stored signature that differs; a pin stored before signatures, cleared only for the
// pages whose steps changed in this release), the write path adopting the current list, the
// sanitizer keeping the field, and the changed-pages set against the real catalog.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import type { QuestData } from '../src/shared/types'
import { sanitizeQuestPins, setTick, type QuestPin } from '../src/shared/questPins'
import { STEPS_CHANGED_THIS_RELEASE, adoptStepsSignatures, reconcileQuestTicks, stepsSignature } from '../src/shared/questStepsSig'

const quests = (questsJson as unknown as QuestData).quests
const stepsOf = (page: string): readonly string[] | undefined => quests.find((q) => q.page === page)?.steps
const pin = (page: string, ticks: number[], stepsSig?: string): QuestPin => ({ page, pinnedAt: 1, ticks, ...(stepsSig === undefined ? {} : { stepsSig }) })

test('the signature is the count and a hash of the texts: any change to either changes it', () => {
  const s = stepsSignature(['Hail him', 'Hand him the ale'])
  assert.match(s, /^2:[0-9a-f]{8}$/)
  assert.equal(stepsSignature(['Hail him', 'Hand him the ale']), s)
  assert.notEqual(stepsSignature(['Hail him', 'Hand him the beer']), s)
  assert.notEqual(stepsSignature(['Hail him', 'Hand him the ale', 'Done']), s)
  // Joined unambiguously: two lines are not one line with the separator in it.
  assert.notEqual(stepsSignature(['a\nb']), stepsSignature(['a', 'b']))
  assert.equal(stepsSignature([]), stepsSignature([]))
})

test('READ: a stored signature that differs drops that quest’s hand ticks; a matching one keeps them', () => {
  const current = stepsSignature(stepsOf("Tarton's Wheel") ?? [])
  const kept = reconcileQuestTicks([pin("Tarton's Wheel", [0, 2], current)], stepsOf, new Set())
  assert.deepEqual(kept[0].ticks, [0, 2])
  const stale = reconcileQuestTicks([pin("Tarton's Wheel", [0, 2], '9:deadbeef')], stepsOf, new Set())
  assert.deepEqual(stale[0].ticks, [])
  assert.equal(stale[0].stepsSig, current, 'and adopts the current list, so it happens once')
})

test('READ, A PIN FROM BEFORE SIGNATURES: cleared only for a page whose steps changed this release; adopted elsewhere', () => {
  const out = reconcileQuestTicks([pin('Harvester Quest', [1, 3]), pin("Tarton's Wheel", [0, 2])], stepsOf)
  assert.deepEqual(out[0].ticks, [], 'Harvester’s old step 1 is not its new step 1')
  assert.deepEqual(out[1].ticks, [0, 2], 'an unchanged quest keeps every tick')
  assert.equal(out[0].stepsSig, stepsSignature(stepsOf('Harvester Quest') ?? []))
  assert.equal(out[1].stepsSig, stepsSignature(stepsOf("Tarton's Wheel") ?? []))
  // Once adopted it is a plain match: a second read clears nothing more.
  const again = reconcileQuestTicks([{ ...out[0], ticks: [4] }, out[1]], stepsOf)
  assert.deepEqual(again[0].ticks, [4])
  // Nothing to change: the SAME array back, so the caller knows not to write.
  assert.equal(reconcileQuestTicks(again, stepsOf), again)
  // A page the catalog no longer has is left exactly as stored.
  const gone = [pin('Not A Quest', [0])]
  assert.equal(reconcileQuestTicks(gone, stepsOf), gone)
})

test('WRITE: the renderer’s ticks were made against this catalog, so a write adopts it and drops nothing', () => {
  const ticked = setTick([pin('Harvester Quest', [])], 'Harvester Quest', 1, true)
  const stored = adoptStepsSignatures(ticked, stepsOf)
  assert.deepEqual(stored[0].ticks, [1])
  assert.equal(stored[0].stepsSig, stepsSignature(stepsOf('Harvester Quest') ?? []))
  assert.deepEqual(reconcileQuestTicks(stored, stepsOf)[0].ticks, [1], 'and the next read keeps it')
})

test('the sanitizer keeps a well-formed signature through both directions, and drops a junk one', () => {
  const sig = stepsSignature(['x'])
  assert.equal(sanitizeQuestPins([pin('A', [0], sig)])[0].stepsSig, sig)
  assert.equal(sanitizeQuestPins([{ page: 'A', pinnedAt: 1, ticks: [0], stepsSig: 'drop table' }])[0].stepsSig, undefined)
  assert.equal(setTick([pin('A', [], sig)], 'A', 0, true)[0].stepsSig, sig, 'a tick fold carries it')
})

test('THE CHANGED-THIS-RELEASE SET: real catalog pages (diffed against v1.30.1 quests.json: only Harvester moved steps)', () => {
  assert.deepEqual([...STEPS_CHANGED_THIS_RELEASE], ['Harvester Quest'])
  for (const page of STEPS_CHANGED_THIS_RELEASE) assert.ok(stepsOf(page), page)
})
