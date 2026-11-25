/**
 * Headless Electron integration test for the GAME-FILE HEALTH notice (src/main/gameFileHealth,
 * shared/gameFileHealth.ts).
 *
 * The incident it pins: a client patch widened `spells_us.txt` to a row width no build had
 * measured, the resist table came out empty and nothing on screen said so. The staged install gets
 * a SYNTHETIC `spells_us.txt` 200 fields wide (nothing of Daybreak's is committed) beside a
 * well-formed synthetic `dbstr_us.txt`, and the spec checks what a player and the developer see:
 *   1. the notice names the file and the feature that is paused, in plain copy;
 *   2. the verdicts: spells_us unrecognised at `fields-200`, dbstr_us ok, a missing reader quiet;
 *   3. errors.log carries ONE `GameFileSpellsUs` report naming the layout, and no install path;
 *   4. closing the notice dismisses it, and a SECOND launch on the same userData and the same file
 *      shows nothing and files nothing new (dismissed per file version, reported once per layout).
 *
 * Run: `node --import tsx tests/e2e/run-all.mts game-file-health`
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { ARTIFACTS, buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle, settleGone, settleStable } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { errorLogText } from './engineSteps.mjs'
import type { GameFileHealthView } from '../../src/shared/gameFileHealth'

const NOTICE = '[data-testid="gamefile-notice"]'
const NOTICE_TEXT = '[data-testid="gamefile-notice-text"]'
const SENTENCE =
  "The game's last patch changed spells_us.txt; mob resist estimates and client spell figures are paused until EQ Zera updates."

/** Twenty spell rows at a width no build has measured. Synthetic: ids and names are invented. */
function writeUnknownSpells(installDir: string): void {
  const rows = Array.from({ length: 20 }, (_, i) => {
    const f = new Array<string>(200).fill('0')
    f[0] = String(90000 + i)
    f[1] = `Synthetic Spell ${String(i)}`
    return f.join('^')
  })
  writeFileSync(join(installDir, 'spells_us.txt'), `${rows.join('\r\n')}\r\n`, 'latin1')
  writeFileSync(join(installDir, 'dbstr_us.txt'), '1^5^Taps^0^\r\n2^5^Health^0^\r\n3^1^Strength^0^\r\n', 'latin1')
}

function health(page: Page): Promise<GameFileHealthView> {
  return page.evaluate(() =>
    (window as unknown as { eq: { getGameFileHealth: () => Promise<GameFileHealthView> } }).eq.getGameFileHealth()
  )
}

async function dismissFirstRunNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  await page.waitForSelector(notice, { timeout: 30_000 }).catch(() => undefined)
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  await settleGone(page, notice, { timeoutMs: 8_000 })
}

/**
 * The notice as drawn, for the report. `capturePage` rather than `page.screenshot`: the e2e window
 * is laid out but never mapped, so Playwright waits for a composited frame that never comes, while
 * capturePage borrows one (combat-share.e2e.mts). Evidence, never a check: a failure is a note.
 */
async function saveShot(electronApp: ElectronApplication): Promise<void> {
  try {
    const b64 = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('overlay'))
      if (!w) return ''
      // The first capture of a never-mapped window hands back the LAST frame it painted, which can
      // predate the notice; each capture forces a fresh one, so the third is the current screen.
      for (let i = 0; i < 2; i++) {
        await w.webContents.capturePage()
        await new Promise((r) => setTimeout(r, 300))
      }
      return (await w.webContents.capturePage()).toPNG().toString('base64')
    })
    mkdirSync(ARTIFACTS, { recursive: true })
    const shot = join(ARTIFACTS, 'game-file-notice.png')
    writeFileSync(shot, Buffer.from(b64, 'base64'))
    console.log(`artifact: ${shot}`)
  } catch (err) {
    console.log(`artifact: screenshot unavailable - ${String(err)}`)
  }
}

async function firstLaunch(log: FixtureLog, userData: string): Promise<void> {
  const app = await launchOnFixture(log, { waitForEngine: false, userData })
  try {
    const page = await mainWindow(app.app)
    await dismissFirstRunNotice(page)
    await page.waitForSelector(NOTICE_TEXT, { timeout: 60_000 }).catch(() => undefined)
    const text = await page.$eval(NOTICE_TEXT, (el) => el.textContent ?? '').catch(() => '')
    check('the notice names spells_us.txt and the paused feature, in plain copy', text === SENTENCE, text)
    await saveShot(app.app)
    const view = await health(page)
    const by = Object.fromEntries(view.reports.map((r) => [r.id, r]))
    check('spells_us is unrecognised at the width it saw', by.spellsUs?.status === 'unrecognised' && by.spellsUs.signature === 'fields-200', JSON.stringify(by.spellsUs))
    check('dbstr_us is ok', by.dbstrUs?.status === 'ok', JSON.stringify(by.dbstrUs))
    check('a reader with no file is missing, not an alarm', by.models?.status === 'missing', JSON.stringify(by.models))
    const errors = await settle(() => Promise.resolve(errorLogText(app.userData)), (t) => t.includes('GameFileSpellsUs'), { timeoutMs: 15_000 })
    check('errors.log carries the GameFileSpellsUs report with its layout', errors.includes('GameFileSpellsUs') && errors.includes('fields-200'))
    const ours = errors.split('\n').filter((l) => l.includes('GameFile'))
    check('…and no install path', ours.length > 0 && !ours.some((l) => l.includes(log.installDir)), ours.join(' | ').slice(0, 300))
    await page.click(`${NOTICE} button[aria-label="Close"]`)
    await settleGone(page, NOTICE, { timeoutMs: 8_000 })
    check('closing the notice dismisses it', (await health(page)).notice === null)
    if (failures.length) await dumpArtifacts(page, 'game-file-health-FAIL')
  } finally {
    await app.close()
  }
}

async function secondLaunch(log: FixtureLog, userData: string): Promise<void> {
  const app = await launchOnFixture(log, { waitForEngine: false, userData })
  try {
    const page = await mainWindow(app.app)
    const checked = await settle(() => health(page), (v) => v.checked, { timeoutMs: 60_000 })
    check('the second launch re-checks and still sees the layout', checked.reports.some((r) => r.status === 'unrecognised'))
    // The check has finished and pushed, so a notice would already be drawn; ten equal reads in a
    // row is the absence asserted (settle.mts: an absence is a stable reading, never a sleep).
    const absent = await settleStable(() => countOf(page, NOTICE), { stable: 10 })
    check('the dismissed notice stays dismissed for the same file', absent === 0, `${String(absent)} notices`)
    const reports = errorLogText(app.userData)
      .split('\n')
      .filter((l) => l.includes('GameFileSpellsUs')).length
    check('the layout was reported once, not once per launch', reports === 1, `${String(reports)} reports`)
    if (failures.length) await dumpArtifacts(page, 'game-file-health-relaunch-FAIL')
  } finally {
    await app.close()
  }
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-telemetry.log')
  writeUnknownSpells(log.installDir)
  const userData = makeUserData()
  try {
    await firstLaunch(log, userData)
    await secondLaunch(log, userData)
  } finally {
    await log.dispose()
    await removeUserData(userData)
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
