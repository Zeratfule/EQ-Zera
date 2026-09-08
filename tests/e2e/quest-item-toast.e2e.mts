/**
 * Headless Electron smoke test for the QUEST-ITEM DROP POPUP (ROADMAP.md §1).
 *
 * THE CLAIM. A live loot line naming an item the committed quest catalog knows produces a
 * celebration card that says what the drop is FOR: the quest(s) that want it, a window of their
 * steps, and the step naming the item lit. Every pure half is pinned elsewhere — the item→quest
 * index in tests/questCatalog.test.mts, the card's cut (window, caps, `before`/`after`, `litStep`)
 * in the toastQuest tests. What no unit test can claim is that THE PIECES ARE WIRED: a line
 * arriving in a tailed log crosses the engine's live fold, the renderer's detector, main's
 * validation and catalog join, and lands in the toast window's DOM as a drawn quest block whose
 * click opens that quest in the Quests tab.
 *
 * REPLAY NEVER POPS, and that is asserted FIRST. The fixture is replayed at boot and a startup
 * replay describes the PAST (AGENTS.md: hydration seeds a silent baseline); a quest item looted
 * an hour ago is not news. So the spec proves the absence before it writes the line that must
 * produce the presence, which is the only order in which either claim means anything.
 *
 * WHY BONE CHIPS. The committed catalog names it as a `requiredItems` turn-in for twenty-one
 * quests, eighteen of which have a STEP that spells it — the classic four-chip hand-ins (Bone
 * Chips (Kaladim), Bone Chips Felwithe, Bone Chips Field of Bone) among them. That is exactly the
 * shape this feature exists for: a common drop a new player has no idea is wanted anywhere, whose
 * card can therefore light a real step rather than fall back to the quest's opening.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode: the toast overlay here is created,
 * loaded and driven off-screen. It has no pointer, so `el.click()` is how a click is made — a real
 * DOM click React's delegated listener cannot tell from a human's (tests/e2e/toastDeepLinkSteps.mts).
 *
 * AND THE CARD IS ON A CLOCK. A detector-sent card holds for the config's 6 s and the hidden
 * window cannot be hovered to pin it, so the read and the deep-link CLICK happen in ONE evaluate
 * the moment the card is seen. Splitting them would make the deep link a race against the queue
 * rather than a claim about the link.
 *
 * Run: `node --import tsx tests/e2e/quest-item-toast.e2e.mts`.
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

/** The looted item under test — see the header for why this one. */
const ITEM = 'Bone Chips'

/** The line the log gets, in the client's own dashed self-loot spelling (engine parse/world.rs). */
const LOOT_LINE = `--You have looted a ${ITEM} from a decaying skeleton corpse.--`

/** The quest-item card, by the kind main stamped on it. */
const QUEST_CARD = '[data-toast-kind="questItem"]'

/** The toast overlay's page, identified by the `?kind=` query its window was opened with. */
async function findToastWindow(app: ElectronApplication): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=toast')) return w
  }
  return null
}

/** Poll until the toast window exists (window creation + page load is asynchronous). */
function waitForToastWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page | null> {
  return settle(() => findToastWindow(app), (w) => w !== null, { timeoutMs })
}

/** Every rendered card's text, in stack order. */
function cardTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast-card"]')].map(
      (el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )
  )
}

/** What the quest-item card says, plus the block a reader would click. */
interface CardSnap {
  text: string
  subtitle: string
  quests: number
  steps: number
  lit: string[]
  clicked: { name: string; page: string } | null
}

/**
 * Read the quest-item card AND click its first quest block, in one round trip.
 *
 * One evaluate because the card is on a 6 s clock (header): everything this spec wants to know
 * about the card, and the one click whose landing it wants to prove, are taken while the card is
 * demonstrably on screen. The click is a real DOM click on the block itself — the affordance a
 * player aims at — not a synthetic call to the overlay's `focusApp` bridge.
 */
function readAndClick(page: Page): Promise<CardSnap | null> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-toast-kind="questItem"]')
    if (!card) return null
    // NO NAMED INNER FUNCTION HERE, on purpose: tsx compiles this file with esbuild's keepNames,
    // which wraps every named function in a `__name(...)` helper that exists only in the Node
    // bundle. The callback is serialised and re-evaluated in the window, where that helper is
    // undefined, and the whole evaluate throws ReferenceError. Anonymous arrows handed straight to
    // `map` get no name and so no wrapper.
    const blocks = [...card.querySelectorAll('[data-testid="toast-quest"]')]
    const first = blocks[0] as HTMLElement | undefined
    const sub = card.querySelector('[data-testid="toast-subtitle"]') as HTMLElement | null
    const nameEl = first?.querySelector('[data-testid="toast-quest-name"]') as HTMLElement | null | undefined
    const snap = {
      text: (card as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      subtitle: sub ? sub.innerText.replace(/\s+/g, ' ').trim() : '',
      quests: blocks.length,
      steps: card.querySelectorAll('[data-testid="toast-quest-step"]').length,
      lit: [...card.querySelectorAll('[data-testid="toast-quest-step"][data-lit="true"]')].map((s) =>
        (s as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      ),
      clicked: first
        ? { name: nameEl ? nameEl.innerText.replace(/\s+/g, ' ').trim() : '', page: first.getAttribute('data-page') ?? '' }
        : null
    }
    first?.click()
    return snap
  })
}

/**
 * The introduction card (JOS-83) is what a fresh install sees first, and every launch here is a
 * fresh install. It is not this spec's claim — toast.e2e.mts owns it — so it is closed and the
 * lane is put back to empty, which is the state the absence assertion below needs.
 */
