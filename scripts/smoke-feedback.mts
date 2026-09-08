// ============================================================================
// smoke-feedback.mts — the HOST half of the post-release end-to-end smoke test.
// ============================================================================
//
//   node --import tsx scripts/smoke-feedback.mts gen-log          --nonce <n> --out <path>
//   node --import tsx scripts/smoke-feedback.mts verify           --nonce <n> [--profile eqc]
//   node --import tsx scripts/smoke-feedback.mts verify-telemetry --analytics-id <uuid>
//
// ON-DEMAND ONLY. Not in CI, not in `npm test`, not in `test:e2e`. It talks to the LIVE cloud
// and it DELETES the rows it made; run it deliberately, after a release, through
// `npm run smoke:release` (scripts/sandbox/run-smoke-feedback.ps1), which is what generates the
// nonce and drives the VM that produces the report this verifies.
//
// TWO COMMANDS, one per half of the handshake:
//
//   gen-log  Render the booby-trapped mocked log (scripts/smokeLog.mts) that the guest plants
//            at EverQuest's discovery path. The synthesis is HERE, on a machine that has Node,
//            because the sandbox has neither Node nor tsx and a second PowerShell copy of the
//            generator would be a second thing to keep honest.
//
//   verify   Poll the live backlog through `src/main/triage/store.ts` — the SAME code the
//            triage CLI and the dev-only triage tab read with, over the same IAM door, with no
//            server-side read API in between — until the report shows up, then prove four
//            things and clean up after itself:
//              1. the row exists, with an env block that looks like a real Windows install;
//              2. the slice UPGRADES to `present` (rows.ts `toDetail`'s HeadObject — the same
//                 tri-state the detail pane renders, so this asserts the shipped reading of
//                 "the upload landed", not a bespoke one);
//              3. the downloaded, gunzipped slice CONTAINS the nonce (real content travelled);
//              4. …and does NOT contain CHAT_MARKER (the scrub ran on the real path).
//
// CLEANUP IS UNCONDITIONAL ON SUCCESS and skipped on failure. A smoke run must not pollute the
// backlog a human triages — so a passing run ends with `forget` (delete the S3 object + stamp
// `redacted_at`) followed by the equivalent of `wipe --install <installId>`, which is the same
// pair of store calls `scripts/triage-feedback.mts` makes for a deletion request. A FAILING run
// leaves everything exactly where it is, because the row and the object are the evidence.
//
//   verify-telemetry
//            The USAGE ANALYTICS leg, run after the feedback checks pass. The guest echoes the
//            installed app's anonymous `analyticsId` (out of the prod settings file in the VM's
//            userData); this command polls the same live cluster for that id's
//            `analytics_install` row and for a session counter in `usage_daily` for today —
//            through the same store.ts readers — and then WIPES the row with the shipped
//            `analytics wipe --id` path. The counters it contributed to are anonymous sums with
//            no id in them and are deliberately left alone; nothing can attribute them and
//            nothing can unpick them.
//
//            THREE VERDICTS, not two (scripts/smokeTelemetry.mts owns the decision): with
//            `telemetry_accepting` CLOSED there is no row to find and the leg reports
//            LIT-BUT-CLOSED rather than failing. That switch is the owner's, not the smoke
//            test's, and this command never touches it.
//
// THE KILL SWITCH IS NOT A FAILURE. If the server answered `closed`, no row was ever created
// and there is nothing here to find; the HOST script detects that from the guest's own outcome
// line and never reaches this command. See run-smoke-feedback.ps1.

import { parseArgs } from 'node:util'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { CHAT_MARKER, synthesizeSmokeLog } from './smokeLog.mjs'
import {
  isAnalyticsId,
  sessionMetricFor,
  telemetryAccepting,
  telemetryLegVerdict,
  type TelemetryLegVerdict,
} from './smokeTelemetry.mjs'
import { parseEnv, toDetail } from '../src/main/triage/rows'
import {
  deleteAnalyticsInstall,
  deleteReportRow,
  deleteSlice,
  downloadSlice,
  getFeedbackConfig,
  listReports,
  loadStack,
  logKeyOf,
  logObjectExists,
  makeClients,
  readAnalyticsInstall,
  readUsageDaily,
  reportsForInstall,
  stampRedacted,
  type Clients,
  type Row,
} from '../src/main/triage/store'
import { APP_VERSION_RE } from '../src/shared/feedback'
import { utcDay } from '../src/shared/telemetryRollup'

