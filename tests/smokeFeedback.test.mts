// ============================================================================
// The post-release END-TO-END smoke test's two testable halves.
// ============================================================================
//
// The harness itself — scripts/sandbox/run-smoke-feedback.ps1 and its guest — cannot be run
// from a test: it boots a Windows Sandbox VM, downloads a published installer and files a real
// report against the live ingest API. What CAN be pinned here is everything the harness's
// verdict depends on being true, and that is what this suite does:
//
//   1. THE MOCKED LOG IS BOOBY-TRAPPED CORRECTLY. The whole smoke test reduces to two facts
//      about the slice that comes back out of S3 — it contains the nonce, it does not contain
//      CHAT_MARKER. Those facts are only meaningful if the generated log really does put the
//      nonce ONLY on keep-class lines and the marker ONLY on drop-class lines. So every
//      generated line goes through the REAL shared scrub (src/shared/logScrub.ts) and its
//      class is asserted against the kind the generator claims it is. If a line shape ever
//      drifts out of its family, this fails HERE instead of producing a green smoke run that
//      proved nothing (nonce absent) or a red one that looked like a privacy breach.
//
//   2. THE WHOLE SLICER AGREES. Beyond line-by-line classes, the synthesized file is run
//      through the app's own `buildSlice` in a temp dir — window, scrub, line cap, gzip — and
//      the GUNZIPPED bytes are asserted. That is the same code the packaged app runs in the
//      VM, so a passing test here means the only thing left for the real run to prove is the
//      network and the cloud.
//
//   3. THE HOOK'S GATE. `smokeNonce` must be armed by a non-empty env var AND must refuse
//      under E2E, because THE HARNESS NEVER SUBMITS. Pinned in both directions.
//
// No Electron, no network, no fixtures — this suite never skips. The real game log is never
// touched: the slicer runs against a synthetic file in `os.tmpdir()`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  CHAT_MARKER,
  SMOKE_LINE_COUNT,
  SMOKE_LOG_NAME,
  SMOKE_SELF,
  SMOKE_SPAN_MINUTES,
  eqStamp,
  renderSmokeLine,
  smokeLines,
  synthesizeSmokeLog
} from '../scripts/smokeLog.mjs'
import { isThirdPartyChat, scrubLines } from '../src/shared/logScrub'
import { buildSlice, lineTs } from '../src/main/feedback/slice'
import { MIN_DESCRIPTION, validateDraft } from '../src/shared/feedback'
import {
  SMOKE_ENV,
  SMOKE_RESULT_PREFIX,
  SMOKE_WINDOW_MINUTES,
  smokeDescription,
  smokeNonce,
  smokeOutcome,
  smokeResultLine
} from '../src/main/smokeGate'
import {
  SESSION_METRICS,
  isAnalyticsId,
  sessionMetricFor,
  telemetryAccepting,
  telemetryLegVerdict
} from '../scripts/smokeTelemetry.mjs'
import { USAGE_METRICS } from '../src/shared/telemetryRollup'

const NONCE = 'EQSMOKE0123456789AB'
const NOW = Date.parse('2026-08-04T19:30:00')

// ---------------------------------------------------------------------------------------
// 1. the mocked log — shape
// ---------------------------------------------------------------------------------------

test('smokeLines: 200 lines, ascending, spanning at most the declared window', () => {
  const lines = smokeLines({ nonce: NONCE, nowMs: NOW })
  assert.equal(lines.length, SMOKE_LINE_COUNT)
  for (let i = 1; i < lines.length; i++) {
    assert.ok(lines[i].ts >= lines[i - 1].ts, `line ${String(i)} went backwards in time`)
  }
  assert.equal(lines[lines.length - 1].ts, NOW, 'the LAST line must be stamped `nowMs` — the slice anchors on it')
  const spanMs = lines[lines.length - 1].ts - lines[0].ts
  assert.equal(spanMs, SMOKE_SPAN_MINUTES * 60_000)
  for (const line of lines) {
    assert.equal(line.ts % 1000, 0, 'an EQ stamp has one-second resolution; a ms component is lost on disk')
  }
  assert.ok(
    SMOKE_SPAN_MINUTES < SMOKE_WINDOW_MINUTES,
    'the log must fit inside the window the hook attaches, or the oldest lines fall out'
  )
})

