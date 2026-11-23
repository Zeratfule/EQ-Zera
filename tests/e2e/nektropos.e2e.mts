/**
 * Headless Electron integration test for THE CASTLE NEKTROPOS ZONES (GitHub #18).
 *
 * THE REPORT, filed on 1.26.1: "Gear tab does not support loot from the new Nek Castle or Lake
 * zone." 1.27.0 brought the wiki's items and mobs for Castle Nektropos, Lake Nerius and the
 * Nektropos Undercrofts, but the zone table (`src/shared/zones.ts`) still left them out, so the
 * map never opened there and every drop the Zone Loot tab listed for them read `era?`. This spec
 * walks the character INTO the castle and loots there, then reads the three surfaces that answer
 * "what about this zone": Zone Loot, Gear and Maps.
 *
 * THE LINES ARE SYNTHETIC IN CONTENT AND REAL IN SHAPE, and that is said here because the owner's
 * log has never entered these zones. The zone line is `You have entered X.` with X spelled as the
 * client's own zone-name table spells it (`Resources\ZoneNames.txt`: `28^Nektropos Castle`). The
 * corpse loot is the dashed self-loot shape every fixture carries, naming a drop the committed
 * corpus credits to that mob (Checkmate off The Game Master). The CHEST loot is the measured
 * `Reward Chest` shape (engine/crates/eqlog, the owner's Befallen 4 lines) with a castle drop in
 * it; nothing states that a Reward Chest pays Schemer's Guise, and nothing below claims it — the
 * line is there to prove a container's loot is attributed to the zone it was opened in too.
 *
 * WHAT IT CAN STATE EXACTLY. The zone and the drops are this spec's own writing; the roster and
 * the placed count come from the COMMITTED catalog through the pane's own pure functions, so they
 * are facts about bytes in the repo rather than about this machine.
 *
 * FRESH-MACHINE HONESTY: the map PACKS are the game install, junctioned in when this machine has
 * one, and only a client patched since 2026-10-22 ships `maps\nektropos.txt`. Without it the map
 * half is noted and skipped; the Zone Loot and Gear halves never need a pack.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts nektropos`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle, snapshot, waitHydrated } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, type FixtureLog } from './logFixture.mjs'
import { mobRows, paneCounts } from '../../src/renderer/src/features/maps/mobPins'
import { MOB_CATALOG } from '../../src/renderer/src/features/mobs/mobSearch'

/** The client's spelling, which is the log's (see the header). */
const ZONE = 'Nektropos Castle'
const STEM = 'nektropos'
const CORPSE_ITEM = 'Checkmate'
const CORPSE_MOB = 'The Game Master'
const CHEST_ITEM = "Schemer's Guise"

const NAV_ZONELOOT = '[data-testid="nav-zoneloot"]'
const ZL_VIEW = '[data-testid="zoneloot-view"]'
const ZL_ZONE = '[data-testid="zoneloot-zone"]'
const ZL_SEARCH = '[data-testid="zoneloot-search"]'
const ZL_ROW = '[data-testid="zoneloot-row"]'
const ZL_FOOTER = '[data-testid="zoneloot-footer"]'

const NAV_GEAR = '[data-testid="nav-gear"]'
const GEAR_TAB = '[data-testid="tab-gear"]'
const GEAR_VIEW = '[data-testid="gear-view"]'
const GEAR_SEARCH = '[data-testid="gear-search"] input'
const GEAR_ERA_TOGGLE = '[data-testid="gear-era-toggle"]'

const NAV_MAPS = '[data-testid="nav-maps"]'
const MAPS_TOOLBAR = '[data-testid="maps-toolbar"]'
const MAPS_CHIP = '[data-testid="maps-zone-chip"]'
const MAPS_COUNTS = '[data-testid="maps-pane-counts"]'
const MAPS_PIN = '[data-testid="maps-mob-pin"]'

const until = (fn: () => Promise<boolean>, ms: number): Promise<boolean> => settle(fn, (ok) => ok, { timeoutMs: ms })

/** Rendered text of the first match, whitespace collapsed; '' when the node isn't mounted. */
async function textOf(page: Page, sel: string): Promise<string> {
  const raw = await page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
  return raw.replace(/\s+/g, ' ').trim()
}

function appears(page: Page, sel: string, ms = 30_000): Promise<boolean> {
  return page.waitForSelector(sel, { timeout: ms }).then(
    () => true,
    () => false
  )
}

/** 1. Walk in and loot — and wait until the APP has taken the zone, not just the file. */
async function stepEnterAndLoot(page: Page, log: FixtureLog): Promise<boolean> {
  const at = new Date()
  log.appendAt(
    at,
    `You have entered ${ZONE}.`,
    `--You have looted a ${CORPSE_ITEM} from ${CORPSE_MOB}'s corpse.--`,
    `--You have looted a ${CHEST_ITEM} from Reward Chest.--`
  )
  const zone = await settle(async () => (await snapshot(page)).zone, (z) => z === ZONE, { timeoutMs: 30_000 })
  return check(`the log line puts the character in ${ZONE}`, zone === ZONE, String(zone))
}

/** A zone-loot row as its five cells (mob, item, era, yours, rate); [] when it never mounts. */
type RowCells = string[]

