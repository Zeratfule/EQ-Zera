/**
 * Headless Electron integration test for THE ZONE LOOT TAB (EQ Zera, ROADMAP §2).
 *
 * The tab answers one question - "I am going to <zone>: who lives there, what do they drop, and
 * have I ever had any of it?" - and this spec drives the whole of it in one launch: the picker, the
 * table, the out-of-era disclosure, the search, the footer's provenance line, and the link OUT to
 * the Loot ledger that makes an item name worth clicking.
 *
 * WHY IT CAN STATE EXACT NUMBERS. Nothing asserted below is read off the player's log. The mob
 * roster and the drop list are the COMMITTED catalog (`data/eqlegends/mobs.json`) and the era
 * verdict is the COMMITTED item corpus, so "111 drops, 67 of them out of era" is a fact about bytes
 * in the repo. `tests/zoneLoot.test.mts` pins the same split without a browser; this spec is about
 * what a READER sees, which is the half a unit test cannot reach.
 *
 * WHY KAESORA AND NOT CAZIC THULE. Asked from the renderer, the era join sees the item's ZONE
 * evidence and not the item page's revamp BANNER (zoneLoot.ts's header states the limit), so every
 * drop in the Cazic Thule zone reads in-era and there would be no disclosure to click. Kaesora is a
 * Kunark crypt whose table this server's era genuinely does not open, from the zone layer alone.
 *
 * COUNTS COME FROM THE FOOTER, NOT FROM THE DOM. The table is WINDOWED (`lib/useWindowedRows`), so
 * only the slice a scroll box can paint is ever mounted - counting `zoneloot-row` nodes would count
 * a viewport, not a zone. The footer states the whole table, which is also the line a reader
 * actually uses, so asserting it is both the correct and the honest reading.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir minted per launch - which is
 * also why the tab starts with nothing remembered in `eq.zoneloot.zone`.
 *
 * Run: `npm run test:e2e -- zone-loot`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle, waitHydrated } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const GRID = '[data-testid="overview-grid"]'
const NAV = '[data-testid="nav-zoneloot"]'
const VIEW = '[data-testid="zoneloot-view"]'
const ZONE_INPUT = '[data-testid="zoneloot-zone"]'
const SEARCH = '[data-testid="zoneloot-search"]'
const ROW = '[data-testid="zoneloot-row"]'
const ITEM = '[data-testid="zoneloot-item"]'
const ERA_TOGGLE = '[data-testid="zoneloot-era-toggle"]'
const FOOTER = '[data-testid="zoneloot-footer"]'
/**
 * Where an item name lands. `openLoot(item)` is the DEEP link, so the Loot tab opens on that item's
 * detail pane (`LootDetailTakeover`) rather than on the ledger — `loot-detail`, not `loot-list`,
 * which is the same arrival the Exaltations donors and the mob page's drop rows make.
 */
const LOOT = '[data-testid="loot-detail"]'

/** The zone this spec drives, and what the committed corpus says about it. */
const ZONE = 'Kaesora'
const LISTED = 111
const OUT_OF_ERA = 67
const IN_ERA = LISTED - OUT_OF_ERA
/** Mobs with at least one drop, in each half — the footer's first number. */
const MOBS_IN_ERA = 10
const MOBS_LISTED = 24
/** A search that matches ITEMS only — nine Fine Steel drops off three mobs, all of them in era. */
const NEEDLE = 'fine steel'
const NEEDLE_DROPS = 9

/** Wait for a selector to be mounted; false rather than a throw, so a step can report instead. */
function appears(page: Page, sel: string, ms = 20_000): Promise<boolean> {
  return page.waitForSelector(sel, { timeout: ms }).then(
    () => true,
    () => false
  )
}

/** Rendered text of the first match, whitespace collapsed; '' when the node isn't mounted. */
async function textOf(page: Page, sel: string): Promise<string> {
  const raw = await page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
  return raw.replace(/\s+/g, ' ').trim()
}

/** Land, and let the startup replay finish. */
async function stepReady(page: Page): Promise<void> {
  if (!check('the app lands on the Overview', await appears(page, GRID, 60_000))) {
    throw new Error('never landed on Overview — nothing below can be asserted')
  }
  const { snap } = await waitHydrated(page)
  check('hydration completes (the replay has finished)', !snap.hydrating)
}

/**
 * 1. THE TAB, AND THE PICKER.
 *
 * The zone list is derived from the catalog, not from the map packs on this machine, so typing a
 * zone name has to find it on a checkout with no maps installed at all — which is what this
 * harness is.
 */
