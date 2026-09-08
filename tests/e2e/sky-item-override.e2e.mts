/**
 * Headless Electron integration test for THE HAND-STATED HELD COUNT (JOS-186).
 *
 * THE REPORT, verbatim in shape: *when I know I don't have an item, but it thinks I do based on the
 * log, then I have no way of "manually" correcting this* (01KZZ51GNHKFNFC082CVGQQ9N8), and its twin
 * — an accidentally destroyed quest item with the Ready tab nagging forever (01M0089H6NCBES55RTYHXDT05R).
 * Neither is a counting bug: a destruction has no log line at all (world-model law 6), so the
 * witnesses are right about the evidence and wrong about the bag. The owner's 2026-08-14 ruling
 * says the user gets to correct the number.
 *
 * WHY THIS NEEDS A REAL APP, and it is the JOS-87 lesson exactly. The arithmetic is pure and pinned
 * without a browser (tests/skyItemOverrides.test.mts drives the real `reconcile` through every case
 * this spec cannot afford to). What no unit test can see is the WIRING, and the wiring here is a
 * full round trip that did not exist before this ticket: a click in the item table → `itemCountKey`
 * → IPC → main's store → the sanitizer → `progress:changed` pushed back → `useProgress` → the
 * reconcile → the number in the cell. Every one of those seams is new, and a unit test would pass
 * with any of them unplugged.
 *
 * THE FIXTURE IS CHOSEN FOR ITS SILENCE. `e2e-copy.log` carries ZERO loot lines, so on launch this
 * character holds nothing at all and every number below is caused by a line this spec appended or a
 * statement this spec made. The one loot shape is copied from the owner's real log, never invented
 * (the awaiting-sample law) and is the same line tests/e2e/sky-turnin.e2e.mts already plays:
 *   `--You have looted an Azarack Skin from Protector of Sky's corpse.--`
 * Azarack Skin is required by exactly ONE quest in the committed data, which is what lets a single
 * row carry the whole trace.
 *
 * THE ARC, in four steps:
 *   1. loot one           the item reads 1/1 — the state the reporter is stuck in
 *   2. state 0 by hand    it reads 0/1, and the row says the number is the user's (the chip), and
 *                         the tab's counts line says one count is stated (the summary chip)
 *   3. loot again AFTER   it reads 1/1 again WITH the statement still in force — the forward rule,
 *                         live: a statement is about an instant, not a pin that rots
 *   4. take it back       the chip and the summary go, and the count is the log's again — proof
 *                         that nothing edited the evidence
 *
 * THE APPENDED LINE IN STEP 3 IS STAMPED DELIBERATELY LATE. The window is `ts > setAt` and both
 * clocks are floored to the second (shared/outputs/baseline.ts argues the resolution), so a line
 * played in the same second as the click would be a coin flip rather than a test. Five minutes on
 * is far outside any scheduling jitter and is otherwise inert — nothing in this spec reads recency.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir per launch.
 *
 * Run: `npm run test:e2e -- sky-item-override`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, type FixtureLog } from './logFixture.mjs'

const NAV_SKY = '[data-testid="nav-posky"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
const SEARCH = '[data-testid="posky-search"]'
const COUNTS = '[data-testid="posky-counts"]'
const ROW = '[data-testid="posky-quest-row"]'
const SUMMARY = `${ROW} .MuiAccordionSummary-root`
/**
 * The item table row for the item under test — the only row in the app that names it. `:has-text`
 * is a PLAYWRIGHT selector engine, so it may be handed to `page.click`/`page.fill` and never to a
 * `document.querySelector` inside `page.evaluate`; the two chips below are therefore named by their
 * bare testid, which is unambiguous here because this spec narrows the list to one quest and states
 * exactly one count.
 */
const ITEM_ROW = 'tr:has-text("Azarack Skin")'
const EDIT = `${ITEM_ROW} [data-testid="posky-item-count-edit"]`
const INPUT = `${ITEM_ROW} [data-testid="posky-item-count-input"] input`
const SAVE = `${ITEM_ROW} [data-testid="posky-item-count-save"]`
const CHIP = '[data-testid="posky-item-override"]'
const CHIP_CLEAR = `${CHIP} .MuiChip-deleteIcon`
const SUMMARY_CHIP = '[data-testid="posky-overrides-active"]'

const QUEST = 'Beastlord Test of Azarack'
const ITEM = 'Azarack Skin'
const LOOT = "--You have looted an Azarack Skin from Protector of Sky's corpse.--"

/** How many quests the filters leave, off the counts line. `null` when it is not mounted. */
function filteredCount(page: Page): Promise<number | null> {
  return page.evaluate((sel) => {
    const m = /(\d+) of (\d+) quests/.exec(document.querySelector(sel)?.textContent ?? '')
    return m ? Number(m[1]) : null
  }, COUNTS)
}

/**
 * The `have/need` NUMBER in the item row's Have cell — read as the third cell of the row that names
 * the item, because that is where it lives whatever the control around it is doing. The cell also
 * carries the provenance chip once a statement is made ("0/1By hand: 0" as one text run), so the
 * pair is matched rather than trimmed: the chip is asserted separately, by its own `data-count`.
 * `null` when the expanded panel is not mounted (a collapsed accordion draws nothing, JOS-206) or
 * when the cell holds no pair at all.
 */
