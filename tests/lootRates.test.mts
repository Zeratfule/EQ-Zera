// PURE UNIT TESTS for "every item knows where and how often it drops for you"
// (src/shared/lootRates.ts, JOS-78).
//
// No log, no fixture, no DOM — so this file never skips. It pins the five things this feature can
// get quietly wrong, each of which would look exactly like a working feature on screen:
//
//   1. THE ZONE JOIN. Loot rows carry the zone they happened in (the loot module stamps it); the
//      DENOMINATOR comes from the progression zone spans. The join has to run on `rangeStats`' own
//      fold, so a differently-cased `You have entered` line cannot put the drops in one bucket and
//      the active time in another — and a drop before any zone line has to land in the same
//      `unknown` row that stretch of time is already filed under.
//
//   2. THE DENOMINATOR IS ACTIVE TIME, NOT WALL TIME. A zone you sat idle in for hours must not
//      have its rate diluted by the sitting. This is `rangeStats`' subtraction; the test proves
//      `itemZoneRows` divides by the ACTIVE column and not the span one.
//
//   3. UNKNOWN IS NOT ZERO. A zone with no active time (or a drop older than the capped analytics
//      window, which keeps its timestamp and loses its span) states a NULL rate. A 0.00 there is a
//      fabricated measurement, and the surfaces render null as an em-dash.
//
//   4. WINDOW FILTERING IS HALF-OPEN `[t0, t1)`, exactly like `rangeStats`, so the leveling tab's
//      scope cannot count an event its own range panel excludes.
//
//   5. THE ORDER IS THE OBSERVATION, and a stack is its size. Drops descending with a total
//      tie-break (nothing reshuffles between renders), and `2 Bone Chips` is two — the same
//      quantity the loot ledger's group count has stated since Task #47.
//
//   6. THE LEDGER'S AGGREGATE STATES TWO DENOMINATORS (JOS-261), and the pair is the feature: the
//      active reading answers "how fast is this camp paying while I work it", the wall reading
//      answers "how fast per hour of my evening", and the gap between them IS the regen downtime a
//      reporter said the active number hides. The wall half divides by ONLINE wall
//      (`durationMs - offlineMs`, `RangeStats.levelsPerHourWall`'s own denominator), so an
//      overnight logout cannot pose as an hour that paid badly.
//
// Imported RELATIVELY: node tests run through tsx with no `@shared` alias.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LootEvent } from '../src/shared/types'
import { rangeStats, type ZoneRangeRow } from '../src/shared/progressionStats'
import type { ProgressionSnap } from '../src/shared/progressionTypes'
import { itemZoneRows, windowItemRows, windowLootRates } from '../src/shared/lootRates'
// The ledger's OWN cut of the same rows — pinned against this file's window membership below, so
// the caption's count and the caption's rate can never describe two different stretches.
import { inSlice, resolveSlice } from '../src/shared/timeslice'

const MIN = 60_000
const HOUR = 60 * MIN
/** An arbitrary, readable anchor — nothing here depends on the wall clock. */
const T0 = Date.parse('Sat Aug 01 12:00:00 2026')

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

function addZone(snap: ProgressionSnap, ts: number, name: string): void {
  const n = snap.zoneStart.length
  if (n > 0) snap.zoneEnd[n - 1] = ts
  snap.zoneStart.push(ts)
  snap.zoneEnd.push(0)
  snap.zoneName.push(name)
  snap.lastTs = Math.max(snap.lastTs, ts)
}

/** A loot line, folded exactly as the loot module folds it: item, zone, and a stack size. */
function loot(ts: number, item: string, zone?: string, count?: number): LootEvent {
  return { ts, item, zone, count }
}

/**
 * A drip of activity across `[from, to]` so `idleSpans` does not classify the whole stretch as
 * silence. The stream `rangeStats` walks is exp ∪ credited kill ∪ loot, and the idle threshold is
 * 5 minutes — one sample every 2 minutes keeps a span fully active.
 */
function keepBusy(snap: ProgressionSnap, from: number, to: number): void {
  for (let ts = from; ts <= to; ts += 2 * MIN) {
    snap.lootTs.push(ts)
    snap.lastTs = Math.max(snap.lastTs, ts)
  }
}

