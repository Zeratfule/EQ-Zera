// ============================================================================
// log/tailIoStats.ts — what the LIVE TAIL's file I/O actually cost (JOS-363).
// ============================================================================
//
// WHY THIS EXISTS AT ALL, AND WHY IT SHIPS WITH THE FIX RATHER THAN AFTER IT. The tail's read
// path was changed on a THEORY — that a `CreateFile` per read on a hundreds-of-MB file the game
// holds open, plus one uncapped read of the whole delta, is what stalls EverQuest's synchronous
// append from its render thread. AGENTS.md "The fold checkpoint, and why there isn't one" is the
// standing reminder of what happens when a performance story is believed instead of measured: the
// cold-read stall did not survive its own instrumentation, and a whole feature was built on it.
// So the tail now carries its own instrument, and every claim about it — before or after — is a
// reading off this module rather than an argument.
//
// PLAIN DATA, NO TELEMETRY. Nothing here transmits, formats for a wire, or knows the user's
// switch exists. It is numbers in memory with two readers:
//   * `takeTailIoSummary()` — fold + RESET, for an interval reporter (the heartbeat rider is a
//     separate ticket). Today its only caller is the session-end log line, so "the interval" is
//     the session; the day something drains it every heartbeat, the interval becomes that.
//   * `peekTailIoTimeline()` — the last `TAIL_IO_RING` samples, unreset, for an attachment that
//     wants the SHAPE of the reads rather than their fold (a p95 is computed from here, not
//     stored: a percentile folded out of a reset accumulator is a percentile of nothing).
//
// IT IMPORTS NOTHING, for `telemetry/health.ts`'s reason — a recorder called from the hot read
// path must be a plain integer add that cannot itself throw, and a leaf module cannot join an
// import cycle no matter who imports it.

/**
 * WHY THE HANDLE WAS OPENED — the whole point of the seam, because "steady-state tailing opens
 * nothing" is the claim the fix makes and this field is what can falsify it.
 *
 *   `reused`   — no open happened; the persistent handle answered. THE STEADY STATE.
 *   `first`    — the tail's first read of this file, or the first after a failure dropped it.
 *   `replaced` — the path vanished and came back (chokidar `unlink` → `add`): an open handle
 *                follows the OLD file, so the tail must re-open by NAME to see the new one.
 *   `shrunk`   — the file got smaller than our offset (truncate/rotate).
 *   `error`    — a `stat`/`read` on the handle failed; the handle is suspect and gets replaced.
 */
export type TailReopenReason = 'reused' | 'first' | 'replaced' | 'shrunk' | 'error'

/** One read cycle — one chokidar wake, however many slices it took to catch up. */
export interface TailIoSample {
  /** Wall clock at the end of the cycle (`Date.now()`), so a timeline can be read against a log. */
  at: number
  /** `fh.stat()` — the size probe, on the OPEN HANDLE (no name lookup, no share negotiation). */
  statMs: number
  /** `open()` — 0 whenever `reason` is `reused`, which is what makes the claim checkable. */
  openMs: number
  /** Every slice read in this cycle, summed. The number EQ's append is competing with. */
  readMs: number
  /** Bytes read in this cycle (the delta). */
  bytes: number
  /** How many bounded slices the delta took. 0 when the file had not grown. */
  slices: number
  reason: TailReopenReason
}

/** The fold of a run of samples. Counts and totals only — see the module note on percentiles. */
export interface TailIoSummary {
  /** Read cycles recorded. `takeTailIoSummary()` answers `null` rather than a zero row of these. */
  reads: number
  /** Cycles that opened a handle — i.e. `reason !== 'reused'`. THE NUMBER THE FIX IS ABOUT. */
  reopens: number
  bytes: number
  slices: number
  statMs: number
  openMs: number
  readMs: number
  maxReadMs: number
  maxStatMs: number
  /** Cycles whose read leg exceeded 100 ms / 500 ms — a frame's worth, and a visible hitch. */
  over100: number
  over500: number
  /** Reopens by cause, so a high `reopens` can be read as "rotating" vs "failing". */
  byReason: Record<TailReopenReason, number>
}

/** ~10 minutes of samples at the tail's busiest observed cadence (~1/s in combat). */
export const TAIL_IO_RING = 600

const ring: TailIoSample[] = []
let acc: TailIoSummary = zero()

