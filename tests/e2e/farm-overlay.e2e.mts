/**
 * Headless Electron smoke test for the FARM METER OVERLAY (roadmap 2 item 8).
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The row model is pinned over hand-built snapshots in
 * tests/farmRows.test.mts (the six readings, the zone scope, the declared coin ladder, the two
 * refusals); the arithmetic under it is pinned in the progression, lootRates, respawn and timeslice
 * suites; the first-open geometry over every work area in tests/overlayLayout.test.mts. None of
 * those can claim the PIECES ARE WIRED — that the window ships off, that toggling it from the app's
 * own overlay bridge (the call the title-bar Overlay menu makes) spawns a `?kind=farm` window with
 * its own labelled chrome, that a window whose whole subject is a fold over months of log actually
 * RECEIVES that fold in a second renderer through `MODULE_READING_OVERLAYS`, and that a COIN
 * sentence written into the LIVE log travels the entire real path — the tailer, the engine's
 * parser, the `coin` module, the cursor push, the overlay's own fan-out, React — and comes out as a
 * number on the row that declares the ladder it was divided by.
 *
 * THE COIN LINE IS PLAYED RATHER THAN BORROWED, for the reason the XP spec plays its mote:
 * e2e-leveling.log carries 47 zone lines, 341 experience lines and NOT ONE coin sentence, so the
 * coin row is an honest em-dash before the append and a number after it. That before/after IS the
 * live path. Its shape is copied verbatim from tests/fixtures/wl44-swap-boundary.log, which is the
 * auto-vendor line as the real client writes it.
 *
 * DEFAULT OFF, and every launch here gets a fresh userData dir — so this spec is always a first
 * run, which makes it the one place that can prove what a new install gets.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode (src/main/e2e.ts): the main window
 * never shows and overlays skip `showInactive`. So this spec drives the app's own bridges rather
 * than clicking — a hidden, always-on-top window has no pointer.
 *
 * WAIT FOR THE CONDITION, NEVER FOR THE CLOCK: every read below goes through `settle`.
 *
 * Run: `node --import tsx tests/e2e/farm-overlay.e2e.mts`.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleStable
} from './appHarness.mjs'
import { mainWindow, overlayWindow } from './appWindow.mjs'
import { launchOnFixture, type FixtureLog } from './logFixture.mjs'
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

/** One rendered line, as the window draws it. `data-row` is the reading it carries. */
interface Row {
  row: string
  label: string
  value: string
}

/**
 * Every row on screen. The prefix problem the XP spec paid for is avoided by construction here: the
 * ROWS carry `farm-row` and the value span carries `farm-value`, so neither selector can sweep up
 * the other and a row count is a count of rows.
 */
function rows(page: Page): Promise<Row[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="farm-row"]')].map((e) => ({
      row: e.getAttribute('data-row') ?? '',
      label: (e.querySelector('span')?.textContent ?? '').trim(),
      value: (e.querySelector('[data-testid="farm-value"]')?.textContent ?? '').trim()
    }))
  )
}

/** The caption line under the rows: the hour every rate above divided by. */
function span(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.querySelector('[data-testid="farm-span"]') as HTMLElement | null)?.innerText.trim() ?? ''
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
  check('a fresh install has the Farm meter OFF', state.farm === false, JSON.stringify(state))
  check(
    '…and no Farm window was spawned at startup',
    (await windowsOfKind(app, 'farm')) === 0,
    `${app.windows().length} window(s) open`
  )
}

