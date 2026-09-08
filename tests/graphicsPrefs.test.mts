// Graphics compatibility (src/shared/graphicsPrefs.ts + the 9→10 / 10→11 store migrations) —
// JOS-40, JOS-31.
//
// The claim under test is a claim about machines nobody here owns: a player's RTX 5080 turned the
// transparent, always-on-top overlays into black-screen artifacting (JOS-40), and a player under
// Wine watched the celebration overlay become a stuck black box after a level-up (JOS-31, report
// 01KZGQZJ2HMZGRY28A7CVRG4QT). Neither can be reproduced here. So what ships is a switch and a
// detection, and what this suite pins is exactly what a Windows machine CAN pin: that each switch
// means one thing, that nothing turns itself on unless the environment asked, that an explicit
// preference beats the environment IN BOTH DIRECTIONS, that a store written by any past build
// arrives with a complete block, and that the env door opens on the spellings a support reply
// would actually give and on nothing else.
//
// The environment READING is not here — that is tests/wineDetect.test.mts, and the seam between
// them is the point: this module takes two booleans and does not know what looked at the machine.
//
// No Electron, no store file: shared/graphicsPrefs.ts is a zero-import pure module by design, so
// this suite is as cheap and as unskippable as overlayLayout/updateCadence.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GRAPHICS_PREFS,
  GPU_ENV_VAR,
  GRAPHICS_SWITCHES,
  NO_GRAPHICS_AUTO,
  OPAQUE_OVERLAY_BG,
  TRANSPARENT_OVERLAY_BG,
  envDisablesGpu,
  normalizeGraphicsPrefs,
  overlayBackgroundColor,
  resolveGraphics,
  resolveGraphicsSwitch,
  type GraphicsSwitch
} from '../src/shared/graphicsPrefs'
import { CURRENT_SCHEMA_VERSION, migrateStoreData } from '../src/main/storeMigrations'

test('both switches default to AUTO — the app may notice a machine, never presume one', () => {
  assert.deepEqual(DEFAULT_GRAPHICS_PREFS, { safeMode: 'auto', opaqueOverlays: 'auto' })
  // …and `auto` with nothing detected is still OFF, which is what keeps the JOS-40 policy intact:
  // every ordinary machine gets hardware acceleration and see-through overlays.
  assert.deepEqual(resolveGraphics(DEFAULT_GRAPHICS_PREFS, NO_GRAPHICS_AUTO), {
    safeMode: { on: false, source: 'default' },
    opaqueOverlays: { on: false, source: 'default' }
  })
  // The default recommendation is the one an ordinary machine produces, so the argument is
  // optional and means the same thing.
  assert.deepEqual(resolveGraphics(DEFAULT_GRAPHICS_PREFS), {
    safeMode: { on: false, source: 'default' },
    opaqueOverlays: { on: false, source: 'default' }
  })
})

test('the normalizer answers with a COMPLETE block from anything at all', () => {
  for (const junk of [undefined, null, 42, 'on', [], { safeMode: 'yes' }, { opaqueOverlays: 1 }]) {
    assert.deepEqual(
      normalizeGraphicsPrefs(junk),
      DEFAULT_GRAPHICS_PREFS,
      `${JSON.stringify(junk) ?? 'undefined'} must default rather than half-parse`
    )
  }
  // Every legal spelling survives, field by field — including one switch set and the other left.
  for (const value of GRAPHICS_SWITCHES) {
    assert.deepEqual(normalizeGraphicsPrefs({ safeMode: value }), {
      safeMode: value,
      opaqueOverlays: 'auto'
    })
  }
  assert.deepEqual(normalizeGraphicsPrefs({ safeMode: 'on', opaqueOverlays: 'off' }), {
    safeMode: 'on',
    opaqueOverlays: 'off'
  })
  // Unknown keys are dropped rather than carried: the blob is a closed shape.
  assert.deepEqual(normalizeGraphicsPrefs({ safeMode: 'on', gpu: 'off' }), {
    safeMode: 'on',
    opaqueOverlays: 'auto'
  })
})

