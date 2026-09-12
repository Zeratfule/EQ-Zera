/**
 * Headless Electron smoke test for the RUN TRACKER OVERLAY (2026-09-11).
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The fold is pinned over the owner's own crawl in
 * tests/runTracker.test.mts — 118 kills, 13 his group's, fourteen named in order, eleven keys in
 * three kinds, a reward chest of 28 items, one lockpicked door, 54p of auto-sell, both edges of
 * the run — against module snapshots the SHIPPED engine wrote.
 * None of that can claim the pieces are WIRED: that the window ships off, that the Overlay menu's
 * own bridge spawns a `?kind=run` window with its own labelled chrome, that a window whose whole
 * subject is five folds over months of log actually RECEIVES them in a second renderer through
 * `MODULE_READING_OVERLAYS`, that the numbers come out on screen, and that it wears the meters'
 * geometry: it resizes to whatever the user gives it, down to the shared floor, and it pins.
 *
 * THE FIXTURE IS THE RUN. `tests/fixtures/befallen-run.log` ends in West Commonlands, two zone
 * lines past the instance — so the run this window draws is a FINISHED one, which is the state that
 * exercises the frozen clock and the `· LAST` tag. Its provenance (and how the committed snapshots
 * beside it were folded) is in tests/runTracker.test.mts.
 *
 * DEFAULT OFF, and every launch here gets a fresh userData dir — so this spec is always a first
 * run, which makes it the one place that can prove what a new install gets.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode (src/main/e2e.ts): the main window
 * never shows and overlays skip `showInactive`. So this spec drives the app's own bridges rather
 * than clicking — a hidden, always-on-top window has no pointer. That is why the geometry is
 * measured in TWO halves rather than by dragging a corner: `overlay:setConfig` is the IPC a drag
 * PERSISTS through, and `overlayMinSizeSteps` drives the window's own `setBounds` to prove it takes
 * a size and holds the shared floor. buffs-overlay.e2e.mts carries the measurement behind the split.
 *
 * WAIT FOR THE CONDITION, NEVER FOR THE CLOCK: every read below goes through `settle`.
 *
 * Run: `node --import tsx tests/e2e/run-tracker.e2e.mts`.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle } from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import { stepMinimumSize } from './overlayMinSizeSteps.mjs'
import { stepNoTooltipsAnywhere, stepRowsHoverNothing } from './overlayTooltipSteps.mjs'

/** The main window's overlay bridge — the same one the title-bar Overlay menu calls. */
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

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** One rendered `label · value` line. `data-row` is the reading it carries. */
interface Row {
  row: string
  value: string
}

function rows(page: Page): Promise<Row[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="run-row"]')].map((e) => ({
      row: e.getAttribute('data-row') ?? '',
      value: (e.querySelector('[data-testid="run-value"]')?.textContent ?? '').trim()
    }))
  )
}

/** The window's whole header line, which is where the place and the difficulty are stated. */
function headerText(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.querySelector('[data-testid="run-overlay"]') as HTMLElement | null)?.innerText.trim() ?? ''
  )
}

/** How many windows the app currently has open on a given `?kind=` (exact, never a substring). */
async function windowsOfKind(app: ElectronApplication, kind: string): Promise<number> {
  let hit = 0
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (new URLSearchParams(search).get('kind') === kind) hit++
  }
  return hit
}

async function stepDefaultOff(page: Page, app: ElectronApplication): Promise<void> {
  const state = await bridge(page).state()
  check('a fresh install has the Run tracker OFF', state.run === false, JSON.stringify(state))
  check(
    '…and no Run window was spawned at startup',
    (await windowsOfKind(app, 'run')) === 0,
    `${app.windows().length} window(s) open`
  )
}

async function stepOpenAndChrome(page: Page, app: ElectronApplication): Promise<Page | null> {
  const open = await bridge(page).toggle('run')
  if (!check('toggling Run tracker from the overlay menu reports it OPEN', open === true)) return null

  const overlay = await overlayWindow(app, 'run')
  if (!check('…and a window for kind=run really exists', overlay !== null)) return null
  const o = overlay

  const mounted = await settle(() => countOf(o, '[data-testid="run-overlay"]'), (n) => n === 1, {
    timeoutMs: 20_000
  })
  check('the Run surface mounts', mounted === 1)
  // Unlocked (the default), so the header's controls are real and reachable. Both are selected by
  // the aria-label the shared IconButton already carries.
  check('…with a visible close control', (await countOf(o, 'button[aria-label="Close overlay"]')) === 1)
  check('…and the lock (click-through) control beside it', (await countOf(o, 'button[aria-label^="Lock"]')) === 1)
  return o
}

