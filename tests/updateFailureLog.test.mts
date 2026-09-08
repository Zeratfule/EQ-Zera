// ============================================================================
// updateFailureLog.test.mts — what a failed update check leaves behind (JOS-295).
// ============================================================================
//
// THE READING THIS SUITE EXISTS FOR. GitHub issue 29: one user, every version from 0.18 to 0.23,
// every check failed, and the ONLY artefact anyone could ever get out of him was the caption the
// chip renders — by then `Unexpected end of JSON input`, a parse error about a body nobody asked
// us to parse, with the status, the URL and the method already destroyed inside
// builder-util-runtime's error FORMATTER. `updater.ts` handled the error event completely and
// never called `logError`, so no update failure has ever reached errors.log or the error store.
//
// TWO CHANGES, ONE ARGUMENT, and this file covers both because they only make sense together:
//
//   A. THE RAW ERROR IS ROUTED FIRST, sanitized second. `describeUpdateFailure` is a one-way door
//      and everything durable has to be taken before it opens — including WHICH ATTEMPT, since
//      JOS-211 gives one logical check two of them and a store that saw only the second would
//      describe a check that never retried.
//   B. IT IS BOUNDED IN THE SAME BREATH. An offline machine fails every check it makes, forever,
//      and none of those failures are about this app. Unreachable is a console warn once per CODE
//      per session (JOS-266's rule, exactly); an ANSWER from GitHub — a 4xx/5xx, or the
//      parse-masked failure that hides one — is filed every time, bounded only by the general
//      rules every other error obeys (`errorRepeat`'s five lines, `errorBudget`'s hundred
//      reports).
//
// WHAT IS DRIVEN AND WHAT IS PINNED. `updateLog.ts` and `shared/update.ts` are pure (the first
// takes its two sinks as a parameter precisely so this suite can hand it fakes), so the routing
// rule and the classifier are driven for real with no Electron in the process — `errorNoise` and
// `errorFlood`'s technique. The WIRING inside `updater.ts` needs `electron`, so it is pinned as
// source, and so is the one literal in the INSTALLED library that the echo-drop depends on.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_WARNED_UPDATE_CODES,
  UPDATER_LIBRARY_SOURCE,
  UPDATE_CHECK_SOURCE,
  UPDATE_DOWNLOAD_SOURCE,
  logUpdateFailure,
  resetUpdateLogWarnings,
  routeUpdaterLibraryError,
  updateFailureLine,
  type UpdateLogSinks
} from '../src/main/updateLog'
import {
  INTERRUPTED_ERROR_CODES,
  UNREACHABLE_ERROR_CODES,
  classifyUpdateFailure,
  describeUpdateFailure,
  isInterruptedFailure,
  updateFailureCode,
  updateHttpStatus
} from '../src/shared/update'
import { caughtFields } from '../src/shared/errorReportLocation'
import { errorCodeOf, errorNameOf, redactMessage } from '../src/shared/errorReport'

const TEST_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => readFileSync(join(TEST_ROOT, p), 'utf8')

// --------------------------------------------------------------------------- the real failures
//
// Every fixture below is the SHAPE THE LIBRARY ACTUALLY THROWS, read out of the installed
// builder-util-runtime@6.x / electron-updater@6.8.9 rather than imagined:
//
//   httpExecutor.js:52-57   `new HttpError(statusCode, "<status> <statusMessage>\nmethod: … url: …
//                            \nHeaders: {…}")`, with `name = "HttpError"` and
//                            `code = "HTTP_ERROR_<status>"` (httpExecutor.js:73-84).
//   httpExecutor.js:183-201 the masked case: `JSON.parse(data)` inside the error formatter, whose
//                            SyntaxError replaces the HttpError entirely.

/** A GitHub answer we must never fail to file. */
function httpError(status: number, statusMessage: string): Error {
  const err = new Error(
    `${String(status)} ${statusMessage}\n` +
      'method: GET url: https://github.com/jmoyers/everquest-companion/releases/latest\n' +
      '          Data:\n          \n          \nHeaders: {"content-type":"application/json"}'
  )
  err.name = 'HttpError'
  return Object.assign(err, { statusCode: status, code: `HTTP_ERROR_${String(status)}` })
}

