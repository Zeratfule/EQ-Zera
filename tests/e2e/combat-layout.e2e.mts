/**
 * Headless Electron integration test for THE COMBAT TAB'S RESIZABLE PANELS (a player's email:
 * "would love to be able to resize the different windows - dps over time, procs, damage by mob,
 * combat log").
 *
 * The stored vocabulary (defaults, clamps, per-field degrade, minimums at a measured size) is
 * node-tested in tests/combatLayout.test.mts. What only the real app can show:
 *   * a DRAG on a handle actually moves the panels, and a key press on a focused handle does too;
 *   * the DPS curve REDRAWS to its cell - its plot grows with the panel instead of sitting at a
 *     fixed height;
 *   * a double-click resets ONE split and leaves the others alone;
 *   * the sizes cross a PROCESS BOUNDARY (two launches, one userData dir - the combat-drill
 *     pattern), and Reset layout puts the store back to an absent key.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts combat-layout`
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  rectOf,
  reportRun,
  settle,
  settleGone,
  waitHydrated
} from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

const NAV_COMBAT = '[data-testid="nav-combat"]'
const DASH = '[data-testid="combat-dashboard"]'
const CELL = (n: string): string => `[data-testid="dash-cell-${n}"]`
const SPLIT = (n: string): string => `[data-testid="split-${n}"]`
const LOG_FRAME = '[data-testid="combat-log-frame"]'
const RESET = '[data-testid="combat-reset-layout"]'
const PLOT = '[data-testid="dps-plot"]'
/** The key itself, so a rename that kept this spec green would still be caught. */
const KEY = 'eq.combat.layout'
const TOL = 4

function stored(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), KEY)
}

function ariaNow(page: Page, sel: string): Promise<number> {
  return page.evaluate((s) => Number(document.querySelector(s)?.getAttribute('aria-valuenow') ?? 'NaN'), sel)
}

async function width(page: Page, sel: string): Promise<number> {
  return (await rectOf(page, sel))?.w ?? -1
}

async function height(page: Page, sel: string): Promise<number> {
  return (await rectOf(page, sel))?.h ?? -1
}

async function dismissFirstRunNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  await page.waitForSelector(notice, { timeout: 15_000 }).catch(() => undefined)
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  await settleGone(page, notice, { timeoutMs: 8_000 })
}

async function openCombat(page: Page): Promise<boolean> {
  await page.click(NAV_COMBAT, { timeout: 30_000 })
  const { snap } = await waitHydrated(page, '[data-testid="combat-hydrating"]')
  if (snap.hydrating) return false
  return page.waitForSelector(DASH, { timeout: 60_000 }).then(() => true, () => false)
}

