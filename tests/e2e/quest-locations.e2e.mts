/**
 * Headless Electron integration test for QUEST LOCATIONS (quest locations wave).
 *
 * THE CLAIM. A quest page says where each step happens — "Rylin Coil · Ak'Anon (1469, -190)" —
 * with where each number came from, and where each needed item drops. Clicking a chip opens the
 * Maps tab ON THAT ZONE, centred on the point, with a TARGET marker that is not the player's typed
 * /loc crosshair and outlives a tab switch until it is dismissed. The Maps tab also draws a QUEST
 * PIN LAYER for the quests being tracked (and the one just jumped from), behind one legend chip
 * that toggles it and remembers the choice.
 *
 * WHY A REAL APP. The resolver is unit-tested against the real catalog (tests/questLocations
 * .test.mts). What no unit test can see is the chain: a chip click → the app router's anchored
 * link → a Maps view that has never mounted → the parked jump firing once the map is fetched and
 * the pane measured → the marker landing on the right pixel. And the two lifecycles: the Quests
 * page reopening when Back comes home, and the target surviving the Maps tab's unmount.
 *
 * THE QUEST IS "Hate, Betrayal, and Trust", the brief's own worked example: Rylin Coil is the
 * agreeing case (quest page and bestiary both say (1469, -190)), Corrupted Kedgespawn the
 * disagreeing one ((2662, 1238, -119) on the quest page, (2640, 1226, -120) on his own).
 *
 * FRESH-MACHINE HONESTY: the map packs are a game install, junctioned in when this machine has
 * one (logFixture `{ maps: true }`). With none, the quest-page half still runs and the Maps half
 * says so and skips — the maps.e2e.mts branch.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts quest-locations`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { ARTIFACTS, buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle, settleGone, waitHydrated } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

const QUEST = 'Hate, Betrayal, and Trust'
/** The app under test, for the window captures. */
let APP: ElectronApplication | null = null
const NAV_QUESTS = '[data-testid="nav-quests"]'
const NAV_LOOT = '[data-testid="nav-loot"]'
const NAV_MAPS = '[data-testid="nav-maps"]'
const SEARCH = '[data-testid="quests-search"]'
const ROW = '[data-testid="quest-row"]'
const PAGE = '[data-testid="quest-page"]'
const TITLE = '[data-testid="quest-page-title"]'
const PIN = '[data-testid="quest-pin"]'
const CHIP = '[data-testid="quest-loc-chip"]'
const step = (i: number): string => `[data-testid="quest-step"][data-step="${String(i)}"] ${CHIP}`
const ITEM_SOURCE = '[data-testid="quest-item-source"]'
const TOOLBAR = '[data-testid="maps-toolbar"]'
const SURFACE = '[data-testid="maps-surface"]'
const ZONE_CHIP = '[data-testid="maps-zone-chip"]'
const TARGET = '[data-testid="maps-target-marker"]'
const BANNER = '[data-testid="maps-target-banner"]'
const DISMISS = '[data-testid="maps-target-dismiss"]'
const BACK = '[data-testid="maps-target-back"]'
const QPIN = '[data-testid="maps-quest-pin"]'
const QTOGGLE = '[data-testid="maps-quest-pins-toggle"]'
const LOC_MARKER = '[data-testid="maps-loc-marker"]'
const LOC_INPUT = '[data-testid="maps-loc-input"]'

interface ChipInfo {
  text: string
  zone: string
  loc: string
  sources: string
}

function chips(page: Page, sel: string): Promise<ChipInfo[]> {
  return page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)].map((el) => ({
        text: (el as HTMLElement).innerText.trim(),
        zone: el.getAttribute('data-zone') ?? '',
        loc: el.getAttribute('data-loc') ?? '',
        sources: el.getAttribute('data-sources') ?? ''
      })),
    sel
  )
}

const zoneOf = (page: Page): Promise<string> =>
  page.evaluate((sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '', ZONE_CHIP)

const attr = (page: Page, sel: string, name: string): Promise<string | null> =>
  page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [sel, name] as const)

