/**
 * SENDING YOUR SETTINGS TO ANOTHER PC (docs/plans/settings-sync.md).
 *
 * The feature is a Sync section in Preferences: Send settings to another PC produces a transfer
 * code, and Receive settings takes one. What is asserted HERE is the PRODUCT - that the section
 * exists, that both of its controls are on the card, and that under a build with no sync service
 * the card SAYS SO rather than offering two buttons that cannot work.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EVER UPLOADED, AND THAT IS A STRUCTURE RATHER THAN A HOPE
 * ---------------------------------------------------------------------------
 * `EQ_E2E` builds compile NO share origin at all (src/main/share/net.ts: `SHARE_ORIGIN` is the
 * empty string under the flag), and the sync routes are built from that same origin. So
 * `syncAvailable()` is false, the card draws its dark sentence, both buttons are disabled, and no
 * request is possible even if one were pressed. `tests/syncSettings.test.mts` drives the round
 * trips themselves against an injected `fetch`; this spec is about what the user sees.
 *
 * Run: `npm run test:e2e -- settings-sync`
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
  settleCount,
  settleGone
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import { SYNC_ERROR } from '../../src/shared/settingsSync'

const NAV_PREFS = '[data-testid="nav-preferences"]'
const RAIL_SYNC = '[data-testid="prefs-rail-sync"]'
const SEND = '[data-testid="pref-sync-send"]'
const INCLUDE = '[data-testid="pref-sync-include-discord"] input'
const RECEIVE_CODE = '[data-testid="pref-sync-receive-code"] input'
const RECEIVE = '[data-testid="pref-sync-receive"]'
const DARK = '[data-testid="pref-sync-dark"]'
const CODE = '[data-testid="pref-sync-code"]'

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Is this control disabled right now? Reads the real DOM property, not a class. */
function disabledOf(page: Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) return el.disabled
    return true
  }, sel)
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  // The consent Snackbar covers controls near the window bottom, so it goes first (AGENTS.md).
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

async function openSync(page: Page): Promise<boolean> {
  await page.click(NAV_PREFS, { timeout: 60_000 })
  const railUp = await page.waitForSelector(RAIL_SYNC, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('Preferences has a Sync section of its own', railUp)) return false
  await page.click(RAIL_SYNC, { timeout: 15_000 })
  const up = (await settleCount(page, SEND, 1, { timeoutMs: 20_000 })) === 1
  return check('…opening a card whose first control is Send settings to another PC', up)
}

async function stepCard(page: Page): Promise<void> {
  check('the card offers a Receive button beside the Send one', (await countOf(page, RECEIVE)) === 1)
  check('…a box to type the transfer code into', (await countOf(page, RECEIVE_CODE)) === 1)
  check('…and the Include connected Discord channels tick box', (await countOf(page, INCLUDE)) === 1)
  check('…which starts OFF, because a connected channel is a credential', !(await page.isChecked(INCLUDE)))
  check('…with no transfer code on screen before anything was sent', (await countOf(page, CODE)) === 0)
}

/**
 * THE DARK BUILD, WHICH IS THE ONLY HONEST THING A HEADLESS RUN CAN SAY ABOUT THE NETWORK - and it
 * is worth saying: the card has to explain itself rather than leaving a disabled button unexplained.
 */
async function stepDark(page: Page): Promise<void> {
  // WAIT FOR THE CONDITION, NEVER FOR THE CLOCK. "Is there a sync service" is one IPC round trip,
  // and until it answers the card knows nothing - so the sentence is what is waited for, and the
  // two disabled checks below only mean anything once it is on screen.
  const up = (await settleCount(page, DARK, 1, { timeoutMs: 20_000 })) === 1
  if (!check('under a build with no sync service the card says so', up)) return
  const said = await textOf(page, DARK)
  check('…and the sentence is the dark one, in words', said === SYNC_ERROR.dark, said)
  check('…and Send is disabled rather than mysteriously grey', await disabledOf(page, SEND))
  check('…as is Receive', await disabledOf(page, RECEIVE))
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: production-shaped build on a staged log…')
  const { app, close } = await launchOnFixture('e2e-copy.log')

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

    if (await openSync(page)) {
      await stepCard(page)
      await stepDark(page)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'settings-sync-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the settings-sync spec did not complete')
  process.exitCode = 1
})
