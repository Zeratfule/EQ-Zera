// ============================================================================
// errorCounterHygiene.test.mts — the error counter counts ERRORS (JOS-99).
// ============================================================================
//
// THE READING THIS SUITE EXISTS FOR: 3,859 `mainErrorLogLines` across 3,728 fleet health reports,
// with ZERO renderer crashes. The counter was honest — it counts lines in `<userData>/errors.log`,
// and those lines really were written — but two mechanisms were writing lines nobody could ever
// act on, so a number meant to say "how much is going wrong out there" was mostly saying "the app
// reloaded a window" and "some component logged a warning".
//
//   A. EVERY RELOAD SPENT AN ERROR LINE. The renderer's send-once guard for the `rendererHydrated`
//      startup mark is module scope (renderer/src/lib/perfHud.ts), so a reload — the dev watcher's,
//      the `did-fail-load` retry's, the `render-process-gone` recovery's — resets it and the mark
//      is sent again. Main's phase accounting refuses a duplicate WITH a logged error, by design.
//      The design is right for every other phase and wrong for this one: those are marked once
//      each from a single main-side call site, where a duplicate really is a wiring bug, while
//      this one arrives from a window that is ALLOWED to reload.
//   B. WARNINGS WERE FILED AS ERRORS. `forwardConsoleMessages` wrote every renderer console
//      message of level >= 2 into errors.log, and level 2 is `console.warn`.
//
// WHAT IS DRIVEN HERE AND WHAT IS PINNED. The two rules are pure and are driven for real:
// `consoleForward` (a leaf module with no imports) and `phaseMarked`/`addMark` (shared/perf.ts),
// with the REAL health counter behind them so "no line" and "no count" are one assertion rather
// than two hopes. The two WIRINGS live in modules that cannot load without Electron — an IPC
// handler and a `webContents` listener — so they are pinned as source, the technique
// `tests/healthCounters.test.mts` uses on flush.ts's drain sites and for the same honest reason.
// The end-to-end proof that a real reload writes nothing is `tests/e2e/perf.e2e.mts`, which
// reloads a real window and then greps the errors.log that real launch wrote.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONSOLE_LEVEL_ERROR,
  CONSOLE_LEVEL_WARNING,
  consoleForward
} from '../src/main/consoleForward'
import {
  STARTUP_PHASES,
  addMark,
  describeMarkError,
  phaseMarked,
  type StartupMark
} from '../src/shared/perf'
import { noteErrorLogLine, peekHealth, resetHealth, takeHealth } from '../src/main/telemetry/health'

const TEST_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => readFileSync(join(TEST_ROOT, p), 'utf8')

// --------------------------------------------------------------------------------------- A
//
// The reload half. What the handler does is ASK whether the phase has landed instead of marking
// and being refused, so the two are asserted against each other: the refusal is still there (and
// still logs), and the guard is what stops the app from reaching it.

/** The launch's marks up to and including the renderer's first hydration report. */
function bootedMarks(): StartupMark[] {
  let marks: StartupMark[] = []
  STARTUP_PHASES.forEach((phase, i) => {
    const result = addMark(marks, phase, (i + 1) * 100)
    assert.ok(result.ok, `${phase} should mark on a clean boot`)
    marks = result.marks
  })
  return marks
}

/**
 * The IPC handler's body, exactly as `src/main/ipc/perf.ts` writes it — the guard, then the mark,
 * then the one log line a refusal earns (which is the line the counter counts). Pinned to the real
 * source by `THE WIRING` below, so this cannot drift into testing a fiction.
 */
function rendererHydratedSend(marks: StartupMark[], atMs: number): StartupMark[] {
  if (phaseMarked(marks, 'rendererHydrated')) return marks
  const result = addMark(marks, 'rendererHydrated', atMs)
  if (!result.ok) {
    // `logError` → errors.log → `noteErrorLogLine` (src/main/errorLog.ts).
    noteErrorLogLine()
    return result.marks
  }
  return result.marks
}

