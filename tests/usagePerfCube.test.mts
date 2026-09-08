/**
 * usagePerfCube.test.mts — the perf cube, end to end without a cloud (JOS-372).
 *
 * WHAT IT DEFENDS, in the order a wrong answer would do the most damage:
 *
 *   * THE DIM RESOLUTION. A `setupSnapshot` arrives once per LAUNCH; the stall readings it slices
 *     arrive on every session report for hours. So the common batch is a heartbeat with no
 *     snapshot in it, and if that batch does not fold against the install row's stored dims the
 *     whole cube fills with `unknown` — which looks exactly like a healthy fleet nobody could
 *     class. That is rehearsed here against the REAL local stack (scripts/devTelemetryStack.mts),
 *     because the resolution is half in the fold and half in the install UPSERT.
 *   * THE CLASS MAPPING. Twenty-seven combinations collapse to seven classes, the tier is the
 *     WEAKER of cores and memory, and anything unclassable is `unknown` rather than a guess.
 *   * WHAT IS AND IS NOT A ROW. One per session report that carried a live rider — heartbeat or
 *     sessionEnd, never a report without one — which is deliberately the same population as
 *     `liveStallP95`, so the cube's rates and the Live section's totals share a denominator.
 *   * THE READOUT'S HONESTY. Three cuts of ONE population, each with its own denominator, ordered
 *     by that denominator; a null rate where nothing was measured, never a zero.
 *
 * Pure apart from the local stack, which is an in-process Map: no Electron, no AWS, no clock.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTelemetryEvent } from '../src/shared/telemetryValidate'
import { rollupBatch } from '../src/shared/telemetryRollup'
import { machineClassOf, type PerfCubeRow } from '../src/shared/telemetryPerfCube'
import { emptyTelemetryState, telemetryRoute, telemetryTables } from '../scripts/devTelemetryStack.mjs'
import { buildAnalytics } from '../src/main/triage/analytics'
import { toPerfRows, type PerfRow } from '../src/main/triage/usageRows'
import { renderAnalyticsDigest } from '../scripts/analyticsDigest.mjs'
import type { TelemetryBatch, TelemetryEvent } from '../src/shared/telemetry'

// ---- fixtures ------------------------------------------------------------------------------

/** Through the validator, because the rollup only ever sees events that have been through it. */
function validated(raw: Record<string, unknown>): TelemetryEvent {
  const result = validateTelemetryEvent(raw)
  if (!result.ok) throw new Error(result.message)
  return result.value
}

/** A snapshot from a mid-tier box with a discrete GPU, with the game set to fullscreen. */
function snapshot(over: Record<string, unknown> = {}): TelemetryEvent {
  return validated({
    t: 'setupSnapshot',
    charCountBucket: 2,
    logSizeBucket: 3,
    alertCountBucket: 1,
    overlaysEnabled: ['fight'],
    cursorRing: true,
    autoHide: false,
    voiceEngine: 'off',
    soundPackCount: 1,
    updateChannel: 'main',
    cpuCountBucket: 3,
    totalMemBucket: 3,
    gpuVendor: 'nvidia',
    eqWindowMode: 'fullscreen',
    ...over
  })
}

/** A heartbeat carrying a stall reading. `over.live` etc. replace whole riders. */
function heartbeat(over: Record<string, unknown> = {}): TelemetryEvent {
  return validated({
    t: 'sessionHeartbeat',
    uptimeMs: 600_000,
    live: { samples: 2400, p95Bucket: 2, maxBucket: 6, over100: 4, over500: 1 },
    tail: {
      reads: 800,
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
    },
    ...over
  })
}

function batchOf(events: TelemetryEvent[], analyticsId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'): TelemetryBatch {
  return {
    v: 1,
    env: { analyticsId, appVersion: '0.28.0', channel: 'prod', platform: 'win32', tzOffsetBucket: -7 },
    events: events.map((ev, i) => ({ ts: 1_000 + i, ev }))
  }
}

const CTX = { firstOfDay: false, newInstall: false, upgraded: false }

const cube = (events: TelemetryEvent[], ctx = CTX): PerfCubeRow[] => rollupBatch(batchOf(events), ctx).perf

// ---- the class mapping ---------------------------------------------------------------------