test('eqStamp renders a prefix the APP\'s own timestamp reader parses', () => {
  // Not a second parser: `lineTs` is what feedback/slice.ts uses, which is what the packaged
  // app will use on this very file. A stamp it cannot read anchors the window at 0.
  for (const line of smokeLines({ nonce: NONCE, nowMs: NOW })) {
    assert.equal(lineTs(renderSmokeLine(line)), line.ts)
  }
  assert.match(eqStamp(NOW), /^\w{3} \w{3} \d{2} \d{2}:\d{2}:\d{2} \d{4}$/)
})

test('the log filename is the shape the app discovers characters by', () => {
  assert.equal(SMOKE_LOG_NAME, `eqlog_${SMOKE_SELF}_freeport.txt`)
  assert.match(SMOKE_LOG_NAME, /^eqlog_(.+?)_(.+?)\.txt$/)
})

// ---------------------------------------------------------------------------------------
// 2. the mocked log — CLASS, through the real shared scrub
// ---------------------------------------------------------------------------------------

test('every chat line is scrub-class and every combat/filler line is keep-class', () => {
  const lines = smokeLines({ nonce: NONCE, nowMs: NOW })
  let chat = 0
  let combat = 0
  for (const line of lines) {
    const rendered = renderSmokeLine(line)
    const dropped = isThirdPartyChat(rendered, { selfName: SMOKE_SELF })
    assert.equal(
      dropped,
      line.kind === 'chat',
      `${line.kind} line was classified ${dropped ? 'DROP' : 'KEEP'}: ${rendered}`
    )
    if (line.kind === 'chat') chat++
    if (line.kind === 'combat') combat++
  }
  // Both families have to be non-trivially represented or the assertions downstream are vacuous.
  assert.ok(chat >= 20, `only ${String(chat)} chat lines — a scrub failure could slip by`)
  assert.ok(combat >= 50, `only ${String(combat)} combat lines`)
})

test('the nonce rides ONLY on combat lines and the marker ONLY on chat lines', () => {
  for (const line of smokeLines({ nonce: NONCE, nowMs: NOW })) {
    const hasNonce = line.body.includes(NONCE)
    const hasMarker = line.body.includes(CHAT_MARKER)
    assert.equal(hasNonce, line.kind === 'combat', `nonce on a ${line.kind} line: ${line.body}`)
    assert.equal(hasMarker, line.kind === 'chat', `marker on a ${line.kind} line: ${line.body}`)
  }
})

test('scrubLines keeps the nonce and removes the marker outright', () => {
  const lines = smokeLines({ nonce: NONCE, nowMs: NOW })
  const rendered = lines.map(renderSmokeLine)
  const { kept, dropped } = scrubLines(rendered, { selfName: SMOKE_SELF })
  const chatCount = lines.filter((l) => l.kind === 'chat').length
  assert.equal(dropped, chatCount, 'dropped must be exactly the chat lines — no more, no fewer')
  const text = kept.join('\n')
  assert.ok(text.includes(NONCE), 'the nonce must survive: it is the proof content travelled')
  assert.ok(!text.includes(CHAT_MARKER), 'the marker must NOT survive: it is the proof the scrub ran')
})

// ---------------------------------------------------------------------------------------
// 3. the whole slicer, on the synthesized file, in a temp dir
// ---------------------------------------------------------------------------------------

