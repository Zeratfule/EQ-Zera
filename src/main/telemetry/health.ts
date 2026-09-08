// ============================================================================
// telemetry/health.ts — the health counters, as pending deltas (JOS-96, JOS-133, JOS-266).
// ============================================================================
//
// EIGHT FIELDS NOW. Five shipped with JOS-96; JOS-133 added two and JOS-266 added the eighth, and
// all three were added for the same reason rather than because more numbers are better: something
// that was being reported as an ERROR was not one, and demoting it needed somewhere honest for the
// count to land. See `noteImageFetchFailure`, `noteSuppressedErrorLine` and
// `noteImageCacheReadFailure` for each argument.
//
// `EvHealthCounters` has been in the contract since wave A2 and NO CLIENT HAS EVER EMITTED IT.
// This file is the missing producer half: the places in main that already KNOW something went
// wrong bump a counter here, and `flush.ts` drains the lot onto the session report.
//
// IT IMPORTS NOTHING, AND THAT IS THE POINT. `errorLog.ts` is one of the five sources, and
// `collector.ts` imports `errorLog.ts` (`logInfo`) — so a counter living in the collector would
// make `errorLog → collector → errorLog` a cycle, on the app's error path, which is the single
// worst place in the process to discover a module-init order bug. A leaf module with no imports
// at all cannot participate in a cycle no matter who imports it. It also means an increment is a
// plain integer add: no store read, no ring write, no allocation, nothing that can itself throw
// inside a `catch` block. (`noteLinesParsed`'s reasoning, for the same reason — these fire from
// hot or fragile paths and must cost nothing.)
//
// PENDING DELTAS, NOT TOTALS — the `linesPending` pattern exactly (collector.ts). The counters
// are drained by whichever of `sessionHeartbeat` / `sessionEnd` fires first, so:
//
//   * NO DOUBLE COUNTING. A drain zeroes what it took; the fleet-wide sum is a sum of disjoint
//     deltas, and a session that both heartbeats and ends reports each error exactly once.
//   * A KILLED SESSION SIMPLY NEVER REPORTS its last partial window, which is the documented
//     cost of riding an existing event rather than minting a new kind, and is why the heartbeat
//     drains at all instead of waiting for a close that may never come.
//
// COUNTS ONLY. Every function here takes no argument but a number. There is no parameter that
// could carry a stack, a message, a path or a name even if a caller wanted to give it one — the
// wire schema promises counts (TELEMETRY.md) and the promise is kept by the shape, not by
// discipline at 80-odd call sites.
//
// THE USER'S SWITCH IS STILL THE ONE GATE. Nothing here transmits; these are integers in memory
// that only ever leave through `recordEvent`, which refuses when the switch is off. `endSession`
// (collector.ts) zeroes them, so flipping the switch off discards whatever was pending — lines
// counted before the flip must not be waiting to be reported if it is flipped back on.

/** The wire's own ceiling for a count field (`MAX_COUNT`, shared/telemetry.ts), restated rather
 *  than imported so this module keeps its no-imports property. A count past this is clamped at
 *  the DRAIN, never at the increment: clamping on the way in would make the counter lie to
 *  itself, and the validator would reject the event anyway. */
const MAX_HEALTH_COUNT = 1_000_000

/** The ten fields, spelled once. Mirrors `HEALTH_FIELDS` in shared/telemetryValidate.ts. */
export interface HealthDelta {
  rendererCrashes: number
  mainErrorLogLines: number
  parserStalls: number
  presenceRestarts: number
  speechFailures: number
  imageFetchFailures: number
  suppressedErrorLines: number
  imageCacheReadFailures: number
  gpuProcessGone: number
  utilityProcessGone: number
}

const zero = (): HealthDelta => ({
  rendererCrashes: 0,
  mainErrorLogLines: 0,
  parserStalls: 0,
  presenceRestarts: 0,
  speechFailures: 0,
  imageFetchFailures: 0,
  suppressedErrorLines: 0,
  imageCacheReadFailures: 0,
  gpuProcessGone: 0,
  utilityProcessGone: 0
})

let pending: HealthDelta = zero()

function bump(field: keyof HealthDelta, n: number): void {
  if (!Number.isFinite(n) || n <= 0) return
  pending[field] += n
}

/**
 * A line was written to `<userData>/errors.log`. Called from `logError` (src/main/errorLog.ts),
 * which is the ONE funnel every main-process error append passes through — `logInfo` / `logWarn`
 * / `logConsoleError` are console-only and deliberately do not count.
 *
 * SO IT COUNTS ERRORS, WHICH IT DID NOT ALWAYS (JOS-99). Two mechanisms used to feed it lines that
 * nobody could act on: every renderer `console.warn` was forwarded into the file as though it were
 * an error (`windowErrors.ts`), and every window RELOAD re-sent the `rendererHydrated` startup mark
 * into an accounting that refuses duplicates loudly (`ipc/perf.ts`). Both are fixed at their own
 * source rather than by filtering here — a counter that has to second-guess its funnel is a
 * counter nobody can reason about — and warnings still reach dev stdout, just not this file.
 */
