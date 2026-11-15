// luclinModels.test.mts - "Luclin character models": the GlobalLoad.txt edit.
//
// Every write here goes to a TEMP folder; nothing touches the real game install.
//
// CLAIMS:
//   1. The edit is the guide's, line for line, filtered to archives the install has.
//   2. Status: applied / partial / not applied / anchor missing / file missing.
//   3. Every byte that is not ours survives: CRLF, LF, a missing final newline, a BOM.
//   4. Revert round-trips to identical bytes; apply is idempotent and never stacks.
//   5. Only the block directly after the anchor is ours.
//   6. Disk: backups (beside the file once, in userData every time), a hand-patched file
//      reads as applied, revert strips the current file.
//   7. Prefs normalize; the risk notice is shared and the card renders it; main refuses before
//      writing while the game runs and launches with explicit args, no shell.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ANCHOR_PREFIX,
  CATALOG,
  availableRaces,
  desiredLines,
  inspectLuclin,
  patchLuclin,
  splitLines,
  stripLuclin
} from '../src/main/luclin/globalLoad.ts'
import {
  BESIDE_BACKUP,
  USERDATA_BACKUP,
  USERDATA_DIR,
  applyOnDisk,
  diskStatus,
  globalLoadPath,
  revertOnDisk
} from '../src/main/luclin/files.ts'
import { DEFAULT_LUCLIN_PREFS, LUCLIN_RACE_IDS, mergeLuclinPrefs } from '../src/shared/luclinModels.ts'
import { GAME_FILE_DISCLAIMER, GAME_FILE_DISCLAIMER_TITLE } from '../src/shared/gameModsDisclaimer.ts'

const ANCHOR = `${ANCHOR_PREFIX}Loading Furniture Files`
const BEFORE = ['1,1,TFFTC,lsk_chr,Loading Luclin Skeletons', '2,0,TFFFE,missle.eqg,Loading Bolt Spells']
const AFTER = ['3,0,TFFFC,rap_chr,Loading Raptors', '4,0,TFFFC,Global3_chr,Loading Global Items and Equipment']
const crlf = (lines: string[]): string => lines.map((l) => `${l}\r\n`).join('')
const ORIGINAL = crlf([...BEFORE, ANCHOR, ...AFTER])

/** The archives the owner's EQ Legends install actually has (2026-11-15 listing). */
const OWNER_ARCHIVES = new Set(
  (
    'globalbaf_chr globalbaf_chr2 globalbam_chr globalbam_chr2 globaldaf_chr globaldam_chr globaldwf_chr ' +
    'globaldwf_chr2 globaldwm_chr globalelf_chr globalelf_chr2 globalelm_chr globalelm_chr2 globalerf_chr ' +
    'globalerm_chr globalgnf_chr globalgnm_chr globalgnm_chr2 globalhaf_chr globalham_chr globalhif_chr ' +
    'globalhim_chr globalhof_chr globalhof_chr2 globalhom_chr globalhom_chr2 globalhuf_chr globalhuf_chr2 ' +
    'globalhum_chr globalhum_chr2 globalikf_chr globalikf_chr2 globalikm_chr globalikm_chr2 globalogf_chr ' +
    'globalogf_chr2 globalogm_chr globalogm_chr2 globaltrf_chr globaltrf_chr2 globaltrm_chr globaltrm_chr2 ' +
    'lgequip lgequip2 lgequip_amr lgequip_amr2'
  )
    .split(' ')
    .map((n) => `${n}.s3d`)
)
const ownerHas = (f: string): boolean => OWNER_ARCHIVES.has(f)
const allHave = (): boolean => true

