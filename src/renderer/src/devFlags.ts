// The tier-2 policy — see the OWNER_TOOLS block below, and src/shared/ownerTools.ts.
import { ownerToolsGranted } from '@shared/ownerTools'

// ============================================================================
// devFlags — the ONE reference to `__EQ_DEV_TOOLS__` in the renderer, and the reason it is
// written the way it is.
// ============================================================================
//
// `__EQ_DEV_TOOLS__` is a compile-time `define` from electron.vite.config.ts. Two facts about
// vite `define` decide the shape of this file:
//
//   1. IT STRIPS. `electron-vite build` substitutes `false`, so `DEV_TOOLS` folds to a literal
//      and every branch guarded by it — the nav row, the content route, the
//      `lazy(() => import('./features/triage/…'))` — becomes dead code that rollup deletes.
//      Nothing of the triage feature reaches `out/renderer`. Proven by grep, not by intent.
//
//   2. IT ONLY EXISTS FROM THE MOMENT A DEV SERVER STARTED. A `define` is baked in when the
//      server boots and CONFIG CHANGES NEVER HOT-APPLY. A long-running `npm run dev` that
//      predates the config edit therefore serves a world where the identifier is simply not
//      declared — and a bare reference to an undeclared global is a `ReferenceError`, not
//      `undefined`. That is exactly what happened while this feature was being built: the
//      owner's running dev app threw `ReferenceError: __EQ_DEV_TOOLS__ is not defined` out of
//      appViews.ts at module scope, App never mounted, and the window went blank.
//
// THE RULE, and why it changed. `typeof … !== 'undefined' && __EQ_DEV_TOOLS__` was safe against
// the ReferenceError, but it made a stale server read as `false` — the dev tab silently VANISHED
// with no error anywhere, which cost the owner a debugging session a second time. A missing
// define is not evidence that dev tools are unwanted; it is evidence that the server is old.
//
// So the anchor is `import.meta.env.DEV`, vite's OWN builtin: it needs no config, it is true on
// any dev server no matter when it booted, and it is substituted with a literal `false` in every
// build (`electron-vite build`, and therefore every installer and `npm run test:e2e`). The
// `__EQ_DEV_TOOLS__` term is kept as an OVERRIDE for the one thing the builtin cannot express —
// a deliberate `false` from a config that DOES have the define — and `typeof` still guards it so
// a stale server evaluates without throwing.
//
//   dev server, define present  → DEV && __EQ_DEV_TOOLS__  (true under `electron-vite dev`)
//   dev server, define STALE    → DEV && true              → tab visible, degrade UPWARD
//   production build            → false && …               → folds to `false`, branch deleted
//
// The strip guarantee is unchanged: `import.meta.env.DEV` is a literal `false` in a build, so
// `false && (…)` folds exactly as before and rollup deletes everything behind it. Asserted end
// to end by tests/e2e/feedback.e2e.mts (`nav-triage` must be ABSENT in a production-shaped run).
//
// EVERY gate reads `DEV_TOOLS` from here. One reference, one place to get this right — and
// src/renderer/src/main.tsx logs the resolved value at boot so "the tab is missing" is one
// glance at the console instead of an archaeology dig.
export const DEV_TOOLS: boolean =
  import.meta.env.DEV && (typeof __EQ_DEV_TOOLS__ === 'undefined' || __EQ_DEV_TOOLS__)

/** What the `define` itself said — `undefined` means "this bundle predates it", i.e. a STALE dev
 *  server. Exported for the boot log in main.tsx ONLY, so that diagnostic does not have to become
 *  a second bare-ish reader of the identifier: this file stays the one place that names it. */
export const DEV_TOOLS_DEFINE: boolean | undefined =
  typeof __EQ_DEV_TOOLS__ === 'undefined' ? undefined : __EQ_DEV_TOOLS__

