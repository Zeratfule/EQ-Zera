// ============================================================================
// runTracker.test.mts — THE OWNER'S OWN BEFALLEN 4 (REFINED) CRAWL, folded (2026-09-11).
// ============================================================================
//
// THE FIXTURE IS A REAL RUN. `tests/fixtures/befallen-run.log` is the owner's log from
// 2026-09-10, 23:01:58 to 23:26:12, with PLAYER CHAT REMOVED and nothing else touched: the 136
// `tells General:` lines are gone (other people's words do not belong in this repo) and every other
// line is verbatim, NPC `says` lines included. There is no comment header because the log format
// has no comment; this paragraph is where the provenance lives.
//
// ── HOW THE MODULE SNAPSHOTS GET HERE, AND WHY IT IS NOT A SECOND PARSER ──────────────────────
//
// `runTracker` folds five MODULE SNAPSHOTS, and the parser and the modules that produce them are
// Rust now — there is no way to fold a log from node. So the log is folded ONCE, by the real
// engine, and the result is committed beside it as `tests/fixtures/befallen-run.snapshots.json`.
// This suite reads those snapshots unmodified. Nothing in this file parses a log line, and there
// is no hand-built event anywhere in it: every number below came out of the engine that ships.
//
// TO REGENERATE (needs cargo; the snapshots are frozen otherwise):
//
//     cd engine && cargo build --release -p parity
//     engine/target/release/parity tests/fixtures/befallen-run.log \
//       --character Omniactual --tz America/New_York --snapshots
//
// …then keep the `progression`, `kills`, `loot`, `coin` and `deaths` entries of `modules`. The
// `--tz` is what fixes the epoch values the assertions below pin, so the committed file is
// machine-independent and this suite reads no clock of its own.
//
// ── WHAT IS PINNED ────────────────────────────────────────────────────────────────────────────
//
// The numbers are MEASURED, not chosen: 118 of the owner's own kills and 13 his group's, fourteen
// named in the exact order he listed them, three kinds of key adding to ELEVEN, no deaths, one
// lockpicked door, a reward chest of 28 items, and 54p 153g 247s 350c of auto-sell. The run's two
// edges are the two zone lines that bracket it.
//
// THE CHEST AND THE DOOR ARE WHY THE SNAPSHOTS MOVED (Z Engine, 2026-09-11). Every loot shape
// accepts a container source now, so 22 lines that were `unknown` are loot events and two more
// carry the item name the log actually printed; the lockpick sentence is a `doorUnlocked` event.
// The last test here pins both, and the ONE absence that is still real: no module names who
// landed a kill.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CoinSnap } from '../src/shared/coinTypes'
import type { DeathSnap } from '../src/shared/deathTypes'
import type { KillsSnap } from '../src/shared/kills'
import type { ProgressionSnap } from '../src/shared/progressionTypes'
import type { LootEvent } from '../src/shared/types'
import {
  NO_RUN,
  RUN_OPEN_WORLD,
  RUN_UNKNOWN_TIER,
  instanceTier,
  runBase,
  runElapsedMs,
  runKillsPerMin,
  runTracker,
  type RunState
} from '../src/shared/runTracker'

const HERE = dirname(fileURLToPath(import.meta.url))

interface Fixture {
  progression: ProgressionSnap
  kills: KillsSnap
  loot: LootEvent[]
  coin: CoinSnap
  deaths: DeathSnap
}

const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'befallen-run.snapshots.json'), 'utf8')) as Fixture

/** The run, as the shipped fold sees it. Extra arguments override; nothing else varies. */
function fold(over: Partial<Parameters<typeof runTracker>[0]> = {}): RunState {
  return runTracker({
    snap: FIX.progression,
    kills: FIX.kills,
    loot: FIX.loot,
    coin: FIX.coin.rows,
    deaths: FIX.deaths,
    ...over
  })
}