test('1. the guide lines, in order, only for archives that exist', () => {
  const all = desiredLines(LUCLIN_RACE_IDS, allHave)
  assert.equal(all.length, 13 * 4 + 4)
  assert.deepEqual(all.slice(0, 4), [
    '1,1,TFFT,globalHUM_chr2,Loading Human',
    '1,1,TFFT,globalHUM_chr,Loading Human',
    '1,1,TFFT,globalHUF_chr2,Loading Human',
    '1,1,TFFT,globalHUF_chr,Loading Human'
  ])
  assert.deepEqual(all.slice(-4), [
    '1,1,TFFF,LGEquip_amr2,Loading Armor Files',
    '1,1,TFFF,LGEquip_amr,Loading Armor Files',
    '1,1,TFFF,LGEquip2,Loading Armor Files',
    '1,1,TFFF,LGEquip,Loading Armor Files'
  ])
  // The owner's install: exactly the 46 lines he added by hand today.
  const owner = desiredLines(LUCLIN_RACE_IDS, ownerHas)
  assert.equal(owner.length, 46)
  assert.ok(!owner.includes('1,1,TFFT,globalERM_chr2,Loading Erudite'), 'a missing _chr2 is never listed')
  assert.ok(owner.includes('1,1,TFFT,globalERM_chr,Loading Erudite'))
  assert.equal(availableRaces(ownerHas).length, 13)
  // Opt-out: classic Ogres.
  const noOgre = desiredLines(LUCLIN_RACE_IDS.filter((r) => r !== 'ogre'), ownerHas)
  assert.equal(noOgre.length, 42)
  assert.ok(!noOgre.some((l) => l.includes('Ogre')))
  // No race, no lines (armour alone changes nothing); no armour archives, no armour lines.
  assert.deepEqual(desiredLines([], allHave), [])
  assert.equal(desiredLines(['human'], (f) => !f.startsWith('lgequip')).length, 4)
  assert.equal(new Set(CATALOG.map((c) => c.line)).size, CATALOG.length)
})

test('2. status: not applied, applied, partial, anchor missing', () => {
  const want = desiredLines(LUCLIN_RACE_IDS, ownerHas)
  assert.deepEqual(inspectLuclin(ORIGINAL, want), { state: 'not-applied', appliedRaces: [] })
  const patched = patchLuclin(ORIGINAL, want)
  assert.ok(patched)
  const applied = inspectLuclin(patched, want)
  assert.equal(applied.state, 'applied')
  assert.equal(applied.appliedRaces.length, 13)
  // The same file against a different choice is partial, and says which races are in.
  const noOgre = desiredLines(LUCLIN_RACE_IDS.filter((r) => r !== 'ogre'), ownerHas)
  assert.equal(inspectLuclin(patched, noOgre).state, 'partial')
  const half = patchLuclin(ORIGINAL, desiredLines(['human', 'gnome'], ownerHas))
  assert.ok(half)
  assert.deepEqual(inspectLuclin(half, want), { state: 'partial', appliedRaces: ['human', 'gnome'] })
  const noAnchor = crlf([...BEFORE, ...AFTER])
  assert.equal(inspectLuclin(noAnchor, want).state, 'anchor-missing')
  assert.equal(patchLuclin(noAnchor, want), null)
})

test('3. the owner hand edit (46 lines after the anchor) reads as applied', () => {
  const want = desiredLines(LUCLIN_RACE_IDS, ownerHas)
  const hand = crlf([...BEFORE, ANCHOR, ...want, ...AFTER])
  assert.equal(inspectLuclin(hand, want).state, 'applied')
  assert.equal(patchLuclin(hand, want), hand, 'applying again changes nothing')
  assert.equal(stripLuclin(hand), ORIGINAL)
})

test('4. bytes that are not ours survive, and revert round-trips exactly', () => {
  const want = desiredLines(LUCLIN_RACE_IDS, ownerHas)
  const shapes = {
    crlf: ORIGINAL,
    lf: [...BEFORE, ANCHOR, ...AFTER].map((l) => `${l}\n`).join(''),
    mixed: `${BEFORE[0]}\n${BEFORE[1]}\r\n${ANCHOR}\r\n${AFTER[0]}\n${AFTER[1]}`,
    bom: String.fromCharCode(0xfeff) + ORIGINAL,
    anchorLastNoNewline: `${crlf(BEFORE)}${ANCHOR}`,
    anchorLastWithNewline: `${crlf(BEFORE)}${ANCHOR}\r\n`
  }
  for (const [name, text] of Object.entries(shapes)) {
    const patched = patchLuclin(text, want)
    assert.ok(patched, name)
    assert.equal(stripLuclin(patched), text, `${name}: revert gives back identical bytes`)
    assert.equal(patchLuclin(patched, want), patched, `${name}: idempotent`)
    assert.equal(inspectLuclin(patched, want).state, 'applied', name)
    // Every original line is still there, verbatim, in order.
    const kept = splitLines(patched).filter((l) => !want.includes(l.content))
    assert.equal(kept.map((l) => l.content).join('|'), splitLines(text).map((l) => l.content).join('|'), name)
  }
  // CRLF file: every inserted line is CRLF.
  const patched = patchLuclin(ORIGINAL, want) ?? ''
  assert.equal(patched.split('\n').length - 1, patched.split('\r\n').length - 1, 'no bare LF introduced')
  // A different race set replaces the block instead of stacking.
  const swapped = patchLuclin(patched, desiredLines(['iksar'], ownerHas)) ?? ''
  assert.equal(splitLines(swapped).length, splitLines(ORIGINAL).length + 4 + 4)
  assert.equal(stripLuclin(swapped), ORIGINAL)
})