/** Every zone row of the whole record — the range the item drill-down queries. */
function zonesOf(snap: ProgressionSnap, t0: number, t1: number): ZoneRangeRow[] {
  return rangeStats({ snap, range: { t0, t1 } }).zones
}

// ── 1 + 2. the join, and the denominator ─────────────────────────────────────────────────

/**
 * TWO ZONES, ONE ITEM, AND THE ANSWER THE FEATURE EXISTS TO GIVE.
 *
 * An hour in Nagafen's Lair produces 4 motes; an hour in The Plane of Hate produces 2. Same wall
 * clock, so a per-hour rate is the only reading that distinguishes them — and it is 4/hr against
 * 2/hr, which is the "which zone pays more motes an hour" question, answered.
 */
test('itemZoneRows: drops per hour of ACTIVE time, per zone, joined on the recorded zone', () => {
  const snap = emptySnap()
  addZone(snap, T0, "Nagafen's Lair")
  addZone(snap, T0 + HOUR, 'The Plane of Hate')
  keepBusy(snap, T0, T0 + 2 * HOUR)
  snap.lastTs = T0 + 2 * HOUR

  const events: LootEvent[] = [
    loot(T0 + 5 * MIN, 'Mote of Minor Potential', "Nagafen's Lair"),
    loot(T0 + 20 * MIN, 'Mote of Minor Potential', "Nagafen's Lair"),
    loot(T0 + 35 * MIN, 'Mote of Minor Potential', "Nagafen's Lair"),
    loot(T0 + 50 * MIN, 'Mote of Minor Potential', "Nagafen's Lair"),
    loot(T0 + 70 * MIN, 'Mote of Minor Potential', 'The Plane of Hate'),
    loot(T0 + 100 * MIN, 'Mote of Minor Potential', 'The Plane of Hate')
  ]

  const rows = itemZoneRows({ events, zones: zonesOf(snap, T0, T0 + 2 * HOUR) })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].zone, "Nagafen's Lair")
  assert.equal(rows[0].drops, 4)
  assert.equal(rows[0].events, 4)
  assert.equal(rows[0].activeMs, HOUR)
  assert.ok(rows[0].dropsPerHourActive !== null)
  assert.equal(rows[0].dropsPerHourActive?.toFixed(2), '4.00')
  assert.equal(rows[1].zone, 'The Plane of Hate')
  assert.equal(rows[1].drops, 2)
  assert.equal(rows[1].dropsPerHourActive?.toFixed(2), '2.00')
  // The first/last stamps bracket only THIS zone's own drops.
  assert.equal(rows[0].firstTs, T0 + 5 * MIN)
  assert.equal(rows[0].lastTs, T0 + 50 * MIN)
})

/**
 * THE CASE FOLD IS `rangeStats`' OWN. The log capitalizes inconsistently (world-model law 2), and
 * the zone row keeps the FIRST-SEEN spelling. A drop whose line spelled the zone differently must
 * still land on that row — with its span — rather than opening a second, span-less one.
 */
test('itemZoneRows: a differently-cased zone name joins the SAME row (one fold, not two)', () => {
  const snap = emptySnap()
  addZone(snap, T0, "Nagafen's Lair")
  keepBusy(snap, T0, T0 + HOUR)
  snap.lastTs = T0 + HOUR

  const rows = itemZoneRows({
    events: [loot(T0 + 10 * MIN, 'Jacinth', "NAGAFEN'S LAIR"), loot(T0 + 20 * MIN, 'Jacinth', "nagafen's lair")],
    zones: zonesOf(snap, T0, T0 + HOUR)
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].zone, "Nagafen's Lair", 'the zone row’s first-seen spelling wins over the loot line’s')
  assert.equal(rows[0].drops, 2)
  assert.equal(rows[0].activeMs, HOUR)
})

/**
 * A DROP BEFORE ANY ZONE LINE joins the `unknown` row — which is what `zoneSegments` already calls
 * that same stretch of time, so the count and the denominator agree by construction.
 */
