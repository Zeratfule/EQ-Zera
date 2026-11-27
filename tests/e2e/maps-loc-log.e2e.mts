/**
 * Headless Electron integration test for the LOGGED /loc marker (2026-11-27).
 *
 * THE ASK, in the owner's words: "if we do a /loc then lets have the app map show our location".
 * EverQuest Legends writes the answer to the log — measured in the owner's real log:
 * `[Fri Nov 27 16:44:57 2026] Your Location is 218.95, 91.12, 17.90` — so the harness PLAYS that
 * line into the staged log and asserts what the user sees, end to end through the real engine:
 *
 *   1. BACKFILL PLACES NOTHING. A /loc already in the log when the app starts (stamped after the
 *      fixture's last zone line, so it is "in the current zone" by every rule but recency) is the
 *      position of a session that is over. No marker.
 *   2. A LIVE /loc PLACES ONE, on the map that is drawn, labelled with the minute it was read, and
 *      it is NOT written into the pasted-marker store.
 *   3. CHAT CANNOT SPOOF IT. A tell and a say quoting the sentence ride the same burst as a second
 *      real reading, AFTER it — if either claimed, the settled marker would be the spoof's.
 *   4. IT SURVIVES A TAB ROUND TRIP (the view unmounts; the reading is the engine's).
 *   5. ZONING DROPS IT. A `You have entered` line takes the marker and its chip away.
 *
 * Fresh-machine honesty: with no map packs no map draws, and this spec says so and skips, the same
 * branch maps-loc.e2e.mts has.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts maps-loc-log`.
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
  waitHydrated
} from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const NAV_MAPS = '[data-testid="nav-maps"]'
const NAV_LOOT = '[data-testid="nav-loot"]'
const TOOLBAR = '[data-testid="maps-toolbar"]'
const ZONE_CHIP = '[data-testid="maps-zone-chip"]'
const LOGGED = '[data-testid="maps-logged-loc-marker"]'
const LOGGED_LABEL = '[data-testid="maps-logged-loc-marker-label"]'
const LOGGED_CHIP = '[data-testid="maps-logged-loc-chip"]'
const TYPED = '[data-testid="maps-loc-marker"]'
const LOC_KEY = 'eq.maps.loc'

/** A point well inside the drawn map, in map coordinates, and the /loc a player there would read. */
interface Spot {
  x: number
  y: number
  z: number
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText.trim() ?? '', sel)
}

function loggedLocOf(page: Page): Promise<string | null> {
  return page.evaluate((s) => document.querySelector(s)?.getAttribute('data-loc') ?? null, LOGGED)
}

async function openMaps(page: Page): Promise<boolean> {
  await page.click(NAV_MAPS, { timeout: 30_000 })
  return page.waitForSelector(TOOLBAR, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
}

/** The middle of the drawn zone's extent, asked for through the app's own bridge. */
function spotOf(page: Page, stem: string): Promise<Spot | null> {
  return page.evaluate(async (zone) => {
    const eq = (window as unknown as {
      eq: {
        getMapData: (
          z: string,
          p: Record<string, string>
        ) => Promise<{ ok: boolean; data?: { bounds: { minX: number; maxX: number; minY: number; maxY: number } } }>
      }
    }).eq
    const res = await eq.getMapData(zone, {})
    const b = res.ok ? res.data?.bounds : undefined
    if (!b) return null
    return { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2), z: 0 }
  }, stem)
}

/** The game's sentence for a map point: /loc prints (ns, ew, z) and the file stores (-ew, -ns, z). */
function sentence(p: Spot): string {
  return `Your Location is ${(-p.y).toFixed(2)}, ${(-p.x).toFixed(2)}, ${p.z.toFixed(2)}`
}

/** `formatLoc`'s form: two places at most, no trailing zeros. */
function stated(p: Spot): string {
  const s = (n: number): string => String(Math.round(n * 100) / 100)
  return `${s(-p.y)}, ${s(-p.x)}, ${s(p.z)}`
}

