// GAME-FILE HEALTH: THE ALARMS THE FIRST VERSION MISSED, AND THE ONES IT RAISED FOR NOTHING
// (EQ Zera, 2026-11-25, two independent reviews of the first cut).
//
//   - A patch that DROPS a column makes every row 172 wide; 172 is no longer a known width.
//   - A patch that moves columns and keeps the width is caught by the per-column checks
//     (src/main/resist/spellsUsSemantics.ts; the full sweep is tests/spellsUsShiftSweep.test.mts).
//   - A known width that parses to no spells (blank names) is unrecognised.
//   - An empty or half-written file is pending; a full-size archive whose directory is outside the
//     file is pending once and unrecognised when a re-check finds it unchanged.
//   - The report's message keeps its useful numbers, and every failed check, through redaction.
//   - Only readers that matter to this player file a report; eqclient.ini without mode keys is a
//     fresh install.
//   - The layout sidecar is keyed on the parser that measured it.
//
// Synthetic rows only, shaped like the real file (tests/spellsUsShape.mts).

import test from 'node:test'
import assert from 'node:assert/strict'
import { caretLayout, dbstrHealth, eqclientIniHealth, modelsHealth, spellsUsHealth } from '../src/shared/gameFileDetect'
import { gameFileNotice, reportMessage, settlePending, shouldReport, type GameFileReport } from '../src/shared/gameFileHealth'
import { redactMessage } from '../src/shared/errorReport'
import { KNOWN_ROW_LENGTHS, parseSpellsUs } from '../src/main/resist/spellsUsParse'
import { SEMANTICS_VERSION, spellsUsMetaKey, spellsUsSemantics } from '../src/main/resist/spellsUsSemantics'
import { joinRows, shaped190, shapedRow } from './spellsUsShape.mjs'

const twenty = <T,>(make: (i: number) => T): T[] => Array.from({ length: 20 }, (_, i) => make(i))

function verdict(text: string, entries?: number): GameFileReport {
  const m = { layout: caretLayout(text), semantics: spellsUsSemantics(text), version: '1-2' }
  return spellsUsHealth(entries === undefined ? m : { ...m, entries }, KNOWN_ROW_LENGTHS)
}

test('a file whose rows all lost one column (172 wide) is unrecognised, and the parser reads none of it', () => {
  assert.equal(KNOWN_ROW_LENGTHS.has(172), false)
  const text = joinRows(twenty((i) => shapedRow(i).slice(0, 172)))
  assert.equal(verdict(text).status, 'unrecognised')
  assert.deepEqual(parseSpellsUs(text), {})
})

test('the real-shaped 190 layout passes every field check', () => {
  const r = verdict(joinRows(twenty(shaped190)))
  assert.equal(r.status, 'ok', JSON.stringify(r))
})

test('columns moved at the same width (one in before 77, one out of 173..188) is unrecognised', () => {
  const shifted = twenty((i) => {
    const f = shaped190(i)
    f.splice(40, 0, '0')
    f.splice(180, 1)
    return f
  })
  assert.equal(shifted[0].length, 190)
  const r = verdict(joinRows(shifted))
  assert.equal(r.status, 'unrecognised', JSON.stringify(r))
  assert.equal(r.signature, 'fields-190-moved')
})

test('a known width with blank names is unrecognised, and so is a parse that yielded no spells', () => {
  const blank = joinRows(twenty((i) => shaped190(i).map((v, c) => (c === 1 ? '' : v))))
  assert.equal(verdict(blank).status, 'unrecognised')
  const r = verdict(joinRows(twenty(shaped190)), 0)
  assert.equal(r.status, 'unrecognised')
  assert.equal(r.signature, 'no-spells')
})

test('empty and half-written files are pending, never a notice and never a report', () => {
  const pending = [
    verdict(''),
    dbstrHealth('', 'v'),
    modelsHealth({ a: { head: new Uint8Array(0), size: 0 } }, 'v'),
    modelsHealth({ a: { head: new Uint8Array([0x00, 0x10, 0, 0, 0x50, 0x46, 0x53, 0x20]), size: 100 } }, 'v')
  ]
  for (const r of pending) {
    assert.equal(r.status, 'pending', JSON.stringify(r))
    assert.equal(shouldReport(r, [], () => true), false)
  }
  assert.equal(gameFileNotice(pending, []), null)
})

