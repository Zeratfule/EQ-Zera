// ============================================================================
// machineClass.ts — the eight setupSnapshot readings that describe the BOX (JOS-364).
// ============================================================================
//
// Split out of `./analytics.ts` when this section pushed that file past the repo's 400-code-line
// ceiling — the same call `telemetryValidateBase.ts` and `telemetryDocEvents.ts` made, and a
// split rather than a widened threshold for the same reason. The cut follows a real seam: every
// other section of the Analytics tab reads what people DO, and this one reads what they do it on.
//
// PURE, like the file it came from: plain rows in, labelled rows out, so
// `tests/usageAnalytics.test.mts` can author a fleet by hand and assert the labels.
//
// THE LABELS ARE MADE HERE, not in the panel or the digest, for the reason every bucket label in
// this directory is: the edges live in the schema, and `setupCpu 4` is not something a reader can
// do anything with. Both surfaces render the same list, so neither can invent its own vocabulary.

import {
  bucketRange,
  CPU_COUNT_EDGES,
  DISPLAY_COUNT_EDGES,
  PRIMARY_SCALE_EDGES,
  TOTAL_MEM_GB_EDGES
} from '../../shared/telemetry'
import { USAGE_METRICS } from '../../shared/telemetryRollup'
import type { TriageMixRow } from '../../shared/triage'
import { dimsOf, mixRows, type UsageRow } from './usageRows'

/** The suffix a machine-class ladder's numbers are spelled with. '' for a plain count. */
type Unit = '' | ' GB' | '%'

/**
 * The eight metrics as ONE labelled list, in the order a reader takes them in: what the machine
 * is, then what it draws with, then what it draws onto, then what the game is doing.
 *
 * AN ABSENT METRIC CONTRIBUTES NOTHING, rather than a zero row. This ships in a build the whole
 * fleet does not have yet, and a section full of zeros would read as "nobody has a GPU" instead
 * of "nobody has reported one yet" — the same distinction `healthReports` exists to keep.
 */
export function buildMachineClass(usage: readonly UsageRow[]): TriageMixRow[] {
  const ladder = (metric: string, prefix: string, edges: readonly number[], unit: Unit) =>
    // A LADDER IS READ IN LADDER ORDER, not by size — these rows are a DISTRIBUTION, and sorting
    // one by count scrambles the only thing it has to say. That is the single place this section
    // departs from `mixRows`, which is right for the enum mixes below (where the biggest slice IS
    // the reading) and wrong for a histogram.
    [...dimsOf(usage, metric).entries()]
      .map(([dim, n]) => ({ index: Number(dim), n }))
      .sort((a, b) => a.index - b.index)
      .map((r) => ({ id: `${prefix} ${bucketLabel(edges, r.index, unit)}`, n: r.n }))
  const mix = (metric: string, prefix: string) =>
    mixRows(dimsOf(usage, metric)).map((r) => ({ id: `${prefix} ${r.id}`, n: r.n }))
  return [
    ...ladder(USAGE_METRICS.setupCpu, 'cpus', CPU_COUNT_EDGES, ''),
    ...ladder(USAGE_METRICS.setupMem, 'RAM', TOTAL_MEM_GB_EDGES, ' GB'),
    ...mix(USAGE_METRICS.setupGpuVendor, 'gpu'),
    ...mix(USAGE_METRICS.setupCompositing, 'compositing'),
    ...mix(USAGE_METRICS.setupSafeMode, 'safe mode'),
    ...ladder(USAGE_METRICS.setupDisplays, 'displays', DISPLAY_COUNT_EDGES, ''),
    ...ladder(USAGE_METRICS.setupScale, 'scale', PRIMARY_SCALE_EDGES, '%'),
    ...mix(USAGE_METRICS.setupEqWindowMode, 'EQ')
  ]
}

/**
 * A bucket index as the span it means: `8 - 11`, `≥ 24`, `< 100%`, `16 GB - 24 GB`.
 *
 * COUNTS PRINT AN INCLUSIVE INTEGER SPAN and the two measured ladders print the half-open range
 * they really are — the same distinction `telemetryDoc.ts` draws, for the same reason: "8 - 12
 * cores" for a bucket that holds 8 through 11 is a lie a reader would act on.
 */
function bucketLabel(edges: readonly number[], i: number, unit: Unit): string {
  const { lo, hi } = bucketRange(edges, Number.isInteger(i) ? i : 0)
  const n = (v: number): string => `${String(v)}${unit}`
  if (hi === null) return `≥ ${n(lo)}`
  if (unit !== '') return i === 0 ? `< ${n(hi)}` : `${n(lo)} - ${n(hi)}`
  return hi - lo === 1 ? n(lo) : `${n(lo)} - ${String(hi - 1)}`
}
