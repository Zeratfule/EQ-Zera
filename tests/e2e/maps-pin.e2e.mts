/**
 * Headless Electron integration test for A PINNED MAP (JOS-97).
 *
 * THE BUG, in the reporter's words: "Would be nice to keep selected map when you move off of the
 * tab (seems to reset if I move to the loot tab as an example)."
 *
 * WHY THIS HAS TO BE A REAL APP. The rules are unit-tested without a browser
 * (tests/mapZoneFollow.test.mts) and a test of THOSE would have passed while the feature stayed
 * broken, because neither mechanism lived in the rules. One was the LIFECYCLE — `App` mounts
 * exactly one feature view at a time, so leaving the Maps tab destroys `useZoneSelection` and
 * returning rebuilt it from localStorage only to have its first effect overwrite the restore with
 * the character's zone — and the other was a LIVE ZONE LINE arriving from the tailed log. So every
 * assertion here is bracketed by a real navigation or a real line appended to the log the app is
 * tailing, and the trip out asserts the toolbar is GONE first: an unmount that never happened
 * would make the rest of this spec a tautology (the JOS-90 sky-filters discipline, exactly).
 *
 * THE APPENDED ZONES ARE REAL NAMES. `logFixture`'s append driver writes whole EQ-stamped lines
 * into the staged copy of tests/fixtures/e2e-maps.log, so `You have entered East Freeport.`
 * travels chokidar → Tailer → parser → the character module → IPC → this view, the same path the
 * game's own line takes. Both names are rows in the hand-authored zone table (`freporte`,
 * `gfaydark`), which is what lets the assertions state a STEM instead of a hope.
 *
 * AND THE "NO SNAP" ASSERTION IS AN ABSENCE, so it is asserted the only honest way: wait for the
 * appended zone to actually reach the app (the combat snapshot states it), THEN require the map's
 * zone chip to have stopped changing and still say what it said.
 *
 * TWO LAUNCHES, ONE userData DIR AND ONE STAGED LOG — the pin has to outlive the process too, and
 * launch 2 tails the same file launch 1 wrote into, so its replay ends in the zone launch 1 last
 * appended. That makes the restart assertion sharp: the character IS somewhere else, and the map
 * still opens where the user left it.
 *
 * FRESH-MACHINE HONESTY: the map PACKS are a 200 MB game install, junctioned in when this machine
 * has one. With no packs the zone corpus is empty, there is nothing to pick, and this spec says so
 * and skips — the same branch maps.e2e.mts has always had.
 *
 * Run: `npm run test:e2e -- maps-pin`.
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleGone,
  settleStable,
  snapshot,
  waitHydrated
} from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const NAV_MAPS = '[data-testid="nav-maps"]'
const NAV_LOOT = '[data-testid="nav-loot"]'
const TOOLBAR = '[data-testid="maps-toolbar"]'
/** States which rule is choosing the map. `data-mode` is the state itself, not its wording. */
const MODE = '[data-testid="maps-zone-mode"]'
/** The way back to following the log — rendered only in the mode where it does something. */
const CURRENT = '[data-testid="maps-zone-current"]'
/** The stem of the map on screen, as the header states it. */
const ZONE_CHIP = '[data-testid="maps-zone-chip"]'
const ZONE_FILTER = '[data-testid="maps-zone-filter"]'
const ZONE_ROW = '[data-testid="maps-zone-row"]'

/** The two keys the viewer remembers, read back so the spec pins the NAMES as well as the round
 *  trip: a rename that kept this spec green would still drop every existing user's saved map. */
const ZONE_KEY = 'eq.maps.zone'
const MODE_KEY = 'eq.maps.zoneMode'

/** Which mode the toolbar says is in force; `null` when the chip is not mounted. */
function modeOf(page: Page): Promise<string | null> {
  return page.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute('data-mode') ?? null,
    MODE
  )
}

/** The stem on screen; `''` when no map is open. */
function zoneOf(page: Page): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '',
    ZONE_CHIP
  )
}

/** What the renderer has actually stored, verbatim. */
function storedOf(page: Page): Promise<{ zone: string | null; mode: string | null }> {
  return page.evaluate(
    (keys) => ({ zone: localStorage.getItem(keys[0]), mode: localStorage.getItem(keys[1]) }),
    [ZONE_KEY, MODE_KEY]
  )
}

/** Open the Maps tab and wait for its toolbar. Safe when Maps is already the open view. */
async function openMaps(page: Page, timeoutMs = 60_000): Promise<boolean> {
  await page.click(NAV_MAPS, { timeout: 30_000 })
  return page.waitForSelector(TOOLBAR, { timeout: timeoutMs }).then(
    () => true,
    () => false
  )
}

/**
 * Leave for the LOOT tab — the reporter's own example — and confirm the Maps view is really gone.
 * The assertion after this means nothing unless `useZoneSelection` was actually destroyed here.
 */