test('the machine class collapses 27 combinations to seven, and the WEAKER axis sets the tier', () => {
  // Cores are high (bucket 6 = 16-23) and memory is low (bucket 1 = 4-7 GB): a machine is as fast
  // as the thing it runs out of first, so this is a LOW box and reading it as high would hide the
  // paging hypothesis this cube exists to test.
  assert.equal(machineClassOf({ cpuCountBucket: 6, totalMemBucket: 1, gpuVendor: 'nvidia' }), 'low-dgpu')
  assert.equal(machineClassOf({ cpuCountBucket: 1, totalMemBucket: 7, gpuVendor: 'intel' }), 'low-igpu')
  // 6-11 threads and 12-23 GB is the middle of both ladders.
  assert.equal(machineClassOf({ cpuCountBucket: 3, totalMemBucket: 4, gpuVendor: 'amd' }), 'mid-dgpu')
  assert.equal(machineClassOf({ cpuCountBucket: 4, totalMemBucket: 3, gpuVendor: 'intel' }), 'mid-igpu')
  assert.equal(machineClassOf({ cpuCountBucket: 5, totalMemBucket: 5, gpuVendor: 'nvidia' }), 'high-dgpu')
  assert.equal(machineClassOf({ cpuCountBucket: 7, totalMemBucket: 7, gpuVendor: 'intel' }), 'high-igpu')
})

test('UNKNOWN IS A CLASS, NOT A GUESS — a missing or unclassable axis takes the whole box', () => {
  // A client that predates JOS-364 sends none of the three. Folding it into `low` would invent a
  // population of small machines out of clients that measured nothing.
  assert.equal(machineClassOf({}), 'unknown')
  assert.equal(machineClassOf({ cpuCountBucket: 5, totalMemBucket: 5 }), 'unknown')
  assert.equal(machineClassOf({ cpuCountBucket: 5, gpuVendor: 'nvidia' }), 'unknown')
  // `other` and `unknown` are vendors this app declines to place on the integrated/discrete axis.
  assert.equal(machineClassOf({ cpuCountBucket: 5, totalMemBucket: 5, gpuVendor: 'other' }), 'unknown')
  assert.equal(machineClassOf({ cpuCountBucket: 5, totalMemBucket: 5, gpuVendor: 'unknown' }), 'unknown')
})

// ---- the fold ------------------------------------------------------------------------------

test('a batch with a snapshot and a heartbeat lands ONE cube row with the right five dims', () => {
  assert.deepEqual(cube([snapshot(), heartbeat()]), [
    {
      windowMode: 'fullscreen',
      machineClass: 'mid-dgpu',
      locked: 'on',
      stallBucket: '6',
      tailBucket: '4',
      n: 1
    }
  ])
})

test('identical reports FOLD, different dims do not — the row IS the key', () => {
  const rows = cube([
    snapshot(),
    heartbeat(),
    heartbeat(),
    // A different worst tick is a different row; so is an unlocked interval.
    heartbeat({ live: { samples: 10, p95Bucket: 0, maxBucket: 2, over100: 0, over500: 0 } }),
    heartbeat({
      state: { overlaysOpen: 0, overlaysLocked: 0, presenceOn: true, ringOn: false, freeMemBucket: 3, workingSetBucket: 2 }
    })
  ])
  assert.equal(rows.length, 3)
  assert.equal(rows.find((r) => r.stallBucket === '6' && r.locked === 'on')?.n, 2)
  assert.equal(rows.find((r) => r.stallBucket === '2')?.n, 1)
  assert.equal(rows.find((r) => r.locked === 'off')?.n, 1)
})

test('THE SAME POPULATION AS liveStallP95: a live rider is the ticket, on either session report', () => {
  // A sessionEnd carries the identical rider for the interval since the last report. Dropping it
  // would bias the cube toward sessions that were KILLED, which are not a random sample.
  const end = { ...(heartbeat() as unknown as Record<string, unknown>), t: 'sessionEnd', durationMs: 60_000, viewsVisited: 2 }
  delete end.uptimeMs
  assert.equal(cube([snapshot(), validated(end)]).length, 1)
  // …and a report with no live rider writes no row at all, exactly as it writes no `liveStallP95`.
  assert.deepEqual(cube([snapshot(), validated({ t: 'sessionHeartbeat', uptimeMs: 1 })]), [])
  assert.deepEqual(cube([validated({ t: 'sessionStart', coldStartMsBucket: 1 })]), [])
})

