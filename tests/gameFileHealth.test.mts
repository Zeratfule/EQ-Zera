// GAME-FILE HEALTH, PINNED (EQ Zera, 2026-11-25).
//
// The incident this guards: a client patch widened `spells_us.txt` to 190 fields, the parser
// skipped every row (correctly: a moved column read at the old offset is a wrong number), the
// resist table came out empty and nothing on screen said so. Every detector here is driven by
// SYNTHETIC input (Daybreak's files never enter this repo): a good file, a file at a width no build
// has measured, and an empty one, plus the notice and report rules the renderer and main share.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  caretLayout,
  dbstrHealth,
  eqclientIniHealth,
  globalLoadHealth,
  mapsHealth,
  modelsHealth,
  spellsUsHealth,
  uiSkinHealth
} from '../src/shared/gameFileDetect'
import {
  dismissKey,
  gameFileNotice,
  noticeSentence,
  reportErrorName,
  reportKey,
  reportMessage,
  shouldReport,
  type GameFileReport
} from '../src/shared/gameFileHealth'
import { redactMessage } from '../src/shared/errorReport'
import { KNOWN_ROW_LENGTHS } from '../src/main/resist/spellsUsParse'
import { spellsUsSemantics } from '../src/main/resist/spellsUsSemantics'
import { joinRows, shaped190 } from './spellsUsShape.mjs'
import { probeGameFiles, spread } from '../src/main/gameFileHealth/probe'

/** One spell row `width` fields wide: Lifetap's id and name, every class barred but SHD. */
function spellRow(width: number, id = 341, name = 'Lifetap'): string {
  const f = new Array<string>(width).fill('0')
  f[0] = String(id)
  f[1] = name
  for (let i = 36; i < 52; i++) f[i] = '255'
  f[40] = '1'
  f[width - 1] = '1|0|-4|0|101|8'
  return f.join('^')
}

function spellFile(width: number, rows: number): string {
  if (width === 190) return joinRows(Array.from({ length: rows }, (_, i) => shaped190(i)))
  return Array.from({ length: rows }, (_, i) => spellRow(width, 1000 + i, `Spell ${String(i)}`)).join('\r\n')
}

function spellsVerdict(text: string): GameFileReport {
  return spellsUsHealth({ layout: caretLayout(text), semantics: spellsUsSemantics(text), version: '1-2' }, KNOWN_ROW_LENGTHS, 0)
}

test('spells_us: the 190-field file of 2026-11-24 is ok, and every row is read', () => {
  const r = spellsVerdict(spellFile(190, 20))
  assert.equal(r.status, 'ok')
  assert.equal(r.signature, 'fields-190')
  assert.deepEqual(
    { rows: r.facts.rows, rowsRead: r.facts.rowsRead, rowsSkipped: r.facts.rowsSkipped, fields: r.facts.fields },
    { rows: 20, rowsRead: 20, rowsSkipped: 0, fields: 190 }
  )
  assert.deepEqual(r.histogram, { '190': 20 })
})

test('spells_us: a 200-field file is unrecognised and names the width it saw', () => {
  const r = spellsVerdict(spellFile(200, 20))
  assert.equal(r.status, 'unrecognised')
  assert.equal(r.signature, 'fields-200')
  assert.equal(r.facts.rowsSkipped, 20)
})

test('spells_us: an empty file is pending (a patch mid-copy), not unrecognised and not missing', () => {
  const r = spellsVerdict('')
  assert.equal(r.status, 'pending')
  assert.equal(r.signature, 'empty')
})

test('spells_us: a few odd rows in a file that reads is the file, not a new layout', () => {
  const text = `${spellFile(190, 20)}\n${spellRow(17)}\n${spellRow(17)}`
  const r = spellsVerdict(text)
  assert.equal(r.status, 'ok')
  assert.equal(r.facts.rowsSkipped, 2)
})

test('caretLayout counts carets, ignores a CR and an empty line', () => {
  assert.deepEqual(caretLayout('a^b^c\r\n\r\nd^e\n'), { rows: 2, histogram: { '3': 1, '2': 1 } })
})

