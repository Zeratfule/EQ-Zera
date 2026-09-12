/**
 * SHARING A PLAY SESSION - the Overview's "Last session" card, as something that leaves the app.
 *
 * The feature is a Share button on that card, which opens a 720px card of the session and the same
 * four ways out the fight dialog has: Copy image, Save image, Post to Discord, Copy text. What is
 * driven here is the PRODUCT, against the real app: the button exists, the dialog draws the card and
 * all four buttons, and Copy text puts the session's own summary on the real OS clipboard.
 *
 * ---------------------------------------------------------------------------
 * THE HARNESS AUTHORS THE TWO LOGOUTS, BECAUSE THE FEATURE IS ABOUT THEM
 * ---------------------------------------------------------------------------
 * `lastSession.ts` summarises the stretch between the two absences the log STATED, and no committed
 * e2e fixture states any: a log with no `Welcome to EverQuest Legends!` line in it has a current
 * session and nothing before it, which is the card's own empty state (character-trackers.e2e.mts
 * asserts exactly that branch). So this spec writes the missing half itself - two logins, two hours
 * apart, with kills and a drop between them - into the STAGED copy of the fixture BEFORE the app is
 * launched, so every line travels the ordinary replay path and nothing in the product knows.
 *
 * That is the same move `gameplay.mts` makes for a pull, one step earlier in the launch: the
 * harness owns the file (logFixture.mts), so it may state the history the assertion needs.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EVER POSTED
 * ---------------------------------------------------------------------------
 * `EQ_E2E` builds have NO Discord endpoint compiled in at all, so Post to Discord is disabled with
 * its reason and nothing here connects a channel (combat-share.e2e.mts already drives that half of
 * the shared machinery end to end - the picker, the dark sentence, the settings door).
 *
 * IT PUTS THE USER'S CLIPBOARD BACK. This is the machine's REAL clipboard and the user may be
 * playing; copy.e2e.mts's discipline, for its reason.
 *
 * Run: `npm run test:e2e -- session-share` (or node --import tsx this file).
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
  settleCount,
  settleGone,
  sleep
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

const CARD = '[data-testid="overview-last-session"]'
const OPEN = '[data-testid="session-share-open"]'
const DIALOG = '[data-testid="session-share-dialog"]'
const SHARE_CARD = '[data-testid="session-share-card"]'
const WHO = '[data-testid="session-card-who"]'
const KILLS = '[data-testid="session-card-kills"]'
const COPY_IMAGE = '[data-testid="session-share-copy-image"]'
const SAVE_IMAGE = '[data-testid="session-share-save-image"]'
const DISCORD = '[data-testid="session-share-discord"]'
const COPY_TEXT = '[data-testid="session-share-copy-text"]'
const CLOSE = '[data-testid="session-share-close"]'

/** The fixture ends on Wed Aug 05 2026 20:32:39, so everything below sits after it, in order. */
const AUG = 7

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** A share button's transient outcome ("Copied" / "Could not"), or '' while idle. */
function flashOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.getAttribute('data-flash') ?? '', sel)
}

/**
 * Read - and optionally first WRITE - the OS clipboard from the MAIN process, the only side of the
 * app that can see it. Retried for `copy.e2e.mts`'s reason: the CDP result handle can be collected
 * while main is busy inside a replay, which is a harness artifact rather than a product failure.
 */
async function mainClipboard(app: ElectronApplication, write?: string): Promise<string> {
  let last: unknown
  for (let i = 0; i < 4; i++) {
    try {
      return await app.evaluate(({ clipboard }, w: string | undefined): string => {
        if (w !== undefined) clipboard.writeText(w)
        return clipboard.readText()
      }, write)
    } catch (err) {
      last = err
      await sleep(1500)
    }
  }
  throw last
}

/**
 * TWO ABSENCES AND A SESSION BETWEEN THEM, written into the staged log before launch.
 *
 * A login states an absence measured from the newest line that could only have been printed for
 * THIS character (fold/session.rs), so each `Welcome` below is preceded by a zone line that anchors
 * it. The middle stretch - 23:00 to 23:30 on Aug 5 - is what the card then calls "last session",
 * and the kills and the drop inside it are what the shared summary is about.
 */