test('itemZoneRows: a zone-less drop lands on the same `unknown` row the range already files', () => {
  const snap = emptySnap()
  // The record opens with half an hour before the first `You have entered` line.
  keepBusy(snap, T0, T0 + HOUR)
  addZone(snap, T0 + 30 * MIN, "Nagafen's Lair")
  snap.lastTs = T0 + HOUR

  const rows = itemZoneRows({
    events: [loot(T0 + 10 * MIN, 'Bone Chips'), loot(T0 + 40 * MIN, 'Bone Chips', "Nagafen's Lair")],
    zones: zonesOf(snap, T0, T0 + HOUR)
  })
  const unknown = rows.find((r) => r.zone === 'unknown')
  assert.ok(unknown, 'the pre-first-zone drop has a row')
  assert.equal(unknown.drops, 1)
  assert.equal(unknown.activeMs, 30 * MIN, 'and it divides by the very span rangeStats filed as unknown')
})

/**
 * IDLE TIME IS NOT IN THE DENOMINATOR. Two hours in one zone, of which one is a single unbroken
 * silence: the rate is measured over the hour you were playing, so it is 2/hr and not 1/hr.
 * A wall-time denominator would halve every farming rate the app prints.
 */
test('itemZoneRows: the denominator is ACTIVE time — an idle hour never dilutes the rate', () => {
  const snap = emptySnap()
  addZone(snap, T0, "Nagafen's Lair")
  keepBusy(snap, T0, T0 + HOUR)
  // …then an hour of nothing at all (well over the 5-minute idle threshold).
  snap.lastTs = T0 + 2 * HOUR

  const zones = zonesOf(snap, T0, T0 + 2 * HOUR)
  assert.equal(zones.length, 1)
  assert.equal(zones[0].spanMs, 2 * HOUR)
  assert.equal(zones[0].activeMs, HOUR, 'rangeStats already carved the silence out')

  const rows = itemZoneRows({
    events: [loot(T0 + 10 * MIN, 'Ruby', "Nagafen's Lair"), loot(T0 + 40 * MIN, 'Ruby', "Nagafen's Lair")],
    zones
  })
  assert.equal(rows[0].spanMs, 2 * HOUR)
  assert.equal(rows[0].activeMs, HOUR)
  assert.equal(rows[0].dropsPerHourActive?.toFixed(2), '2.00')
})

// ── 3. unknown is not zero ───────────────────────────────────────────────────────────────

/**
 * A zone the range has NO span for — the shape a drop older than the capped analytics window
 * takes — keeps its true count and states NO rate. Never 0.00: the log did not say the rate was
 * zero, it said nothing about the denominator at all.
 */
test('itemZoneRows: no active time ⇒ a NULL rate, never 0.00', () => {
  const rows = itemZoneRows({
    events: [loot(T0, 'Efreeti War Staff', 'Solusek B'), loot(T0 + MIN, 'Efreeti War Staff', 'Solusek B')],
    zones: []
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].drops, 2, 'the count is still a fact')
  assert.equal(rows[0].activeMs, 0)
  assert.equal(rows[0].dropsPerHourActive, null)
})

test('itemZoneRows: no loot at all ⇒ no rows (the question is where it drops, not where you were)', () => {
  const snap = emptySnap()
  addZone(snap, T0, "Nagafen's Lair")
  keepBusy(snap, T0, T0 + HOUR)
  assert.deepEqual(itemZoneRows({ events: [], zones: zonesOf(snap, T0, T0 + HOUR) }), [])
})

// ── 4 + 5. the window panel ──────────────────────────────────────────────────────────────

/**
 * THE SPANS `windowItemRows` DIVIDES BY (JOS-288 moved it from a bare `activeMs` to this shape).
 *
 * It takes the whole `WindowSpans` object now — the same one `windowLootRates` has always taken —
 * because it hands back BOTH rates now, and rule 5's argument for the pair applies per item exactly
 * as it does in aggregate. These two fixtures are what the old `activeMs: HOUR` / `activeMs: 0`
 * arguments meant: a fully-active hour with no logout in it, and the same hour with no active time.
 */
const FULL_HOUR = { durationMs: HOUR, activeMs: HOUR, offlineMs: 0 }
const NO_ACTIVE = { durationMs: HOUR, activeMs: 0, offlineMs: 0 }

/**
 * HALF-OPEN `[t0, t1)`, the same convention `rangeStats` uses. The tab's scope and this panel
 * must agree about which events are inside it, or the drops list and the numbers beside it are
 * describing two different stretches.
 */
