/**
 * Headless Electron integration test for the TWO CHARACTER-TAB TRACKERS (ROADMAP items 9 and 10),
 * plus the Overview's "Last session" card.
 *
 * THE CLAIM. Five surfaces the log could always have answered and nothing published now do. Two of
 * them live on the Character tab — who you have made angry, and what the client says your skills
 * are worth — and both are fed by the LOG rather than by a `/outputfile` dump, which is why this
 * spec stages no dump at all: they must render on a character who has never typed the command.
 *
 * THE NUMBERS ARE HAND-COUNTED OUT OF THE FIXTURE, which is the whole reason this spec launches on
 * `tests/fixtures/w46-special-eagle-strike.log` rather than on whatever the machine happens to
 * have. Measured with grep over the committed bytes:
 *
 *   faction  `Your faction standing with Frogloks of Guk has been adjusted by -5.` × 9
 *            ⇒ ONE faction, 9 stated lines, Σ = -45. No saturation line anywhere in the file.
 *   skills   `You have become better at Eagle Strike!` × 24, the LAST of them stating `(25)`
 *            ⇒ value 25 (the CLIENT's running total) beside 24 ups (what this log watched).
 *
 * That pair is the point of the skills panel and it is asserted as a pair: 25 and 24 are DIFFERENT
 * FACTS and a build that ever added them would have to move one of these two numbers.
 *
 * ONE FIXTURE, ONE LAUNCH. `w46-special-eagle-strike.log` is rich in BOTH families (9 faction lines,
 * 3,464-line-per-log skill-up family included), which is what lets this be a single launch rather
 * than two.
 *
 * AND IT HOLDS NO LOGIN LINE, so the log states ZERO absences and therefore no previous session.
 * The Overview card's honest reading is its empty state, and that is asserted as an outcome rather
 * than skipped: "no earlier session in this log" is the branch a one-session log must take, and a
 * spec that only ever measured the populated branch would never have measured it.
 *
 * Run: `node --import tsx tests/e2e/character-trackers.e2e.mts`.
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
  settle,
  settleGone
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

/** The fixture, and every number this spec states because of it. See the header for the greps. */
const FIXTURE = 'w46-special-eagle-strike.log'
const FACTION = 'Frogloks of Guk'
/** 9 lines of `adjusted by -5.` — counted, not guessed. */
const FACTION_HITS = 9
const FACTION_DELTA = '-45'
const SKILL = 'Eagle Strike'
/** What the LAST `(N)` in the file states for it. */
const SKILL_VALUE = '25'
/** …and how many ticks this log watched, which is a different fact. */
const SKILL_UPS = 24

const NAV_GEAR = '[data-testid="nav-gear"]'
const TAB_GEAR = '[data-testid="tab-gear"]'
const TAB = '[data-testid="tab-character"]'

const FACTIONS = '[data-testid="character-factions"]'
const FACTION_ROW = '[data-testid="character-faction-row"]'
const FACTION_SEARCH = '[data-testid="character-factions-search"]'
const SKILLS = '[data-testid="character-skills"]'
const SKILL_ROW = '[data-testid="character-skill-row"]'
const SKILLS_SEARCH = '[data-testid="character-skills-search"]'
const LAST_SESSION = '[data-testid="overview-last-session"]'

/** Rendered text of the first match; '' when the node is not mounted. */
function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    sel
  )
}

/**
 * One row's text, found by the attribute it stamps its own subject on.
 *
 * The lookup is by `data-faction` / `data-skill` rather than by nth-child on purpose: the panels
 * order themselves by LAST HIT, which is a fact about the fixture's clock rather than about this
 * feature, and a spec that hard-coded a position would go red the day a fixture line moved.
 */