/** THE MASKED ONE, produced the way httpExecutor produces it: a real `JSON.parse` over the empty
 *  body of a >= 400 response that advertised json. Nothing is hand-written here. */
function maskedStatusError(body: string): unknown {
  try {
    JSON.parse(body)
    throw new Error('the fixture must throw')
  } catch (e) {
    return e
  }
}

/** Offline, both executors: Node's errno and Chromium's `net::ERR_…` (which has no `code`). */
function offlineError(code: string): Error {
  return Object.assign(new Error(`getaddrinfo ${code} github.com`), { code })
}
const chromiumOffline = new Error('net::ERR_INTERNET_DISCONNECTED')

/** Recording sinks, in `logError`/`logWarn`'s exact shapes. */
interface Recorder extends UpdateLogSinks {
  readonly filed: { source: string; payload: unknown }[]
  readonly warned: unknown[][]
}
function recorder(): Recorder {
  const filed: { source: string; payload: unknown }[] = []
  const warned: unknown[][] = []
  return {
    filed,
    warned,
    error: (source, payload) => filed.push({ source, payload }),
    warn: (...args) => warned.push(args)
  }
}

// ------------------------------------------------------------------------------- the classifier

test('an ANSWER from GitHub is an http failure, and its status is readable', () => {
  for (const status of [400, 403, 404, 429, 451, 500, 502, 503]) {
    const err = httpError(status, 'Whatever')
    assert.equal(classifyUpdateFailure(err), 'http')
    assert.equal(updateHttpStatus(err), status)
  }
  // A copy that lost its object identity on the way through a log line still classifies: the
  // `HTTP_ERROR_<status>` code survives stringification, which is how the library's own logger
  // hands us the same failure.
  assert.equal(updateHttpStatus(new Error('HttpError: HTTP_ERROR_429 Too many requests')), 429)
  // …and an HttpError whose status we cannot read is still an answer, not an outage.
  assert.equal(classifyUpdateFailure(Object.assign(new Error('boom'), { name: 'HttpError' })), 'http')
  // A status outside 4xx/5xx is not a status we will state.
  assert.equal(updateHttpStatus(Object.assign(new Error('x'), { statusCode: 302 })), null)
  assert.equal(updateHttpStatus(new Error('plain failure')), null)
})

test('THE MASKED STATUS is its own class, and it is never mistaken for an outage', () => {
  // The exact three bodies httpExecutor can hand `JSON.parse` on a >= 400 json response.
  for (const body of ['', '{"message":"API rate limit', '<html><body>403</body></html>']) {
    const err = maskedStatusError(body)
    assert.equal(classifyUpdateFailure(err), 'parse', `body: ${JSON.stringify(body)}`)
  }
  // electron-updater's own wrappers around a feed it could not read are the same failure.
  assert.equal(
    classifyUpdateFailure(
      Object.assign(new Error('Cannot parse releases feed'), {
        code: 'ERR_UPDATER_INVALID_RELEASE_FEED'
      })
    ),
    'parse'
  )
})

test('UNREACHABLE means the request never left the machine - both executors spell it', () => {
  for (const code of UNREACHABLE_ERROR_CODES) {
    assert.equal(classifyUpdateFailure(offlineError(code)), 'unreachable', code)
    assert.equal(updateFailureCode(offlineError(code)), code)
  }
  // Chromium's spelling arrives inside the MESSAGE with no `code` property at all.
  assert.equal(classifyUpdateFailure(chromiumOffline), 'unreachable')
  assert.equal(updateFailureCode(chromiumOffline), 'ERR_INTERNET_DISCONNECTED')
})

test('an answer OUTRANKS a socket word in the same message, and the unknown is REPORTED', () => {
  // A 502 whose body quotes ECONNRESET is still GitHub answering us. Precedence, not luck.
  const err = Object.assign(httpError(502, 'Bad gateway'), {
    message: '502 Bad gateway\nHeaders: {"x":"upstream ECONNRESET"}'
  })
  assert.equal(classifyUpdateFailure(err), 'http')
  // TLS is deliberately NOT unreachable: a MITM proxy or an expired root is diagnosable, and the
  // honest direction for a classifier is to report what it does not understand.
  assert.equal(
    classifyUpdateFailure(
      Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      })
    ),
    'other'
  )
  assert.equal(classifyUpdateFailure(new Error('something nobody has seen yet')), 'other')
  assert.equal(classifyUpdateFailure(null), 'other')
  assert.equal(classifyUpdateFailure('a thrown string'), 'other')
})