function zero(): TailIoSummary {
  return {
    reads: 0,
    reopens: 0,
    bytes: 0,
    slices: 0,
    statMs: 0,
    openMs: 0,
    readMs: 0,
    maxReadMs: 0,
    maxStatMs: 0,
    over100: 0,
    over500: 0,
    byReason: { reused: 0, first: 0, replaced: 0, shrunk: 0, error: 0 }
  }
}

/** Milliseconds, to the microsecond. Raw `performance.now()` deltas carry a dozen meaningless
 *  digits into every log line and every JSON attachment; the instrument's real resolution is
 *  nowhere near that. Non-finite input records as 0 rather than poisoning a total with NaN. */
function ms(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0
}

/**
 * Record one completed read cycle. Called from `Tailer.readNew`'s `finally`, so a cycle that
 * THREW is still recorded — a failed read is exactly the kind this instrument exists to catch,
 * and dropping it would make the numbers look better the worse things got.
 */
export function noteTailRead(sample: TailIoSample): void {
  const s: TailIoSample = {
    at: sample.at,
    statMs: ms(sample.statMs),
    openMs: ms(sample.openMs),
    readMs: ms(sample.readMs),
    bytes: Math.max(0, Math.trunc(sample.bytes)),
    slices: Math.max(0, Math.trunc(sample.slices)),
    reason: sample.reason
  }
  ring.push(s)
  if (ring.length > TAIL_IO_RING) ring.splice(0, ring.length - TAIL_IO_RING)

  acc.reads++
  if (s.reason !== 'reused') acc.reopens++
  acc.byReason[s.reason]++
  acc.bytes += s.bytes
  acc.slices += s.slices
  acc.statMs = ms(acc.statMs + s.statMs)
  acc.openMs = ms(acc.openMs + s.openMs)
  acc.readMs = ms(acc.readMs + s.readMs)
  if (s.readMs > acc.maxReadMs) acc.maxReadMs = s.readMs
  if (s.statMs > acc.maxStatMs) acc.maxStatMs = s.statMs
  if (s.readMs > 100) acc.over100++
  if (s.readMs > 500) acc.over500++
}

/**
 * Fold the accumulated counters and RESET them — `takeHealth()`'s pending-delta discipline, for
 * the same no-double-counting reason.
 *
 * `null` when nothing was read, and that is not the same as a row of zeros: a session where the
 * player never typed `/log on` has no tail I/O to describe, and a zero row from it would drag
 * every fleet-wide average toward a machine that never tailed anything.
 */
export function takeTailIoSummary(): TailIoSummary | null {
  if (acc.reads === 0) return null
  const taken = acc
  acc = zero()
  return taken
}

/** The ring, oldest first. NOT drained by `takeTailIoSummary` — the fold and the shape are two
 *  different questions, and a reader of one must not silently consume the other. */
export function peekTailIoTimeline(): readonly TailIoSample[] {
  return ring.slice()
}

/** Drop everything. For tests, and for a bench that wants two arms measured apart. */
export function resetTailIoStats(): void {
  ring.length = 0
  acc = zero()
}

/**
 * One human line for the session-end log. Deliberately not JSON: the reader is the owner grepping
 * dev stdout, and the numbers that matter are `reopens` (the claim) and the read tail (the cost).
 */
export function formatTailIoSummary(s: TailIoSummary): string {
  const mib = (s.bytes / (1024 * 1024)).toFixed(2)
  const causes = (Object.keys(s.byReason) as TailReopenReason[])
    .filter((r) => r !== 'reused' && s.byReason[r] > 0)
    .map((r) => `${r}=${String(s.byReason[r])}`)
    .join(' ')
  return [
    `reads=${String(s.reads)}`,
    `reopens=${String(s.reopens)}${causes ? ` (${causes})` : ''}`,
    `slices=${String(s.slices)}`,
    `bytes=${mib}MiB`,
    `readMs total=${s.readMs.toFixed(1)} max=${s.maxReadMs.toFixed(1)}`,
    `statMs total=${s.statMs.toFixed(1)} max=${s.maxStatMs.toFixed(1)}`,
    `openMs total=${s.openMs.toFixed(1)}`,
    `over100=${String(s.over100)} over500=${String(s.over500)}`
  ].join(' · ')
}
