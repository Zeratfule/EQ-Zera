// GLOBAL FIGHT SELECTION — the model, the validator, and the pin that keeps three selectors on
// one channel (P4/P5/P6 of docs/plans/combat-overlay-parity.md).
//
// The owner ruling: "picking a fight in the combat panel or ANY overlay switches every
// fight-scoped surface (app + overlays). Overall (zone-session) selection stays per-overlay."
// Three things have to stay true for that to be more than a coincidence of wiring, and each of
// them is a test below:
//
//   THE VALUE MODEL is closed. Exactly two shapes are a fight selection — the '__live__'
//   sentinel and an engine encounter id — and main validates renderer input against it, so a
//   zone-session id can never land in the global and break the carve-out by accident.
//
//   THE SENTINEL IS ONE STRING. The renderer's `LIVE_SELECTION` and main's `LIVE_FIGHT` are the
//   same constant; two spellings of '__live__' would be a cross-process disagreement no
//   typechecker could see.
//
//   THE THREE SELECTORS SHARE ONE SEAM. The Combat tab's picker, the 'fight' overlay and the
//   'heal-fight' overlay all drive `useGlobalFight`, both preload bridges expose the same three
//   members, and the zone-session selectors call none of it. This is the same one-builder pin
//   tests/combatPetNesting.test.mts keeps over `meterPanel`.
//
// P6 (a stale id degrades, it does not clear) is deliberately pinned as a property of the
// VALIDATOR here — a well-formed id for a fight that has aged out is ACCEPTED — because the
// degradation itself belongs to the engine (`resolveSelectedId` falls back to its own default,
// which tests/goldenWindows.test.mts and the e2e harness already exercise).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  LIVE_FIGHT,
  isFightSelection,
  normalizeFightSelection
} from '../src/shared/fightSelection'
import { LIVE_SELECTION, defaultSelection } from '../src/renderer/src/features/combat/dashboardData'
import { IPC } from '../src/shared/ipc'

// ── the value model ────────────────────────────────────────────────────────────────────

test('the sentinel and an engine encounter id are the only two legal shapes', () => {
  assert.equal(isFightSelection(LIVE_FIGHT), true)
  assert.equal(isFightSelection('e1'), true)
  assert.equal(isFightSelection('e41'), true)
  assert.equal(isFightSelection('e123456789'), true)
})

test('a zone-session selection is NOT a fight selection — the carve-out, enforced', () => {
  // These are the Overall scope's values (dashboardData.overallScopeOptions / the engine's
  // zoneHistory ids). A per-overlay zone selector must never be able to write the global, and
  // the validator is where that stops being a convention.
  assert.equal(normalizeFightSelection('zone'), null)
  assert.equal(normalizeFightSelection('zs3'), null)
  assert.equal(normalizeFightSelection('zs12'), null)
})

test('renderer input that is not a selection at all is dropped, never stored', () => {
  for (const bad of [undefined, null, 42, {}, [], '', 'e', 'e0', 'e01', 'E1', 'e1 ', ' e1', 'e-1', 'e1.5', '__live__x', 'e9999999999']) {
    assert.equal(normalizeFightSelection(bad), null, `${JSON.stringify(bad)} was accepted`)
  }
})

test('P6: a well-formed id for a fight that aged out is ACCEPTED, not rejected', () => {
  // The whole point of the ruling's stale clause. The engine resolves an unknown id to its own
  // default; rejecting it here would clear the global for every surface because one of them
  // scrolled past the ring's edge.
  assert.equal(normalizeFightSelection('e900'), 'e900')
})

test('ONE SENTINEL: the renderer’s LIVE_SELECTION is main’s LIVE_FIGHT', () => {
  assert.equal(LIVE_SELECTION, LIVE_FIGHT)
  assert.equal(LIVE_FIGHT, '__live__')
  // …and the fight scope still starts on it, while Overall starts on its own live zone.
  assert.equal(defaultSelection('fight'), LIVE_FIGHT)
  assert.equal(defaultSelection('overall'), 'zone')
  assert.equal(isFightSelection(defaultSelection('overall')), false)
})

// ── the seam ───────────────────────────────────────────────────────────────────────────

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/**
 * The same file with its COMMENTS removed. This repo comments heavily and on purpose — a header
 * that explains "no electron-store here, and nothing about scope" would otherwise fail the very
 * assertions it is describing. These pins are about what the code DOES.
 */
const code = (rel: string): string =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

test('the three channels exist and are distinct', () => {
  const names = [IPC.fightSelectionGet, IPC.fightSelectionSet, IPC.onFightSelection]
  assert.equal(new Set(names).size, 3)
  for (const n of names) assert.match(n, /^fightSelection:/)
})