test('a RELOAD re-sends rendererHydrated, and it costs nothing — no error line, no count', () => {
  resetHealth()
  const booted = bootedMarks()
  const firstAt = booted.find((m) => m.phase === 'rendererHydrated')?.atMs
  assert.equal(typeof firstAt, 'number')

  // Three reloads: the dev watcher's, the did-fail-load retry's, the crash recovery's. Every one
  // of them re-mounts the hook and sends the mark again.
  let marks = booted
  for (const at of [5_000, 9_000, 240_000]) marks = rendererHydratedSend(marks, at)

  assert.equal(peekHealth().mainErrorLogLines, 0, 'a reload must not increment the error counter')
  assert.equal(marks.filter((m) => m.phase === 'rendererHydrated').length, 1)
  // …and the profile keeps the LAUNCH's own hydration, not the reload four minutes later.
  assert.equal(marks.find((m) => m.phase === 'rendererHydrated')?.atMs, firstAt)
  assert.equal(marks.length, STARTUP_PHASES.length, 'the accounting is otherwise untouched')
  resetHealth()
})

test('…and the refusal it is stepping around is still there, still loud — that is the bug', () => {
  // THE COUNTERFACTUAL. Without the guard, the same second send reaches `addMark`, is refused as a
  // duplicate, and earns the error line that was landing in errors.log on every single reload.
  resetHealth()
  const marks = bootedMarks()
  const unguarded = addMark(marks, 'rendererHydrated', 5_000)
  assert.ok(!unguarded.ok && unguarded.error.code === 'duplicate')
  assert.match(describeMarkError(unguarded.error), /startup phase 'rendererHydrated' was marked twice/)
  noteErrorLogLine()
  assert.equal(takeHealth().mainErrorLogLines, 1, 'the line the fleet was counting')
  resetHealth()
})

test('THE STRICTNESS IS NOT LOOSENED: every other phase still refuses a duplicate', () => {
  // `addMark`'s refusal is load-bearing for the seven phases main marks itself, each from ONE call
  // site in the composition root — a duplicate there is a real wiring bug and must stay a logged
  // refusal. JOS-99 changed the CALLER that can legitimately repeat, not the accounting.
  const marks = bootedMarks()
  for (const phase of STARTUP_PHASES) {
    const again = addMark(marks, phase, 10_000)
    assert.ok(!again.ok && again.error.code === 'duplicate', `${phase} must still refuse a repeat`)
  }
  // And `phaseMarked` answers about the real list rather than being a second opinion beside it.
  for (const phase of STARTUP_PHASES) assert.equal(phaseMarked(marks, phase), true)
  assert.equal(phaseMarked([], 'rendererHydrated'), false)
})

// --------------------------------------------------------------------------------------- B
//
// The warnings half. `consoleForward` is the whole rule; the levels are Electron's own
// (0=verbose 1=info 2=warning 3=error).

test('errors.log records level 3 ONLY — a warning is not an error', () => {
  for (const packaged of [true, false]) {
    assert.equal(consoleForward(CONSOLE_LEVEL_ERROR, packaged), 'errorLog', 'an error is an error')
    assert.notEqual(consoleForward(CONSOLE_LEVEL_WARNING, packaged), 'errorLog')
    assert.equal(consoleForward(1, packaged), 'drop', 'info was never forwarded')
    assert.equal(consoleForward(0, packaged), 'drop', 'verbose was never forwarded')
  }
  // A level past `error` (Electron has none today) is still an error rather than a hole.
  assert.equal(consoleForward(9, false), 'errorLog')
  // An unreadable severity is not evidence of an error, and this file's line count is a statistic.
  assert.equal(consoleForward(Number.NaN, false), 'drop')
})

