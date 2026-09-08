/**
 * Headless Electron integration test for THE LOOT LEDGER RENDERING EVERYTHING YOU SCROLL TO
 * (JOS-260).
 *
 * THE BUG, as a 0.23.0 user hit it: about thirty rows render and the rest of the ledger is blank
 * space you can scroll through. `useWindowedRows` bound its scroll listener and its ResizeObserver
 * in effects keyed on the ref OBJECT, which never changes — so they ran exactly once. `LootView`
 * returns the item-detail takeover BEFORE it renders the scroll container, so drilling into a row
 * and coming back replaced that container's DOM node: the listeners stayed on the detached one,
 * `scrollTop` and `clientHeight` froze, and the rendered slice froze with them. The owner could not
 * reproduce it because a short ledger fits inside the frozen window — which is exactly why this
 * spec SEEDS A LONG ONE.
 *
 * WHY THIS NEEDS THE REAL APP. `tests/windowedRows.test.mts` pins the hook's binding by running it
 * across a container swap, and that is the guard that cannot rot. But the report is about
 * GEOMETRY — "I scroll and there is nothing there" — and geometry needs a browser: a real scroll
 * container, a real ResizeObserver, real row heights, and the real remount that the detail pane
 * causes. This spec asserts what the user is owed, in their words: scroll to the bottom of the
 * ledger and there are rows under your eyes.
 *
 * WHAT IT READS: `tests/fixtures/e2e-deep-link.log` — the committed fixture whose loot lines
 * already fill this ledger for `deep-link-back.e2e.mts` — plus SEEDED_ROWS more loot lines the
 * harness appends to its own staged copy before launch (JOS-29's append driver; the copy is a temp
 * file, never the tracked fixture). Distinct item names, because the ledger groups by item: a
 * thousand loots of one item is one row and would prove nothing.
 *
 * THE FOUR THINGS IT ASSERTS, in the order they broke:
 *   1. the ledger is still WINDOWED — thousands of rows, a screenful of DOM nodes;
 *   2. scrolling to the bottom puts a row at the bottom edge (the plain complaint);
 *   3. THE REGRESSION: drill into a row, press Back, scroll to the bottom — same answer. This is
 *      the container-node replacement, and it is the assertion the fix exists for;
 *   4. there is ONE scroller under the ledger, not two — the app shell behind it must not have
 *      grown its own scroll for the view to chain into.
 *
 * WHY IT NEVER TAKES THE SCREEN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock, and points `userData` at a throwaway temp dir minted per launch.
 *
 * Run: `npm run test:e2e -- loot-window`.
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
  settleStable,
  waitHydrated
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'

const GRID = '[data-testid="overview-grid"]'
const LOOT_LIST = '[data-testid="loot-list"]'
const LOOT_SCROLL = '[data-testid="loot-scroll"]'
const LOOT_ROW = '[data-testid="loot-row"]'
const LOOT_DETAIL = '[data-testid="loot-detail"]'
const LOOT_BACK = '[data-testid="loot-back"]'
/**
 * THE APP'S ONE CONTENT SCROLLER (App.tsx). Views that manage their own scrolling — the Loot
 * ledger, the Planner's browser — fill it and scroll INSIDE it; a view that does not simply grows
 * and this scrolls. The testid exists for the step below, which proves the shell grows no SECOND
 * scroll behind a view that is already scrolling itself.
 */
const APP_CONTENT = '[data-testid="app-content"]'

/**
 * How many DISTINCT items to seed. "A few thousand" from the brief, and the number matters twice:
 * it must be far more than one frozen window (~30 rows) so the defect is visible at all, and far
 * more than one screenful so "windowed" is a claim about a long list rather than a short one.
 */
const SEEDED_ROWS = 3000
/** The seeded items' shared prefix — the handle for "this row came from the seed". */
const SEED_ITEM = 'Windowed Ledger Ingot'

function appears(page: Page, sel: string, ms = 20_000): Promise<boolean> {
  return page.waitForSelector(sel, { timeout: ms }).then(
    () => true,
    () => false
  )
}

