/**
 * liveStalls.test.mts — the LIVE session's own numbers (JOS-367), end to end.
 *
 * WHAT THE FEATURE CLAIMS, because every assertion below is a term of it: field reports describe
 * ~1 s EverQuest freezes while this app runs, and we cannot see the game's frame time. So the app
 * runs the SAME lateness probe on two threads — main, and a worker that does nothing else — and
 * counts the windows in which BOTH went late. That count is the difference between "the machine
 * stalled" and "we stalled", and it is the one number a single-threaded instrument cannot produce.
 * Beside it ride what our own tail reads cost and what was switched on at the time.
 *
 * A SEPARATE FILE BY SUBJECT, the `startupDiscriminators.test.mts` precedent: the probe fold, the
 * coincidence matcher, the wire shape, the validators, the rollup and the two readouts are one
 * story, and `tests/perf.test.mts`, `tests/telemetryProducers.test.mts` and
 * `tests/usageAnalytics.test.mts` are all at the repo's 400-code-line ceiling.
 *
 * WHAT IS NOT HERE is the READ half — the counters, the Analytics section and the digest — which
 * lives in `usageLiveStalls.test.mts` beside the surfaces it renders. The same split
 * `startupDiscriminators.test.mts` and `usageStartup.test.mts` keep, and for the same reason:
 * either file alone would be past the repo's 400-code-line ceiling.
 *
 * Pure: no Electron, no worker thread, no clock, so it never skips. The probe's TIMERS are the one
 * thing not asserted here — a timer that fires is the e2e's job (tests/e2e/perf.e2e.mts); what is
 * asserted here is every decision made about the samples once they exist.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bucketOf,
  LOG_SIZE_BYTES_EDGES,
  NEW_BYTES_EDGES,
  TELEMETRY_OVERLAY_KINDS,
  type TelemetryEvent
} from '../src/shared/telemetry'
import {
  FREE_MEM_GB_EDGES,
  LIVE_STALL_MS_EDGES,
  WORKING_SET_MB_EDGES
} from '../src/shared/telemetryLive'
import { validateTelemetryEvent } from '../src/shared/telemetryValidate'
import {
  coincidentWindows,
  foldLiveLateness,
  LIVE_COINCIDENCE_MS,
  LIVE_PROBE_INTERVAL_MS,
  LIVE_STALL_LATE_MS,
  LIVE_TIMELINE_MS,
  type LiveLateSample
} from '../src/shared/perfLive'
import {
  noteLiveProbeSamples,
  peekLiveTimeline,
  resetLiveProbe,
  takeLiveProbeReading
} from '../src/main/livePerfProbe'
import {
  liveStallStats,
  sessionStateStats,
  tailReadStats
} from '../src/main/telemetry/liveFacts'
import type { TailIoSample } from '../src/main/log/tailIoStats'

// ---- the probe's arithmetic ----------------------------------------------------------------

/** `n` samples of `lateMs`, one probe interval apart, starting at `at`. */
function ticks(at: number, lateMs: number, n: number): LiveLateSample[] {
  return Array.from({ length: n }, (_, i) => ({ at: at + i * LIVE_PROBE_INTERVAL_MS, lateMs }))
}

test('the fold is a DISTRIBUTION plus the two counts a person can feel', () => {
  const fold = foldLiveLateness([2, 3, 1, 4, 2, 120, 3, 2, 900, 1])
  assert.equal(fold.samples, 10)
  assert.equal(fold.maxMs, 900)
  assert.equal(fold.over100, 2)
  assert.equal(fold.over500, 1)
  // A window that held no ticks folds to zeros beside `samples: 0` — it has not observed a smooth
  // session, it has observed nothing, and the seam that reports it refuses to send that.
  assert.deepEqual(foldLiveLateness([]), {
    samples: 0,
    p95Ms: 0,
    maxMs: 0,
    over100: 0,
    over500: 0
  })
})

