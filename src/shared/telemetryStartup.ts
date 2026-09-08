// ============================================================================
// telemetryStartup.ts — THE ONE PLACE A STARTUP READING IS BUILT (JOS-57).
// ============================================================================
//
// Split out of `./telemetry.ts` when JOS-57's scope addition (owner, 2026-08-11) pushed that file
// past the repo's 400-code-line ceiling — a split, not a widened threshold, and along a seam that
// already existed: `./telemetry.ts` is the CONTRACT (the wire shape, the bucket edges, the
// ceilings) and is what the validator and the ingest Lambda bundle; this is the CLIENT-SIDE
// CONSTRUCTOR, which nothing on the server has ever called.
//
// The dependency runs ONE WAY (this file imports the contract; the contract imports nothing), so
// there is no cycle to reason about and the server bundle simply stops carrying a producer.
//
// WHY A CONSTRUCTOR AT ALL, rather than main assembling the object: the producer must not be able
// to invent a shape, and the ceilings must not be forgettable. Every field below is clamped to
// exactly what its own validator will accept, so an event this function returns is one this app's
// own validator can never refuse — and that matters more than it sounds, because a producer whose
// events are silently dropped at the IPC boundary is indistinguishable, in the aggregate, from a
// fleet that has no slow launches at all.

import {
  bucketOf,
  LOG_SIZE_BYTES_EDGES,
  MAX_COUNT,
  MAX_DURATION_MS,
  MAX_REPLAY_EVENTS,
  NEW_BYTES_EDGES,
  STUTTER_MS_EDGES,
  type StartupReplayStats
} from './telemetry'

/** The raw facts the producer holds, before any of them is a legal wire value. */
export interface StartupReplayInput {
  replayMs: number
  eventsReplayed: number
  /** The duty ledger, as `shared/perf.ts ReplayDutyStats` states it. */
  workMs: number
  restMs: number
  maxBlockMs: number
  blocksOver50: number
  /** Bytes the scan actually folded (its frozen EOF) — bucketed here, never sent raw. */
  logBytes: number
  /**
   * Bytes the log grew by since this app last shut down cleanly — bucketed here, never sent raw.
   * Absent (or negative, which is a rotated log) ⇒ no reading, never a zero.
   */
  newBytes?: number
  /** The heartbeat's drift in MILLISECONDS, as `shared/perf.ts` folded it. Bucketed here. */
  stutter?: { p50Ms: number; p95Ms: number; latePct: number }
  /** Time to the first megabyte of the read, ms. Absent on a log smaller than that. */
  firstMbMs?: number
}

/**
 * Build one launch's reading. Total: every field is clamped, and the duty is COMPUTED here rather
 * than sent as two numbers, because the wire should carry the ANSWER and `workMs`/`restMs`
 * separately would invite a reader to re-derive it wrong.
 */
export function startupReplayStats(input: StartupReplayInput): StartupReplayStats {
  const work = clampWhole(input.workMs, MAX_DURATION_MS)
  const rest = clampWhole(input.restMs, MAX_DURATION_MS)
  const wall = work + rest
  return {
    replayMs: clampWhole(input.replayMs, MAX_DURATION_MS),
    eventsReplayed: clampWhole(input.eventsReplayed, MAX_REPLAY_EVENTS),
    dutyPct: wall > 0 ? Math.round((work / wall) * 100) : 0,
    maxBlockMs: clampWhole(input.maxBlockMs, MAX_DURATION_MS),
    blocksOver50: clampWhole(input.blocksOver50, MAX_COUNT),
    logSizeBucket: bucketOf(clampWhole(input.logBytes, Number.MAX_SAFE_INTEGER), LOG_SIZE_BYTES_EDGES),
    ...startupDiscriminators(input)
  }
}

/**
 * The three JOS-57 scope-addition fields, each of which may be ABSENT — split out so the
 * constructor above stays a straight list and so "absent means unknown" is written once per field
 * rather than once per call site.
 *
 * A NEGATIVE `newBytes` is DROPPED rather than clamped to 0. Clamping is right for a duration a
 * NaN clock produced; it is wrong here, because the one way this number goes negative is a log
 * that SHRANK under our mark (a rotation), and reporting that launch as "no new bytes" would be
 * the only shape in this reading that states a fact nobody measured.
 */
function startupDiscriminators(input: StartupReplayInput): Partial<StartupReplayStats> {
  const out: Partial<StartupReplayStats> = {}
  if (input.newBytes !== undefined && Number.isFinite(input.newBytes) && input.newBytes >= 0) {
    out.newBytesBucket = bucketOf(
      clampWhole(input.newBytes, Number.MAX_SAFE_INTEGER),
      NEW_BYTES_EDGES
    )
  }
  if (input.stutter !== undefined) {
    out.stutter = {
      p50Bucket: bucketOf(clampWhole(input.stutter.p50Ms, MAX_DURATION_MS), STUTTER_MS_EDGES),
      p95Bucket: bucketOf(clampWhole(input.stutter.p95Ms, MAX_DURATION_MS), STUTTER_MS_EDGES),
      latePct: clampWhole(input.stutter.latePct, 100)
    }
  }
  if (input.firstMbMs !== undefined) {
    out.firstMbMs = clampWhole(input.firstMbMs, MAX_DURATION_MS)
  }
  return out
}

/** A whole number in `[0, max]`. Non-finite reads as 0 — the producer's numbers come from timers
 *  and a `stat()`, both of which can hand over a NaN on a bad day. */
function clampWhole(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(Math.round(value), max))
}
