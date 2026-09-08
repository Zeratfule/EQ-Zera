// ============================================================================
// characterShare.test.mts — SHARING A CHARACTER PROFILE (EQ Zera).
// ============================================================================
//
// The feature is "hand your gear and your gear scores to somebody else", and it rides the app's
// existing `EQC1-` envelope as `kind:'character'`. What is guarded here, and why each one is
// load-bearing:
//
//   * FIXED POINT. build -> encode -> decode -> encode returns the same profile and the same BODY
//     CHECKSUM. That is the property the whole feature rests on: a card the sharer checked is the
//     card the reader sees, and the body is stable enough to be re-served by a backend later
//     (profiles.ts's forward design) without its `sum` moving. The whole STRING is deliberately
//     not the assertion — the envelope stamps a fresh `at` on every wrap, which is why the
//     checksum was put over the body rather than over the envelope in the first place.
//   * CHECKSUM. A body edited under a stale `sum` is REJECTED rather than drawn. This is the one
//     that matters most here: unlike an alert set, a character profile is drawn as a claim about a
//     real person on a real server, so "somebody changed the numbers" must not render.
//   * SIZE. A profile is capped in every dimension, and an over-long paste is refused before a
//     byte is inflated.
//   * JUNK IS STRIPPED. `sanitizeCharacterShare` rebuilds field by field, so an extra key cannot
//     survive a round trip and a hostile value cannot reach a URL or a style property.
//   * SCORES ARE OMITTED, NOT ZEROED (world-model law 1). `meterPercent` answers 0 for "no best to
//     measure against" as well as for "your set is worthless"; a share must never turn the first
//     into the second, so an absent reading stays absent through build, encode, decode and text.
//
// IT RUNS ON THE REAL DUMP. `Primitive_freeport-Inventory.txt` is the committed 295-line
// `/outputfile inventory` every other character-sheet test is pinned against (24 cells, 22 worn),
// joined here to the committed item DB exactly as `src/main/ipc/characterSheet.ts` joins it — so
// the profile under test is the shape the app actually produces, and the measured string length
// below is the real one rather than a toy's.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { sheetCells, sumGear, type SheetCellView, type WornItemBlock } from '../src/shared/characterSheet'
import { buildItemDbIndex, itemKey, type ItemDbFile } from '../src/main/itemsDb'
import {
  buildCharacterShare,
  characterShareText,
  sanitizeCharacterShare,
  type CharacterProfileShare,
  type ShareScores
} from '../src/shared/characterShare'
import { SHARE_LIMITS, SHARE_PREFIX, canonicalJson, checksum, makeEnvelope } from '../src/shared/profiles'
import { decodeCharacterShare, encodeCharacterShare, shareImageName } from '../src/main/characterShare'
import { encodeShareString } from '../src/main/shareCodec'

const APP = '1.5.0'
const CAPTURED = 1_757_000_000_000

// ---- the real character, joined the way the handler joins it ---------------------------

const dump = parseInventoryDump(
  readFileSync(join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'), 'utf8')
)
const dbIndex = buildItemDbIndex(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'data', 'items.json'), 'utf8')
  ) as ItemDbFile
)

/** `joinCell`'s two contributions, re-done here so this stays an Electron-free node test. */
const cells: SheetCellView[] = sheetCells(dump).cells.map((cell) => {
  if (!cell.item) return { ...cell, item: null }
  const record = dbIndex.get(itemKey(cell.item.baseName))
  return {
    ...cell,
    item: {
      ...cell.item,
      known: record !== undefined,
      ...(record?.iconId === undefined ? {} : { iconId: record.iconId })
    }
  }
})
const worn: WornItemBlock[] = []
for (const cell of cells) {
  if (cell.item) worn.push({ tier: cell.item.tier, block: dbIndex.get(itemKey(cell.item.baseName))?.stats })
}
const totals = sumGear(worn)

const SCORES: ShareScores = { tank: 74, dps: 61, heal: 38, solo: 55 }