async function stepOpenAndChrome(page: Page, app: ElectronApplication): Promise<Page | null> {
  const open = await bridge(page).toggle('farm')
  if (!check('toggling Farm from the overlay menu reports it OPEN', open === true)) return null

  const overlay = await overlayWindow(app, 'farm')
  if (!check('…and a window for kind=farm really exists', overlay !== null)) return null
  const o = overlay

  const mounted = await settle(() => countOf(o, '[data-testid="farm-overlay"]'), (n) => n === 1, {
    timeoutMs: 20_000
  })
  check('the Farm surface mounts', mounted === 1)
  const text = await o.evaluate(() => document.body.innerText)
  check('…with a header that reads Farm', /\bFarm\b/i.test(text), text.slice(0, 160))
  // Unlocked (the default), so the header's controls are real and reachable. Both are selected by
  // the aria-label the shared IconButton already carries.
  check('…and a visible close control', (await countOf(o, 'button[aria-label="Close overlay"]')) === 1)
  check('…and the lock (click-through) control beside it', (await countOf(o, 'button[aria-label^="Lock"]')) === 1)
  return o
}

/**
 * THE FOLD REACHES THE SECOND RENDERER, and the window draws its six readings.
 *
 * This is the claim `MODULE_READING_OVERLAYS` exists for: the Farm window is created in the same
 * `whenReady` turn that starts the historical fold, so a window that only rode the cursor pushes
 * would sit at the hydrating line forever on an idle log. e2e-leveling.log ends ON a zone line, so
 * a wired window names that camp — and a `Reading log…` placeholder here would be exactly the
 * JOS-172 bug in a new window.
 */
async function stepHydratesFromTheFold(overlay: Page): Promise<void> {
  const seen = await settle(() => rows(overlay), (r) => r.length >= 6, { timeoutMs: 30_000 })
  check(
    'the window draws the camp, both paces, the drops, the coin and the next respawn',
    JSON.stringify(seen.map((r) => r.row)) === '["here","kills","xp","drops","coin","respawn"]',
    JSON.stringify(seen)
  )
  check(
    '…and the hydrating placeholder is gone, because the fold arrived',
    (await countOf(overlay, '[data-testid="farm-hydrating"]')) === 0
  )
  const here = seen.find((r) => r.row === 'here')
  check(
    'the first row names the camp the log last entered, out of the real fold',
    here !== undefined && here.value.includes("Nagafen's Lair") && here.value.includes('since zoning'),
    JSON.stringify(here)
  )
  const caption = await settleStable(() => span(overlay), { timeoutMs: 15_000 })
  check('…under one span that says which hour every rate on it divides by', /active/.test(caption), caption)
}

/**
 * THE JUST-ARRIVED GATE, ON THE SURFACE MOST EXPOSED TO IT.
 *
 * This window is opened the moment you zone in, so its stay is routinely seconds old — and
 * e2e-leveling.log ends ON a zone line, which makes this launch the extreme case. MEASURED before
 * the gate was wired: the coin row read `450,000,000p/h`, which is the clock since you arrived,
 * extrapolated. `shared/rateBasis.ts` already owns the refusal; what only the real app can show is
 * that this window actually asks for it, and that it says WHY once rather than leaving four blanks.
 */
async function stepTooShortToRate(overlay: Page): Promise<void> {
  const gated = (await rows(overlay)).filter((r) => ['kills', 'xp', 'drops'].includes(r.row))
  check(
    'a stay seconds old refuses every per-hour figure rather than extrapolating a clock',
    gated.length === 3 && gated.every((r) => r.value === '-'),
    JSON.stringify(gated)
  )
  check(
    '…and says WHY once, beside the span, instead of leaving blanks',
    (await countOf(overlay, '[data-testid="farm-too-short"]')) === 1,
    await span(overlay)
  )
}

/**
 * THE LADDER IS ON THE ROW, AND IT IS THE HALF A UNIT TEST CANNOT PROVE SHIPPED.
 *
 * `shared/acquireEvents.ts`'s law is that EQ's plat conversion is in no line of the log, so a
 * consumer that wants coin-per-hour declares its rate IN THE OPEN. tests/farmRows.test.mts pins the
 * words in the model; this pins that they are on the screen, in the label of the very row that
 * divides by them, rather than behind a hover this bundle would refuse to draw anyway (JOS-358).
 */
