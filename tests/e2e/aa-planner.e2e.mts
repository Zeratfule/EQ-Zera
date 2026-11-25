/**
 * Headless Electron integration test for THE AAs TAB — the Alternate Advancement planner: the
 * wiki catalog cut to the class trio, what the log says you hold, and a plan of target ranks with
 * its cost, shortfall and blocked steps.
 *
 * WHY THIS NEEDS A REAL APP. The arithmetic, the catalog parser and the stored plan's validation
 * are unit-tested (tests/aaPlanner.test.mts, tests/aaCatalog.test.mts). What no unit test sees is
 * the chain: purchase lines travel the engine's `leveling` fold into a tab that joins them to the
 * bundled catalog, a LIVE purchase moves a held rank, and the plan is a choice the user made, so
 * it has to survive the view unmounting.
 *
 * THE LOG is tests/fixtures/e2e-leveling.log: Burst of Power bought to 3/3, Healing Boon to 1/3,
 * two Unbound ranks auto-granted at level 50, and a PAL/MNK/ENC `/who` row (no race grant line).
 *
 * THE CHARACTER FACTS (race, respec) are per-character prefs too: the race pick cuts the race
 * reincarnation rows, a recorded respec drops the paid ranks bought before it, Undo restores them,
 * and a live `/who` to a trio with no tank caps Steadfast Will at 7.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts aa-planner`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle, settleCount, settleGone } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, type FixtureLog } from './logFixture.mjs'

const NAV_OVERVIEW = '[data-testid="nav-overview"]'
const NAV_AA = '[data-testid="nav-aa"]'
const NAV_MAPS = '[data-testid="nav-maps"]'
const PANE = '[data-testid="aa-planner"]'
const SEARCH = '[data-testid="aa-planner-search"]'
const STEP = '[data-testid="aa-planner-step"]'
const rowOf = (name: string): string => `[data-testid="aa-planner-row"][data-name="${name}"]`

function attr(page: Page, sel: string, name: string): Promise<string | null> {
  return page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [sel, name] as const)
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel)
}

function steps(page: Page): Promise<{ name: string; blocked: string; cumulative: number }[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((el) => ({
        name: el.getAttribute('data-name') ?? '',
        blocked: el.getAttribute('data-blocked') ?? '',
        cumulative: Number(el.getAttribute('data-cumulative'))
      })),
    STEP
  )
}

async function answerNotice(page: Page): Promise<void> {
  if ((await countOf(page, '[data-testid="telemetry-notice"]')) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
}

async function search(page: Page, q: string): Promise<void> {
  await page.fill(SEARCH, q)
}

async function openAa(page: Page): Promise<boolean> {
  await page.click(NAV_AA, { timeout: 30_000 })
  return page.waitForSelector(PANE, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
}

/** The sections, the held ranks the log states, and the reincarnation rows that are never plannable. */
async function stepCatalog(page: Page): Promise<void> {
  for (const s of ['general', 'archetype', 'special']) {
    check(`the ${s} section is drawn`, (await countOf(page, `[data-testid="aa-planner-section-${s}"]`)) === 1)
  }
  const held = await settle(() => attr(page, rowOf('Burst of Power'), 'data-held'), (v) => v === '3', { timeoutMs: 30_000 })
  check('HELD RANKS COME FROM THE LOG: Burst of Power reads 3 of 3', held === '3', `held=${String(held)}`)
  check('…and a maxed AA offers no plan control', (await countOf(page, `${rowOf('Burst of Power')} [data-testid="aa-planner-target"]`)) === 0)
  check('Healing Boon reads 1 of 3', (await attr(page, rowOf('Healing Boon'), 'data-held')) === '1')
  const reinc = rowOf('Class Reincarnation: Warrior')
  check('a reincarnation AA is in the list', (await countOf(page, reinc)) === 1)
  check('…GRANTED BY REINCARNATION, never bought', (await textOf(page, `${reinc} [data-testid="aa-planner-next"]`)) === 'granted by reincarnation')
  check('…with no plan control', (await countOf(page, `${reinc} [data-testid="aa-planner-target"]`)) === 0)
  check('the seen-since line names the log as the source', (await textOf(page, '[data-testid="aa-planner-seen"]')).includes('your log has seen since'))
}