test('buildSlice on the synthesized log yields a slice with the nonce and no marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-smoke-'))
  try {
    const logPath = join(dir, SMOKE_LOG_NAME)
    // `Date.now()` here rather than the fixed NOW: the slice anchors on the LAST line, so this
    // is the same arrangement the harness produces (host synthesizes at launch time).
    writeFileSync(logPath, synthesizeSmokeLog({ nonce: NONCE, nowMs: Date.now() }), 'utf8')
    const slice = await buildSlice({
      logPath,
      windowMinutes: SMOKE_WINDOW_MINUTES,
      selfName: SMOKE_SELF
    })
    assert.ok(slice !== null, 'the synthesized log must produce a slice, not null')
    assert.equal(slice.lines + slice.dropped, SMOKE_LINE_COUNT)
    assert.ok(slice.dropped > 0, 'the slice must report the chat lines it removed')
    const gunzipped = gunzipSync(slice.gz).toString('utf8')
    assert.equal(gunzipped, slice.text, 'the gz IS the gzip of the text the user can save')
    assert.ok(gunzipped.includes(NONCE))
    assert.ok(!gunzipped.includes(CHAT_MARKER))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------
// 4. the hook's gate + its report
// ---------------------------------------------------------------------------------------

test('smokeNonce: armed only by a non-empty env value', () => {
  assert.equal(smokeNonce({}, false), null)
  assert.equal(smokeNonce({ [SMOKE_ENV]: '' }, false), null)
  assert.equal(smokeNonce({ [SMOKE_ENV]: '   ' }, false), null)
  assert.equal(smokeNonce({ [SMOKE_ENV]: undefined }, false), null)
  assert.equal(smokeNonce({ [SMOKE_ENV]: NONCE }, false), NONCE)
  assert.equal(smokeNonce({ [SMOKE_ENV]: `  ${NONCE}\n` }, false), NONCE)
})

test('smokeNonce: NEVER armed under E2E — the harness never submits', () => {
  assert.equal(smokeNonce({ [SMOKE_ENV]: NONCE }, true), null)
  assert.equal(smokeNonce({ [SMOKE_ENV]: 'anything at all' }, true), null)
})

test('smokeDescription passes the SHARED validator, padded only when it must be', () => {
  const long = smokeDescription(NONCE)
  assert.equal(long, `smoke: ${NONCE}`, 'a normal nonce needs no padding')
  const short = smokeDescription('x')
  assert.equal(short.length, MIN_DESCRIPTION)
  assert.ok(short.startsWith('smoke: x'))
  for (const description of [long, short]) {
    const valid = validateDraft({ type: 'bug', description })
    assert.ok(valid.ok, `the validator rejected ${JSON.stringify(description)}`)
  }
})

test('smokeOutcome tells the four cases apart, with `closed` beating `queued`', () => {
  assert.equal(smokeOutcome({ ok: true, reportId: 'r1', logUploaded: true }), 'sent')
  assert.equal(smokeOutcome({ ok: false, error: 'closed', message: 'paused', queued: false }), 'closed')
  // A `closed` that somehow claimed to be queued is still `closed`: re-POSTing at a paused
  // endpoint is exactly what the kill switch exists to prevent.
  assert.equal(smokeOutcome({ ok: false, error: 'closed', message: 'paused', queued: true }), 'closed')
  assert.equal(smokeOutcome({ ok: false, error: 'internal', message: 'offline', queued: true }), 'queued')
  assert.equal(smokeOutcome({ ok: false, error: 'blocked', message: 'no', queued: false }), 'error')
})

// ---------------------------------------------------------------------------------------
// 5. the telemetry leg's decisions (scripts/smokeTelemetry.mts)
// ---------------------------------------------------------------------------------------
//
// The leg itself needs a VM and a live cluster. What is pinnable is the part that decides what
// the run MEANS — which metrics count as proof, what shape an id must have before it is used as
// a query parameter, and above all that a CLOSED kill switch is reported as its own outcome
// rather than as a failure. That last one is why these are functions and not `if`s in a script.

test('SESSION_METRICS are real usage_daily metric names, not hopeful strings', () => {
  // Spelled as data in the smoke helper so a RENAME fails here rather than quietly turning the
  // smoke test into a check of nothing.
  const known = new Set<string>(Object.values(USAGE_METRICS))
  for (const metric of SESSION_METRICS) {
    assert.ok(known.has(metric), `${metric} is not a USAGE_METRICS member any more`)
  }
})

test('sessionMetricFor: today, a session metric, and a count above zero — all three', () => {
  const DAY = '2026-08-04'
  assert.equal(sessionMetricFor([{ day: DAY, metric: 'sessions', n: 3 }], DAY), 'sessions')
  assert.equal(sessionMetricFor([{ day: DAY, metric: 'heartbeats', n: 1 }], DAY), 'heartbeats')
  assert.equal(sessionMetricFor([{ day: '2026-08-03', metric: 'sessions', n: 9 }], DAY), null, 'yesterday is not proof')
  assert.equal(sessionMetricFor([{ day: DAY, metric: 'featureUse', n: 9 }], DAY), null, 'not a session metric')
  assert.equal(
    sessionMetricFor([{ day: DAY, metric: 'sessions', n: 0 }], DAY),
    null,
    'a zero counter is an aggregate that recorded nothing'
  )
  assert.equal(sessionMetricFor([], DAY), null)
})

test('isAnalyticsId: a UUID, because that value is used as a query parameter and a DELETE target', () => {
  assert.ok(isAnalyticsId('3f2504e0-4f89-41d3-9a0c-0305e82c3301'))
  for (const bad of ['', 'null', 'undefined', "' OR 1=1--", '3f2504e04f8941d39a0c0305e82c3301', 42, null]) {
    assert.equal(isAnalyticsId(bad), false, JSON.stringify(bad))
  }
})

test('telemetryAccepting reads CLOSED unless the column is exactly true — as the Lambda does', () => {
  assert.equal(telemetryAccepting({ telemetry_accepting: true }), true)
  assert.equal(telemetryAccepting({ telemetry_accepting: false }), false)
  assert.equal(telemetryAccepting({ telemetry_accepting: null }), false, 'a NULL column is closed')
  assert.equal(telemetryAccepting({}), false, 'a row without the column is closed')
  assert.equal(telemetryAccepting(null), false, 'no config row at all is closed')
})

test('THE KILL SWITCH IS ITS OWN VERDICT, and it short-circuits the evidence', () => {
  // With intake closed, no row was ever created — so "no row" is not a finding, and reporting
  // it red would train the operator to ignore a failure they themselves caused.
  for (const installRow of [true, false]) {
    for (const sessionMetric of ['sessions', null]) {
      assert.equal(
        telemetryLegVerdict({ accepting: false, installRow, sessionMetric }),
        'lit-but-closed',
        `installRow=${String(installRow)} metric=${String(sessionMetric)}`
      )
    }
  }
  // Open: both facts, or it failed.
  assert.equal(telemetryLegVerdict({ accepting: true, installRow: true, sessionMetric: 'sessions' }), 'pass')
  assert.equal(telemetryLegVerdict({ accepting: true, installRow: false, sessionMetric: 'sessions' }), 'fail')
  assert.equal(telemetryLegVerdict({ accepting: true, installRow: true, sessionMetric: null }), 'fail')
  assert.equal(telemetryLegVerdict({ accepting: true, installRow: false, sessionMetric: null }), 'fail')
})

test('smokeResultLine is ONE greppable line the guest can parse', () => {
  const sent = smokeResultLine(NONCE, { ok: true, reportId: '01JABCXYZ', logUploaded: true })
  assert.ok(sent.startsWith(`${SMOKE_RESULT_PREFIX} `))
  assert.match(sent, /outcome=sent/)
  assert.match(sent, new RegExp(`nonce=${NONCE}\\b`))
  assert.match(sent, /reportId=01JABCXYZ/)
  assert.ok(!sent.includes('\n'))

  // A server message with a newline in it must not truncate the guest's regex parse.
  const bad = smokeResultLine(NONCE, {
    ok: false,
    error: 'quota_exceeded',
    message: 'too\nmany\treports today',
    queued: false
  })
  assert.ok(!bad.includes('\n') && !bad.includes('\t'))
  assert.match(bad, /outcome=error/)
  assert.match(bad, /error=quota_exceeded/)
})
