/**
 * liveSessions.test.mts — the "who is in the app right now" derivation, with no AWS in sight.
 *
 * The fetch is a thin shell (build a client, send one GetMetricStatistics, hand the datapoints to
 * the two functions below); everything that can be WRONG is in the two pure functions, so they
 * are what this drives: bucket densification and the age estimate.
 *
 * WHY THE AGE NEEDS A TEST OF ITS OWN. It is the only number in this readout that is an
 * ESTIMATE, and world-model law 1 says an estimate has to be honest about which direction it can
 * be wrong in. These cases pin exactly that: it is a FLOOR (a fleet that churns inside a bucket
 * reads younger, never older), an empty fleet has NO age rather than a zero, a gap in the metric
 * is a real quiet period rather than a splice, and a window that is occupied all the way back
 * declares itself truncated instead of pretending to have finished the sum.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUCKET_MS,
  denseBuckets,
  deriveLiveSessions,
  lastCompleteBucketEnd
} from '../src/main/triage/liveSessions'

/** Narrow the union in one place — every case below is on the `available: true` arm. */
function live(buckets: number[], asOfMs = 0): {
  activeNow: number
  avgAgeMs: number | null
  ageIsFloor: boolean
  lookbackMs: number
} {
  const out = deriveLiveSessions(buckets, asOfMs)
  assert.ok(out.available)
  return out
}

test('active now is the LAST COMPLETE bucket, and a period still filling is never it', () => {
  // A bucket containing `now` is still accumulating, and heartbeats reach CloudWatch through a
  // flush loop besides — so "right now" is defined as the last FULL bucket, not as the newest
  // datapoint the API will hand over.
  //
  // THE OFFSETS BELOW ARE A BUCKET-LENGTH APART ON PURPOSE (JOS-269 took the bucket 5 min → 10 min
  // with the heartbeat). Left at 3 min and 4:59 they would still have passed while testing nothing
  // — both are now comfortably mid-bucket — so they are re-derived from BUCKET_MS instead of
  // restated in minutes, and the last one lands one second short of the boundary wherever it is.
  const noon = Date.UTC(2026, 7, 10, 12, 0, 0)
  assert.equal(lastCompleteBucketEnd(noon + 3 * 60_000), noon)
  assert.equal(lastCompleteBucketEnd(noon + BUCKET_MS - 1_000), noon)
  assert.equal(lastCompleteBucketEnd(noon + BUCKET_MS), noon + BUCKET_MS)

  assert.equal(live([1, 2, 9]).activeNow, 9)
  assert.equal(deriveLiveSessions([], 0).available && deriveLiveSessions([], 0).activeNow, 0)
})

test('NOBODY ALIVE has no age — a zero there would read as "everyone just arrived"', () => {
  const quiet = live([4, 3, 0])
  assert.equal(quiet.activeNow, 0)
  assert.equal(quiet.avgAgeMs, null)
  assert.equal(quiet.ageIsFloor, false)
})

test('a session in its first bucket is zero old, and the estimate says so', () => {
  // Three sessions appear in the newest bucket with nothing before them: they are new. Reporting
  // "10 min" because a bucket is that long would be inventing the very precision the bucketing
  // threw away.
  const fresh = live([0, 0, 3])
  assert.equal(fresh.activeNow, 3)
  assert.equal(fresh.avgAgeMs, 0)
  assert.equal(fresh.ageIsFloor, false)
})

test('a steady fleet ages by exactly one bucket per bucket it has been sustained', () => {
  // Two sessions, alive in four consecutive buckets: three prior buckets each contribute their
  // full overlap, so the mean age is 3 buckets — 30 minutes at today's 10-minute bucket, and the
  // assertion is written in BUCKETS so the arithmetic, not the cadence, is what it pins.
  const steady = live([2, 2, 2, 2])
  assert.equal(steady.activeNow, 2)
  assert.equal(steady.avgAgeMs, 3 * BUCKET_MS)
  assert.equal(steady.ageIsFloor, true, 'the oldest bucket is still occupied: this is a floor')
})

test('the estimate is a MIN, so a fleet that grew is not aged by the sessions that left', () => {
  // Five alive now; only one was alive two buckets ago. The overlap is bounded by BOTH sides, so
  // the four newcomers cannot inherit the veteran's age.
  const grown = live([1, 3, 5])
  // survivors = min(5,3) + min(5,1) = 4 ⇒ 4/5 of a bucket.
  assert.equal(grown.avgAgeMs, Math.round((4 / 5) * BUCKET_MS))

  // …and the reverse: a fleet that SHRANK is bounded by today's count, not by yesterday's crowd.
  const shrunk = live([50, 50, 2])
  assert.equal(shrunk.avgAgeMs, 2 * BUCKET_MS, 'two sessions, two prior buckets, not fifty')
})

test('a GAP in the metric is a quiet period, never a splice', () => {
  // CloudWatch omits a period entirely when nothing was published in it, and its Timestamp is the
  // period's START — so the last slot is the bucket that ENDED at `end`, i.e. the last complete
  // one. Densifying is what makes an omission mean "nobody was alive then"; reading the sparse
  // list as consecutive would silently delete the quiet hour and inflate every age.
  const end = Date.UTC(2026, 7, 10, 12, 0, 0)
  const dense = denseBuckets(
    [
      { at: end - 4 * BUCKET_MS, sum: 3 },
      // (nothing at -3 or -2: the fleet was away)
      { at: end - 1 * BUCKET_MS, sum: 3 }
    ],
    end,
    4 * BUCKET_MS
  )
  assert.deepEqual(dense, [3, 0, 0, 3])
  // Three alive now — and they are NEW, not four buckets old. A session is continuous, so
  // nothing alive now can predate a period in which nobody was alive at all. The running minimum
  // is what encodes that; a per-bucket `min` would have aged today's fleet with last night's.
  const gapped = live(dense)
  assert.equal(gapped.activeNow, 3)
  assert.equal(gapped.avgAgeMs, 0)
  assert.equal(gapped.ageIsFloor, false)

  // The same three sessions, unbroken: an unbroken run reads as an unbroken run.
  const run = denseBuckets(
    [
      { at: end - 3 * BUCKET_MS, sum: 3 },
      { at: end - 2 * BUCKET_MS, sum: 3 },
      { at: end - 1 * BUCKET_MS, sum: 3 }
    ],
    end,
    4 * BUCKET_MS
  )
  assert.deepEqual(run, [0, 3, 3, 3])
  assert.equal(live(run).avgAgeMs, 2 * BUCKET_MS)
})

test('densifying is TOTAL: junk, negatives and out-of-window points contribute nothing', () => {
  const end = Date.UTC(2026, 7, 10, 12, 0, 0)
  const dense = denseBuckets(
    [
      { at: end - 10 * BUCKET_MS, sum: 99 }, // before the window
      { at: end + BUCKET_MS, sum: 99 }, // after it
      { at: end - BUCKET_MS, sum: Number.NaN },
      { at: end - BUCKET_MS, sum: -5 },
      { at: end - BUCKET_MS, sum: 2 }
    ],
    end,
    3 * BUCKET_MS
  )
  assert.deepEqual(dense, [0, 0, 2])
})

test('ageIsFloor is FALSE once the window reaches back past the oldest session', () => {
  // The oldest bucket is empty, so the survival sum ran out of sessions before it ran out of
  // window — the mean is a mean, and nothing needs a `≥`.
  const settled = live([0, 4, 4, 4])
  assert.equal(settled.ageIsFloor, false)
  assert.equal(settled.avgAgeMs, 2 * BUCKET_MS)
})