// ============================================================================
// OWNER_TOOLS — DEV_TOOLS narrowed to the OWNER, and the only gate the Triage tab may use.
// ============================================================================
//
// JOS-72: a stranger recompiled this public repo for native macOS and ran it. A self-compiled
// build is not `app.isPackaged` and `import.meta.env.DEV` is true on any dev server, so
// `DEV_TOOLS` said yes and they got the OWNER's feedback-backlog tab. `DEV_TOOLS` is still the
// right answer for contributor tooling; it is the wrong answer for a surface that reads one
// person's AWS account, so tier 2 gets its own flag. The policy — including why the opt-in is an
// env var rather than a `define` — is written up in src/shared/ownerTools.ts.
//
// TWO TERMS, IN THIS ORDER, AND THE ORDER IS LOAD-BEARING.
//
//   `DEV_TOOLS &&` FIRST, because it is the STRIP. It folds to a literal `false` in every
//   `electron-vite build`, so `false && ownerToolsGranted(…)` folds with it: rollup deletes the
//   branch, never evaluates the call, and drops the now-unreferenced reader and its import.
//   Everything the old `DEV_TOOLS` guarded is still absent from `out/renderer` — measured by
//   grep on the build, not assumed. Writing the runtime read on the LEFT would defeat that and
//   ship the triage nav row's strings into every installer, merely hidden.
//
//   The bridge read SECOND, in a function so there is nothing left at module scope for a build
//   to keep alive. `window.eq.ownerTools` is a static boolean the preload lifts out of
//   `EQ_OWNER_TOOLS` (src/preload/dev.ts) — asking the PROCESS, not a `define`: no stale-server
//   hazard, no rebuild, one app restart to change the answer.
//
// AND IT DEGRADES **CLOSED**, which is the deliberate opposite of the rule twenty lines up.
// `DEV_TOOLS` degrades UPWARD because a missing define means a stale server rather than a
// decision. Here every form of silence — no env var, no bridge field, a preload bundle older
// than this feature, `window` not there at all — is the ordinary state of every checkout on
// earth, so it must resolve to NO. `ownerToolsGranted` compares against `true` and nothing else.

/** What the preload bridge says, if there is a bridge and it is new enough to have the field. */
function ownerToolsBridge(): unknown {
  return (globalThis as { window?: { eq?: { ownerTools?: unknown } } }).window?.eq?.ownerTools
}

/** DEV **and** an explicit `EQ_OWNER_TOOLS=1`. The ONE gate for owner-only surfaces. */
export const OWNER_TOOLS: boolean = DEV_TOOLS && ownerToolsGranted(ownerToolsBridge())

// ============================================================================
// UNRELEASED — a DIFFERENT axis from DEV_TOOLS, deliberately not the same flag.
// ============================================================================
//
// `DEV_TOOLS` means "this is operator tooling and will never ship" (the triage backlog). This
// one means "this is a PRODUCT surface that has landed on main and has not passed the owner's
// review gate yet" (JOS-45's character sheet, owner 2026-08-06). They are separate because their
// futures are: an unreleased surface graduates by DELETING its gate, and folding it into the
// dev-tools flag would make that deletion look like shipping a dev tool.
//
// THE PREDICTION CAME TRUE AND THE FLAG HAS NO READERS TODAY (JOS-327). The character sheet
// graduated on 2026-08-13 exactly as described — `unreleasedCharacter.tsx` deleted, the
// `KNOWN_VIEWS` splice made unconditional, the App branch made ordinary — and nothing in the
// renderer reads `UNRELEASED` any more. It stays because it is the MECHANISM, not the tenant
// (src/main/unreleased.ts says the same about its half): the next surface that has to land before
// the owner can look at it should adopt a strip that has already been argued through, and the
// argument is the twenty lines below. A reader wondering whether this is dead code: it is unused,
// which is a different thing, and the day it is used again nobody has to re-derive any of this.
//
// IT USES THE SAME MECHANISM, WHICH IS THE POINT — `import.meta.env.DEV` is a literal `false` in
// every `electron-vite build`, so `UNRELEASED && …` folds and rollup deletes the nav row, the
// route and the lazily-imported component tree. Structurally absent for packaged users, not
// hidden by CSS or by a runtime boolean somebody could flip.
//
// AND IT DELIBERATELY TAKES NO `define`. A vite `define` only exists from the moment a dev
// server booted, so adding one would mean a stale `npm run dev` silently loses the surface and
// the owner has to restart to review anything (the exact failure written up above). The builtin
// needs no config, is true on any dev server however old, and strips identically.
//
// A store-backed flag was considered and rejected: a persisted boolean cannot be structurally
// absent — the feature would still be compiled into every installer, one flipped key away from a
// user who was never meant to see it. The review gate asked for absence, not for a switch.
export const UNRELEASED: boolean = import.meta.env.DEV
