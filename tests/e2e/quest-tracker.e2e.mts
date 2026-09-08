/**
 * Headless Electron integration test for THE QUEST TRACKER (EQ Zera).
 *
 * THE CLAIM. Pin a catalog quest and it goes to the top of the Quests tab as a checklist. The LOG
 * then ticks what it can witness: a completed turn-in to the quest's giver ticks the hand-in steps
 * naming the items it carried, and when every required item has reached the giver the quest is
 * COMPLETE — a celebration card, a Complete chip on the tracked row, and a dated line on the page.
 * A HAIL step ticks the same way once the log carries a greeting to the NPC it names. The steps the
 * log CANNOT witness stay the player's, and their ticks survive a restart.
 *
 * WHY THIS NEEDS A REAL APP. Every rule is unit-tested against the real pure code
 * (tests/questProgress.test.mts, tests/questPins.test.mts). What no unit test can see is the CHAIN:
 * a trade line in the log travelling chokidar → tailer → the engine's live fold → the turnins
 * module → IPC → the renderer's evidence fold → the always-mounted completion watch → main's toast
 * validation → the overlay window, and — the other direction — a click on a checkbox travelling
 * into electron-store and back out of a second process. JOS-87 is this repo's standing reminder
 * that a chain like that breaks at a seam every unit test is happy with.
 *
 * THE QUEST IS "A Job for Nanrum", and it is chosen rather than invented: the committed catalog
 * gives it FIVE steps, and between them they cover every author this checklist has. A hand-in step
 * names the one required item (Fire Beetle Eye), so ONE trade to the one giver (Basher Nanrum)
 * completes the quest and ticks that step. A hail step names the giver, so ONE `You say, 'Hail,
 * Basher Nanrum'` ticks that one. And `You say, 'What job?'` is a step the log states NOTHING about
 * — no hail, no hand-in, no item — so it is the manual tick whose survival across a restart is the
 * third claim. Three witnesses, three steps, one real quest.
 *
 * EVERY LINE SHAPE IS COPIED FROM tests/e2e/sky-turnin.e2e.mts, which took them from the owner's
 * real log (the awaiting-sample law):
 *   `--You have looted a <Item> from <mob>'s corpse.--`   (both halves observed)
 *   `You offered 1 <Item> to <NPC>.`                      (shape verbatim)
 *   `You complete the trade with <NPC>.`                  (shape verbatim)
 * …and the hail is the catalog's own spelling of the step, which is also the log's:
 *   `You say, 'Hail, <NPC>'`                              (shared/hailTypes.ts states the family)
 *
 * REPLAY NEVER CELEBRATES, and it is asserted FIRST. The staged fixture is folded at boot and a
 * startup replay describes the PAST; a quest finished an hour ago is not news. The spec proves the
 * absence before it writes the lines that must produce the presence, which is the only order in
 * which either claim means anything.
 *
 * TWO LAUNCHES, THE SECOND ON A FRESH LOG. That is the point of it — the STORE, not the log, has to
 * remember the hand tick. Launch 2 gets the SAME userData dir and a newly staged fixture carrying
 * none of launch 1's appended lines, which is the truncated-log / character-epoch case the
 * persistence exists for.
 *
 * NO WINDOW IS EVER SHOWN: `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the single-instance
 * lock, and points `userData` at a throwaway temp dir per launch.
 *
 * Run: `node --import tsx tests/e2e/quest-tracker.e2e.mts`.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle, settleStable } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const NAV_QUESTS = '[data-testid="nav-quests"]'
const NAV_OVERVIEW = '[data-testid="nav-overview"]'
const SEARCH = '[data-testid="quests-search"]'
const ROW = '[data-testid="quest-row"]'
const PAGE = '[data-testid="quest-page"]'
const TITLE = '[data-testid="quest-page-title"]'
const PIN = '[data-testid="quest-pin"]'
const BACK = '[data-testid="quest-back"]'
const TRACKED = '[data-testid="quest-tracked"]'
const TRACKED_ROW = '[data-testid="quest-tracked-row"]'
const TRACKED_DONE = '[data-testid="quest-tracked-complete"]'
const COMPLETE = '[data-testid="quest-complete"]'
const STEP = '[data-testid="quest-step"]'
const CHECK = '[data-testid="quest-step-check"]'
/** The celebration card this feature sends, by the kind main stamped on it. */
const QUEST_CARD = '[data-toast-kind="skyQuestComplete"]'