test('5. only the block directly after the anchor is ours', () => {
  const stray = '1,1,TFFT,globalHUM_chr,Loading Human'
  const text = crlf([stray, ...BEFORE, ANCHOR, ...AFTER, stray])
  assert.equal(stripLuclin(text), text)
  assert.equal(inspectLuclin(text, [stray]).state, 'not-applied')
  const patched = patchLuclin(text, [stray]) ?? ''
  assert.equal(stripLuclin(patched), text, 'the strays elsewhere are left alone')
})

function stage(text: string | null, archives: Iterable<string> = OWNER_ARCHIVES): { root: string; userData: string } {
  const base = mkdtempSync(join(tmpdir(), 'eqzera-luclin-'))
  const root = join(base, 'eq')
  const userData = join(base, 'userData')
  mkdirSync(join(root, 'Resources'), { recursive: true })
  for (const a of archives) writeFileSync(join(root, a.toUpperCase()), '')
  if (text !== null) writeFileSync(globalLoadPath(root), text, 'latin1')
  return { root, userData }
}

test('6. disk: status, apply with backups, revert, refusals', () => {
  const { root, userData } = stage(ORIGINAL)
  try {
    assert.equal(diskStatus(root, LUCLIN_RACE_IDS).state, 'not-applied')
    const first = applyOnDisk(root, LUCLIN_RACE_IDS, userData)
    assert.deepEqual(first, { ok: true, changed: true })
    const after = readFileSync(globalLoadPath(root), 'latin1')
    assert.equal(after, patchLuclin(ORIGINAL, desiredLines(LUCLIN_RACE_IDS, ownerHas)))
    const status = diskStatus(root, LUCLIN_RACE_IDS)
    assert.equal(status.state, 'applied')
    assert.equal(status.gamePresent, false)
    assert.equal(readFileSync(join(root, 'Resources', BESIDE_BACKUP), 'latin1'), ORIGINAL)
    assert.equal(readFileSync(join(userData, USERDATA_DIR, USERDATA_BACKUP), 'latin1'), ORIGINAL)
    assert.deepEqual(applyOnDisk(root, LUCLIN_RACE_IDS, userData), { ok: true, changed: false })
    assert.deepEqual(revertOnDisk(root), { ok: true, changed: true })
    assert.equal(readFileSync(globalLoadPath(root), 'latin1'), ORIGINAL)
    assert.deepEqual(revertOnDisk(root), { ok: true, changed: false })
    assert.deepEqual(applyOnDisk(root, [], userData), { ok: false, reason: 'no-races' })
  } finally {
    rmSync(join(root, '..'), { recursive: true, force: true })
  }
})

test('6b. disk: a hand-patched file keeps its existing beside-backup; missing file and anchor refuse', () => {
  const want = desiredLines(LUCLIN_RACE_IDS, ownerHas)
  const hand = crlf([...BEFORE, ANCHOR, ...want, ...AFTER])
  const { root, userData } = stage(hand)
  try {
    writeFileSync(join(root, 'Resources', BESIDE_BACKUP), 'the owner backup', 'utf8')
    assert.equal(diskStatus(root, LUCLIN_RACE_IDS).state, 'applied')
    // Opting out of Ogres rewrites the block; the existing beside-backup is never replaced.
    applyOnDisk(root, LUCLIN_RACE_IDS.filter((r) => r !== 'ogre'), userData)
    assert.equal(readFileSync(join(root, 'Resources', BESIDE_BACKUP), 'utf8'), 'the owner backup')
    assert.equal(readFileSync(join(userData, USERDATA_DIR, USERDATA_BACKUP), 'latin1'), ORIGINAL)
    assert.equal(diskStatus(root, LUCLIN_RACE_IDS).state, 'partial')
  } finally {
    rmSync(join(root, '..'), { recursive: true, force: true })
  }
  const missing = stage(null)
  try {
    assert.equal(diskStatus(missing.root, LUCLIN_RACE_IDS).state, 'file-missing')
    assert.deepEqual(applyOnDisk(missing.root, LUCLIN_RACE_IDS, missing.userData), { ok: false, reason: 'file-missing' })
  } finally {
    rmSync(join(missing.root, '..'), { recursive: true, force: true })
  }
  const noAnchor = stage(crlf([...BEFORE, ...AFTER]))
  try {
    assert.deepEqual(applyOnDisk(noAnchor.root, LUCLIN_RACE_IDS, noAnchor.userData), { ok: false, reason: 'anchor-missing' })
    assert.ok(!existsSync(join(noAnchor.root, 'Resources', BESIDE_BACKUP)), 'nothing written when refusing')
  } finally {
    rmSync(join(noAnchor.root, '..'), { recursive: true, force: true })
  }
})