const titleOf = (page: Page): Promise<string> =>
  page.evaluate((sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '', TITLE)

/**
 * A PICTURE THAT LANDS from a window that is never shown: `page.screenshot` waits for a frame that
 * never comes (curveSteps.mts measured it), so this asks the browser process for its surface with
 * `capturePage`, after an `invalidate` and a warm-up capture so the surface is the current one.
 */
async function capture(app: ElectronApplication, page: Page, tag: string): Promise<void> {
  const url = page.url()
  const b64 = await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL() === u)
    if (!w) return ''
    w.webContents.invalidate()
    await w.webContents.capturePage()
    await new Promise((r) => setTimeout(r, 400))
    await w.webContents.capturePage()
    await new Promise((r) => setTimeout(r, 400))
    return (await w.webContents.capturePage()).toPNG().toString('base64')
  }, url)
  if (b64 === '') return
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(join(ARTIFACTS, `${tag}.png`), Buffer.from(b64, 'base64'))
  console.log(`artifact: ${join(ARTIFACTS, `${tag}.png`)}`)
}

/**
 * Open the Quests tab and the quest page this spec is about. After a chip has left for the map,
 * the tab REOPENS that page by itself (questResume.ts) — which is the behaviour, so it is accepted.
 */
async function openQuestPage(page: Page, name: string = QUEST): Promise<boolean> {
  await page.click(NAV_QUESTS, { timeout: 30_000 })
  const landed = await page.waitForSelector(`${SEARCH}, ${TITLE}`, { timeout: 60_000 }).then(() => true, () => false)
  if (!check('the Quests tab opens', landed)) return false
  if ((await titleOf(page)) === name) return check(`…already on ${name}, the page a chip last left from`, true)
  await page.fill(SEARCH, name === QUEST ? 'Hate, Betrayal' : name)
  await settle(() => countOf(page, ROW), (n) => n >= 1 && n <= 80, { timeoutMs: 15_000 })
  const clicked = await page.evaluate(
    ([sel, name]) => {
      for (const el of document.querySelectorAll(sel)) {
        if ((el as HTMLElement).innerText.includes(name)) {
          ;(el as HTMLElement).click()
          return true
        }
      }
      return false
    },
    [ROW, name] as const
  )
  if (!check(`the search lists ${name}`, clicked)) return false
  await page.waitForSelector(PAGE, { timeout: 20_000 }).catch(() => undefined)
  const title = await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '', TITLE)
  return check(`…and opens ${name}`, title === name, title)
}

/** What the quest page says about where — the agreeing chip, the disagreeing pair, an item's dropper. */
async function stepQuestPage(page: Page): Promise<void> {
  const rylin = await chips(page, step(3))
  check(
    'step 4 carries ONE chip for Rylin Coil in Ak’Anon at (1469, -190), both witnesses agreeing',
    rylin.length === 1 && rylin[0].zone === 'akanon' && rylin[0].loc === '(1469, -190)' && rylin[0].sources === 'quest+npc',
    JSON.stringify(rylin)
  )
  check('…and its words name who and where', rylin[0]?.text.includes('Rylin Coil') && rylin[0].text.includes("Ak'Anon"), rylin[0]?.text ?? '')
  const kedge = await chips(page, step(1))
  check(
    'step 2 shows BOTH Kedgespawn numbers, each from its own source',
    kedge.length === 2 &&
      kedge.some((c) => c.loc === '(2662, 1238, -119)' && c.sources === 'quest') &&
      kedge.some((c) => c.loc === '(2640, 1226, -120)' && c.sources === 'npc'),
    JSON.stringify(kedge)
  )
  check('the steps that state no place carry no chips', (await countOf(page, step(4))) === 0 && (await countOf(page, step(6))) === 0)
  const items = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-item')), ITEM_SOURCE)
  check('"Where to get it" names the ring’s dropper and nothing for the items nobody drops', JSON.stringify(items) === '["Ancient Signet Ring of House Everling"]', JSON.stringify(items))
  await dumpArtifacts(page, 'quest-page')
  if (APP) await capture(APP, page, 'quest-page-shot')
}