// ------------------------------------------------------------------ the interruption (JOS-307)
//
// THE MEASUREMENT THIS ARM EXISTS FOR, and it is a reading rather than a theory: 0.27.0's first day
// in the fleet produced twelve copies of fingerprint 36e52c753767490b —
// `update check failed (final, other): net::ERR_NETWORK_IO_SUSPENDED` — every one of them a laptop
// closing its lid under an in-flight request, filed as an unexplained update failure. Owner ruling
// 2026-08-14, verbatim: *classify IO-suspended / network-change as a benign transient: retry on
// resume, never error-store it.*

/** Chromium's shapes, both ways they can arrive: a `code` property, or inside the message. */
const suspendedByMessage = new Error('net::ERR_NETWORK_IO_SUSPENDED')
const suspendedByCode = Object.assign(new Error('net::ERR_NETWORK_IO_SUSPENDED (-61)'), {
  code: 'ERR_NETWORK_IO_SUSPENDED'
})
const networkChanged = new Error('net::ERR_NETWORK_CHANGED')

test('AN INTERRUPTION IS ITS OWN KIND, and it is asked FIRST', () => {
  for (const err of [suspendedByMessage, suspendedByCode]) {
    assert.ok(isInterruptedFailure(err))
    assert.equal(classifyUpdateFailure(err), 'interrupted')
    assert.equal(updateFailureCode(err), 'ERR_NETWORK_IO_SUSPENDED')
  }
  // THE OWNER NAMED TWO. A Wi-Fi-to-dock handover is the same event as a lid closing as far as this
  // app is concerned, and it gets the same answer: wait for the machine to settle and ask again.
  assert.ok(isInterruptedFailure(networkChanged))
  assert.equal(classifyUpdateFailure(networkChanged), 'interrupted')
  // …which means it is no longer in the unreachable list. It was there, it was already bounded
  // there, and what it was NOT earning there was the re-anchored retry.
  assert.ok(!(UNREACHABLE_ERROR_CODES as readonly string[]).includes('ERR_NETWORK_CHANGED'))
  // Neither carries a status and neither is in the parse patterns, so nothing could steal them
  // today — asking first is what keeps that true if the other arms ever widen.
  assert.equal(updateHttpStatus(suspendedByCode), null)
  // AWAITING-SAMPLE: only the codes that have been MEASURED or named are in the list. `ERR_ABORTED`
  // also covers a request we cancelled ourselves, so it stays out and stays reported.
  assert.deepEqual([...INTERRUPTED_ERROR_CODES], ['ERR_NETWORK_IO_SUSPENDED', 'ERR_NETWORK_CHANGED'])
  assert.equal(classifyUpdateFailure(new Error('net::ERR_ABORTED')), 'other')
  // …and a machine that moved is not an offline one: the two must not be conflated, because only
  // one of them is fixed by waiting a moment.
  assert.equal(isInterruptedFailure(chromiumOffline), false)
  assert.equal(isInterruptedFailure(null), false)
})

test('AN INTERRUPTION NEVER REACHES THE ERROR STORE — one console line per session', () => {
  resetUpdateLogWarnings()
  const r = recorder()
  // A laptop that is opened and closed all day, for a week.
  for (let i = 0; i < 5_000; i++) logUpdateFailure('check', 'final', suspendedByCode, r)
  assert.equal(r.filed.length, 0, 'twelve reports on day one becomes none')
  assert.equal(r.warned.length, 1)
  assert.match(String(r.warned[0][1]), /cut short by the machine suspending or changing network/)
  assert.match(String(r.warned[0][1]), /\(ERR_NETWORK_IO_SUSPENDED\)/)
  assert.match(String(r.warned[0][1]), /re-anchored/)
  // A network change is a DIFFERENT story about the machine and earns its own line — and still not
  // a report.
  for (let i = 0; i < 500; i++) logUpdateFailure('check', 'final', networkChanged, r)
  assert.equal(r.warned.length, 2)
  assert.equal(r.filed.length, 0)
  // It shares the unreachable budget — same claim ("this is about the machine"), same ceiling.
  for (const code of UNREACHABLE_ERROR_CODES.slice(0, MAX_WARNED_UPDATE_CODES)) {
    logUpdateFailure('check', 'final', offlineError(code), r)
  }
  assert.equal(r.warned.length, MAX_WARNED_UPDATE_CODES)
  assert.equal(r.filed.length, 0)
  resetUpdateLogWarnings()
})

