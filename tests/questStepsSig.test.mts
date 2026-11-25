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
import { LEGACY_MOVED, NORMALISER_VERSION, adoptStepsKeys, legacyRule, normaliseStep, questStepsDigest, reconcileQuestTicks, resolveLegacyBaseline, stepHash, stepsKeyFor } from '../src/shared/questStepsSig'
import changedJson from '../src/shared/questStepsChanged.json'

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
  const out = reconcileQuestTicks([stored], stepsOf, () => false)
  assert.deepEqual(out[0].ticks, [])
  assert.equal(out[0].stepsKey?.n, steps.length)
})

test('READ: a ticked step whose meaning changed loses THAT tick only; the others stay', () => {
  const steps = stepsOf("Tarton's Wheel") ?? []
  const key = stepsKeyFor(steps, [0, 2])
  key.at['2'] = stepHash('a step that said something else entirely')
  const out = reconcileQuestTicks([pin("Tarton's Wheel", [0, 2], { stepsKey: key })], stepsOf, () => false)
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

test('THE LEGACY MAP (generated from every release since v1.19.0): each moved quest names the NEWEST release it differs from', () => {
  assert.equal(LEGACY_MOVED.get('Harvester Quest'), '1.30.1', 'moved in this release')
  for (const p of ['Respecialization', 'Something Fishy', 'The Betrayer', 'The Tragic Tale of House Everling', 'Thex Dagger Quest']) {
    const v = LEGACY_MOVED.get(p)
    assert.ok(v !== undefined && v !== '1.30.1', `${p} moved before v1.30.1 (${String(v)})`)
  }
  for (const p of ['Hungry Deputy', 'Dreadscale Armor', "Sebilis and Veeshan's Peak Key Quest"]) assert.ok(!LEGACY_MOVED.has(p), `${p} only re-rendered`)
  for (const p of LEGACY_MOVED.keys()) assert.ok(stepsOf(p) !== undefined, `${p} is a catalog quest`)
})

test('READ, A PIN STORED BEFORE KEYS, LAST RUN KNOWN: only quests that moved AFTER that release lose ticks', () => {
  const legacy = [pin('Harvester Quest', [1]), pin('The Betrayer', [2]), pin("Tarton's Wheel", [0])]
  // Last run on v1.30.1: The Betrayer's move (before it) was already under the player's ticks.
  const on1301 = reconcileQuestTicks(legacy, stepsOf, legacyRule('1.30.1'))
  assert.deepEqual(on1301.map((p) => p.ticks), [[], [2], [0]])
  // Last run on v1.26.0: The Betrayer moved after that, so its ticks go too.
  const on1260 = reconcileQuestTicks(legacy, stepsOf, legacyRule('1.26.0'))
  assert.deepEqual(on1260.map((p) => p.ticks), [[], [], [0]])
  // A build newer than every listed release: nothing moved since.
  assert.deepEqual(reconcileQuestTicks(legacy, stepsOf, legacyRule('9.0.0')).map((p) => p.ticks), [[1], [2], [0]])
})

test('READ, A PIN STORED BEFORE KEYS, LAST RUN UNKNOWN: every quest that moved since the tracker shipped loses ticks', () => {
  const out = reconcileQuestTicks([pin('Harvester Quest', [1]), pin('The Betrayer', [2]), pin("Tarton's Wheel", [0])], stepsOf, legacyRule(null))
  assert.deepEqual(out.map((p) => p.ticks), [[], [], [0]])
  assert.deepEqual(reconcileQuestTicks([pin('The Betrayer', [2])], stepsOf).map((p) => p.ticks), [[]], 'the default is the unknown rule')
})

test('NOT STALE: questStepsChanged.json was generated from THIS quests.json (re-run `npm run gen:quest-steps-changed`)', () => {
  assert.equal(
    (changedJson as { stepsDigest: string }).stepsDigest,
    questStepsDigest(quests),
    'quests.json steps changed since src/shared/questStepsChanged.json was generated: run `npm run gen:quest-steps-changed` and commit it'
  )
  // …and the digest does move with any step edit, so this check can fail.
  const edited = quests.map((q, i) => (i === 0 ? { ...q, steps: [...(q.steps ?? []), 'one more step'] } : q))
  assert.notEqual(questStepsDigest(edited), questStepsDigest(quests))
})

test('A KEY FROM ANOTHER NORMALISER VERSION is re-keyed, never judged: the tick stays', () => {
  const steps = stepsOf("Tarton's Wheel") ?? []
  // Hashes no current normaliser would produce, under an older version number: not evidence.
  const old = { v: NORMALISER_VERSION - 1, n: steps.length, at: { '0': 'deadbeef', '2': 'cafef00d' } }
  const out = reconcileQuestTicks([pin("Tarton's Wheel", [0, 2], { stepsKey: old })], stepsOf, () => false)
  assert.deepEqual(out[0].ticks, [0, 2])
  assert.deepEqual(out[0].stepsKey, stepsKeyFor(steps, [0, 2]))
  assert.equal(out[0].stepsKey?.v, NORMALISER_VERSION)
  // A changed COUNT is not a normaliser question: it still drops.
  const moved = reconcileQuestTicks([pin("Tarton's Wheel", [0], { stepsKey: { ...old, n: steps.length + 3 } })], stepsOf, () => false)
  assert.deepEqual(moved[0].ticks, [])
})

test('THE LEGACY BASELINE IS CAPTURED ONCE PER BUILD and every character is judged by it', () => {
  // First launch of build 1.31.0: the store had no baseline; What's-new last showed 1.30.0.
  const first = resolveLegacyBaseline(undefined, '1.31.0', '1.30.0')
  assert.deepEqual(first, { baseline: '1.30.0', write: { build: '1.31.0', lastRun: '1.30.0' } })
  // Character A is opened in that session: The Betrayer moved at 1.30.0, so its old ticks go.
  const a = reconcileQuestTicks([pin('The Betrayer', [2])], stepsOf, legacyRule(first.baseline))
  assert.deepEqual(a[0].ticks, [])
  // A LATER launch of the same build: the player opened the notes, so the stamp now says 1.31.0 -
  // but the stored baseline answers, so character Z (first opened now) is judged the same way.
  const later = resolveLegacyBaseline(first.write, '1.31.0', '1.31.0')
  assert.deepEqual(later, { baseline: '1.30.0' }, 'no write: the same build never overwrites its baseline')
  const z = reconcileQuestTicks([pin('Harvester Quest', [1]), pin('The Betrayer', [2])], stepsOf, legacyRule(later.baseline))
  assert.deepEqual(z.map((p) => p.ticks), [[], []])
  // A NEWER build captures its own baseline.
  assert.deepEqual(resolveLegacyBaseline(first.write, '1.32.0', '1.31.0'), { baseline: '1.31.0', write: { build: '1.32.0', lastRun: '1.31.0' } })
  // Unknown on the first launch stays unknown (null = the full union), and is stored as such.
  assert.deepEqual(resolveLegacyBaseline(undefined, '1.31.0', null), { baseline: null, write: { build: '1.31.0', lastRun: null } })
  assert.deepEqual(resolveLegacyBaseline({ build: '1.31.0', lastRun: null }, '1.31.0', '1.31.0'), { baseline: null })
  // A junk stored value is ignored and recaptured.
  assert.deepEqual(resolveLegacyBaseline('junk', '1.31.0', '1.30.1'), { baseline: '1.30.1', write: { build: '1.31.0', lastRun: '1.30.1' } })
})