test('THE COINCIDENCE MATCHER counts stalls the two threads AGREE on, and nothing else', () => {
  const base = 1_000_000
  // A machine stall: both threads late, a quarter second apart — one event, counted once.
  assert.equal(
    coincidentWindows([{ at: base, lateMs: 800 }], [{ at: base + 250, lateMs: 700 }]),
    1
  )
  // Our own stall: main late, the worker kept perfect time. THE READING THAT BLAMES US.
  assert.equal(coincidentWindows([{ at: base, lateMs: 800 }], []), 0)
  assert.equal(coincidentWindows([{ at: base, lateMs: 800 }], [{ at: base, lateMs: 4 }]), 0)
  // Too far apart to be the same event, by one millisecond past the window.
  assert.equal(
    coincidentWindows(
      [{ at: base, lateMs: 800 }],
      [{ at: base + LIVE_COINCIDENCE_MS + 1, lateMs: 800 }]
    ),
    0
  )
  // Under the late threshold on either side is not a stall at all.
  assert.equal(
    coincidentWindows(
      [{ at: base, lateMs: LIVE_STALL_LATE_MS - 1 }],
      [{ at: base, lateMs: 900 }]
    ),
    0
  )
})

test('EACH SAMPLE IS SPENT ONCE — one long freeze is one verdict, not one per tick', () => {
  // A two-second machine pause makes both threads late on several consecutive ticks. Pairing
  // every main sample against every worker sample in range would report that as nine, which is a
  // number about the probe's cadence rather than about what happened.
  const base = 2_000_000
  const main = ticks(base, 900, 8)
  const worker = ticks(base + 60, 900, 8)
  const hits = coincidentWindows(main, worker)
  assert.equal(hits, 8, 'a matching, one worker sample per main sample')
  // …and it can never exceed the late ticks on the thinner side, which is what makes it
  // comparable between installs that sampled different numbers of times.
  assert.equal(coincidentWindows(main, ticks(base + 60, 900, 2)), 2)
  // Order is not trusted: a fold assembled from two threads' messages has no ordering guarantee,
  // and a matcher fed unsorted input silently under-counts.
  assert.equal(coincidentWindows([...main].reverse(), [...worker].reverse()), 8)
})

test('the reading DRAINS, and `coincident` is absent unless a second clock really ran', () => {
  resetLiveProbe()
  const base = 3_000_000
  noteLiveProbeSamples([...ticks(base, 3, 4), { at: base + 1_000, lateMs: 700 }], null)
  const alone = takeLiveProbeReading()
  assert.equal(alone?.samples, 5)
  assert.equal(alone?.over500, 1)
  // No worker ever spoke ⇒ there was no second clock ⇒ NO VERDICT. Absent, never zero.
  assert.equal(alone?.coincident, undefined)
  assert.equal(alone !== null && 'coincident' in alone, false)
  // Drained: the next report over an interval with no ticks has nothing to say at all, which is
  // what stops one window being counted twice.
  assert.equal(takeLiveProbeReading(), null)

  noteLiveProbeSamples([{ at: base, lateMs: 800 }], [{ at: base + 100, lateMs: 800 }])
  const paired = takeLiveProbeReading()
  assert.equal(paired?.coincident, 1)
  resetLiveProbe()
})

test('the timeline is a bounded ~10-minute ring of PLAIN DATA, and a report does not consume it', () => {
  resetLiveProbe()
  const now = 4_000_000
  // One sample older than the ring's span, one inside it.
  noteLiveProbeSamples(
    [
      { at: now - LIVE_TIMELINE_MS - 1_000, lateMs: 300 },
      { at: now - 1_000, lateMs: 300 }
    ],
    [{ at: now - 900, lateMs: 300 }]
  )
  const timeline = peekLiveTimeline(now)
  assert.equal(timeline.main.length, 1)
  assert.equal(timeline.main[0]?.lateMs, 300)
  assert.equal(timeline.worker.length, 1)
  assert.deepEqual(timeline.tail, [])
  // Draining the FOLD leaves the SHAPE alone: two different questions, and a reader of one must
  // not silently consume the other (`peekTailIoTimeline`'s rule, one file over).
  takeLiveProbeReading()
  assert.equal(peekLiveTimeline(now).main.length, 1)
  resetLiveProbe()
  assert.equal(peekLiveTimeline(now).main.length, 0)
})