/** The two zone lines that bracket the run, as the engine stamped them (America/New_York). */
const STARTED_AT = 1789095806000 // Thu Sep 10 23:03:26 2026 — You have entered Befallen 4 (Refined).
const ENDED_AT = 1789097127000 // Thu Sep 10 23:25:27 2026 — You have entered Befallen.

// ---- the zone-name vocabulary ---------------------------------------------------------------

test('an instance difficulty is what the zone line stated, and nothing is guessed', () => {
  // The engine's own cases (engine/crates/fold/src/jsfn.rs), so the two cannot drift apart.
  assert.equal(instanceTier('The Plane of Hate - Solo 4 (Refined)'), 4)
  assert.equal(instanceTier("Nagafen's Lair - Group 3 (Fused)"), 3)
  assert.equal(instanceTier('Najena 4 (Refined)'), 4)
  assert.equal(instanceTier('The Plane of Sky 1 (Awakened)'), 1)
  assert.equal(instanceTier('Befallen 2 (Adaptive)'), 2)
  // A base-difficulty INSTANCE is not the open world, and the open world is not tier 0.
  assert.equal(instanceTier('The Plane of Hate - Solo'), 0)
  assert.equal(instanceTier('Innothule Swamp'), RUN_OPEN_WORLD)
  // The log did not say, or said an adjective this app has never met.
  assert.equal(instanceTier(''), RUN_UNKNOWN_TIER)
  assert.equal(instanceTier('Najena 5 (Sublime)'), RUN_UNKNOWN_TIER)
})

test('the base is the PLACE, with its own casing kept', () => {
  assert.equal(runBase('Befallen 4 (Refined)'), 'Befallen')
  assert.equal(runBase('The Ruins of Old Paineel - Solo 4 (Refined)'), 'The Ruins of Old Paineel')
  assert.equal(runBase('West Commonlands'), 'West Commonlands')
})

// ---- the run itself --------------------------------------------------------------------------

test('the crawl is ONE run, bracketed by the two zone lines that made it', () => {
  // The fixture's zone timeline is Befallen (open world) -> Befallen 4 (Refined) -> Befallen ->
  // West Commonlands. The bare Befallen before it does NOT start a run, and the bare Befallen
  // after it ENDS one: a run stops at the first entry that is not that instance, which is 40
  // seconds before the West Commonlands line.
  assert.deepEqual(FIX.progression.zoneName, [
    'Befallen',
    'Befallen 4 (Refined)',
    'Befallen',
    'West Commonlands'
  ])
  const run = fold()
  assert.equal(run.zone, 'Befallen 4 (Refined)')
  assert.equal(run.base, 'Befallen')
  assert.equal(run.tier, 4)
  assert.equal(run.startedAt, STARTED_AT)
  assert.equal(run.endedAt, ENDED_AT)
  assert.equal(run.active, false, 'a run a later zone line closed is finished, never live')
  assert.equal(run.manual, false)
  assert.equal(runElapsedMs(run, 0), 1_321_000, '22 minutes and 1 second, and it does not move')
})

test('the kills are the owner’s 118 and his group’s 13', () => {
  const run = fold()
  // `killTs` is credited (yours + a bound pet); `witnessTs` is everybody else's, which inside a
  // group is your group. The two pre-run kills Vorren landed in the open world are in the fixture
  // and are OUTSIDE the window, which is what makes 13 rather than 15 the honest number here.
  assert.equal(run.kills, 118)
  assert.equal(run.groupKills, 13)
  assert.equal(FIX.progression.witnessTs.length, 15, 'two of the fifteen happened before the run')
  const pace = runKillsPerMin(run, 0)
  assert.ok(pace !== null && Math.abs(pace - 5.95) < 0.01, `131 kills over 22m01s: ${String(pace)}`)
})

