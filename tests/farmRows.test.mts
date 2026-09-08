// The FARM METER's model (roadmap 2 item 8) — `src/renderer/src/overlay/farmRows.ts`.
//
// WHAT THIS FILE IS FOR, and what it leaves to its neighbours. The overlay derives almost nothing:
// `rangeStats` is pinned in the progression suite, `windowLootRates` in tests/lootRates.test.mts,
// `respawnReading`/`respawnSourceLabel` in tests/respawn.test.mts and the slice definitions in
// tests/timeslice.test.mts. So nothing here re-checks those arithmetics.
//
// What it DOES check is the part that is new, and every item on that list is a claim about honesty
// rather than about a number:
//
//   * the row SET and its order — six readings, always the same six, so a camp that paid nothing
//     still says so rather than dropping a line;
//   * THE DECLARED COIN LADDER IS IN THE ROW'S OWN LABEL. `shared/acquireEvents.ts`'s law is that
//     the plat ladder is in no line of the log, so a consumer that wants coin-per-hour declares its
//     rate IN THE OPEN. A test that only checked the arithmetic would let the words go missing,
//     which is the half that matters;
//   * ZONE SCOPE. Drops and coin from the camp before this one are not this camp's numbers, even
//     when their timestamps fall inside the stay;
//   * `no watched mobs` rather than a blank, and `Reading log…` rather than six em-dashes.
//
// SNAPSHOTS ARE HAND-BUILT AND ANCHORED IN THE PAST, like every other test over this model: the
// derivations read `snap.lastTs` and never `Date.now()`, and a fixture near the wall clock would
// hide exactly that.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { LootEvent } from '../src/shared/types'
import type { CoinRow } from '../src/shared/coinTypes'
import type { ProgressionSnap } from '../src/shared/progressionTypes'
import {
  DEFAULT_RESPAWN_PREFS,
  RESPAWN_SHAPE_VERSION,
  type RespawnRow,
  type RespawnSnap
} from '../src/shared/respawn'
import { NONE } from '../src/renderer/src/features/leveling/rangeStatsRows'
import {
  COIN_LADDER,
  COIN_LADDER_TEXT,
  COIN_ROW_LABEL,
  FARM_HYDRATING,
  FARM_NO_CLOCK,
  FARM_NO_WATCHES,
  coinCopper,
  coinText,
  coinWindow,
  coinZoneKeys,
  farmOverlayView,
  type FarmRow
} from '../src/renderer/src/overlay/farmRows'

const MIN = 60_000
/** An arbitrary, readable anchor, well behind the wall clock on purpose. */
const T0 = Date.parse('Sat Aug 01 12:00:00 2026')

const ZONE = 'Befallen 2 (Adaptive)'
const ELSEWHERE = 'Lower Guk'

function emptySnap(): ProgressionSnap {
  return {
    expTs: [], expPct: [], expFlag: [],
    killTs: [], killZone: [], killCredit: [],
    witnessTs: [], recentKills: [], lootTs: [],
    zoneStart: [], zoneEnd: [], zoneName: [],
    offlineStart: [], offlineEnd: [], offlineCamped: [],
    levelTs: [], levelValue: [], aaGainTs: [], aaGainAmount: [],
    lastTs: 0, windowStart: 0, dropped: 0
  }
}

/**
 * A camp: `mins` minutes of steady farming ending at `T0`, one kill and one 1% experience line per
 * minute, in one still-open zone interval.
 *
 * A PREVIOUS STAY IS ALWAYS THERE, closed a minute before this one opens, because the whole point
 * of the zone membership is that the camp before this one does not count — and a snapshot with only
 * one interval could not tell a working filter from a missing one.
 *
 * The loop stops STRICTLY BEFORE `lastTs` because `rangeStats` is half-open.
 */
function camp(mins: number): ProgressionSnap {
  const s = emptySnap()
  const start = T0 - mins * MIN
  // The stay before this one: an hour in another zone, closed when this one opened.
  s.zoneStart.push(start - 60 * MIN)
  s.zoneEnd.push(start)
  s.zoneName.push(ELSEWHERE)
  s.zoneStart.push(start)
  s.zoneEnd.push(0)
  s.zoneName.push(ZONE)
  for (let ts = start + MIN; ts < T0; ts += MIN) {
    s.expTs.push(ts)
    s.expPct.push(1)
    s.expFlag.push(0)
    s.killTs.push(ts)
    s.killZone.push(1)
    s.killCredit.push(0)
  }
  s.lastTs = T0
  return s
}

function loot(msBeforeEnd: number, item: string, zone: string): LootEvent {
  return { ts: T0 - msBeforeEnd, item, zone }
}

