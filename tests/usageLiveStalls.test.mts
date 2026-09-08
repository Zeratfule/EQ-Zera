/**
 * usageLiveStalls.test.mts — the READ half of the live session's numbers (JOS-367).
 *
 * The split `startupDiscriminators.test.mts` / `usageStartup.test.mts` made, for its reason: the
 * probe, the wire shape and the validators are one subject (`liveStalls.test.mts`), what the
 * counters become and how the two surfaces render them is another, and either file alone would be
 * past the repo's 400-code-line ceiling.
 *
 * WHAT IT DEFENDS. The Analytics tab and the digest render ONE computation — a lie can only enter
 * between the counters and the labels, so that is where these assertions sit:
 *
 *   * the fold writes SUMS where a sum means something and HISTOGRAMS where it does not, and
 *     never a zero row for a group a client did not send;
 *   * `liveVerdicts` keeps the machine-or-us rate honest, because a verdict of ZERO writes no
 *     `liveCoincident` row and would otherwise be indistinguishable from no verdict at all;
 *   * a DASH is never a clean bill — an unmeasured rate renders as one, a measured zero does not.
 *
 * Pure: no Electron, no AWS, no clock. A fleet is authored by hand and the arithmetic asserted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTelemetryEvent } from '../src/shared/telemetryValidate'
import { rollupBatch, USAGE_METRICS } from '../src/shared/telemetryRollup'
import { buildAnalytics } from '../src/main/triage/analytics'
import { stallMsLabel } from '../src/main/triage/liveStalls'
import type { UsageRow } from '../src/main/triage/usageRows'
import { renderAnalyticsDigest } from '../scripts/analyticsDigest.mjs'
import type { TelemetryEvent } from '../src/shared/telemetry'

/** A heartbeat with every rider on it, at values a real session could produce. */
function fullHeartbeat(): Record<string, unknown> {
  return {
    t: 'sessionHeartbeat',
    uptimeMs: 600_000,
    live: { samples: 2400, p95Bucket: 2, maxBucket: 6, over100: 4, over500: 1, coincident: 1 },
    tail: {
      reads: 812,
      reopens: 0,
      p95Bucket: 1,
      maxBucket: 4,
      over100: 2,
      over500: 0,
      deltaBytesBucket: 3,
      logSizeBucket: 3
    },
    state: {
      overlaysOpen: 2,
      overlaysLocked: 1,
      presenceOn: true,
      ringOn: false,
      freeMemBucket: 3,
      workingSetBucket: 2
    }
  }
}

// ---- the rollup ----------------------------------------------------------------------------

/** One batch of the given events, folded to `metric dim` -> n. */
function counters(events: TelemetryEvent[]): Map<string, number> {
  const batch = {
    v: 1 as const,
    env: {
      analyticsId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      appVersion: '0.28.0',
      channel: 'prod' as const,
      platform: 'win32' as const,
      tzOffsetBucket: -7
    },
    events: events.map((ev, i) => ({ ts: 1_000 + i, ev }))
  }
  const roll = rollupBatch(batch, { firstOfDay: false, newInstall: false, upgraded: false })
  return new Map(roll.counters.map((c) => [`${c.metric} ${c.dim}`, c.n]))
}

/** Through the validator, because the rollup only ever sees events that have been through it —
 *  which also means every rollup assertion below is a second proof that the shape is legal. */
function validated(raw: Record<string, unknown>): TelemetryEvent {
  const result = validateTelemetryEvent(raw)
  if (!result.ok) throw new Error(result.message)
  return result.value
}

const validHeartbeat = (): TelemetryEvent => validated(fullHeartbeat())

test('the riders become counters: sums where a sum means something, histograms where it does not', () => {
  const c = counters([validHeartbeat()])
  assert.equal(c.get(`${USAGE_METRICS.liveSamples} -`), 2400)
  assert.equal(c.get(`${USAGE_METRICS.liveStallP95} 2`), 1)
  assert.equal(c.get(`${USAGE_METRICS.liveStallMax} 6`), 1)
  assert.equal(c.get(`${USAGE_METRICS.liveOver100} -`), 4)
  assert.equal(c.get(`${USAGE_METRICS.liveOver500} -`), 1)
  assert.equal(c.get(`${USAGE_METRICS.tailReads} -`), 812)
  assert.equal(c.get(`${USAGE_METRICS.tailReadP95} 1`), 1)
  assert.equal(c.get(`${USAGE_METRICS.tailDeltaBytes} 3`), 1)
  assert.equal(c.get(`${USAGE_METRICS.tailLogSize} 3`), 1)
  // A window count is a dim of three values: past two, how many overlays a person keeps open
  // describes their desktop rather than a population.
  assert.equal(c.get(`${USAGE_METRICS.stateOverlaysOpen} 2+`), 1)
  assert.equal(c.get(`${USAGE_METRICS.stateOverlaysLocked} 1`), 1)
  assert.equal(c.get(`${USAGE_METRICS.statePresence} on`), 1)
  assert.equal(c.get(`${USAGE_METRICS.stateRing} off`), 1)
  assert.equal(c.get(`${USAGE_METRICS.stateFreeMem} 3`), 1)
  assert.equal(c.get(`${USAGE_METRICS.stateWorkingSet} 2`), 1)
  // UNVERSIONED, unlike every startup metric: these describe a machine and a session, and a
  // version in the dim would split each distribution across four releases to answer nothing.
  for (const key of c.keys()) assert.equal(key.includes('0.28.0'), key.startsWith('version '))
})

