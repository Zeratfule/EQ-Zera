// ============================================================================
// devRestart — "restart the app" for a dev build, and the two completely different things that
// has to mean depending on WHO IS SUPERVISING THIS PROCESS (JOS-61, corrected by JOS-63).
// ============================================================================
//
// WHY IT EXISTS. Hand-testing startup performance means launching the app over and over, and
// the Performance section already shows the phase-by-phase breakdown of the launch you are in.
// A button beside that readout closes the loop: restart, read the new numbers, repeat — without
// leaving the app for a terminal.
//
// ---------------------------------------------------------------------------
// WHAT JOS-61 GOT WRONG, AND WHY THE ANSWER IS A BLANK WINDOW
// ---------------------------------------------------------------------------
//
// The first version was `app.relaunch()` + `app.exit(0)` unconditionally. Under `npm run dev`
// the owner clicked it and got a BLANK WINDOW. That is not a bug in Electron's idiom — it is
// what the supervisor above us does when we exit. Read against the INSTALLED electron-vite
// (5.0.0, node_modules/electron-vite/dist/**, which is what actually runs here):
//
//   • The CLI SPAWNS Electron as a child and ties its own life to it:
//       `const ps = spawn(electronPath, [entry].concat(args), { stdio: 'inherit' })`
//       `ps.on('close', process.exit)`                    — chunks/lib-q6ns0vZr.js:238-239
//     So `app.exit(0)` does not end "the app" — it ends the WATCHER. And the renderer's Vite
//     dev server lives inside that same CLI process (`server = await createServer(rendererViteConfig)`,
//     `process.env.ELECTRON_RENDERER_URL = …` — chunks/lib-7y7CgM8M.js:58-67), so it dies with it.
//
//   • `app.relaunch()` queues a SUCCESSOR that starts after we are gone, inheriting our env —
//     including `ELECTRON_RENDERER_URL`, which by then points at a dev server that no longer
//     exists. `windows.ts` loads that URL (it is the dev branch of `loadURL`/`loadFile`), the
//     load fails, and the window has nothing in it. Blank. The orphan then holds the dev
//     channel's single-instance lock (channel.ts: one userData dir per channel ⇒ one lock), so
//     a fresh `npm run dev` cannot even start beside it.
//
// The measured proof that the successor really is spawned and really does outlive the CLI is
// the owner's own bug report: there WAS a window, and it WAS blank.
//
// ---------------------------------------------------------------------------
// SO ASK THE WATCHER INSTEAD — ITS ONE RESTART CONTRACT IS A MAIN-PROCESS REBUILD
// ---------------------------------------------------------------------------
//
// electron-vite offers no restart IPC, no keypress ('rs' style), no exit-code contract — the
// close handler above is `process.exit` with the child's own code, so no exit code escapes it.
// (Grepped: the only `stdin` in the whole CLI bundle is the bytecode plugin's, lib-q6ns0vZr.js:1169.)
// There is EXACTLY ONE code path that relaunches Electron, and it is the main-process watch hook:
//
//     const watchHook = () => {
//       logger.info(colors.green(`\nelectron main process rebuilt successfully`))
//       if (ps) { ps.removeAllListeners(); ps.kill(); ps = startElectron(inlineConfig.root)
//                 logger.info(colors.green(`\nrestarting electron app...\n`)) }
//     }                                                  — chunks/lib-7y7CgM8M.js:27-35
//
// `removeAllListeners()` first, so this kill does NOT trip `ps.on('close', process.exit)`: the
// CLI survives, the Vite dev server survives, and the successor is launched by the CLI with the
// same args — which is precisely the restart the button wanted in the first place.
//
// That hook is wired as a rollup `closeBundle` plugin on every build AFTER the first
// (`doBuild(mainViteConfig, watchHook, errorHook)`, and `firstBundle` gating inside it —
// lib-7y7CgM8M.js:36 and 78-108), and it exists only when `config.build.watch` is set, which is
// only under `--watch` (`...(options.w || options.watch ? { watch: {} } : null)` — cli.js:19).
// `npm run dev` is `electron-vite dev --watch`, so this is the owner's everyday shape.
//
// THEREFORE: in a dev-server run, a restart is a TOUCH. Update the mtime of a source file that
// is in the main bundle's module graph; rollup's file watcher invalidates it, vite rebuilds, the
// hook fires, and the watcher kills and relaunches us with the dev server still up.
//
// MEASURED, not reasoned (own watcher instance, worktree, 2026-08-06): an mtime-only touch of
// this file — byte-identical content, verified by SHA — produced `electron main process rebuilt
// successfully` (1.9 s), `restarting electron app...`, the old Electron pid replaced by a new one
// under the SAME watcher pid, and a fresh `rendererHydrated` in the startup profile. The window
// renders because the dev server never went anywhere.
//
// THE ANCHOR IS THIS FILE, and that is the whole trick's safety: rollup watches every module it
// bundled, and if this module were not in the main bundle the code you are reading would not be
// running. There is no gitignored sentinel to invent, no watch glob to guess, and nothing to add
// to the tree. An mtime touch changes no bytes, so `git status` cannot see it and neither can
// TypeScript's incremental builder (it versions files by content hash).
//
// ---------------------------------------------------------------------------
// THE THREE ANSWERS
// ---------------------------------------------------------------------------
//
//   packaged                     → 'refused'. Unchanged from JOS-61 and still the point: the
//                                  channel is registered in every build, so a shipped app must
//                                  be provably inert even if the channel is reached. Nothing
//                                  shipped should be one IPC call away from being killed, and
//                                  the update flow has its own relaunch (`quitAndInstall`).
//   dev, ELECTRON_RENDERER_URL   → 'watcher'. Touch the anchor and let the supervisor restart us.
//   dev, no dev server           → 'relaunched'. `relaunch()` + `exit(0)`, the JOS-61 path, kept
//                                  because it is CORRECT here: nobody is serving the renderer
//                                  over http (`electron-vite preview` starts Electron with no
//                                  server at all — lib-Dvh2Hokw.js:16-23), so the successor loads
//                                  the built `out/renderer/index.html` off disk and comes up fine.
//
// `ELECTRON_RENDERER_URL` is the honest discriminator because it is set in exactly one place —
// when the CLI actually stood a renderer dev server up — and it is the SAME variable windows.ts
// keys the dev/prod load branch off. If it is present, a blank window is what `exit(0)` buys.
//
// AND SAID PLAINLY: today's BUTTON can only ever reach the 'watcher' branch. Its gate is
// `DEV_TOOLS` → `import.meta.env.DEV`, which is true exactly when a vite dev server is serving
// the renderer — so a click implies `ELECTRON_RENDERER_URL`. The relaunch branch is kept because
// the CHANNEL exists in every build and is the handler's whole contract, not the button's: any
// caller reaching `dev:restart` from a run with a renderer on disk (an `electron-vite preview`,
// a future dev entry point) gets the answer that is correct there. It is asserted by the unit
// suite rather than by a live click, and that is stated rather than implied.
//
// THE ONE THING THIS CANNOT SEE is `--watch` itself: the flag never reaches the child (no env,
// no argv). A bare `electron-vite dev` (npm run start) has a dev server but no watch hook, so the
// touch is a no-op and nothing restarts. That is not papered over: the handler answers 'watcher',
// the renderer waits, and if the process is still alive some seconds later the button SAYS so
// (PerfSetting.tsx). Refusing to guess beats guessing wrong, and it can never blank the window.
//
// WHY THE LOGIC IS HERE AND NOT IN THE HANDLER. `relaunch()` + `exit(0)` cannot be exercised
// against the real Electron `app` in a unit test — calling it would end the test runner. So the
// decision is a pure function over injected hosts, and the handler (ipc/dev.ts) passes Electron's
// `app` (which satisfies `RestartHost` structurally) plus the environment it reads. That is the
// `security.ts` pattern: policy in a plain module with no Electron import, so
// `tests/devRestart.test.mts` runs every branch and never skips.

