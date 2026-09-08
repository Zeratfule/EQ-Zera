// ============================================================================
// consoleForward.ts — what a RENDERER console message is worth (JOS-99).
// ============================================================================
//
// One pure decision, split out of `windowErrors.ts` for the same reason `telemetry/health.ts` is a
// leaf: this file imports NOTHING, so `tests/errorCounterHygiene.test.mts` drives the real
// production rule with no Electron in the process. Everything around it — the listener, the two
// sinks, the source tag — stays in `windowErrors.ts`, which is where the wiring belongs.
//
// THE RULE IT ENCODES, and why it changed. `errors.log` is read as "what went wrong", and the
// fleet health counter (`mainErrorLogLines`) counts its lines — so whatever lands in that file is
// what the fleet reports as errors. Forwarding every renderer `console.warn` into it made those
// two claims false at once: 3,859 error-log lines across 3,728 reports with ZERO renderer crashes,
// most of them warnings that nothing was ever going to act on. A warning is a warning; it is not
// an error, and it does not get to be counted as one.
//
// DEV VISIBILITY IS NOT THE THING BEING REMOVED. An unpackaged build still prints warnings to
// stdout, so an agent watching the `npm run dev` task output sees a renderer warning exactly as it
// did before. What changes is that the line does not enter `errors.log` and therefore does not
// enter the count. A packaged build drops it entirely: there is no stdout anyone is reading.

/** Electron's `console-message` levels: 0=verbose 1=info 2=warning 3=error. */
export const CONSOLE_LEVEL_WARNING = 2
export const CONSOLE_LEVEL_ERROR = 3

/**
 * Where a forwarded renderer console message goes.
 *
 * `stdout` is deliberately a THIRD state rather than a flavour of `errorLog`: the two sinks used
 * to be one decision (`logError` writes both), and keeping them separable is the entire fix.
 */
export type ConsoleForward = 'drop' | 'stdout' | 'errorLog'

/**
 * Decide the fate of one renderer console message.
 *
 *   level >= 3 (error)   → `errorLog`: the file, the dev stdout line, and the health count.
 *   level == 2 (warning) → `stdout` while unpackaged, so dev output is unchanged; `drop` when
 *                          packaged, where no one is reading stdout and the only effect would be
 *                          a file the user never asked for.
 *   level <  2           → `drop`, exactly as before: verbose and info were never forwarded.
 *
 * A level that is not a real number falls through every comparison and is DROPPED. That is the
 * safe direction here — this function's whole job is to keep noise out of a file whose line count
 * is a fleet-wide statistic, and a message whose severity is unreadable is not evidence of an
 * error.
 */
export function consoleForward(level: number, packaged: boolean): ConsoleForward {
  if (level >= CONSOLE_LEVEL_ERROR) return 'errorLog'
  if (level === CONSOLE_LEVEL_WARNING) return packaged ? 'drop' : 'stdout'
  return 'drop'
}
