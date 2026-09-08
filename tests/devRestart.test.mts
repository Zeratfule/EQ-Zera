// The dev restart button's decision (JOS-61, rebuilt in JOS-63 — src/main/devRestart.ts).
//
// TWO THINGS ARE PINNED HERE and they fail in different directions:
//
//   1. THE PACKAGED GUARD. The channel is registered in EVERY build (src/main/ipc/dev.ts), so
//      the thing that keeps a shipped app safe is this predicate and nothing else.
//   2. WHICH RESTART. Under `npm run dev` an `exit(0)` ends the electron-vite WATCHER (its CLI
//      does `ps.on('close', process.exit)`) and takes the renderer's dev server with it, so the
//      relaunched successor loads a URL that no longer answers — the blank window JOS-63 exists
//      to kill. With a dev server present the decision must therefore TOUCH the watch anchor and
//      never relaunch; with no dev server it must still relaunch, because that path is correct
//      when the renderer comes off disk.
//
// It is a pure function over injected hosts precisely so both directions can be asserted:
// `relaunch()` + `exit(0)` against the real Electron `app` would end the test runner.
//
// No Electron, no fixtures, no network — the security.test.mts / storeMigrations.test.mts
// precedent, so this suite never skips. The one filesystem fact it does assert is that the watch
// anchor still names a real file in this repo (a moved anchor would silently downgrade every dev
// restart to a refusal).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  performDevRestart,
  touchFile,
  WATCH_ANCHOR,
  type RestartHost,
  type WatchContext
} from '../src/main/devRestart'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** A stand-in for Electron's `app`, recording what was asked of it. */
function spyHost(isPackaged: boolean): RestartHost & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isPackaged,
    relaunch: () => calls.push('relaunch'),
    exit: (code?: number) => calls.push(`exit:${String(code)}`)
  }
}

/** A stand-in for the world outside Electron, recording every file it was asked to touch. */
function spyCtx(
  rendererUrl: string | undefined,
  opts: { roots?: readonly string[]; missing?: readonly string[] } = {}
): WatchContext & { touched: string[] } {
  const touched: string[] = []
  const missing = opts.missing ?? []
  return {
    touched,
    rendererUrl,
    roots: opts.roots ?? ['C:\\repo'],
    touch: (file: string) => {
      // The real `touchFile` throws ENOENT on a path that is not there; the fake reproduces that,
      // because "try the next root" is the whole reason the roots are a list.
      if (missing.some((m) => file.startsWith(m))) throw new Error(`ENOENT: ${file}`)
      touched.push(file)
    }
  }
}

test('packaged: a NO-OP — nothing is called, nothing is touched, and the refusal is reported', () => {
  const host = spyHost(true)
  const ctx = spyCtx(undefined)
  assert.deepEqual(performDevRestart(host, ctx), { action: 'refused', detail: 'packaged build' })
  assert.deepEqual(host.calls, [])
  assert.deepEqual(ctx.touched, [])
})

test('packaged: still refuses WITH a dev server present — the guard outranks every other input', () => {
  // A packaged build has no dev server, but the guard must not depend on that being true: it is
  // the first question asked, and no environment makes a shipped app restartable over IPC.
  const host = spyHost(true)
  const ctx = spyCtx('http://localhost:5173')
  assert.equal(performDevRestart(host, ctx).action, 'refused')
  assert.deepEqual(host.calls, [])
  assert.deepEqual(ctx.touched, [])
})

test('no dev server: queues the relaunch, THEN exits — that order, code 0', () => {
  const host = spyHost(false)
  const ctx = spyCtx(undefined)
  assert.deepEqual(performDevRestart(host, ctx), { action: 'relaunched' })
  // `relaunch()` only queues the successor; it starts once this process is gone. Exiting first
  // would therefore restart nothing, so the order is part of the contract, not a style choice.
  assert.deepEqual(host.calls, ['relaunch', 'exit:0'])
  assert.deepEqual(ctx.touched, [])
})

test('an EMPTY ELECTRON_RENDERER_URL is no dev server, not a dev server with no address', () => {
  const host = spyHost(false)
  assert.equal(performDevRestart(host, spyCtx('')).action, 'relaunched')
  assert.deepEqual(host.calls, ['relaunch', 'exit:0'])
})

test('dev server: touches the watch anchor and NEVER exits — the blank window is exactly this', () => {
  // The JOS-61 bug in one assertion. `exit(0)` here kills the electron-vite CLI (it wires
  // `ps.on('close', process.exit)`), the renderer's Vite dev server dies with it, and the
  // relaunched successor loads a URL that answers nothing. So with a dev server present, the
  // process must survive the click and let the watcher perform the restart.
  const host = spyHost(false)
  const ctx = spyCtx('http://localhost:5173')
  const result = performDevRestart(host, ctx)
  assert.equal(result.action, 'watcher')
  assert.deepEqual(host.calls, [])
  assert.deepEqual(ctx.touched, [join('C:\\repo', WATCH_ANCHOR)])
  assert.equal(result.detail, join('C:\\repo', WATCH_ANCHOR))
})

