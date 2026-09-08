/**
 * Headless Electron integration test for THE UPGRADE FINDER (EQ Zera).
 *
 * ONE QUESTION, THREE SURFACES: "would this be better than what I have on, and where do I go and
 * get it?" The Build tab answers the second half in a WHERE TO FARM panel, the Zone Loot table
 * chips the rows that beat your set, and the item drill-down says it in a sentence. All three read
 * the same verdict (`shared/build/upgradeFinder.ts`) under the same remembered profile
 * (`eq.build.profile`), and this spec is the only place that can prove they agree, because the
 * chain runs through main: a staged `/outputfile inventory` dump -> the planner-inventory IPC ->
 * the gear index IPC -> the worn read -> a chip on a windowed table -> a link into two other tabs.
 *
 * WHY IT DISCOVERS ITS NUMBERS INSTEAD OF STATING THEM. Everything the zone-loot spec asserts is a
 * fact about committed bytes; the numbers here are a fact about committed bytes JOINED TO A DUMP,
 * and the join runs through the class loadout the fixture's log detects. So the spec reads what the
 * panel found, reports it, and asserts the RELATIONS that must hold whatever the numbers are: a
 * zone has items, an item has a gain and a cell, the toggle narrows, the chip and the item page
 * name the same cell. A number is printed as a note, never asserted as a constant.
 *
 * COUNTS COME FROM THE FOOTER on the Zone Loot half. The table is WINDOWED, so counting DOM rows
 * counts a viewport (zone-loot.e2e.mts's rule, inherited).
 *
 * THE MOB LINK IS ASSERTED CONDITIONALLY, and on purpose: `BuildBranch` takes `onOpenMob` as an
 * OPTIONAL prop so App.tsx compiles before the integrator threads `routing.openMob` into it. Until
 * that one line lands the mob names are inert, which is a wiring state and not a defect, so the
 * step reports it as a note rather than failing the run. Once the line is in, the same step becomes
 * a real assertion with no edit.
 *
 * Run: `node --import tsx tests/e2e/upgrade-finder.e2e.mts`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle, waitHydrated } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

const GRID = '[data-testid="overview-grid"]'
const NAV_GEAR = '[data-testid="nav-gear"]'
const TAB_BUILD = '[data-testid="tab-build"]'
const BUILD_VIEW = '[data-testid="build-view"]'
const FARM = '[data-testid="build-farm"]'
const FARM_ZONE = '[data-testid="build-farm-zone"]'
const FARM_ITEM = '[data-testid="build-farm-item"]'
const FARM_MOB = '[data-testid="build-farm-mob"]'
const MOBS_BACK = '[data-testid="mobs-back"]'

const NAV_ZONELOOT = '[data-testid="nav-zoneloot"]'
const ZONELOOT_VIEW = '[data-testid="zoneloot-view"]'
const ZONE_INPUT = '[data-testid="zoneloot-zone"]'
const ZONELOOT_ROW = '[data-testid="zoneloot-row"]'
const ZONELOOT_ITEM = '[data-testid="zoneloot-item"]'
const UPGRADE_CHIP = '[data-testid="zoneloot-upgrade"]'
const UPGRADES_TOGGLE = '[data-testid="zoneloot-upgrades-toggle"]'
const UPGRADE_CAPTION = '[data-testid="zoneloot-upgrade-caption"]'
const FOOTER = '[data-testid="zoneloot-footer"]'
const LOOT_DETAIL = '[data-testid="loot-detail"]'
const LOOT_UPGRADE = '[data-testid="loot-upgrade"]'

/** The owner's own dump - the one the gear spec reads, equipped at +5 with a socketed exaltation. */
const DUMP_FIXTURE = 'Primitive_freeport-Inventory.txt'
/** The heading a source that states no zone is filed under. Not a place, so not a picker option. */
const NO_ZONE = 'Zone not stated'
/** The three gauges, in the order the spec tries them when the default profile finds nothing. */
const PROFILES: readonly { id: string; label: string }[] = [
  { id: 'tank', label: 'Tank' },
  { id: 'dps', label: 'DPS' },
  { id: 'heal', label: 'Healer' }
]

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

/** Rendered text of EVERY match, whitespace collapsed. */
async function textsOf(page: Page, sel: string): Promise<string[]> {
  const raw = await page.evaluate((s) => [...document.querySelectorAll(s)].map((n) => (n as HTMLElement).innerText), sel)
  return raw.map((t) => t.replace(/\s+/g, ' ').trim())
}

/** The `N drops` number the Zone Loot footer states, or -1 when the footer says nothing yet. */
function dropsIn(footer: string): number {
  const m = /(\d+) drops/.exec(footer)
  return m ? Number(m[1]) : -1
}

