/**
 * THE CHARACTER TAB IS RELEASED (JOS-327) — and this spec is the inverse of the one it replaces.
 *
 * WHAT THIS FILE USED TO BE. From JOS-45 the character sheet was UNRELEASED: it lived behind a
 * compile-time strip and this spec measured that promise on the emitted bundle, launching TWICE —
 * once production-shaped to watch the tab be ABSENT and the IPC channel REFUSE, then again with
 * `EQ_UNRELEASED=1` to watch the same channel answer, because an absence assertion passes just as
 * happily when the feature was never wired up at all. Absent, then present, on one build: that was
 * a gate rather than dead code.
 *
 * The owner released the tab on 2026-08-13. Every one of those claims is now false BY DESIGN, so
 * the file states the opposite ones and states them the same way — not "the tab exists" (which a
 * misspelled testid satisfies) but the tab exists, mounts a sheet built from a KNOWN dump, draws
 * the exaltations socketed into it, and its ledger answers a search with a number this spec can
 * predict. The gate machinery itself survives tenantless (src/main/unreleased.ts); the day a
 * surface adopts it, the two-launch spec gets written again against that surface's own channel.
 *
 * AND IT LAUNCHES ON A STAGED DUMP NOW, which is the other half of the rewrite. The old spec ran
 * `launchApp()` against whatever the machine happened to have, so every content assertion had to
 * be an identity or a `note()` that asserts nothing — on a machine with no `/outputfile inventory`
 * dump it skipped the interesting half entirely. `launchOnFixture(…, { inventory })` stages the
 * committed 295-line dump into a throwaway EQ install, so the numbers below are EXACT and the same
 * on every machine: 24 cells, 22 of them filled, 6 socketed exaltations, 123 things carried.
 *
 * WHERE IT LOOKS. The sheet has no nav row of its own — JOS-324 collapsed four rows into the gear
 * area — so the entry is two clicks: `nav-gear`, then `tab-character`, which is the area's LAST
 * tab. The spec waits for `tab-gear` in between, so the bar whose contents it is about to assert on
 * is demonstrably on screen at the moment of the assertion.
 *
 * Run: `npm run test:e2e -- character-sheet` (or node --import tsx this file).
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  pageOverflow,
  reportRun,
  settle,
  settleGone
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
// JOS-329's away-and-back step, from the module the gear and planner specs share.
import { stepCarryMemory } from './areaMemorySteps.mjs'

/** The gear area's one nav row, and the tab bar it opens. */
const NAV_GEAR = '[data-testid="nav-gear"]'
/** The area's FIRST tab, whose presence proves the bar mounted. */
const TAB_GEAR = '[data-testid="tab-gear"]'
/** The area's LAST tab — what used to have to be absent, and now has to work. */
const TAB = '[data-testid="tab-character"]'

const SHEET = '[data-testid="character-sheet"]'
const SLOT_GRID = '[data-testid="character-slot-grid"]'
/** JOS-327: the chips under a worn item's name, one per socketed exaltation. */
const EXALTATION = '[data-testid="character-exaltation"]'

/** JOS-327: everything you carry. */
const CARRY = '[data-testid="character-carry"]'
const CARRY_COUNT = '[data-testid="character-carry-count"]'
const CARRY_ROW = '[data-testid="character-carry-row"]'
const CARRY_SEARCH = '[data-testid="character-carry-search"]'
const CARRY_EMPTY = '[data-testid="character-carry-empty"]'
const chip = (lane: string): string => `[data-testid="character-carry-chip-${lane}"]`

/**
 * The staged dump, and the numbers this spec states because of it. All measured against the
 * committed file by `tests/carryAll.test.mts` and `tests/characterSheet.test.mts`, which is the
 * point of naming them here: a change that moves one of these moves a unit test first.
 */
const DUMP = 'Primitive_freeport-Inventory.txt'
/** The grid is a fixed set of cells, filled or not. */
const CELLS = 24
/** …and the real dump fills all but two of them. */
const WORN = 22
/** Six `(Exaltation)`-suffixed child rows hang off the WORN items (bag sockets are not drawn here). */
const EXALTATIONS = 6
/** Every non-empty row of every table in the dump. */
const CARRIED = 123
/** The key rings' 37 rows — the lane chip's own count, and what clicking it must leave on screen. */
const KEYRING = 37
/** `moonstone` matches four rows: a +1, a +3, and two socketed copies. */
const SEARCH_TERM = 'moonstone'
const SEARCH_HITS = 4

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '',
    sel
  )
}