/** Build a plan, check the totals, reorder it into a blocked step. */
async function stepPlan(page: Page): Promise<void> {
  await search(page, 'Healing Boon')
  await settleCount(page, '[data-testid="aa-planner-row"]', 1, { timeoutMs: 10_000 })
  check('SEARCH narrows the list', (await countOf(page, '[data-testid="aa-planner-row"]')) === 1)
  await page.click(`${rowOf('Healing Boon')} [data-testid="aa-planner-target-inc"]`)
  await page.click(`${rowOf('Healing Boon')} [data-testid="aa-planner-target-inc"]`)
  await settleCount(page, STEP, 1, { timeoutMs: 10_000 })
  const one = await steps(page)
  check('RAISING A TARGET ADDS A PLAN STEP costing the ranks above held (6 + 9)', one[0]?.name === 'Healing Boon' && one[0].cumulative === 15, JSON.stringify(one))
  check('…and the total says so', (await textOf(page, '[data-testid="aa-planner-total-needed"]')) === '15')
  await search(page, 'Destructive Fury')
  await page.click(`${rowOf('Destructive Fury')} [data-testid="aa-planner-target-inc"]`)
  await search(page, 'Fury of Magic')
  await page.click(`${rowOf('Fury of Magic')} [data-testid="aa-planner-target-inc"]`)
  await settleCount(page, STEP, 3, { timeoutMs: 10_000 })
  let rows = await steps(page)
  check('…Destructive Fury without Fury of Magic held is BLOCKED', rows[1]?.blocked === 'true', JSON.stringify(rows))
  await page.click(`${STEP}[data-name="Fury of Magic"] [data-testid="aa-planner-step-up"]`)
  rows = await settle(() => steps(page), (r) => r[1]?.name === 'Fury of Magic', { timeoutMs: 10_000 })
  check('REORDER moves a step up', rows.map((r) => r.name).join(',') === 'Healing Boon,Fury of Magic,Destructive Fury', JSON.stringify(rows))
  check('…and a prerequisite planned EARLIER unblocks the later step', rows[2]?.blocked === 'false', JSON.stringify(rows))
  await search(page, '')
}

/** A purchase line arriving live moves the held rank, and the plan step re-prices from it. */
async function stepLive(page: Page, log: FixtureLog): Promise<void> {
  log.append('You have improved Healing Boon 2 at a cost of 6 ability points.')
  const held = await settle(() => attr(page, rowOf('Healing Boon'), 'data-held'), (v) => v === '2', { timeoutMs: 30_000 })
  check('A LIVE PURCHASE LINE RAISES THE HELD RANK', held === '2', `held=${String(held)}`)
  const rows = await settle(() => steps(page), (r) => r[0]?.cumulative === 9, { timeoutMs: 10_000 })
  check('…and the plan step now costs only the rank still to buy', rows[0]?.cumulative === 9, JSON.stringify(rows))
}

const RACE_ROWS = '[data-testid="aa-planner-row"][data-name^="Race Reincarnation:"]'

/** The fixture states no race grant, so every race's row is listed until the user picks one. */
async function stepRace(page: Page): Promise<void> {
  check('WITH NO RACE every race reincarnation AA is listed (16)', (await countOf(page, RACE_ROWS)) === 16, String(await countOf(page, RACE_ROWS)))
  check('…and the race picker reads Not set', (await page.$eval('[data-testid="aa-planner-race"]', (el) => (el as HTMLSelectElement).selectedOptions[0]?.textContent ?? '')) === 'Not set')
  await page.selectOption('[data-testid="aa-planner-race"]', 'Human')
  const n = await settleCount(page, RACE_ROWS, 1, { timeoutMs: 10_000 })
  check('PICKING A RACE lists only that race reincarnation AA', n === 1 && (await countOf(page, rowOf('Race Reincarnation: Human'))) === 1)
  check('…and a class reincarnation AA is untouched', (await countOf(page, rowOf('Class Reincarnation: Warrior'))) === 1)
}

/**
 * A respec drops the paid ranks bought before it; later purchases stay. (The fixture's only free
 * grants are the Unbound ranks, which the catalog does not list, so the free-grant half is pinned in
 * tests/aaCharacter.test.mts.)
 */
async function stepRespec(page: Page): Promise<void> {
  await page.click('[data-testid="aa-planner-respec"]')
  await page.waitForSelector('[data-testid="aa-planner-respec-when"]', { timeout: 10_000 })
  await page.fill('[data-testid="aa-planner-respec-when"]', '2099-01-01T00:00')
  check('A FUTURE RESPEC is refused', await confirmDisabled(page), await textOf(page, '[data-testid="aa-planner-respec-refusal"]'))
  // after every fixture purchase (Burst of Power 3 at 21:42, Healing Boon 1 at 19:31), before the live Healing Boon 2
  await page.fill('[data-testid="aa-planner-respec-when"]', '2026-08-04T22:00')
  check('…a past one is accepted', !(await confirmDisabled(page)))
  await page.click('[data-testid="aa-planner-respec-confirm"]')
  const burst = await settle(() => attr(page, rowOf('Burst of Power'), 'data-held'), (v) => v === '0', { timeoutMs: 10_000 })
  check('AFTER A RESPEC a rank bought before it no longer reads as held (Burst of Power 0)', burst === '0', `held=${String(burst)}`)
  check('…a purchase AFTER it still counts (Healing Boon 2)', (await attr(page, rowOf('Healing Boon'), 'data-held')) === '2')
  check('…and the tab shows the respec date', (await countOf(page, '[data-testid="aa-planner-respec-date"]')) === 1)
  await page.click('[data-testid="aa-planner-respec"]')
  await page.waitForSelector('[data-testid="aa-planner-respec-when"]', { timeout: 10_000 })
  await page.fill('[data-testid="aa-planner-respec-when"]', '2026-08-04T20:00')
  check('A RESPEC EARLIER THAN THE ONE IN FORCE is refused', await confirmDisabled(page), await textOf(page, '[data-testid="aa-planner-respec-refusal"]'))
  await page.click('[data-testid="aa-planner-respec-cancel"]')
  await settleGone(page, '[data-testid="aa-planner-respec-dialog"]', { timeoutMs: 10_000 })
}