test('the fourteen named, in the order they went down', () => {
  const run = fold()
  assert.deepEqual(
    run.named.map((n) => n.name),
    [
      'skeleton L`rodd',
      'Asaka L`Rei',
      'ice boned skeleton',
      'Footman of V`Zher',
      'ice boned skeleton',
      'Gynok Moltor',
      'Knight V`Tal',
      'Kahaptra Z`Taj',
      'Priest Amiaz',
      'Arisen Thaumaturgist',
      'Boondin Babbinsbort',
      'Korven Nisere',
      'Soldier of V`Zher',
      'Baron Telyx V`Zher'
    ]
  )
  // Ascending, inside the run, and offset from its start — which is what the window prints.
  let prev = 0
  for (const n of run.named) {
    assert.ok(n.at >= STARTED_AT && n.at < ENDED_AT, `${n.name} landed outside the run`)
    assert.ok(n.at >= prev, 'the list is in kill order')
    prev = n.at
  }
  assert.equal(run.named[0].at - run.startedAt, 94_000, 'skeleton L`rodd went down at +1:34')
  // `ice boned skeleton` is in here TWICE, 24 seconds apart, and both are his. It is also the
  // reason the test above is a list and not a set.
  assert.equal(run.named[4].at - run.named[2].at, 24_000)
})

test('the keys are every key the run paid, one row per kind — the chest’s three included', () => {
  const run = fold()
  // Three kinds, and one more of each than the corpses alone paid: the reward chest sold a
  // `Charred Bone Key`, a `Smoked Glass Key` and a `Splintered Wooden Key` at 23:25:12. The `at`
  // is still the FIRST of each kind, which is a corpse in all three cases.
  assert.deepEqual(run.keys, [
    { name: 'Splintered Wooden Key', count: 4, at: 1789096201000 },
    { name: 'Charred Bone Key', count: 4, at: 1789096556000 },
    { name: 'Smoked Glass Key', count: 3, at: 1789096556000 }
  ])
  assert.equal(
    run.keys.reduce((n, k) => n + k.count, 0),
    11
  )
})

test('no deaths, and the auto-sell is summed without a ladder being applied to it', () => {
  const run = fold()
  assert.equal(run.deaths, 0)
  assert.deepEqual(FIX.deaths.recaps, [], 'he did not die once')
  // DENOMINATIONS, exactly as the lines named them. The corpses paid 45p 108g 181s 303c and the
  // reward chest's twenty-one sales paid 9p 45g 66s 47c on top of it — the stream that was lost
  // entirely while the chest lines were `unknown`. This file deliberately applies no conversion:
  // EQ prints none, so the surface that divides declares its own rate in the open (farmRows.ts).
  assert.deepEqual(run.coinAutoSold, { platinum: 54, gold: 153, silver: 247, copper: 350 })
})

// ---- the states that are not a run ----------------------------------------------------------

test('a log that has named no instance has NO RUN, and says so rather than drawing zeroes', () => {
  const bare: ProgressionSnap = {
    ...FIX.progression,
    zoneName: ['West Commonlands'],
    zoneStart: [FIX.progression.zoneStart[0]],
    zoneEnd: [0]
  }
  assert.equal(fold({ snap: bare }), NO_RUN)
})

test('Start run here outranks the zone timeline, and End run freezes it', () => {
  const start = STARTED_AT + 600_000
  const live = fold({ manualStart: start, nowMs: start + 120_000 })
  assert.equal(live.manual, true)
  assert.equal(live.active, true, 'a hand-started run is open until it is ended')
  assert.equal(live.startedAt, start)
  assert.equal(runElapsedMs(live, start + 120_000), 120_000)
  // It is measured over the zone the fold is standing in, which for this fixture is where the log
  // ends — so the counts are the ones that happened AFTER the start it was given.
  assert.equal(live.zone, 'West Commonlands')
  assert.ok(live.kills > 0 && live.kills < 118, `a later start counts fewer kills: ${String(live.kills)}`)

  const ended = fold({ manualStart: start, manualEnd: start + 300_000 })
  assert.equal(ended.active, false)
  assert.equal(ended.endedAt, start + 300_000)
  assert.equal(runElapsedMs(ended, Number.MAX_SAFE_INTEGER), 300_000, 'a finished run does not tick')
})