/** What the ledger looks like right now, from the DOM's own measurements. */
interface Ledger {
  /** How many row elements are actually mounted. */
  mounted: number
  /** Is the container scrolled to its very end? */
  atBottom: boolean
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  /** Px the table overflows its box sideways — a fixed-layout table must not have any. */
  sidewaysOverflow: number
  /** Px of the visible box below the last mounted row — the blank space the reporter saw. */
  blankBelowLastRow: number
  /** Height of the trailing spacer row, if the table still reserves space it has not rendered. */
  trailingSpacer: number
  /** The name in the last mounted row. */
  lastRowName: string
  /** Distinct rendered row heights, rounded. The fixed-height contract, measured. */
  rowHeights: number[]
}

function readLedger(page: Page): Promise<Ledger | null> {
  return page.evaluate((a) => {
    const el = document.querySelector(a.scroll)
    if (!el) return null
    const box = el.getBoundingClientRect()
    const rows = [...el.querySelectorAll(a.row)]
    const last = rows[rows.length - 1] ?? null
    // GEOMETRY, not `elementFromPoint`: the app draws its own chrome across the bottom edge of the
    // window (the first-run analytics notice, the what's-new teaser), so a hit test there answers
    // a question about that notice. How far the last row's bottom is from the box's bottom is the
    // reporter's complaint stated in pixels, and nothing can sit in front of it.
    const tail = el.querySelector('tbody')?.lastElementChild ?? null
    // NO named function bindings in here: tsx/esbuild's keepNames wraps `const f = () => …` in a
    // `__name` helper that lives in the NODE bundle, and Playwright ships only this callback's
    // source to the page (settle.mts records the same trap). Inline expressions only.
    return {
      mounted: rows.length,
      atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
      scrollTop: Math.round(el.scrollTop),
      scrollHeight: Math.round(el.scrollHeight),
      clientHeight: Math.round(el.clientHeight),
      sidewaysOverflow: Math.round(el.scrollWidth - el.clientWidth),
      blankBelowLastRow: last === null ? -1 : Math.round(box.bottom - last.getBoundingClientRect().bottom),
      trailingSpacer:
        tail === null || tail.hasAttribute('data-testid')
          ? 0
          : Math.round(tail.getBoundingClientRect().height),
      lastRowName: last?.querySelector('[data-testid="loot-item-name"]')?.textContent?.trim() ?? '',
      rowHeights: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))]
    }
  }, { scroll: LOOT_SCROLL, row: LOOT_ROW })
}

/**
 * Scroll the ledger — to the end, or back to the top — and wait for the window to stop moving.
 *
 * THE SYNTHETIC EVENT IS A HIDDEN-WINDOW WORKAROUND, and it is worth reading before trusting it.
 * `EQ_E2E=1` never shows this window, and Chromium starves a window it is not compositing of
 * rendering opportunities — the same fact that makes `requestAnimationFrame` unreliable here
 * (settle.mts records that measurement). Scroll EVENTS are dispatched from those same rendering
 * steps, so a programmatic `scrollTop` write can land in the DOM while its event never arrives.
 * MEASURED on this spec: after a drill and Back, the assignment moved `scrollTop` to the maximum
 * and the hook never heard it — but dispatching one `scroll` Event at the container converged it
 * immediately, twenty-two rows with the last one flush against the bottom edge.
 *
 * It does NOT weaken what is being tested. The event is dispatched at the container that is IN THE
 * DOCUMENT: a listener stranded on the node a remount threw away — which is the entire defect —
 * hears this exactly as little as it hears the real one.
 */
async function scrollLedger(page: Page, to: 'top' | 'bottom'): Promise<Ledger | null> {
  await page.evaluate(
    (a) => {
      const el = document.querySelector(a.sel)
      if (!el) return
      el.scrollTop = a.to === 'top' ? 0 : el.scrollHeight
      el.dispatchEvent(new Event('scroll'))
    },
    { sel: LOOT_SCROLL, to }
  )
  // The window advances off a scroll event and a re-render, so the SETTLED reading is the honest
  // one — and `settleStable` is how this suite waits for a condition rather than for a clock.
  return settleStable(() => readLedger(page), { timeoutMs: 15_000 })
}

