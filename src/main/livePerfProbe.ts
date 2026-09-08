// ============================================================================
// livePerfProbe.ts — TWO CLOCKS FOR THE WHOLE SESSION (JOS-367).
// ============================================================================
//
// WHY TWO THREADS, stated at the probe as the ticket asks: an in-process timer measures its own
// lateness, and lateness is real, but it cannot say WHO failed to schedule it — `shared/perf.ts`
// admits that where the startup stutter probe is declared. Players report ~1 s EverQuest freezes
// while this app runs, and we cannot see the game's frame time. So main runs a 250 ms lateness
// probe and a dedicated worker (`./perfProbeWorker.ts`) runs the same one, and the pair answers
// what neither can alone: BOTH late in the same half second ⇒ the MACHINE stalled and the game
// was stalled by the same thing; ONLY MAIN late ⇒ we stalled, and that is a bug with an address.
// `coincidentWindows` (shared/perfLive.ts) is that verdict; this file is its two instruments.
//
// A LEAF, LIKE `log/tailIoStats.ts`, AND FOR THE SAME TWO REASONS. It is plain data in memory
// with no idea the user's telemetry switch exists (the telemetry seam drains it and applies the
// gate, once, where every other producer does), and it must not join an import cycle: `perf.ts`
// starts it and `telemetry/liveRiders.ts` drains it, and if this module reached back into either
// the two would be a loop under the app's own privacy boundary.
//
// ============================ WHAT IT COSTS, MEASURED =============================
// Rule 1 of perf.ts's performance contract is that an instrument which costs something is a bug,
// so this one states its bill rather than promising it is small. MEASURED on the dev box (two
// 250 ms self-timing intervals, one per thread, over a 20 s window, `process.cpuUsage()` deltas
// against an idle baseline in the same process): 15 ms of CPU across 20 s of wall clock — 0.075%
// of one core, and at or under the OS accounting resolution, which is to say the smallest nonzero
// figure this measurement can report at all. Eight wakeups a second between the two threads, one
// number pushed each, no allocation on the hot path beyond that. The worker posts NOTHING while
// things are healthy except one fold a minute.
//
// The same run measured the BASELINE this instrument reads on an idle Windows box: main-thread
// lateness p50 12.7 ms, p95 15.5 ms, worst 24 ms — the 15.6 ms timer quantum, exactly as
// AGENTS.md's measured law predicts, and the reason `LIVE_STALL_MS_EDGES` spends its two lowest
// rungs there instead of below them.

import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import {
  coincidentWindows,
  foldLiveLateness,
  LIVE_PROBE_INTERVAL_MS,
  LIVE_PROBE_REPORT_MS,
  LIVE_STALL_LATE_MS,
  LIVE_TIMELINE_MS,
  type LiveLateSample,
  type LiveProbeMessage,
  type LiveStallFold
} from '../shared/perfLive'
import { peekTailIoTimeline } from './log/tailIoStats'

/** One interval's reading from both clocks, drained by the session report that carries it. */
export interface LiveProbeReading extends LiveStallFold {
  /**
   * Windows in which both threads were late — `undefined` when the worker probe was not running,
   * which is NOT zero. Zero says two clocks were compared and never agreed; absent says there was
   * no second clock to compare against.
   */
  coincident?: number
}

/** What `peekLiveTimeline()` answers with: three series against one wall clock. */
export interface LiveTimeline {
  main: readonly LiveLateSample[]
  worker: readonly LiveLateSample[]
  /** The tail's read cycles over the same span — `at` and how long the read leg took. */
  tail: readonly { at: number; readMs: number }[]
}

// ---- state ---------------------------------------------------------------------------------
//
// TWO STRUCTURES ON PURPOSE, the `tailIoStats.ts` shape: an ACCUMULATOR that a report drains and
// resets, and a RING that it does not. A fold and a shape are different questions, and a reader of
// one must not silently consume the other.

let timer: ReturnType<typeof setInterval> | null = null
let worker: Worker | null = null
/** Every main-thread lateness sample since the last drain, in ms. */
let pending: number[] = []
/** The late ones, timestamped, for the matcher. Both threads' lists are kept the same way. */
let mainLate: LiveLateSample[] = []
let workerLate: LiveLateSample[] = []
/** Has the worker ever been observed alive? Absent `coincident` hangs on this. */
let workerRunning = false
/** ~10 minutes of both threads, never drained by a report. */
const mainRing: LiveLateSample[] = []
const workerRing: LiveLateSample[] = []
let dueAt = 0

/** Drop everything older than the ring's span. Called on the probe's own tick, so the bound is
 *  TIME rather than a sample count that would mean different spans on different cadences. */
function trim(ring: LiveLateSample[], now: number): void {
  const cutoff = now - LIVE_TIMELINE_MS
  let drop = 0
  while (drop < ring.length && ring[drop].at < cutoff) drop++
  if (drop > 0) ring.splice(0, drop)
}

function noteMain(lateMs: number, at: number): void {
  pending.push(lateMs)
  if (lateMs >= LIVE_PROBE_REPORT_MS) {
    const sample = { at, lateMs }
    mainRing.push(sample)
    if (lateMs >= LIVE_STALL_LATE_MS) mainLate.push(sample)
  }
  trim(mainRing, at)
  trim(workerRing, at)
}