// ---- the facts, bucketed -------------------------------------------------------------------

test('THE MILLISECOND BECOMES A DECADE at exactly one seam, and the counts stay counts', () => {
  const stats = liveStallStats({ samples: 2400, p95Ms: 14, maxMs: 1_400, over100: 3, over500: 1 })
  assert.deepEqual(stats, {
    samples: 2400,
    p95Bucket: bucketOf(14, LIVE_STALL_MS_EDGES),
    maxBucket: bucketOf(1_400, LIVE_STALL_MS_EDGES),
    over100: 3,
    over500: 1
  })
  // Absent stays ABSENT rather than becoming a zero — the contract's own distinction between
  // "no second clock ran" and "two clocks agreed on nothing".
  assert.equal('coincident' in stats, false)
  assert.equal(liveStallStats({ ...stats, p95Ms: 0, maxMs: 0, coincident: 2 }).coincident, 2)
})

test('the tail rider reads its p95 off the RING and its max off the ACCUMULATOR', () => {
  const at = 5_000_000
  const cycle = (readMs: number, bytes: number): TailIoSample => ({
    at,
    statMs: 0,
    openMs: 0,
    readMs,
    bytes,
    slices: 1,
    reason: 'reused'
  })
  const stats = tailReadStats({
    summary: {
      reads: 4,
      reopens: 1,
      bytes: 5_000,
      slices: 4,
      statMs: 1,
      openMs: 2,
      readMs: 40,
      // The worst cycle the ACCUMULATOR saw — deliberately bigger than anything in the window
      // below, because a ring that has rolled past a stall must not be able to hide it.
      maxReadMs: 700,
      maxStatMs: 1,
      over100: 2,
      over500: 1,
      byReason: { reused: 3, first: 1, replaced: 0, shrunk: 0, error: 0 }
    },
    window: [cycle(2, 1_000), cycle(3, 300_000), cycle(120, 2_000), cycle(4, 100)],
    logBytes: 400 * 1024 * 1024
  })
  assert.equal(stats.reads, 4)
  assert.equal(stats.reopens, 1)
  assert.equal(stats.p95Bucket, bucketOf(120, LIVE_STALL_MS_EDGES))
  assert.equal(stats.maxBucket, bucketOf(700, LIVE_STALL_MS_EDGES))
  assert.equal(stats.over100, 2)
  assert.equal(stats.over500, 1)
  // The FATTEST SINGLE delta, not the total: the same megabyte in one read and in a hundred are
  // different events, and only the first can plausibly stall an appender.
  assert.equal(stats.deltaBytesBucket, bucketOf(300_000, NEW_BYTES_EDGES))
  assert.equal(stats.logSizeBucket, bucketOf(400 * 1024 * 1024, LOG_SIZE_BYTES_EDGES))
})

test('the state rider converts the two memory readings from the KIBIBYTES Electron answers in', () => {
  const stats = sessionStateStats({
    overlaysOpen: 3,
    overlaysLocked: 2,
    presenceOn: true,
    ringOn: false,
    // 1.5 GiB free, 640 MiB resident — both arrive as KiB from `getSystemMemoryInfo` and
    // `getAppMetrics`, and a unit mistake here would be invisible in the aggregate forever.
    freeMemKb: 1.5 * 1024 * 1024,
    workingSetKb: 640 * 1024
  })
  assert.equal(stats.freeMemBucket, bucketOf(1.5, FREE_MEM_GB_EDGES))
  assert.equal(stats.workingSetBucket, bucketOf(640, WORKING_SET_MB_EDGES))
  assert.equal(stats.overlaysLocked, 2)
  assert.equal(stats.presenceOn, true)
})