async function stepPickZone(page: Page): Promise<boolean> {
  if (!check('the nav offers a Zone Loot row', await appears(page, NAV))) return false
  await page.click(NAV, { timeout: 15_000 })
  if (!check('…which opens the tab', await appears(page, VIEW))) return false
  // Nothing is remembered on a fresh userData, so the tab opens on its "pick a zone" state unless
  // the fixture's character happens to be standing somewhere the catalog knows.
  if (!check('the tab offers a searchable zone picker', await appears(page, ZONE_INPUT))) return false
  await page.fill(ZONE_INPUT, ZONE, { timeout: 15_000 })
  // `autoHighlight` puts the first match under the cursor, so Enter takes it — the same keystroke
  // a reader uses, and one that does not depend on the popper's DOM shape.
  await page.press(ZONE_INPUT, 'Enter', { timeout: 15_000 })
  return check(`picking ${ZONE} draws its table`, await appears(page, ROW, 20_000))
}

/**
 * 2. THE TABLE AND THE DISCLOSURE.
 *
 * Every number is stated twice over: once as itself, and once as the sum that proves nothing was
 * deleted. Hiding a row and losing a row look identical from the outside unless the spec adds them
 * up — the mob page's rule, on the tab that borrowed its fold.
 */
async function stepEraFold(page: Page): Promise<void> {
  const folded = await settle(() => textOf(page, FOOTER), (t) => t.includes(`${String(IN_ERA)} drops`), { timeoutMs: 15_000 })
  check(
    `the table shows ${String(IN_ERA)} of ${String(LISTED)} drops by default (the rest are out of era)`,
    folded.includes(`${String(MOBS_IN_ERA)} mobs · ${String(IN_ERA)} drops`),
    folded
  )
  check('…and the footer states the wiki data it is reading', folded.includes('wiki data as of'), folded)
  check('rows are actually painted', (await countOf(page, ROW)) > 0)

  if (!check('the folded rows are offered as a disclosure', await appears(page, ERA_TOGGLE))) return
  const label = await textOf(page, ERA_TOGGLE)
  check(`…reading "+${String(OUT_OF_ERA)} out of era"`, label === `+${String(OUT_OF_ERA)} out of era`, label)

  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const all = await settle(() => textOf(page, FOOTER), (t) => t.includes(`${String(LISTED)} drops`), { timeoutMs: 10_000 })
  check(
    `expanding it restores the whole table (${String(IN_ERA)} + ${String(OUT_OF_ERA)} = ${String(LISTED)}, nothing deleted)`,
    all.includes(`${String(MOBS_LISTED)} mobs · ${String(LISTED)} drops`),
    all
  )
  check('the disclosure keeps its label while open', (await textOf(page, ERA_TOGGLE)) === label)
}

/**
 * 3. THE SEARCH, over the zone that is on screen.
 *
 * It narrows the TABLE, and it narrows what the disclosure is counting with it — a chip offering
 * "+67 out of era" beside four rows would be describing a table nobody is looking at.
 */
async function stepSearch(page: Page): Promise<void> {
  await page.fill(SEARCH, NEEDLE, { timeout: 15_000 })
  const narrowed = await settle(
    () => textOf(page, FOOTER),
    (t) => t.includes(`${String(NEEDLE_DROPS)} drops`),
    { timeoutMs: 10_000 }
  )
  check(`typing "${NEEDLE}" narrows the table to ${String(NEEDLE_DROPS)} drops`, narrowed.includes(`${String(NEEDLE_DROPS)} drops`), narrowed)
  const shown = await countOf(page, ROW)
  check('…to rows that are still real', shown > 0, String(shown))
  const first = await textOf(page, ROW)
  check(`…and every one of them is a ${NEEDLE} row`, first.toLowerCase().includes(NEEDLE), first)
  // The disclosure counts what the SEARCH left, so a query with nothing folded offers no chip.
  check('…and the era disclosure counts the searched table, not the whole zone', (await countOf(page, ERA_TOGGLE)) === 0)
  await page.fill(SEARCH, '', { timeout: 15_000 })
  await settle(() => textOf(page, FOOTER), (t) => t.includes(`${String(LISTED)} drops`), { timeoutMs: 10_000 })
}

/**
 * 4. AN ITEM NAME IS A LINK. Clicking one lands on the Loot ledger — the same destination the
 *    mob page's drop rows and the Exaltations donors use, through the app's one router.
 */
async function stepOpenItem(page: Page): Promise<void> {
  if (!check('a row carries a clickable item name', await appears(page, ITEM))) return
  await page.click(ITEM, { timeout: 15_000 })
  check('clicking it lands on the Loot tab', await appears(page, LOOT, 20_000))
  check('…and leaves the Zone Loot tab behind', (await countOf(page, VIEW)) === 0)
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-deep-link.log…')
  const { app, close } = await launchOnFixture('e2e-deep-link.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await stepReady(page)
    if (await stepPickZone(page)) {
      await stepEraFold(page)
      await stepSearch(page)
      await stepOpenItem(page)
    } else {
      note('the zone was never picked — the table steps cannot be asserted')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    await dumpArtifacts(page, failures.length ? 'zone-loot-FAIL' : 'zone-loot-pass')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