/** One message from the second clock. A worker that speaks at all is a worker that is running. */
function noteWorker(msg: LiveProbeMessage): void {
  workerRunning = true
  if (msg.k !== 'late') return
  const sample = { at: msg.at, lateMs: msg.lateMs }
  workerRing.push(sample)
  if (msg.lateMs >= LIVE_STALL_LATE_MS) workerLate.push(sample)
}

// ---- the two probes ------------------------------------------------------------------------

/**
 * Start both clocks. Idempotent, and called from `markStartupPhase('replayDone')` — the one moment
 * the app agrees its launch is over, which is also the moment the startup probes stop. The two
 * measurements are deliberately not allowed to overlap: a replay's own fold is not a live stall,
 * and a population that mixed them could answer neither question.
 *
 * The main timer is `unref`'d and so is the worker handle, so neither can be the reason the
 * process outlives its windows — perf.ts's rule 2, applied to a thread as well as a timer.
 */
export function startLiveProbe(): void {
  if (timer !== null) return
  dueAt = performance.now() + LIVE_PROBE_INTERVAL_MS
  timer = setInterval(() => {
    const now = performance.now()
    noteMain(Math.round(Math.max(0, now - dueAt)), Date.now())
    // Re-based on the tick that actually happened, exactly as the startup probes rebase: each
    // sample is then this tick's own lateness rather than a running total of every earlier one.
    dueAt = now + LIVE_PROBE_INTERVAL_MS
  }, LIVE_PROBE_INTERVAL_MS)
  timer.unref()
  startProbeWorker()
}

/**
 * The second clock, in its own thread. A failure to start is NOT an error the user should ever
 * hear about and not a reason to lose the main-thread reading: `coincident` is simply absent, and
 * absent is a documented answer meaning "there was no second clock" (shared/telemetryLive.ts).
 * Same for a worker that dies — the flag goes down and the verdict stops being claimed.
 */
function startProbeWorker(): void {
  try {
    const w = new Worker(join(__dirname, 'perfProbeWorker.js'))
    w.on('message', (msg: LiveProbeMessage) => {
      noteWorker(msg)
    })
    w.on('error', () => {
      workerRunning = false
    })
    w.on('exit', () => {
      workerRunning = false
    })
    // The handle, not just the timer inside it: a live worker keeps the process alive, and a
    // diagnostic must never be the reason an app will not quit.
    w.unref()
    worker = w
  } catch {
    workerRunning = false
  }
}

/** Stop both clocks. Called from `stopPerf` (window-all-closed), and safe to call twice. */
export function stopLiveProbe(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
  if (worker !== null) void worker.terminate()
  worker = null
  workerRunning = false
}

// ---- the two readers -----------------------------------------------------------------------

/**
 * FOLD AND RESET, for the interval reporter — `takeTailIoSummary`'s discipline, for the same
 * no-double-counting reason: whichever session report fires first drains it, so a fleet-wide sum
 * is a sum of deltas and a killed session loses at most its last window.
 *
 * `null` when no tick was observed, and that is not a row of zeros: a session that never ran the
 * probe has not observed a smooth ten minutes, it has observed nothing.
 */
export function takeLiveProbeReading(): LiveProbeReading | null {
  if (pending.length === 0) return null
  const fold = foldLiveLateness(pending)
  // The verdict is computed before the two lists are dropped, and only when a second clock was
  // actually running — see `LiveProbeReading.coincident`.
  const coincident = workerRunning ? coincidentWindows(mainLate, workerLate) : undefined
  pending = []
  mainLate = []
  workerLate = []
  return coincident === undefined ? fold : { ...fold, coincident }
}

/**
 * THE LAST ~10 MINUTES, unreset — the SHAPE rather than the fold, for an attachment that wants to
 * see a freeze rather than count one (the feedback-attachment ticket is its first caller).
 *
 * PURE DATA, NO WIRE. Nothing here is bucketed, nothing here is sent, and nothing here consults
 * the user's switch: it is a local diagnostic read on the user's own machine, the same posture
 * `peekTailIoTimeline` takes one file over.
 *
 * The tail series is READ from that ring rather than copied into this one. A second copy of the
 * same samples would be a second thing to keep true, and the two rings already share a clock
 * (`Date.now()`), which is the only thing a caller aligning them needs.
 */
export function peekLiveTimeline(now = Date.now()): LiveTimeline {
  const cutoff = now - LIVE_TIMELINE_MS
  return {
    main: mainRing.filter((s) => s.at >= cutoff),
    worker: workerRing.filter((s) => s.at >= cutoff),
    tail: peekTailIoTimeline()
      .filter((s) => s.at >= cutoff)
      .map((s) => ({ at: s.at, readMs: s.readMs }))
  }
}

/** Test seam: forget everything, stop everything. Never called by the app. */
export function resetLiveProbe(): void {
  stopLiveProbe()
  pending = []
  mainLate = []
  workerLate = []
  mainRing.length = 0
  workerRing.length = 0
  workerRunning = false
}

/**
 * Test seam: inject samples as though the two probes had observed them. It exists because the
 * thing worth pinning is the ARITHMETIC over a stall — and a test that had to produce a real 1 s
 * freeze on both threads to check the coincidence count would be a test about the machine running
 * it. The timers themselves are watched by the e2e (tests/e2e/perf.e2e.mts).
 */
export function noteLiveProbeSamples(
  main: readonly LiveLateSample[],
  fromWorker: readonly LiveLateSample[] | null
): void {
  for (const s of main) noteMain(s.lateMs, s.at)
  if (fromWorker === null) return
  for (const s of fromWorker) noteWorker({ k: 'late', at: s.at, lateMs: s.lateMs })
}
