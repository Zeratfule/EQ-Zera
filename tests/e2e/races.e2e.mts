/**
 * Headless Electron integration test for THE RACES TAB — race-unlock progress off the
 * `/outputfile achievements` dump, closest to unlocking first, each race opening onto the factions
 * it needs and the fastest stated ways to raise them.
 *
 * WHY THIS NEEDS A REAL APP. The projection, the plan and the ordering are unit-tested
 * (tests/raceUnlocks.test.mts, tests/factionSources.test.mts). What no unit test sees is the chain:
 * a dump staged beside the install travels main's loader into the store, out over `onProgress`,
 * and into a tab that also reads the `faction` fold and the bundled dataset. And the open/closed
 * state of a card is a choice the user made, so it has to survive the view unmounting.
 *
 * THE DUMP IS THE OWNER'S REAL ONE (tests/fixtures/Primitive_freeport-Achievements.txt): sixteen
 * race unlocks, Froglok and Ogre complete, Erudite and Human (Qeynos) one faction in.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts races`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, reportRun, settle, settleCount } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const DUMP = 'Primitive_freeport-Achievements.txt'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
const NAV_RACES = '[data-testid="nav-races"]'
const NAV_MAPS = '[data-testid="nav-maps"]'
const PANE = '[data-testid="races"]'
const EMPTY = '[data-testid="races-empty"]'
const FRESH = '[data-testid="races-achievements-fresh"]'
const CARD = '[data-testid^="race-card-"][data-race]'
const cardOf = (slug: string): string => `[data-testid="race-card-${slug}"]`

interface CardRow {
  race: string
  status: string
  remaining: number
}

/** The cards in drawn order, off their own data attributes. The order IS the feature. */
function cards(page: Page): Promise<CardRow[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((el) => ({
        race: el.getAttribute('data-race') ?? '',
        status: el.getAttribute('data-status') ?? '',
        remaining: Number(el.getAttribute('data-remaining'))
      })),
    CARD
  )
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel)
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
}

async function openRaces(page: Page, pane: string): Promise<boolean> {
  await page.click(NAV_RACES, { timeout: 30_000 })
  return page.waitForSelector(pane, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
}

/** Every race gets a card; unlocked ones are the tail; the open ones run fewest-remaining first. */
async function stepCardsAndOrder(page: Page): Promise<void> {
  const n = await settleCount(page, CARD, 16, { timeoutMs: 30_000 })
  check('EVERY RACE IN THE DUMP GETS A CARD', n === 16, `cards=${String(n)}`)
  const rows = await cards(page)
  const firstUnlocked = rows.findIndex((r) => r.status === 'unlocked')
  check(
    '…the two unlocked races (Froglok, Ogre) are drawn last',
    firstUnlocked === rows.length - 2 && rows.slice(firstUnlocked).every((r) => r.status === 'unlocked'),
    rows.map((r) => `${r.race}:${r.status}`).join(',')
  )
  const open = rows.slice(0, firstUnlocked)
  check(
    '…and CLOSEST TO UNLOCKING LEADS: fewest objectives remaining first',
    open.every((r, i) => i === 0 || open[i - 1].remaining <= r.remaining),
    open.map((r) => `${r.race}:${String(r.remaining)}`).join(',')
  )
  const erudite = rows.find((r) => r.race === 'Erudite')
  check('a race with one faction maxed reads In progress', erudite?.status === 'in-progress', JSON.stringify(erudite))
  check(
    'the Froglok card says the character was created as one',
    (await textOf(page, cardOf('froglok'))).includes('created as this race')
  )
  check(
    'the Half Elf card points at the closest of Human and Wood Elf',
    (await textOf(page, cardOf('half-elf'))).includes('Closest: Human (Qeynos)'),
    (await textOf(page, cardOf('half-elf'))).slice(0, 200)
  )
  check(
    'the Kerran card names its task',
    (await textOf(page, cardOf('kerran'))).includes('Aid the Kerrans of Kerra Isle')
  )
  check('the freshness line names the command', (await textOf(page, FRESH)).includes('/outputfile achievements'))
}

/** Open Human (Qeynos): its factions, the maxed one chipped, and kills that hurt a sibling flagged. */
async function stepExpand(page: Page): Promise<void> {
  const card = cardOf('human-qeynos')
  await page.click(`${card} [data-testid="race-card-header"]`, { timeout: 15_000 })
  const factions = await settleCount(page, `${card} [data-testid="race-faction"]`, 3, { timeoutMs: 15_000 })
  check('OPENING A RACE SHOWS EACH FACTION IT NEEDS', factions === 3, `factions=${String(factions)}`)
  const maxed = await countOf(page, `${card} [data-testid="race-faction"][data-maxed="true"] [data-testid="race-faction-maxed"]`)
  check('…the faction the dump marks complete wears a maxed chip', maxed === 1, `maxed=${String(maxed)}`)
  const ways = await countOf(page, `${card} [data-testid="race-way-mob"]`)
  check('…the open factions list kills that raise them', ways > 0, `ways=${String(ways)}`)
  const gain = await textOf(page, `${card} [data-testid="race-way-gain"]`)
  check('…each way states its gain per kill, or says the amount is unknown', /per kill|amount unknown|^\+\d+$/.test(gain), gain)
  // Corrupt Qeynos Guard and Guards of Qeynos are both Qeynos factions and pull against each other.
  const hurts = await page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent ?? ''),
    `${card} [data-testid="race-way-hurts"]`
  )
  check(
    '…and a kill or turn-in that lowers another faction this race needs is flagged',
    hurts.some((h) => /lowers (Guards of Qeynos|Corrupt Qeynos Guard|Merchants of Qeynos)/.test(h)),
    hurts.slice(0, 4).join(' | ')
  )
  const seen = await textOf(page, `${card} [data-testid="race-faction-seen"]`)
  check('…the log line speaks of change seen, never a standing', !/standing/i.test(seen) && seen.length > 0, seen)
}

