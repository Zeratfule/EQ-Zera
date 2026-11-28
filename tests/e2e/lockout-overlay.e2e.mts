/**
 * Headless Electron test for the DIRGE LOCKOUT OVERLAY (2026-11-27).
 *
 * The 2026-11-10 patch lets Denon's Desperate Dirge land on one target only once every two ticks,
 * and the game logs nothing for a locked target — so the window's clock starts on YOUR landing.
 * Detection is pinned in engine/crates/fold/tests/spell_lockouts.rs and the phases in
 * tests/spellLockouts.test.mts; this spec proves the WIRING, end to end through the real engine:
 *
 *   1. The window ships OFF and the Overlay menu's bridge opens a `?kind=lockout` window.
 *   2. A BACKFILLED landing (in the log before launch) starts nothing: the window says the dirge is
 *      ready and the published snapshot holds no timer.
 *   3. A LIVE burst — two same-name targets, a crit, plus a resist, another bard's hit and a tell
 *      quoting the sentence — is ONE timer, locked, x3, naming its targets.
 *   4. It goes amber, then green, then leaves, back to the idle line — on the wall clock, with the
 *      log silent.
 *   5. No hover anywhere below the title bar (JOS-358); it closes and the app records it.
 *
 * WAIT FOR THE CONDITION, NEVER FOR THE CLOCK: every read goes through `settle`.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts lockout-overlay`.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
import { stepNoTooltipsAnywhere, stepRowsHoverNothing } from './overlayTooltipSteps.mjs'

const DDD = "Denon's Desperate Dirge"
const hit = (target: string, n: number, crit = false): string =>
  `You hit ${target} for ${String(n)} points of magic damage by ${DDD} VII.${crit ? ' (Critical)' : ''}`

interface OverlayBridge {
  getOverlayState: () => Promise<Record<string, boolean>>
  toggleOverlay: (k: string) => Promise<boolean>
}
function bridge(page: Page): {
  state: () => Promise<Record<string, boolean>>
  toggle: (k: string) => Promise<boolean>
} {
  return {
    state: () => page.evaluate(() => (window as unknown as { eq: OverlayBridge }).eq.getOverlayState()),
    toggle: (k: string) =>
      page.evaluate((kind) => (window as unknown as { eq: OverlayBridge }).eq.toggleOverlay(kind), k)
  }
}

async function windowsOfKind(app: ElectronApplication, kind: string): Promise<number> {
  let hits = 0
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (new URLSearchParams(search).get('kind') === kind) hits++
  }
  return hits
}

interface RowRead {
  phase: string
  count: string
  time: string
  targets: string
}

function rows(page: Page): Promise<RowRead[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="lockout-row"]')].map((e) => ({
      phase: e.getAttribute('data-phase') ?? '',
      count: e.getAttribute('data-count') ?? '',
      time: (e.querySelector('[data-testid="lockout-time"]')?.textContent ?? '').trim(),
      targets: (e.querySelector('[data-testid="lockout-targets"]')?.textContent ?? '').trim()
    }))
  )
}

function idleText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="lockout-idle"]')].map((e) => e.textContent.trim()).join(' | ')
  )
}

/** The engine's own published timers, read through the overlay's bridge. */
function activeInSnapshot(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const bridgeOf = (window as unknown as {
      eqOverlay: { getModuleSnapshot: (id: string) => Promise<{ state: { lockouts?: { active: unknown[] } } } | null> }
    }).eqOverlay
    const snap = await bridgeOf.getModuleSnapshot('buffTimers')
    return snap?.state.lockouts?.active.length ?? -1
  })
}

async function stepOpen(page: Page, app: ElectronApplication): Promise<Page | null> {
  const state = await bridge(page).state()
  check('a fresh install has the Dirge lockout window OFF', state.lockout === false, JSON.stringify(state))
  check('…and none was spawned at startup', (await windowsOfKind(app, 'lockout')) === 0)
  if (!check('toggling it from the overlay menu reports it OPEN', (await bridge(page).toggle('lockout')) === true)) {
    return null
  }
  const overlay = await overlayWindow(app, 'lockout')
  if (!check('…and a window for kind=lockout really exists', overlay !== null) || overlay === null) return null
  const mounted = await settle(() => countOf(overlay, '[data-testid="lockout-overlay"]'), (n) => n === 1, {
    timeoutMs: 20_000
  })
  check('the lockout surface mounts', mounted === 1)
  check('…with a visible close control', (await countOf(overlay, 'button[aria-label="Close overlay"]')) === 1)
  check('…and the lock control beside it', (await countOf(overlay, 'button[aria-label^="Lock"]')) === 1)
  return overlay
}