/** Click the Rylin Coil chip: the Maps tab, on Ak'Anon, centred, with the target marker. */
async function stepJump(page: Page): Promise<boolean> {
  await page.click(step(3), { timeout: 15_000 })
  if (!check('the chip opens the Maps tab', await page.waitForSelector(TOOLBAR, { timeout: 30_000 }).then(() => true, () => false))) return false
  const zone = await settle(() => zoneOf(page), (z) => z === 'akanon', { timeoutMs: 30_000 })
  check('…ON AK’ANON', zone === 'akanon', zone)
  const marker = await page.waitForSelector(TARGET, { timeout: 20_000 }).then(() => true, () => false)
  check('…with the target marker drawn', marker)
  check('…at the chip’s point', (await attr(page, TARGET, 'data-loc')) === '(1469, -190)')
  // Centred: the marker settles at the middle of the surface (the parked jump fired after the fit).
  const offset = await settle(
    () =>
      page.evaluate(([t, s]) => {
        const a = document.querySelector(t)?.getBoundingClientRect()
        const b = document.querySelector(s)?.getBoundingClientRect()
        if (!a || !b) return 9999
        return Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2))
      }, [TARGET, SURFACE] as const),
    (d) => d < 24,
    { timeoutMs: 10_000 }
  )
  check('…and the view is centred on it', offset < 24, `${String(Math.round(offset))} px from the centre`)
  const banner = await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText ?? '', BANNER)
  check('the target card names what is there', banner.includes('Rylin Coil') && banner.includes('(1469, -190)'), banner)
  check('the typed /loc crosshair is NOT what a quest jump draws', (await countOf(page, LOC_MARKER)) === 0)
  const pins = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-loc')), QPIN)
  check('the jumped-from quest’s pin is on the quest layer', pins.includes('(1469, -190)'), JSON.stringify(pins))
  await dumpArtifacts(page, 'maps-jump')
  if (APP) await capture(APP, page, 'maps-jump-shot')
  return true
}

/** The typed /loc and the target are two marks; the target survives leaving the tab; Back goes home. */
async function stepLifecycles(page: Page): Promise<void> {
  await page.fill(LOC_INPUT, 'Your Location is 1400.00, -150.00, 0.00', { timeout: 15_000 })
  await page.press(LOC_INPUT, 'Enter', { timeout: 15_000 })
  await settle(() => countOf(page, LOC_MARKER), (n) => n === 1, { timeoutMs: 8_000 })
  check('typing a /loc adds the player’s own crosshair BESIDE the target', (await countOf(page, LOC_MARKER)) === 1 && (await countOf(page, TARGET)) === 1)
  await page.click(NAV_LOOT, { timeout: 15_000 })
  check('leaving for Loot unmounts the Maps tab', await settleGone(page, TOOLBAR, { timeoutMs: 15_000 }))
  await page.click(NAV_MAPS, { timeout: 15_000 })
  await page.waitForSelector(TOOLBAR, { timeout: 30_000 }).catch(() => undefined)
  check('THE TARGET SURVIVES THE TAB SWITCH', await page.waitForSelector(TARGET, { timeout: 15_000 }).then(() => true, () => false))
  await page.click(DISMISS, { timeout: 15_000 })
  check('dismissing clears the target', await settleGone(page, TARGET, { timeoutMs: 8_000 }))
  check('…and leaves the typed /loc alone', (await countOf(page, LOC_MARKER)) === 1)
}