test('A VERDICT OF ZERO IS STILL A VERDICT — liveVerdicts is why the rate is honest', () => {
  // `add()` refuses a non-positive value, so a report that compared two clocks and found no
  // coincidence writes no `liveCoincident` row at all. Without a separate denominator that report
  // would be indistinguishable from one that had no second clock — and those are opposite facts:
  // the first says the stalls are OURS, the second says nothing.
  const withWorker = { ...fullHeartbeat(), live: { samples: 10, p95Bucket: 0, maxBucket: 5, over100: 1, over500: 0, coincident: 0 } }
  const zero = counters([validated(withWorker)])
  assert.equal(zero.get(`${USAGE_METRICS.liveVerdicts} -`), 1)
  assert.equal(zero.has(`${USAGE_METRICS.liveCoincident} -`), false)

  const noWorker = { ...fullHeartbeat(), live: { samples: 10, p95Bucket: 0, maxBucket: 5, over100: 1, over500: 0 } }
  const absent = counters([validated(noWorker)])
  assert.equal(absent.has(`${USAGE_METRICS.liveVerdicts} -`), false)
  // …and the machine-stalled reading still counts, over its own denominator.
  const machine = counters([validated({ ...withWorker, live: { ...withWorker.live, coincident: 3 } })])
  assert.equal(machine.get(`${USAGE_METRICS.liveCoincident} -`), 3)
  assert.equal(machine.get(`${USAGE_METRICS.liveVerdicts} -`), 1)
})

test('AN ABSENT GROUP CONTRIBUTES NOTHING — bucket 0 is a real reading, never a default', () => {
  // The client that predates these fields must fold exactly as it always did. It matters more
  // here than for the machine class: bucket 0 of every ladder in this section is a genuine
  // reading (under 10 ms late, under half a gibibyte free), so a `?? 0` would invent a population
  // of impossibly healthy machines out of clients that measured nothing.
  const bare = counters([validated({ t: 'sessionHeartbeat', uptimeMs: 600_000 })])
  for (const key of bare.keys()) {
    assert.equal(key.startsWith('live'), false, key)
    assert.equal(key.startsWith('tail'), false, key)
    assert.equal(key.startsWith('state'), false, key)
  }
  assert.equal(bare.get('heartbeats -'), 1)
})

test('sessionEnd folds the same rows as the heartbeat — one interval, whichever event carried it', () => {
  const end = { ...fullHeartbeat(), t: 'sessionEnd', durationMs: 60_000, viewsVisited: 2 }
  delete end.uptimeMs
  const c = counters([validated(end)])
  assert.equal(c.get(`${USAGE_METRICS.liveSamples} -`), 2400)
  assert.equal(c.get(`${USAGE_METRICS.tailReads} -`), 812)
  assert.equal(c.get(`${USAGE_METRICS.stateFreeMem} 3`), 1)
})

// ---- the two readouts ----------------------------------------------------------------------

/** One day of usage rows, in the user cohort — the readout both surfaces default to. */
const row = (metric: string, dim: string, n: number): UsageRow => ({
  day: '2026-08-15',
  cohort: 'user',
  metric,
  dim,
  n
})