test('…while DEV VISIBILITY survives: an unpackaged build still prints warnings to stdout', () => {
  // The point of the forwarding in the first place is that an agent watching `npm run dev` output
  // sees renderer-side trouble. That is unchanged for warnings — only the sink they were wrongly
  // sharing with errors is taken away.
  assert.equal(consoleForward(CONSOLE_LEVEL_WARNING, false), 'stdout')
  // A packaged build has no such reader, so the message is dropped rather than written anywhere.
  assert.equal(consoleForward(CONSOLE_LEVEL_WARNING, true), 'drop')
})

test('THE COUNT follows the file: four levels through the real counter, one line', () => {
  // The production shape, with the REAL health counter behind it: only the `errorLog` branch
  // reaches `logError`, and only `logError` calls `noteErrorLogLine`.
  resetHealth()
  for (const level of [0, 1, 2, 3]) {
    if (consoleForward(level, false) === 'errorLog') noteErrorLogLine()
  }
  assert.equal(takeHealth().mainErrorLogLines, 1, 'one console.error, and nothing else, is counted')
  // A window that only ever warns contributes NOTHING to the fleet's error rate — which is the
  // whole reading this ticket came from.
  for (let i = 0; i < 50; i++) {
    if (consoleForward(CONSOLE_LEVEL_WARNING, false) === 'errorLog') noteErrorLogLine()
  }
  assert.equal(takeHealth().mainErrorLogLines, 0)
  resetHealth()
})

// ----------------------------------------------------------------------------------- wiring

test('THE WIRING: both fixes are where the argument says, in code that needs Electron to run', () => {
  // A. the IPC handler ASKS before it marks, and the guard is the first thing in the handler.
  const perfIpc = read('src/main/ipc/perf.ts')
  const handler = perfIpc.slice(perfIpc.indexOf('ipcMain.on(IPC.perfRendererHydrated'))
  assert.ok(
    handler.indexOf("startupPhaseMarked('rendererHydrated')") <
      handler.indexOf("markStartupPhase('rendererHydrated')"),
    'the repeat must be ignored BEFORE the mark that would log a refusal'
  )
  assert.match(handler, /if \(startupPhaseMarked\('rendererHydrated'\)\) return/)
  // …and it asks the accounting itself rather than keeping a second boolean beside it.
  assert.match(read('src/main/perf.ts'), /export function startupPhaseMarked[\s\S]*?phaseMarked\(marks, phase\)/)

  // B. the console forwarder routes through the rule, and `logError` is reachable ONLY from the
  //    error branch. The old `level < 2` gate — which is what let warnings in — is gone.
  const windowErrors = read('src/main/windowErrors.ts')
  const forward = windowErrors.slice(
    windowErrors.indexOf('export function forwardConsoleMessages'),
    windowErrors.indexOf('export function captureMainWindowErrors')
  )
  assert.match(forward, /consoleForward\(level, app\.isPackaged\)/)
  assert.doesNotMatch(forward, /if \(level < 2\) return/)
  assert.match(forward, /if \(where === 'stdout'\) logWarn\(/)
  assert.match(forward, /else logError\(tag, \{ level, message, source \}\)/)

  // The rule is a LEAF — no imports at all — which is why this suite can drive the real thing with
  // no Electron in the process (`src/main/telemetry/health.ts`'s argument, for its reason).
  const rule = read('src/main/consoleForward.ts')
  assert.doesNotMatch(rule, /^\s*import\s/m, 'consoleForward.ts must import nothing')
})

test('THE DOC says what the counter counts, in the file users are pointed at', () => {
  // TELEMETRY.md is generated from `src/shared/telemetryDoc.ts` (tests/telemetryDoc.test.mts pins
  // the parity), so the promise about this field is asserted where a user would read it.
  const row = read('TELEMETRY.md')
    .split(/\r?\n/)
    .find((l) => l.includes('`mainErrorLogLines`'))
  assert.ok(row, 'TELEMETRY.md documents the counter')
  assert.match(row, /[Ee]rrors only/, 'the doc must not promise it counts warnings')
})