async function stepCoinLadderIsStated(overlay: Page): Promise<void> {
  const coin = (await rows(overlay)).find((r) => r.row === 'coin')
  if (!check('the coin row is on screen', coin !== undefined)) return
  check('the coin row is a per-hour reading', coin.label.startsWith('Coin/h'), coin.label)
  check(
    '…and it NAMES the ladder it used, in the open, on its own label',
    coin.label.includes('1p=10g=100s=1000c'),
    coin.label
  )
  check(
    'a log with no coin sentence in the stay says so with an em-dash, never a zero',
    coin.value === '-',
    coin.value
  )
}

/**
 * A COIN SENTENCE WRITTEN RIGHT NOW REACHES THIS WINDOW — the roadmap item's own ask, end to end.
 *
 * The line's shape is verbatim from tests/fixtures/wl44-swap-boundary.log: the AUTO VENDOR, which
 * is by far the largest coin stream a farming session produces and whose price the parser read and
 * discarded until 2026-09-08. Before it the row is an em-dash; after it the row is money.
 */
async function stepLiveCoin(overlay: Page, log: FixtureLog): Promise<void> {
  log.append("You looted a Velium Gemmed Rune from an ire ghast's corpse and sold it for 125 platinum.")
  const after = await settle(
    () => rows(overlay),
    (r) => (r.find((x) => x.row === 'coin')?.value ?? '-') !== '-',
    { timeoutMs: 30_000 }
  )
  const coin = after.find((r) => r.row === 'coin')
  if (!check('a coin sentence in the LIVE log reaches this window', coin !== undefined)) return
  check('…and the row moves off the em-dash onto real money', coin.value !== '-', JSON.stringify(coin))
  check(
    '…denominated on the ladder its own label declares',
    /\d+p/.test(coin.value),
    `${coin.label} => ${coin.value}`
  )
  // THE COUNT IS NEVER GATED, ONLY THE RATE. A 125 platinum sale is a fact about the log that a
  // seconds-old stay does not make less true; a per-hour figure over those seconds is the
  // extrapolation, and this stay has not earned one.
  check(
    '…as a TOTAL, with no per-hour figure the stay has not earned',
    coin.value === '125p',
    `${coin.label} => ${coin.value}`
  )
  check(
    '…while the row still carries the ladder it was measured with',
    coin.label.includes('1p=10g=100s=1000c'),
    coin.label
  )
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
    await bridge(page).toggle('farm')
  }
  const gone = await settle(() => windowsOfKind(app, 'farm'), (n) => n === 0, { timeoutMs: 20_000 })
  check('the close affordance actually closes the window', gone === 0, `${gone} still open`)
  const state = await settle(() => bridge(page).state(), (s) => s.farm === false, { timeoutMs: 10_000 })
  check(
    '…and the app records it as closed, so the next launch does not bring it back',
    state.farm === false,
    JSON.stringify(state)
  )
}

async function main(): Promise<void> {
  await buildIfStale()
  const { app, close, log } = await launchOnFixture('e2e-leveling.log')
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
        if (m.type() === 'error') consoleErrors.push(`farm overlay: ${m.text()}`)
      })
      await stepHydratesFromTheFold(overlay)
      await stepCoinLadderIsStated(overlay)
      await stepTooShortToRate(overlay)
      // AFTER the fold, so there are real rows to have (or not have) a hover (JOS-358).
      await stepRowsHoverNothing(overlay, 'farm-row')
      await stepNoTooltipsAnywhere(overlay, 'the Farm window')
      await stepLiveCoin(overlay, log)
    } else {
      note('the Farm window never opened, so every claim about its contents was skipped')
    }
    await stepClose(page, app, overlay)

    check(
      'no renderer console errors in either window during the run',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | ')
    )
  } catch (err) {
    check('the spec ran to completion', false, String(err))
    await dumpArtifacts(page, 'farm-overlay')
  } finally {
    if (failures.length > 0) await dumpArtifacts(page, 'farm-overlay')
    await close()
  }
  reportRun()
}

void main()
