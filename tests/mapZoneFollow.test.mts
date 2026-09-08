// THE MAP VIEWER'S ZONE MODE (JOS-97) — every rule that decides which map is on screen, driven
// without React, a DOM or Electron, so it never skips.
//
// THE REPORT: "Would be nice to keep selected map when you move off of the tab (seems to reset if
// I move to the loot tab as an example)." Two mechanisms produced that one symptom, and both are
// pinned here: a zone line overwriting the pick, and the REMOUNT — `App` mounts one feature view
// at a time, so leaving the Maps tab destroys the view and returning re-reads localStorage and
// then immediately re-applied the character's zone over what it had just restored.
//
// WHAT A UNIT TEST CAN AND CANNOT SEE. It can pin the rules and the storage contract, which is
// what this file does. It CANNOT see the lifecycle — a reducer that is correct in isolation still
// loses the pick if the view's effect calls it at the wrong moment — so the round trip through a
// real unmount is asserted by tests/e2e/maps-pin.e2e.mts, the same division of labour JOS-90's
// sky-filters spec drew.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LAST_ZONE_KEY,
  ZONE_MODE_KEY,
  loadZoneSelection,
  onCharacterZone,
  onFollowCurrent,
  onPick,
  saveZoneSelection,
  type ZoneSelection,
  type ZoneStore
} from '../src/renderer/src/features/maps/zoneFollow'

/** A `localStorage` stand-in — the two methods the module uses, over a Map. */
function store(seed: Record<string, string> = {}): ZoneStore & { all(): Record<string, string> } {
  const data = new Map(Object.entries(seed))
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
    all: () => Object.fromEntries(data)
  }
}

/** The state a fresh install starts in — nothing remembered, and the log in charge. */
const FRESH: ZoneSelection = { zone: null, mode: 'follow' }

// ── the default is TODAY'S behaviour ───────────────────────────────────────────────────

test('a fresh install follows the character, and so does an install that predates the mode', () => {
  assert.deepEqual(loadZoneSelection(store()), FRESH)
  // The upgrade case: `eq.maps.zone` written by v0.10.0, no mode key at all. It must not come
  // back pinned — nobody chose that, and a silent pin is the reported bug with the sign flipped.
  assert.deepEqual(loadZoneSelection(store({ [LAST_ZONE_KEY]: 'sro' })), { zone: 'sro', mode: 'follow' })
})

test('following re-points the map on every zone line', () => {
  let sel = FRESH
  sel = onCharacterZone(sel, 'sro')
  assert.deepEqual(sel, { zone: 'sro', mode: 'follow' })
  sel = onCharacterZone(sel, 'gfaydark')
  assert.deepEqual(sel, { zone: 'gfaydark', mode: 'follow' })
})

test('a stated zone the table cannot place clears the map rather than leaving the old one up', () => {
  // The EQL Tutorial is the known case: a real zone with no stem. Drawing the previous zone under
  // a name it does not belong to is the same lie as guessing a stem (world-model law 1).
  const sel = onCharacterZone({ zone: 'sro', mode: 'follow' }, null)
  assert.deepEqual(sel, { zone: null, mode: 'follow' })
})

test('an unchanged zone yields the SAME object, so a re-stated zone costs no render', () => {
  const sel: ZoneSelection = { zone: 'sro', mode: 'follow' }
  assert.equal(onCharacterZone(sel, 'sro'), sel)
})

// ── a pick is a PIN ────────────────────────────────────────────────────────────────────

test('picking a zone pins it, and a zone line arriving afterwards does not move the map', () => {
  const picked = onPick('airplane')
  assert.deepEqual(picked, { zone: 'airplane', mode: 'pinned' })
  // The headline refusal — and it is the identical object, so a zone line while you are reading
  // another map does not even re-render the viewer.
  assert.equal(onCharacterZone(picked, 'sro'), picked)
  assert.equal(onCharacterZone(picked, null), picked)
})

