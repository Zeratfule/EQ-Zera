/**
 * SHARING A FIGHT (owner, 2026-09-11: *"We should also make the Discord sharing be able to have
 * DPS meter sharing also."*).
 *
 * The feature is a Share button on the Combat tab's subject line, which opens a 720px card of the
 * selected fight and four ways out of it: Copy image, Save image, Post to Discord, Copy text. What
 * is driven here is the PRODUCT, against the real app: the button exists, the card draws the mob
 * and its rows with real rates, Copy image reports that it copied, and Post to Discord goes from
 * disabled-with-a-reason to enabled-and-reporting once a channel is connected.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EVER POSTED, AND THAT IS A STRUCTURE
 * ---------------------------------------------------------------------------
 * `EQ_E2E` builds have NO Discord endpoint compiled in at all (src/main/share/discord.ts item 4),
 * so `discordEndpointConfigured()` is false and every post answers the dark sentence BEFORE
 * anything is photographed. `tests/discordPost.test.mts` proves that about the module by running a
 * dark process; what is proved HERE is that the button REPORTS rather than going quiet.
 *
 * THE WEBHOOK URL BELOW IS SYNTHETIC — a well-formed shape naming no real channel — and it is the
 * same one discord-share.e2e.mts pastes, for the same reason.
 *
 * COPY IMAGE IS A REAL SCREENSHOT. `webContents.capturePage` runs in a window that is laid out and
 * rendered but never mapped (src/main/e2e.ts), which is exactly the state that used to hand back an
 * empty image and a silent failure - so "Copied" here is a claim about the whole capture path, the
 * zoom multiply and the clamp included (src/main/ipc/cardCapture.ts).
 *
 * Run: `npm run test:e2e -- combat-share` (or node --import tsx this file).
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
  settleCount,
  settleGone,
  waitHydrated
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const NAV_COMBAT = '[data-testid="nav-combat"]'
const SHARE = '[data-testid="combat-share"]'
const DIALOG = '[data-testid="combat-share-dialog"]'
const CARD = '[data-testid="fight-share-card"]'
const MOB = '[data-testid="fight-card-mob"]'
const ROW = '[data-testid="fight-card-row"]'
const ROW_DPS = '[data-testid="fight-card-row-dps"]'
const COPY_IMAGE = '[data-testid="combat-share-copy-image"]'
const COPY_TEXT = '[data-testid="combat-share-copy-text"]'
const SAVE_IMAGE = '[data-testid="combat-share-save-image"]'
const DISCORD = '[data-testid="combat-share-discord"]'
const DISCORD_PICK = '[data-testid="combat-share-discord-channel"]'
const DISCORD_ERROR = '[data-testid="combat-share-discord-error"]'
const CLOSE = '[data-testid="combat-share-close"]'

const NAV_PREFS = '[data-testid="nav-preferences"]'
const RAIL_SHARING = '[data-testid="prefs-rail-sharing"]'
const ADVANCED = '[data-testid="pref-discord-advanced"]'
const FIELD = '[data-testid="pref-discord-webhook"] input'
const SAVE = '[data-testid="pref-discord-save"]'
const STATUS = '[data-testid="pref-discord-status"]'

/** A well-formed webhook that names nothing. See the header. */
const HOOK_ID = '1234567890123456789'
const HOOK_TOKEN = 'abcdefghij'.repeat(6).concat('12345678')
const HOOK_URL = `https://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`
const ROW_REMOVE = `[data-testid="pref-discord-remove-${HOOK_ID}"]`

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Is this control disabled right now? Reads the real DOM property, not a class. */
function disabledOf(page: Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    return el instanceof HTMLButtonElement ? el.disabled : true
  }, sel)
}

/** A button's own `title`, or its wrapper's - which is where a disabled button's reason lives. */
function hintOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (el === null) return ''
    const own = el.getAttribute('title') ?? ''
    return own === '' ? (el.parentElement?.getAttribute('title') ?? '') : own
  }, sel)
}