test('MAIN OWNS IT, EPHEMERALLY: no store, no migration, no persisted key', () => {
  const mod = code('../src/main/fightSelection.ts')
  assert.doesNotMatch(mod, /from '\.\/store'/, 'the global selection grew a persisted home')
  assert.doesNotMatch(mod, /electron-store|storeMigrations|setOverlayConfig/, 'the global selection reached the store')
  // It resets by being module scope — the initializer IS the reset, so there is nothing else to
  // check and nothing else that could go stale across launches.
  assert.match(mod, /let fightId: string = LIVE_FIGHT/)
  // …and the setter validates. Trusting the renderer here would be the one place this design
  // could let a zone id through.
  assert.match(mod, /normalizeFightSelection\(next\)/)
})

test('the handler validates rather than storing what it is handed', () => {
  const handlers = src('../src/main/ipc/windowControls.ts')
  assert.match(handlers, /IPC\.fightSelectionGet/)
  assert.match(handlers, /IPC\.fightSelectionSet/)
  // The write is fire-and-forget (`ipcMain.on`), like every other renderer→main notification in
  // this file; an invoke would imply the caller waits on a broadcast it is also going to receive.
  assert.match(handlers, /ipcMain\.on\(IPC\.fightSelectionSet/)
})

test('ONE HOOK, BOTH BUNDLES: both preload bridges expose the same three members', () => {
  const bridges = {
    'the main app bridge': src('../src/preload/windows.ts'),
    'the overlay bridge': src('../src/preload/overlay.ts')
  }
  for (const [who, text] of Object.entries(bridges)) {
    for (const member of ['getFightSelection', 'setFightSelection', 'onFightSelection']) {
      assert.match(text, new RegExp(`\\b${member}:`), `${who} is missing ${member}`)
    }
    assert.match(text, /IPC\.fightSelectionGet/, `${who} does not read the shared channel`)
    assert.match(text, /IPC\.fightSelectionSet/, `${who} does not write the shared channel`)
    assert.match(text, /IPC\.onFightSelection/, `${who} does not subscribe to the shared channel`)
  }
})

test('EVERY fight-scoped selector writes the global, and none keeps a private fight state', () => {
  const surfaces = {
    'the Combat tab': src('../src/renderer/src/features/combat/useCombat.ts'),
    'the fight overlay': src('../src/renderer/src/overlay/OverlayMeter.tsx'),
    'the heal-fight overlay': src('../src/renderer/src/overlay/HealMeter.tsx')
  }
  for (const [who, text] of Object.entries(surfaces)) {
    assert.match(text, /useGlobalFight\(/, `${who} does not use the shared selection hook`)
    assert.match(text, /selectFight\(/, `${who} never writes the global selection`)
    // The tell for a re-grown private copy: a fight selection held in local React state. The
    // ZONE selection legitimately is (that is the carve-out), so the check is for the sentinel.
    assert.doesNotMatch(
      text,
      /useState<string>\(\s*(LIVE|LIVE_SELECTION|LIVE_FIGHT|'__live__')/,
      `${who} keeps a private fight selection again`
    )
  }
})

test('the zone-session selectors are untouched: local state, and no global write', () => {
  const surfaces = {
    'the Combat tab': src('../src/renderer/src/features/combat/useCombat.ts'),
    'the fight overlay': src('../src/renderer/src/overlay/OverlayMeter.tsx'),
    'the heal-fight overlay': src('../src/renderer/src/overlay/HealMeter.tsx')
  }
  for (const [who, text] of Object.entries(surfaces)) {
    // Each of these files serves BOTH scopes, and the zone half must stay ordinary local state.
    assert.match(text, /useState<string>\('zone'\)/, `${who} moved the zone selection out of local state`)
    // …and the write path is a branch, never unconditional: `selectFight` may only be reached
    // when the surface is fight-scoped.
    assert.match(text, /if \((isFight|scope === 'fight')\) selectFight\(/, `${who} writes the global unconditionally`)
  }
})

test('SELECTION IS NOT SCOPE (P5): nothing in the selection path touches the scope pref', () => {
  const hook = code('../src/renderer/src/features/combat/useGlobalFight.ts')
  assert.doesNotMatch(hook, /scope/i, 'the shared selection hook learned about scope')
  const mod = src('../src/main/fightSelection.ts')
  assert.doesNotMatch(mod, /eq\.combat\.scope|CombatScope/, 'main’s selection module learned about scope')
  // The standing law's own storage key is written in exactly one place, by an explicit user
  // choice — a selection arriving from another window must never reach it.
  const combat = src('../src/renderer/src/features/combat/useCombat.ts')
  const writes = combat.match(/localStorage\.setItem\(SCOPE_KEY/g) ?? []
  assert.equal(writes.length, 2, 'the scope pref is written somewhere other than setScope/focusFight')
})