function coin(msBeforeEnd: number, c: Omit<CoinRow, 'ts' | 'source'>): CoinRow {
  return { ts: T0 - msBeforeEnd, source: 'sold', ...c }
}

function watch(opts: {
  name: string
  baseMsBeforeEnd: number
  estimateMs: number
  samples?: number
  zone?: string
}): RespawnRow {
  return {
    id: `${opts.zone ?? ZONE}::${opts.name}`,
    key: opts.name,
    display: opts.name,
    zone: opts.zone ?? ZONE,
    baseTs: T0 - opts.baseMsBeforeEnd,
    basis: 'death',
    estimateMs: opts.estimateMs,
    source: 'observed',
    observedMs: opts.estimateMs,
    samples: opts.samples ?? 2,
    kills: 3
  }
}

function respawnSnap(rows: RespawnRow[], zone = ZONE): RespawnSnap {
  return { v: RESPAWN_SHAPE_VERSION, zone, rows, recent: [], prefs: DEFAULT_RESPAWN_PREFS }
}

const NO_RESPAWNS = respawnSnap([])

function byId(rows: FarmRow[], id: string): FarmRow {
  const row = rows.find((r) => r.id === id)
  assert.ok(row, `no row '${id}' in ${JSON.stringify(rows.map((r) => r.id))}`)
  return row
}

// ───────────────────────────────────────────────────────────────── the ladder, on its own

test('the declared ladder is copper-denominated and states itself in words', () => {
  assert.deepEqual(COIN_LADDER, { platinum: 1000, gold: 100, silver: 10, copper: 1 })
  assert.equal(COIN_LADDER_TEXT, '1p=10g=100s=1000c')
  // THE WHOLE POINT: the words ride the ROW LABEL, so a reader cannot see the number without the
  // assumption under it (shared/acquireEvents.ts's law).
  assert.ok(COIN_ROW_LABEL.includes(COIN_LADDER_TEXT), COIN_ROW_LABEL)
})

test('a coin row counts only the denominations its line actually named', () => {
  // `{ silver: 4 }` and `{ platinum: 0, silver: 4 }` are the same COIN and different FACTS; the
  // absent fields contribute nothing rather than being read as zeros somebody stated.
  assert.equal(coinCopper({ ts: 0, source: 'corpse', silver: 4 }), 40)
  assert.equal(coinCopper({ ts: 0, source: 'sold', platinum: 12, gold: 5, silver: 3 }), 12_530)
  assert.equal(coinCopper({ ts: 0, source: 'vendor' }), 0)
})

test('copper prints as denominations, biggest first, with the empty ones dropped', () => {
  assert.equal(coinText(12_530), '12p 5g 3s')
  assert.equal(coinText(25_060), '25p 6s')
  assert.equal(coinText(7), '7c')
  // A measured nothing is a fact and looks like one — never an empty string.
  assert.equal(coinText(0), '0c')
})

// ───────────────────────────────────────────────────────────────── the window

test('the window is six readings, in the order a farmer asks for them', () => {
  const view = farmOverlayView({ snap: camp(30), loot: [], coin: [], respawn: NO_RESPAWNS })
  assert.equal(view.hydrating, false)
  assert.deepEqual(view.rows.map((r) => r.id), ['here', 'kills', 'xp', 'drops', 'coin', 'respawn'])
  // ONE SPAN FOR THE WHOLE WINDOW, and it is the denominator every rate above divided by.
  assert.equal(view.span, 'over 30m active')
  assert.equal(view.zone, ZONE)
})

test('the first row names the camp and how long you have been in it', () => {
  const view = farmOverlayView({ snap: camp(30), loot: [], coin: [], respawn: NO_RESPAWNS })
  assert.equal(byId(view.rows, 'here').label, 'Here')
  assert.equal(byId(view.rows, 'here').value, `${ZONE} · 30m since zoning`)
})

test('the pace rows speak the app’s own rate vocabulary, over ACTIVE time', () => {
  const view = farmOverlayView({ snap: camp(30), loot: [], coin: [], respawn: NO_RESPAWNS })
  // 29 kills and 29 stated 1% lines over half an hour of active play.
  assert.equal(byId(view.rows, 'kills').label, 'Kills/h')
  assert.equal(byId(view.rows, 'kills').value, '58.0 kills/hr')
  assert.equal(byId(view.rows, 'xp').label, 'XP/h')
  assert.equal(byId(view.rows, 'xp').value, '0.58 lvl/hr')
})

