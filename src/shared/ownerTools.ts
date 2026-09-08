// ============================================================================
// ownerTools — the OWNER-TOOLING opt-in, and the one place its policy is written.
// ============================================================================
//
// WHY THIS EXISTS (JOS-72). Someone recompiled this repo from source for native macOS and ran
// it — reporting as 0.1.0 darwin/arm64. A SELF-COMPILED build is not `app.isPackaged`, so every
// gate whose whole predicate is "am I a dev build?" was open on that machine: the Triage tab
// appeared in their nav drawer, offering the OWNER's feedback backlog and usage analytics.
// Nothing leaked — that surface authenticates with the launching shell's AWS profile and a
// stranger's shell gets IAM denials on the first statement — but a tab that exists to read one
// person's private backlog must not be a default of `npm run dev` in a PUBLIC repo.
//
// SO THE DEV FLAG SPLITS IN TWO, by what the surface can touch:
//
//   TIER 1 — contributor conveniences. The dev restart button, the unreleased-surface gate,
//     the boot diagnostics: credential-free, useful to anyone hacking on a fork, and they stay
//     on plain DEV gating. Nothing here reaches anybody's account.
//   TIER 2 — OWNER tooling. The Triage tab and its `triage:*` IPC (the feedback backlog, the
//     log slices, the usage-analytics panels — Aurora DSQL, S3 and CloudWatch in the owner's
//     AWS sub-account). DEV **and** an explicit opt-in that a fresh checkout does not have.
//
// THE OPT-IN IS AN ENVIRONMENT VARIABLE, `EQ_OWNER_TOOLS=1`, and it is deliberately nothing
// else. It cannot be committed by accident (it is not a file), it carries no credential and no
// profile name — the AWS profile stays exactly where it was, in the launching shell — and it is
// read at RUNTIME at both ends, so flipping it costs an app restart and never a rebuild. A vite
// `define` was rejected for the reason written up in devFlags.ts: a define exists only from the
// moment a dev server booted, so a long-running `npm run dev` would answer with whatever was
// true hours ago.
//
// AND IT DEGRADES **CLOSED** — the exact opposite of the tier-1 rule. `DEV_TOOLS` degrades
// UPWARD (an absent define means a STALE dev server, not a decision, so the tab stays visible
// and the owner is not sent hunting for a tab that vanished with no error). Here the absence of
// a signal is the ordinary state of every checkout on earth: no env var, no bridge field, an
// old preload, a value that is not exactly `'1'` — every one of those means NO. The failure
// mode this file exists to prevent is a surface appearing where it was not asked for, so
// silence must never resolve to yes.

/** The variable itself. Named once, so main, preload and the docs cannot drift. */
export const OWNER_TOOLS_ENV = 'EQ_OWNER_TOOLS'

/** A minimal view of a process environment — `process.env` satisfies it in main and preload. */
export type EnvLike = Readonly<Record<string, string | undefined>>

/**
 * Did this process's environment ask for owner tooling?
 *
 * EXACTLY `'1'`, never truthiness. `EQ_OWNER_TOOLS=0` and `EQ_OWNER_TOOLS=false` both read as a
 * deliberate NO to anyone who types them, and a substring or `Boolean()` test would turn both
 * into YES. It matches the shape `EQ_E2E` / `EQ_UNRELEASED` / `EQ_DISABLE_GPU` already use.
 */
export function ownerToolsOptIn(env: EnvLike): boolean {
  return env[OWNER_TOOLS_ENV] === '1'
}

/**
 * MAIN's door: may this process register the owner-only IPC surface?
 *
 * Three terms, and the opt-in is the new one. `isPackaged` and `e2e` were already the gate on
 * `registerDevTriageIpc` and they stay — a packaged build must never reach the backlog, and the
 * headless harness builds production-shaped and must stay off the network entirely. The opt-in
 * is ANDed on top rather than replacing them, so `EQ_OWNER_TOOLS=1` cannot open a door in a
 * shipped installer or in `npm run test:e2e`.
 */
export function ownerToolsEnabled(opts: {
  readonly env: EnvLike
  readonly isPackaged: boolean
  readonly e2e: boolean
}): boolean {
  if (opts.isPackaged || opts.e2e) return false
  return ownerToolsOptIn(opts.env)
}

/**
 * THE RENDERER's half: what the preload bridge said, degraded CLOSED.
 *
 * The renderer has no `process` (nodeIntegration is off), so it learns the answer from
 * `window.eq.ownerTools` — a static boolean the preload reads out of the same environment
 * (src/preload/dev.ts), the `isE2E` precedent exactly. Typed as `unknown` on purpose: the field
 * is DECLARED on the bridge, but a stale preload bundle from before this feature has no such
 * field, and `undefined === true` is false, which is the answer we want.
 *
 * This is nav VISIBILITY, never a trust decision. Main enforces its own gate in main; a
 * renderer that lied its way past this one would find no handlers behind the door.
 */
export function ownerToolsGranted(bridge: unknown): boolean {
  return bridge === true
}