async function stepBackfillIsIdle(overlay: Page): Promise<void> {
  const idle = await settle(() => idleText(overlay), (t) => t.includes(`${DDD}: ready`), { timeoutMs: 40_000 })
  check('WITH NOTHING LIVE IT SAYS THE DIRGE IS READY', idle === `${DDD}: ready`, idle)
  check('A BACKFILLED LANDING STARTS NO TIMER (snapshot)', (await activeInSnapshot(overlay)) === 0)
  check('…and draws no row', (await countOf(overlay, '[data-testid="lockout-row"]')) === 0)
}

async function stepLiveBurst(overlay: Page, log: FixtureLog): Promise<void> {
  log.append(
    `You begin singing ${DDD} VII.`,
    'A spite golem resisted your Denon\'s Desperate Dirge VII!',
    `Gwythain hit a spite golem for 1395 points of magic damage by ${DDD}.`,
    `Gwythain tells you, 'You hit a spite golem for 1395 points of magic damage by ${DDD}.'`,
    hit('an ice giant', 1395),
    hit('an ice giant', 1395),
    hit('an ice giant magus', 4129, true)
  )
  const live = await settle(() => rows(overlay), (r) => r.length > 0, { timeoutMs: 20_000 })
  check('A LIVE BURST IS ONE TIMER', live.length === 1, JSON.stringify(live))
  const row = live[0]
  if (!row) return
  check('…locked', row.phase === 'locked', JSON.stringify(row))
  check('…counting the three landings, not the resist, the other bard or the tell', row.count === '3', row.count)
  check('…naming its targets', row.targets === 'an ice giant x2, an ice giant magus', row.targets)
  check('…and counting down to the earliest landing', /^locked \d+s$/.test(row.time), row.time)
  check('…and the idle line gives way to it', (await idleText(overlay)) === '', await idleText(overlay))
}

async function stepPhases(overlay: Page): Promise<void> {
  const phase = async (): Promise<string> => (await rows(overlay))[0]?.phase ?? 'gone'
  check('IT GOES AMBER (maybe) ON THE WALL CLOCK', (await settle(phase, (p) => p === 'maybe', { timeoutMs: 20_000 })) === 'maybe')
  check('…THEN GREEN (ready)', (await settle(phase, (p) => p === 'ready', { timeoutMs: 15_000 })) === 'ready')
  check('…THEN LEAVES', (await settle(phase, (p) => p === 'gone', { timeoutMs: 15_000 })) === 'gone')
  const idle = await settle(() => idleText(overlay), (t) => t !== '', { timeoutMs: 5_000 })
  check('…back to the idle line', idle === `${DDD}: ready`, idle)
}

async function stepClose(page: Page, app: ElectronApplication, overlay: Page): Promise<void> {
  await overlay
    .evaluate(() => {
      ;(document.querySelector('button[aria-label="Close overlay"]') as HTMLElement | null)?.click()
    })
    .catch(() => undefined)
  const gone = await settle(() => windowsOfKind(app, 'lockout'), (n) => n === 0, { timeoutMs: 20_000 })
  check('the close affordance closes the window', gone === 0, `${String(gone)} still open`)
  const state = await settle(() => bridge(page).state(), (s) => s.lockout === false, { timeoutMs: 10_000 })
  check('…and the app records it as closed', state.lockout === false, JSON.stringify(state))
}

async function run(page: Page, app: ElectronApplication, log: FixtureLog): Promise<void> {
  const overlay = await stepOpen(page, app)
  if (!overlay) {
    note('the lockout window never opened, so every claim about its contents was skipped')
    return
  }
  await stepBackfillIsIdle(overlay)
  await stepLiveBurst(overlay, log)
  await stepRowsHoverNothing(overlay, 'lockout-row')
  await stepNoTooltipsAnywhere(overlay, 'the Dirge lockout window')
  await stepPhases(overlay)
  await stepClose(page, app, overlay)
}

async function main(): Promise<void> {
  buildIfStale()
  const log = stageFixture('e2e-overlay.log')
  // In the log before the app reads it: history, which must start nothing.
  log.append(`You begin singing ${DDD} VII.`, hit('an ice giant', 1395))
  try {
    const launched = await launchOnFixture(log)
    const page = await mainWindow(launched.app)
    try {
      await run(page, launched.app, log)
    } catch (err) {
      check('the spec ran to completion', false, String(err))
    } finally {
      if (failures.length > 0) await dumpArtifacts(page, 'lockout-overlay')
      await launched.close()
    }
  } finally {
    await log.dispose()
  }
  reportRun()
}

void main()