async function stepClearIntro(toast: Page): Promise<void> {
  const cards = await settle(() => cardTexts(toast), (c) => c.length >= 1, { timeoutMs: 20_000 })
  if (cards.length === 0) {
    note('no introduction card to clear — the lane was already empty')
    return
  }
  await toast.evaluate(() => {
    ;(document.querySelector('[data-testid="toast-close"]') as HTMLElement | null)?.click()
  })
  const rest = await settleStable(() => cardTexts(toast), { timeoutMs: 10_000, stable: 4, pollMs: 150 })
  check('the introduction card clears, leaving the celebration lane empty', rest.length === 0, rest.join(' | '))
}

/**
 * REPLAY NEVER POPS. The staged fixture is folded at boot; whatever it contains is history, and
 * history is not a celebration. The positive signal for an absence is the count HOLDING STILL
 * with the app live, which is the discipline every other absence assertion in this suite uses.
 */
async function stepNoReplayPopup(toast: Page): Promise<void> {
  const settled = await settleStable(() => countOf(toast, QUEST_CARD), { timeoutMs: 8_000, stable: 5, pollMs: 150 })
  check(
    'the startup replay celebrates NOTHING - a quest item already in the log is not news',
    settled === 0,
    `${String(settled)} quest-item card(s)`
  )
}

/**
 * THE LIVE DROP. One line, written into the very log the app is tailing, travelling chokidar →
 * tailer → the engine's live fold → the loot delta → the detector → main's catalog join → the
 * overlay. Thirty seconds is the budget because that whole chain has to happen, not because any
 * part of it is slow.
 */
async function stepLiveDrop(toast: Page, log: FixtureLog): Promise<CardSnap | null> {
  log.append(LOOT_LINE)
  const found = await settle(() => countOf(toast, QUEST_CARD), (n) => n >= 1, { timeoutMs: 30_000 })
  if (!check(`a LIVE loot of ${ITEM} pops a quest-item card`, found >= 1, `${String(found)} card(s)`)) {
    return null
  }
  const snap = await readAndClick(toast)
  if (!check('…and the card was still readable when the spec reached it', snap !== null)) return null
  const s = snap as CardSnap
  check('…naming the item the log said was looted', s.text.includes(ITEM), s.text.slice(0, 200))
  check(
    '…and saying WHAT it is, in the subtitle rather than in the reader’s head',
    s.subtitle.includes('Quest item'),
    s.subtitle || '(no subtitle)'
  )
  check(
    `…carrying at least one quest that wants ${ITEM} (the catalog knows 21, Bone Chips (Kaladim) among them)`,
    s.quests >= 1,
    `${String(s.quests)} quest block(s)`
  )
  check('…printed as actual STEPS, not just a quest name', s.steps >= 1, `${String(s.steps)} step(s)`)
  check(
    '…with the step that names the item LIT, which is the whole point of the window',
    s.lit.some((t) => t.toLowerCase().includes(ITEM.toLowerCase())),
    s.lit.join(' | ') || 'no lit step'
  )
  return s
}

/**
 * THE DEEP LINK. The block was clicked in the step above; this is where it landed.
 *
 * The Quests tab opens the page the block named, and the title on screen is the name the block
 * printed — one quest, spelled the same on both sides of the link. Anything less would let the
 * card advertise a quest and the tab open another.
 */
async function stepDeepLink(mainPage: Page, snap: CardSnap): Promise<void> {
  const clicked = snap.clicked
  if (!check('the card offers a quest block to click', clicked !== null && clicked.page !== '', JSON.stringify(clicked))) {
    return
  }
  const target = clicked as { name: string; page: string }
  const landed = await mainPage
    .waitForSelector('[data-testid="quest-page"]', { timeout: 20_000 })
    .then(
      () => true,
      () => false
    )
  if (!check('clicking a quest block on the toast opens that quest’s page in the Quests tab', landed, target.page)) {
    return
  }
  const title = await mainPage.evaluate(
    () => (document.querySelector('[data-testid="quest-page-title"]') as HTMLElement | null)?.innerText.trim() ?? ''
  )
  check(
    '…and it is the quest the card named, not merely some quest',
    title === target.name,
    `page reads "${title}", card said "${target.name}" (${target.page})`
  )
}

/**
 * PREFERENCES AGREES WITH THE WINDOW. The popup is on out of the box, so the panel's job is to
 * show the state the app is actually in rather than to hold a second opinion of it. The switch's
 * testid sits on the MUI root, so the checkbox is the input inside it, and it is READ UNTIL IT
 * SETTLES because the state arrives from main over IPC a beat after the pane mounts.
 */
async function stepPreferences(page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="prefs-rail-overlays"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-overlays"]')
  await page.waitForSelector('[data-testid="pref-quest-toast"]', { timeout: 15_000 }).catch(() => null)
  if (!check('Preferences → Overlays offers the quest-item popup', (await countOf(page, '[data-testid="pref-quest-toast"]')) === 1)) {
    return
  }
  const on = await settle(
    () =>
      page.evaluate(
        (sel) => (document.querySelector(sel) as HTMLInputElement | null)?.checked,
        '[data-testid="pref-quest-toast-enabled"] input'
      ),
    (v) => v === true,
    { timeoutMs: 10_000 }
  )
  check('…with its switch already ON, matching the card that popped unprompted', on === true, String(on))
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against a staged copy of tests/fixtures/e2e-toast.log…')
  // Staged HERE rather than by name, because this spec's whole subject is a line written while
  // the app is up: holding the `FixtureLog` is what makes `log.append` possible (gear.e2e.mts).
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
      const snap = await stepLiveDrop(t, log)
      if (snap) await stepDeepLink(page, snap)
      await stepPreferences(page)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'quest-item-toast-FAIL')
  } finally {
    await close()
    await log.dispose()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the quest-item toast spec did not complete')
  process.exitCode = 1
})