test('the drop rate counts THIS camp’s drops and not the one before it', () => {
  const snap = camp(30)
  const view = farmOverlayView({
    snap,
    loot: [
      loot(25 * MIN, 'Bone Chips', ZONE),
      loot(15 * MIN, 'Rusty Dagger', ZONE),
      loot(5 * MIN, 'Fire Beetle Eye', ZONE),
      // INSIDE the stay's instants, in a zone the stay does not admit. It must not be counted.
      loot(10 * MIN, 'Guk Mud', ELSEWHERE),
      // …and one from the camp BEFORE this one, which is outside the range as well as the zone.
      loot(45 * MIN, 'Old Loot', ELSEWHERE)
    ],
    coin: [],
    respawn: NO_RESPAWNS
  })
  assert.equal(byId(view.rows, 'drops').label, 'Drops/h')
  // three drops in thirty minutes, never five
  assert.equal(byId(view.rows, 'drops').value, '6.00 drops/hr')
})

test('the coin row states what came in, what that is per hour, and the ladder it used', () => {
  const view = farmOverlayView({
    snap: camp(30),
    loot: [],
    coin: [
      coin(20 * MIN, { platinum: 12, zone: ZONE }),
      coin(10 * MIN, { gold: 5, silver: 3, zone: ZONE }),
      // Inside the instants, outside the camp. Not this camp's income.
      coin(15 * MIN, { platinum: 400, zone: ELSEWHERE })
    ],
    respawn: NO_RESPAWNS
  })
  const row = byId(view.rows, 'coin')
  assert.equal(row.label, COIN_ROW_LABEL)
  assert.ok(row.label.includes(COIN_LADDER_TEXT), row.label)
  // 12530 copper over half an hour ⇒ 25060 copper per hour.
  assert.equal(row.value, '12p 5g 3s · 25p 6s/h')
})

test('THE NEWEST LINE IN THE LOG IS INSIDE THE STAY, not one millisecond outside it', () => {
  // The stay ends at the LIVE EDGE (`resolveSlice`'s open-end clamp), never at `lastTs` — a range
  // that stopped half-open AT `lastTs` would exclude the very sentence the player is watching for
  // until the next line arrived, which is the whole of what a live meter must not do.
  const snap = camp(30)
  const view = farmOverlayView({
    snap,
    loot: [],
    coin: [coin(0, { platinum: 3, zone: ZONE })],
    respawn: NO_RESPAWNS
  })
  assert.equal(byId(view.rows, 'coin').value.startsWith('3p'), true, byId(view.rows, 'coin').value)
})

test('a window the log said nothing about coin in prints the em-dash, never a zero', () => {
  const view = farmOverlayView({ snap: camp(30), loot: [], coin: [], respawn: NO_RESPAWNS })
  assert.equal(byId(view.rows, 'coin').value, NONE)
})

test('the next respawn is the soonest clock in THIS camp, with the log’s own provenance', () => {
  const view = farmOverlayView({
    snap: camp(30),
    loot: [],
    coin: [],
    respawn: respawnSnap([
      watch({ name: 'a bloodguard', baseMsBeforeEnd: 10 * MIN, estimateMs: 20 * MIN, samples: 4 }),
      watch({ name: 'a shadowknight', baseMsBeforeEnd: 5 * MIN, estimateMs: 8 * MIN, samples: 2 }),
      // Another zone's clock is closer to due and is deliberately NOT the answer: this window is
      // about the camp you are standing in (the respawn overlay's own ruling).
      watch({ name: 'a froglok tad', baseMsBeforeEnd: 1 * MIN, estimateMs: 2 * MIN, zone: ELSEWHERE })
    ])
  })
  const row = byId(view.rows, 'respawn')
  assert.equal(row.label, 'Next respawn')
  assert.equal(row.value, 'a shadowknight · ~3m 00s · your kills (2 gaps)')
})

test('…and it says `no watched mobs` rather than leaving the line blank', () => {
  const view = farmOverlayView({ snap: camp(30), loot: [], coin: [], respawn: NO_RESPAWNS })
  assert.equal(byId(view.rows, 'respawn').value, FARM_NO_WATCHES)
})

test('a watched mob with no clock running is said as that, not as no watch at all', () => {
  const view = farmOverlayView({
    snap: camp(30),
    loot: [],
    coin: [],
    respawn: respawnSnap([
      // An estimate that elapsed hours ago: `respawnReading` calls it stale, and a "next respawn"
      // that is long past is not next.
      watch({ name: 'a bloodguard', baseMsBeforeEnd: 600 * MIN, estimateMs: 2 * MIN })
    ])
  })
  assert.equal(byId(view.rows, 'respawn').value, FARM_NO_CLOCK)
})

// ───────────────────────────────────────────────────────────────── the just-arrived gate

