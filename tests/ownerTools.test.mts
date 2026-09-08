// The OWNER-TOOLING gate (JOS-72) — src/shared/ownerTools.ts, both directions.
//
// WHY THIS SUITE EXISTS. A stranger recompiled this public repo for native macOS and ran it. A
// self-compiled build is not `app.isPackaged`, so the old predicate on the Triage tab — "am I a
// dev build?" — was TRUE on their machine and the owner's feedback-backlog tab appeared in their
// nav drawer. The fix is a second term, an explicit `EQ_OWNER_TOOLS=1` opt-in that no fresh
// checkout has, and the thing worth pinning is the DEFAULT: absent means hidden, in every shape
// an absence can take.
//
// AN ABSENCE TEST ALONE IS THE WEAKEST KIND (the character-sheet e2e says the same thing), so
// every case here is paired with its opposite — the same call with the opt-in present must
// answer YES. Default-hidden and opt-in-visible, at the one seam both ends read.
//
// Pure functions, no Electron, no network, no fixtures: this suite NEVER SKIPS. It cannot be an
// e2e, because `ownerToolsEnabled` refuses under `EQ_E2E=1` by design — the headless harness
// builds production-shaped and must stay off the owner's AWS account entirely.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OWNER_TOOLS_ENV,
  ownerToolsEnabled,
  ownerToolsGranted,
  ownerToolsOptIn
} from '../src/shared/ownerTools'

/** A dev run of a fresh checkout: not packaged, not the harness, nothing in the environment. */
const FRESH = { env: {}, isPackaged: false, e2e: false }
/** The same run with the opt-in set. */
const OPTED = { env: { [OWNER_TOOLS_ENV]: '1' }, isPackaged: false, e2e: false }

// ---- the default is HIDDEN, and the opt-in is the only thing that changes it ---------------

test('a fresh checkout gets NO owner tooling — the whole point of the ticket', () => {
  assert.equal(ownerToolsEnabled(FRESH), false)
  // …and the same environment WITH the opt-in does, so the refusal above is a gate rather than
  // a feature that was never wired up.
  assert.equal(ownerToolsEnabled(OPTED), true)
})

test('the opt-in is exactly "1" — every other spelling is a NO', () => {
  for (const value of ['0', '', 'true', 'TRUE', 'yes', ' 1', '1 ', '01', 'false']) {
    assert.equal(ownerToolsOptIn({ [OWNER_TOOLS_ENV]: value }), false, JSON.stringify(value))
  }
  assert.equal(ownerToolsOptIn({ [OWNER_TOOLS_ENV]: '1' }), true)
  // An unset variable is `undefined`, not the empty string — both must read as no.
  assert.equal(ownerToolsOptIn({}), false)
  assert.equal(ownerToolsOptIn({ [OWNER_TOOLS_ENV]: undefined }), false)
})

test('a near-miss variable name grants nothing', () => {
  assert.equal(ownerToolsOptIn({ EQ_OWNER_TOOL: '1', EQ_OWNERTOOLS: '1', EQ_DEV_TOOLS: '1' }), false)
})

// ---- the two terms the opt-in can never override -------------------------------------------

test('EQ_OWNER_TOOLS=1 cannot open the door in a PACKAGED build', () => {
  // An installer's bytes have no triage renderer in them at all, but main's registration is a
  // separate decision and must refuse on its own — an env var a user could set must never reach
  // an AWS-touching handler.
  assert.equal(ownerToolsEnabled({ ...OPTED, isPackaged: true }), false)
})

test('EQ_OWNER_TOOLS=1 cannot open the door under the e2e harness', () => {
  // `npm run test:e2e` builds production-shaped and runs beside the owner's game. It must never
  // reach the cluster, whatever the shell that launched it happens to export.
  assert.equal(ownerToolsEnabled({ ...OPTED, e2e: true }), false)
  assert.equal(ownerToolsEnabled({ ...OPTED, isPackaged: true, e2e: true }), false)
})

// ---- the renderer's half degrades CLOSED ---------------------------------------------------

test('the bridge reader answers YES only to a literal `true`', () => {
  assert.equal(ownerToolsGranted(true), true)
  // Every shape of "this bundle predates the feature" or "nobody said": a preload built before
  // JOS-72 has no such field, an overlay bridge has no such field, and a truthy-but-not-true
  // value is somebody's mistake rather than a grant.
  for (const bridge of [undefined, null, false, 0, 1, '1', 'true', {}, []]) {
    assert.equal(ownerToolsGranted(bridge), false, JSON.stringify(bridge) ?? 'undefined')
  }
})

test('DEV is still required — the renderer gate is DEV_TOOLS AND the bridge', () => {
  // devFlags.ts writes this as `DEV_TOOLS && ownerToolsGranted(…)`, with DEV_TOOLS on the LEFT
  // so a build folds the whole expression to `false` and rollup strips the branch. The
  // composition is what is pinned here; the folding is measured on the built bundle.
  const gate = (devTools: boolean, bridge: unknown): boolean => devTools && ownerToolsGranted(bridge)
  assert.equal(gate(true, true), true)
  assert.equal(gate(true, undefined), false)
  assert.equal(gate(false, true), false)
  assert.equal(gate(false, undefined), false)
})