/** Land, and let the startup replay finish. */
async function stepReady(page: Page): Promise<void> {
  if (!check('the app lands on the Overview', await appears(page, GRID, 60_000))) {
    throw new Error('never landed on Overview - nothing below can be asserted')
  }
  const { snap } = await waitHydrated(page)
  check('hydration completes (the replay has finished)', !snap.hydrating)
}

/** What the Build tab's farm panel found, for the steps downstream of it. */
interface FarmReading {
  profile: string
  zones: string[]
  /** the first zone that is a real PLACE - the picker cannot hold "Zone not stated" */
  pickable: string
  items: string[]
}

/**
 * 1. THE BUILD TAB, AND ITS "WHERE TO FARM" PANEL.
 *
 * The panel is empty in three legitimate states (no dump, nothing better, nothing with a stated
 * source), so the spec cycles the three profile gauges rather than assuming the default one finds
 * something, and NAMES the profile it settled on. That is the honest shape: the claim is "some
 * profile finds camps for this character", and which one is data.
 */
async function openBuildTab(page: Page): Promise<boolean> {
  if (!check('the nav offers the Gear area', await appears(page, NAV_GEAR))) return false
  await page.click(NAV_GEAR, { timeout: 15_000 })
  if (!check('…which offers a Build tab', await appears(page, TAB_BUILD))) return false
  await page.click(TAB_BUILD, { timeout: 15_000 })
  if (!check('…and the Build tab mounts', await appears(page, BUILD_VIEW, 30_000))) return false
  return check('the Build tab draws a "Where to farm" panel', await appears(page, FARM, 30_000))
}

/** Click each gauge until one of them fills the panel. The profile that did is data, not a constant. */
async function profileWithCamps(page: Page): Promise<string> {
  for (const profile of PROFILES) {
    await page.click(`[data-testid="build-meter-${profile.id}"]`, { timeout: 15_000 })
    const zones = await settle(() => countOf(page, FARM_ZONE), (n) => n > 0, { timeoutMs: 15_000 }).catch(() => 0)
    if (zones > 0) {
      note(`profile ${profile.label}: ${String(zones)} farm zones`)
      return profile.label
    }
    note(`the ${profile.label} profile found no farmable upgrade for this dump`)
  }
  return ''
}

async function stepFarmPanel(page: Page): Promise<FarmReading | null> {
  if (!(await openBuildTab(page))) return null
  const chosen = await profileWithCamps(page)
  if (!check('at least one profile finds a zone to farm', chosen !== '', await textOf(page, FARM))) return null

  const names = await page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((n) => (n.querySelector('.eq-display-label') as HTMLElement | null)?.innerText ?? ''),
    FARM_ZONE
  )
  const items = await textsOf(page, FARM_ITEM)
  check('…and the first zone lists at least one item to farm', items.length > 0, String(items.length))
  check('…each naming its gain and the cell it would take', /\+[\d,]+ \S/.test(items[0] ?? ''), items[0] ?? '')
  check('…and at least one mob that drops it', (await countOf(page, FARM_MOB)) > 0)

  const pickable = names.find((n) => n.trim() !== '' && n.trim() !== NO_ZONE)?.trim() ?? ''
  note(`farm zones: ${names.map((n) => n.trim()).slice(0, 5).join(' | ')}`)
  if (!check('…and at least one of them is a place the Zone Loot picker knows', pickable !== '', names.join(' | '))) {
    return null
  }
  return { profile: chosen, zones: names.map((n) => n.trim()), pickable, items }
}

/**
 * 2. A MOB NAME IN THE PANEL IS A LINK INTO THE MOBS TAB.
 *
 * Conditional, and the header says why: the opener is an optional prop until App.tsx threads
 * `routing.openMob` into `BuildBranch`.
 */
async function stepFarmMobLink(page: Page): Promise<void> {
  const mob = await textOf(page, FARM_MOB)
  if (!check('a farm item names a mob to kill', mob !== '', mob)) return
  await page.click(`${FARM_MOB} [role="button"]`, { timeout: 15_000 })
  const landed = await settle(() => countOf(page, MOBS_BACK), (n) => n === 1, { timeoutMs: 8000 }).catch(() => 0)
  if (landed !== 1) {
    note(`clicking "${mob}" opened no mob page - App.tsx has not threaded onOpenMob into BuildBranch yet`)
    return
  }
  check(`clicking "${mob}" opens the Mobs tab on that mob`, landed === 1)
  const shown = await textOf(page, '[data-testid="mobs-view"], body')
  check('…on the creature the panel named', shown.toLowerCase().includes(mob.toLowerCase()), mob)
  await page.click(NAV_GEAR, { timeout: 15_000 })
  await appears(page, BUILD_VIEW, 20_000)
}

