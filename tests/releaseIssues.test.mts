// ============================================================================
// releaseIssues.test.mts — TOP ISSUES BY VERSION, the readout half of JOS-100.
// ============================================================================
//
// `tests/releaseHealth.test.mts` (JOS-96) covers the error RATE per build: how much, normalized,
// and the not-reporting / true-zero distinction the whole section rests on. This covers the half
// a rate cannot be — WHICH issues, out of `error_report`, with one exemplar each.
//
// A SEPARATE FILE for the reason its sibling's own header gives for existing: both together are
// past the repo's 400-code-line ceiling, and the answer to that here is a split rather than a
// widened threshold. The seam is real — nothing below reads a counter row for anything except
// establishing which builds exist.
//
// THE THREE THINGS THAT COULD GO WRONG, and each has a test:
//   1. THE FOLD. `error_report` is keyed per DAY, so one long-lived issue is several rows.
//      Counts must add, the seen-span must widen, and the FIRST exemplar must win — the same
//      rule the ingest UPSERT applies within a day, extended across them, so what a reader sees
//      does not change as later days accumulate.
//   2. ATTRIBUTION. An issue belongs to the build it was reported from. A panel that showed a
//      previous release's crashes against the new one would be worse than no panel at all.
//   3. THE MISSING EXAMPLE. A count with no exemplar is still a fact and must still be listed;
//      an exemplar that is no longer schema-legal must be REFUSED rather than rendered.
//
// Pure over hand-authored rows, like its sibling: no AWS, no Electron, no fixtures, no clock.
// This suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAnalytics } from '../src/main/triage/analytics'
import { addDays, type ErrorIssueRow, type UsageRow } from '../src/main/triage/usageRows'
import { USAGE_METRICS } from '../src/shared/telemetryRollup'

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0)
const TODAY = '2026-08-10'
const day = (back: number): string => addDays(TODAY, -back)

const u = (d: string, metric: string, dim: string, n: number): UsageRow => ({
  day: d,
  cohort: 'user',
  metric,
  dim,
  n
})

const buildWith = (o: { usage?: UsageRow[]; issues?: ErrorIssueRow[] }) =>
  buildAnalytics({
    usage: o.usage ?? [],
    funnels: [],
    installs: [],
    issues: o.issues ?? [],
    windowDays: 30,
    nowMs: NOW
  })

/** One stored `error_report` row, as the reader maps it. `exemplar` is the raw column text. */
const issue = (o: {
  day?: string
  version?: string
  fingerprint?: string
  n?: number
  exemplar?: unknown
}): ErrorIssueRow => ({
  day: o.day ?? TODAY,
  cohort: 'user',
  version: o.version ?? '0.11.0',
  fingerprint: o.fingerprint ?? '0123456789abcdef',
  n: o.n ?? 1,
  exemplar: o.exemplar === undefined ? '' : JSON.stringify(o.exemplar)
})

/** A valid stored exemplar — it has to BE valid, because the reader re-validates on the way out. */
const exemplarOf = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  t: 'errorReport',
  errorName: 'TypeError',
  redactedMessage: 'x is not a function',
  frames: [{ file: 'out/main/pipeline.js', line: 120, col: 15, func: 'foldEvent' }],
  fingerprint: '0123456789abcdef',
  breadcrumbs: [{ kind: 'damage', offsetMs: 0 }],
  view: 'combat',
  sessionAgeBucket: 2,
  mode: 'live',
  count: 1,
  ...over
})

const versionRow = (d: ReturnType<typeof buildWith>, version: string) =>
  d.releaseHealth.versions.find((x) => x.version === version)

test('TOP ISSUES: day rows fold into one issue, counts add, FIRST exemplar wins', () => {
  const d = buildWith({
    usage: [
      u(TODAY, USAGE_METRICS.version, '0.11.0', 20),
      u(TODAY, USAGE_METRICS.healthReports, '0.11.0', 20)
    ],
    issues: [
      issue({ day: day(2), n: 3, exemplar: exemplarOf({ redactedMessage: 'the first one' }) }),
      issue({ day: TODAY, n: 4, exemplar: exemplarOf({ redactedMessage: 'a later one' }) })
    ]
  })
  const v = versionRow(d, '0.11.0')
  assert.ok(v)
  assert.equal(v.topIssues.length, 1, 'one fingerprint is one issue however many days it spans')
  const [i] = v.topIssues
  assert.equal(i.count, 7, 'counts add across days')
  assert.equal(i.firstSeen, day(2))
  assert.equal(i.lastSeen, TODAY)
  // FIRST WINS across days, exactly as the ingest UPSERT's `COALESCE` does within one — so a
  // reader who looked at this issue yesterday is looking at the same example today.
  assert.equal(i.redactedMessage, 'the first one')
  assert.equal(i.exemplar?.frames[0].file, 'out/main/pipeline.js')
})