test('windowItemRows: membership is half-open [t0, t1) — the low edge is in, the high edge is out', () => {
  const events = [
    loot(T0 - 1, 'Ruby', "Nagafen's Lair"),
    loot(T0, 'Ruby', "Nagafen's Lair"),
    loot(T0 + 30 * MIN, 'Ruby', "Nagafen's Lair"),
    loot(T0 + HOUR, 'Ruby', "Nagafen's Lair")
  ]
  const rows = windowItemRows({ events, t0: T0, t1: T0 + HOUR, spans: FULL_HOUR })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].drops, 2, 'the event AT t1 is excluded and the one AT t0 is included')
  assert.equal(rows[0].firstTs, T0)
  assert.equal(rows[0].lastTs, T0 + 30 * MIN)
})

/**
 * ORDER IS THE OBSERVATION — drops descending, no invented weighting. Motes float up because
 * there are more of them, and a stack counts its size (Task #47's rule, shared with the ledger).
 */
test('windowItemRows: ordered by observed drops, and a stack counts its size', () => {
  const events = [
    loot(T0 + MIN, 'Jacinth', "Nagafen's Lair"),
    loot(T0 + 2 * MIN, 'Mote of Infinitesimal Potential', "Nagafen's Lair"),
    loot(T0 + 3 * MIN, 'Mote of Infinitesimal Potential', "Nagafen's Lair"),
    loot(T0 + 4 * MIN, 'Bone Chips', "Nagafen's Lair", 5)
  ]
  const rows = windowItemRows({ events, t0: T0, t1: T0 + HOUR, spans: FULL_HOUR })
  assert.deepEqual(
    rows.map((r) => [r.item, r.drops, r.events]),
    [
      ['Bone Chips', 5, 1],
      ['Mote of Infinitesimal Potential', 2, 2],
      ['Jacinth', 1, 1]
    ]
  )
  assert.equal(rows[0].dropsPerHourActive?.toFixed(2), '5.00')
})

/**
 * A TOTAL ORDER. Two items with identical counts must not swap places between renders — the
 * tie-break is the most recent, then the name, and both are deterministic.
 */
test('windowItemRows: ties break on recency then name (nothing reshuffles between renders)', () => {
  const events = [
    loot(T0 + 3 * MIN, 'Ruby', 'z'),
    loot(T0 + 1 * MIN, 'Jacinth', 'z'),
    loot(T0 + 2 * MIN, 'Diamond', 'z')
  ]
  const order = (): string[] => windowItemRows({ events, t0: T0, t1: T0 + HOUR, spans: FULL_HOUR }).map((r) => r.item)
  assert.deepEqual(order(), ['Ruby', 'Diamond', 'Jacinth'])
  assert.deepEqual(order(), ['Ruby', 'Diamond', 'Jacinth'], 'the sort is stable across calls')
})

/**
 * ITEM IDENTITY IS THE LEDGER'S: raw, case-insensitive. A `+N` variant is its OWN item here for
 * exactly the reason the loot ledger keeps it separate — it is a different thing to loot.
 */
test('windowItemRows: identity is the ledger’s raw lowercase key — a +N variant keeps its own row', () => {
  const rows = windowItemRows({
    events: [
      loot(T0, 'Sphinx Claw', 'z'),
      loot(T0 + MIN, 'sphinx claw', 'z'),
      loot(T0 + 2 * MIN, 'Sphinx Claw +1', 'z')
    ],
    t0: T0,
    t1: T0 + HOUR,
    spans: FULL_HOUR
  })
  assert.deepEqual(
    rows.map((r) => [r.item, r.drops]),
    [
      ['Sphinx Claw', 2],
      ['Sphinx Claw +1', 1]
    ]
  )
})

/**
 * A window with no active time states no ACTIVE rate at all — the em-dash rule, one level up.
 *
 * AND SINCE JOS-288 IT STILL STATES THE ELAPSED ONE, which is the whole point of carrying both: an
 * hour you spent entirely idle paid one Ruby per elapsed hour and measured nothing per active hour,
 * and those are two different true sentences about the same sixty minutes. Only the denominator
 * that came up empty goes null; the other keeps answering.
 */