async function leaveMaps(page: Page): Promise<boolean> {
  await page.click(NAV_LOOT, { timeout: 30_000 })
  return settleGone(page, TOOLBAR, { timeoutMs: 15_000 })
}

/** Away to Loot, back to Maps. Returns the stem the viewer came back holding. */
async function roundTrip(page: Page): Promise<string | null> {
  if (!check('leaving the Maps tab for Loot unmounts it (the toolbar is gone)', await leaveMaps(page))) {
    return null
  }
  if (!check('…and the Maps tab comes back', await openMaps(page))) return null
  return settle(() => zoneOf(page), (z) => z !== '', { timeoutMs: 15_000 })
}

/**
 * Pick a zone from the selector that is NOT the one on screen, and return its stem.
 *
 * The corpus is whatever this machine's packs provide, so the spec never names a map file: it
 * opens the list, reads the stems it is actually offered (each row states the long name and the
 * stem under it) and takes the first that differs from the map already open. `null` means the
 * corpus is empty or holds only the current zone — a real machine state, noted and skipped.
 */
async function pickOtherZone(page: Page, current: string): Promise<string | null> {
  await page.click(ZONE_FILTER, { timeout: 15_000 })
  const rows = await page.$$(ZONE_ROW)
  for (const row of rows) {
    const stem = await row.evaluate((el) => (el as HTMLElement).innerText.trim().split('\n').pop()?.trim() ?? '')
    if (stem === '' || stem === current) continue
    await row.click({ timeout: 15_000 })
    return settle(() => zoneOf(page), (z) => z === stem, { timeoutMs: 20_000 }).then((z) =>
      z === stem ? stem : null
    )
  }
  await page.keyboard.press('Escape')
  return null
}

/** Append a zone line and wait for the APP to have taken it — the engine states the zone it is in. */
async function enterZone(page: Page, log: FixtureLog, zone: string): Promise<boolean> {
  log.append(`You have entered ${zone}.`)
  const seen = await settle(async () => (await snapshot(page)).zone, (z) => z === zone, {
    timeoutMs: 30_000
  })
  return seen === zone
}

/** A fresh install follows the character — today's behaviour, unchanged for anyone who never pins. */
async function stepDefault(page: Page, autoZone: string): Promise<void> {
  check('a fresh install opens the Maps tab FOLLOWING the character', (await modeOf(page)) === 'follow')
  check('…and states so exactly once', (await countOf(page, MODE)) === 1)
  check('…with no Current zone button, because following is already what it is doing', (await countOf(page, CURRENT)) === 0)
  check(
    'the map on screen is the zone the log says you are in',
    autoZone !== '',
    `stem "${autoZone}"`
  )
}

/** THE HEADLINE: pick a map, leave for Loot, come back — it is still that map. */
async function stepPinSurvivesTabs(page: Page, picked: string): Promise<void> {
  check('picking a zone PINS it', (await modeOf(page)) === 'pinned')
  const stored = await settle(() => storedOf(page), (s) => s.mode === 'pinned', { timeoutMs: 8000 })
  check(
    `the pin is stored under ${MODE_KEY} beside the stem in ${ZONE_KEY}`,
    stored.mode === 'pinned' && stored.zone === picked,
    `stored ${JSON.stringify(stored)}`
  )
  check('…and the way back is now on screen', (await countOf(page, CURRENT)) === 1)

  const after = await roundTrip(page)
  check('THE PICKED MAP SURVIVES LEAVING AND RETURNING TO THE TAB', after === picked, `${String(after)} vs ${picked}`)
  check('…and it comes back still pinned, not merely restored', (await modeOf(page)) === 'pinned')
}

/** A zone line arriving while pinned moves the character — and nothing else. */
async function stepPinnedIgnoresZoning(page: Page, log: FixtureLog, picked: string): Promise<void> {
  if (!check('the log states a new zone (East Freeport) while a map is pinned', await enterZone(page, log, 'East Freeport'))) {
    return
  }
  // An ABSENCE: wait for the reading to stop changing, THEN require it to be what it was.
  const settled = await settleStable(() => zoneOf(page), { timeoutMs: 8000 })
  check('A PINNED MAP DOES NOT SNAP TO THE ZONE YOU JUST WALKED INTO', settled === picked, `${String(settled)} vs ${picked}`)
  check('…and the toolbar still says so', (await modeOf(page)) === 'pinned')
}