const QUEST = 'A Job for Nanrum'
const GIVER = 'Basher Nanrum'
const ITEM = 'Fire Beetle Eye'
const LOOT = `--You have looted a ${ITEM} from a fire beetle's corpse.--`
/** One completed trade: an offer per item, then the line that closes the group. */
const TURN_IN = [`You offered 1 ${ITEM} to ${GIVER}.`, `You complete the trade with ${GIVER}.`]
/** The greeting the catalog spells as step 2, in the log's own words (shared/hailTypes.ts). */
const HAIL = `You say, 'Hail, ${GIVER}'`

/** The toast overlay's page, identified by the `?kind=` query its window was opened with. */
async function findToastWindow(app: ElectronApplication): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=toast')) return w
  }
  return null
}

/** Every rendered card's text, in stack order. */
function cardTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast-card"]')].map((el) =>
      (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )
  )
}

/** The tracked section's whole text. Empty when it is not mounted. */
function trackedText(page: Page): Promise<string> {
  return page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', TRACKED)
}

/** "done/total" off the tracked row's own progress caption. `null` when there is no row. */
function trackedSteps(page: Page): Promise<string | null> {
  return page.evaluate((sel) => {
    const m = /(\d+)\/(\d+) steps/.exec(document.querySelector(sel)?.textContent ?? '')
    return m ? `${m[1]}/${m[2]}` : null
  }, TRACKED_ROW)
}

/**
 * The Pin button's label, UPPER-CASED — the control whose direction is the whole state question.
 * MUI's button styling text-transforms it, and `innerText` reflects the rendered transform, so the
 * case is the theme's business and not this spec's.
 */
function pinLabel(page: Page): Promise<string> {
  return page.evaluate(
    (sel) => ((document.querySelector(sel) as HTMLElement | null)?.innerText ?? '').trim().toUpperCase(),
    PIN
  )
}

/** One step's state, off the row's own data attributes and its checkbox input. */
interface StepState {
  index: number
  text: string
  auto: boolean
  checked: boolean
}

/**
 * Every step's state in one round trip. NO NAMED INNER FUNCTION inside the evaluate, on purpose:
 * tsx compiles this file with esbuild's keepNames, which wraps every named function in a `__name`
 * helper that exists only in the Node bundle — the callback is serialised and re-evaluated in the
 * window, where that helper is undefined, and the whole evaluate throws ReferenceError. Anonymous
 * arrows handed straight to `map` get no name and so no wrapper.
 */
function steps(page: Page): Promise<StepState[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((el, i) => ({
        index: Number(el.getAttribute('data-step') ?? String(i)),
        text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        auto: el.getAttribute('data-auto') === 'true',
        checked: el.getAttribute('data-checked') === 'true'
      })),
    STEP
  )
}

/** Open the Quests tab and drill into the quest this spec is about. */
async function openQuest(page: Page): Promise<boolean> {
  await page.click(NAV_QUESTS, { timeout: 30_000 })
  const shown = await page.waitForSelector(SEARCH, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the Quests tab opens', shown)) return false
  // `quests-search` rides `slotProps.htmlInput`, so the testid IS the input — no ` input` suffix
  // here, unlike the Sky tab's `posky-search`, which carries it on the TextField root.
  await page.fill(SEARCH, 'Nanrum')
  // The list under the box is the BROWSE list until the deferred query lands, and that list is
  // capped at 250 — so "at least one row" is satisfied before a single character has been searched
  // for. The honest wait is for the list to become a SEARCH result, which is capped at 80.
  const found = await settle(() => countOf(page, ROW), (n) => n >= 1 && n <= 80, { timeoutMs: 15_000 })
  if (!check('searching "Nanrum" narrows the list to search hits', found >= 1 && found <= 80, `rows=${String(found)}`)) {
    return false
  }
  // The search is scored, so the row is found BY NAME rather than by position: a re-scrape that
  // adds a better "Nanrum" hit must not silently make this spec assert about a different quest.
  const clicked = await page.evaluate(
    ([sel, name]) => {
      for (const el of document.querySelectorAll(sel)) {
        if ((el as HTMLElement).innerText.includes(name)) {
          ;(el as HTMLElement).click()
          return true
        }
      }
      return false
    },
    [ROW, QUEST] as const
  )
  if (!check(`the results list ${QUEST}`, clicked)) return false
  const landed = await page.waitForSelector(PAGE, { timeout: 20_000 }).then(
    () => true,
    () => false
  )
  const title = await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '', TITLE)
  return check(`…and opens ${QUEST}`, landed && title === QUEST, `title="${title}"`)
}