/** Press, travel in steps (so the handle sees real pointermoves), release. */
async function drag(page: Page, sel: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(sel).boundingBox()
  if (!box) throw new Error(`no box for ${sel}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

/** What launch 1 left behind, for launch 2 to find. */
interface Left {
  meterW: number
  logH: number
}

async function stepDefaults(page: Page): Promise<void> {
  check('a fresh install stores no layout (the default is an absent key)', (await stored(page)) === null)
  check('…and offers no Reset layout, since there is nothing to reset', (await countOf(page, RESET)) === 0)
  const seps = await countOf(page, '[role="separator"]')
  check('four drag handles: columns, each column, and the combat log', seps >= 4, `${String(seps)} separators`)
  const m = await width(page, CELL('meter'))
  const d = await width(page, CELL('dps'))
  check('the default dashboard is still four equal panels', Math.abs(m - d) <= TOL, `${String(m)} / ${String(d)} px`)
  check('the column handle reports its split as 50%', (await ariaNow(page, SPLIT('col'))) === 50)
  check('the combat log opens at its 220px', Math.abs((await height(page, LOG_FRAME)) - 220) <= 1)
}

async function stepDragColumns(page: Page): Promise<number> {
  const before = await width(page, CELL('meter'))
  const dpsBefore = await width(page, CELL('dps'))
  await drag(page, SPLIT('col'), 150, 0)
  const after = await settle(() => width(page, CELL('meter')), (w) => w > before + 100, { timeoutMs: 8_000 })
  check('dragging the column handle right widens the left column', Math.abs(after - before - 150) <= TOL, `${String(before)} -> ${String(after)} px`)
  const dpsAfter = await width(page, CELL('dps'))
  check('…and narrows the right one by the same amount', Math.abs(dpsBefore - dpsAfter - 150) <= TOL, `${String(dpsBefore)} -> ${String(dpsAfter)} px`)
  check('…the handle says so to a screen reader', (await ariaNow(page, SPLIT('col'))) > 50)
  const raw = await settle(() => stored(page), (v) => v !== null, { timeoutMs: 8_000 })
  check(`…and the release is stored under ${KEY}`, raw !== null && (JSON.parse(raw) as { col: number }).col > 0.5, String(raw))
  check('Reset layout appears once something is changed', (await settle(() => countOf(page, RESET), (n) => n === 1, { timeoutMs: 8_000 })) === 1)
  return after
}

async function stepKeyboardAndChart(page: Page): Promise<void> {
  const dpsH = await height(page, CELL('dps'))
  const plotH = await height(page, PLOT)
  await page.focus(SPLIT('right'))
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  const grown = await settle(() => height(page, CELL('dps')), (h) => h > dpsH + 40, { timeoutMs: 8_000 })
  check('arrow keys on a focused handle resize its panels (4 x 16px)', Math.abs(grown - dpsH - 64) <= TOL, `${String(dpsH)} -> ${String(grown)} px`)
  if (plotH > 0) {
    const plot2 = await settle(() => height(page, PLOT), (h) => h > plotH + 40, { timeoutMs: 8_000 })
    check('THE DPS CURVE REDRAWS TO ITS CELL - the plot grows with the panel', plot2 > plotH + 40, `${String(plotH)} -> ${String(plot2)} px`)
  } else {
    note('the DPS curve is not drawn for this selection - its redraw is not asserted this run')
  }
  // DOUBLE-CLICK resets THIS split only.
  await page.dblclick(SPLIT('right'))
  const back = await settle(() => height(page, CELL('dps')), (h) => Math.abs(h - dpsH) <= TOL, { timeoutMs: 8_000 })
  check('double-clicking a handle puts that split back', Math.abs(back - dpsH) <= TOL, `${String(back)} px (was ${String(dpsH)})`)
  check('…and leaves the other splits alone', (await ariaNow(page, SPLIT('col'))) > 50)
}

async function stepDragLog(page: Page): Promise<number> {
  const before = await height(page, LOG_FRAME)
  await drag(page, SPLIT('log'), 0, -100)
  const after = await settle(() => height(page, LOG_FRAME), (h) => h > before + 60, { timeoutMs: 8_000 })
  check('dragging the log handle up makes the combat log taller', Math.abs(after - before - 100) <= TOL, `${String(before)} -> ${String(after)} px`)
  const dash = await height(page, DASH)
  check('…and the dashboard keeps real height', dash >= 180, `${String(dash)} px`)
  return after
}

async function launchOne(page: Page): Promise<Left | null> {
  await dismissFirstRunNotice(page)
  if (!check('the Combat tab opens on a hydrated dashboard', await openCombat(page))) return null
  await stepDefaults(page)
  const meterW = await stepDragColumns(page)
  await stepKeyboardAndChart(page)
  const logH = await stepDragLog(page)
  // Settle the stored value before the process exits.
  await settle(() => stored(page), (v) => v !== null && !v.includes('"log":220'), { timeoutMs: 8_000 })
  return { meterW, logH }
}

async function launchTwo(page: Page, left: Left): Promise<void> {
  await dismissFirstRunNotice(page)
  if (!check('the Combat tab opens after a restart', await openCombat(page))) return
  check('the layout crossed the process boundary', (await stored(page)) !== null)
  const m = await settle(() => width(page, CELL('meter')), (w) => Math.abs(w - left.meterW) <= TOL, { timeoutMs: 10_000 })
  check('THE COLUMN WIDTHS SURVIVE A FULL RESTART', Math.abs(m - left.meterW) <= TOL, `${String(m)} px (left ${String(left.meterW)})`)
  const l = await height(page, LOG_FRAME)
  check('…and so does the combat log height', Math.abs(l - left.logH) <= 1, `${String(l)} px (left ${String(left.logH)})`)

  await page.click(RESET, { timeout: 10_000 })
  check('Reset layout clears the stored value to an absent key', (await settle(() => stored(page), (v) => v === null, { timeoutMs: 8_000 })) === null)
  const mw = await width(page, CELL('meter'))
  const dw = await width(page, CELL('dps'))
  check('…the four panels are equal again', Math.abs(mw - dw) <= TOL, `${String(mw)} / ${String(dw)} px`)
  check('…the combat log is back to 220px', Math.abs((await height(page, LOG_FRAME)) - 220) <= 1)
  check('…and the Reset control goes away', await settleGone(page, RESET, { timeoutMs: 8_000 }))
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-combat.log')
  const userData = makeUserData()
  let left: Left | null = null

  console.log('launch 1: drag the handles, leave the layout changed…')
  {
    const { app, close } = await launchOnFixture(log, { userData })
    try {
      const page = await mainWindow(app)
      await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })
      left = await launchOne(page)
      if (failures.length) await dumpArtifacts(page, 'combat-layout-launch1-FAIL')
    } finally {
      await close()
    }
  }

  console.log('launch 2: same userData - is the layout still there, and does Reset clear it?')
  {
    const { app, close } = await launchOnFixture(log, { userData })
    try {
      const page = await mainWindow(app)
      await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })
      if (left) await launchTwo(page, left)
      else note('launch 1 did not complete - nothing to look for after the restart')
      if (failures.length) await dumpArtifacts(page, 'combat-layout-launch2-FAIL')
    } finally {
      await close()
      await removeUserData(userData)
      await log.dispose()
    }
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the combat-layout spec did not complete')
  process.exitCode = 1
})
