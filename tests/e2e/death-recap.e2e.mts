/**
 * Headless Electron smoke test for the DEATH RECAP (ROADMAP item 7).
 *
 * THE CLAIM. EverQuest tells you that you died and nothing else. This feature answers the rest —
 * who killed you, what was landing, and how much of it — in two places: a celebration card the
 * instant it happens, and an Overview card that keeps it readable afterwards. Both are drawn from
 * ONE pure module (`features/deaths/deathCard.ts`, pinned by tests/deathCard.test.mts), so what no
 * unit test can claim is that THE PIECES ARE WIRED: a burst of incoming lines and a `slain by` line
 * arriving in a tailed log cross the engine's live fold, the `deaths` module's fifteen-second ring,
 * the renderer's detector, main's validation and the toast window's DOM — and the same recap lands
 * on the Overview card behind it.
 *
 * REPLAY NEVER POPS, and that is asserted FIRST. The deaths module publishes a recap for EVERY past
 * death, historical ones included — a fold cannot tell a death it is replaying from one that just
 * happened and may not read a wall clock to find out (deathTypes.ts). Gating on a LIVE transition
 * is the RENDERER's job, and this spec proves the absence before it writes the lines that must
 * produce the presence, which is the only order in which either claim means anything.
 *
 * THE FIXTURE HOLDS NO DEATH AT ALL. `tests/fixtures/e2e-toast.log` has zero `slain by` lines
 * (measured), so the Overview card's opening state here is its EMPTY state — which makes the second
 * half of this spec a genuine transition from "no deaths in this log" to a named killer rather than
 * an assertion about which of several deaths is newest.
 *
 * THE LINES ARE COPIED VERBATIM IN SHAPE from tests/fixtures/w44-poison-slow-per-mob.log, which
 * holds a real death: three `A fire giant warrior <verb> YOU for N points of damage.` lines and the
 * `You have been slain by a fire giant warrior!` that closed them. Inventing a shape here would
 * test the harness's spelling rather than the parser's.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode; the toast overlay is created, loaded
 * and driven off-screen. AND THE CARD IS ON A CLOCK — a detector-sent card holds for the config's
 * 6 s and a hidden window cannot be hovered to pin it, so the card is read in ONE evaluate the
 * moment it is seen.
 *
 * Run: `node --import tsx tests/e2e/death-recap.e2e.mts`.
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
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

/** The killer the appended burst names, as the log spells it. */
const KILLER = 'a fire giant warrior'

/**
 * The burst, in the client's own shapes. Three swings then the death line — all in one `append`,
 * so they share one EQ timestamp and land well inside the module's fifteen-second window.
 */
const BURST = [
  'A fire giant warrior hits YOU for 106 points of damage.',
  'A fire giant warrior cleaves YOU for 143 points of damage.',
  'A fire giant warrior bashes YOU for 27 points of damage.',
  'You have been knocked unconscious!',
  'You have been slain by a fire giant warrior!'
]

/** Σ of the three numbers above — what the recap's window must add up to. */
const TAKEN = 106 + 143 + 27

/** The recap card, by the kind main stamped on it. */
const DEATH_CARD = '[data-toast-kind="death"]'

/** The Overview surface. */
const CARD = '[data-testid="overview-death"]'
const KILLER_LINE = '[data-testid="overview-death-killer"]'
const HIT = '[data-testid="overview-death-hit"]'

/** The toast overlay's page, identified by the `?kind=` query its window was opened with. */
async function findToastWindow(app: ElectronApplication): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=toast')) return w
  }
  return null
}

function waitForToastWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page | null> {
  return settle(() => findToastWindow(app), (w) => w !== null, { timeoutMs })
}

/** Rendered text of the first match; '' when the node is not mounted. */
function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    sel
  )
}

/** Every rendered card's text, in stack order. */
function cardTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast-card"]')].map((el) =>
      (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )
  )
}

/**
 * The introduction card (JOS-83) is what a fresh install sees first, and every launch here is one.
 * It is not this spec's claim (toast.e2e.mts owns it), so it is closed and the lane is put back to
 * empty — which is the state the absence assertion below needs.
 */
async function stepClearIntro(toast: Page): Promise<void> {
  const cards = await settle(() => cardTexts(toast), (c) => c.length >= 1, { timeoutMs: 20_000 })
  if (cards.length === 0) {
    note('no introduction card to clear - the lane was already empty')
    return
  }
  await toast.evaluate(() => {
    ;(document.querySelector('[data-testid="toast-close"]') as HTMLElement | null)?.click()
  })
  const rest = await settleStable(() => cardTexts(toast), { timeoutMs: 10_000, stable: 4, pollMs: 150 })
  check('the introduction card clears, leaving the celebration lane empty', rest.length === 0, rest.join(' | '))
}

/**
 * REPLAY NEVER POPS. Whatever the staged fixture contains is history, and history is not news. The
 * positive signal for an absence is the count HOLDING STILL with the app live.
 */
async function stepNoReplayPopup(toast: Page): Promise<void> {
  const settled = await settleStable(() => countOf(toast, DEATH_CARD), { timeoutMs: 8_000, stable: 5, pollMs: 150 })
  check(
    'the startup replay celebrates NOTHING - a death already in the log is not news',
    settled === 0,
    `${String(settled)} death card(s)`
  )
}