/** A fleet in which most late moments were the MACHINE's — the reading the whole ticket is for. */
function machineStalledFleet(): UsageRow[] {
  return [
    row(USAGE_METRICS.liveStallP95, '1', 40),
    row(USAGE_METRICS.liveStallP95, '4', 10),
    row(USAGE_METRICS.liveStallMax, '6', 50),
    row(USAGE_METRICS.liveSamples, '-', 120_000),
    row(USAGE_METRICS.liveOver100, '-', 200),
    row(USAGE_METRICS.liveOver500, '-', 60),
    row(USAGE_METRICS.liveVerdicts, '-', 50),
    row(USAGE_METRICS.liveCoincident, '-', 180),
    row(USAGE_METRICS.tailReadP95, '1', 50),
    row(USAGE_METRICS.tailReadMax, '3', 50),
    row(USAGE_METRICS.tailReads, '-', 9_000),
    row(USAGE_METRICS.tailReopens, '-', 2),
    row(USAGE_METRICS.tailOver100, '-', 12),
    row(USAGE_METRICS.tailOver500, '-', 1),
    row(USAGE_METRICS.tailDeltaBytes, '2', 50),
    row(USAGE_METRICS.tailLogSize, '3', 50),
    row(USAGE_METRICS.stateOverlaysOpen, '2+', 30),
    row(USAGE_METRICS.stateOverlaysLocked, '1', 28),
    row(USAGE_METRICS.statePresence, 'on', 50),
    row(USAGE_METRICS.stateRing, 'off', 50),
    row(USAGE_METRICS.stateFreeMem, '0', 12),
    row(USAGE_METRICS.stateFreeMem, '4', 38),
    row(USAGE_METRICS.stateWorkingSet, '2', 50)
  ]
}

const analytics = (usage: UsageRow[]) =>
  buildAnalytics({
    usage,
    funnels: [],
    installs: [],
    windowDays: 30,
    nowMs: Date.UTC(2026, 7, 15, 12, 0, 0)
  })

test('THE LIVE SECTION PUTS THE TWO RATES SIDE BY SIDE — that comparison IS the verdict', () => {
  const l = analytics(machineStalledFleet()).live
  assert.equal(l.reports, 50)
  assert.equal(l.samples, 120_000)
  // Percentiles read out as their bucket's own RANGE. The storage threw the precision away on
  // purpose, so nothing here may invent a number inside a bucket.
  assert.equal(l.p50StallLabel, stallMsLabel(1))
  assert.equal(l.p95StallLabel, stallMsLabel(4))
  assert.equal(l.maxStallLabel, stallMsLabel(6))
  // 200 late ticks over 50 reports, of which 180 were seen by BOTH clocks over 50 reports that
  // could answer: the machine, not us, and the gap is the part we are answerable for.
  assert.equal(l.latePerReport, 4)
  assert.equal(l.machinePerReport, 3.6)
  assert.equal(l.tailReports, 50)
  assert.equal(l.tailReopens, 2)
  // The ladders read in LADDER ORDER, not biggest-first: these are distributions.
  assert.deepEqual(
    l.state.filter((r) => r.id.startsWith('free RAM')).map((r) => r.n),
    [12, 38]
  )
  assert.ok(l.state.some((r) => r.id.startsWith('overlays LOCKED 1')))
})

test('A DASH IS NEVER A CLEAN BILL — no verdict reads differently from a verdict of zero', () => {
  // No report carried a second clock: there is no rate to state, and stating 0 would be an
  // accusation the data cannot support.
  const noWorker = machineStalledFleet().filter(
    (r) => r.metric !== USAGE_METRICS.liveVerdicts && r.metric !== USAGE_METRICS.liveCoincident
  )
  assert.equal(analytics(noWorker).live.machinePerReport, null)
  // Reports DID compare two clocks and never found a coincidence: the stalls are ours, and that
  // is a measured 0 rather than a missing number.
  const ourFault = [
    ...noWorker,
    row(USAGE_METRICS.liveVerdicts, '-', 50)
  ]
  assert.equal(analytics(ourFault).live.machinePerReport, 0)
  // An empty fleet is zeros and nulls, never a throw — the tab renders on day one.
  const empty = analytics([]).live
  assert.equal(empty.reports, 0)
  assert.equal(empty.p95StallLabel, null)
  assert.equal(empty.latePerReport, null)
  assert.deepEqual(empty.state, [])
})

test('the digest renders the Live section between Startup and Versions', () => {
  const text = renderAnalyticsDigest(analytics(machineStalledFleet()))
  assert.match(text, /STARTUP REPLAY[\s\S]*LIVE SESSIONS[\s\S]*VERSIONS/)
  assert.match(text, /VERDICT: 180 windows both our clocks saw, over 50 reports/)
  assert.match(text, /3\.60 machine\/report/)
  assert.match(text, /overlays LOCKED 1/)
  // …and an empty fleet says so in words rather than printing a table of zeros.
  assert.match(renderAnalyticsDigest(analytics([])), /no session has reported a stall reading yet/)
})