function dbstrFile(fields: number, rows: number): string {
  return Array.from({ length: rows }, (_, i) => {
    const f = [String(i + 1), i % 4 === 0 ? '5' : '1', `Word ${String(i)}`, '0', ''].slice(0, fields)
    while (f.length < fields) f.push('x')
    return f.join('^')
  }).join('\r\n')
}

test('dbstr_us: the real shape is ok; a reshaped one and an empty one are not', () => {
  const good = dbstrHealth(dbstrFile(5, 40), 'v')
  assert.equal(good.status, 'ok')
  assert.equal(good.facts.spellCategories, 10)
  const reshaped = dbstrHealth(Array.from({ length: 40 }, (_, i) => `Word ${String(i)}|${String(i)}`).join('\n'), 'v')
  assert.equal(reshaped.status, 'unrecognised')
  assert.equal(reshaped.signature, 'fields-1')
  assert.equal(dbstrHealth('', 'v').status, 'pending')
  const noCategories = dbstrHealth('1^1^Strength^0^\n2^1^Stamina^0^', 'v')
  assert.equal(noCategories.signature, 'no-spell-categories')
})

test('maps, skin, models, GlobalLoad, eqclient.ini: missing is never unrecognised', () => {
  assert.equal(mapsHealth(null, '').status, 'missing')
  assert.equal(mapsHealth({ files: 3, records: 900, skipped: 2 }, 'v').status, 'ok')
  assert.equal(mapsHealth({ files: 3, records: 2, skipped: 900 }, 'v').status, 'unrecognised')
  assert.equal(uiSkinHealth(null, '').status, 'missing')
  assert.equal(uiSkinHealth(0, 'v').status, 'unrecognised')
  assert.equal(uiSkinHealth(1486, 'v').status, 'ok')
  const pfs = (magic: string, dir: number, size: number) => {
    const head = new Uint8Array(8)
    new DataView(head.buffer).setUint32(0, dir, true)
    for (let i = 0; i < 4; i++) head[4 + i] = magic.charCodeAt(i)
    return { head, size }
  }
  assert.equal(modelsHealth({ a: null }, '').status, 'missing')
  assert.equal(modelsHealth({ a: pfs('PFS ', 100, 1000), b: null }, 'v').status, 'ok')
  assert.equal(modelsHealth({ a: pfs('PFS2', 100, 1000) }, 'v').signature, 'magic')
  assert.equal(modelsHealth({ a: pfs('PFS ', 5000, 1000) }, 'v').status, 'pending', 'a directory past EOF is a half-written archive')
  assert.equal(globalLoadHealth(null, false, '').status, 'missing')
  assert.equal(globalLoadHealth('x', false, 'v').signature, 'no-anchor')
  assert.equal(eqclientIniHealth(null, false, '').status, 'missing')
  assert.equal(eqclientIniHealth('[Defaults]', false, 'v').status, 'missing')
  assert.equal(eqclientIniHealth('Fullscreen 1', false, 'v').status, 'unrecognised')
})

const BROKEN: GameFileReport = {
  id: 'spellsUs',
  status: 'unrecognised',
  signature: 'fields-200',
  facts: { rows: 74024, rowsRead: 0, rowsSkipped: 74024, fields: 200 },
  histogram: { '200': 74024 },
  version: '40752305-1794869464000'
}

test('the notice names the reader in plain copy, with no em dash', () => {
  const n = gameFileNotice([BROKEN], [])
  assert.ok(n)
  assert.equal(
    n.sentence,
    "The game's last patch changed spells_us.txt; mob resist estimates and client spell figures are paused until EQ Zera updates."
  )
  assert.equal(n.more, 0)
  assert.deepEqual(n.dismissKeys, [dismissKey(BROKEN)])
  for (const id of ['spellsUs', 'dbstrUs', 'maps', 'uiSkin', 'models', 'globalLoad', 'eqclientIni'] as const) {
    assert.doesNotMatch(noticeSentence(id), /[–—]/)
  }
})

test('the notice: ok and missing say nothing; a dismissal holds until the file version changes', () => {
  const ok: GameFileReport = { ...BROKEN, status: 'ok', signature: 'fields-190' }
  const missing: GameFileReport = { ...BROKEN, id: 'dbstrUs', status: 'missing', signature: 'none' }
  assert.equal(gameFileNotice([ok, missing], []), null)
  assert.equal(gameFileNotice([BROKEN], [dismissKey(BROKEN)]), null)
  const nextPatch = { ...BROKEN, version: '40800000-1795000000000' }
  assert.ok(gameFileNotice([nextPatch], [dismissKey(BROKEN)]))
})