/**
 * THE OVERVIEW CARD BEFORE ANYTHING HAPPENS. `e2e-toast.log` holds no `slain by` line at all, so
 * the honest reading is the empty state — and reaching it is also what proves the renderer has
 * READ the deaths module, which is what seeds the detector's silent baseline.
 */
async function stepEmptyState(page: Page): Promise<void> {
  const up = await page.waitForSelector(CARD, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the Overview carries a "Last death" card', up)) return
  const text = await settle(() => textOf(page, CARD), (t) => t !== '', { timeoutMs: 15_000 })
  check(
    '…and with no death in the log it says so, rather than drawing a blank card',
    text.includes('No deaths in this log.'),
    text.slice(0, 160)
  )
  check('…and mounts no hit rows at all', (await countOf(page, HIT)) === 0)
}

/** What the recap card said, read in one round trip because the card is on a 6 s clock. */
interface CardSnap {
  text: string
  title: string
  subtitle: string
}

function readCard(page: Page): Promise<CardSnap | null> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-toast-kind="death"]')
    if (!card) return null
    // NO NAMED INNER FUNCTION HERE: tsx compiles this file with esbuild's keepNames, which wraps a
    // named function in a `__name(...)` helper that exists only in the Node bundle. The callback is
    // re-evaluated in the window, where that helper is undefined.
    const title = card.querySelector('[data-testid="toast-title"]') as HTMLElement | null
    const sub = card.querySelector('[data-testid="toast-subtitle"]') as HTMLElement | null
    return {
      text: (card as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      title: title ? title.innerText.replace(/\s+/g, ' ').trim() : '',
      subtitle: sub ? sub.innerText.replace(/\s+/g, ' ').trim() : ''
    }
  })
}

/**
 * THE LIVE DEATH. Five lines written into the very log the app is tailing, travelling chokidar →
 * tailer → the engine's live fold → the deaths module's window → the delta → the detector → main's
 * validation → the overlay.
 */
async function stepLiveDeath(toast: Page, log: FixtureLog): Promise<void> {
  log.append(...BURST)
  const found = await settle(() => countOf(toast, DEATH_CARD), (n) => n >= 1, { timeoutMs: 30_000 })
  if (!check('a LIVE death pops a recap card', found >= 1, `${String(found)} card(s)`)) return
  const snap = await readCard(toast)
  if (!check('…and the card was still readable when the spec reached it', snap !== null)) return
  const s = snap as CardSnap
  check('…whose title says you died', /you died/i.test(s.title), s.title || '(no title)')
  check('…and NAMES THE KILLER the log named', s.title.toLowerCase().includes(KILLER), s.title)
  check(
    `…and whose subtitle states the window's damage (${String(TAKEN)})`,
    s.subtitle.includes(String(TAKEN)),
    s.subtitle || '(no subtitle)'
  )
  check(
    '…and says what window that number covers, rather than claiming it is what killed you',
    s.subtitle.includes('in the last 15 s') && !/killed you/i.test(s.subtitle),
    s.subtitle
  )
  check('…and names the attacker who dealt most of it', s.subtitle.toLowerCase().includes(KILLER), s.subtitle)
}

/**
 * …AND THE SAME RECAP IS ON THE OVERVIEW. The card that pops is a card on a clock; this one is the
 * one still on screen when the player alt-tabs back after the corpse run.
 */
async function stepOverviewCard(page: Page): Promise<void> {
  const killer = await settle(() => textOf(page, KILLER_LINE), (t) => t.toLowerCase().includes(KILLER), {
    timeoutMs: 30_000
  })
  if (!check('the Overview card now names the killer', killer.toLowerCase().includes(KILLER), killer || '(empty)')) {
    return
  }
  const hits = await settle(() => countOf(page, HIT), (n) => n >= 1, { timeoutMs: 15_000 })
  check('…and lists the instants that landed in the window', hits >= 1, `${String(hits)} hit row(s)`)
  const text = await textOf(page, CARD)
  check(
    `…with the window's total (${String(TAKEN)}) and a footer counting the log's deaths`,
    text.includes(String(TAKEN)) && text.includes('1 death in this log'),
    text.slice(0, 240)
  )
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against a staged copy of tests/fixtures/e2e-toast.log…')
  // Staged HERE rather than by name: this spec's whole subject is lines written while the app is
  // up, and holding the `FixtureLog` is what makes `log.append` possible.
  const log = stageFixture('e2e-toast.log')
  const { app, close } = await launchOnFixture(log)

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })

    const toast = await waitForToastWindow(app)
    if (check('the celebration overlay is up (it is on for a fresh install)', toast !== null)) {
      const t = toast as Page
      await stepClearIntro(t)
      await stepNoReplayPopup(t)
      await stepEmptyState(page)
      await stepLiveDeath(t, log)
      await stepOverviewCard(page)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'death-recap-FAIL')
  } finally {
    await close()
    await log.dispose()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the death-recap spec did not complete')
  process.exitCode = 1
})
