// ONE ANSWER FOR EVERY WINDOW: the app-wide scope selection, end to end in source (JOS-332).
//
// THE DEFECT THIS FILE EXISTS FOR, in the owner's words: *with this tier selected on Leveling, the
// numbers still cover every tier* — base `Befallen` then `Befallen 2 (Adaptive)`, reading
// `elapsed 27m`. The arithmetic was never wrong (tests/zoneScope.test.mts now pins the narrowed
// denominator over the same scenario, instant for instant). What was wrong is that `this tier` was
// TWO STATES: the main window kept the membership in a module variable and the XP overlay, a
// separate renderer process, kept its own persisted copy. Two true statements, one label, and no
// way for a reader to tell which one the numbers in front of them obeyed.
//
// So the pair moved to MAIN, ephemeral, fanned out — the `fightSelection.ts` seam, verbatim, for
// the second cross-window fact to need it. FOUR THINGS ARE PINNED HERE, and each of them fails
// silently if it regresses:
//
//   1. THE MODEL: the opening, the patch normalizer (untrusted input from an ipcMain channel), the
//      merge, and the no-op equality that keeps a re-press from re-rendering every window.
//   2. MAIN OWNS IT AND OWNS IT EPHEMERALLY. No store import, no persistence, resets at launch —
//      one fact cannot have two lifetimes, and the session-lifetime one is the reading that won.
//   3. THE BRIDGE IDENTITY: the SAME three members under the SAME names in BOTH preloads. That
//      structural identity is the whole mechanism — it is what lets one renderer hook drive the
//      tab's toggle row and the overlay's footer buttons, and a rename on one side alone would
//      compile, ship, and silently restore the two-states bug.
//   4. THE RENDERER CACHE writes through rather than owning, and every consumer in a window reads
//      the same value (one store, not one `useState` per hook) — a button that moved a frame before
//      the numbers did would be this defect in miniature.
//
// Pins 2–4 are source pins in tests/fightSelection.test.mts' technique: comments stripped first,
// because this repo explains itself in prose that would otherwise satisfy its own greps.
//
// Imported RELATIVELY: node tests run through tsx with no `@shared` alias.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SCOPE_SELECTION_OPENING,
  applyScopePatch,
  normalizeScopePatch,
  normalizeScopeSelection,
  sameScopeSelection,
  type ScopeSelection
} from '../src/shared/scopeSelection'
import { RATE_BASIS_DEFAULT, RATE_BASIS_OPENING } from '../src/shared/rateBasis'
import { ZONE_SCOPE_DEFAULT, ZONE_SCOPE_OPENING } from '../src/shared/zoneScope'
import { IPC } from '../src/shared/ipc'

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** The file with block and line comments removed — these pins are about what the code DOES. */
const code = (rel: string): string =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

// ── 1. the model ──────────────────────────────────────────────────────────────────────

test('the OPENING is this tier per elapsed hour, composed from the two vocabularies', () => {
  assert.deepEqual(SCOPE_SELECTION_OPENING, { zoneScope: 'exactTier', basis: 'elapsed' })
  // Composed, never re-spelled: a later ruling about either half lands beside that half's
  // definition and this module follows it.
  assert.equal(SCOPE_SELECTION_OPENING.zoneScope, ZONE_SCOPE_OPENING)
  assert.equal(SCOPE_SELECTION_OPENING.basis, RATE_BASIS_OPENING)
  // The tier half OPENS somewhere other than where it DEFAULTS, and that asymmetry is the ruling.
  // The hour half opens on its default today — written down separately anyway, so the next ruling
  // about it has a home that is not a call site.
  assert.notEqual(ZONE_SCOPE_OPENING, ZONE_SCOPE_DEFAULT)
  assert.equal(RATE_BASIS_OPENING, RATE_BASIS_DEFAULT)
})

