// ============================================================================
// perfLive.ts — THE LIVE STALL PROBE's vocabulary and its arithmetic (JOS-367).
// ============================================================================
//
// WHY THERE ARE TWO THREADS DOING THE SAME THING. Players report ~1 s EverQuest render freezes
// while this app runs. An in-process timer cannot prove WHO failed to schedule it — `shared/perf.ts`
// says so where the startup stutter probe is declared, and that honest limit is what this file
// exists to remove. Run the SAME 250 ms lateness probe on main AND on a thread that does nothing
// else, and the pair answers the question a single clock cannot:
//
//   * BOTH threads late in the same half second ⇒ the MACHINE stalled. Paging, a driver reset
//     (TDR), a disk that stopped answering, a DPC storm. Our main loop was a victim, not a cause,
//     and so — plausibly — was the game's render thread.
//   * ONLY MAIN late ⇒ WE stalled. Something on our loop held it: a fold, a synchronous read, a
//     hook callback. That is a bug with an address.
//
// `coincidentWindows` below is that verdict, counted. Everything else here is the plumbing that
// keeps the two threads speaking the same units.
//
// MILLISECONDS, NOT BUCKETS. This is the LOCAL shape — the same split `StartupStutterProbe` keeps
// against `StartupStutterStats`: raw milliseconds live in the process (the HUD, the ring, an
// attachment), and the fold into wire BUCKETS happens once, at the telemetry seam
// (`src/main/telemetry/liveFacts.ts`). Two types so nothing can accidentally send this one.
//
// PURE, and it is imported by the WORKER BUNDLE, so it may never reach Electron or `node:` — the
// worker is a separate rollup entry and anything this file touches is bundled into it.

import { percentile, round, STARTUP_STUTTER_LATE_MS } from './perf'

/**
 * The probe's cadence, on BOTH threads.
 *
 * 250 ms is sixteen of Windows' 15.625 ms timer quanta, which matters for the same reason
 * `STARTUP_STUTTER_INTERVAL_MS` is a multiple of it: a timer ends at the next tick edge
 * (AGENTS.md's measured law), so an interval off the grid reports a constant baseline lateness on
 * a perfectly healthy machine. MEASURED on the dev box at this cadence: p50 12.7 ms, p95 15.5 ms,
 * worst 24 ms across a 20 s idle window — the quantum itself, and the reason the low rungs of
 * `LIVE_STALL_MS_EDGES` exist rather than being wasted on noise.
 *
 * It is slower than the HUD's 500 ms probe is fast, deliberately: this one runs for the WHOLE
 * SESSION on every install, and a freeze worth reporting is three or four ticks wide at this rate.
 */
export const LIVE_PROBE_INTERVAL_MS = 250

/**
 * What the WORKER bothers to post. Below this a tick is folded into the periodic report instead of
 * crossing the thread boundary — the worker exists to be a second clock, not a message source, and
 * a `postMessage` per tick would make the instrument part of the load it measures.
 *
 * 25 ms is `STARTUP_STUTTER_LATE_MS`, restated by import rather than by number.
 */
export const LIVE_PROBE_REPORT_MS = STARTUP_STUTTER_LATE_MS

/** How often the worker speaks when nothing is wrong: one fold, so main can tell a healthy silent
 *  worker from a wedged one, and so the sample count has a denominator. */
export const LIVE_PROBE_FOLD_MS = 60_000

/**
 * WHAT COUNTS AS LATE for the coincidence test and for `over100`. A tenth of a second is several
 * frames at any refresh rate anyone plays at — past this, a person has seen something.
 */
export const LIVE_STALL_LATE_MS = 100

/** …and what counts as a FREEZE (`over500`): half a second is not a hitch, it is a pause. */
export const LIVE_STALL_FREEZE_MS = 500

/**
 * How far apart two late ticks may be and still be called the same event.
 *
 * IT IS THE PROBE INTERVAL TIMES TWO, and that is the whole argument: each thread samples every
 * 250 ms, so one stall of the machine can be observed by the two threads up to two ticks apart
 * without either of them being late "at the same instant". Tighter and a real coincidence is
 * missed on the sample grid; looser and two unrelated hitches inside one second are welded into a
 * verdict about the machine.
 */