/** Back from the map lands on the quest page; tracking it puts its pins on the map for good. */
async function stepTrackedPins(page: Page): Promise<void> {
  // The last chip left for the map, then the player went to LOOT: that ends the round trip, so the
  // Quests tab opens on its list, not on a page out of nowhere.
  await page.click(NAV_QUESTS, { timeout: 30_000 })
  await page.waitForSelector(`${SEARCH}, ${TITLE}`, { timeout: 30_000 }).catch(() => undefined)
  check('a detour through another tab retires the chip’s round trip (the Quests LIST opens)', (await countOf(page, SEARCH)) === 1 && (await titleOf(page)) === '')
  if (!(await openQuestPage(page))) return
  await page.click(PIN, { timeout: 15_000 })
  await page.click(step(1), { timeout: 15_000 })
  await settle(() => zoneOf(page), (z) => z === 'lakenerius', { timeoutMs: 30_000 })
  check('a chip in Lake Nerius opens Lake Nerius', (await zoneOf(page)) === 'lakenerius')
  const back = await page.waitForSelector(BACK, { timeout: 10_000 }).then(() => true, () => false)
  if (check('the target card offers Back to Quests', back)) {
    await page.click(BACK)
    const reopened = await page.waitForSelector(TITLE, { timeout: 15_000 }).then(() => true, () => false)
    check('BACK LANDS ON THE QUEST PAGE IT LEFT, not the list', reopened)
  }
  await page.click(NAV_MAPS, { timeout: 15_000 })
  await page.waitForSelector(TOOLBAR, { timeout: 30_000 }).catch(() => undefined)
  await page.click(DISMISS, { timeout: 15_000 }).catch(() => undefined)
  await settleGone(page, TARGET, { timeoutMs: 8_000 })
  const pins = await settle(
    () => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => el.getAttribute('data-loc')).sort(), QPIN),
    (p) => p.length >= 3,
    { timeoutMs: 10_000 }
  )
  check(
    'A TRACKED QUEST PINS ITS PLACES with no target at all — Ozval and both Kedgespawn points',
    JSON.stringify(pins) === JSON.stringify(['(201, -97, -7)', '(2640, 1226, -120)', '(2662, 1238, -119)'].sort()),
    JSON.stringify(pins)
  )
  const label = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('title') ?? '', QPIN)
  check('…each pin names the quest and its part', label.includes(QUEST), label)
  await page.click(QTOGGLE)
  check('the legend chip turns the layer off', await settleGone(page, QPIN, { timeoutMs: 8_000 }))
  const stored = await page.evaluate(() => localStorage.getItem('eq.maps.questPins'))
  check('…and remembers it under eq.maps.questPins', stored === 'off', String(stored))
  await page.click(QTOGGLE)
  check('…and back on', (await settle(() => countOf(page, QPIN), (n) => n >= 3, { timeoutMs: 8_000 })) >= 3)
  if (APP) await capture(APP, page, 'maps-quest-pins-shot')
}

/**
 * A point its own map does not hold. The bestiary puts "a visiting priestess" at (-493, 170) in
 * Najena, and the real Najena map does not reach that far (scripts/audit-quest-maps.mts lists it):
 * the jump opens Najena, draws NO marker, and the card says the point is off the map.
 */
async function stepOffMap(page: Page): Promise<void> {
  await page.click(NAV_LOOT, { timeout: 15_000 })
  if (!(await openQuestPage(page, 'The Visiting Priestess'))) return
  const chip = `[data-testid="quest-step"][data-step="0"] ${CHIP}[data-zone="najena"]`
  if (!check('the priestess chip offers a jump to Najena', (await countOf(page, chip)) >= 1)) return
  await page.click(chip, { timeout: 15_000 })
  check('…which opens Najena', (await settle(() => zoneOf(page), (z) => z === 'najena', { timeoutMs: 30_000 })) === 'najena')
  const card = await settle(
    () => page.evaluate(() => (document.querySelector('[data-testid="maps-target-offmap"]') as HTMLElement | null)?.innerText ?? ''),
    (t) => t !== '',
    { timeoutMs: 15_000 }
  )
  check('A POINT OFF ITS OWN MAP IS SAID, NOT DRAWN: the card says so', card.includes('outside the Najena map'), card)
  check('…and no target marker is drawn', await settleGone(page, TARGET, { timeoutMs: 5_000 }))
  if (APP) await capture(APP, page, 'maps-offmap-shot')
}

/** The quest page, then the jump and everything after it (skipped, and said so, with no map packs). */
async function runSteps(page: Page): Promise<void> {
  if (!(await openQuestPage(page))) return
  await stepQuestPage(page)
  const packs = await page.evaluate(() => document.querySelector('[data-testid="nav-maps"]') !== null)
  if (!packs) {
    note('no Maps tab on this build — the jump half is skipped')
    return
  }
  if (!(await stepJump(page))) return
  await stepLifecycles(page)
  await stepTrackedPins(page)
  await stepOffMap(page)
}

async function main(): Promise<void> {
  buildIfStale()
  const userData = makeUserData()
  const log = stageFixture('e2e-maps.log', { maps: true })
  try {
    const app = await launchOnFixture(log, { userData })
    try {
      APP = app.app
      const page = await mainWindow(app.app)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.waitForSelector(NAV_QUESTS, { timeout: 60_000 })
      await waitHydrated(page)
      await runSteps(page)
      check('no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
      if (failures.length) await dumpArtifacts(page, 'quest-locations-FAIL')
    } finally {
      await app.close()
    }
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
