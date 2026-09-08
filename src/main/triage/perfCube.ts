// ============================================================================
// perfCube.ts — the "Stalls by …" section of the Analytics tab (JOS-372).
// ============================================================================
//
// Its own file for `liveStalls.ts`'s reason, one ticket later: `./analytics.ts` is at the repo's
// 400-code-line ceiling and a section is the natural unit to split off. The cut follows the same
// seam the other two do — `machineClass.ts` reads what people run this on, `liveStalls.ts` reads
// how it went, and this one CROSSES the two.
//
// WHAT A READER IS SUPPOSED TO TAKE FROM IT. The Live section already says how often the fleet's
// sessions stalled. This says WHERE, and the three slices are chosen because each one leads
// somewhere different:
//
//   * BY EQ WINDOW MODE — how the game presents itself is the other half of every z-order stall
//     over it, so "the game froze when the overlay appeared" is worth reading separately for a
//     fullscreen install and a windowed one. (`fullscreen` is the game's own Fullscreen setting,
//     which on the current client is a BORDERLESS window rather than an exclusive display mode —
//     JOS-375. If the rate is flat across the two, that hypothesis is dead too.)
//   * BY MACHINE CLASS — a small box under a game, a browser and this app pages, and paging is
//     the leading candidate for a whole-system stall. If the rate is flat across classes, that
//     hypothesis is dead and the next one is ours.
//   * BY LOCKED OVERLAY — a locked (click-through) overlay means the process-wide WH_MOUSE_LL
//     hook is armed, so every system mouse event waits on our message loop. A stall population
//     living entirely at `locked on` is the single most actionable reading this pipeline can
//     produce, and it is the one this whole cube was built to be able to see.
//
// EVERY SLICE CARRIES ITS OWN DENOMINATOR, and nothing here sums two slices of different lists:
// they are the same reports cut three ways, so adding across lists counts every report twice.
//
// PURE, like the two files beside it: plain rows in, labelled rows out, so
// `tests/usagePerfCube.test.mts` can author a fleet by hand and assert the arithmetic.

import { LIVE_STALL_MS_EDGES } from '../../shared/telemetryLive'
import type { TriageAnalyticsPerf, TriagePerfSlice } from '../../shared/triage'
import { ratio, type PerfRow } from './usageRows'

/**
 * WHAT COUNTS AS A HEAVY STALL: a worst tick at or past the 500 ms rung of `LIVE_STALL_MS_EDGES`
 * ([10, 25, 50, 100, 250, 500, 1000, 2500] ⇒ bucket 6 is `500 ms - 1 s`).
 *
 * FIVE HUNDRED MILLISECONDS, and it is the field reports' own number rather than a taste: the
 * freezes this fleet describes are "about a second", and 500 ms is the last rung below that which
 * nobody could mistake for an ordinary hitch. It is DERIVED from the ladder rather than written
 * down as a millisecond figure, so an edge change moves the threshold with it instead of silently
 * re-labelling the row.
 */
const HEAVY_MS = 500
const HEAVY_BUCKET = LIVE_STALL_MS_EDGES.indexOf(HEAVY_MS) + 1

/** The threshold in words, carried in the shape so no surface hardcodes the figure. */
export const HEAVY_STALL_LABEL = `≥ ${String(HEAVY_MS)} ms`

/** `on` / `off` / `-` as something a reader can act on. The labels are made HERE rather than in
 *  the panel or the digest, for this directory's standing reason: both surfaces render the same
 *  list, so neither can invent its own vocabulary. */
function lockedLabel(dim: string): string {
  if (dim === 'on') return 'overlay LOCKED'
  return dim === 'off' ? 'none locked' : 'not stated'
}

/**
 * One dimension's slices: reports and heavy stalls per value, biggest population first.
 *
 * SORTED BY REPORTS, NOT BY RATE, and that is the honest order: a two-report slice at 100% would
 * otherwise head every list and read as a finding. The rate is right there in the row for a reader
 * to compare; the ORDER says how much of the fleet each row speaks for. Ties break on the label so
 * the output is deterministic (`mixRows`'s rule).
 */
function sliceBy(rows: readonly PerfRow[], dim: (r: PerfRow) => string): TriagePerfSlice[] {
  const reports = new Map<string, number>()
  const stalls = new Map<string, number>()
  for (const r of rows) {
    const key = dim(r)
    reports.set(key, (reports.get(key) ?? 0) + r.n)
    if (r.stallBucket >= HEAVY_BUCKET) stalls.set(key, (stalls.get(key) ?? 0) + r.n)
  }
  return [...reports.entries()]
    .map(([id, n]) => ({ id, reports: n, stalls: stalls.get(id) ?? 0, rate: ratio(stalls.get(id) ?? 0, n) }))
    .sort((a, b) => b.reports - a.reports || a.id.localeCompare(b.id))
}

/**
 * The whole section. An empty cube renders as zeros, an empty list and a null rate — the state of
 * a stack whose ingest has not been deployed yet, and of every window before the day this shipped
 * (there is no backfill: the pipeline keeps no raw events to re-fold).
 */
export function buildPerfCube(rows: readonly PerfRow[]): TriageAnalyticsPerf {
  const reports = rows.reduce((sum, r) => sum + r.n, 0)
  const stalls = rows.reduce((sum, r) => (r.stallBucket >= HEAVY_BUCKET ? sum + r.n : sum), 0)
  return {
    reports,
    stalls,
    rate: ratio(stalls, reports),
    stallLabel: HEAVY_STALL_LABEL,
    byWindowMode: sliceBy(rows, (r) => r.windowMode),
    byMachineClass: sliceBy(rows, (r) => r.machineClass),
    byLocked: sliceBy(rows, (r) => lockedLabel(r.locked))
  }
}
