/**
 * Headless Electron integration test for the EQ ZERA IN-GAME UI SKIN card (docs/plans/eql-ui-skin.md).
 *
 * The staged EQ install gets SYNTHETIC `uifiles/default` and `uifiles/default_modern`
 * (tests/uiSkinSynthetic.mts; nothing of
 * Daybreak's is committed), then the spec drives the card the way a player would and checks the
 * DISK, not only the DOM:
 *   1. the card renders the owner's notice verbatim, and says Not installed;
 *   2. the FIRST Build asks first, in page, with the same notice; accepting builds the skin into
 *      <install>/uifiles/EQZera, the card says Installed, and the acceptance is remembered;
 *   3. the /loadskin command is shown;
 *   4. Remove asks first, then deletes uifiles/EQZera and only that.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts ui-skin`
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle, settleGone } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'
import { EXPECTED_OUTPUTS, writeSyntheticSkins } from '../uiSkinSynthetic.mjs'
import { UI_SKIN_DISCLAIMER } from '../../src/shared/uiSkinDisclaimer'
import { UI_SKIN_COMMAND } from '../../src/shared/uiSkin'

const CARD = '[data-testid="pref-ui-skin"]'
const STATE = '[data-testid="ui-skin-state"]'

async function dismissFirstRunNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  await page.waitForSelector(notice, { timeout: 30_000 }).catch(() => undefined)
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  await settleGone(page, notice, { timeoutMs: 8_000 })
}

const text = (page: Page, sel: string): Promise<string> =>
  page.$eval(sel, (el) => el.textContent ?? '').catch(() => '')

async function stateIs(page: Page, prefix: string): Promise<string> {
  return settle(() => text(page, STATE), (t) => t.startsWith(prefix), { timeoutMs: 30_000 })
}

async function stepOpen(page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.click('[data-testid="prefs-rail-ingame-ui"]', { timeout: 30_000 })
  await page.waitForSelector(CARD, { timeout: 20_000 })
  const notice = await text(page, '[data-testid="ui-skin-disclaimer"]')
  check('the card shows the owner\'s notice verbatim', notice.trim() === UI_SKIN_DISCLAIMER, notice.slice(0, 80))
  const state = await stateIs(page, 'Not installed.')
  check('a fresh install says Not installed', state.startsWith('Not installed.'), state)
}

async function stepBuild(page: Page, skinDir: string): Promise<void> {
  await page.click('[data-testid="ui-skin-build"]')
  await page.waitForSelector('[data-testid="ui-skin-accept"]', { timeout: 10_000 })
  const confirm = await text(page, '[data-testid="ui-skin-accept"]')
  check('the first Build asks first, in page, with the notice', confirm.includes(UI_SKIN_DISCLAIMER), confirm.slice(0, 80))
  check('nothing is written before the answer', !existsSync(skinDir))
  await page.click('[data-testid="ui-skin-accept-yes"]')
  const state = await stateIs(page, 'Installed and up to date.')
  check('accepting builds the skin and the card says so', state.startsWith('Installed and up to date.'), state)
  const files = existsSync(skinDir) ? readdirSync(skinDir).sort() : []
  check(
    'uifiles/EQZera holds the drawn chrome, the retuned window, the inherited modern files and the manifest, nothing else',
    files.join(',') === [...EXPECTED_OUTPUTS, 'eqzera-skin.json'].sort().join(','),
    files.join(', ')
  )
  const accepted = await page.evaluate(() =>
    (window as unknown as { eq: { getUiSkin: () => Promise<{ accepted: boolean }> } }).eq.getUiSkin().then((v) => v.accepted)
  )
  check('the acceptance is remembered in the store', accepted)
  const cmd = await text(page, '[data-testid="ui-skin-command"]')
  check('the card names the /loadskin command', cmd === UI_SKIN_COMMAND, cmd)
}

async function stepRemove(page: Page, skinDir: string, uifiles: string): Promise<void> {
  await page.click('[data-testid="ui-skin-remove"]')
  await page.waitForSelector('[data-testid="ui-skin-remove-confirm"]', { timeout: 10_000 })
  check('Remove asks first', existsSync(skinDir))
  await page.click('[data-testid="ui-skin-remove-confirm-yes"]')
  const state = await stateIs(page, 'Not installed.')
  check('removing deletes uifiles/EQZera', !existsSync(skinDir) && state.startsWith('Not installed.'), state)
  check('…and only that', readdirSync(uifiles).sort().join(',') === 'default,default_modern', readdirSync(uifiles).join(','))
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-telemetry.log')
  const uifiles = join(log.installDir, 'uifiles')
  writeSyntheticSkins(uifiles)
  const skinDir = join(uifiles, 'EQZera')
  const app = await launchOnFixture(log, { waitForEngine: false })
  const consoleErrors: string[] = []
  try {
    const page = await mainWindow(app.app)
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await dismissFirstRunNotice(page)
    await stepOpen(page)
    await stepBuild(page, skinDir)
    await stepRemove(page, skinDir, uifiles)
    if (failures.length) await dumpArtifacts(page, 'ui-skin-FAIL')
  } finally {
    await app.close()
    await log.dispose()
  }
  check('no renderer page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
