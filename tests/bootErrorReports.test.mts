// ============================================================================
// bootErrorReports.test.mts — JOS-272 (iv): the errors raised before the pipeline exists.
// ============================================================================
//
// THE BLIND SPOT, stated as the ticket found it. `src/main/store.ts` runs the settings-schema
// migration from MODULE SCOPE — deliberately, before `new Store()`, so no reader can ever observe a
// pre-migration shape — and the one thing a torn store write produces is the `store schema: … is
// not valid JSON` line that path logs. `logError` funnels it into `errorReports.pending` exactly as
// it funnels every other main-process error.
//
// And then it was deleted. `startTelemetry` runs much later (after the window exists, after the log
// tail attaches), and the first thing it does is `beginSession()`, whose first act was
// `resetErrorReports(now)` — a `pending.clear()`. So the single most diagnostic event this app can
// produce about a settings reset could never reach the fleet's error store, and neither could any
// other module-scope error. The ticket calls it "structurally unobservable", and it was.
//
// THE FIX IS ONE PARAMETER, and it is tested as one. `resetErrorReports(now, keepPending)` decides
// nothing on its own; `collector.ts` counts sessions and passes `true` for the first one only. That
// split is why this suite can drive the whole rule with no Electron in the process: the retention
// is a function of an argument, not of a latch this file would have to reach into.
//
// The last test closes the loop the ticket actually cares about: it takes the REAL message
// `migrateStoreFile` emits for a torn store, files it the way boot files it, brings a session up,
// and reads it back out of the drain.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  noteError,
  peekErrorReports,
  resetErrorReports,
  takeErrorReports
} from '../src/main/telemetry/errorReports'
import { migrateStoreFile } from '../src/main/storeFile'

/** The boot state of a fresh process: no session, nothing held. `now = 0` is how `endSession`
 *  spells "there is no session", and it clears unconditionally — so it is also the cleanest way for
 *  a test to get back to the starting line without owning any of this module's internals. */
function atBoot(): void {
  resetErrorReports(0)
}

test('an error filed before any session survives INTO the first one', () => {
  atBoot()
  noteError('main:storeSchema', 'store schema: the store is not valid JSON')
  assert.equal(peekErrorReports().length, 1, 'it was recorded at boot, as it always was')

  // `beginSession()` for the first session of the process.
  resetErrorReports(1_000_000, true)

  const drained = takeErrorReports()
  assert.equal(drained.length, 1, 'and it is still there when the pipeline comes up')
  assert.equal(drained[0].count, 1)
  assert.ok(drained[0].redactedMessage.includes('is not valid JSON'))
  // It happened before the session clock started, so the honest age is the bottom bucket rather
  // than a number invented from the session it is reported in.
  assert.equal(drained[0].sessionAgeBucket, 0)
  atBoot()
})

test('repeats filed at boot arrive as ONE report carrying its count', () => {
  atBoot()
  for (let i = 0; i < 4; i++) noteError('main:storeSchema', 'store schema: the store is not valid JSON')
  resetErrorReports(1_000_000, true)

  const drained = takeErrorReports()
  assert.equal(drained.length, 1)
  assert.equal(drained[0].count, 4)
  atBoot()
})

test('every LATER session boundary still starts empty — the default is unchanged', () => {
  atBoot()
  resetErrorReports(1_000_000, true) // the first session
  noteError('main:uncaughtException', new Error('mid-session'))
  assert.equal(peekErrorReports().length, 1)

  resetErrorReports(2_000_000) // a second session: no flag, so it clears
  assert.deepEqual(peekErrorReports(), [], 'a new session does not inherit the last one')
  atBoot()
})

test('a switch turned OFF and back ON does not resurrect what was filed while it was off', () => {
  // `endSession()` → `resetErrorReports(0)`; `resumeTelemetry()` → `beginSession()`, which by then
  // has a non-zero `sessionsBegun` and therefore passes false. The promise in `endSession`'s own
  // docstring — a session the user opted out of leaves nothing waiting — is what this pins.
  atBoot()
  resetErrorReports(1_000_000, true)
  resetErrorReports(0) // the user turned it off
  noteError('main:uncaughtException', new Error('filed while off'))
  assert.equal(peekErrorReports().length, 1, 'noteError has no switch of its own; the drain is the gate')

  resetErrorReports(3_000_000) // turned back on — NOT the boot window
  assert.deepEqual(peekErrorReports(), [], 'and the off-window errors go with it')
  atBoot()
})

test('THE SOURCE PIN: collector.ts is what decides, and only for the first session', () => {
  // The retention rule lives in two files on purpose — the flag in `errorReports.ts`, the count of
  // sessions in `collector.ts`, which is the module that knows what a session is. `collector.ts`
  // imports Electron and the store, so it cannot be driven from here; this is the assertion that
  // holds the wiring together.
  const src = readFileSync(new URL('../src/main/telemetry/collector.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('resetErrorReports(now, sessionsBegun === 0)'), 'beginSession keeps, once')
  assert.ok(src.includes('sessionsBegun += 1'), 'and the counter really advances')
  assert.ok(src.includes('resetErrorReports(0)'), 'endSession clears, with no flag at all')
  // The count is set exactly ONCE — at its declaration — and never decremented. Winding it back
  // would re-open the boot window mid-run, which is how the errors filed while the switch was off
  // would ride into the session the user turned back on.
  assert.equal((src.match(/sessionsBegun\s*=\s*0\b/g) ?? []).length, 1, 'only the declaration')
  assert.equal(/sessionsBegun\s*-=/.test(src), false, 'and nothing decrements it')
})

test('THE QUARANTINE EVENT, end to end: the real message reaches the drain', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-boot-error-'))
  try {
    // 1. A store torn past recovery, read exactly the way `store.ts` reads it at module scope.
    const path = join(dir, 'everquest-companion-progress.json')
    writeFileSync(path, '{"schemaVersion":11,"alerts":[{"id":"charm', 'utf8')

    atBoot()
    const out = migrateStoreFile(path, {
      // 2. …wired to the error sink exactly as store.ts wires it: `logError('main:storeSchema', m)`,
      //    which is `noteError` plus the two log lines this suite has no console for.
      error: (message) => {
        noteError('main:storeSchema', message)
      }
    })
    assert.equal(out.salvagedFrom, undefined, 'this one really is unrecoverable')
    assert.ok(out.quarantinedPath, 'and it really was quarantined')

    // 3. The pipeline comes up, minutes later, for the first time this process.
    resetErrorReports(1_000_000, true)

    const drained = takeErrorReports()
    assert.equal(drained.length, 1, 'the event the fleet has never seen once')
    assert.ok(drained[0].fingerprint.length > 0, 'and it has an identity the error store can group on')
    // AND IT IS STILL LEGIBLE AFTER REDACTION, which is the whole reason `migrateStoreFile` puts
    // the verdict ahead of the paths: `redactMessage` replaces the first path-shaped run with
    // `<path>` and takes the rest of the line with it. The two things worth counting fleet-wide —
    // that this happened at all, and whether the user kept their settings — both survive.
    assert.equal(
      drained[0].redactedMessage,
      'store schema: the store file is not valid JSON, starting from defaults - <path>'
    )
  } finally {
    atBoot()
    rmSync(dir, { recursive: true, force: true })
  }
})