test('a full-size archive with its directory outside the file settles to unrecognised; a short one stays pending', () => {
  const badDir = modelsHealth({ a: { head: new Uint8Array([0x00, 0x10, 0, 0, 0x50, 0x46, 0x53, 0x20]), size: 100 } }, 'v1')
  assert.equal(badDir.signature, 'directory')
  assert.equal(settlePending(undefined, badDir).status, 'pending', 'first sight: the directory may still be being written')
  assert.equal(settlePending(badDir, badDir).status, 'unrecognised', 'unchanged on the re-check')
  assert.equal(settlePending(badDir, { ...badDir, version: 'v2' }).status, 'pending', 'the file moved: still copying')
  const short = modelsHealth({ a: { head: new Uint8Array(0), size: 0 } }, 'v1')
  assert.equal(settlePending(short, short).status, 'pending')
})

test('the report message keeps its useful numbers through redaction', () => {
  const r: GameFileReport = {
    id: 'spellsUs',
    status: 'unrecognised',
    signature: 'fields-200',
    facts: { rows: 74024, rowsRead: 0, rowsSkipped: 74024, fields: 200 },
    histogram: { '200': 74024, '17': 3, '190': 1 },
    version: '40752305-1794869464000'
  }
  const redacted = redactMessage(reportMessage(r))
  assert.doesNotMatch(redacted, /<n>/, redacted)
  assert.match(redacted, /rows=74k/)
  assert.match(redacted, /rowsSkipped=100%/)
  assert.match(redacted, /200x100%/)
})

test('a -moved report keeps every failed check within the redacted 200-character message', () => {
  const shifted = twenty((i) => {
    const f = shaped190(i)
    f.splice(8, 0, '0')
    f.splice(62, 1)
    return f
  })
  const r = verdict(joinRows(shifted))
  assert.equal(r.status, 'unrecognised')
  const failed = Object.keys(r.facts).filter((k) => k.endsWith('Pct'))
  assert.ok(failed.length >= 2, JSON.stringify(r.facts))
  const redacted = redactMessage(reportMessage(r))
  assert.ok(redacted.length <= 200)
  for (const k of failed.slice(0, 2)) assert.match(redacted, new RegExp(`${k}=\\d+`), redacted)
  assert.doesNotMatch(redacted, /Pct=100\b/, 'passing checks are not in the message')
})

test('a move across many columns still fits: the failed count first, then the first checks in column order', () => {
  const shifted = twenty((i) => {
    const f = shaped190(i)
    f.splice(5, 0, '0')
    f.splice(78, 1)
    return f
  })
  const r = verdict(joinRows(shifted))
  const redacted = redactMessage(reportMessage(r))
  assert.ok((r.facts.failed ?? 0) > 8, JSON.stringify(r.facts))
  assert.match(redacted, /fields-190-moved failed=\d+ rows=20 fields=190 c\d+Pct=\d+/, redacted)
  assert.match(redacted, / fields 190x100%$/, 'the histogram survives at the end')
})

test('only readers that matter to this player file a report', () => {
  const luclin: GameFileReport = { id: 'globalLoad', status: 'unrecognised', signature: 'no-anchor', facts: {}, version: 'v' }
  assert.equal(shouldReport(luclin, [], () => false), false, 'Luclin models off')
  assert.equal(shouldReport(luclin, [], () => true), true, 'Luclin models on')
  const ini: GameFileReport = { id: 'eqclientIni', status: 'unrecognised', signature: 'no-sections', facts: {}, version: 'v' }
  assert.equal(shouldReport(ini, [], () => true), false, 'eqclient.ini never notices, so never files')
})

test('eqclient.ini without the mode keys is a fresh install, not a layout change', () => {
  assert.equal(eqclientIniHealth('[Defaults]\r\nSound=1\r\n', false, 'v').status, 'missing')
  assert.equal(eqclientIniHealth('', false, 'v').status, 'pending')
})

test('the layout sidecar key names the parser: cache version, widths and checks', () => {
  const now = spellsUsMetaKey(6, KNOWN_ROW_LENGTHS)
  assert.notEqual(spellsUsMetaKey(7, KNOWN_ROW_LENGTHS), now)
  assert.notEqual(spellsUsMetaKey(6, new Set([173, 174])), now)
  assert.notEqual(spellsUsMetaKey(6, KNOWN_ROW_LENGTHS, SEMANTICS_VERSION + 1), now)
  assert.equal(spellsUsMetaKey(6, new Set([...KNOWN_ROW_LENGTHS].reverse())), now)
})