/** Land, let the startup replay finish, and open the Loot tab on its ledger. */
async function stepReady(page: Page): Promise<void> {
  if (!check('the app lands on the Overview', await appears(page, GRID, 60_000))) {
    throw new Error('never landed on Overview — nothing below can be asserted')
  }
  const { snap } = await waitHydrated(page)
  if (!check('hydration completes (the replay has filled the loot ledger)', !snap.hydrating)) {
    throw new Error('still hydrating — nothing below can be asserted')
  }
  await page.click('[data-testid="nav-loot"]', { timeout: 15_000 })
  if (!check('the Loot tab opens on its ledger', await appears(page, LOOT_LIST))) {
    throw new Error('no loot ledger — nothing below can be asserted')
  }
  check('…with its scroll container mounted', await appears(page, LOOT_SCROLL))
}

/**
 * 1. THE LEDGER IS LONG, AND STILL WINDOWED. Both halves are the point: the scroll height has to
 * describe thousands of rows (or nothing below is testing what the reporter saw), while the DOM
 * holds a screenful (or the windowing this ticket repairs has simply been thrown away).
 */
async function stepWindowed(page: Page): Promise<Ledger | null> {
  const led = await settleStable(() => readLedger(page), { timeoutMs: 15_000 })
  if (!check('the ledger reports its geometry', led !== null)) return null
  const l = led as Ledger
  check(
    'the seeded ledger is thousands of rows tall',
    l.scrollHeight > l.clientHeight * 10,
    `${String(l.scrollHeight)}px of content in a ${String(l.clientHeight)}px box`
  )
  check(
    '…and only a screenful of rows is mounted',
    l.mounted > 0 && l.mounted < 120,
    `${String(l.mounted)} row nodes for ${String(SEEDED_ROWS)}+ rows`
  )
  // The fixed-height contract the hook's arithmetic assumes (lootRows.tsx). One height, not a
  // spread: a row that wrapped to two lines would desync the window from the browser's geometry,
  // and the drift compounds with every row above the viewport. A pixel of rounding is allowed;
  // a second line of text is not.
  const spread = Math.max(...l.rowHeights) - Math.min(...l.rowHeights)
  check(
    'every mounted row is the same one row tall',
    l.rowHeights.length > 0 && spread <= 1,
    `heights: ${l.rowHeights.join(', ')}`
  )
  // The width half of the same contract: a `tableLayout: fixed` table takes its columns from the
  // header, so it fits the pane whatever the mounted slice happens to contain. An auto-layout one
  // re-measures from the widest visible cell — and a table wide enough to need a horizontal
  // scrollbar spends that bar's height on vertical overflow the reader never asked for.
  check(
    'the ledger has nothing to scroll sideways',
    l.sidewaysOverflow <= 1,
    `${String(l.sidewaysOverflow)}px wider than its box`
  )
  return l
}

/** 2 & 3. Scroll to the end and demand that something is actually there. */
async function stepBottomHasRows(page: Page, when: string): Promise<void> {
  const led = await scrollLedger(page, 'bottom')
  if (!check(`the ledger reports its geometry (${when})`, led !== null)) return
  const l = led as Ledger
  if (!check(`the ledger scrolls to its very end (${when})`, l.atBottom, `${String(l.scrollTop)}/${String(l.scrollHeight - l.clientHeight)}`)) {
    return
  }
  check(
    `THE REPORT: at the bottom of the ledger there are rows, not blank space (${when})`,
    l.blankBelowLastRow >= 0 && l.blankBelowLastRow <= 2,
    `${String(l.blankBelowLastRow)}px of blank below the last of ${String(l.mounted)} mounted rows ("${l.lastRowName}")`
  )
  check(
    `…and the table reserves nothing below it — the LAST row is mounted (${when})`,
    l.trailingSpacer === 0,
    `${String(l.trailingSpacer)}px of unrendered spacer left at the end`
  )
  check(
    `…with the window still bounded, not the whole list mounted (${when})`,
    l.mounted < 120,
    `${String(l.mounted)} row nodes`
  )
}

/**
 * 3. THE CONTAINER-NODE REPLACEMENT, driven the way a reader causes it: click a row (the detail
 * pane TAKES the pane, so the ledger unmounts), press Back (a NEW scroll container mounts under
 * the same ref), then scroll to the bottom again.
 *
 * Before the fix, everything up to here passed and this did not: the hook's listeners were still
 * on the node the takeover threw away, so the second container's scrolling was never heard and the
 * window stayed wherever it had frozen.
 *
 * IT GOES BACK TO THE TOP FIRST, and that is not tidying. The ledger restores the scroll position
 * it was at when you drilled in, so a drill taken FROM the bottom would leave a frozen window
 * sitting at the bottom too — and the broken build would pass the assertion by accident. Drilling
 * from the top means the journey back down is a real one.
 */