test('7. prefs normalize, off by default, every race on', () => {
  assert.deepEqual(mergeLuclinPrefs(undefined), DEFAULT_LUCLIN_PREFS)
  assert.equal(DEFAULT_LUCLIN_PREFS.enabled, false)
  assert.equal(DEFAULT_LUCLIN_PREFS.riskAccepted, false)
  assert.deepEqual(DEFAULT_LUCLIN_PREFS.races, [...LUCLIN_RACE_IDS])
  const p = mergeLuclinPrefs({ races: ['ogre', 'nope', 'human', 'human', 3], enabled: 'yes' })
  assert.deepEqual(p.races, ['human', 'ogre'])
  assert.equal(p.enabled, false)
  const patched = mergeLuclinPrefs({ keepApplied: true }, { ...DEFAULT_LUCLIN_PREFS, enabled: true })
  assert.equal(patched.enabled, true)
  assert.equal(patched.keepApplied, true)
})

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('7b. the shared notice, rendered by the card and its confirm', () => {
  assert.equal(GAME_FILE_DISCLAIMER_TITLE, 'Use at your own risk')
  assert.equal(
    GAME_FILE_DISCLAIMER,
    'Use at your own risk. This changes a game file (GlobalLoad.txt) in a way Daybreak does not officially support. ' +
      'EQ Zera and its developer are not responsible for any bans, account actions, corrective actions or other consequences that may result.'
  )
  assert.ok(![0x2013, 0x2014].some((c) => GAME_FILE_DISCLAIMER.includes(String.fromCharCode(c))))
  const card = read('src/renderer/src/features/preferences/LuclinModelsSetting.tsx')
  assert.match(card, /data-testid="pref-luclin-disclaimer"[\s\S]{0,40}\{GAME_FILE_DISCLAIMER\}/)
  assert.match(card, /<LuclinRiskDialog state=\{state\} \/>/)
  const dialog = read('src/renderer/src/features/preferences/LuclinRiskDialog.tsx')
  assert.match(dialog, /\{GAME_FILE_DISCLAIMER\}/)
  assert.ok(!dialog.includes('window.confirm('))
  assert.match(read('src/renderer/src/features/overview/PlayBar.tsx'), /<LuclinRiskDialog state=\{state\} \/>/)
})

test('7c. main: running and acceptance checks come before any write; launches take explicit args, no shell', () => {
  const src = read('src/main/luclin/service.ts')
  const change = src.slice(src.indexOf('async function change('))
  assert.ok(change.indexOf("refuse('running'") < change.indexOf('run(before.root)'))
  const apply = src.slice(src.indexOf('export async function applyLuclin'))
  assert.ok(apply.indexOf("refuse('not-accepted'") < apply.indexOf('applyOnDisk'))
  const play = src.slice(src.indexOf('export async function playLuclin'))
  assert.ok(play.indexOf("refuse('running'") < play.indexOf('applyLuclin()'))
  assert.ok(play.indexOf("refuse('not-accepted'") < play.indexOf('launchFromEqRoot'))
  assert.match(src, /launchFromEqRoot\(status\.root, 'game'\)/)
  // The running check is a file-lock probe, never a process listing.
  assert.ok(!/tasklist|wmic|execFile/.test(src))
  const launch = read('src/main/luclin/launch.ts')
  assert.match(launch, /game: \{ exe: GAME_EXE, args: \['patchme'\] \}/)
  assert.match(launch, /launcher: \{ exe: LAUNCHER_EXE, args: \[\] \}/)
  assert.match(launch, /cwd: root,\s+detached: true,\s+stdio: 'ignore',\s+shell: false/)
})