/**
 * FIVE FOLDS REACH THE SECOND RENDERER, and the window draws the crawl.
 *
 * This is the claim `MODULE_READING_OVERLAYS` exists for: the window is created in the same
 * `whenReady` turn that starts the historical fold, so a window that only rode the cursor pushes
 * would sit on its empty state forever on a log that has stopped. The fixture's run is over, so
 * every number below is final and exact.
 */
async function stepDrawsTheRun(overlay: Page): Promise<void> {
  const seen = await settle(() => rows(overlay), (r) => r.some((x) => x.row === 'kills'), { timeoutMs: 40_000 })
  const head = await headerText(overlay)
  check(
    'the header names the place and the difficulty the zone line stated',
    head.includes('Befallen · tier 4 (Refined)'),
    head.slice(0, 200)
  )
  check('…and tags the run as finished rather than dressing it up as live', head.includes('LAST'), head.slice(0, 200))
  check(
    '…beside the elapsed clock, frozen at the zone line that ended it',
    head.includes('22:01'),
    head.slice(0, 200)
  )
  const kills = seen.find((r) => r.row === 'kills')
  check(
    'the kills row carries his 118, his group’s 13 and the pace over the run',
    kills?.value === '118 · 13 by group · 6.0/min',
    JSON.stringify(kills)
  )
  check(
    'the named are listed, all fourteen of them',
    (await countOf(overlay, '[data-testid="run-named"]')) === 14
  )
  const named = await overlay.evaluate(() =>
    [...document.querySelectorAll('[data-testid="run-named"]')].map((e) => (e.textContent ?? '').trim())
  )
  const first = named[0] ?? ''
  const last = named[named.length - 1] ?? ''
  check('…in kill order, the first one 1:34 into the run', first === 'skeleton L`rodd+1:34', first)
  check('…and the last one is the boss', last.startsWith('Baron Telyx V`Zher'), last)
  check('the three kinds of key are chips', (await countOf(overlay, '[data-testid="run-key"]')) === 3)
  // THE REWARD CHEST AND THE DOOR, the two readings this window was without until the parser
  // learned to read them. The run is finished, so both are final: 28 items across 24 chest lines,
  // and the one lock he picked on the way in.
  const chest = seen.find((r) => r.row === 'chest')
  check(
    'the reward chest row says what it paid and where each item went',
    chest?.value === '28 items: 5 kept, 22 sold, 1 merged',
    JSON.stringify(chest)
  )
  const doors = seen.find((r) => r.row === 'doors')
  check('the door he picked open is counted', doors?.value === '1', JSON.stringify(doors))
  check(
    'the auto-sell states the ladder it was summed on, in the open',
    seen.find((r) => r.row === 'sold') !== undefined && head.includes('1p=10g=100s=1000c'),
    JSON.stringify(seen)
  )
  // THE CRAWL ESTIMATE, drawn from the committed community table rather than from the log (the fold
  // and the twelve names are pinned in tests/crawlRoster.test.mts). Befallen's row is `inferred`, so
  // the honest shape here is a bare count with no denominator - and the caption is what makes the
  // whole block legible as an estimate rather than as the game's own meter.
  const crawl = await overlay.evaluate(
    () => (document.querySelector('[data-testid="run-crawl"]') as HTMLElement | null)?.innerText.trim() ?? ''
  )
  check(
    'the crawl block estimates his rares against the community roster, and says it is an estimate',
    crawl.includes('Crawl (estimated)') &&
      crawl.includes('Rares killed') &&
      crawl.includes('12') &&
      crawl.includes("not the game's own tracker"),
    crawl.slice(0, 200)
  )
  // NO DEATHS ROW, because he did not die: a zero the log never stated is not printed.
  check('a run with no deaths draws no deaths row', seen.every((r) => r.row !== 'deaths'), JSON.stringify(seen))
  check('…and the empty state is gone, because the fold arrived', (await countOf(overlay, '[data-testid="run-empty"]')) === 0)
}

/**
 * THE SIZE THE USER LEAVES IS REMEMBERED, under this kind's OWN store key.
 *
 * The write goes through `overlay:setConfig`, which is the IPC a real drag lands on, rather than by
 * dragging: `saveOverlayBounds` in windows.ts is installed on the 'resized' event, Electron raises
 * that for a USER drag only, and an always-on-top window that is never shown has no pointer to drag
 * with (buffs-overlay.e2e.mts carries the measurement). Whether the WINDOW can take the size is the
 * next step's claim, on the instrument the meters already own.
 */