export function noteErrorLogLine(n = 1): void {
  bump('mainErrorLogLines', n)
}

/**
 * The renderer process died (`render-process-gone`, src/main/windows.ts).
 *
 * Counted at the EVENT, not via `logError`, because that handler logs twice per crash (once for
 * the details and once for the recovery reload) — counting the log lines would report every
 * crash as two. `mainErrorLogLines` still counts both, and correctly: two lines really were
 * written.
 *
 * MAIN WINDOW ONLY. Overlay windows are created without a `render-process-gone` handler, so an
 * overlay crash is invisible to this counter. Stated here rather than quietly implied.
 */
export function noteRendererCrash(n = 1): void {
  bump('rendererCrashes', n)
}

/**
 * The game-window presence watcher restarted (`scheduleRestart`, src/main/presence.ts) — the one
 * funnel all three restart causes reach (the staleness watchdog, the watcher-gone handler, and a
 * start that threw).
 *
 * It is a SEPARATE counter from `restartFailures` in that module on purpose: that one is a
 * backoff index which resets to 0 on a healthy watcher, so it answers "how bad is it right now"
 * and can never answer "how many times did this happen this session".
 *
 * IT IS ALSO THE FIELD THAT SHOULD FALL OFF A CLIFF (JOS-182). Every restart it counted used to
 * be a `powershell.exe` spawn, and on the machines where that binary is missing or blocked it
 * counted one every thirty seconds for the life of the session. The watcher is a worker thread
 * now; a fleet where this number stays high is a fleet where something ELSE is wrong.
 */
export function notePresenceRestart(n = 1): void {
  bump('presenceRestarts', n)
}

/**
 * An utterance failed to speak (the `speechSay` IPC handler, src/main/ipc/speech.ts).
 *
 * KOKORO-TIER ONLY, and that is a real limit rather than an omission: the system voice tier is
 * the renderer's own `speechSynthesis` and never reaches main at all, so nothing in this process
 * is in a position to see it fail.
 */
export function noteSpeechFailure(n = 1): void {
  bump('speechFailures', n)
}

/**
 * NOT WIRED (JOS-96). There is no stall detector in this app: the Tailer keeps no last-line
 * clock and nothing compares one to the wall, so `parserStalls` reports 0 from every client and
 * means "not measured", not "never happened".
 *
 * The function exists so the field has one obvious home the day a detector is built, and so this
 * note is attached to the counter rather than to a commit message. Building the detector was out
 * of scope for the ticket that shipped the other four — inventing one would have put a number on
 * the wire that no measurement stands behind, which is the awaiting-sample law in its usual
 * clothes. `presence.ts`'s `armStaleWatchdog` is the in-repo pattern when it is built.
 */
export function noteParserStall(n = 1): void {
  bump('parserStalls', n)
}

/**
 * An image the app wanted could not be FETCHED — the network leg failed outright (offline, DNS,
 * TLS, the 8 s timeout), before any HTTP status existed (`fetchAndStore`, src/main/imageCache.ts).
 *
 * IT IS A COUNTER BECAUSE IT IS NOT AN ERROR (JOS-133). The condition is fully handled at every
 * layer: nothing is cached (negatives never are), the handler answers 404, the renderer's existing
 * `onError` hides the image, and the next request retries. It used to reach `logError`, and the
 * fleet read the consequence back to us — one fingerprint, 17,632 occurrences over 14 days across
 * 0.13.0/0.14.0, roughly two thirds of every `mainErrorLogLines` this app has ever counted. A
 * number that large made of one handled condition does not describe the app's health, it hides it.
 *
 * SO THE MEASUREMENT SURVIVES AND THE ALARM DOES NOT. "How often is the wiki unreachable for the
 * fleet" is a real question and this is its answer; it is deliberately NOT summed into the release
 * health error rate (`HEALTH_NON_ERROR_FIELDS`, shared/telemetryRollup.ts), because a build cannot
 * be blamed for somebody else's server. The HTTP-status branch beside it (a 404/500 from a host
 * that DID answer) stays an error: that one says the app asked for the wrong thing, which is ours.
 *
 * Live debugging keeps one WARN line per host per session (imageCache.ts) — console only, never
 * errors.log, so it costs the counter nothing.
 */
export function noteImageFetchFailure(n = 1): void {
  bump('imageFetchFailures', n)
}