test('THE REPORTED JOURNEY: pick a map, leave the tab, come back — still that map', () => {
  const s = store({ [LAST_ZONE_KEY]: 'sro', [ZONE_MODE_KEY]: 'follow' })
  // You are in South Ro; you go and read the Plane of Sky.
  saveZoneSelection(onPick('airplane'), s)
  // Clicking Loot unmounts the whole view; clicking Maps builds a new one, which reads the store.
  const remounted = loadZoneSelection(s)
  assert.deepEqual(remounted, { zone: 'airplane', mode: 'pinned' })
  // …and the remount's very first act — applying the character's stated zone — is the step that
  // used to undo the restore. It is now a no-op.
  assert.equal(onCharacterZone(remounted, 'sro'), remounted)
})

// ── and Current zone is the way back ───────────────────────────────────────────────────

test('Current zone snaps to the character and follows again from then on', () => {
  let sel = onPick('airplane')
  sel = onFollowCurrent(sel, 'sro', true)
  assert.deepEqual(sel, { zone: 'sro', mode: 'follow' })
  // The other half of "follows again": the NEXT zone line moves the map.
  sel = onCharacterZone(sel, 'gfaydark')
  assert.deepEqual(sel, { zone: 'gfaydark', mode: 'follow' })
})

test('Current zone with no zone line yet keeps the remembered map instead of blanking the pane', () => {
  const sel = onFollowCurrent({ zone: 'airplane', mode: 'pinned' }, null, false)
  assert.deepEqual(sel, { zone: 'airplane', mode: 'follow' })
})

test('…but a STATED zone the table cannot place still clears it — absent and unplaceable differ', () => {
  const sel = onFollowCurrent({ zone: 'airplane', mode: 'pinned' }, null, true)
  assert.deepEqual(sel, { zone: null, mode: 'follow' })
})

// ── what is remembered, and under which keys ───────────────────────────────────────────

test('the keys are exactly these two — a rename would silently drop every user’s saved map', () => {
  assert.equal(LAST_ZONE_KEY, 'eq.maps.zone')
  assert.equal(ZONE_MODE_KEY, 'eq.maps.zoneMode')
})

test('both modes are written, not just the sticky one', () => {
  const s = store()
  saveZoneSelection(onPick('airplane'), s)
  assert.deepEqual(s.all(), { [ZONE_MODE_KEY]: 'pinned', [LAST_ZONE_KEY]: 'airplane' })
  // JOS-90's un-tick lesson: a store that only ever recorded the interesting value would leave a
  // user who asked to follow again pinned after the next restart.
  saveZoneSelection(onFollowCurrent({ zone: 'airplane', mode: 'pinned' }, 'sro', true), s)
  assert.deepEqual(s.all(), { [ZONE_MODE_KEY]: 'follow', [LAST_ZONE_KEY]: 'sro' })
  assert.deepEqual(loadZoneSelection(s), { zone: 'sro', mode: 'follow' })
})

test('a follow into an unplaceable zone leaves the last real map remembered', () => {
  const s = store({ [LAST_ZONE_KEY]: 'sro', [ZONE_MODE_KEY]: 'follow' })
  saveZoneSelection(onCharacterZone({ zone: 'sro', mode: 'follow' }, null), s)
  // The pane is blank right now (that is the state above), but the next LAUNCH opens somewhere
  // rather than nowhere — which is what the viewer has always done with the last zone.
  assert.deepEqual(loadZoneSelection(s), { zone: 'sro', mode: 'follow' })
})

test('a pin with nothing pinned, and any unrecognised mode, fold to following', () => {
  assert.deepEqual(loadZoneSelection(store({ [ZONE_MODE_KEY]: 'pinned' })), FRESH)
  assert.deepEqual(loadZoneSelection(store({ [LAST_ZONE_KEY]: '', [ZONE_MODE_KEY]: 'pinned' })), FRESH)
  assert.deepEqual(loadZoneSelection(store({ [LAST_ZONE_KEY]: 'sro', [ZONE_MODE_KEY]: 'PINNED' })), {
    zone: 'sro',
    mode: 'follow'
  })
  assert.deepEqual(loadZoneSelection(store({ [LAST_ZONE_KEY]: 'sro', [ZONE_MODE_KEY]: '{}' })), {
    zone: 'sro',
    mode: 'follow'
  })
})

test('a pinned selection survives the store round trip verbatim', () => {
  const s = store()
  const sel = saveZoneSelection(onPick('soldungb'), s)
  assert.deepEqual(loadZoneSelection(s), sel)
})
