/**
 * Headless Electron integration test for LUCLIN CHARACTER MODELS and the PLAY button.
 *
 * The EQ install is a STAGED TEMP FOLDER (logFixture's `EQ_INSTALL_DIR`): a CRLF
 * `Resources\GlobalLoad.txt` and empty archive stubs are written beside the fixture log, so every
 * write lands there and never in the real game folder. It holds NO `eqgame.exe` and NO
 * `LaunchPad.exe`, so both Play paths end at their "not found" refusal and nothing is ever started.
 * The desktop-shortcut button is not pressed (it would write to the real desktop). Whether the
 * game is running is the spec's to say (`EQ_LUCLIN_E2E_RUNNING`, read by main only under EQ_E2E).
 *
 * CLAIMS:
 *   1. The Overview has the Play bar; Play with the feature OFF goes to the launcher (missing here).
 *   2. The Preferences card opens OFF, reads "Not applied", and shows the shared risk notice.
 *   3. The first Apply waits behind the in-page notice; Accept is stored and the file is patched
 *      with exactly the guide's lines for the archives present.
 *   4. Opting out of a race rewrites the block; a launcher revert is noticed on reopen and offered
 *      as Re-apply; keep-applied re-applies by itself; Revert restores identical bytes.
 *   5. With the game running, apply refuses and the file is untouched.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts luclin-models`
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle, settleGone } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'
import { openPrefs, openSection, setSwitch } from './prefsFirstPaintSteps.mjs'
import { GAME_FILE_DISCLAIMER } from '../../src/shared/gameModsDisclaimer'

const CARD = '[data-testid="pref-luclin"]'
const ANCHOR = '2,0,TFFFE,it101084,Loading Furniture Files'
const ORIGINAL = ['1,1,TFFTC,lsk_chr,Loading Luclin Skeletons', ANCHOR, '3,0,TFFFC,rap_chr,Loading Raptors']
  .map((l) => `${l}\r\n`)
  .join('')
/** Human (both _chr2), Ogre (male _chr only), and the four armour archives. */
const ARCHIVES = [
  'globalhum_chr2.s3d',
  'globalhum_chr.s3d',
  'globalhuf_chr2.s3d',
  'globalhuf_chr.s3d',
  'globalogm_chr.s3d',
  'lgequip_amr2.s3d',
  'lgequip_amr.s3d',
  'lgequip2.s3d',
  'lgequip.s3d'
]
const ARMOUR = ['LGEquip_amr2', 'LGEquip_amr', 'LGEquip2', 'LGEquip'].map((n) => `1,1,TFFF,${n},Loading Armor Files`)
const HUMAN = ['HUM_chr2', 'HUM_chr', 'HUF_chr2', 'HUF_chr'].map((c) => `1,1,TFFT,global${c},Loading Human`)
const OGRE = ['1,1,TFFT,globalOGM_chr,Loading Ogre']
const patched = (lines: string[]): string =>
  ORIGINAL.replace(`${ANCHOR}\r\n`, `${ANCHOR}\r\n${lines.map((l) => `${l}\r\n`).join('')}`)

type Eq = Record<string, (...a: unknown[]) => Promise<unknown>>
function eqCall<T>(page: Page, name: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    ([n, a]) => (window as unknown as { eq: Eq }).eq[n as string](a) as Promise<unknown>,
    [name, arg] as const
  ) as Promise<T>
}

function textOf(page: Page, testid: string): Promise<string> {
  return page.$eval(`[data-testid="${testid}"]`, (el) => el.textContent ?? '').catch(() => '')
}

async function dismissFirstRunNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  await page.waitForSelector(notice, { timeout: 30_000 }).catch(() => undefined)
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  await settleGone(page, notice, { timeoutMs: 8_000 })
}

async function stepOverview(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="overview-play"]', { timeout: 60_000 })
  check('the Overview has a Play button', (await textOf(page, 'overview-play')).includes('Play EverQuest Legends'))
  check('and a Patch with the launcher action', (await countOf(page, '[data-testid="overview-patch"]')) === 1)
  await page.click('[data-testid="overview-play"]')
  const msg = await settle(() => textOf(page, 'overview-play-message'), (t) => t.length > 0, { timeoutMs: 10_000 })
  check('with Luclin models off, Play goes to the launcher (not in this staged install)', msg.includes('LaunchPad.exe'), msg)
}

async function stepCardOff(page: Page, gl: string): Promise<void> {
  await openPrefs(page)
  await openSection(page, 'game', CARD)
  check('the card opens OFF', !(await page.$eval('[data-testid="pref-luclin-enabled"] input', (el) => (el as HTMLInputElement).checked)))
  const status = await settle(() => textOf(page, 'pref-luclin-status'), (t) => t.startsWith('Not applied'), { timeoutMs: 10_000 })
  check('and reads Not applied', status.startsWith('Not applied'), status)
  check('the card shows the shared risk notice verbatim', (await textOf(page, 'pref-luclin-disclaimer')) === GAME_FILE_DISCLAIMER)
  check('nothing was written by looking', readFileSync(gl, 'latin1') === ORIGINAL)
}