test('a PATCH is rebuilt, never trusted — it arrives on an ipcMain channel', () => {
  assert.deepEqual(normalizeScopePatch({ zoneScope: 'exactTier' }), { zoneScope: 'exactTier' })
  assert.deepEqual(normalizeScopePatch({ basis: 'active' }), { basis: 'active' })
  assert.deepEqual(normalizeScopePatch({ zoneScope: 'exactTier', basis: 'active' }), {
    zoneScope: 'exactTier',
    basis: 'active'
  })
  // Unknown VALUES are dropped per field, so half a valid patch still lands — the honest read of
  // "this build cannot name that membership" is "that half does not move".
  assert.deepEqual(normalizeScopePatch({ zoneScope: 'everyTier', basis: 'active' }), { basis: 'active' })
  assert.deepEqual(normalizeScopePatch({ basis: 'wall' }), {})
  // Unknown KEYS never survive: the wire cannot grow a third knob by being sent one.
  assert.deepEqual(normalizeScopePatch({ zoneScope: 'exactTier', xpSlice: 'h1' }), { zoneScope: 'exactTier' })
  // And the shapes a hand-crafted send can take.
  for (const junk of [null, undefined, 2, 'exactTier', [], true]) {
    assert.deepEqual(normalizeScopePatch(junk), {}, `${JSON.stringify(junk)} is not a patch`)
  }
})

test('a patch moves ONE half and leaves the other exactly where it was', () => {
  const current: ScopeSelection = { zoneScope: 'allTiers', basis: 'active' }
  assert.deepEqual(applyScopePatch(current, { zoneScope: 'exactTier' }), {
    zoneScope: 'exactTier',
    basis: 'active'
  })
  assert.deepEqual(applyScopePatch(current, { basis: 'elapsed' }), { zoneScope: 'allTiers', basis: 'elapsed' })
  // A rejected patch is a NO-OP, not a reset: `setScopeSelection` leans on this to broadcast
  // nothing, and a reset here would hand every window the opening on a malformed send.
  assert.deepEqual(applyScopePatch(current, { basis: 'wall' }), current)
  assert.deepEqual(applyScopePatch(current, 'nonsense'), current)
})

test('a WHOLE selection falls back to the OPENING, never to the model defaults', () => {
  assert.deepEqual(normalizeScopeSelection({ zoneScope: 'allTiers', basis: 'active' }), {
    zoneScope: 'allTiers',
    basis: 'active'
  })
  // A window that could not read the answer must show what a fresh window shows — not the
  // pre-JOS-291 read, which is what `ZONE_SCOPE_DEFAULT` would have given it.
  assert.deepEqual(normalizeScopeSelection(undefined), SCOPE_SELECTION_OPENING)
  assert.deepEqual(normalizeScopeSelection({}), SCOPE_SELECTION_OPENING)
  assert.deepEqual(normalizeScopeSelection({ zoneScope: 'nope' }), SCOPE_SELECTION_OPENING)
})

test('equality is what makes a re-press free, in main and in the renderer alike', () => {
  const a: ScopeSelection = { zoneScope: 'exactTier', basis: 'elapsed' }
  assert.ok(sameScopeSelection(a, { ...a }))
  assert.ok(!sameScopeSelection(a, { ...a, basis: 'active' }))
  assert.ok(!sameScopeSelection(a, { ...a, zoneScope: 'allTiers' }))
})

// ── 2. main owns it, ephemerally ──────────────────────────────────────────────────────

test('MAIN holds the selection, and holds it EPHEMERALLY', () => {
  const mod = code('../src/main/scopeSelection.ts')
  assert.match(mod, /let selection: ScopeSelection = SCOPE_SELECTION_OPENING/, 'module scope IS the reset')
  // No store, no migration: one fact cannot have two lifetimes, and this one is session-lifetime.
  assert.doesNotMatch(mod, /electron-store|settingsStore|from '\.\/store'/, 'the selection grew a persisted home')
  // Untrusted input is rebuilt by the SHARED normalizer, never by a predicate written in main.
  assert.match(mod, /applyScopePatch\(selection, patch\)/)
  // A no-op write broadcasts nothing.
  assert.match(mod, /if \(sameScopeSelection\(next, selection\)\) return selection/)
  // EVERY window, on one channel — the main window and all overlay kinds, exactly like the fight
  // selection beside it. A subscriber registry is the thing this shape refuses.
  assert.match(mod, /\[getMainWindow\(\), \.\.\.OVERLAY_KINDS\.map\(\(k\) => getOverlayWindow\(k\)\)\]/)
  assert.match(mod, /webContents\.send\(IPC\.onScopeSelection, selection\)/)
})