test('windowItemRows: a window with no active time states NULL rates, never 0.00', () => {
  const rows = windowItemRows({ events: [loot(T0, 'Ruby', 'z')], t0: T0, t1: T0 + HOUR, spans: NO_ACTIVE })
  assert.equal(rows[0].drops, 1)
  assert.equal(rows[0].dropsPerHourActive, null)
  assert.equal(rows[0].dropsPerHourWall, 1, 'the elapsed hour was real, and it paid one drop')
  // …and the mirror case: a window that was entirely a logout has no elapsed hour either.
  const offline = windowItemRows({
    events: [loot(T0, 'Ruby', 'z')],
    t0: T0,
    t1: T0 + HOUR,
    spans: { durationMs: HOUR, activeMs: 0, offlineMs: HOUR }
  })
  assert.equal(offline[0].dropsPerHourWall, null, 'a logout is carved out of the elapsed denominator')
})

/** An empty window is a first-class state: no rows, and the panel says which window it is. */
test('windowItemRows: nothing in range ⇒ no rows', () => {
  assert.deepEqual(
    windowItemRows({ events: [loot(T0, 'Ruby', 'z')], t0: T0 + HOUR, t1: T0 + 2 * HOUR, spans: FULL_HOUR }),
    []
  )
})

// ── 6. the ledger's aggregate, over BOTH denominators (JOS-261, rule 5) ───────────────────

/**
 * THE PAIR, AND WHY IT IS A PAIR.
 *
 * Two hours in one camp, of which one is a single unbroken silence: 6 drops. Over active time that
 * is 6/hr — a true statement about the hour you were pulling. Over the clock it is 3/hr — an
 * equally true statement about the evening. The reporter who asked for "motes per hour for this
 * grind" wants the first; the reporter whose P.S. said active-time rates read INFLATED during regen
 * downtime is describing the gap between the two. Neither number is a correction of the other, so
 * this derivation states both and the surface names each one.
 */
test('windowLootRates: both denominators, from the same window — active and wall', () => {
  const snap = emptySnap()
  addZone(snap, T0, "Nagafen's Lair")
  keepBusy(snap, T0, T0 + HOUR)
  // …then an hour of nothing at all (well past the 5-minute idle threshold).
  snap.lastTs = T0 + 2 * HOUR

  const events: LootEvent[] = [10, 20, 30, 40, 50, 55].map((m) =>
    loot(T0 + m * MIN, 'Mote of Minor Potential', "Nagafen's Lair")
  )
  const spans = rangeStats({ snap, range: { t0: T0, t1: T0 + 2 * HOUR } })
  assert.equal(spans.activeMs, HOUR, 'rangeStats already carved the silence out')
  assert.equal(spans.durationMs, 2 * HOUR)

  const r = windowLootRates({ events, t0: T0, t1: T0 + 2 * HOUR, spans })
  assert.equal(r.drops, 6)
  assert.equal(r.events, 6)
  assert.equal(r.activeMs, HOUR)
  assert.equal(r.wallMs, 2 * HOUR)
  assert.equal(r.dropsPerHourActive?.toFixed(2), '6.00')
  assert.equal(r.dropsPerHourWall?.toFixed(2), '3.00')
})

/**
 * THE WALL DENOMINATOR IS ONLINE WALL — `durationMs - offlineMs`, the one this repo already has
 * (`RangeStats.levelsPerHourWall`). An overnight logout inside an `All` slice is not an hour that
 * paid badly; counting it would be arithmetic about an empty chair, and would drive the number
 * toward zero for every player who does not leave the client running.
 */
test('windowLootRates: a logout is carved OUT of the wall denominator, never divided by', () => {
  const snap = emptySnap()
  addZone(snap, T0, 'Befallen')
  keepBusy(snap, T0, T0 + HOUR)
  // Camped for eight hours, then back for a second active hour.
  snap.offlineStart.push(T0 + HOUR)
  snap.offlineEnd.push(T0 + 9 * HOUR)
  snap.offlineCamped.push(1)
  keepBusy(snap, T0 + 9 * HOUR, T0 + 10 * HOUR)
  snap.lastTs = T0 + 10 * HOUR

  const events = [loot(T0 + 30 * MIN, 'Ruby', 'Befallen'), loot(T0 + 9.5 * HOUR, 'Ruby', 'Befallen')]
  const spans = rangeStats({ snap, range: { t0: T0, t1: T0 + 10 * HOUR } })
  assert.equal(spans.offlineMs, 8 * HOUR)

  const r = windowLootRates({ events, t0: T0, t1: T0 + 10 * HOUR, spans })
  assert.equal(r.wallMs, 2 * HOUR, 'ten hours of clock minus the eight the log says you were gone')
  assert.equal(r.dropsPerHourWall?.toFixed(2), '1.00')
  // …and the active reading is unmoved by the logout, because idle and offline were already out.
  assert.equal(r.dropsPerHourActive?.toFixed(2), '1.00')
})