import { utimesSync } from 'fs'
import { join } from 'path'
import type { DevRestartResult } from '../shared/devRestart'

export type { DevRestartAction, DevRestartResult } from '../shared/devRestart'

/**
 * The file whose mtime is bumped to ask the watcher for a rebuild — THIS file, relative to the
 * project root. See the header: a module that is executing is necessarily in the bundle rollup
 * is watching, which is what makes the anchor self-proving rather than a guess about watch globs.
 * `tests/devRestart.test.mts` pins that this path still resolves to a real file.
 */
export const WATCH_ANCHOR = 'src/main/devRestart.ts'

/** The slice of Electron's `app` a restart needs. Electron's own object satisfies it. */
export interface RestartHost {
  readonly isPackaged: boolean
  relaunch: () => void
  exit: (code?: number) => void
}

/** Everything outside Electron the decision reads, injected so the tests can drive both worlds. */
export interface WatchContext {
  /**
   * `process.env.ELECTRON_RENDERER_URL` — set by `electron-vite dev` when it stands the renderer
   * dev server up (lib-7y7CgM8M.js:67) and by nothing else. Present ⇒ a supervisor owns us.
   */
  readonly rendererUrl: string | undefined
  /**
   * Candidate project roots, in order. The handler passes `app.getAppPath()` (an unpackaged
   * Electron resolves the `.` entry electron-vite spawns it with, so this is the project root)
   * and `process.cwd()` (the CLI's cwd, inherited through `spawn` — lib-q6ns0vZr.js:238). Two
   * chances, both facts about how this process was started; no search, no guessing.
   */
  readonly roots: readonly string[]
  /** Bump a file's mtime without changing a byte. Throws when the file is not there. */
  touch: (file: string) => void
}