function haveText(page: Page, item: string): Promise<string | null> {
  return page.evaluate((name) => {
    const row = [...document.querySelectorAll('tr')].find((tr) =>
      (tr.cells[1]?.textContent ?? '').trim().startsWith(name)
    )
    if (!row) return null
    return /^\s*(\d+\/\d+)/.exec(row.cells[2]?.textContent ?? '')?.[1] ?? null
  }, item)
}

/** `data-count` off a chip, or null when it is not on screen. */
function chipCount(page: Page, sel: string): Promise<number | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    return el ? Number(el.getAttribute('data-count')) : null
  }, sel)
}

/** Open the Sky tab, narrow to the one quest, and expand it so its item table exists. */
async function openTheQuest(page: Page): Promise<boolean> {
  await page.click(NAV_SKY, { timeout: 30_000 })
  const bar = await page.waitForSelector(SEARCH, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the Sky tab opens on its filter bar', bar)) return false
  await page.fill(`${SEARCH} input`, QUEST)
  const only = await settle(() => filteredCount(page), (n) => n === 1, { timeoutMs: 30_000 })
  if (!check(`the search narrows to ${QUEST} alone`, only === 1, `filtered=${String(only)}`)) return false
  await page.click(SUMMARY, { timeout: 15_000 })
  const have = await settle(() => haveText(page, ITEM), (v) => v !== null, { timeoutMs: 20_000 })
  return check('…and expanding it draws the item table', have !== null, String(have))
}

/** STEP 1 — the state the reporter is stuck in: the log saw it drop, so the app counts it. */
async function stepLootedOnce(page: Page, log: FixtureLog): Promise<boolean> {
  const before = await haveText(page, ITEM)
  check('with an empty log the item is not held at all', before === '0/1', String(before))
  log.appendAt(new Date(), LOOT)
  const after = await settle(() => haveText(page, ITEM), (v) => v === '1/1', { timeoutMs: 45_000 })
  return check(
    `LOOTING ${ITEM} MAKES THE APP COUNT IT — the reporter's starting position`,
    after === '1/1',
    String(after)
  )
}

/**
 * STEP 2 — the correction, through the real control. This is the click that had no home before this
 * ticket, and every seam it crosses is new.
 */
async function stepStateZero(page: Page): Promise<boolean> {
  await page.click(EDIT, { timeout: 15_000 })
  const filled = await settle(
    () => page.inputValue(INPUT).catch(() => null),
    (v) => v === '1',
    { timeoutMs: 15_000 }
  )
  check('the editor opens pre-filled with what the app thinks you hold', filled === '1', String(filled))
  await page.fill(INPUT, '0')
  await page.click(SAVE, { timeout: 15_000 })
  const have = await settle(() => haveText(page, ITEM), (v) => v === '0/1', { timeoutMs: 20_000 })
  if (
    !check(
      'STATING 0 BY HAND IS THE NUMBER THE TAB COUNTS — through IPC, the store and back',
      have === '0/1',
      String(have)
    )
  ) {
    return false
  }
  check('…and the row says the number is the user`s', (await chipCount(page, CHIP)) === 0)
  return check(
    '…and the tab`s counts line says one count is stated by hand',
    (await chipCount(page, SUMMARY_CHIP)) === 1
  )
}

/**
 * STEP 3 — THE FORWARD RULE, live. A statement is what you held at an instant, so a drop that lands
 * afterwards adds to it. A pinned absolute would still read 0 here, and would go on reading 0 until
 * the user remembered to come back — which is the thing this design refuses.
 */
async function stepLootAfterCounts(page: Page, log: FixtureLog): Promise<void> {
  log.appendAt(new Date(Date.now() + 5 * 60_000), LOOT)
  const have = await settle(() => haveText(page, ITEM), (v) => v === '1/1', { timeoutMs: 45_000 })
  if (
    !check(
      'A DROP AFTER THE STATEMENT COUNTS ON TOP OF IT — the statement is an instant, not a pin',
      have === '1/1',
      String(have)
    )
  ) {
    return
  }
  check(
    '…with the statement still in force, so the row still says where the number came from',
    (await chipCount(page, CHIP)) === 0
  )
}

/** STEP 4 — the take-back, off the chip that made the statement visible. */
async function stepTakeItBack(page: Page): Promise<void> {
  await page.click(CHIP_CLEAR, { timeout: 15_000 })
  const gone = await settle(() => chipCount(page, CHIP), (v) => v === null, { timeoutMs: 20_000 })
  check('CLEARING THE STATEMENT REMOVES IT FROM THE ROW', gone === null, String(gone))
  check('…and from the tab`s counts line', (await chipCount(page, SUMMARY_CHIP)) === null)
  // The log saw TWO of these drop and the quest needs one, so the witnesses answer 1/1 again. The
  // point is not the digit: it is that the evidence was never edited, only out-voted while a
  // statement stood (tests/skyItemOverrides.test.mts pins that as a whole-result deep equality).
  const have = await haveText(page, ITEM)
  check('…and the count is the log`s again', have === '1/1', String(have))
}

async function main(): Promise<void> {
  buildIfStale()

  const launched = await launchOnFixture('e2e-copy.log')
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
    if (!(await openTheQuest(page))) {
      throw new Error('never reached the expanded Sky quest — nothing below can be asserted')
    }
    if (await stepLootedOnce(page, launched.log)) {
      if (await stepStateZero(page)) {
        await stepLootAfterCounts(page, launched.log)
        await stepTakeItBack(page)
      }
    }
    if (failures.length) await dumpArtifacts(page, 'sky-item-override-FAIL')
  } finally {
    await launched.close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