function confirmDisabled(page: Page): Promise<boolean> {
  return page.$eval('[data-testid="aa-planner-respec-confirm"]', (el) => (el as HTMLButtonElement).disabled)
}

async function stepUndoRespec(page: Page): Promise<void> {
  await page.click('[data-testid="aa-planner-respec-undo"]')
  const burst = await settle(() => attr(page, rowOf('Burst of Power'), 'data-held'), (v) => v === '3', { timeoutMs: 10_000 })
  check('UNDO puts the refunded ranks back (Burst of Power 3)', burst === '3', `held=${String(burst)}`)
  check('…and the respec date is gone', (await countOf(page, '[data-testid="aa-planner-respec-date"]')) === 0)
}

/** Steadfast Will's class cap: a paladin trio trains all 8; a live /who to a monk trio caps it at 7. */
async function stepCap(page: Page, log: FixtureLog): Promise<void> {
  await search(page, 'Steadfast Will')
  const will = rowOf('Steadfast Will')
  await page.waitForSelector(will, { timeout: 10_000 })
  check('a PAL trio reaches Steadfast Will 8', (await attr(page, `${will} [data-testid="aa-planner-cap"]`, 'data-cap')) === '8')
  log.append('[50 MNK/ENC/WIZ] Primitive (Dark Elf)  ZONE: East Freeport (freporte)  ')
  const cap = await settle(() => attr(page, `${will} [data-testid="aa-planner-cap"]`, 'data-cap'), (v) => v === '7', { timeoutMs: 30_000 })
  check('A MONK trio (no tank) is CAPPED at 7', cap === '7', `cap=${String(cap)}`)
  for (let i = 0; i < 8; i++) {
    const inc = `${will} [data-testid="aa-planner-target-inc"]`
    if ((await page.$eval(inc, (el) => (el as HTMLButtonElement).disabled)) === true) break
    await page.click(inc)
  }
  check('…the plan stepper stops at the cap', (await textOf(page, `${will} [data-testid="aa-planner-target-value"]`)) === '7')
  await search(page, '')
}

/** The plan, a collapsed section, the race and the respec survive the view unmounting. */
async function stepRemount(page: Page): Promise<void> {
  await page.click(`[data-testid="aa-planner-section-general"] [data-testid="aa-planner-section-toggle"]`)
  await page.click(NAV_MAPS, { timeout: 15_000 })
  const gone = await settle(() => countOf(page, PANE), (n) => n === 0, { timeoutMs: 15_000 })
  if (!check('the AAs view is gone after switching tabs', gone === 0)) return
  await openAa(page)
  const n = await settleCount(page, STEP, 3, { timeoutMs: 15_000 })
  const rows = await steps(page)
  check('THE PLAN SURVIVES THE VIEW REMOUNTING, in order', n === 3 && rows.map((r) => r.name).join(',') === 'Healing Boon,Fury of Magic,Destructive Fury', JSON.stringify(rows))
  check('…and so does a collapsed section', (await attr(page, '[data-testid="aa-planner-section-general"]', 'data-collapsed')) === 'true')
  check('…and so does the race pick', (await page.$eval('[data-testid="aa-planner-race"]', (el) => (el as HTMLSelectElement).value)) === 'Human')
  check('…and so does the respec', (await countOf(page, '[data-testid="aa-planner-respec-date"]')) === 1)
  await page.click(`[data-testid="aa-planner-section-general"] [data-testid="aa-planner-section-toggle"]`)
}

async function main(): Promise<void> {
  buildIfStale()
  const { app, close, log } = await launchOnFixture('e2e-leveling.log')
  let page: Page | null = null
  try {
    page = await mainWindow(app)
    await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
    await answerNotice(page)
    if (!check('the AAs tab opens onto its pane', await openAa(page))) throw new Error('never reached the AAs tab')
    await stepCatalog(page)
    await stepPlan(page)
    await stepLive(page, log)
    await stepRace(page)
    await stepRespec(page)
    await stepRemount(page)
    await stepUndoRespec(page)
    await stepCap(page, log)
    if (failures.length) await dumpArtifacts(page, 'aa-planner-FAIL')
  } finally {
    await close()
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