test('the notice: several broken readers are one line, ordered, and one close dismisses all', () => {
  const maps: GameFileReport = { ...BROKEN, id: 'maps', signature: 'records' }
  const ini: GameFileReport = { ...BROKEN, id: 'eqclientIni', signature: 'no-mode-keys' }
  const n = gameFileNotice([maps, BROKEN, ini], [])
  assert.ok(n)
  assert.equal(n.id, 'spellsUs')
  assert.equal(n.more, 1, 'eqclient.ini is diagnostic only and never noticed')
  assert.equal(n.dismissKeys.length, 2)
  assert.equal(gameFileNotice([maps, BROKEN], n.dismissKeys), null)
  assert.equal(gameFileNotice([maps], [], (id) => id !== 'maps'), null, 'the noticeable gate')
})

test('the report: once per layout, and its message survives redaction with the signature intact', () => {
  assert.equal(shouldReport(BROKEN, [], () => true), true)
  assert.equal(shouldReport(BROKEN, [reportKey(BROKEN)], () => true), false)
  assert.equal(shouldReport({ ...BROKEN, status: 'missing' }, [], () => true), false)
  assert.equal(shouldReport({ ...BROKEN, status: 'error' }, [], () => true), false)
  assert.equal(reportErrorName('spellsUs'), 'GameFileSpellsUs')
  const msg = reportMessage(BROKEN)
  const redacted = redactMessage(msg)
  assert.match(redacted, /spells_us\.txt layout fields-200/)
  assert.match(redacted, /fields=200/)
  assert.match(redacted, /rows=74k rowsRead=0% rowsSkipped=100%/)
  assert.doesNotMatch(redacted, /<path>|<str>/, 'nothing in the message looks like a path or a quote')
})

test('probeGameFiles: an empty root is every reader missing; a staged root reads each file', async () => {
  const none = await probeGameFiles('', { spellsUs: () => Promise.reject(new Error('not asked')) })
  assert.ok(none.every((r) => r.status === 'missing'))
  const root = mkdtempSync(join(tmpdir(), 'eqz-gamefiles-'))
  try {
    writeFileSync(join(root, 'dbstr_us.txt'), '1^5^Taps^0^\n2^5^Health^0^\n')
    mkdirSync(join(root, 'maps'))
    writeFileSync(join(root, 'maps', 'qeynos.txt'), 'P 1, 2, 3, 0, 0, 0, 2, Gate\nL 0, 0, 0, 1, 1, 1, 0, 0, 0\n')
    writeFileSync(join(root, 'maps', 'qeynos_1.txt'), 'garbage line\nmore garbage\nand more\n')
    mkdirSync(join(root, 'Resources'))
    writeFileSync(join(root, 'Resources', 'GlobalLoad.txt'), '1,0,TFFT,foo,Loading\r\n')
    writeFileSync(join(root, 'eqclient.ini'), '[Defaults]\r\nFullscreen=1\r\n')
    const spells: GameFileReport = { ...BROKEN }
    const got = await probeGameFiles(root, { spellsUs: () => Promise.resolve(spells) })
    const by = Object.fromEntries(got.map((r) => [r.id, r]))
    assert.equal(by.spellsUs.status, 'unrecognised')
    assert.equal(by.dbstrUs.status, 'ok')
    assert.equal(by.maps.status, 'unrecognised', 'three dropped lines outweigh two kept records')
    assert.equal(by.uiSkin.status, 'missing')
    assert.equal(by.models.status, 'missing')
    assert.equal(by.globalLoad.signature, 'no-anchor')
    assert.equal(by.eqclientIni.status, 'ok')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('spread samples evenly and never more than asked', () => {
  assert.deepEqual(spread(['a', 'b'], 12), ['a', 'b'])
  const s = spread(Array.from({ length: 100 }, (_, i) => String(i)), 4)
  assert.deepEqual(s, ['0', '25', '50', '75'])
})