/** `null` means "the Build tab had no reading", which is not the same as `undefined` defaulting. */
function profileOf(scores: ShareScores | null = SCORES): CharacterProfileShare {
  return buildCharacterShare({
    cells,
    totals,
    look: { race: 'DW', sex: 'F', face: 2 },
    classes: ['WAR', 'CLR', 'SHM'],
    name: 'Primitive',
    level: 60,
    scores: scores ?? undefined,
    capturedAt: CAPTURED
  })
}

// ---- the projection ---------------------------------------------------------------------

test('the profile carries the WORN cells and nothing else off the sheet', () => {
  const profile = profileOf()
  assert.equal(profile.cells.length, 22, 'the fixture wears twenty-two of the twenty-four places')
  assert.equal(profile.totals.counted + profile.totals.unknown, 22, 'every worn item is accounted for')
  assert.ok(profile.cells.every((c) => c.item.length > 0 && c.slot.length > 0))
  // The two things a projection must not leak: a machine path, and the sheet's own bookkeeping.
  const json = canonicalJson(profile)
  assert.ok(!/[A-Za-z]:\\\\|\/Users\//.test(json), 'no path can appear - nothing here reads one')
  assert.ok(!json.includes('"known"'), 'the DB-join flag is bookkeeping and stays home')
  assert.ok(!json.includes('"baseName"'), 'the join key stays home; the card prints the dump name')
})

test('the item names ride VERBATIM, ` +N` and all', () => {
  const profile = profileOf()
  const tiered = profile.cells.filter((c) => c.tier !== undefined)
  assert.ok(tiered.length > 0, 'the fixture wears upgraded gear, or this proves nothing')
  assert.ok(tiered.every((c) => / \+\d+$/.test(c.item)), 'the suffix the dump spelled is still spelled')
})

// ---- the fixed point --------------------------------------------------------------------

test('build -> encode -> decode -> encode is a fixed point, in the value and in the checksum', () => {
  const profile = profileOf()
  const text = encodeCharacterShare(profile, APP)
  assert.ok(text, 'a real profile encodes')
  assert.ok(text.startsWith(SHARE_PREFIX), 'carries the human-readable prefix')
  assert.ok(!/\s/.test(text), 'is a single line')
  assert.ok(!/[+/=]/.test(text.slice(SHARE_PREFIX.length)), 'is base64url - nothing chat can mangle')

  const back = decodeCharacterShare(text)
  assert.ok(back.ok, back.ok ? '' : back.error)
  assert.deepEqual(back.profile, profile, 'the profile survives the wire unchanged')
  assert.equal(back.appVersion, APP)

  // THE SECOND PASS is the half that proves stability, and it is asserted on the BODY rather than
  // on the whole string: an envelope carries `at`, a fresh wall clock every time, so two encodes a
  // millisecond apart legitimately differ by a character. What must not move is the body and its
  // checksum — which is exactly why `sum` is over the body and not the envelope (profiles.ts: a
  // backend re-serving the same body keeps the same sum). Idempotent sanitizing is the property.
  assert.equal(checksum(canonicalJson(back.profile)), checksum(canonicalJson(profile)))
  const twice = decodeCharacterShare(encodeCharacterShare(back.profile, APP) ?? '')
  assert.ok(twice.ok)
  assert.deepEqual(twice.profile, profile, 'a second round trip moves nothing')
})

test('the fixture profile is a chat-sized string, and the length is stated', () => {
  const text = encodeCharacterShare(profileOf(), APP)
  assert.ok(text)
  console.log(`  character share string: ${String(text.length)} chars for the 22-item fixture`)
  assert.ok(text.length < SHARE_LIMITS.maxStringChars, 'well inside the decode cap')
  assert.ok(text.length > SHARE_PREFIX.length + 100, 'and it is actually carrying the character')
})

// ---- the checksum -----------------------------------------------------------------------

test('a body edited under a stale checksum is REJECTED, never drawn', () => {
  const profile = profileOf()
  const honest = makeEnvelope('character', profile, APP)
  // Somebody doubles every score and leaves the envelope's `sum` alone - the exact attack a card
  // drawn as a claim about a real player invites.
  const tampered = {
    ...honest,
    body: { ...profile, scores: { tank: 100, dps: 100, heal: 100, solo: 100 } }
  }
  assert.notEqual(checksum(canonicalJson(tampered.body)), honest.sum, 'the fixture must actually differ')
  const res = decodeCharacterShare(encodeShareString(tampered))
  assert.equal(res.ok, false)
  assert.match(res.ok ? '' : res.error, /integrity check/i)
})

test('a truncated paste is reported as damaged, never half-drawn', () => {
  const text = encodeCharacterShare(profileOf(), APP)
  assert.ok(text)
  const res = decodeCharacterShare(text.slice(0, text.length - 12))
  assert.equal(res.ok, false)
  assert.match(res.ok ? '' : res.error, /damaged|integrity/i)
})

test('a settings string pasted into the character viewer is told where it belongs', () => {
  const res = decodeCharacterShare(encodeShareString(makeEnvelope('settings', { alertPrefs: { globalVolume: 1, muted: false } }, APP)))
  assert.equal(res.ok, false)
  assert.match(res.ok ? '' : res.error, /Preferences/)
})

// ---- size ------------------------------------------------------------------------------

test('an oversized profile is capped, not carried', () => {
  const profile = profileOf()
  const huge = {
    ...profile,
    cells: Array.from({ length: 5_000 }, (_, i) => ({ ...profile.cells[0], slot: `s${String(i)}` })),
    classes: Array.from({ length: 200 }, () => 'WAR'),
    totals: { ...profile.totals, stats: Array.from({ length: 900 }, () => ({ label: 'HP', total: 1 })) }
  }
  const clean = sanitizeCharacterShare(huge)
  assert.ok(clean)
  assert.equal(clean.cells.length, SHARE_LIMITS.maxCharacterCells)
  assert.equal(clean.classes.length, SHARE_LIMITS.maxCharacterClasses)
  assert.equal(clean.totals.stats.length, SHARE_LIMITS.maxCharacterStats)
})

test('an over-long paste is refused before a byte is inflated', () => {
  const res = decodeCharacterShare(SHARE_PREFIX + 'A'.repeat(SHARE_LIMITS.maxStringChars + 1))
  assert.equal(res.ok, false)
  assert.match(res.ok ? '' : res.error, /too large/i)
})

test('a body with no worn cell at all is an empty payload, not an empty character', () => {
  assert.equal(sanitizeCharacterShare({ ...profileOf(), cells: [] }), null)
  assert.equal(encodeCharacterShare({ cells: [] }, APP), null)
  assert.equal(sanitizeCharacterShare('EQC1-not-an-object'), null)
  assert.equal(sanitizeCharacterShare(null), null)
})

// ---- untrusted input --------------------------------------------------------------------

test('junk in a decoded object is STRIPPED, not carried into the card', () => {
  const clean = sanitizeCharacterShare({
    v: 1,
    capturedAt: CAPTURED,
    name: 'Primitive',
    level: 60,
    classes: ['WAR', 42, '', 'CLR'],
    look: { race: 'DW', sex: 'F', face: 2, evil: 'x' },
    cells: [
      { slot: 'chest', label: 'Chest', item: 'Breastplate', exaltations: [], evil: 'x' },
      { slot: '', label: 'Nothing', item: 'Ghost' },
      { slot: 'head', label: 'Head', item: '' }
    ],
    totals: { ac: 100, stats: [{ label: 'HP', total: 10, evil: 1 }], counted: 1, unknown: 0 },
    scores: SCORES,
    evil: { deeply: 'nested' },
    __proto__: { polluted: true }
  })
  assert.ok(clean)
  const json = canonicalJson(clean)
  assert.ok(!json.includes('evil'), 'an unknown key cannot survive a rebuild')
  assert.ok(!json.includes('polluted'))
  assert.equal(clean.cells.length, 1, 'a cell with no slot or no item is not a cell')
  assert.deepEqual(clean.classes, ['WAR', 'CLR'], 'a non-string class is dropped, not stringified')
  assert.deepEqual(clean.totals.stats, [{ label: 'HP', total: 10 }])
})

test('a hostile value never reaches a URL, a style or a lookup', () => {
  const clean = sanitizeCharacterShare({
    ...profileOf(),
    look: { race: 'javascript:alert(1)', sex: 'attacker' },
    level: 9_999_999,
    cells: [
      {
        slot: 'chest',
        label: 'Chest',
        item: 'x'.repeat(5_000),
        iconId: 'javascript:alert(1)',
        tier: Number.POSITIVE_INFINITY,
        exaltations: ['a'.repeat(5_000)]
      }
    ]
  })
  assert.ok(clean)
  // The icon id reaches `eqimg://item/<id>`, so anything that is not a number is simply absent.
  assert.equal(clean.cells[0].iconId, undefined)
  assert.equal(clean.cells[0].tier, undefined, 'Infinity is not a tier')
  assert.equal(clean.cells[0].item.length, SHARE_LIMITS.maxNameChars)
  assert.equal(clean.cells[0].exaltations[0].length, SHARE_LIMITS.maxNameChars)
  assert.equal(clean.look.race, 'HU', 'a race this build cannot draw degrades to the default')
  assert.equal(clean.look.sex, 'M')
  assert.equal(clean.level, 999, 'clamped into range rather than refused outright')
})

// ---- scores are omitted, never zeroed ---------------------------------------------------

test('a profile the Build tab could not score carries NO scores, through the whole pipe', () => {
  const profile = profileOf(null)
  assert.ok(!('scores' in profile), 'absent, not zeroed')
  const text = encodeCharacterShare(profile, APP)
  assert.ok(text)
  assert.ok(!text.includes('scores'))
  const back = decodeCharacterShare(text)
  assert.ok(back.ok)
  assert.equal(back.profile.scores, undefined)
  assert.ok(!characterShareText(back.profile).includes('%'), 'and the text summary states no percent')
})

test('a partial score row is no score row at all', () => {
  const clean = sanitizeCharacterShare({ ...profileOf(), scores: { tank: 74, dps: 61, heal: 38 } })
  assert.ok(clean)
  assert.equal(clean.scores, undefined, 'three of four is not a reading this card may draw')
  const negative = sanitizeCharacterShare({ ...profileOf(), scores: { tank: -5, dps: 900, heal: 38, solo: 55 } })
  assert.ok(negative?.scores)
  assert.deepEqual(negative.scores, { tank: 0, dps: 100, heal: 38, solo: 55 }, 'a percent is 0..100')
})

// ---- the text summary -------------------------------------------------------------------

test('the text summary states who, then the scores, then one line per worn slot', () => {
  const lines = characterShareText(profileOf()).split('\n')
  assert.equal(lines[0], 'Primitive - level 60 - WAR / CLR / SHM')
  assert.equal(lines[1], 'Tank 74% · DPS 61% · Healer 38% · Solo 55%')
  assert.match(lines[2], /^AC \d+ from \d+ of 22 worn items$/)
  assert.equal(lines[3], '')
  assert.equal(lines.at(-1), 'Shared from EQ Zera')
  // One line per WORN slot and not one per place: the empty two say nothing.
  const gear = lines.slice(4, lines.length - 2)
  assert.equal(gear.length, 22)
  assert.ok(gear.every((l) => l.includes(': ')))
  assert.ok(!/[–—]/.test(lines.join('\n')), 'no em dashes in copy a player pastes')
})

test('the summary says nothing it was not told', () => {
  const bare = buildCharacterShare({
    cells,
    totals,
    look: { race: 'HU', sex: 'M' },
    classes: [],
    capturedAt: CAPTURED
  })
  const lines = characterShareText(bare).split('\n')
  assert.equal(lines[0], 'A character', 'no name, no level, no classes - and no placeholders either')
})

// ---- the image's file name --------------------------------------------------------------

test('the save dialog default is dated and can never be path-shaped', () => {
  assert.match(shareImageName('Primitive'), /^eq-zera-Primitive-\d{4}-\d{2}-\d{2}\.png$/)
  assert.match(shareImageName('..\\..\\Windows\\System32'), /^eq-zera-[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}\.png$/)
  assert.ok(!shareImageName('../evil').includes('/'))
  assert.match(shareImageName(''), /^eq-zera-character-\d{4}-\d{2}-\d{2}\.png$/)
})