test('a BOOLEAN is read as the literal choice it looks like — history lives in the migration', () => {
  // A boolean reaching the normalizer now is a hand-edited file or an old renderer, and a function
  // with no history has exactly one honest reading of it. The ONE place `false` means something
  // else — a v10 store, where it was equally the value nobody touched — is the 10 → 11 step below.
  assert.deepEqual(normalizeGraphicsPrefs({ safeMode: true, opaqueOverlays: false }), {
    safeMode: 'on',
    opaqueOverlays: 'off'
  })
})

test('PRECEDENCE: an explicit preference beats detection, in BOTH directions', () => {
  // The direction that makes detection useful…
  assert.deepEqual(resolveGraphicsSwitch('auto', true), { on: true, source: 'auto' })
  // …and the direction that keeps it from being a trap. A Wine user who wants see-through
  // overlays says so once and the detection stops arguing — without this rung, the fallback
  // would be a one-way door on a whole platform.
  assert.deepEqual(resolveGraphicsSwitch('off', true), { on: false, source: 'user' })
  // An explicit ON is not weakened by an environment that sees nothing wrong: the JOS-40 user on
  // real Windows hardware keeps the switch they went looking for.
  assert.deepEqual(resolveGraphicsSwitch('on', false), { on: true, source: 'user' })
  assert.deepEqual(resolveGraphicsSwitch('on', true), { on: true, source: 'user' })
  assert.deepEqual(resolveGraphicsSwitch('off', false), { on: false, source: 'user' })
  assert.deepEqual(resolveGraphicsSwitch('auto', false), { on: false, source: 'default' })
})

test('…and the two switches resolve INDEPENDENTLY — one override never moves the other', () => {
  // A recommendation that asks for BOTH. It is not named `wine` on purpose: no real environment
  // asks for safe mode any more (JOS-352 inverted that half), and this module's whole promise is
  // that it takes two booleans and does not know who sent them.
  const both = { safeMode: true, opaqueOverlays: true }
  assert.deepEqual(resolveGraphics({ safeMode: 'off', opaqueOverlays: 'auto' }, both), {
    safeMode: { on: false, source: 'user' },
    opaqueOverlays: { on: true, source: 'auto' }
  })
  assert.deepEqual(resolveGraphics({ safeMode: 'auto', opaqueOverlays: 'off' }, both), {
    safeMode: { on: true, source: 'auto' },
    opaqueOverlays: { on: false, source: 'user' }
  })
  // A recommendation that speaks to only one switch leaves the other at the default.
  assert.deepEqual(
    resolveGraphics(DEFAULT_GRAPHICS_PREFS, { safeMode: false, opaqueOverlays: true }),
    {
      safeMode: { on: false, source: 'default' },
      opaqueOverlays: { on: true, source: 'auto' }
    }
  )
})

test('every legal switch value resolves to something, under every recommendation', () => {
  // A closed enum with a total function over it: no combination can fall through to `undefined`,
  // which is the one failure mode a three-state switch has that a boolean did not.
  for (const pref of GRAPHICS_SWITCHES) {
    for (const auto of [false, true]) {
      const r = resolveGraphicsSwitch(pref as GraphicsSwitch, auto)
      assert.equal(typeof r.on, 'boolean', `${pref}/${String(auto)}`)
      assert.ok(['user', 'auto', 'default'].includes(r.source), `${pref}/${String(auto)}`)
      // The source and the value can never disagree about who decided.
      if (r.source === 'auto') assert.equal(r.on && auto, true)
      if (r.source === 'default') assert.equal(r.on, false)
    }
  }
})

test(`${GPU_ENV_VAR} opens on the spellings a support reply gives — and on nothing else`, () => {
  for (const raw of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
    assert.equal(envDisablesGpu({ [GPU_ENV_VAR]: raw }), true, `${JSON.stringify(raw)} must count`)
  }
  // SET TO OFF IS NOT SET TO ON. An env var spelled `0` is someone declining, and reading it as
  // truthy-because-present would turn a diagnostic into a trap.
  for (const raw of ['0', 'false', 'no', 'off', '', '  ', 'maybe']) {
    assert.equal(envDisablesGpu({ [GPU_ENV_VAR]: raw }), false, `${JSON.stringify(raw)} must not`)
  }
  assert.equal(envDisablesGpu({}), false, 'an absent variable is the ordinary case')
  // It is still the ONLY variable THIS module consults. JOS-31 reads a Wine prefix in
  // shared/wineDetect.ts and hands the ANSWER to `resolveGraphics` — the promise in this file's
  // header ("nothing here knows what a Wine prefix is") survived the ticket that needed one.
  assert.equal(envDisablesGpu({ WINEPREFIX: '/home/u/.wine', PROTON: '1' }), false)
})