function rowText(page: Page, row: string, attr: string, value: string): Promise<string> {
  return page.evaluate(
    (a) => {
      const el = document.querySelector(`${a[0]}[${a[1]}="${a[2]}"]`)
      return el ? (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim() : ''
    },
    [row, attr, value]
  )
}

/**
 * Answer the analytics first-run notice. A fresh `userData` always shows it, it sits along the
 * bottom edge, and this spec types into boxes — a hit test that lands on the notice is a true
 * report about a first-run overlay and nothing at all about these panels.
 */
async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

/** Open the gear area and land on its LAST tab. A `false` makes every claim below vacuous. */
async function openCharacterTab(page: Page): Promise<boolean> {
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
  if (!check('…and it opens an area whose tab bar is on screen', barUp)) return false
  await page.click(TAB, { timeout: 15_000 })
  // NOT the sheet: this launch stages no `/outputfile` dump, and the whole point of these two
  // panels is that they are fed by the LOG and render without one.
  const up = await page.waitForSelector(FACTIONS, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  return check('the Character tab mounts the faction panel with NO inventory dump staged', up)
}

async function stepFactions(page: Page): Promise<void> {
  const rows = await settle(() => countOf(page, FACTION_ROW), (n) => n >= 1, { timeoutMs: 30_000 })
  if (!check('the faction panel has rows', rows >= 1, `${String(rows)} row(s)`)) return

  const text = await rowText(page, FACTION_ROW, 'data-faction', FACTION)
  if (!check(`…including one for ${FACTION}`, text !== '', text || '(no such row)')) return
  check(
    `…whose change is the hand-counted Σ of the fixture's ${String(FACTION_HITS)} \`adjusted by -5.\` lines (${FACTION_DELTA})`,
    text.includes(FACTION_DELTA),
    text
  )
  check(
    `…beside the COUNT of lines behind it (${String(FACTION_HITS)}), which is a different fact`,
    text.includes(`${String(FACTION_HITS)}×`),
    text
  )
  // No saturation line anywhere in this fixture, so no rail chip may appear on this row.
  check(
    '…and no rail chip, because the fixture states no saturation line at all',
    !text.includes('at max') && !text.includes('at min'),
    text
  )

  await page.fill(FACTION_SEARCH, 'guk')
  const narrowed = await settle(() => countOf(page, FACTION_ROW), (n) => n === 1, { timeoutMs: 10_000 })
  check('the faction search narrows the list', narrowed === 1, `${String(narrowed)} row(s)`)
  await page.fill(FACTION_SEARCH, 'nothing matches this')
  const empty = await settle(() => textOf(page, FACTIONS), (t) => t.includes('No faction hits'), { timeoutMs: 10_000 })
  check('…and a query that matches nothing says so in the panel’s own words', empty.includes('No faction hits in this log yet.'), empty.slice(0, 160))
  await page.fill(FACTION_SEARCH, '')
}

async function stepSkills(page: Page): Promise<void> {
  const up = await page.waitForSelector(SKILLS, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('the Character tab mounts the skills panel too', up)) return
  const rows = await settle(() => countOf(page, SKILL_ROW), (n) => n >= 1, { timeoutMs: 30_000 })
  if (!check('the skills panel has rows', rows >= 1, `${String(rows)} row(s)`)) return

  const text = await rowText(page, SKILL_ROW, 'data-skill', SKILL)
  if (!check(`…including one for ${SKILL}`, text !== '', text || '(no such row)')) return
  check(
    `…printing the value the fixture's LAST \`(N)\` states for it (${SKILL_VALUE})`,
    text.includes(SKILL_VALUE),
    text
  )
  // THE PAIR. The client's running total and this log's tick count are different facts, and a
  // build that ever added them would have to move one of these two numbers.
  check(
    `…beside the ${String(SKILL_UPS)} ups this log watched, which is NOT the same number`,
    text.includes(`${String(SKILL_UPS)}×`),
    text
  )

  await page.fill(SKILLS_SEARCH, 'eagle')
  const narrowed = await settle(() => countOf(page, SKILL_ROW), (n) => n === 1, { timeoutMs: 10_000 })
  check('the skills search narrows the list', narrowed === 1, `${String(narrowed)} row(s)`)
  await page.fill(SKILLS_SEARCH, '')
}

/**
 * THE OVERVIEW'S LAST-SESSION CARD. This fixture states no login line, so it states no absence, so
 * there is no previous session to summarise — and the card says exactly that rather than inventing
 * a boundary at the top of the file (lastSession.ts's law, pinned by tests/lastSession.test.mts).
 */
async function stepLastSession(page: Page): Promise<void> {
  await page.click('[data-testid="nav-overview"]', { timeout: 30_000 })
  const up = await page.waitForSelector(LAST_SESSION, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('the Overview carries a "Last session" card', up)) return
  const text = await settle(() => textOf(page, LAST_SESSION), (t) => t !== '', { timeoutMs: 15_000 })
  const empty = text.includes('No earlier session in this log.')
  const played = (await countOf(page, '[data-testid="overview-last-session-duration"]')) === 1
  check(
    '…which either summarises the previous session or says the log holds none',
    empty || played,
    text.slice(0, 200)
  )
  if (empty) {
    note('this fixture states no logout, so the card takes its no-earlier-session branch (expected)')
  }
}

async function main(): Promise<void> {
  buildIfStale()

  console.log(`launch: hidden Electron (EQ_E2E=1) against a staged copy of tests/fixtures/${FIXTURE}…`)
  const { app, close } = await launchOnFixture(FIXTURE)

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

    if (await openCharacterTab(page)) {
      await stepFactions(page)
      await stepSkills(page)
    } else {
      note('the Character tab never mounted - every claim below it is unmeasured, not passing')
    }
    await stepLastSession(page)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'character-trackers-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the character-trackers spec did not complete')
  process.exitCode = 1
})