/**
 * REPLAY NEVER CELEBRATES. The staged fixture is folded at boot; whatever it holds is history. The
 * positive signal for an absence is the count HOLDING STILL with the app live, the discipline every
 * other absence assertion in this suite uses.
 */
async function stepNoReplayCelebration(toast: Page): Promise<void> {
  const settled = await settleStable(() => countOf(toast, QUEST_CARD), { timeoutMs: 8_000, stable: 5, pollMs: 150 })
  check(
    'the startup replay celebrates NOTHING - a quest already finished in the log is not news',
    settled === 0,
    `${String(settled)} quest-complete card(s)`
  )
}

/** Nothing is tracked on a fresh install, and the section says how to change that. */
async function stepEmptyTracker(page: Page): Promise<void> {
  const text = await settle(() => trackedText(page), (t) => t !== '', { timeoutMs: 20_000 })
  check(
    'a fresh install tracks nothing, and the section says what would put a quest on it',
    text.includes('Nothing tracked yet'),
    text.slice(0, 160)
  )
}

/** Pin it, go back, and read the row the tracker drew. */
async function stepPin(page: Page): Promise<void> {
  check('the page offers Track this quest', (await pinLabel(page)) === 'TRACK THIS QUEST')
  await page.click(PIN, { timeout: 15_000 })
  const label = await settle(() => pinLabel(page), (t) => t === 'TRACKING', { timeoutMs: 15_000 })
  check('…and pressing it says Tracking', label === 'TRACKING', label)

  await page.click(BACK, { timeout: 15_000 })
  const rows = await settle(() => countOf(page, TRACKED_ROW), (n) => n === 1, { timeoutMs: 15_000 })
  if (!check('the quest lands on the tracked list', rows === 1, `rows=${String(rows)}`)) return
  check(`…named ${QUEST}`, (await trackedText(page)).includes(QUEST))
  const progress = await trackedSteps(page)
  check(
    '…with a step count out of the walkthrough it actually has, and nothing ticked yet',
    progress === '0/5',
    `progress=${String(progress)}`
  )
  check('…and no Complete chip', (await countOf(page, TRACKED_DONE)) === 0)
}

/**
 * THE HEADLINE. Loot the item, hand it over, and the app concludes the quest is done — on the
 * tracked row, on the page, and in the celebration window, all off ONE trade.
 */
async function stepTurnIn(page: Page, toast: Page | null, log: FixtureLog, at: Date): Promise<void> {
  log.appendAt(at, LOOT)
  log.appendAt(new Date(at.getTime() + 30_000), ...TURN_IN)

  if (toast !== null) {
    const cards = await settle(() => countOf(toast, QUEST_CARD), (n) => n >= 1, { timeoutMs: 40_000 })
    if (check('A LIVE TURN-IN POPS A QUEST-COMPLETE CARD', cards >= 1, `${String(cards)} card(s)`)) {
      const texts = await cardTexts(toast)
      check(
        `…titled "Quest complete: ${QUEST}"`,
        texts.some((t) => t.includes(`Quest complete: ${QUEST}`)),
        texts.join(' | ').slice(0, 240)
      )
    }
  }

  const done = await settle(() => countOf(page, TRACKED_DONE), (n) => n === 1, { timeoutMs: 20_000 })
  check('…the tracked row shows Complete', done === 1, `chips=${String(done)}`)
  const progress = await trackedSteps(page)
  check('…and its step count moved, because the log ticked a step', progress === '1/5', `progress=${String(progress)}`)
}

/** On the page: the hand-in step is ticked BY THE LOG, and the completion is dated. */
async function stepPageAfterTurnIn(page: Page): Promise<void> {
  await page.click(TRACKED_ROW, { timeout: 15_000 })
  const landed = await page.waitForSelector(PAGE, { timeout: 20_000 }).then(
    () => true,
    () => false
  )
  if (!check('the tracked row opens the quest page', landed)) return

  const list = await settle(() => steps(page), (s) => s.length > 0, { timeoutMs: 15_000 })
  const auto = list.filter((s) => s.auto)
  check(
    'THE HAND-IN STEP IS TICKED BY THE LOG, and it is the step that names the item',
    auto.length === 1 && auto[0].text.includes(ITEM),
    auto.map((s) => s.text).join(' | ') || 'no auto step'
  )
  check('…and it is drawn checked', auto.length === 1 && auto[0].checked)
  // THE BEFORE HALF of the hail claim, and it is the half that makes the after half mean anything:
  // this log carries no greeting yet, so the step the catalog spells as one is untouched.
  const hail = list.filter((s) => s.text.includes('Hail'))
  check(
    'the hail step is untouched while the log carries no greeting',
    hail.length === 1 && !hail[0].auto && !hail[0].checked,
    hail.map((s) => `${s.text} auto=${String(s.auto)}`).join(' | ')
  )
  const line = await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '', COMPLETE)
  check('…and the page says the quest is completed, dated', /^Completed /.test(line), line || '(no completion line)')
}