async function stepRemembersItsSize(app: ElectronApplication, overlay: Page): Promise<void> {
  const win = await app.browserWindow(overlay)
  const before = (await win.evaluate((w) => w.getBounds())) as Bounds
  const want = { ...before, width: before.width + 90, height: before.height + 160 }
  await overlay.evaluate(
    (bounds) =>
      (window as unknown as { eqOverlay: { setConfig: (p: unknown) => Promise<unknown> } }).eqOverlay.setConfig({
        bounds
      }),
    want
  )
  const saved = await settle(
    () =>
      overlay.evaluate(() =>
        (window as unknown as { eqOverlay: { getConfig: () => Promise<{ bounds?: Bounds }> } }).eqOverlay
          .getConfig()
          .then((c) => c.bounds)
      ),
    (b) => b?.height === want.height,
    { timeoutMs: 15_000 }
  )
  check(
    'the size a drag would leave is persisted under overlays.run, height and width both',
    saved?.width === want.width && saved.height === want.height,
    `${JSON.stringify(before)} → ${JSON.stringify(saved)}`
  )
}

/**
 * IT PINS LIKE A METER. Locked is click-through, so the interactive affordances go away — the
 * footer's controls and the run's own Start/End button, both of which would be a lie on a window
 * that passes clicks to the game. Unlocking brings them back.
 */
async function stepLocks(overlay: Page): Promise<void> {
  const setLocked = (v: boolean): Promise<void> =>
    overlay.evaluate((locked) => {
      ;(window as unknown as { eqOverlay: { setLocked: (b: boolean) => void } }).eqOverlay.setLocked(locked)
    }, v)

  const controls = (): Promise<number> =>
    countOf(overlay, '[data-testid="run-start"], [data-testid="run-end"], input[aria-label="Background opacity"]')

  check('unlocked, the run control and the opacity slider are both on screen', (await controls()) === 2)
  await setLocked(true)
  const pinned = await settle(controls, (n) => n === 0, { timeoutMs: 15_000 })
  check('pinning takes every clickable affordance away, because clicks go to the game', pinned === 0)
  await setLocked(false)
  const back = await settle(controls, (n) => n === 2, { timeoutMs: 15_000 })
  check('…and unpinning brings them back', back === 2)
}

/** Close it the way a user would — its own ✕ — and prove main recorded it. */
async function stepClose(page: Page, app: ElectronApplication, overlay: Page | null): Promise<void> {
  if (overlay) {
    // The click destroys the page it is evaluated in, so this evaluate is allowed to lose its
    // context; whether the close happened is the settle below's answer to give.
    await overlay
      .evaluate(() => {
        ;(document.querySelector('button[aria-label="Close overlay"]') as HTMLElement | null)?.click()
      })
      .catch(() => undefined)
  } else {
    await bridge(page).toggle('run')
  }
  const gone = await settle(() => windowsOfKind(app, 'run'), (n) => n === 0, { timeoutMs: 20_000 })
  check('the close affordance actually closes the window', gone === 0, `${gone} still open`)
  const state = await settle(() => bridge(page).state(), (s) => s.run === false, { timeoutMs: 10_000 })
  check(
    '…and the app records it as closed, so the next launch does not bring it back',
    state.run === false,
    JSON.stringify(state)
  )
}

async function main(): Promise<void> {
  await buildIfStale()
  const { app, close } = await launchOnFixture('befallen-run.log')
  const page = await mainWindow(app)
  const consoleErrors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  try {
    await stepDefaultOff(page, app)
    const overlay = await stepOpenAndChrome(page, app)
    if (overlay) {
      overlay.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(`run overlay: ${m.text()}`)
      })
      await stepDrawsTheRun(overlay)
      await stepRemembersItsSize(app, overlay)
      // THE RESIZE ITSELF, on the instrument every meter is measured with (JOS-278): the window
      // takes a size, the shared 140x90 floor holds under it, and nothing this window draws escapes
      // the pane at that floor.
      await stepMinimumSize(app, overlay, 'run', 'Run tracker')
      await stepLocks(overlay)
      // AFTER the fold, so there are real rows to have (or not have) a hover (JOS-358).
      await stepRowsHoverNothing(overlay, 'run-row')
      await stepNoTooltipsAnywhere(overlay, 'the Run tracker window')
    } else {
      note('the Run tracker window never opened, so every claim about its contents was skipped')
    }
    await stepClose(page, app, overlay)

    check(
      'no renderer console errors in either window during the run',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | ')
    )
  } catch (err) {
    check('the spec ran to completion', false, String(err))
    await dumpArtifacts(page, 'run-tracker')
  } finally {
    if (failures.length > 0) await dumpArtifacts(page, 'run-tracker')
    await close()
  }
  reportRun()
}

void main()