async function stepDrillAndBack(page: Page): Promise<boolean> {
  if ((await countOf(page, LOOT_ROW)) === 0) {
    note('the ledger has no row to drill into this run')
    return false
  }
  const top = await scrollLedger(page, 'top')
  check('the ledger scrolls back to the top before the drill', (top?.scrollTop ?? -1) === 0, String(top?.scrollTop))
  await page.click(LOOT_ROW, { timeout: 15_000 })
  if (!check('a ledger row opens that item’s drill-down', await appears(page, LOOT_DETAIL))) return false
  await page.click(LOOT_BACK, { timeout: 15_000 })
  if (!check('…and Back returns to the ledger', await appears(page, LOOT_LIST))) return false
  check('…on a scroll container that is mounted again', await appears(page, LOOT_SCROLL))
  return true
}

/**
 * 4. ONE SCROLLER, NOT TWO. The ledger fills the app's content area and scrolls inside it; if the
 * shell behind it also has something to scroll, a wheel gesture chains into it and a frozen list
 * LOOKS like it is scrolling — which is the second half of what the reporter described (dead
 * overscroll space above and below).
 */
async function stepNoDoubleScroll(page: Page): Promise<void> {
  const shell = await settleStable(
    () =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        return { over: Math.round(el.scrollHeight - el.clientHeight), h: Math.round(el.clientHeight) }
      }, APP_CONTENT),
    { timeoutMs: 10_000 }
  )
  if (!check('the app’s content area reports its geometry', shell !== null)) return
  const s = shell as { over: number; h: number }
  check(
    'the shell behind the ledger has nothing of its own to scroll',
    s.over <= 1,
    `${String(s.over)}px of overscroll in a ${String(s.h)}px area`
  )
}

/**
 * The seed, written into the staged copy BEFORE launch so the startup replay folds it: one loot
 * line per distinct item, in chunks that share a timestamp (EQ stamps to the second, so a corpse's
 * simultaneous drops are the normal case, not a corner — see lootSort.ts).
 *
 * THE LAST ROW IS MADE DETERMINISTIC, because "the last row is mounted" is the assertion. The
 * grouped table's default order is TIMES LOOTED descending, then newest-first, then by name — so
 * every seeded item, looted once, sorts below anything looted twice and above nothing. The
 * fixture's own two loot rows (Ruby, Prayers of Life) are therefore looted once more here, which
 * lifts them to the TOP of the table and leaves the bottom of the list entirely seeded.
 */
function seedLedger(log: { appendAt: (at: Date, ...m: readonly string[]) => number }): number {
  const base = Date.now() - SEEDED_ROWS * 1000
  const looted = (item: string): string =>
    `--You have looted a ${item} from a decaying skeleton corpse.--`
  let written = 0
  for (let i = 0; i < SEEDED_ROWS; i += 100) {
    const messages: string[] = []
    for (let j = i; j < Math.min(i + 100, SEEDED_ROWS); j++) {
      messages.push(looted(`${SEED_ITEM} ${String(j).padStart(4, '0')}`))
    }
    written += log.appendAt(new Date(base + i * 1000), ...messages)
  }
  // The two the fixture already loots, lifted to two-looted and out of the tail.
  log.appendAt(new Date(), looted('Ruby'), looted('Prayers of Life'))
  return written
}

async function main(): Promise<void> {
  buildIfStale()

  const log = stageFixture('e2e-deep-link.log')
  const seeded = seedLedger(log)
  console.log(`seeded ${String(seeded)} distinct loot rows into the staged log`)
  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-deep-link.log…')
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
    check('every seeded row reached the ledger', seeded === SEEDED_ROWS, `${String(seeded)} written`)
    await stepWindowed(page)
    await stepNoDoubleScroll(page)
    await stepBottomHasRows(page, 'first visit')
    if (await stepDrillAndBack(page)) await stepBottomHasRows(page, 'after a drill and Back')

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    await dumpArtifacts(page, failures.length ? 'loot-window-FAIL' : 'loot-window-pass')
  } finally {
    await close()
    await log.dispose()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