test('THE THIRD SPELLING OF A STATUS: `HttpError: <n>` interpolated into a sentence', () => {
  // MEASURED: 0.26.0's fingerprint 2e535fdf79476239, x7. electron-updater's own `newError` builds a
  // plain Error with an `ERR_UPDATER_*` code and puts the HttpError in the TEXT, so `statusCode` is
  // gone and `code` no longer matches `HTTP_ERROR_…`. It was reading as 'other' — a class that says
  // we do not understand a 404 on our own release feed.
  const linux = Object.assign(
    new Error(
      'Cannot find latest-linux.yml in the latest release artifacts ' +
        '(https://github.com/jmoyers/everquest-companion/releases/latest): HttpError: 404 Not Found'
    ),
    { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' }
  )
  assert.equal(updateHttpStatus(linux), 404)
  assert.equal(classifyUpdateFailure(linux), 'http')
  assert.match(updateFailureLine('check', 'final', 'http', linux), /\(final, http 404\)/)
  // The other two spellings are untouched, and a number that is not a status is still not one.
  assert.equal(updateHttpStatus(new Error('HttpError: 302 Found')), null)
  assert.equal(updateHttpStatus(new Error('downloaded 404 bytes')), null)
})

// --------------------------------------------------------------------------------- the bounding

test('an OFFLINE machine costs one console line per code per session, and never a filed error', () => {
  // The whole second half of the ticket, in one number: a laptop that checks every four hours for
  // a week is ~42 failures; the loop below is an install that never stops trying.
  resetUpdateLogWarnings()
  const r = recorder()
  for (let i = 0; i < 5_000; i++) logUpdateFailure('check', 'final', offlineError('ENOTFOUND'), r)
  assert.equal(r.filed.length, 0, 'nothing reaches errors.log or the error store')
  assert.equal(r.warned.length, 1)
  assert.match(String(r.warned[0][1]), /could not reach the update service \(ENOTFOUND\)/)
  // A DIFFERENT code is a different story about the machine and earns its own line.
  logUpdateFailure('check', 'final', offlineError('ECONNREFUSED'), r)
  assert.equal(r.warned.length, 2)
  logUpdateFailure('download', 'final', chromiumOffline, r)
  assert.equal(r.warned.length, 3)
  assert.equal(r.filed.length, 0)
  resetUpdateLogWarnings()
  const fresh = recorder()
  logUpdateFailure('check', 'final', offlineError('ENOTFOUND'), fresh)
  assert.equal(fresh.warned.length, 1, 'a new session warns again')
  resetUpdateLogWarnings()
})

test('the warn gate itself is bounded - a pathological machine cannot grow it', () => {
  resetUpdateLogWarnings()
  const r = recorder()
  for (const code of UNREACHABLE_ERROR_CODES) logUpdateFailure('check', 'final', offlineError(code), r)
  assert.ok(UNREACHABLE_ERROR_CODES.length > MAX_WARNED_UPDATE_CODES, 'the ceiling is reachable')
  assert.equal(r.warned.length, MAX_WARNED_UPDATE_CODES)
  assert.equal(r.filed.length, 0)
  resetUpdateLogWarnings()
})

test('AN ANSWER FROM GITHUB IS FILED EVERY TIME - this layer never withholds one', () => {
  // The thing that must always land. Bounding it is `errorRepeat`/`errorBudget`'s job downstream
  // (five identical lines, a hundred reports per fingerprint per session); a second private
  // opinion here would be how a 403 goes missing.
  resetUpdateLogWarnings()
  const r = recorder()
  for (let i = 0; i < 500; i++) logUpdateFailure('check', 'final', httpError(403, 'Forbidden'), r)
  for (let i = 0; i < 500; i++) logUpdateFailure('check', 'final', maskedStatusError(''), r)
  assert.equal(r.filed.length, 1_000)
  assert.equal(r.warned.length, 0)
  assert.ok(r.filed.every((f) => f.source === UPDATE_CHECK_SOURCE))
  // A failed DOWNLOAD is a different fact from a failed check and carries a different tag, so one
  // can never mask the other in the file or in `errorRepeat`'s per-source budget.
  logUpdateFailure('download', 'final', httpError(500, 'Internal server error'), r)
  assert.equal(r.filed[1_000].source, UPDATE_DOWNLOAD_SOURCE)
  resetUpdateLogWarnings()
})

// ------------------------------------------------------------------------------- what is written

test('the payload carries the RAW error, untouched, plus the three facts it cannot supply', () => {
  resetUpdateLogWarnings()
  const r = recorder()
  const err = httpError(403, 'Forbidden')
  logUpdateFailure('check', 'final', err, r)
  const payload = r.filed[0].payload as Record<string, unknown>
  // IDENTITY, not a copy and not a formatted string: the sanitizer must not have run first.
  assert.equal(payload.error, err)
  assert.equal(payload.step, 'check')
  assert.equal(payload.attempt, 'final')
  assert.equal(payload.kind, 'http')
  // …and the ONE-WAY DOOR has not been opened: the parse-masked failure is the case where the
  // sanitizer replaces the error outright, and none of its sentence may appear in what is filed.
  const masked = maskedStatusError('')
  logUpdateFailure('check', 'final', masked, r)
  const parsePayload = r.filed[1].payload as Record<string, unknown>
  assert.equal(parsePayload.error, masked)
  assert.ok(!JSON.stringify({ ...parsePayload, error: undefined }).includes(describeUpdateFailure(masked)))
  assert.match(String(parsePayload.message), /Unexpected end of JSON input|JSON/)
  resetUpdateLogWarnings()
})

test('THE STORE ROW READS: which step, which attempt, which status, which error', () => {
  // Driven through the REAL report producer's readers (`caughtFields` + the redactor), because
  // "legible in the store" is a claim about what those two make of the payload — not about what
  // the object looks like in a debugger.
  resetUpdateLogWarnings()
  const r = recorder()
  const err = httpError(403, 'Forbidden')
  logUpdateFailure('check', 'retrying', err, r)
  logUpdateFailure('check', 'final', err, r)
  const fields = caughtFields(r.filed[1].payload)
  // The NESTED error supplies the identity: the row says HttpError / HTTP_ERROR_403, with the
  // real stack behind it, exactly as if the raw error had been filed bare.
  assert.equal(errorNameOf(fields.name), 'HttpError')
  assert.equal(errorCodeOf(fields.code), 'HTTP_ERROR_403')
  assert.ok(typeof fields.stack === 'string' && fields.stack.includes('HttpError'))
  // The WRAPPER supplies what the raw error never knew: step, attempt, class and status.
  const message = redactMessage(fields.message)
  assert.match(message, /^update check failed \(final, http 403\): 403 Forbidden/)
  // The retry stays legible: the swallowed attempt is a line of its own, spelled `retrying`.
  assert.match(redactMessage(caughtFields(r.filed[0].payload).message), /\(retrying, http 403\)/)
  // THE BRIGHT LINE HOLDS ANYWAY. The redactor is what publishes this, and it still collapses the
  // URL to a placeholder; the STATUS survives because a three-digit number is diagnostic
  // (errorReport.ts LONG_NUMBER_RE). errors.log keeps the untouched original either way.
  const long = redactMessage(caughtFields(r.filed[1].payload).message, 400)
  assert.ok(!long.includes('github.com'), long)
  assert.match(long, /403/)
  resetUpdateLogWarnings()
})

test('the line names the kind even when there is no status to name', () => {
  const parse = maskedStatusError('')
  assert.match(updateFailureLine('check', 'retrying', 'parse', parse), /^update check failed \(retrying, parse\): /)
  assert.match(updateFailureLine('download', 'final', 'other', new Error('boom')), /\(final, other\): boom$/)
  // ONE LINE, whatever the error carries: a stack or a headers dump must not become a paragraph
  // in a store row (the file keeps the whole thing through the nested error).
  const fat = new Error(`first line\n${'  at frame\n'.repeat(200)}`)
  assert.equal(updateFailureLine('check', 'final', 'other', fat).split('\n').length, 1)
})

// ------------------------------------------------------------- electron-updater's own diagnostics

test("the library's echo of an error event is DROPPED - one failure is one row", () => {
  // AppUpdater's constructor registers its own `error` listener that logs `Error: <stack>`, so
  // every event arrives at the logger as well as at our handler. Filing it too would double every
  // update failure in the store AND would file the offline ones the bound above just withheld.
  assert.equal(routeUpdaterLibraryError('Error: HttpError: 403 Forbidden\n    at t (…)'), 'drop')
  assert.equal(routeUpdaterLibraryError('Error: getaddrinfo ENOTFOUND github.com'), 'drop')
  // A fallback that costs bandwidth and never correctness (research §4) is console-only…
  assert.equal(
    routeUpdaterLibraryError('Cannot download differentially, fallback to full download: …'),
    'warn'
  )
  // …and everything else the library calls an error IS one.
  assert.equal(
    routeUpdaterLibraryError('updaterCacheDirName is not specified in app-update.yml'),
    'error'
  )
  assert.equal(routeUpdaterLibraryError('spawn UNKNOWN'), 'error')
  assert.equal(routeUpdaterLibraryError(undefined), 'error')
})

test('THE INSTALLED LIBRARY still formats that echo the way the drop expects', () => {
  // The one assumption the drop rests on, checked against the source rather than remembered. If an
  // upgrade reworded it, this goes red HERE — instead of every update failure quietly filing twice.
  // RESOLVED, NOT JOINED — this suite also runs from a worktree that has no `node_modules` of its
  // own (AGENTS.md), so the path has to come from node's own resolution and not from TEST_ROOT.
  const lib = readFileSync(
    createRequire(import.meta.url).resolve('electron-updater/out/AppUpdater.js'),
    'utf8'
  )
  assert.ok(
    lib.includes('this._logger.error(') && lib.includes('Error: ${error.stack'),
    'AppUpdater no longer logs `Error: <stack>` for every emitted error event'
  )
  // And the default logger really is `console` — the whole reason assigning ours is worth doing.
  assert.match(lib, /this\._logger = console/)
})

// -------------------------------------------------------------------------------------- the wiring

test('THE WIRING: the raw error is routed BEFORE the sanitizer, on every path', () => {
  const src = read('src/main/updater.ts')
  const handler = src.slice(src.indexOf("autoUpdater.on('error'"), src.indexOf('/**\n * Initialize'))
  assert.ok(handler.length > 0, 'found the error handler')
  // The swallowed attempt is logged and says so.
  assert.ok(handler.indexOf("logUpdateFailure(step, 'retrying', err, LOG_SINKS)") > 0)
  assert.ok(
    handler.indexOf("logUpdateFailure(step, 'retrying', err, LOG_SINKS)") <
      handler.indexOf('retryPending = true')
  )
  // …and the final one is logged BEFORE `describeUpdateFailure` gets to replace it.
  assert.ok(
    handler.indexOf("logUpdateFailure(step, 'final', err, LOG_SINKS)") <
      handler.indexOf('describeUpdateFailure(err)')
  )
  // The rejection path — the failures the event handler did NOT account for — takes the same rule,
  // and only for the unaccounted ones (or every failure would be filed twice). It lives in
  // `routeCheckRejection` since JOS-307 lifted it out of `runCheck`'s catch; the gate stays at the
  // call site, which is where "did the event already handle this?" is answerable.
  const runCheck = src.slice(src.indexOf('const runCheck ='))
  assert.match(runCheck, /const unaccounted = checkInFlight && !retryPending/)
  assert.match(runCheck, /if \(unaccounted\) routeCheckRejection\(err, sinks\)/)
  const route = src.slice(src.indexOf('function routeCheckRejection('))
  assert.ok(
    route.indexOf("logUpdateFailure('check', 'final', err, LOG_SINKS)") <
      route.indexOf('describeUpdateFailure(err)')
  )
  assert.match(route, /shouldRetryCheck\(err, checkAttempts\)\) \{\s+logUpdateFailure\('check', 'retrying'/)
  // NEVER the sanitized text as a payload: the whole ticket is that the sentence is not the error.
  assert.doesNotMatch(src, /logUpdateFailure\([^)]*describeUpdateFailure/)
  // The bounded telemetry signal is NOT gated on any of this: `noteUpdate` still records one
  // `updateOutcome` per failure whatever the routing decided, which is what makes an offline
  // fleet countable without an error storm.
  assert.ok(
    handler.indexOf("logUpdateFailure(step, 'final', err, LOG_SINKS)") <
      handler.indexOf("noteUpdate(step, err ?? 'unknown error')")
  )
})

test('THE WIRING: an interruption counts no failure, stamps no check, and re-anchors (JOS-307)', () => {
  const src = read('src/main/updater.ts')
  // ONE function for both call sites, because they are one ruling.
  const note = src.slice(src.indexOf('function noteInterrupted('))
  const body = note.slice(0, note.indexOf('\n}'))
  assert.ok(body.length > 0, 'found noteInterrupted')
  // The four things that DO happen…
  assert.match(body, /logUpdateFailure\(step, 'final', err, LOG_SINKS\)/)
  assert.match(body, /noteUpdate\(step, err\)/)
  assert.match(body, /sinks\.push\(\{ state: 'idle' \}\)/)
  assert.match(body, /sinks\.retryOnResume\(\)/)
  // …and the ones that must not. A `checkDone` here would stamp `lastCheckedAt` for a check that
  // never completed — the same dishonesty the chip half of this ticket is about.
  assert.doesNotMatch(body, /checkDone\(/)
  assert.doesNotMatch(body, /consecutiveFailures/)
  assert.doesNotMatch(body, /state: 'error'/)
  // Clearing the in-flight latch is what marks the failure ACCOUNTED, so `runCheck`'s catch does
  // not file it a second time.
  assert.match(body, /checkInFlight = false/)

  // BOTH call sites ask it FIRST, before the JOS-211 retry swallow and before the final verdict.
  const handler = src.slice(src.indexOf("autoUpdater.on('error'"))
  assert.ok(
    handler.indexOf('isInterruptedFailure(err)') > 0 &&
      handler.indexOf('isInterruptedFailure(err)') < handler.indexOf('shouldRetryCheck(err, checkAttempts)')
  )
  const route = src.slice(src.indexOf('function routeCheckRejection('))
  assert.ok(route.indexOf('isInterruptedFailure(err)') < route.indexOf('shouldRetryCheck(err, checkAttempts)'))

  // AND THE HALF THAT COVERS THE COMMON CASE: most sleeps produce no error at all, they just
  // freeze a setTimeout. The wake itself has to re-anchor the poll.
  assert.match(src, /powerMonitor\.on\('resume', \(\) => \{?\s*schedule\('resume'\)/)
  assert.match(src, /const schedule = \(phase: 'startup' \| 'periodic' \| 'resume'\)/)
})

test("THE WIRING: the library's logger is ours, at the levels errorLog.ts allows", () => {
  const src = read('src/main/updater.ts')
  assert.match(src, /autoUpdater\.logger = LIBRARY_LOGGER/)
  const logger = src.slice(src.indexOf('const LIBRARY_LOGGER'), src.indexOf('let timer'))
  // info/warn are CONSOLE ONLY. errors.log exists so a blank window is never silent; burying it
  // under "Checking for update" every four hours would defeat it (errorLog.ts's law).
  assert.match(logger, /info: \(message\?: unknown\): void => \{\s*\n\s*logInfo\(UPDATER_LOG_PREFIX, message\)/)
  assert.match(logger, /warn: \(message\?: unknown\): void => \{\s*\n\s*logWarn\(UPDATER_LOG_PREFIX, message\)/)
  // error goes through the router, so the echo and the differential fallback cannot reach the file.
  assert.match(logger, /switch \(routeUpdaterLibraryError\(message\)\)/)
  assert.match(logger, /logError\(UPDATER_LIBRARY_SOURCE, message\)/)
  // `debug` is deliberately absent: the library asks `if (this._logger.debug != null)` before
  // using it, so leaving it out keeps its per-request chatter off exactly as it is today.
  assert.doesNotMatch(logger, /\bdebug:/)
  assert.equal(UPDATER_LIBRARY_SOURCE, 'main:updater')
})