/**
 * Answer the analytics first-run notice. A fresh `userData` always shows it, it sits along the
 * bottom edge, and this spec clicks chips and types into a box — a hit test that lands on the
 * notice is a true report about a first-run overlay and nothing at all about the ledger.
 */
async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

/** What `character:sheet` answers with — the transport, read directly. */
interface SheetShape {
  cells: number
  worn: number
  counted: number
  unknown: number
  carried: number
  lanes: string[]
  /** every worn item's exaltation names, flattened — the data the chips are drawn from */
  exaltations: string[]
}

function readSheet(page: Page): Promise<SheetShape | null> {
  return page.evaluate(async () => {
    const eq = (window as unknown as { eq: { characterSheet: () => Promise<unknown> } }).eq
    const sheet = (await eq.characterSheet()) as {
      cells: { item: { exaltations: string[] } | null }[]
      totals: { counted: number; unknown: number }
      carry: { rows: unknown[]; lanes: { id: string; count: number }[] }
    } | null
    if (!sheet) return null
    const filled = sheet.cells.filter((c) => c.item !== null)
    return {
      cells: sheet.cells.length,
      worn: filled.length,
      counted: sheet.totals.counted,
      unknown: sheet.totals.unknown,
      carried: sheet.carry.rows.length,
      lanes: sheet.carry.lanes.map((l) => `${l.id}:${String(l.count)}`),
      exaltations: filled.flatMap((c) => c.item?.exaltations ?? [])
    }
  })
}