/** The open card survives the view unmounting: a tab switch and back. */
async function stepOpenSurvivesRemount(page: Page): Promise<void> {
  await page.click(NAV_MAPS, { timeout: 15_000 })
  const gone = await settle(() => countOf(page, PANE), (n) => n === 0, { timeoutMs: 15_000 })
  if (!check('the Races view is gone after switching tabs', gone === 0)) return
  await openRaces(page, PANE)
  const factions = await settleCount(page, `${cardOf('human-qeynos')} [data-testid="race-faction"]`, 3, {
    timeoutMs: 15_000
  })
  check('AN OPENED RACE IS STILL OPEN AFTER THE VIEW REMOUNTS', factions === 3, `factions=${String(factions)}`)
}

async function stepNoDump(): Promise<void> {
  const launched = await launchOnFixture('e2e-copy.log')
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
    await answerNotice(page)
    const shown = await openRaces(page, EMPTY)
    if (!check('WITH NO ACHIEVEMENTS DUMP, the tab explains how to make one', shown)) return
    const text = await settle(() => textOf(page, EMPTY), (t) => t.includes('/outputfile achievements'), { timeoutMs: 15_000 })
    check('…naming the command to type in game', text.includes('/outputfile achievements'), text.slice(0, 240))
    check('…and no race card is drawn', (await countOf(page, CARD)) === 0)
    if (failures.length) await dumpArtifacts(page, 'races-none-FAIL')
  } finally {
    await launched.close()
  }
}

async function main(): Promise<void> {
  buildIfStale()
  const launched = await launchOnFixture('e2e-copy.log', { achievements: DUMP })
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
    await answerNotice(page)
    if (!check('the Races tab opens onto its pane', await openRaces(page, PANE))) {
      throw new Error('never reached the Races tab - nothing below can be asserted')
    }
    await stepCardsAndOrder(page)
    await stepExpand(page)
    await stepOpenSurvivesRemount(page)
    if (failures.length) await dumpArtifacts(page, 'races-FAIL')
  } finally {
    await launched.close()
  }
  await stepNoDump()
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