export const LIVE_COINCIDENCE_MS = 500

/** How much of the recent past `peekLiveTimeline()` keeps. Ten minutes is one heartbeat interval —
 *  long enough that a report written just after a freeze still contains it. */
export const LIVE_TIMELINE_MS = 10 * 60_000

/** One observed tick that was late enough to be worth a timestamp. `at` is `Date.now()`, NOT
 *  `performance.now()`: it is the only clock two threads can be compared on. */
export interface LiveLateSample {
  at: number
  lateMs: number
}

/**
 * What the worker sends. Two shapes, tagged: the late ticks that a coincidence can be built from,
 * and a periodic fold that proves the worker is alive and says how many ticks it saw.
 */
export type LiveProbeMessage =
  | ({ k: 'late' } & LiveLateSample)
  | { k: 'fold'; at: number; ticks: number; maxLateMs: number }

/** One interval's account of ONE thread's lateness, in milliseconds. The wire shape
 *  (`shared/telemetryLive.ts LiveStallStats`) is this with the percentiles bucketed. */
export interface LiveStallFold {
  /** Ticks observed. `0` means the probe was not running, which is not a smooth session. */
  samples: number
  p95Ms: number
  maxMs: number
  over100: number
  over500: number
}

/**
 * Lateness samples → one interval's fold. Pure, so the arithmetic is pinned by tests rather than
 * inferred from a session that cannot be re-run.
 *
 * An empty window folds to zeros beside `samples: 0` — the same claim `foldStutterSamples` makes,
 * and the reason the seam that reports it refuses to send a reading with no samples in it.
 */
export function foldLiveLateness(lateMs: readonly number[]): LiveStallFold {
  const clean = lateMs.filter((d) => Number.isFinite(d)).map((d) => Math.max(0, d))
  return {
    samples: clean.length,
    p95Ms: round(percentile(clean, 95), 0),
    maxMs: round(clean.length > 0 ? Math.max(...clean) : 0, 0),
    over100: clean.filter((d) => d >= LIVE_STALL_LATE_MS).length,
    over500: clean.filter((d) => d >= LIVE_STALL_FREEZE_MS).length
  }
}

/**
 * THE VERDICT: how many stalls were seen by BOTH threads.
 *
 * A coincidence is a main sample and a worker sample, each at least `LIVE_STALL_LATE_MS` late,
 * whose wall-clock timestamps are within `LIVE_COINCIDENCE_MS` of each other.
 *
 * EACH SAMPLE IS SPENT ONCE. A machine that pauses for two seconds makes both threads late on
 * several consecutive ticks, and pairing every main sample against every worker sample in range
 * would report one stall as nine — a number that grows with the probe's cadence rather than with
 * what happened. So this is a MATCHING: the samples are walked in time order and each worker
 * sample can answer for exactly one main sample. The count is therefore a floor on stalls and can
 * never exceed the number of late ticks on either thread, which is the property that makes it
 * comparable across installs.
 *
 * Both inputs are sorted here rather than trusted: the ring appends in order, but a fold assembled
 * from two threads' messages has no such guarantee, and a matcher fed unsorted input silently
 * under-counts.
 */
export function coincidentWindows(
  main: readonly LiveLateSample[],
  worker: readonly LiveLateSample[]
): number {
  const late = (s: readonly LiveLateSample[]): LiveLateSample[] =>
    s.filter((x) => x.lateMs >= LIVE_STALL_LATE_MS).sort((a, b) => a.at - b.at)
  const mine = late(main)
  const theirs = late(worker)
  let hits = 0
  let j = 0
  for (const m of mine) {
    // Retire every worker sample that is already too old to pair with this one — and with any
    // later one, which is what makes the walk linear instead of quadratic.
    while (j < theirs.length && theirs[j].at < m.at - LIVE_COINCIDENCE_MS) j++
    if (j < theirs.length && Math.abs(theirs[j].at - m.at) <= LIVE_COINCIDENCE_MS) {
      hits++
      j++
    }
  }
  return hits
}
