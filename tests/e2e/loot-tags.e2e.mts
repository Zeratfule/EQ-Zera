/**
 * LOOT TAGS (GitHub #16): a looted item carries EVERY tag it earns, and the Preferences switch
 * "Show Tradeskill tag on loot" (default on) drops only the tradeskill one.
 *
 * Input: `tests/fixtures/e2e-deep-link.log` plus two loot lines this spec appends before launch.
 * Both items answer from the committed item DB (src/main/data/items.json), so no network:
 *   - Asp Poison Sac - a quest uses it AND a recipe consumes it: quest + tradeskill
 *   - Gnome Meat     - QUEST ITEM flag, no quest uses it, one recipe: tradeskill only
 *
 * Run: `node --import tsx tests/e2e/run-all.mts loot-tags`
 */

import type { Page } from 'playwright-core'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle, waitHydrated } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

const GRID = '[data-testid="overview-grid"]'
const LOOT_LIST = '[data-testid="loot-list"]'
const TAG_SWITCH = '[data-testid="pref-tradeskill-tag"] input'

const BOTH = 'Asp Poison Sac'
const TRADESKILL_ONLY = 'Gnome Meat'

/** The tag kinds drawn on the ledger row named `item`, in order; null when no such row is drawn. */
function tagsOf(page: Page, item: string): Promise<string[] | null> {
  return page.evaluate((name) => {
    for (const row of Array.from(document.querySelectorAll('[data-testid="loot-row"]'))) {
      const label = row.querySelector('[data-testid="loot-item-name"]')?.textContent?.trim() ?? ''
      if (label !== name) continue
      return Array.from(row.querySelectorAll('[data-testid^="loot-tag-"]')).map((el) =>
        (el.getAttribute('data-testid') ?? '').replace('loot-tag-', '')
      )
    }
    return null
  }, item)
}

/** Wait until the row reads `want` (knowledge lands asynchronously), then report what it read. */
async function expectTags(page: Page, item: string, want: string[], when: string): Promise<void> {
  const got = await settle(
    () => tagsOf(page, item),
    (t) => JSON.stringify(t) === JSON.stringify(want),
    { timeoutMs: 20_000 }
  )
  check(`${when}: ${item} is tagged [${want.join(', ')}]`, JSON.stringify(got) === JSON.stringify(want), `read ${JSON.stringify(got)}`)
}

/** Flip the Preferences switch to `on` through the real control, then return to the Loot tab. */
async function setTradeskillTag(page: Page, on: boolean): Promise<boolean> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 30_000 })
  await page.waitForSelector('[data-testid="prefs-rail-loot"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-loot"]')
  await page.waitForSelector(TAG_SWITCH, { timeout: 20_000 })
  const isOn = (): Promise<boolean> => page.$eval(TAG_SWITCH, (el) => (el as HTMLInputElement).checked)
  const before = await isOn()
  if (before !== on) await page.click(TAG_SWITCH, { timeout: 15_000 })
  const settled = await settle(isOn, (v) => v === on, { timeoutMs: 8_000 })
  await page.click('[data-testid="nav-loot"]', { timeout: 30_000 })
  await page.waitForSelector(LOOT_LIST, { timeout: 20_000 })
  return before && settled === on
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-deep-link.log')
  const looted = (item: string): string => `--You have looted a ${item} from a decaying skeleton corpse.--`
  log.appendAt(new Date(), looted(BOTH), looted(TRADESKILL_ONLY))
  const { app, close } = await launchOnFixture(log)

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    await page.waitForSelector(GRID, { timeout: 60_000 })
    await waitHydrated(page)
    await page.click('[data-testid="nav-loot"]', { timeout: 15_000 })
    await page.waitForSelector(LOOT_LIST, { timeout: 20_000 })

    await expectTags(page, BOTH, ['quest', 'tradeskill'], 'default')
    await expectTags(page, TRADESKILL_ONLY, ['tradeskill'], 'default')

    check(
      'Preferences > Loot shows the switch ON by default, and it turns off',
      await setTradeskillTag(page, false)
    )
    await expectTags(page, BOTH, ['quest'], 'switch off')
    await expectTags(page, TRADESKILL_ONLY, [], 'switch off')

    await dumpArtifacts(page, failures.length ? 'loot-tags-FAIL' : 'loot-tags-pass')
  } finally {
    await close()
    await log.dispose()
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