/**
 * A STACK IS ITS SIZE in the numerator of both rates (rule 4) — the same quantity the ledger's
 * group counts state, so the caption cannot say 220 motes and rate 110 of them.
 */
test('windowLootRates: the numerator counts stack sizes, and lines ride along separately', () => {
  const spans = { durationMs: HOUR, activeMs: HOUR, offlineMs: 0 }
  const r = windowLootRates({
    events: [loot(T0, 'Bone Chips', 'z', 2), loot(T0 + MIN, 'Bone Chips', 'z', 3), loot(T0 + 2 * MIN, 'Ruby', 'z')],
    t0: T0,
    t1: T0 + HOUR,
    spans
  })
  assert.equal(r.drops, 6)
  assert.equal(r.events, 3)
  assert.equal(r.dropsPerHourActive?.toFixed(2), '6.00')
})

/** Membership is the window's, both halves of it: half-open `[t0, t1)` and the zone filter. */
test('windowLootRates: membership is half-open and zone-filtered, exactly like windowItemRows', () => {
  const spans = { durationMs: HOUR, activeMs: HOUR, offlineMs: 0 }
  const events = [
    loot(T0 - 1, 'Ruby', 'Befallen'),
    loot(T0, 'Ruby', 'Befallen'),
    loot(T0 + 30 * MIN, 'Ruby', "Nagafen's Lair"),
    loot(T0 + HOUR, 'Ruby', 'Befallen')
  ]
  assert.equal(windowLootRates({ events, t0: T0, t1: T0 + HOUR, spans }).drops, 2, 'the low edge is in, the high edge is out')
  const inZone = windowLootRates({ events, t0: T0, t1: T0 + HOUR, spans, zoneKey: 'befallen' })
  assert.equal(inZone.drops, 1, 'and a zone-restricted slice counts only that zone’s rows')
  // The counts agree with the per-item derivation over the same window — one membership test.
  assert.equal(
    windowItemRows({ events, t0: T0, t1: T0 + HOUR, spans: FULL_HOUR }).reduce((n, r) => n + r.drops, 0),
    2
  )
})

/**
 * THE LEDGER'S OWN CUT AND THIS RATE'S CUT ARE ONE TEST. `LootView` filters its rows with
 * `timeslice.inSlice` and hands the WHOLE history to this function; if the two ever disagreed the
 * caption would state a count over one stretch and a rate over another, and both would look right.
 */
test('windowLootRates: `events` equals what timeslice.inSlice admits, row for row', () => {
  const snap = emptySnap()
  addZone(snap, T0, 'Befallen')
  addZone(snap, T0 + HOUR, "Nagafen's Lair")
  keepBusy(snap, T0, T0 + 2 * HOUR)
  snap.lastTs = T0 + 2 * HOUR

  const history = [
    loot(T0 + 10 * MIN, 'Ruby', 'Befallen'),
    loot(T0 + 70 * MIN, 'Ruby', "Nagafen's Lair"),
    loot(T0 + 90 * MIN, 'Ruby', "Nagafen's Lair - Solo 4 (Refined)")
  ]
  const bounds = { lo: T0, hi: T0 + 2 * HOUR }
  for (const id of ['all', 'zone'] as const) {
    const slice = resolveSlice({ snap, bounds, id })
    const byLedger = history.filter((e) => inSlice(slice, e.ts, e.zone))
    const spans = rangeStats({ snap, range: slice.range, zoneKey: slice.zoneKey })
    const r = windowLootRates({
      events: history,
      t0: slice.range.t0,
      t1: slice.range.t1,
      spans,
      zoneKey: slice.zoneKey
    })
    assert.equal(r.events, byLedger.length, `the ${id} slice admits the same rows to both`)
  }
})
