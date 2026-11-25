/**
 * THE NOTICE SAYS "PAUSED", SO THE NUMBERS ARE PAUSED (game-file health, third review).
 *
 * A spells_us.txt this build does not recognise must not be read at all: not by the app's resist
 * table (the mob page's Resists card and the con card's chips) and not by the engine's own copy.
 * Two synthetic installs, nothing of Daybreak's committed:
 *   1. a 200-field file (an unmeasured width);
 *   2. a real-SHAPED 190-field file with one column moved (in at 20, out at 61), 1,200 rows so the
 *      field checks run at production strength (tests/spellsUsShape.mts).
 * For each: the notice names spells_us.txt, the verdict is unrecognised, and the mob page's
 * Resists card says "Spell data unavailable" rather than drawing numbers.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts game-file-gating`
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle, waitHydrated } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'
import { joinRows, moveColumns, shaped190 } from '../spellsUsShape.mjs'
import type { GameFileHealthView } from '../../src/shared/gameFileHealth'

const MOB = 'a zol ghoul knight'
const CARD = '[data-testid="resist-card"]'

async function textOf(page: Page, sel: string): Promise<string> {
  const raw = await page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
  return raw.replace(/\s+/g, ' ').trim()
}

function health(page: Page): Promise<GameFileHealthView> {
  return page.evaluate(() =>
    (window as unknown as { eq: { getGameFileHealth: () => Promise<GameFileHealthView> } }).eq.getGameFileHealth()
  )
}

async function openMobCard(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-mobs"]', { timeout: 15_000 })
  await page.fill('[data-testid="mobs-search"]', MOB, { timeout: 15_000 })
  await settle(() => countOf(page, '[data-testid="mobs-zone-roster"]'), (n) => n === 0, { timeoutMs: 10_000 })
  await page.waitForSelector('[data-testid="mobs-result-row"]', { timeout: 20_000 })
  await page.click('[data-testid="mobs-result-row"]', { timeout: 15_000 })
  return page.waitForSelector(CARD, { timeout: 20_000 }).then(
    () => true,
    () => false
  )
}

async function oneInstall(label: string, spells: string): Promise<void> {
  const log = stageFixture('e2e-deep-link.log')
  writeFileSync(join(log.installDir, 'spells_us.txt'), spells, 'latin1')
  const app = await launchOnFixture(log, { waitForEngine: true })
  try {
    const page = await mainWindow(app.app)
    await waitHydrated(page)
    const view = await settle(() => health(page), (v) => v.checked, { timeoutMs: 60_000 })
    const spellsUs = view.reports.find((r) => r.id === 'spellsUs')
    check(`${label}: spells_us.txt is unrecognised`, spellsUs?.status === 'unrecognised', JSON.stringify(spellsUs))
    check(`${label}: the notice names it`, view.notice?.sentence.includes('spells_us.txt') === true, view.notice?.sentence ?? '(none)')
    if (check(`${label}: the mob page opens with a Resists card`, await openMobCard(page))) {
      const text = await settle(() => textOf(page, CARD), (t) => !t.includes('Reading what'), { timeoutMs: 30_000 })
      check(`${label}: the Resists card says the spell data is unavailable, not numbers`, text.includes('Spell data unavailable'), text.slice(0, 160))
      check(`${label}: and draws no axis rows`, (await countOf(page, '[data-testid="resist-rows"]')) === 0)
    }
    if (failures.length) await dumpArtifacts(page, `game-file-gating-${label}-FAIL`)
  } finally {
    await app.close()
    await log.dispose()
  }
}

async function main(): Promise<void> {
  buildIfStale()
  const wide = Array.from({ length: 20 }, (_, i) => [...shaped190(i), ...new Array<string>(10).fill('0')])
  await oneInstall('200-field', `${joinRows(wide)}\r\n`)
  const moved = moveColumns(Array.from({ length: 1200 }, (_, i) => shaped190(i)), 20, 61)
  await oneInstall('moved-190', `${joinRows(moved)}\r\n`)
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