/**
 * A HAIL TYPED RIGHT NOW TICKS THE STEP THAT NAMES THAT NPC — end to end.
 *
 * `tests/questProgress.test.mts` pins the rule (and pins that it runs through `giverMatches`, the
 * same giver fold the turn-in join uses). What only the real app can show is the CHAIN, and it is a
 * different chain from the turn-in above at every hop but the last: the line is parsed as a `hail`
 * event, folded by the engine's own `hails` module, published as `HailSnap`, read by
 * `features/quests/useQuestProgress.ts` and handed to `questProgress` as `QuestEvidence.hails`.
 * That field was typed and empty on every build until this one, so nothing before this spec could
 * have told a wired witness from a silent seam.
 *
 * The step must go AUTO, not merely checked: `data-auto="true"` is the log's authorship, and a
 * checkbox the player could have clicked is exactly what this is not.
 */
async function stepLiveHail(page: Page, log: FixtureLog): Promise<void> {
  log.append(HAIL)
  const after = await settle(
    () => steps(page),
    (s) => s.some((row) => row.text.includes('Hail') && row.auto),
    { timeoutMs: 30_000 }
  )
  const hail = after.filter((s) => s.text.includes('Hail'))
  check(
    `THE HAIL STEP TICKS ITSELF once the log carries a greeting to ${GIVER}`,
    hail.length === 1 && hail[0].auto,
    hail.map((s) => `${s.text} auto=${String(s.auto)}`).join(' | ') || 'no hail step'
  )
  check('…and it is drawn checked, by the LOG rather than by a click', hail.length === 1 && hail[0].checked)
  // TWO auto steps now, and no more: the hand-in the trade ticked and the hail this line ticked.
  // A third would mean something is matching on more than the step it names.
  const auto = after.filter((s) => s.auto)
  check(
    '…and it is the ONLY step the greeting ticked',
    auto.length === 2,
    auto.map((s) => s.text).join(' | ')
  )
}

/**
 * A hand tick on `You say, 'What job?'` — the half of the checklist the log will never own.
 *
 * It is deliberately NOT the hail step any more (it was, until the `hails` module landed and the
 * log became able to tick that one). The step chosen here is the one the catalog states that no
 * witness in this app can ever match: not a hail, not a hand-in, naming no item. A restart claim
 * built on a step the log can re-derive would pass without the store having remembered anything.
 */
async function stepHandTick(page: Page): Promise<number> {
  const list = await steps(page)
  const manual = list.filter((s) => s.text.includes('What job'))
  if (!check('there is a step no witness can tick, to tick by hand', manual.length === 1)) return -1
  check('…and the log has indeed left it alone', !manual[0].auto && !manual[0].checked)
  const index = manual[0].index
  await page.click(`${CHECK}[data-step="${String(index)}"]`, { timeout: 15_000 })
  const after = await settle(
    () => steps(page),
    (s) => s.some((row) => row.index === index && row.checked),
    { timeoutMs: 15_000 }
  )
  check('ticking it by hand sticks', after.some((s) => s.index === index && s.checked))
  await page.click(BACK, { timeout: 15_000 })
  // 3 of 5: the hand-in the trade ticked, the hail the greeting ticked, and this one.
  const progress = await settle(() => trackedSteps(page), (v) => v === '3/5', { timeoutMs: 15_000 })
  check('…and the tracked row counts all three authors', progress === '3/5', `progress=${String(progress)}`)
  return index
}