test('A DASH IS "COULD NOT SAY", NOT A ZERO — no tail rider, no state rider', () => {
  const bare = cube([
    snapshot(),
    validated({
      t: 'sessionHeartbeat',
      uptimeMs: 600_000,
      live: { samples: 10, p95Bucket: 1, maxBucket: 3, over100: 0, over500: 0 }
    })
  ])
  // A session with no character attached tailed nothing: that is a real state, and it is a
  // different fact from "its reads were fast" (which would be bucket 0).
  assert.equal(bare[0]?.tailBucket, '-')
  assert.equal(bare[0]?.locked, '-')
})

test('THIS BATCH SNAPSHOT WINS, AND THE INSTALL ROW IS THE FALLBACK', () => {
  const stored = { ...CTX, perf: { machineClass: 'low-igpu' as const, windowMode: 'windowed' as const } }
  // No snapshot in the batch: the dims come from the row, which is the common case (a snapshot is
  // sent once per launch, a heartbeat every ten minutes).
  assert.deepEqual(cube([heartbeat()], stored)[0], {
    windowMode: 'windowed',
    machineClass: 'low-igpu',
    locked: 'on',
    stallBucket: '6',
    tailBucket: '4',
    n: 1
  })
  // A snapshot in the SAME batch overrides it: it is the newer fact.
  const fresh = cube([snapshot({ eqWindowMode: 'windowed', gpuVendor: 'intel' }), heartbeat()], stored)[0]
  assert.equal(fresh?.machineClass, 'mid-igpu')
  assert.equal(fresh?.windowMode, 'windowed')
  // Neither: `unknown`, which is a class the readout shows rather than a row it hides.
  assert.equal(cube([heartbeat()])[0]?.machineClass, 'unknown')
  assert.equal(cube([heartbeat()])[0]?.windowMode, 'unknown')
})

// ---- the local rehearsal (scripts/devTelemetryStack.mts) ------------------------------------

test('THE LOCAL STACK PROVES THE RESOLUTION: a snapshot launch, then heartbeat-only batches', () => {
  const state = emptyTelemetryState()
  const id = '9f2504e0-4f89-41d3-9a0c-0305e82c3399'
  const now = Date.UTC(2026, 7, 15, 12, 0, 0)
  // Launch: the snapshot rides the first batch and is stored on the install row.
  assert.equal(telemetryRoute(state, Buffer.from(JSON.stringify(batchOf([snapshot(), heartbeat()], id))), now).status, 202)
  // …and every later batch is a heartbeat with no snapshot in it, which is the case that breaks
  // if the install row is not read back.
  assert.equal(telemetryRoute(state, Buffer.from(JSON.stringify(batchOf([heartbeat()], id))), now).status, 202)
  const t = telemetryTables(state).json as {
    perfDaily: { window_mode: string; machine_class: string; locked: string; stall_bucket: string; n: number }[]
    analyticsInstall: { machine_class: string | null; window_mode: string | null }[]
  }
  assert.equal(t.perfDaily.length, 1)
  assert.deepEqual(t.perfDaily[0], {
    day: '2026-08-15',
    cohort: 'user',
    window_mode: 'fullscreen',
    machine_class: 'mid-dgpu',
    locked: 'on',
    stall_bucket: '6',
    tail_bucket: '4',
    n: 2
  } as unknown)
  // The two enums are the whole per-install footprint this feature adds.
  assert.equal(t.analyticsInstall[0]?.machine_class, 'mid-dgpu')
  assert.equal(t.analyticsInstall[0]?.window_mode, 'fullscreen')
})

// ---- the readout ---------------------------------------------------------------------------

const row = (over: Partial<PerfRow>): PerfRow => ({
  day: '2026-08-15',
  cohort: 'user',
  windowMode: 'windowed',
  machineClass: 'high-dgpu',
  locked: 'off',
  stallBucket: 0,
  tailBucket: '2',
  n: 1,
  ...over
})

/**
 * A fleet in which the LOCKED overlays are where the bad stalls live, on fullscreen
 * installs, on small boxes — the reading this whole ticket exists to be able to see.
 */
function lockedStallsFleet(): PerfRow[] {
  return [
    // 80 reports with a locked overlay, 60 of them past the heavy rung (bucket 6 = 500 ms - 1 s).
    row({ locked: 'on', windowMode: 'fullscreen', machineClass: 'low-igpu', stallBucket: 6, n: 60 }),
    row({ locked: 'on', windowMode: 'fullscreen', machineClass: 'low-igpu', stallBucket: 2, n: 20 }),
    // 120 with nothing locked, 12 of them heavy.
    row({ locked: 'off', windowMode: 'windowed', machineClass: 'high-dgpu', stallBucket: 7, n: 12 }),
    row({ locked: 'off', windowMode: 'windowed', machineClass: 'high-dgpu', stallBucket: 1, n: 108 })
  ]
}

