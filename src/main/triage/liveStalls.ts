// ============================================================================
// liveStalls.ts — the Live section of the Analytics tab (JOS-367).
// ============================================================================
//
// Its own file for `machineClass.ts`'s reason: `./analytics.ts` is at the repo's 400-code-line
// ceiling and a section is the natural unit to split off. The cut follows a real seam — every
// other section there reads what people DO, `machineClass` reads what they do it on, and this one
// reads HOW IT WENT while they did.
//
// WHAT A READER IS SUPPOSED TO TAKE FROM IT, because a stall table with no thesis is just numbers:
// `latePerReport` and `machinePerReport` are the same rate over the same interval, and comparing
// them IS the section. Late moments that the second clock also saw are the MACHINE — paging, a
// driver reset, a disk that stopped answering — and the app was a victim beside the game. Late
// moments only main saw are OURS. The two lead to opposite work, and until this shipped there was
// no number in the fleet that could tell them apart.
//
// PURE, like the file it came from: plain rows in, labelled rows out, so `usageAnalytics.test.mts`
// can author a fleet by hand and assert the labels. The LABELS are made here rather than in the
// panel or the digest, for this directory's standing reason: the edges live in the schema, and
// `liveStallP95 4` is not something a reader can act on.

import { bucketRange, LOG_SIZE_BYTES_EDGES, NEW_BYTES_EDGES } from '../../shared/telemetry'
import {
  FREE_MEM_GB_EDGES,
  LIVE_STALL_MS_EDGES,
  WORKING_SET_MB_EDGES
} from '../../shared/telemetryLive'
import { percentileBucket, USAGE_METRICS } from '../../shared/telemetryRollup'
import type { TriageAnalyticsLive, TriageMixRow } from '../../shared/triage'
import { bucketCounts, dimsOf, mixRows, ratio, sumOf, type UsageRow } from './usageRows'

/** A stall ladder index as the span it means: `< 10 ms`, `100 ms - 250 ms`, `≥ 2.5 s`. */
export function stallMsLabel(i: number): string {
  const { lo, hi } = bucketRange(LIVE_STALL_MS_EDGES, Number.isInteger(i) ? i : 0)
  const ms = (n: number): string => (n >= 1_000 ? `${String(n / 1_000)} s` : `${String(n)} ms`)
  return hi === null ? `≥ ${ms(lo)}` : i === 0 ? `< ${ms(hi)}` : `${ms(lo)} - ${ms(hi)}`
}

/** A byte ladder index as the span it means. KB below a megabyte, for `analytics.ts`'s reason:
 *  the delta ladder starts at 64 KB and `0 MB-0 MB` says nothing at all. */
function byteLabel(edges: readonly number[], i: number): string {
  const { lo, hi } = bucketRange(edges, Number.isInteger(i) ? i : 0)
  const size = (b: number): string =>
    b >= 1_048_576 ? `${String(Math.round(b / 1_048_576))} MB` : `${String(Math.round(b / 1024))} KB`
  return hi === null ? `≥ ${size(lo)}` : i === 0 ? `< ${size(hi)}` : `${size(lo)}-${size(hi)}`
}

/** A percentile of one histogram as its bucket's own RANGE, or null when nothing was measured —
 *  the storage threw that precision away on purpose, so nothing here invents a number inside a
 *  bucket. `analytics.ts bucketLabelAt`, restated rather than imported: that file is at its
 *  ceiling and this is three lines. */
function labelAt(counts: readonly number[], p: number, label: (i: number) => string): string | null {
  const i = percentileBucket(counts, p)
  return i < 0 ? null : label(i)
}

/** One ladder's rows in LADDER ORDER — a distribution sorted by count has lost the only thing it
 *  had to say (`machineClass.ts`'s rule, for its reason). */
function ladder(
  usage: readonly UsageRow[],
  metric: string,
  label: (i: number) => string
): TriageMixRow[] {
  return [...dimsOf(usage, metric).entries()]
    .map(([dim, n]) => ({ index: Number(dim), n }))
    .sort((a, b) => a.index - b.index)
    .map((r) => ({ id: label(r.index), n: r.n }))
}

/**
 * WHAT WAS SWITCHED ON, as one labelled list in the order a reader takes it in: the windows, then
 * the two watchers, then the memory either side of us.
 *
 * AN ABSENT METRIC CONTRIBUTES NOTHING rather than a zero row — the same distinction
 * `buildMachineClass` keeps, and for the same reason: this ships in a build most of the fleet does
 * not have, and a section full of zeros would read as "nobody locks an overlay" instead of
 * "nobody has reported one yet".
 */
