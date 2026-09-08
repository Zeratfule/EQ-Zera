/**
 * Headless Electron integration test for THE DEFAULT SOUND PACK (JOS-273).
 *
 * THE OWNER'S RULING, verbatim: "if someone deletes alan rickman, they should be able to set a
 * default and it should persist." `tests/defaultPackPreference.test.mts` pins the preference, the
 * tombstone and the resolution as pure rules — everything that is a function. Two claims are left
 * over and neither is a function:
 *
 *   1. "IT SHOULD PERSIST" is a claim about a SECOND BOOT reading a file the first one wrote, so
 *      this spec runs two launches over one userData dir (the text-size / telemetry pattern). A
 *      reload would prove nothing: the preference is already in that renderer's memory.
 *   2. "UNRESOLVABLE STATES ARE VISIBLE" is a claim about a rendered row. This machine is the
 *      perfect witness for it: `EQ_E2E=1` skips pack provisioning entirely (src/main/index.ts —
 *      a fresh temp userData would otherwise re-download every pack on every launch), so an e2e
 *      app has NO sound packs at all and every seeded alert genuinely cannot play. Before this
 *      ticket that was invisible; the row now says it.
 *
 * WHY THE PREFERENCE IS SET OVER IPC RATHER THAN BY CLICKING THE STAR. The star lives on a
 * registry pack's ROW, and the registry is fetched over the network — the CI machine and this one
 * offline both get an empty list and no row to click. So the spec calls the exact handler the star
 * calls (`window.eq.setDefaultSoundPack`), which is the one seam between the button and the store,
 * and then proves the store side across a real process boundary. The button-to-handler wiring is
 * a one-line prop in SoundPacksDialog; the part that could actually break silently is the part
 * this spec watches.
 *
 * Run: `npm run test:e2e -- default-sound-pack`
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun
} from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

/** A pack that is certainly NOT installed here — the point is that the preference outlives it. */
const CHOSEN = 'portal-turret'

const ROW = '[data-testid="alert-row"]'
const NOTICE = '[data-testid="alert-sound-notice"]'
const DEFAULT_ROW = '[data-testid="pack-default-row"]'

interface PackPrefs {
  defaultPackId?: string
  removedPackIds?: string[]
}

interface Bridge {
  getSoundPackPrefs: () => Promise<PackPrefs>
  setDefaultSoundPack: (packId: string | null) => Promise<PackPrefs>
}

const bridge = (page: Page): Promise<PackPrefs> =>
  page.evaluate(() => (window as unknown as { eq: Bridge }).eq.getSoundPackPrefs())

/** Text of the first match, whitespace-collapsed (MUI pads rendered values). */
function textOf(page: Page, selector: string): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '',
    selector
  )
}

async function openAlerts(page: Page): Promise<void> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector(ROW, { timeout: 30_000 })
}

/**
 * THE STATE THIS MACHINE IS ACTUALLY IN, said out loud. No packs are installed (see the header),
 * so every seeded alert resolves to nothing — and the row is where a user has to be able to find
 * that out. It is also the "missing" branch of the resolution, observed in the real app rather
 * than asserted over a fixture.
 */
async function stepSilentIsVisible(page: Page): Promise<void> {
  await openAlerts(page)
  const rows = await countOf(page, ROW)
  check('the seeded alerts are on screen', rows >= 1, String(rows))
  const notices = await countOf(page, NOTICE)
  check(
    'with no pack installed, every alert row SAYS it cannot play - it does not just sit there',
    notices === rows,
    `${notices} notice(s) on ${rows} row(s)`
  )
  const said = (await textOf(page, NOTICE)).replace(/\s+/g, ' ')
  check('…and it says what is wrong in words a user can act on', /silent/i.test(said), said)
}

/** Choose a default pack — the write the pack browser's star performs. */
async function stepChoose(page: Page): Promise<void> {
  const before = await bridge(page)
  check(
    'a fresh install has no preference at all (the shipped pack is what "default" means)',
    before.defaultPackId === undefined,
    JSON.stringify(before)
  )
  const after = await page.evaluate(
    (id) => (window as unknown as { eq: Bridge }).eq.setDefaultSoundPack(id),
    CHOSEN
  )
  check('setting a default answers with what was stored', after.defaultPackId === CHOSEN, JSON.stringify(after))
}

/** The whole ticket, in one assertion: it is still there after the process died. */
async function stepPersisted(page: Page): Promise<void> {
  const prefs = await bridge(page)
  check(
    'THE PREFERENCE SURVIVED A RESTART - nothing in this launch has set it',
    prefs.defaultPackId === CHOSEN,
    JSON.stringify(prefs)
  )
}

/**
 * …and the surface that owns the preference says the chosen pack is GONE rather than quietly
 * healing the value. The registry list itself is empty offline (the dialog shows its own error
 * banner for that, which is not this spec's business); the default row renders regardless,
 * because it is about the store rather than about the network.
 */
async function stepMissingIsNamed(page: Page): Promise<void> {
  await openAlerts(page)
  await page.click('[data-testid="alerts-sound-packs"]')
  await page.waitForSelector(DEFAULT_ROW, { timeout: 20_000 })
  const said = (await textOf(page, DEFAULT_ROW)).replace(/\s+/g, ' ')
  check('the pack browser names the pack the user chose', said.includes(CHOSEN), said)
  check('…and says it is not installed, rather than pretending otherwise', /not installed/i.test(said), said)
}

async function main(): Promise<void> {
  buildIfStale()
  const consoleErrors: string[] = []
  const watch = (page: Page): void => {
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))
  }

  // ONE dir for both launches: the assertion between them is that the choice OUTLIVES the process.
  const userData = makeUserData()
  const log = stageFixture('e2e-telemetry.log')

  console.log('launch 1: fresh userData - the silent-row state, then the choice…')
  const first = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(first.app)
    watch(page)
    await stepSilentIsVisible(page)
    await stepChoose(page)
    if (failures.length) await dumpArtifacts(page, 'default-sound-pack-FAIL-first')
  } finally {
    await first.close()
  }

  console.log('launch 2: same userData - is the choice still there…')
  const second = await launchOnFixture(log, { userData })
  try {
    const page = await mainWindow(second.app)
    watch(page)
    await stepPersisted(page)
    await stepMissingIsNamed(page)
    if (failures.length) await dumpArtifacts(page, 'default-sound-pack-FAIL-restart')
  } finally {
    await second.close()
    await removeUserData(userData)
    await log.dispose()
  }

  // A missing IPC handler shows up here first (`invoke` rejects into an unhandled rejection).
  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  if (consoleErrors.length === 0) {
    note('two real launches over one userData dir - the persistence claim is a restart, not a reload')
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