test('dev server: falls through to the next root, and touches exactly ONE anchor', () => {
  // The handler passes `app.getAppPath()` then `process.cwd()`. Either can be the project root
  // depending on how Electron was started, so the first that HAS the anchor wins — and the loop
  // stops there rather than touching several files and triggering several rebuilds.
  const host = spyHost(false)
  const ctx = spyCtx('http://localhost:5173', {
    roots: ['C:\\wrong', 'C:\\repo'],
    missing: ['C:\\wrong']
  })
  assert.equal(performDevRestart(host, ctx).action, 'watcher')
  assert.deepEqual(ctx.touched, [join('C:\\repo', WATCH_ANCHOR)])
})

test('dev server, no anchor anywhere: refuses and NAMES the roots it tried', () => {
  // Never a silent no-op: a button that does nothing and says nothing is the failure mode this
  // whole ticket is about. The refusal reaches the caption under the button.
  const host = spyHost(false)
  const ctx = spyCtx('http://localhost:5173', {
    roots: ['C:\\a', 'C:\\b'],
    missing: ['C:\\a', 'C:\\b']
  })
  const result = performDevRestart(host, ctx)
  assert.equal(result.action, 'refused')
  assert.deepEqual(ctx.touched, [])
  assert.match(result.detail ?? '', /C:\\a/)
  assert.match(result.detail ?? '', /C:\\b/)
  assert.match(result.detail ?? '', /devRestart\.ts/)
  assert.deepEqual(host.calls, [])
})

test('the guard is the ONLY input for a packaged host — it refuses however often it is asked', () => {
  const packaged = spyHost(true)
  const ctx = spyCtx('http://localhost:5173')
  for (let i = 0; i < 5; i++) assert.equal(performDevRestart(packaged, ctx).action, 'refused')
  assert.deepEqual(packaged.calls, [])
  assert.deepEqual(ctx.touched, [])
})

test('Electron IS the host shape — the handler passes `app` itself, unadapted', () => {
  // A structural check standing in for the type system's own: if a future Electron renames
  // `exit` or `relaunch`, src/main/ipc/dev.ts stops compiling. This asserts the SHAPE this
  // module demands has not quietly grown a member the real `app` would not have — everything
  // else the decision reads is injected as a separate `WatchContext`, deliberately, so this
  // half stays satisfiable by Electron's own object.
  const host: RestartHost = { isPackaged: false, relaunch: () => undefined, exit: () => undefined }
  assert.deepEqual(Object.keys(host).sort(), ['exit', 'isPackaged', 'relaunch'])
})

test('THE ANCHOR IS A REAL FILE IN THIS REPO — and it is this module, which is why it is watched', () => {
  // The trick rests on rollup watching every module it bundled: a file that is EXECUTING is
  // necessarily in the graph. That argument only holds while `WATCH_ANCHOR` still names the
  // module itself, so a rename or a move must break here rather than in the owner's dev app.
  assert.equal(WATCH_ANCHOR, 'src/main/devRestart.ts')
  assert.ok(existsSync(join(REPO_ROOT, WATCH_ANCHOR)), `${WATCH_ANCHOR} is not in the repo`)
})

test('touchFile changes the mtime and NOT a byte — a git-invisible poke at the watcher', () => {
  // A TEMP file, deliberately, NOT the real anchor: touching the anchor is exactly what makes a
  // running `npm run dev` rebuild and relaunch, and a unit suite must never restart the owner's
  // dev app as a side effect of being run. What is asserted here is `utimesSync`'s semantics —
  // the mtime moves, the bytes do not — which is all the anchor path needs from it.
  const scratch = join(mkdtempSync(join(tmpdir(), 'eqc-devrestart-')), 'anchor.ts')
  writeFileSync(scratch, 'export const x = 1\n')
  const past = new Date(Date.now() - 60_000)
  utimesSync(scratch, past, past)
  const before = statSync(scratch)
  assert.equal(before.mtimeMs, past.getTime())

  touchFile(scratch)

  const after = statSync(scratch)
  assert.ok(after.mtimeMs > past.getTime(), 'touchFile did not advance the mtime')
  assert.equal(after.size, before.size)
  assert.equal(readFileSync(scratch, 'utf8'), 'export const x = 1\n')
  rmSync(dirname(scratch), { recursive: true, force: true })
})

test('touchFile THROWS on a path that is not there — which is what makes a refusal possible', () => {
  assert.throws(() => touchFile(join(REPO_ROOT, 'src', 'main', 'no-such-file-JOS63.ts')))
})