test('BOTH SESSION REPORTS DRAIN THE SAME RIDERS — the startup rider rides both, and so do these', () => {
  // Read as source rather than driven: `flush.ts` imports Electron, and the property worth pinning
  // is that neither report can quietly stop carrying the group. A session that ends before its
  // first heartbeat is the common case, and it is disproportionately the bad one.
  const flush = readFileSync(new URL('../src/main/telemetry/flush.ts', import.meta.url), 'utf8')
  const calls = flush.match(/\.\.\.liveRiderFields\(\)/g) ?? []
  assert.equal(calls.length, 2, 'sessionHeartbeat and sessionEnd both spread the riders')
  assert.match(flush, /t: 'sessionHeartbeat'[\s\S]*?\.\.\.liveRiderFields\(\)/)
  assert.match(flush, /t: 'sessionEnd'[\s\S]*?\.\.\.liveRiderFields\(\)/)
})

// ---- the wire shape ------------------------------------------------------------------------

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

test('the three riders survive validation on a heartbeat, field for field', () => {
  const result = validateTelemetryEvent(fullHeartbeat())
  assert.equal(result.ok, true)
  const ev = (result as { value: TelemetryEvent }).value
  assert.equal(ev.t, 'sessionHeartbeat')
  if (ev.t !== 'sessionHeartbeat') return
  assert.deepEqual(ev.live, {
    samples: 2400,
    p95Bucket: 2,
    maxBucket: 6,
    over100: 4,
    over500: 1,
    coincident: 1
  })
  assert.equal(ev.tail?.reads, 812)
  assert.equal(ev.tail?.deltaBytesBucket, 3)
  assert.equal(ev.state?.overlaysLocked, 1)
  assert.equal(ev.state?.presenceOn, true)
})

test('sessionEnd carries the same three riders — the startup rider rides both, and so do these', () => {
  const end = { ...fullHeartbeat(), t: 'sessionEnd', durationMs: 900_000, viewsVisited: 3 }
  delete end.uptimeMs
  const result = validateTelemetryEvent(end)
  assert.equal(result.ok, true)
  const ev = (result as { value: TelemetryEvent }).value
  if (ev.t !== 'sessionEnd') throw new Error('not a sessionEnd')
  assert.equal(ev.live?.samples, 2400)
  assert.equal(ev.tail?.reopens, 0)
  assert.equal(ev.state?.ringOn, false)
})

test('ABSENT IS LEGAL AND MEANS NOTHING TO SAY — an unattached session sends no `tail` at all', () => {
  // The three groups are independent. A session with no character attached has no read latency to
  // describe, and a row of zeros from it would drag every fleet figure toward a machine that did
  // no work — so the group is omitted rather than zero-filled.
  const bare = { t: 'sessionHeartbeat', uptimeMs: 1_000, live: fullHeartbeat().live }
  const result = validateTelemetryEvent(bare)
  assert.equal(result.ok, true)
  const ev = (result as { value: TelemetryEvent }).value
  if (ev.t !== 'sessionHeartbeat') throw new Error('not a heartbeat')
  assert.equal(ev.tail, undefined)
  assert.equal(ev.state, undefined)
  assert.equal(ev.live?.samples, 2400)
  // …and a heartbeat with none of the three is exactly the event an older client sends.
  const old = validateTelemetryEvent({ t: 'sessionHeartbeat', uptimeMs: 1_000 })
  assert.equal(old.ok, true)
})

test('`coincident` ABSENT and `coincident` ZERO are different answers, and both are accepted', () => {
  // Absent: the probe worker was not running, so there is no second clock and no verdict.
  const noWorker = { t: 'sessionHeartbeat', uptimeMs: 1_000, live: { samples: 10, p95Bucket: 0, maxBucket: 0, over100: 0, over500: 0 } }
  const a = validateTelemetryEvent(noWorker)
  assert.equal(a.ok, true)
  const evA = (a as { value: TelemetryEvent }).value
  if (evA.t !== 'sessionHeartbeat') throw new Error('not a heartbeat')
  assert.equal(evA.live?.coincident, undefined)
  assert.equal('coincident' in (evA.live ?? {}), false)

  // Zero: two clocks WERE compared and never went late together — the reading that says the
  // fault is ours. It must survive as a real zero rather than being folded into "unknown".
  const compared = { ...noWorker, live: { ...noWorker.live, over100: 3, coincident: 0 } }
  const b = validateTelemetryEvent(compared)
  assert.equal(b.ok, true)
  const evB = (b as { value: TelemetryEvent }).value
  if (evB.t !== 'sessionHeartbeat') throw new Error('not a heartbeat')
  assert.equal(evB.live?.coincident, 0)
})