/** A share button's transient outcome ("Copied" / "Could not"), or '' while idle. */
function flashOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.getAttribute('data-flash') ?? '', sel)
}

/** Every row's rate text, so the spec can say the card is showing real numbers. */
function ratesOf(page: Page, sel: string): Promise<string[]> {
  return page.evaluate(
    (s) => Array.from(document.querySelectorAll(s)).map((el) => (el as HTMLElement).innerText),
    sel
  )
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  // The consent Snackbar covers controls near the window bottom, so it goes first (AGENTS.md).
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

// ── the Combat tab's Share button ──────────────────────────────────────────────────────────

async function openCombat(page: Page): Promise<boolean> {
  await page.click(NAV_COMBAT, { timeout: 60_000 })
  await page.waitForSelector('[data-testid="segment-select"]', { timeout: 60_000 })
  const { snap } = await waitHydrated(page, '[data-testid="combat-hydrating"]')
  return check('hydration completes, so the tab is showing a real fight', !snap.hydrating)
}

async function openShareDialog(page: Page): Promise<boolean> {
  const up = (await settleCount(page, SHARE, 1, { timeoutMs: 20_000 })) === 1
  if (!check('the Combat tab offers a Share button on the selected fight', up)) return false
  await page.click(SHARE, { timeout: 15_000 })
  const card = (await settleCount(page, CARD, 1, { timeoutMs: 20_000 })) === 1
  return check('…and pressing it opens the fight card', card)
}

/** THE CARD IS ABOUT A FIGHT: a named mob, and at least one member row with a real rate. */
async function stepCardContent(page: Page): Promise<void> {
  const mob = await settle(() => textOf(page, MOB), (t) => t !== '', { timeoutMs: 10_000 })
  check('the card names the mob this fight was against', mob.trim().length > 0, mob)
  const rows = await settleCount(page, ROW, 1, { timeoutMs: 10_000 })
  check('…and draws a row per combatant', rows >= 1, `${String(rows)} rows`)
  const rates = await ratesOf(page, ROW_DPS)
  // The app's one rate spelling (AGENTS.md, Formatting): a number, then the word.
  const real = rates.filter((r) => /^[0-9]/.test(r) && r.endsWith('dps'))
  check('…each carrying a DPS number in the meter’s own spelling', real.length >= 1, rates.slice(0, 3).join(' | '))
  check('the dialog offers all four ways out', (await countOf(page, COPY_IMAGE)) === 1 && (await countOf(page, SAVE_IMAGE)) === 1 && (await countOf(page, COPY_TEXT)) === 1 && (await countOf(page, DISCORD)) === 1)
}

/** COPY IMAGE runs the whole capture path in a window that is never mapped. See the header. */
async function stepCopyImage(page: Page): Promise<void> {
  await page.click(COPY_IMAGE, { timeout: 15_000 })
  const said = await settle(() => flashOf(page, COPY_IMAGE), (f) => f !== '', { timeoutMs: 20_000 })
  check('Copy image photographs the card and says it copied', said === 'Copied', said)
}

async function stepCopyText(page: Page): Promise<void> {
  await page.click(COPY_TEXT, { timeout: 15_000 })
  const said = await settle(() => flashOf(page, COPY_TEXT), (f) => f !== '', { timeoutMs: 15_000 })
  check('Copy text reports its outcome too', said === 'Copied', said)
}

async function stepDiscordBefore(page: Page): Promise<void> {
  const off = await settle(() => disabledOf(page, DISCORD), (d) => d, { timeoutMs: 15_000 })
  check('Post to Discord is disabled while no channel is connected', off)
  const hint = await hintOf(page, DISCORD)
  check('…carrying the reason, and the way to fix it', hint === 'Connect a Discord channel in Preferences, Sharing', hint)
  check('…and no channel picker at all, because there is nothing to pick', (await countOf(page, DISCORD_PICK)) === 0)
}

// ── connecting a channel, so the button has somewhere to refuse to post to ─────────────────

async function stepPasteChannel(page: Page): Promise<boolean> {
  await page.click(NAV_PREFS, { timeout: 30_000 })
  const railUp = await page.waitForSelector(RAIL_SHARING, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('Preferences has a Sharing section', railUp)) return false
  await page.click(RAIL_SHARING, { timeout: 15_000 })
  await settleCount(page, ADVANCED, 1, { timeoutMs: 20_000 })
  await page.click(ADVANCED, { timeout: 15_000 })
  if (!check('Advanced opens the paste box', (await settleCount(page, FIELD, 1, { timeoutMs: 15_000 })) === 1)) {
    return false
  }
  await page.fill(FIELD, HOOK_URL, { timeout: 15_000 })
  await page.click(SAVE, { timeout: 15_000 })
  const said = await settle(() => textOf(page, STATUS), (t) => t !== '' && t !== 'Working…', { timeoutMs: 20_000 })
  return check('a well-formed webhook URL is accepted', said.toLowerCase().startsWith('saved'), said)
}

/** Take it away again, so this spec leaves the store as it found it. */
async function stepRemoveChannel(page: Page): Promise<void> {
  await page.click(NAV_PREFS, { timeout: 30_000 })
  await page.waitForSelector(RAIL_SHARING, { timeout: 30_000 })
  await page.click(RAIL_SHARING, { timeout: 15_000 })
  await settleCount(page, ROW_REMOVE, 1, { timeoutMs: 20_000 })
  await page.click(ROW_REMOVE, { timeout: 15_000 })
  const said = await settle(() => textOf(page, STATUS), (t) => t !== '' && t !== 'Working…', { timeoutMs: 20_000 })
  check('the channel is removed again', said.toLowerCase().startsWith('removed'), said)
}

async function stepDiscordAfter(page: Page): Promise<void> {
  // THE DIALOG READS THE LIST WHEN IT OPENS, and this tab unmounted on the way to Preferences -
  // so coming back is a fresh mount holding the channel saved in another tab.
  if (!(await openCombat(page))) return
  if (!(await openShareDialog(page))) return
  const stillOff = await settle(() => disabledOf(page, DISCORD), (d) => !d, { timeoutMs: 20_000 })
  check('with a channel connected, Post to Discord is enabled', !stillOff)
  check('…and no longer needs a reason for being off', (await hintOf(page, DISCORD)) === '')
  check('…and with ONE channel there is still no picker beside it', (await countOf(page, DISCORD_PICK)) === 0)

  // PRESSED, WITH THE ENDPOINT DARK. No request is possible in this build; what is asserted is the
  // OUTCOME REPORTING, and that the dialog lives through it.
  await page.click(DISCORD, { timeout: 15_000 })
  const flash = await settle(() => flashOf(page, DISCORD), (f) => f !== '', { timeoutMs: 20_000 })
  const said = (await countOf(page, DISCORD_ERROR)) === 1 ? await textOf(page, DISCORD_ERROR) : ''
  check('pressing it reports an outcome rather than going quiet', flash !== '' || said !== '', `${flash} | ${said}`)
  check('…and under a dark build the outcome is the dark sentence', said === 'This build cannot post to Discord.', said)
  check('…the card is still on screen afterwards', (await countOf(page, CARD)) === 1)
  await page.click(CLOSE, { timeout: 15_000 })
  check('Close puts the dialog away', await settleGone(page, DIALOG, { timeoutMs: 10_000 }))
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-combat.log…')
  const { app, close } = await launchOnFixture('e2e-combat.log')

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

    // The card and the three local actions first, while "no channel connected" is still the
    // honest state; then the channel, then the button that needed one.
    if (await openCombat(page)) {
      if (await openShareDialog(page)) {
        await stepCardContent(page)
        await stepCopyImage(page)
        await stepCopyText(page)
        await stepDiscordBefore(page)
        await page.click(CLOSE, { timeout: 15_000 })
      }
      if (await stepPasteChannel(page)) {
        await stepDiscordAfter(page)
        await stepRemoveChannel(page)
      }
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'combat-share-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the combat-share spec did not complete')
  process.exitCode = 1
})