/**
 * A CACHED IMAGE ON DISK COULD NOT BE READ BACK, and the cache healed itself (JOS-266,
 * `serveFromDisk`, src/main/imageCache.ts). The entry is evicted and the image is re-fetched as
 * though it had never been cached, so the user sees the picture — a beat late — instead of a gap.
 *
 * IT IS A COUNTER BECAUSE THE SELF-HEAL MAKES IT ONE, which is the same argument
 * `noteImageFetchFailure` makes one section up, arrived at from the other direction. The fleet's
 * reading: ~290 occurrences of `image cache: could not read <path>` across 0.20–0.23 (fingerprint
 * 8f0e7721ddcad03b alone 198×, `code=ENOENT` — a file that passed `existsSync` and was gone by the
 * read, i.e. antivirus eviction or a user clearing the folder). Nothing in that is this build's
 * fault and nothing in it is unhandled, so counting it as an error described the wrong thing.
 *
 * NOT SUMMED INTO THE RELEASE ERROR RATE (`HEALTH_NON_ERROR_FIELDS`, shared/telemetryRollup.ts) for
 * `imageFetchFailures`' reason: a build cannot be blamed for a file some scanner took away. It is
 * still worth watching — a version where this climbs is a version whose cache directory is being
 * fought over — which is exactly what a counter, and not an error, is for.
 *
 * Live debugging keeps ONE WARN LINE PER FAILURE CODE PER SESSION (imageCache.ts) — console only,
 * never errors.log, so it costs the error count nothing.
 */
export function noteImageCacheReadFailure(n = 1): void {
  bump('imageCacheReadFailures', n)
}

/**
 * An error line that was NOT written to `<userData>/errors.log` because the identical line had
 * already been written `MAX_IDENTICAL_ERROR_LINES` times this session (src/main/errorRepeat.ts).
 *
 * THIS COUNTER IS WHAT MAKES THE CAP HONEST, and it is the reason the cap was allowed to exist at
 * all. `mainErrorLogLines` means "lines in this fleet's error logs" — a promise kept by counting
 * AFTER the append — so a cap that silently stopped appending would silently deflate it, and a
 * build that started looping would look like a build that got better. The two fields add up to
 * what really happened: `mainErrorLogLines + suppressedErrorLines` is the occurrence count, and
 * both are summed into the release health error rate for exactly that reason.
 *
 * It is NOT the errorReport dedupe. That one is per FINGERPRINT and already reports its own
 * `count` (telemetry/errorReports.ts); this one is per identical LINE and is about the local file
 * a human greps. The two run independently on purpose — a suppressed line still produces a report.
 */
export function noteSuppressedErrorLine(n = 1): void {
  bump('suppressedErrorLines', n)
}

/**
 * THE GPU PROCESS DIED and Chromium restarted it (JOS-364, `child-process-gone` with
 * `type: 'GPU'` — src/main/childProcessGone.ts).
 *
 * IT IS `noteRendererCrash`'S ARGUMENT ABOUT A DIFFERENT PROCESS. The app survives, so nothing
 * else in this codebase would ever have said anything about it; what the user gets is every
 * window's compositor torn down and rebuilt, which is a black frame or a freeze, and "EverQuest
 * hitches for about a second when an overlay appears" is the report this counter exists to test
 * against. It IS summed into the release error rate.
 *
 * COUNTED AT THE EVENT, not via `logError`, for `noteRendererCrash`'s reason exactly: the handler
 * logs one line per loss so the error store gets an exemplar carrying the reason and the exit
 * code, and counting log lines instead would tie this number to how chatty that handler is.
 */
export function noteGpuProcessGone(n = 1): void {
  bump('gpuProcessGone', n)
}

/**
 * A UTILITY PROCESS died the same way (`type: 'Utility'`) — audio, networking, storage.
 *
 * NOT AN ERROR (`HEALTH_NON_ERROR_FIELDS`, shared/telemetryRollup.ts), and counted anyway, which
 * is `imageFetchFailures`' shape a third time: Chromium starts and stops these by design and
 * nothing here can tell an ordinary teardown from a kill beyond the clean-exit filter its
 * producer applies, so summing it into the rate would report a normal browser as a bad release.
 * What it is FOR is the correlation — a fleet where this climbs beside `gpuProcessGone` is a
 * fleet where something outside this app is killing our children.
 */
export function noteUtilityProcessGone(n = 1): void {
  bump('utilityProcessGone', n)
}

/**
 * Drain the deltas for one session report. ALWAYS returns a value, including all-zeros, and that
 * is the load-bearing half of this whole design.
 *
 * A report with nothing wrong in it is still a REPORT: it is what writes the `healthReports` row
 * that the error counts are divided by, and — because that row is dimmed by version — it is the
 * only evidence that a given build is capable of reporting at all. Skipping the event on a clean
 * session would make a healthy build indistinguishable from a build that predates this code, and
 * the panel's "not reporting" state exists precisely to keep those two apart.
 *
 * The remainder past `MAX_HEALTH_COUNT` is KEPT, not clamped away, exactly as `takeLinesParsed`
 * keeps its own: the next heartbeat reports it.
 */
export function takeHealth(): HealthDelta {
  const taken = zero()
  for (const field of Object.keys(taken) as (keyof HealthDelta)[]) {
    const n = Math.min(pending[field], MAX_HEALTH_COUNT)
    taken[field] = n
    pending[field] -= n
  }
  return taken
}

/** Drop everything pending. Called from the collector's session boundaries — a switch turned off
 *  must not leave counts waiting to be reported if it is turned back on. */
export function resetHealth(): void {
  pending = zero()
}

/** The undrained deltas, for tests and for nothing else. Never sent. */
export function peekHealth(): HealthDelta {
  return { ...pending }
}