test('A STAY TOO SHORT TO RATE REFUSES EVERY PER-HOUR FIGURE, and says so once', () => {
  // MEASURED in tests/e2e/farm-overlay.e2e.mts before this gate existed: a 125 platinum sale one
  // second into a stay read `450,000,000p/h`. That is the clock since you arrived, extrapolated —
  // and this window, which you open the moment you zone in, is the surface most exposed to it.
  const view = farmOverlayView({
    snap: camp(2),
    loot: [loot(1 * MIN, 'Bone Chips', ZONE)],
    coin: [coin(1 * MIN, { platinum: 125, zone: ZONE })],
    respawn: NO_RESPAWNS
  })
  assert.equal(view.measurable, false)
  assert.equal(byId(view.rows, 'kills').value, NONE)
  assert.equal(byId(view.rows, 'xp').value, NONE)
  assert.equal(byId(view.rows, 'drops').value, NONE)
  // THE COUNT IS NEVER GATED, only the rate: "125p in this camp" is a fact about the log that two
  // minutes does not make less true.
  assert.equal(byId(view.rows, 'coin').value, '125p')
  // …and the stay itself is still stated, because that is what makes the refusal readable.
  assert.equal(byId(view.rows, 'here').value, `${ZONE} · 2m since zoning`)
  assert.equal(view.span, 'over 2m active')
})

test('…and a stay that HAS earned its hour states every one of them', () => {
  const view = farmOverlayView({ snap: camp(30), loot: [], coin: [], respawn: NO_RESPAWNS })
  assert.equal(view.measurable, true)
})

// ───────────────────────────────────────────────────────────────── hydration

test('a fold that has named no zone yet draws one quiet line, never six em-dashes', () => {
  const view = farmOverlayView({ snap: emptySnap(), loot: [], coin: [], respawn: NO_RESPAWNS })
  assert.equal(view.hydrating, true)
  assert.deepEqual(view.rows, [])
  assert.equal(view.span, '')
  assert.equal(view.zone, '')
  assert.equal(FARM_HYDRATING, 'Reading log…')
})

// ───────────────────────────────────────────────────────────────── the coin seam, on its own

test('the coin membership is the set of zones the stats themselves admitted', () => {
  const rows: CoinRow[] = [
    coin(20 * MIN, { platinum: 1, zone: ZONE }),
    coin(20 * MIN, { platinum: 9, zone: ELSEWHERE }),
    // No zone at all — the pre-first-zone-line remainder, which folds to `unknown` exactly as a
    // loot row does and is admitted only where the stats admitted that remainder too.
    coin(20 * MIN, { platinum: 5 })
  ]
  const range = { t0: T0 - 30 * MIN, t1: T0 }
  const spans = { durationMs: 30 * MIN, activeMs: 30 * MIN, offlineMs: 0 }
  const here = coinWindow({ rows, range, spans, zoneKeys: coinZoneKeys([{ zone: ZONE }]) })
  assert.equal(here.rows, 1)
  assert.equal(here.copper, 1000)
  assert.equal(here.copperPerHourActive, 2000)
  const everywhere = coinWindow({
    rows,
    range,
    spans,
    zoneKeys: coinZoneKeys([{ zone: ZONE }, { zone: ELSEWHERE }, { zone: 'unknown' }])
  })
  assert.equal(everywhere.rows, 3)
  assert.equal(everywhere.copper, 15_000)
})

test('the two denominators are said separately, and a missing one is null rather than a zero', () => {
  // BOTH readings, exactly as `windowLootRates` publishes them (JOS-261 rule 5): the same coin over
  // an hour that was half idle is two different, both honest, numbers.
  const rows = [coin(20 * MIN, { platinum: 1, zone: ZONE })]
  const range = { t0: T0 - 60 * MIN, t1: T0 }
  const zoneKeys = coinZoneKeys([{ zone: ZONE }])
  const half = coinWindow({ rows, range, spans: { durationMs: 60 * MIN, activeMs: 30 * MIN, offlineMs: 0 }, zoneKeys })
  assert.equal(half.copper, 1000)
  assert.equal(half.copperPerHourActive, 2000, 'per hour of the half hour actually played')
  assert.equal(half.copperPerHourWall, 1000, 'per hour of the whole online hour it covered')
  // A range with no time of either kind states the total and refuses both rates.
  const none = coinWindow({ rows, range, spans: { durationMs: 0, activeMs: 0, offlineMs: 0 }, zoneKeys })
  assert.equal(none.copper, 1000)
  assert.equal(none.copperPerHourActive, null)
  assert.equal(none.copperPerHourWall, null)
})