function stateRows(usage: readonly UsageRow[]): TriageMixRow[] {
  const mix = (metric: string, prefix: string): TriageMixRow[] =>
    mixRows(dimsOf(usage, metric)).map((r) => ({ id: `${prefix} ${r.id}`, n: r.n }))
  return [
    ...mix(USAGE_METRICS.stateOverlaysOpen, 'overlays open'),
    ...mix(USAGE_METRICS.stateOverlaysLocked, 'overlays LOCKED'),
    ...mix(USAGE_METRICS.statePresence, 'presence'),
    ...mix(USAGE_METRICS.stateRing, 'cursor ring'),
    // The two memory ladders keep the units they are DECLARED in — gibibytes with halves, and
    // mebibytes — because `0 GB - 1 GB` would hide the rung the paging hypothesis lives on.
    ...ladder(usage, USAGE_METRICS.stateFreeMem, (i) => `free RAM ${unitLabel(i, FREE_MEM_GB_EDGES, 'GB')}`),
    ...ladder(usage, USAGE_METRICS.stateWorkingSet, (i) => `our RAM ${unitLabel(i, WORKING_SET_MB_EDGES, 'MB')}`)
  ]
}

/** A ladder index as a span in its own declared unit: `< 0.5 GB`, `1 GB - 2 GB`, `≥ 2000 MB`. */
function unitLabel(i: number, edges: readonly number[], unit: string): string {
  const { lo, hi } = bucketRange(edges, Number.isInteger(i) ? i : 0)
  const n = (v: number): string => `${String(v)} ${unit}`
  return hi === null ? `≥ ${n(lo)}` : i === 0 ? `< ${n(hi)}` : `${n(lo)} - ${n(hi)}`
}

/**
 * The whole section. Every histogram here is ITS OWN DENOMINATOR — a bucket index is never
 * non-positive, so one row per report per histogram is written unconditionally and the total is
 * the number of reports that carried the group (the argument `startupStutterP50` makes).
 */
export function buildLiveStalls(usage: readonly UsageRow[]): TriageAnalyticsLive {
  const p95 = bucketCounts(dimsOf(usage, USAGE_METRICS.liveStallP95))
  const max = bucketCounts(dimsOf(usage, USAGE_METRICS.liveStallMax))
  const tailP95 = bucketCounts(dimsOf(usage, USAGE_METRICS.tailReadP95))
  const tailMax = bucketCounts(dimsOf(usage, USAGE_METRICS.tailReadMax))
  const reports = p95.reduce((sum, n) => sum + n, 0)
  const verdicts = sumOf(usage, USAGE_METRICS.liveVerdicts)
  const over100 = sumOf(usage, USAGE_METRICS.liveOver100)
  return {
    reports,
    samples: sumOf(usage, USAGE_METRICS.liveSamples),
    p50StallLabel: labelAt(p95, 50, stallMsLabel),
    p95StallLabel: labelAt(p95, 95, stallMsLabel),
    maxStallLabel: labelAt(max, 95, stallMsLabel),
    over100,
    over500: sumOf(usage, USAGE_METRICS.liveOver500),
    latePerReport: ratio(over100, reports),
    verdicts,
    coincident: sumOf(usage, USAGE_METRICS.liveCoincident),
    machinePerReport: ratio(sumOf(usage, USAGE_METRICS.liveCoincident), verdicts),
    tailReports: tailP95.reduce((sum, n) => sum + n, 0),
    tailReads: sumOf(usage, USAGE_METRICS.tailReads),
    tailReopens: sumOf(usage, USAGE_METRICS.tailReopens),
    p95TailLabel: labelAt(tailP95, 95, stallMsLabel),
    maxTailLabel: labelAt(tailMax, 95, stallMsLabel),
    tailOver100: sumOf(usage, USAGE_METRICS.tailOver100),
    tailOver500: sumOf(usage, USAGE_METRICS.tailOver500),
    tailDeltas: ladder(usage, USAGE_METRICS.tailDeltaBytes, (i) => byteLabel(NEW_BYTES_EDGES, i)),
    tailLogSizes: ladder(usage, USAGE_METRICS.tailLogSize, (i) =>
      byteLabel(LOG_SIZE_BYTES_EDGES, i)
    ),
    state: stateRows(usage)
  }
}
