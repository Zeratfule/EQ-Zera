// ============================================================================
// smokeTelemetry.mts — the PURE half of the post-release smoke test's telemetry leg.
// ============================================================================
//
// Same split as smokeLog.mts / smokeGate.ts: everything that can be decided without a database
// or a VM lives here, so `tests/smokeFeedback.test.mts` can pin it and the script next door is
// left holding only side effects (poll, print, delete).
//
// THE LEG IT SERVES. After the feedback half passes, the host asks a different question of the
// same live stack: the installed app in the VM has an anonymous `analyticsId` — did the counts
// it sent actually arrive? Two facts answer it, and they are deliberately of different kinds:
//
//   * `analytics_install` HAS A ROW FOR THAT ID. This is the per-id proof, and it is the only
//     per-id row the whole feature creates. Its presence means a batch from THIS install passed
//     the validator, the kill switch and the daily cap, and was aggregated.
//   * `usage_daily` CARRIES A SESSION METRIC FOR TODAY. This is a population fact, not an
//     attributable one — the counters are anonymous sums with no id in them, and nothing can
//     (or should be able to) pick our contribution out of them. It is asserted anyway because
//     an install row with no counters beside it would mean the aggregate transaction is broken.
//
// AND A THIRD VERDICT, NOT A FAILURE. `telemetry_accepting` is the OWNER'S switch. With it
// closed, every batch is answered 503, no row is created, and there is nothing to find. That is
// the switch working, so the leg reports LIT-BUT-CLOSED and the run still passes — exactly the
// treatment the feedback half already gives its own kill switch.

/**
 * The `usage_daily` metrics that mean "a session happened". Any ONE of them for today is the
 * proof the aggregate write landed; which one depends on how long the VM left the app running
 * and whether it closed cleanly, and pinning a specific one would make this leg flaky for a
 * reason that has nothing to do with the pipeline.
 *
 * These are `USAGE_METRICS` members (src/shared/telemetryRollup.ts) — spelled here as data
 * rather than imported so that a metric being RENAMED is caught by the test below instead of
 * silently following the rename into a smoke test that no longer checks anything.
 */
export const SESSION_METRICS = [
  'sessions',
  'sessionEnds',
  'sessionMsTotal',
  'sessionLenBucket',
  'heartbeats',
  'activeInstalls'
] as const

/** A `usage_daily` row as the triage store hands it back (day/metric/dim/n, loosely typed). */
export interface UsageRow {
  day?: unknown
  metric?: unknown
  n?: unknown
}

/**
 * The session metric found for `day`, or null. Rows with `n <= 0` do not count: a counter that
 * exists at zero would be an aggregate write that ran and recorded nothing.
 */
export function sessionMetricFor(rows: readonly UsageRow[], day: string): string | null {
  for (const row of rows) {
    if (String(row.day) !== day) continue
    const metric = String(row.metric)
    if (!SESSION_METRICS.some((m) => m === metric)) continue
    if (Number(row.n) > 0) return metric
  }
  return null
}

/**
 * The id the guest echoed. A UUID and nothing else — it is read out of a file in a VM and then
 * used as a query parameter and as the target of a DELETE, so the shape is checked before it is
 * used rather than trusted because it came from our own harness.
 */
export const ANALYTICS_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAnalyticsId(raw: unknown): boolean {
  return typeof raw === 'string' && ANALYTICS_ID_RE.test(raw)
}

/** `feedback_config.telemetry_accepting`, read the way the Lambda reads it: CLOSED unless the
 *  column is exactly `true` (a NULL column and a missing row both mean closed). */
export function telemetryAccepting(config: { telemetry_accepting?: unknown } | null): boolean {
  return config?.telemetry_accepting === true
}

export type TelemetryLegVerdict = 'pass' | 'lit-but-closed' | 'fail'

export interface TelemetryLegFacts {
  /** The server-side kill switch, as read from `feedback_config`. */
  accepting: boolean
  /** Did `analytics_install` hold a row for the guest's id before the timeout? */
  installRow: boolean
  /** A session metric for today in `usage_daily`, or null. */
  sessionMetric: string | null
}

/**
 * THE THREE-WAY VERDICT, as a function of three facts.
 *
 * The switch is checked FIRST and short-circuits: with intake closed there is no row to find,
 * so "no row" is not evidence of anything and must not be reported as a failure. Flipping that
 * switch is the owner's decision, never the smoke test's.
 */
export function telemetryLegVerdict(facts: TelemetryLegFacts): TelemetryLegVerdict {
  if (!facts.accepting) return 'lit-but-closed'
  return facts.installRow && facts.sessionMetric !== null ? 'pass' : 'fail'
}