/** Open the gear area and wait for its tab bar. A `false` makes every claim below vacuous. */
async function openGearArea(page: Page): Promise<boolean> {
  const hasRow = await page.waitForSelector(NAV_GEAR, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the gear area has its one nav row', hasRow)) return false
  await page.click(NAV_GEAR, { timeout: 15_000 })
  const barUp = await page.waitForSelector(TAB_GEAR, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  return check('…and it opens an area whose tab bar is on screen', barUp)
}

// ── the graduation: the tab is THERE, in a production-shaped build ─────────────────────────

async function stepReleased(page: Page): Promise<boolean> {
  if (!(await openGearArea(page))) return false

  // THE INVERSION. This exact count was asserted `=== 0` for six days, in the same place, against
  // the same bar. `npm run test:e2e` builds production-shaped (`electron-vite build` into
  // `out-e2e/`) — the compilation an installer ships — so this is the tab being present in the
  // bytes a user gets, not merely on a dev server.
  const present = (await countOf(page, TAB)) === 1
  if (!check('the Character tab IS on the gear area’s tab bar in a production-shaped build', present)) {
    return false
  }
  // CASE-INSENSITIVE ON PURPOSE. `innerText` reports RENDERED text, and the 2026-09-06 theme
  // rework puts `text-transform: uppercase` on tab labels, so this reads "CHARACTER". The claim
  // is the tab's NAME, not its letter-casing, which is a styling decision the theme owns.
  const label = (await textOf(page, TAB)).replace(/\s+/g, ' ').trim()
  check('…and it is called Character', /character/i.test(label), `reads "${label}"`)

  await page.click(TAB, { timeout: 15_000 })
  const mounted = await page.waitForSelector(SHEET, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  return check('…and clicking it mounts the sheet, built from the staged dump', mounted)
}

// ── the sheet, against a dump this spec staged ─────────────────────────────────────────────

async function stepSheet(page: Page): Promise<void> {
  const sheet = await readSheet(page)
  if (!check('character:sheet answers — the handler is registered in every build now', sheet !== null)) {
    return
  }
  const s = sheet as SheetShape

  check('the sheet draws every slot cell, filled or not', s.cells === CELLS, `${String(s.cells)} cells`)
  check('…and the staged dump fills all but two of them', s.worn === WORN, `${String(s.worn)} worn`)
  check(
    'every worn item is either summed or counted as unknown',
    s.counted + s.unknown === s.worn,
    `${String(s.counted)} + ${String(s.unknown)} vs ${String(s.worn)} worn`
  )

  // SOCKETED EXALTATIONS (JOS-327). The transport has carried these since JOS-45 and nothing drew
  // them; both halves are asserted, because a parse nobody renders is the defect being closed here.
  check(
    `the worn items carry ${String(EXALTATIONS)} socketed exaltations in the transport`,
    s.exaltations.length === EXALTATIONS,
    s.exaltations.join(' · ')
  )
  check(
    '…and the chips have already been stripped of the client’s `(Exaltation)` suffix',
    s.exaltations.every((n) => !n.includes('(Exaltation)')),
    s.exaltations.join(' · ')
  )
  const drawn = await countOf(page, EXALTATION)
  check(
    `…and the grid DRAWS one chip per socket (${String(EXALTATIONS)})`,
    drawn === EXALTATIONS,
    `${String(drawn)} chips under ${String(await countOf(page, SLOT_GRID))} grid(s)`
  )
}

// ── everything you carry ───────────────────────────────────────────────────────────────────

/** The ledger's own count line, which is what a windowed table can honestly be asked. */
function carryCount(page: Page): Promise<string> {
  return textOf(page, CARRY_COUNT)
}

async function stepCarry(page: Page): Promise<void> {
  const sheet = await readSheet(page)
  if (sheet === null) return

  check(
    `the transport carries all ${String(CARRIED)} rows of the dump`,
    sheet.carried === CARRIED,
    `${String(sheet.carried)} rows`
  )
  // The lanes the real dump produces. `bank` is deliberately NOT among them: the owner's dump
  // enumerates all thirty bank slots and every one is `Empty`, and an empty lane draws no chip.
  check(
    'the lanes are Worn, Bags, Depot and Key rings — and no Bank chip, because the bank is empty',
    sheet.lanes.join(' ') === 'worn:28 bags:57 depot:1 keyring:37',
    sheet.lanes.join(' ')
  )

  if (!check('the carry-all panel is on screen under the sheet', (await countOf(page, CARRY)) === 1)) {
    return
  }
  check(
    `…and its count line reads the whole ledger (${String(CARRIED)} of ${String(CARRIED)})`,
    (await carryCount(page)) === `${String(CARRIED)} of ${String(CARRIED)}`,
    await carryCount(page)
  )

  // WINDOWED, and this is where that is measured: the table is 123 rows of 37px and the viewport is
  // a few hundred, so a mounted-row count equal to the total would mean the hook is not windowing.
  const mounted = await countOf(page, CARRY_ROW)
  check(
    'the table is WINDOWED — far fewer rows are mounted than the ledger holds',
    mounted > 0 && mounted < CARRIED,
    `${String(mounted)} of ${String(CARRIED)} rows mounted`
  )

  for (const lane of ['all', 'worn', 'bags', 'depot', 'keyring']) {
    check(`…and there is a ${lane} chip`, (await countOf(page, chip(lane))) === 1)
  }
  check('…and NO bank chip', (await countOf(page, chip('bank'))) === 0)
}

/** Type into the search box and wait for the count line to settle on a new reading. */
async function search(page: Page, term: string): Promise<string> {
  await page.fill(CARRY_SEARCH, term, { timeout: 15_000 })
  const want = term === '' ? `${String(CARRIED)} of ${String(CARRIED)}` : null
  return settle(
    () => carryCount(page),
    (text) => (want === null ? text !== `${String(CARRIED)} of ${String(CARRIED)}` : text === want),
    { timeoutMs: 15_000, pollMs: 100 }
  )
}

async function stepSearch(page: Page): Promise<void> {
  // THE SEARCH IS OVER THE NAME ALONE, which is why `moonstone` is the term: four rows across three
  // different lanes (a +1 and a +3 in bags, two socketed copies), so a hit set of four proves the
  // box reaches the whole ledger rather than the visible window.
  const hits = await search(page, SEARCH_TERM)
  check(
    `searching "${SEARCH_TERM}" narrows the ledger to ${String(SEARCH_HITS)}`,
    hits === `${String(SEARCH_HITS)} of ${String(CARRIED)}`,
    hits
  )
  const rows = await countOf(page, CARRY_ROW)
  check('…and the table draws exactly those rows', rows === SEARCH_HITS, `${String(rows)} rows`)

  // A query nothing matches says so, rather than drawing an empty table with no explanation.
  const none = await search(page, 'zzzz-no-such-item')
  check('a query nothing matches reads 0, and the panel says so', none === `0 of ${String(CARRIED)}`, none)
  check('…with the empty line, not a bare table', (await countOf(page, CARRY_EMPTY)) === 1)

  const back = await search(page, '')
  check('clearing the box restores the whole ledger', back === `${String(CARRIED)} of ${String(CARRIED)}`, back)
}

async function stepChips(page: Page): Promise<void> {
  await page.click(chip('keyring'), { timeout: 15_000 })
  const filtered = await settle(
    () => carryCount(page),
    (t) => t !== `${String(CARRIED)} of ${String(CARRIED)}`,
    { timeoutMs: 15_000, pollMs: 100 }
  )
  check(
    `the Key rings chip filters the ledger to its own ${String(KEYRING)}`,
    filtered === `${String(KEYRING)} of ${String(CARRIED)}`,
    filtered
  )
  // Every drawn row belongs to the lane that was clicked — the chip is a filter, not a sort.
  const stray = await page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getAttribute('data-lane') !== 'keyring').length,
    CARRY_ROW
  )
  check('…and every drawn row is a key-ring row', stray === 0, `${String(stray)} stray rows`)

  // Clicking the chip you are already on clears it — the same affordance both ways.
  await page.click(chip('keyring'), { timeout: 15_000 })
  const cleared = await settle(
    () => carryCount(page),
    (t) => t === `${String(CARRIED)} of ${String(CARRIED)}`,
    { timeoutMs: 15_000, pollMs: 100 }
  )
  check('…and clicking it again clears the filter', cleared === `${String(CARRIED)} of ${String(CARRIED)}`, cleared)
}

/** The app's ONE scroller between a view and the window — how tall it thinks this tab is. */
function contentHeight(page: Page): Promise<number> {
  return page.evaluate(
    () => (document.querySelector('[data-testid="app-content"]') as HTMLElement | null)?.scrollHeight ?? -1
  )
}

/**
 * THE GROWING-LIST LAW, measured — in the form that actually protects anything.
 *
 * The law exists to stop a page whose height is a function of the DATA: an append-only panel that
 * grows without bound and squeezes its siblings to nothing. That is the identity asserted here —
 * search the ledger down to four rows and the page must be EXACTLY as tall as it was with a hundred
 * and twenty-three, because the panel is windowed inside a box whose height does not know how many
 * rows exist. A dump ten times the size of the fixture would move neither number.
 *
 * The page DOES scroll on the default 1280x860 window, and that is a deliberate, measured trade
 * written up in CharacterView's header: the sheet above takes ~656px of a ~740px content area, so a
 * ledger with no floor gets one row. The half of the law with no carve-outs anywhere — the WINDOW
 * itself never scrolling, the shell being 100vh — is asserted separately and strictly.
 */
async function stepLayout(page: Page): Promise<void> {
  const over = await pageOverflow(page)
  check(
    'the WINDOW itself never scrolls (the shell is 100vh; a document scrollbar means the chrome moved)',
    over.doc === 0,
    `document +${String(over.doc)}px`
  )

  const scrolls = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    return !!el && el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY === 'auto'
  }, '[data-testid="character-carry-list"]')
  check('the ledger clips inside a scroller of its own, and is using it', scrolls)

  // THE IDENTITY. Same tab, same window, a thirtieth of the rows — same page height.
  const full = await contentHeight(page)
  await search(page, SEARCH_TERM)
  const narrowed = await contentHeight(page)
  check(
    `the page height does NOT depend on how many rows the dump holds (${String(CARRIED)} vs ${String(SEARCH_HITS)})`,
    full > 0 && full === narrowed,
    `${String(full)}px vs ${String(narrowed)}px`
  )
  await search(page, '')
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: production-shaped build on a staged log + a staged inventory dump…')
  const { app, close } = await launchOnFixture('e2e-planner.log', { inventory: DUMP })

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })
    await answerNotice(page)

    if (await stepReleased(page)) {
      await stepSheet(page)
      await stepCarry(page)
      await stepLayout(page)
      await stepSearch(page)
      await stepChips(page)
      // JOS-329, and it runs LAST because it is the only step that leaves the tab. The carry-all
      // box was `useState`, so a glance at another module emptied it; the session tier fixes that
      // without breaking the promise JOS-327's own header made about a FRESH LAUNCH (CarryAll.tsx
      // carries the rewritten paragraph). It hands the box back empty for the teardown.
      await stepCarryMemory(page, SEARCH_TERM)
    } else {
      note('the Character tab never mounted — every claim below it is unmeasured, not passing')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'character-sheet-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the character-sheet spec did not complete')
  process.exitCode = 1
})