/**
 * Bump `file`'s mtime to now, changing no content — the default `WatchContext.touch`.
 *
 * `utimesSync` sets atime and mtime together; Windows reports that as a LAST_WRITE change, which
 * is what libuv's watcher (and therefore chokidar, and therefore rollup) wakes on. Verified live,
 * see the header. Throws ENOENT when the path is wrong, which is how a moved anchor becomes a
 * REFUSAL with a reason instead of a button that quietly does nothing.
 */
export function touchFile(file: string): void {
  const now = new Date()
  utimesSync(file, now, now)
}

/**
 * Restart the app — by the route this process's supervisor actually supports.
 *
 * @returns what was done. In the 'relaunched' case the process is gone before the reply can be
 * delivered, which is expected; 'watcher' means the request is in flight and the caller should
 * expect to die in a few seconds, not immediately.
 */
export function performDevRestart(host: RestartHost, ctx: WatchContext): DevRestartResult {
  if (host.isPackaged) return { action: 'refused', detail: 'packaged build' }

  // No dev server ⇒ nobody is supervising the renderer over http, so the ordinary Electron idiom
  // is correct: queue the successor, THEN exit (`relaunch()` only queues — exiting first would
  // restart nothing, so the order is part of the contract).
  if (ctx.rendererUrl === undefined || ctx.rendererUrl === '') {
    host.relaunch()
    host.exit(0)
    return { action: 'relaunched' }
  }

  for (const root of ctx.roots) {
    const anchor = join(root, WATCH_ANCHOR)
    try {
      ctx.touch(anchor)
      return { action: 'watcher', detail: anchor }
    } catch {
      // Wrong root (or a moved anchor) — try the next one, and refuse out loud if none works.
    }
  }
  return { action: 'refused', detail: `no ${WATCH_ANCHOR} under: ${ctx.roots.join(', ')}` }
}