const OPTIONS = {
  nonce: { type: 'string' },
  out: { type: 'string' },
  profile: { type: 'string' },
  'analytics-id': { type: 'string' },
  'since-ms': { type: 'string' },
  'timeout-sec': { type: 'string' },
  'no-cleanup': { type: 'boolean' },
} as const

/** How long to wait for the report to appear AND its slice to land. */
const DEFAULT_TIMEOUT_SEC = 600
/** Between polls. The ingest path is a Lambda + a presigned POST; seconds, not milliseconds. */
const POLL_INTERVAL_MS = 10_000

const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)

// ---- the verdict ---------------------------------------------------------------------

let failed = false

/** The installer harness's shape, deliberately: one grep reads both halves of the run. */
function check(name: string, ok: boolean, detail = ''): boolean {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`.trimEnd())
  if (!ok) failed = true
  return ok
}

function note(message: string): void {
  console.log(message)
}

// ---- gen-log -------------------------------------------------------------------------

function cmdGenLog(args: Record<string, string | boolean | undefined>): void {
  const nonce = text(args.nonce)
  const out = text(args.out)
  if (!nonce) throw new Error('gen-log: --nonce <value> is required')
  if (!out) throw new Error('gen-log: --out <path> is required')
  mkdirSync(dirname(out), { recursive: true })
  const log = synthesizeSmokeLog({ nonce, nowMs: Date.now() })
  writeFileSync(out, log, 'utf8')
  note(`wrote ${out} (${String(log.split('\n').length - 1)} lines, nonce ${nonce})`)
}

// ---- verify: find the row -------------------------------------------------------------

/**
 * Poll the backlog for the newest report whose description carries the nonce.
 *
 * `channel: 'all'` because which channel a released installer reports on is a fact about the
 * build, not something this script should assume — the env assertions below print it. The
 * `sinceMs` floor keeps the statement on the indexed path (report_by_channel).
 */
async function findReport(
  c: Clients,
  nonce: string,
  sinceMs: number,
  deadline: number
): Promise<Row | null> {
  for (;;) {
    const rows = await listReports(c, { channel: 'all', sinceMs, limit: 100 })
    const hit = rows.find((r) => text(r.description).includes(nonce))
    if (hit) return hit
    if (Date.now() >= deadline) return null
    await sleep(POLL_INTERVAL_MS)
  }
}

/** Poll HeadObject until the presigned upload has landed, or the clock runs out. */
async function waitForSlice(c: Clients, key: string, deadline: number): Promise<boolean> {
  for (;;) {
    if (await logObjectExists(c, key)) return true
    if (Date.now() >= deadline) return false
    await sleep(POLL_INTERVAL_MS)
  }
}

// ---- verify: the assertions -----------------------------------------------------------

/**
 * "A sane env block": what main assembles about ITSELF (feedback/submit.ts `feedbackEnv`),
 * arriving intact through the Lambda's validator and back out of the row's `env_json`. Pinned
 * loosely on purpose — the point is that a REAL packaged Windows build filled it in, not that
 * it matches a version this script would have to be edited to keep up with.
 */
function envField(env: Record<string, string>, key: string): string {
  // The index signature types every read as `string`; a MISSING key is really `undefined`,
  // and this is the one place that has to say so out loud.
  const value: string | undefined = env[key]
  return value ?? ''
}

function checkEnv(row: Row): void {
  const env = parseEnv(row.env_json)
  const version = envField(env, 'appVersion')
  const platform = envField(env, 'platform')
  const channel = envField(env, 'channel')
  check('env-appVersion-semver', APP_VERSION_RE.test(version), `(appVersion='${version}')`)
  check('env-platform-win32', platform === 'win32', `(platform='${platform}')`)
  check('env-channel-present', channel === 'prod' || channel === 'dev', `(channel='${channel}')`)
  for (const key of ['electron', 'chrome', 'node', 'osRelease', 'arch']) {
    const value = envField(env, key)
    check(`env-${key}-present`, value.length > 0, `('${value}')`)
  }
}

/**
 * The scrub proof, on the bytes that actually made the round trip. The nonce rode in on every
 * COMBAT line, CHAT_MARKER on every chat line and nothing else — so "nonce in, marker out" is
 * exactly "the keep list kept and the drop list dropped", asserted against S3's copy rather
 * than against a function call.
 */
function checkSliceText(slicePath: string, nonce: string): void {
  const body = readFileSync(slicePath, 'utf8')
  const lines = body.split('\n').filter((l) => l.length > 0)
  note(`slice: ${slicePath} (${String(lines.length)} lines)`)
  check(
    'slice-carries-nonce',
    body.includes(nonce),
    `(combat lines with '${nonce}' survived the scrub)`
  )
  check(
    'slice-scrubbed-chat',
    !body.includes(CHAT_MARKER),
    `(no '${CHAT_MARKER}' anywhere in the uploaded slice)`
  )
}

// ---- verify: cleanup ------------------------------------------------------------------

/**
 * `forget` then `wipe --install`, exactly as `scripts/triage-feedback.mts` performs them —
 * same store calls, same order — so a smoke run leaves the backlog as it found it.
 *
 * The full-table read `reportsForInstall` does is the documented cost of `wipe` (there is
 * deliberately no index on install_id); it is bounded here by an install id that has filed
 * exactly one report in its life.
 */
async function cleanup(
  c: Clients,
  ids: { reportId: string; installId: string; logKey: string },
  slicePath: string
): Promise<void> {
  await deleteSlice(c, ids.logKey)
  await stampRedacted(c, ids.reportId)
  note(`cleanup: forgot ${ids.reportId} (deleted ${ids.logKey})`)
  const rows = ids.installId ? await reportsForInstall(c, ids.installId) : []
  for (const row of rows) {
    const k = logKeyOf(row)
    if (k) await deleteSlice(c, k)
    await deleteReportRow(c, text(row.report_id))
  }
  note(`cleanup: wiped ${String(rows.length)} report(s) for install ${ids.installId}`)
  // The gunzipped copy in .triage/slices/ is gitignored twice over, but it holds the marker
  // text this run planted — there is no reason for it to outlive the verdict.
  rmSync(slicePath, { force: true })
}

// ---- verify --------------------------------------------------------------------------

interface VerifyOpts {
  nonce: string
  sinceMs: number
  deadline: number
  cleanupOnPass: boolean
}

async function runVerify(c: Clients, opts: VerifyOpts): Promise<void> {
  note(`looking for a report whose description contains '${opts.nonce}'...`)
  const row = await findReport(c, opts.nonce, opts.sinceMs, opts.deadline)
  check('report-row-found', row !== null, row === null ? '(nothing matched before the timeout)' : '')
  if (row === null) return

  const reportId = text(row.report_id)
  const installId = text(row.install_id)
  note(`report ${reportId} (install ${installId}) received ${String(row.received_at)}`)
  checkEnv(row)

  const logKey = logKeyOf(row)
  check('report-declares-slice', logKey !== null, logKey ?? '(no log_key on the row)')
  if (logKey === null) return

  const landed = await waitForSlice(c, logKey, opts.deadline)
  const detail = toDetail(row, landed)
  check('slice-status-present', detail.log === 'present', `(log='${detail.log}')`)
  if (detail.log !== 'present') return

  // RE-SCRUBBED ON READ (src/main/triage/store.ts). The smoke log is synthetic and already
  // clean, so a real run's delta is zero — asserting that here is free and turns the smoke test
  // into a check that the owner-side re-scrub agrees with the client-side one.
  const slice = await downloadSlice(c, reportId, logKey)
  const slicePath = slice.path
  check(
    'slice-rescrub-clean',
    slice.fromLegacyCache || (slice.dropped === 0 && slice.cleaned === 0),
    slice.fromLegacyCache
      ? '(cached before re-scrub-on-read; counts unknown)'
      : `(re-scrub dropped ${String(slice.dropped)}, cleaned ${String(slice.cleaned)})`,
  )
  checkSliceText(slicePath, opts.nonce)

  if (failed) {
    note('LEFT IN PLACE for inspection: the report row and its slice were NOT cleaned up.')
    return
  }
  if (!opts.cleanupOnPass) {
    note('--no-cleanup: the report row and its slice were left in the backlog.')
    return
  }
  await cleanup(c, { reportId, installId, logKey }, slicePath)
}

// ---- verify-telemetry -----------------------------------------------------------------

/** The install row appears once the first batch has been aggregated, so this polls on the same
 *  order of magnitude as the feedback half rather than tighter. */
const TELEMETRY_POLL_MS = 15_000
/**
 * Slack for the INGEST AND AGGREGATE, not for the client's flush.
 *
 * It used to be read as "two flush ticks over the guest's own dwell", which stopped being true
 * when JOS-269 took the cadence to 5 minutes. It never needed to be: the guest sits on the app for
 * a full flush tick (`sandbox/smoke-feedback.ps1 $telemetryDwellSec`) and only then hands over, so
 * by the time this poll starts the batch is already on the wire. Five minutes of waiting for a
 * Lambda and a DSQL upsert is generous and is unaffected by anything the client does.
 */
const TELEMETRY_TIMEOUT_SEC = 300

/** Poll `analytics_install` for the guest's id until it lands or the clock runs out. */
async function findInstallRow(c: Clients, id: string, deadline: number): Promise<Row | null> {
  for (;;) {
    const row = await readAnalyticsInstall(c, id)
    if (row !== null) return row
    if (Date.now() >= deadline) return null
    await sleep(TELEMETRY_POLL_MS)
  }
}

/**
 * The counters, as a POPULATION fact. `usage_daily` holds anonymous sums with no id in them, so
 * this cannot say "our events are in here" and does not pretend to — what it proves is that the
 * aggregate transaction ran today at all. The per-id proof is the install row above.
 */
async function findSessionMetric(c: Clients, day: string): Promise<string | null> {
  return sessionMetricFor(await readUsageDaily(c, day), day)
}

async function runVerifyTelemetry(
  c: Clients,
  opts: { id: string; deadline: number; cleanupOnPass: boolean }
): Promise<TelemetryLegVerdict> {
  const accepting = telemetryAccepting(await getFeedbackConfig(c))
  if (!accepting) {
    note('telemetry_accepting is CLOSED: every batch the VM sent was answered 503 by design.')
    note('That is the switch working, and flipping it is the owner\'s call, not this test\'s.')
    return telemetryLegVerdict({ accepting, installRow: false, sessionMetric: null })
  }

  const day = utcDay(Date.now())
  note(`looking for analytics_install '${opts.id}' and a session counter for ${day}...`)
  const row = await findInstallRow(c, opts.id, opts.deadline)
  check('analytics-install-row', row !== null, row === null ? '(nothing landed before the timeout)' : '')
  if (row !== null) {
    note(
      `install row: first_seen=${text(row.first_seen_day)} last_seen=${text(row.last_seen_day)}` +
        ` days=${String(row.days_seen)} version=${text(row.app_version)} channel=${text(row.channel)}`
    )
    check('analytics-install-channel-prod', text(row.channel) === 'prod', `(channel='${text(row.channel)}')`)
    check('analytics-install-version-semver', APP_VERSION_RE.test(text(row.app_version)), text(row.app_version))
  }

  const metric = await findSessionMetric(c, day)
  check('usage-daily-session-metric', metric !== null, metric === null ? `(no session counter for ${day})` : `(${metric})`)

  const verdict = telemetryLegVerdict({ accepting, installRow: row !== null, sessionMetric: metric })
  if (verdict === 'pass' && opts.cleanupOnPass) await wipeAnalytics(c, opts.id)
  else if (verdict === 'pass') note('--no-cleanup: the analytics_install row was left in place.')
  else note('LEFT IN PLACE for inspection: the analytics_install row was NOT wiped.')
  return verdict
}

/**
 * The shipped deletion path, exactly as `triage-feedback analytics wipe --id` performs it: one
 * DELETE of the one per-id row. The daily counters it contributed to STAY — they are anonymous
 * sums, nothing can attribute them, and unpicking one id's share is not possible in either
 * direction. Saying so here is the point; a smoke test that quietly deleted counters would be
 * asserting a capability the product deliberately does not have.
 */
async function wipeAnalytics(c: Clients, id: string): Promise<void> {
  const gone = await deleteAnalyticsInstall(c, id)
  note(`cleanup: wiped ${String(gone)} analytics_install row(s) for ${id}`)
  note('cleanup: the daily counters stay — they are anonymous sums with no id in them.')
}

async function cmdVerifyTelemetry(
  args: Record<string, string | boolean | undefined>
): Promise<TelemetryLegVerdict> {
  const id = text(args['analytics-id'])
  if (!isAnalyticsId(id)) {
    throw new Error('verify-telemetry: --analytics-id <uuid> is required (the guest echoes it)')
  }
  const timeoutSec = Number(text(args['timeout-sec'], String(TELEMETRY_TIMEOUT_SEC)))
  const c = makeClients(loadStack(), { profile: text(args.profile, 'eqc') })
  try {
    return await runVerifyTelemetry(c, {
      id,
      deadline: Date.now() + timeoutSec * 1000,
      cleanupOnPass: args['no-cleanup'] !== true,
    })
  } finally {
    await c.close()
  }
}

// ---- main ----------------------------------------------------------------------------

async function cmdVerify(args: Record<string, string | boolean | undefined>): Promise<void> {
  const nonce = text(args.nonce)
  if (!nonce) throw new Error('verify: --nonce <value> is required')
  const timeoutSec = Number(text(args['timeout-sec'], String(DEFAULT_TIMEOUT_SEC)))
  const sinceMs = Number(text(args['since-ms'], String(Date.now() - 30 * 60_000)))
  const profile = text(args.profile, 'eqc')
  const c = makeClients(loadStack(), { profile })
  try {
    await runVerify(c, {
      nonce,
      sinceMs,
      deadline: Date.now() + timeoutSec * 1000,
      cleanupOnPass: args['no-cleanup'] !== true,
    })
  } finally {
    // A live postgres socket holds the event loop open; without this the helper prints its
    // verdict and then hangs until DSQL's connection timeout (same reason the CLI has one).
    await c.close()
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
  })
  const command = positionals[0]
  if (command === 'gen-log') {
    cmdGenLog(values)
  } else if (command === 'verify') {
    await cmdVerify(values)
    console.log('')
    console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS')
  } else if (command === 'verify-telemetry') {
    // THE THIRD VERDICT IS NOT A FAILURE, so it gets its own line AND exit 0: the host prints
    // `LIT-BUT-CLOSED` as a distinct outcome rather than a red one the operator caused.
    const verdict = await cmdVerifyTelemetry(values)
    console.log('')
    console.log(`TELEMETRY-RESULT: ${verdict.toUpperCase()}`)
    // `failed` may already be set by a sub-check (a `dev` channel, a version that is not a
    // version) that the verdict itself does not consider — those are still failures.
    if (verdict === 'fail') failed = true
  } else {
    console.log(
      'usage: smoke-feedback.mts <gen-log|verify|verify-telemetry> [--nonce N] [--out P]' +
        ' [--analytics-id UUID] [--profile eqc]'
    )
    failed = true
  }
  process.exitCode = failed ? 1 : 0
}

await main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  console.log('RESULT: FAIL')
  process.exitCode = 1
})