test('an opaque overlay is built on the SAME colour the page already paints', () => {
  assert.equal(overlayBackgroundColor(false), TRANSPARENT_OVERLAY_BG)
  assert.equal(overlayBackgroundColor(true), OPAQUE_OVERLAY_BG)
  // The identity is the point: `withAlpha(PALETTE.bg, α)` (OverlayMeter / HealMeter / EventLogOverlay)
  // composited onto #0b0f1a is #0b0f1a at every α — the bgAlpha look with the alpha taken out,
  // never a second palette. If those components ever change colour, this assertion is where the
  // compatibility mode finds out.
  assert.equal(OPAQUE_OVERLAY_BG.toLowerCase(), '#0b0f1a')
  assert.equal(TRANSPARENT_OVERLAY_BG, '#00000000')
})

test('9 → 11 gives every upgrading store a complete graphics block, both switches auto', () => {
  // A v9 store — the shape every build shipped before JOS-40 — carries no `graphics` key.
  const v9 = { schemaVersion: 9, byCharacter: {}, overlays: { toast: { open: true } } }
  const out = migrateStoreData(v9)
  assert.equal(out.to, CURRENT_SCHEMA_VERSION)
  assert.ok(out.applied.includes(10) && out.applied.includes(11), 'both steps must have run')
  assert.deepEqual(out.data.graphics, DEFAULT_GRAPHICS_PREFS)
  // …and it touched nothing else on the way through.
  assert.deepEqual(out.data.overlays, { toast: { open: true } })
})

test('10 → 11: a stored `false` was the DEFAULT, so it becomes auto; a `true` was a CHOICE', () => {
  // This is the one judgement in the migration file worth arguing about, so it is pinned in both
  // directions. `graphics` was written on every launch that ran the 9 → 10 step — not when
  // somebody reached for a switch — so reading every `false` as a refusal would permanently
  // exclude from this fix exactly the users who cannot see the window that holds the switch.
  const both = migrateStoreData({
    schemaVersion: 10,
    byCharacter: {},
    graphics: { safeMode: false, opaqueOverlays: false }
  })
  assert.deepEqual(both.data.graphics, { safeMode: 'auto', opaqueOverlays: 'auto' })

  // …and nothing but a deliberate act ever wrote `true`, so detection must never be able to take
  // it away. The asymmetry is the whole step.
  const chosen = migrateStoreData({
    schemaVersion: 10,
    byCharacter: {},
    graphics: { safeMode: true, opaqueOverlays: false }
  })
  assert.deepEqual(chosen.data.graphics, { safeMode: 'on', opaqueOverlays: 'auto' })

  // A hand-edited or absent block is repaired to the default rather than coerced into a switch
  // nobody set.
  const junk = migrateStoreData({ schemaVersion: 10, byCharacter: {}, graphics: { safeMode: 'yes' } })
  assert.deepEqual(junk.data.graphics, DEFAULT_GRAPHICS_PREFS)
  const missing = migrateStoreData({ schemaVersion: 10, byCharacter: {} })
  assert.deepEqual(missing.data.graphics, DEFAULT_GRAPHICS_PREFS)
})

test('…and the 9 → 10 step still emits the v10 BOOLEAN shape it always emitted', () => {
  // APPEND-ONLY: a shipped step's output is frozen. If migrateToV10 had kept calling the shared
  // normalizer it would now emit a v11 block while claiming v10, and the 10 → 11 step — whose
  // whole job is to read those booleans and decide what they MEANT — would find strings and read
  // every one of them as 'auto', silently discarding the JOS-40 users who turned a switch ON.
  const out = migrateStoreData(
    { schemaVersion: 9, byCharacter: {}, graphics: { safeMode: true, opaqueOverlays: 'nonsense' } },
    { target: 10 }
  )
  assert.equal(out.to, 10)
  assert.deepEqual(out.data.graphics, { safeMode: true, opaqueOverlays: false })
})