test('TOP ISSUES: ranked by count, and never mixed between builds', () => {
  const d = buildWith({
    usage: [
      u(TODAY, USAGE_METRICS.version, '0.11.0', 20),
      u(TODAY, USAGE_METRICS.version, '0.10.0', 20),
      u(TODAY, USAGE_METRICS.healthReports, '0.11.0', 20)
    ],
    issues: [
      issue({ fingerprint: 'aaaaaaaaaaaaaaaa', n: 5, exemplar: exemplarOf() }),
      issue({ fingerprint: 'bbbbbbbbbbbbbbbb', n: 99, exemplar: exemplarOf() }),
      issue({ version: '0.10.0', fingerprint: 'cccccccccccccccc', n: 400, exemplar: exemplarOf() })
    ]
  })
  assert.deepEqual(versionRow(d, '0.11.0')?.topIssues.map((i) => i.count), [99, 5], 'most frequent first')
  // The 400-count issue belongs to 0.10.0 and must not appear on 0.11.0's row.
  assert.equal(
    versionRow(d, '0.11.0')?.topIssues.some((i) => i.fingerprint === 'cccccccccccccccc'),
    false
  )
  assert.equal(versionRow(d, '0.10.0')?.topIssues[0].count, 400)
})

test('TOP ISSUES: a row whose exemplar did not survive keeps its COUNT', () => {
  // Three ways an example can be missing, and all three must still list the issue: the count is
  // the fact, and dropping the row would take the count with it.
  for (const exemplar of [undefined, { t: 'errorReport', errorName: 'nope' }, { junk: true }]) {
    const d = buildWith({
      usage: [u(TODAY, USAGE_METRICS.healthReports, '0.11.0', 5)],
      issues: [issue({ n: 42, ...(exemplar === undefined ? {} : { exemplar }) })]
    })
    const [i] = versionRow(d, '0.11.0')?.topIssues ?? []
    assert.equal(i.count, 42, JSON.stringify(exemplar))
    assert.equal(i.exemplar, null)
    // …and it SAYS the example is missing rather than rendering a blank message, which would
    // read as "the message was empty" — a different fact.
    assert.equal(i.redactedMessage, '(no example stored)')
  }
})

test('TOP ISSUES: an exemplar that is no longer schema-legal is REFUSED at the last boundary', () => {
  // The reader re-validates a stored row before a human sees it — defense in depth at the one
  // boundary after the wire and the ingest. A row an operator hand-wrote with an unredacted
  // message is exactly what that is for.
  const d = buildWith({
    usage: [u(TODAY, USAGE_METRICS.healthReports, '0.11.0', 5)],
    issues: [
      issue({
        n: 9,
        exemplar: exemplarOf({ redactedMessage: "ENOENT: open 'C:\\Users\\jmoye\\a.json'" })
      })
    ]
  })
  const [i] = versionRow(d, '0.11.0')?.topIssues ?? []
  assert.equal(i.exemplar, null, 'an unredacted message does not reach the panel')
  assert.equal(i.count, 9, 'and the count survives the refusal')
})

test('TOP ISSUES: a build with no error rows has an empty list, reporting or not', () => {
  const d = buildWith({
    usage: [
      u(TODAY, USAGE_METRICS.version, '0.11.0', 20),
      u(TODAY, USAGE_METRICS.healthReports, '0.11.0', 20),
      u(TODAY, USAGE_METRICS.version, '0.8.0', 10)
    ]
  })
  // BOTH are empty, and that is exactly why the panel must never infer "reporting" from this
  // list: the clean build and the build that cannot report look identical HERE, and are told
  // apart one field over.
  for (const version of ['0.11.0', '0.8.0']) {
    assert.deepEqual(versionRow(d, version)?.topIssues, [])
  }
  assert.equal(versionRow(d, '0.11.0')?.reporting, true)
  assert.equal(versionRow(d, '0.8.0')?.reporting, false)
})