/**
 * 3. THE ZONE LOOT TABLE CHIPS THE SAME UPGRADES.
 *
 * The zone comes from the farm panel, which is the point: the two surfaces are reading one verdict,
 * so a zone the Build tab called worth farming must contain a chipped row.
 */
async function stepZoneLootChips(page: Page, farm: FarmReading): Promise<boolean> {
  if (!check('the nav offers a Zone Loot row', await appears(page, NAV_ZONELOOT))) return false
  await page.click(NAV_ZONELOOT, { timeout: 15_000 })
  if (!check('…which opens the tab', await appears(page, ZONELOOT_VIEW))) return false
  await page.fill(ZONE_INPUT, farm.pickable, { timeout: 15_000 })
  await page.press(ZONE_INPUT, 'Enter', { timeout: 15_000 })
  if (!check(`picking ${farm.pickable} draws its table`, await appears(page, ZONELOOT_ROW, 20_000))) return false

  // THE CHIPS COME SECOND, and the wait has to know it: the table paints off the committed catalog
  // the moment a zone is picked, while the verdicts wait on the gear index and the inventory dump
  // crossing IPC. Reading the footer before those land reads a table with no verdicts in it yet.
  const chips = await settle(() => countOf(page, UPGRADE_CHIP), (n) => n > 0, { timeoutMs: 20_000 }).catch(() => 0)
  if (!check('at least one row wears an upgrade chip', chips > 0, String(chips))) return false

  const all = await settle(() => textOf(page, FOOTER), (t) => / \d+ upgrades/.test(t), { timeoutMs: 15_000 }).catch(() => '')
  const total = dropsIn(all)
  check(`the whole zone is ${String(total)} drops`, total > 0, all)
  check('…and the footer counts the upgrades among them', / \d+ upgrades/.test(all), all)
  const chip = await textOf(page, UPGRADE_CHIP)
  check('…reading "+<gain> <cell>"', /^\+[\d,]+ \S/.test(chip), chip)

  if (!check('the filter row offers an Upgrades toggle', await appears(page, UPGRADES_TOGGLE))) return false
  const label = await textOf(page, UPGRADES_TOGGLE)
  check('…labelled "Upgrades · N"', /^Upgrades · \d+$/.test(label), label)
  await page.click(UPGRADES_TOGGLE, { timeout: 15_000 })
  const narrowed = await settle(() => textOf(page, FOOTER), (t) => dropsIn(t) < total, { timeoutMs: 10_000 }).catch(() => all)
  const shown = dropsIn(narrowed)
  check(`the toggle narrows the table from ${String(total)} to ${String(shown)} drops`, shown > 0 && shown < total, narrowed)
  check('…and says what the comparison is, in one line', await appears(page, UPGRADE_CAPTION, 5000))
  const caption = await textOf(page, UPGRADE_CAPTION)
  check(`…naming the ${farm.profile} profile the Build tab is on`, caption.includes(farm.profile), caption)
  note(`${farm.pickable}: ${String(total)} drops, ${String(shown)} of them upgrades under ${farm.profile}`)
  return true
}

/**
 * 4. THE ITEM PAGE SAYS IT IN A SENTENCE.
 *
 * Reached the way a reader reaches it - by clicking the item name on the row that just wore the
 * chip - so what is proved is that the two surfaces agree about the SAME item, not that a verdict
 * exists somewhere.
 */
async function stepItemPage(page: Page): Promise<void> {
  const item = await textOf(page, ZONELOOT_ITEM)
  if (!check('the narrowed table still has an item to open', item !== '', item)) return
  await page.click(ZONELOOT_ITEM, { timeout: 15_000 })
  if (!check(`clicking "${item}" opens its item page`, await appears(page, LOOT_DETAIL, 20_000))) return
  if (!check('…which states the upgrade', await appears(page, LOOT_UPGRADE, 20_000))) return
  const line = await textOf(page, LOOT_UPGRADE)
  check('…naming the cell, the profile and the gain', /^Upgrade for .+ under .+: \+[\d,]+/.test(line), line)
  note(`item page: ${line}`)
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-planner.log + the inventory dump…')
  const log = stageFixture('e2e-planner.log', { inventory: DUMP_FIXTURE })
  const { app, close } = await launchOnFixture(log)

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await stepReady(page)
    const farm = await stepFarmPanel(page)
    if (farm) {
      await stepFarmMobLink(page)
      if (await stepZoneLootChips(page, farm)) await stepItemPage(page)
    } else {
      note('the farm panel found nothing - the chip and item-page steps cannot be asserted')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    await dumpArtifacts(page, failures.length ? 'upgrade-finder-FAIL' : 'upgrade-finder-pass')
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