function rowCells(page: Page, item: string): Promise<RowCells[]> {
  return page.evaluate(
    ([sel, name]) =>
      [...document.querySelectorAll(sel)]
        .map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\s+/g, ' ').trim()))
        .filter((cells) => cells[1] === name),
    [ZL_ROW, item] as const
  )
}

/** The row for `item` off `mob`, found through the tab's own search. */
async function zoneLootRow(page: Page, item: string, mob: string): Promise<RowCells> {
  await page.fill(ZL_SEARCH, item.toLowerCase(), { timeout: 15_000 })
  let row: RowCells = []
  await until(async () => {
    row = (await rowCells(page, item)).find((cells) => cells[0].startsWith(mob)) ?? []
    return row.length > 0
  }, 15_000)
  return row
}

/** 2. Zone Loot opens where you stand, lists the castle, and credits your loot to it. */
async function stepZoneLoot(page: Page): Promise<void> {
  await page.click(NAV_ZONELOOT, { timeout: 15_000 })
  if (!check('the Zone Loot tab opens', await appears(page, ZL_VIEW))) return
  const picked = await settle(() => page.inputValue(ZL_ZONE), (v) => v === ZONE, { timeoutMs: 15_000 })
  check(`…on the zone the character is standing in (${ZONE})`, picked === ZONE, picked)
  const footer = await settle(() => textOf(page, ZL_FOOTER), (t) => /\d+ drops/.test(t), { timeoutMs: 15_000 })
  check('…with the castle`s drop table on it', /\b\d{2,} drops/.test(footer), footer)

  const corpse = await zoneLootRow(page, CORPSE_ITEM, CORPSE_MOB)
  check(`${CORPSE_ITEM} is listed off ${CORPSE_MOB}`, corpse.length === 5, corpse.join(' | '))
  check('…and YOUR loot of it in this zone is counted (Yours = 1)', corpse[3] === '1', corpse.join(' | '))
  check('…and it reads in era: the Era cell is empty, no era? chip (zones.ts section 5)', corpse[2] === '', corpse.join(' | '))

  const chest = await zoneLootRow(page, CHEST_ITEM, CORPSE_MOB)
  check(`the Reward Chest loot (${CHEST_ITEM}) is credited to the zone too (Yours = 1)`, chest[3] === '1', chest.join(' | '))
  await page.fill(ZL_SEARCH, '', { timeout: 15_000 })
}

/** 3. Gear: the castle drop is in the table under the default Current era filter, and reads Looted. */
async function stepGear(page: Page): Promise<void> {
  await page.click(NAV_GEAR, { timeout: 15_000 })
  if (await until(async () => (await countOf(page, GEAR_TAB)) > 0, 30_000)) await page.click(GEAR_TAB, { timeout: 15_000 })
  if (!check('the Gear table mounts', await appears(page, GEAR_VIEW))) return
  check('…with its Current era toggle on screen (ON is the shipped default)', (await countOf(page, GEAR_ERA_TOGGLE)) === 1)
  await page.fill(GEAR_SEARCH, CORPSE_ITEM.toLowerCase(), { timeout: 15_000 })
  const key = CORPSE_ITEM.toLowerCase()
  const row = `[data-testid="gear-row"][data-item-key="${key}"]`
  check(`${CORPSE_ITEM} is a Gear row with the Current era filter on`, await until(async () => (await countOf(page, row)) === 1, 20_000))
  const owned = `${row} [data-testid="gear-cell-owned"]`
  const looted = await until(async () => (await textOf(page, owned)) === 'Looted', 30_000)
  check('…and the loot you just took in the castle reads Looted', looted, await textOf(page, owned))
}

/** 4. Maps: the zone line opens the game's castle map, and the wiki's mobs pin on it. */
async function stepMaps(page: Page, log: FixtureLog): Promise<void> {
  if (!existsSync(join(log.installDir, 'maps', `${STEM}.txt`))) {
    note(`this machine's EQ install has no maps\\${STEM}.txt (unpatched or no install) — the map half is skipped`)
    return
  }
  await page.click(NAV_MAPS, { timeout: 15_000 })
  if (!check('the Maps tab opens', await appears(page, MAPS_TOOLBAR, 60_000))) return
  const stem = await settle(() => textOf(page, MAPS_CHIP), (z) => z === STEM, { timeoutMs: 30_000 })
  check(`the map follows the character to ${STEM}`, stem === STEM, stem)
  const want = paneCounts(mobRows(ZONE, MOB_CATALOG), [])
  const label = `${String(want.located)}/${String(want.mobs)} placed`
  const counts = await settle(() => textOf(page, MAPS_COUNTS), (t) => t === label, { timeoutMs: 20_000 })
  check(`the zone pane lists the catalog's castle mobs (${label})`, counts === label, counts)
  check('…and pins them on the map', (await countOf(page, MAPS_PIN)) > 0)
}

async function main(): Promise<void> {
  buildIfStale()
  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-maps.log…')
  const { app, log, close } = await launchOnFixture('e2e-maps.log', { maps: true })
  try {
    const page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
    await page.waitForSelector(NAV_MAPS, { timeout: 60_000 })
    await waitHydrated(page)
    if (await stepEnterAndLoot(page, log)) {
      await stepZoneLoot(page)
      await stepGear(page)
      await stepMaps(page, log)
    }
    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    await dumpArtifacts(page, failures.length ? 'nektropos-FAIL' : 'nektropos-pass')
  } finally {
    await close()
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
