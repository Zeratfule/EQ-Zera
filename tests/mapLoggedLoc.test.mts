// THE LOGGED /loc (2026-11-27) — when the map may draw the position the game wrote to the log, and
// what a NEW reading may do to the floor on screen.
//
// The line itself is parsed by the engine (eqlog `parse/loc.rs`, its own unit tests: the measured
// line `Your Location is 218.95, 91.12, 17.90`, chat/tell/say spoofs, negatives, malformed), and
// the live-only / zone-attribution / drop-on-zone rules are the character module's
// (`engine/crates/fold/tests/logged_loc.rs`). This suite pins the renderer's half: the second
// staleness lock, the drawn-zone gate, the floor rule and the label. Pure, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  currentLoggedLoc,
  floorForNewLoc,
  floorShowing,
  inView,
  loggedLocElsewhere,
  loggedLocKey,
  loggedLocLabel,
  loggedLocTime,
  readingToAct
} from '../src/renderer/src/features/maps/loggedLoc'
import { parseLoc } from '../src/renderer/src/features/maps/locMarker'
import type { FloorBand } from '../src/renderer/src/features/maps/floorSlice'
import { zoneShortName } from '../src/shared/zones'
import type { LoggedLoc } from '../src/shared/characterTypes'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The measured reading, as the character module publishes it (zone is the log's raw spelling). */
const NEK = 'Nektropos Castle 2 (Adaptive)'
const READING: LoggedLoc = { ns: 218.95, ew: 91.12, z: 17.9, ts: new Date(2026, 10, 27, 16, 44, 57).getTime(), zone: NEK }

/** Three floors, ascending. `bandRange` extends each to the midpoint of the void beside it. */
const BANDS: FloorBand[] = [
  { lo: -100, hi: -60, levels: 4 },
  { lo: 0, hi: 30, levels: 4 },
  { lo: 80, hi: 120, levels: 4 }
]

test('the zone the reading was filed under resolves to a map stem', () => {
  assert.notEqual(zoneShortName(NEK), null, `${NEK} must map, or the marker can never draw`)
})

test('the map draws the reading only on the map of the zone you are in', () => {
  const stem = zoneShortName(NEK)
  assert.equal(currentLoggedLoc({ zone: NEK, loc: READING }, stem), READING)
  // a pinned map of somewhere else, or the previous zone's map still drawn while the new one loads
  assert.equal(currentLoggedLoc({ zone: NEK, loc: READING }, 'freporte'), null)
  // no map drawn
  assert.equal(currentLoggedLoc({ zone: NEK, loc: READING }, null), null)
  // no reading
  assert.equal(currentLoggedLoc({ zone: NEK }, stem), null)
  assert.equal(currentLoggedLoc(null, stem), null)
})

test('a reading filed under a zone you have since left is never drawn as current', () => {
  // The engine drops it on the zone line; this is the second lock for a snapshot caught mid-change.
  const stem = zoneShortName(NEK)
  assert.equal(currentLoggedLoc({ zone: 'East Freeport', loc: READING }, stem), null)
  assert.equal(currentLoggedLoc({ loc: READING }, stem), null, 'no zone stated - never guess')
})

test('a current reading another map cannot show is stated, not silently dropped', () => {
  const stem = zoneShortName(NEK)
  assert.deepEqual(loggedLocElsewhere({ zone: NEK, loc: READING }, 'freporte'), { zone: NEK, mapped: true })
  assert.equal(loggedLocElsewhere({ zone: NEK, loc: READING }, stem), null, 'the drawn map shows it')
  const unmapped = { ...READING, zone: 'The EQL Tutorial Nowhere' }
  assert.deepEqual(loggedLocElsewhere({ zone: unmapped.zone, loc: unmapped }, 'freporte'), {
    zone: unmapped.zone,
    mapped: false
  })
  // a stale reading (zone since left) is never stated anywhere
  assert.equal(loggedLocElsewhere({ zone: 'East Freeport', loc: READING }, 'freporte'), null)
  assert.equal(loggedLocElsewhere({ zone: NEK }, 'freporte'), null)
})

test('each new reading has a new identity; the same reading keeps its own', () => {
  const again = { ...READING }
  assert.equal(loggedLocKey(READING), loggedLocKey(again))
  assert.notEqual(loggedLocKey(READING), loggedLocKey({ ...READING, ts: READING.ts + 1000 }))
  assert.notEqual(loggedLocKey(READING), loggedLocKey({ ...READING, ns: -10 }))
  assert.equal(loggedLocKey(null), null)
  assert.equal(loggedLocKey(undefined), null)
})

test('a reading that lands while its map is loading is acted on when the map arrives, once', () => {
  const mountKey = loggedLocKey(READING)
  // present at mount and drawn: already seen, nothing moves
  assert.equal(readingToAct(mountKey, READING, READING), false)
  // a new reading while the new zone's map loads: not drawable yet, so NOT consumed...
  const next = { ...READING, ts: READING.ts + 60_000 }
  assert.equal(readingToAct(mountKey, next, null), false)
  // ...and acted on the moment it is drawable
  assert.equal(readingToAct(mountKey, next, next), true)
  // once acted (seen := its key), never again
  assert.equal(readingToAct(loggedLocKey(next), next, next), false)
})

test('the label states the minute it was read, so it never reads as live tracking', () => {
  assert.equal(loggedLocTime(READING), '16:44')
  assert.equal(loggedLocLabel(READING), 'You (from /loc, 16:44)')
})

test('THE FLOOR RULE: a new reading moves a specific floor to its own band, only while following', () => {
  // following, on floor 1 (lowest), the reading's z 17.9 is floor 2 -> move
  assert.equal(floorForNewLoc({ mode: 'follow', bands: BANDS, floor: 0, z: 17.9 }), 1)
  // already on the right floor -> unchanged
  assert.equal(floorForNewLoc({ mode: 'follow', bands: BANDS, floor: 1, z: 17.9 }), 1)
  // All levels already shows it -> left alone
  assert.equal(floorForNewLoc({ mode: 'follow', bands: BANDS, floor: null, z: 17.9 }), null)
  // pinned: you are reading this map on purpose -> never moved
  assert.equal(floorForNewLoc({ mode: 'pinned', bands: BANDS, floor: 0, z: 17.9 }), 0)
  assert.equal(floorForNewLoc({ mode: 'pinned', bands: BANDS, floor: null, z: 17.9 }), null)
  // a negative z on the lowest floor
  assert.equal(floorForNewLoc({ mode: 'follow', bands: BANDS, floor: 2, z: -75 }), 0)
})

test('the chip click shows the reading on its floor, and never leaves All levels', () => {
  assert.equal(floorShowing(BANDS, 2, 17.9), 1)
  assert.equal(floorShowing(BANDS, null, 17.9), null)
  // no bands at all (a flat zone) -> the floor the user chose stands
  assert.equal(floorShowing([], 0, 17.9), 0)
})

test('the modest pan only moves a view that cannot see the point', () => {
  const rect = { minX: -10, maxX: 10, minY: -10, maxY: 10 }
  assert.equal(inView(rect, { x: 0, y: 0 }), true)
  assert.equal(inView(rect, { x: 10, y: -10 }), true)
  assert.equal(inView(rect, { x: 11, y: 0 }), false)
  assert.equal(inView(rect, { x: 0, y: -11 }), false)
})

test('the paste box reads the measured log line the same way the engine does (ns first)', () => {
  const pasted = parseLoc('[Fri Nov 27 16:44:57 2026] Your Location is 218.95, 91.12, 17.90')
  assert.deepEqual(pasted, { ok: true, loc: { ns: 218.95, ew: 91.12, z: 17.9 } })
})

test('the engine parser is anchored on the system line and claims the kind the app declares', () => {
  // The renderer cannot run the Rust parser; it CAN hold the two vocabularies to each other.
  const loc = readFileSync(join(ROOT, 'engine', 'crates', 'eqlog', 'src', 'parse', 'loc.rs'), 'utf8')
  assert.match(loc, /Regex::new\(&format!\(r"\^Your Location is \{n\}, \{n\}, \{n\}\$"\)\)/)
  const event = readFileSync(join(ROOT, 'engine', 'crates', 'eqlog', 'src', 'event.rs'), 'utf8')
  assert.match(event, /Kind::Loc => "loc"/)
  for (const key of ['ns', 'ew', 'z']) assert.match(event, new RegExp(`=> "${key}",`))
  const character = readFileSync(join(ROOT, 'engine', 'crates', 'fold', 'src', 'modules', 'character.rs'), 'utf8')
  assert.match(character, /let fresh = live && ev\.ts\(\) >= self\.newest_ts;/, 'the module gates on the live flag')
  assert.match(character, /"loc" => self\.state_loc\(ev, fresh\)/)
})