async function stepFirstApply(page: Page, gl: string): Promise<void> {
  check('the switch takes ON', await setSwitch(page, 'pref-luclin-enabled', true))
  await page.waitForSelector('[data-testid="pref-luclin-race-ogre"]', { timeout: 10_000 })
  const erudite = await page.$eval('[data-testid="pref-luclin-race-erudite"] input', (el) => (el as HTMLInputElement).disabled)
  check('a race with no archives in this install is disabled', erudite)
  await page.click('[data-testid="pref-luclin-apply"]')
  await page.waitForSelector('[data-testid="luclin-risk-dialog"]', { timeout: 10_000 })
  check('the first Apply waits behind the in-page notice', readFileSync(gl, 'latin1') === ORIGINAL)
  const dialog = await textOf(page, 'luclin-risk-dialog')
  check('which carries the same sentence', dialog.includes(GAME_FILE_DISCLAIMER))
  await page.click('[data-testid="luclin-risk-accept"]')
  const want = patched([...HUMAN, ...OGRE, ...ARMOUR])
  const after = await settle(() => Promise.resolve(readFileSync(gl, 'latin1')), (t) => t === want, { timeoutMs: 10_000 })
  check('Accept applies: exactly the guide lines for the archives present, CRLF', after === want, JSON.stringify(after))
  const prefs = await eqCall<{ riskAccepted: boolean; applied: boolean }>(page, 'getLuclinPrefs')
  check('and the acceptance is stored', prefs.riskAccepted && prefs.applied, JSON.stringify(prefs))
  const status = await settle(() => textOf(page, 'pref-luclin-status'), (t) => t.startsWith('Applied'), { timeoutMs: 10_000 })
  check('the status says applied', status.startsWith('Applied for 2 of 2 races'), status)
}

async function stepOptOutAndRevert(page: Page, gl: string): Promise<void> {
  await page.click('[data-testid="pref-luclin-race-ogre"] input')
  await settle(() => textOf(page, 'pref-luclin-status'), (t) => t.startsWith('Partly'), { timeoutMs: 10_000 })
  await page.click('[data-testid="pref-luclin-apply"]')
  const noOgre = patched([...HUMAN, ...ARMOUR])
  check('opting out of Ogre rewrites the block', (await settle(() => Promise.resolve(readFileSync(gl, 'latin1')), (t) => t === noOgre, { timeoutMs: 10_000 })) === noOgre)

  // The launcher puts the file back; reopening the card notices.
  writeFileSync(gl, ORIGINAL, 'latin1')
  await openSection(page, 'textsize', '[data-testid="prefs-rail-game"]')
  await openSection(page, 'game', CARD)
  const reverted = await settle(() => textOf(page, 'pref-luclin-status'), (t) => t.includes('put the classic models back'), { timeoutMs: 10_000 })
  check('a launcher revert is noticed when the card opens', reverted.includes('put the classic models back'), reverted)
  check('and offered as Re-apply', (await textOf(page, 'pref-luclin-apply')) === 'Re-apply')
  check('without keep-applied nothing is written', readFileSync(gl, 'latin1') === ORIGINAL)

  check('keep-applied takes ON', await setSwitch(page, 'pref-luclin-keep', true))
  await eqCall(page, 'checkLuclin')
  check('with keep-applied on, the check re-applies by itself', readFileSync(gl, 'latin1') === noOgre)

  await page.click('[data-testid="pref-luclin-revert"]')
  const back = await settle(() => Promise.resolve(readFileSync(gl, 'latin1')), (t) => t === ORIGINAL, { timeoutMs: 10_000 })
  check('Revert restores identical bytes', back === ORIGINAL)
}

async function stepRunning(app: ElectronApplication, page: Page, gl: string): Promise<void> {
  await app.evaluate(() => {
    process.env.EQ_LUCLIN_E2E_RUNNING = '1'
  })
  const r = await eqCall<{ ok: boolean; reason?: string }>(page, 'applyLuclin')
  check('with the game running, apply refuses', !r.ok && r.reason === 'running', JSON.stringify(r))
  check('and the file is untouched', readFileSync(gl, 'latin1') === ORIGINAL)
  const p = await eqCall<{ ok: boolean; reason?: string; message: string }>(page, 'playEverQuest')
  check('and Play says the game is already running', !p.ok && p.message === 'EverQuest is already running.', JSON.stringify(p))
  await app.evaluate(() => {
    delete process.env.EQ_LUCLIN_E2E_RUNNING
  })
  const g = await eqCall<{ ok: boolean; reason?: string }>(page, 'playEverQuest')
  check('Play with Luclin models on and no eqgame.exe refuses rather than starting anything', !g.ok && g.reason === 'game-missing', JSON.stringify(g))
}

async function main(): Promise<void> {
  buildIfStale()
  const consoleErrors: string[] = []
  const userData = makeUserData()
  const log = stageFixture('e2e-telemetry.log')
  mkdirSync(join(log.installDir, 'Resources'), { recursive: true })
  const gl = join(log.installDir, 'Resources', 'GlobalLoad.txt')
  writeFileSync(gl, ORIGINAL, 'latin1')
  for (const a of ARCHIVES) writeFileSync(join(log.installDir, a), '')
  const app = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(app.app)
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await dismissFirstRunNotice(page)
    await stepOverview(page)
    await stepCardOff(page, gl)
    await stepFirstApply(page, gl)
    await stepOptOutAndRevert(page, gl)
    await stepRunning(app.app, page, gl)
    if (failures.length) await dumpArtifacts(page, 'luclin-models-FAIL')
  } finally {
    await app.close()
    await removeUserData(userData)
    await log.dispose()
  }
  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