function seedTwoLogouts(log: FixtureLog): void {
  const at = (day: number, h: number, m: number, s = 0): Date => new Date(2026, AUG, day, h, m, s)
  log.appendAt(at(5, 21, 0), 'You have entered Befallen.')
  log.appendAt(at(5, 23, 0), 'Welcome to EverQuest Legends!')
  log.appendAt(at(5, 23, 0, 5), 'You have entered Befallen.')
  for (const minute of [5, 9, 14, 19]) {
    log.appendAt(
      at(5, 23, minute),
      'You slash a decaying skeleton for 42 points of damage.',
      'You have slain a decaying skeleton!',
      'You gain experience!'
    )
  }
  log.appendAt(at(5, 23, 20), '--You have looted a Bone Chips from a decaying skeleton\'s corpse.--')
  log.appendAt(at(5, 23, 30), 'You have entered Befallen.')
  log.appendAt(at(6, 1, 0), 'Welcome to EverQuest Legends!')
  log.appendAt(at(6, 1, 0, 5), 'You have entered Befallen.')
}

/** The card must be in its SESSION state, not its no-earlier-session state, or nothing below holds. */
async function openShareDialog(page: Page): Promise<boolean> {
  const up = await page.waitForSelector(CARD, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the Overview carries a "Last session" card', up)) return false
  const text = await settle(() => textOf(page, CARD), (t) => t !== '', { timeoutMs: 30_000 })
  if (text.includes('No earlier session in this log.')) {
    note('the seeded logouts never became two stated absences - the share dialog is unmeasured, not passing')
    return false
  }
  const offered = (await settleCount(page, OPEN, 1, { timeoutMs: 30_000 })) === 1
  if (!check('…and, because there IS a session, a Share button on it', offered)) return false
  await page.click(OPEN, { timeout: 15_000 })
  const card = (await settleCount(page, SHARE_CARD, 1, { timeoutMs: 20_000 })) === 1
  return check('…which opens the session card', card)
}

/** THE CARD IS ABOUT A SESSION: a subject, a kill tile, and all four ways out beneath it. */
async function stepCardContent(page: Page): Promise<void> {
  const who = await settle(() => textOf(page, WHO), (t) => t !== '', { timeoutMs: 10_000 })
  check('the card names whose session this was', who.trim().length > 0, who)
  const kills = await textOf(page, KILLS)
  check('…and states the kills the range query counted', /\d/.test(kills), kills)
  check(
    'the dialog offers all four ways out',
    (await countOf(page, COPY_IMAGE)) === 1 &&
      (await countOf(page, SAVE_IMAGE)) === 1 &&
      (await countOf(page, DISCORD)) === 1 &&
      (await countOf(page, COPY_TEXT)) === 1
  )
}

/**
 * COPY TEXT, THROUGH THE REAL CLIPBOARD. `navigator.clipboard` cannot work in this app (every web
 * permission is denied wholesale), so the write goes over IPC to main - and main is the only side
 * that can read the result back.
 */
async function stepCopyText(app: ElectronApplication, page: Page): Promise<void> {
  const userText = await mainClipboard(app)
  const sentinel = `e2e-nothing-was-copied-${String(Date.now())}`
  await mainClipboard(app, sentinel)

  await page.click(COPY_TEXT, { timeout: 15_000 })
  const said = await settle(() => flashOf(page, COPY_TEXT), (f) => f !== '', { timeoutMs: 15_000 })
  const after = await mainClipboard(app)
  if (userText) await mainClipboard(app, userText)

  check('Copy text reports its outcome', said === 'Copied', said)
  check('…and the summary really is on the OS clipboard', after !== sentinel && after.length > 0, `${String(after.length)} chars`)
  check(
    '…saying what the session was worth in the currencies the log states',
    after.includes('kills'),
    after.split('\n')[1] ?? after.slice(0, 120)
  )
  // There is no experience number in this app, and a share card is where a fabricated one would
  // travel furthest (shared/sessionShare.ts's header).
  check('…and never an experience number, which this log does not carry', !/\bxp\b/i.test(after))
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  // The consent Snackbar covers controls near the window bottom, so it goes first (AGENTS.md).
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

async function main(): Promise<void> {
  buildIfStale()

  const log = stageFixture('e2e-overview.log')
  seedTwoLogouts(log)
  console.log('launch: hidden Electron (EQ_E2E=1) against a staged e2e-overview.log with two seeded logouts…')
  const { app, close } = await launchOnFixture(log)

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

    if (await openShareDialog(page)) {
      await stepCardContent(page)
      await stepCopyText(app, page)
      await page.click(CLOSE, { timeout: 15_000 })
      check('Close puts the dialog away', await settleGone(page, DIALOG, { timeoutMs: 10_000 }))
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'session-share-FAIL')
  } finally {
    await close()
    await log.dispose()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the session-share spec did not complete')
  process.exitCode = 1
})