/** Current zone: snap there now, and follow from now on. Both halves, in that order. */
async function stepCurrentZoneResumes(page: Page, log: FixtureLog): Promise<void> {
  await page.click(CURRENT, { timeout: 15_000 })
  const snapped = await settle(() => zoneOf(page), (z) => z === 'freporte', { timeoutMs: 20_000 })
  check('CURRENT ZONE SNAPS TO THE ZONE THE CHARACTER IS IN', snapped === 'freporte', String(snapped))
  check('…and hands the choice back to the log', (await modeOf(page)) === 'follow')
  check('…with the button gone, because there is no pin left to end', (await countOf(page, CURRENT)) === 0)
  const stored = await settle(() => storedOf(page), (s) => s.mode === 'follow', { timeoutMs: 8000 })
  check(`the resumed follow is stored too, not merely un-pinned`, stored.mode === 'follow', JSON.stringify(stored))

  if (!check('the log states another zone (The Greater Faydark)', await enterZone(page, log, 'The Greater Faydark'))) {
    return
  }
  const moved = await settle(() => zoneOf(page), (z) => z === 'gfaydark', { timeoutMs: 20_000 })
  check('…AND THE NEXT ZONE LINE MOVES THE MAP AGAIN', moved === 'gfaydark', String(moved))
}

/** THE RESTART: a second process, the same userData dir and the same log — the pin is still there. */
async function stepSurvivesRestart(page: Page, pinned: string): Promise<void> {
  if (!check('the Maps tab opens after a restart', await openMaps(page))) return
  const zone = await settle(() => zoneOf(page), (z) => z !== '', { timeoutMs: 20_000 })
  check('THE PINNED MAP SURVIVES A FULL RESTART', zone === pinned, `${String(zone)} vs ${pinned}`)
  check('…and it is still pinned, so the next zone line will not take it either', (await modeOf(page)) === 'pinned')
  const stored = await storedOf(page)
  check(
    '…and the stored pair crossed the process boundary intact',
    stored.zone === pinned && stored.mode === 'pinned',
    JSON.stringify(stored)
  )
  // The character is NOT where the map is — launch 1 left the log in The Greater Faydark — which
  // is what makes the assertion above about the pin rather than about a coincidence.
  const snap = await snapshot(page)
  note(`the replayed log leaves the character in "${snap.zone ?? '(none)'}" while the map holds "${pinned}"`)
}

/** Everything launch 1 asserts. Returns the stem left pinned for launch 2, or null when skipped. */
async function firstLaunch(page: Page, log: FixtureLog): Promise<string | null> {
  if (!check('the Maps tab opens', await openMaps(page))) return null
  await waitHydrated(page)
  const autoZone = await settle(() => zoneOf(page), (z) => z !== '', { timeoutMs: 30_000 })
  await stepDefault(page, autoZone)

  const picked = await pickOtherZone(page, autoZone)
  if (picked == null) {
    note('this machine offers no second zone to pick (no EQ map packs) — the pin assertions are skipped')
    return null
  }
  note(`picked "${picked}" while the log says the character is in "${autoZone}"`)
  await stepPinSurvivesTabs(page, picked)
  await stepPinnedIgnoresZoning(page, log, picked)
  await stepCurrentZoneResumes(page, log)

  // Arm the restart: pin something that is NOT where the character now stands.
  const armed = await pickOtherZone(page, await zoneOf(page))
  if (armed == null) return null
  check('a zone is pinned for the restart check', (await modeOf(page)) === 'pinned', String(armed))
  return armed
}

/** Launch 2: a new process on the dir and the log launch 1 left behind. */
async function secondLaunch(log: FixtureLog, userData: string, pinned: string): Promise<void> {
  console.log('launch 2: the SAME userData dir and the SAME log, a new process…')
  const second = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(second.app)
    await page.waitForSelector(NAV_MAPS, { timeout: 60_000 })
    await stepSurvivesRestart(page, pinned)
    if (failures.length) await dumpArtifacts(page, 'maps-pin-restart-FAIL')
  } finally {
    await second.close()
  }
}

async function main(): Promise<void> {
  buildIfStale()

  // OWNED BY THIS SPEC, both of them: the restart assertion IS the dir and the log outliving a
  // process, so neither launch may take them away.
  const userData = makeUserData()
  const log = stageFixture('e2e-maps.log', { maps: true })
  try {
    console.log('launch 1: default, pick, tab round trip, live zone lines, Current zone…')
    const first = await launchOnFixture(log, { userData })
    let pinned: string | null = null
    let page: Page | null = null
    try {
      page = await mainWindow(first.app)
      const consoleErrors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text())
      })
      page.on('pageerror', (e) => consoleErrors.push(String(e)))
      await page.waitForSelector(NAV_MAPS, { timeout: 60_000 })
      pinned = await firstLaunch(page, log)
      check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
      if (failures.length) await dumpArtifacts(page, 'maps-pin-FAIL')
    } finally {
      await first.close()
    }

    if (pinned == null) note('nothing was pinned in launch 1 — the restart half has no subject and is skipped')
    else await secondLaunch(log, userData, pinned)
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