test('an OPEN run is measured to the instant it is read at, never past the log', () => {
  // The same fixture with its closing zone lines cut off: the instance is the last thing the log
  // named, so the run is still open.
  const open: ProgressionSnap = {
    ...FIX.progression,
    zoneName: ['Befallen', 'Befallen 4 (Refined)'],
    zoneStart: FIX.progression.zoneStart.slice(0, 2),
    zoneEnd: [FIX.progression.zoneStart[1], 0],
    lastTs: ENDED_AT
  }
  const run = fold({ snap: open })
  assert.equal(run.active, true)
  assert.equal(run.endedAt, undefined)
  assert.equal(run.kills, 118, 'the open window reaches the live edge')
  assert.equal(runElapsedMs(run, ENDED_AT + 5000), 1_326_000, 'and the clock keeps going')
})

// ---- the chest and the door, pinned --------------------------------------------------------

test('the reward chest is 24 lines and 28 items, split by where each one went', () => {
  // Both halves of the claim: the LOG still holds twenty-four chest lines, and all twenty-four
  // now reach the fold. Before the parser learned the container source, two of them arrived with
  // the chest glued onto the item name and the other twenty-two arrived as nothing at all.
  const raw = readFileSync(join(HERE, 'fixtures', 'befallen-run.log'), 'utf8')
  assert.equal(
    raw.split('\n').filter((l) => l.includes('from Reward Chest')).length,
    24,
    'twenty-four chest lines in the log'
  )
  const chestRows = FIX.loot.filter((e) => e.sourceKind === 'chest')
  assert.equal(chestRows.length, 24, 'and twenty-four loot rows out of them')
  assert.ok(
    chestRows.every((e) => e.source === 'Reward Chest'),
    'the container is the SOURCE, never part of the item name'
  )
  assert.ok(
    FIX.loot.every((e) => !e.item.includes('Reward Chest')),
    'and no item is named after it any more'
  )

  // STACK SIZES COUNT, the key rows’ own rule: `4 Bone Chips` is four items, and `2 Dark Elf
  // Parts` is two of the twenty-two sold. So 28 items across 24 lines.
  const run = fold()
  assert.deepEqual(run.chest, { items: 28, kept: 5, sold: 22, merged: 1 })
  assert.equal(run.chest.kept + run.chest.sold + run.chest.merged, run.chest.items)
})

test('a lockpicked door is counted, and the run the log ends on has one', () => {
  const raw = readFileSync(join(HERE, 'fixtures', 'befallen-run.log'), 'utf8')
  assert.equal(raw.split('\n').filter((l) => l.includes('unlock the door')).length, 1)
  assert.deepEqual(FIX.progression.doorTs, [1789096950000])
  const run = fold()
  assert.equal(run.doors, 1)
  assert.ok(FIX.progression.doorTs[0] > run.startedAt && FIX.progression.doorTs[0] < ENDED_AT)
})

test('a run with no chest and no door claims neither, and NO_RUN is all zeroes', () => {
  // The window the fixture ends in: West Commonlands, hand-started, with no chest and no door in
  // it. The counts are zero and the surface is the one that decides whether to draw a row.
  const start = ENDED_AT + 1000
  const after = fold({ manualStart: start, nowMs: start + 60_000 })
  assert.deepEqual(after.chest, { items: 0, kept: 0, sold: 0, merged: 0 })
  assert.equal(after.doors, 0)
  assert.deepEqual(NO_RUN.chest, { items: 0, kept: 0, sold: 0, merged: 0 })
  assert.equal(NO_RUN.doors, 0)
})

test('WHO landed a kill is still in no snapshot, so nothing here claims it', () => {
  // The one absence `runTracker.ts`’s header still states. The parser reads the killer off
  // `<Mob> has been slain by <Name>!` and no module carries it, so a named row says WHAT and
  // WHEN and stops there.
  const run = fold()
  assert.ok(run.named.every((n) => Object.keys(n).join(',') === 'name,at'))
})