test('the handler pair is registered where the fight selection is, and validates at the handler', () => {
  const ipc = code('../src/main/ipc/windowControls.ts')
  assert.match(ipc, /ipcMain\.handle\(IPC\.scopeSelectionGet, \(\) => getScopeSelection\(\)\)/)
  assert.match(ipc, /ipcMain\.on\(IPC\.scopeSelectionSet[\s\S]{0,120}setScopeSelection\(patch\)/)
  // Three distinct channels, and none of them collides with the fight selection's.
  const ids = [IPC.scopeSelectionGet, IPC.scopeSelectionSet, IPC.onScopeSelection]
  assert.equal(new Set(ids).size, 3)
  assert.ok(ids.every((id) => id.startsWith('scopeSelection:')), ids.join(', '))
})

// ── 3. the bridge identity: the same three members, under the same names, in both preloads ──

test('BOTH preloads expose the same three members under the same names', () => {
  const app = code('../src/preload/windows.ts')
  const overlay = code('../src/preload/overlay.ts')
  for (const [name, file] of [
    ['the main app bridge', app],
    ['the overlay bridge', overlay]
  ] as const) {
    assert.match(file, /getScopeSelection: \(\): Promise<ScopeSelection> => ipcRenderer\.invoke\(IPC\.scopeSelectionGet\)/, name)
    assert.match(
      file,
      /setScopeSelection: \(patch: Partial<ScopeSelection>\): void => ipcRenderer\.send\(IPC\.scopeSelectionSet, patch\)/,
      name
    )
    assert.match(file, /onScopeSelection: \(cb: \(s: ScopeSelection\) => void\)/, name)
    // The subscription is REMOVABLE — a preload that only ever adds listeners leaks one per mount.
    assert.match(file, /removeListener\(IPC\.onScopeSelection, listener\)/, name)
  }
})

// ── 4. the renderer cache writes through and is shared by every consumer in the window ──

test('the renderer store is a CACHE — one per window, written through to main', () => {
  const hook = code('../src/renderer/src/features/timeslice/useScopeSelection.ts')
  // ONE value per window, published through the version-counter external store — so the button and
  // the numbers under it move in the SAME commit. A `useState` here would be the frame-long
  // disagreement this whole ticket is about, shrunk.
  assert.match(hook, /useSyncExternalStore\(subscribe, getVersion, getVersion\)/)
  assert.doesNotMatch(hook, /useState/, 'a per-consumer copy is a per-consumer answer')
  // Hydrate then subscribe, at most once per bridge.
  assert.match(hook, /bridge\.getScopeSelection\(\)\.then\(adopt/)
  assert.match(hook, /bridge\.onScopeSelection\(adopt\)/)
  assert.match(hook, /if \(wiredTo === bridge\) return/, 'every consumer runs the effect; the wire must not')
  // Optimistic locally, authoritative in main — and main's echo is free because `adopt` rebuilds
  // and compares.
  assert.match(hook, /bridge\?\.setScopeSelection\(p\)/)
  assert.match(hook, /if \(sameScopeSelection\(next, selection\)\) return/)
  // The bridge is a PARAMETER, so the file is honest in both bundles.
  assert.doesNotMatch(hook, /window\.eq/, 'the bridge is passed in, never read off `window` here')
  // MUI-free: the overlay bundle imports this file.
  assert.doesNotMatch(hook, /@mui/)
})

test('both bundles call that ONE hook, each over its own bridge', () => {
  assert.match(code('../src/renderer/src/features/timeslice/useTimeslice.ts'), /useScopeSelection\(window\.eq\)/)
  assert.match(code('../src/renderer/src/features/timeslice/useRateBasis.ts'), /useScopeSelection\(window\.eq\)/)
  assert.match(code('../src/renderer/src/overlay/XpOverlay.tsx'), /useScopeSelection\(window\.eqOverlay\)/)
})