/** THE STORE, not the log: a fresh log with none of those lines, and the tick is still there. */
async function stepRemembered(page: Page, index: number): Promise<void> {
  await page.click(NAV_QUESTS, { timeout: 30_000 })
  const rows = await settle(() => countOf(page, TRACKED_ROW), (n) => n === 1, { timeoutMs: 60_000 })
  if (!check('THE PIN SURVIVES A RESTART ON A LOG THAT NO LONGER SHOWS THE TURN-IN', rows === 1, `rows=${String(rows)}`)) {
    return
  }
  await page.click(TRACKED_ROW, { timeout: 15_000 })
  await page.waitForSelector(PAGE, { timeout: 20_000 })
  const list = await settle(() => steps(page), (s) => s.length > 0, { timeoutMs: 15_000 })
  const manual = list.filter((s) => s.index === index)
  check(
    '…AND SO DOES THE HAND TICK, which no log line could have re-derived',
    manual.length === 1 && manual[0].checked && !manual[0].auto,
    manual.map((s) => `checked=${String(s.checked)} auto=${String(s.auto)}`).join(' | ')
  )
  // BOTH log-ticked steps go with the log that stated them — the hand-in with its trade, and the
  // hail with its greeting. Neither is in the store, and neither should be.
  check(
    '…while BOTH log-ticked steps are gone with the log that stated them',
    list.filter((s) => s.auto).length === 0,
    list.filter((s) => s.auto).map((s) => s.text).join(' | ')
  )
  check('…and so is the completion line', (await countOf(page, COMPLETE)) === 0)
}

/**
 * LAUNCH 2, in its own function: the same userData dir over a NEWLY staged fixture, so the log the
 * app tails has none of launch 1's appended lines. Anything still on screen came out of the store.
 */
async function relaunch(userData: string, tickIndex: number): Promise<void> {
  console.log('launch 2: the SAME store, a FRESH log — the tick must come from the store…')
  const second = await launchOnFixture('e2e-toast.log', { userData })
  try {
    const restarted = await mainWindow(second.app)
    await restarted.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
    await stepRemembered(restarted, tickIndex)
    if (failures.length) await dumpArtifacts(restarted, 'quest-tracker-restart-FAIL')
  } finally {
    await second.close()
  }
}

async function main(): Promise<void> {
  buildIfStale()

  // Owned by this spec: the restart assertion IS the dir outliving a process.
  const userData = makeUserData()
  const log = stageFixture('e2e-toast.log')
  const now = Date.now()
  let tickIndex = -1
  try {
    console.log('launch 1: pin the quest, hand it in live, hail the giver live, and tick the third step by hand…')
    const first = await launchOnFixture(log, { userData })
    let page: Page | null = null
    try {
      page = await mainWindow(first.app)
      await page.waitForSelector(NAV_OVERVIEW, { timeout: 60_000 })
      const toast = await settle(() => findToastWindow(first.app), (w) => w !== null, { timeoutMs: 30_000 })
      if (toast === null) {
        note('the celebration overlay never came up - the card assertions are skipped')
      } else {
        await stepNoReplayCelebration(toast)
      }
      // The empty state is read BEFORE anything is pinned, on a userData dir nobody has written to.
      await page.click(NAV_QUESTS, { timeout: 30_000 })
      await page.waitForSelector(SEARCH, { timeout: 60_000 })
      await stepEmptyTracker(page)
      if (!(await openQuest(page))) throw new Error('never reached the quest page — nothing below can be asserted')
      await stepPin(page)
      await stepTurnIn(page, toast, log, new Date(now - 60_000))
      await stepPageAfterTurnIn(page)
      // STILL ON THE PAGE, so the greeting's effect is read where the before half was read.
      await stepLiveHail(page, log)
      tickIndex = await stepHandTick(page)
      if (failures.length) await dumpArtifacts(page, 'quest-tracker-FAIL')
    } finally {
      await first.close()
    }

    // LAUNCH 1'S STAGED INSTALL GOES AWAY BEFORE LAUNCH 2 CAN SEE IT, and that is load-bearing
    // rather than tidy: `resolveEqDir` persists a POSITIVE discovery (`eqDiscoveredRoot`) into the
    // very userData dir this restart shares, and revalidates it with one readdir. Leave launch 1's
    // Logs folder on disk and launch 2 revalidates straight back onto it — tailing the log that
    // still carries the turn-in, and turning "the store remembered" into a claim about nothing.
    // `dispose` is best-effort, so the outer finally calling it again costs nothing.
    await log.dispose()
    if (tickIndex < 0) note('no hand tick was made, so there is nothing for the restart to remember')
    else await relaunch(userData, tickIndex)
  } finally {
    await log.dispose()
    await removeUserData(userData)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the quest tracker spec did not complete')
  process.exitCode = 1
})