test('OUT-OF-LADDER VALUES ARE REFUSED, by name — a bucket index is not a millisecond', () => {
  const refuse = (patch: Record<string, unknown>, field: string): void => {
    const ev = { ...fullHeartbeat(), ...patch }
    const result = validateTelemetryEvent(ev)
    assert.equal(result.ok, false, `${field} should have been refused`)
    assert.equal((result as { field: string }).field, field)
  }
  const live = fullHeartbeat().live as Record<string, unknown>
  const tail = fullHeartbeat().tail as Record<string, unknown>
  const state = fullHeartbeat().state as Record<string, unknown>
  // One past the top bucket of each ladder. `bucketOf` can never produce these, so a client that
  // sends one is a client this server should not believe.
  refuse({ live: { ...live, p95Bucket: LIVE_STALL_MS_EDGES.length + 1 } }, 'live.p95Bucket')
  refuse({ live: { ...live, maxBucket: -1 } }, 'live.maxBucket')
  refuse({ live: { ...live, coincident: 2.5 } }, 'live.coincident')
  refuse({ tail: { ...tail, deltaBytesBucket: NEW_BYTES_EDGES.length + 1 } }, 'tail.deltaBytesBucket')
  refuse({ tail: { ...tail, logSizeBucket: LOG_SIZE_BYTES_EDGES.length + 1 } }, 'tail.logSizeBucket')
  refuse({ state: { ...state, freeMemBucket: FREE_MEM_GB_EDGES.length + 1 } }, 'state.freeMemBucket')
  refuse(
    { state: { ...state, workingSetBucket: WORKING_SET_MB_EDGES.length + 1 } },
    'state.workingSetBucket'
  )
  // Overlay counts are counts of WINDOWS, so their ceiling is the number of overlay kinds — not
  // `MAX_COUNT`. Nine open overlays is not a busy install, it is a broken client.
  refuse(
    { state: { ...state, overlaysOpen: TELEMETRY_OVERLAY_KINDS.length + 1 } },
    'state.overlaysOpen'
  )
  refuse({ state: { ...state, presenceOn: 'yes' } }, 'state.presenceOn')
  // A group that is present must be COMPLETE: a percentile with no sample count under it is not a
  // percentile of anything.
  refuse({ live: { p95Bucket: 1 } }, 'live.samples')
  refuse({ tail: { reads: 1 } }, 'tail.reopens')
  refuse({ live: 7 }, 'live')
})

test('THE LADDER TOPS OUT PAST A SECOND, which the startup ladder does not', () => {
  // The freezes this ticket exists for are reported at about a second. A ladder whose top bucket
  // is "≥ 250 ms" (STUTTER_MS_EDGES, the startup probe's) would put a 300 ms hiccup and a 3 s
  // lockup in the same row and answer nothing — which is why this ladder is its own.
  assert.ok(LIVE_STALL_MS_EDGES.includes(1_000))
  assert.ok(LIVE_STALL_MS_EDGES[LIVE_STALL_MS_EDGES.length - 1] >= 2_500)
  // …and it keeps low rungs around Windows' 15.6 ms quantum, so a healthy session still reads as
  // a distribution rather than as one full bottom bucket.
  assert.equal(bucketOf(12, LIVE_STALL_MS_EDGES), 1)
  assert.equal(bucketOf(1_100, LIVE_STALL_MS_EDGES), 7)
})