async function stepLive(page: Page, log: FixtureLog, spot: Spot): Promise<void> {
  log.append(sentence(spot))
  const at = await settle(() => loggedLocOf(page), (l) => l != null, { timeoutMs: 20_000 })
  if (!check('A LIVE /loc PLACES THE MARKER', at != null, String(at))) return
  check('…at the reading the game printed, ns first', at === stated(spot), `${String(at)} vs ${stated(spot)}`)
  const label = await textOf(page, LOGGED_LABEL)
  check('…labelled as a /loc reading with its minute', /^You \(from \/loc, \d\d:\d\d\)$/.test(label), label)
  check('…and the toolbar states it too', (await textOf(page, LOGGED_CHIP)).startsWith('You (from /loc, '))
  check('…as its own mark, not the pasted one', (await countOf(page, TYPED)) === 0)
  const stored = await page.evaluate((k) => localStorage.getItem(k), LOC_KEY)
  check('…and it is never written into the pasted-marker store', stored == null || !stored.includes('ns'), String(stored))
}

async function stepSpoof(page: Page, log: FixtureLog, spot: Spot): Promise<void> {
  const before = await loggedLocOf(page)
  const next = { ...spot, x: spot.x - 40, y: spot.y - 40 }
  log.append(
    sentence(next),
    "Somebody tells General:1, 'Your Location is 1.00, 2.00, 3.00'",
    "Somebody says, 'Your Location is 1.00, 2.00, 3.00'"
  )
  await settle(() => loggedLocOf(page), (l) => l !== before, { timeoutMs: 20_000 })
  const settled = await settleStable(() => loggedLocOf(page), { timeoutMs: 8000 })
  check('EACH NEW /loc MOVES IT', settled === stated(next), `${String(before)} -> ${String(settled)}`)
  check('CHAT QUOTING THE SENTENCE NEVER MOVES IT', settled !== '1, 2, 3', String(settled))
}

async function stepTabs(page: Page): Promise<void> {
  const before = await loggedLocOf(page)
  await page.click(NAV_LOOT, { timeout: 30_000 })
  if (!check('leaving the Maps tab unmounts it', await settleGone(page, TOOLBAR, { timeoutMs: 15_000 }))) return
  if (!check('…and it comes back', await openMaps(page))) return
  const after = await settle(() => loggedLocOf(page), (l) => l != null, { timeoutMs: 20_000 })
  check('THE READING SURVIVES A TAB ROUND TRIP', after === before, `${String(after)} vs ${String(before)}`)
}

async function stepZone(page: Page, log: FixtureLog, zone: string): Promise<void> {
  log.append('You have entered East Freeport.')
  check('ZONING DROPS THE MARKER', await settleGone(page, LOGGED, { timeoutMs: 20_000 }))
  check('…and its chip', (await countOf(page, LOGGED_CHIP)) === 0)
  const moved = await settle(() => textOf(page, ZONE_CHIP), (z) => z !== zone, { timeoutMs: 20_000 })
  check('…and the followed map moved to the new zone', moved !== zone, moved)
}

async function run(page: Page, log: FixtureLog): Promise<void> {
  if (!check('the Maps tab opens', await openMaps(page))) return
  await waitHydrated(page)
  const zone = await settle(() => textOf(page, ZONE_CHIP), (z) => z !== '', { timeoutMs: 30_000 })
  if (zone === '') {
    note('no map drew on this machine (no EQ map packs) - the logged /loc assertions are skipped')
    return
  }
  const spot = await spotOf(page, zone)
  if (spot == null) {
    note(`no extent for "${zone}" - skipped`)
    return
  }
  // The backfilled line is in the log; give the view the same chance to (wrongly) draw it.
  const backfilled = await settleStable(() => countOf(page, LOGGED), { timeoutMs: 8000 })
  check('A BACKFILLED /loc PLACES NOTHING', backfilled === 0, String(backfilled))
  check('…and states nothing', (await countOf(page, LOGGED_CHIP)) === 0)

  await stepLive(page, log, spot)
  await stepSpoof(page, log, spot)
  await stepTabs(page)
  await stepZone(page, log, zone)
}

async function main(): Promise<void> {
  buildIfStale()
  const userData = makeUserData()
  const log = stageFixture('e2e-maps.log', { maps: true })
  // Stamped just after the fixture's last zone line, before the app ever reads the file.
  log.appendAt(new Date(2026, 7, 5, 20, 53, 30), 'Your Location is 12.00, 34.00, 5.00')
  try {
    const launched = await launchOnFixture(log, { userData })
    try {
      const page = await mainWindow(launched.app)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.waitForSelector(NAV_MAPS, { timeout: 60_000 })
      await run(page, log)
      check('no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
      if (failures.length) await dumpArtifacts(page, 'maps-loc-log-FAIL')
    } finally {
      await launched.close()
    }
  } finally {
    await log.dispose()
    await removeUserData(userData)
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  process.exitCode = 1
})