const analytics = (perf: PerfRow[]) =>
  buildAnalytics({
    usage: [],
    funnels: [],
    installs: [],
    perf,
    windowDays: 30,
    nowMs: Date.UTC(2026, 7, 15, 12, 0, 0)
  })

test('THREE CUTS OF ONE POPULATION, each with its own denominator', () => {
  const p = analytics(lockedStallsFleet()).perf
  assert.equal(p.reports, 200)
  assert.equal(p.stalls, 72)
  assert.equal(p.rate, 0.36)
  // Every cut sums to the same population — which is exactly why nothing may add two cuts.
  for (const cut of [p.byWindowMode, p.byMachineClass, p.byLocked]) {
    assert.equal(cut.reduce((sum, s) => sum + s.reports, 0), 200)
    assert.equal(cut.reduce((sum, s) => sum + s.stalls, 0), 72)
  }
  const locked = p.byLocked.find((s) => s.id === 'overlay LOCKED')
  assert.deepEqual(locked, { id: 'overlay LOCKED', reports: 80, stalls: 60, rate: 0.75 })
  assert.equal(p.byLocked.find((s) => s.id === 'none locked')?.rate, 0.1)
  // The threshold travels in the shape, so no surface can print a millisecond figure of its own.
  assert.equal(p.stallLabel, '≥ 500 ms')
})

test('SORTED BY REPORTS, NOT BY RATE — a four-report slice at 100% is not a finding', () => {
  const p = analytics([
    ...lockedStallsFleet(),
    row({ windowMode: 'unknown', machineClass: 'unknown', stallBucket: 8, n: 4 })
  ]).perf
  assert.deepEqual(
    p.byWindowMode.map((s) => [s.id, s.reports]),
    [
      ['windowed', 120],
      ['fullscreen', 80],
      ['unknown', 4]
    ]
  )
  // …and the 100% slice is still THERE, with its four reports beside it.
  assert.equal(p.byWindowMode.at(-1)?.rate, 1)
})

test('an empty cube is zeros, empty lists and a NULL rate — never a clean bill', () => {
  const p = analytics([]).perf
  assert.equal(p.reports, 0)
  assert.equal(p.rate, null)
  assert.deepEqual(p.byLocked, [])
  // A stack whose ingest predates the cube passes no rows at all; the readout still builds.
  assert.equal(
    buildAnalytics({ usage: [], funnels: [], installs: [], windowDays: 30, nowMs: 0 }).perf.reports,
    0
  )
})

test('the digest renders STALLS BY between the Live section and Versions', () => {
  const text = renderAnalyticsDigest(analytics(lockedStallsFleet()))
  assert.match(text, /LIVE SESSIONS[\s\S]*STALLS BY[\s\S]*VERSIONS/)
  assert.match(text, /fleet: 72 of 200 reports · 36\.0%/)
  assert.match(text, /overlay LOCKED\s+60 \/ 80\s+75\.0%/)
  assert.match(text, /fullscreen\s+60 \/ 80/)
  assert.match(text, /low-igpu\s+60 \/ 80/)
  // An empty cube says so in words rather than printing a table of zeros.
  assert.match(renderAnalyticsDigest(analytics([])), /perf cube has no rows in this window/)
})

test('the DB row mapper is total: junk columns become `unknown` and a stall that cannot count', () => {
  const rows = toPerfRows([
    { day: '2026-08-15', cohort: null, window_mode: null, machine_class: 42, locked: null, stall_bucket: 'x', tail_bucket: null, n: 5 }
  ])
  assert.deepEqual(rows, [
    {
      day: '2026-08-15',
      cohort: 'user',
      windowMode: 'unknown',
      machineClass: 'unknown',
      locked: '-',
      // -1: the row is still a report (it counts in the denominator) and can never count as a
      // stall, which is the fail-safe direction for a rate.
      stallBucket: -1,
      tailBucket: '-',
      n: 5
    }
  ])
  assert.equal(analytics(rows).perf.stalls, 0)
  assert.equal(analytics(rows).perf.reports, 5)
})
