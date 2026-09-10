/**
 * POSTING A CHARACTER CARD TO DISCORD (owner, 2026-09-10; docs/plans/discord-webhook.md).
 *
 * The feature is a CHANNEL WEBHOOK the user pastes into Preferences, Sharing, after which the
 * share dialog grows a Post to Discord button. Both halves are driven here, against the real app.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EVER POSTED, AND THAT IS A STRUCTURE RATHER THAN A HOPE
 * ---------------------------------------------------------------------------
 * `EQ_E2E` builds have NO Discord endpoint compiled in at all (src/main/share/discord.ts, item 4).
 * `discordEndpointConfigured()` is false, every post answers the dark sentence, and the handler
 * refuses BEFORE it photographs or publishes anything — so this spec cannot put a message in
 * somebody's channel, and cannot publish a share record on the way to not sending one either.
 * `tests/discordPost.test.mts` proves that claim about the module by running a dark process; what
 * is proved HERE is the product: the field refuses junk, accepts a real URL, masks what it stored,
 * and the button goes from disabled-with-a-reason to enabled-and-reporting.
 *
 * THE WEBHOOK URL BELOW IS SYNTHETIC. It is a well-formed shape — 19 digits and 68 token
 * characters — and it names no real channel; the app never opens a socket to it in this build.
 *
 * Run: `npm run test:e2e -- discord-share` (or node --import tsx this file).
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
  settleGone
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const NAV_GEAR = '[data-testid="nav-gear"]'
const TAB_GEAR = '[data-testid="tab-gear"]'
const TAB = '[data-testid="tab-character"]'
const SHEET = '[data-testid="character-sheet"]'
const SHARE = '[data-testid="character-share"]'
const CARD = '[data-testid="character-share-card"]'
const CLOSE = '[data-testid="character-share-close"]'
const DISCORD = '[data-testid="character-share-discord"]'
const DISCORD_ERROR = '[data-testid="character-share-discord-error"]'

const NAV_PREFS = '[data-testid="nav-preferences"]'
const RAIL_SHARING = '[data-testid="prefs-rail-sharing"]'
const FIELD = '[data-testid="pref-discord-webhook"] input'
const SAVE = '[data-testid="pref-discord-save"]'
const TEST = '[data-testid="pref-discord-test"]'
const REMOVE = '[data-testid="pref-discord-remove"]'
const STATUS = '[data-testid="pref-discord-status"]'
const CURRENT = '[data-testid="pref-discord-current"]'

/** The staged dump the share card is built from - character-share.e2e.mts's own fixture. */
const DUMP = 'Primitive_freeport-Inventory.txt'

/** A well-formed webhook that names nothing. See the header. */
const HOOK_ID = '1234567890123456789'
const HOOK_TOKEN = 'abcdefghij'.repeat(6).concat('12345678')
const HOOK_URL = `https://discord.com/api/webhooks/${HOOK_ID}/${HOOK_TOKEN}`

/** …and a paste that is not one, which is the path a reader meets by accident. */
const JUNK = 'https://discord.com/channels/12345/67890'

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

/** A share button's transient outcome ("Posted to Discord" / "Could not"), or '' while idle. */
function flashOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.getAttribute('data-flash') ?? '', sel)
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  // The consent Snackbar covers controls near the window bottom, so it goes first (AGENTS.md).
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

// ── Preferences, Sharing ───────────────────────────────────────────────────────────────────

async function openSharing(page: Page): Promise<boolean> {
  await page.click(NAV_PREFS, { timeout: 60_000 })
  const railUp = await page.waitForSelector(RAIL_SHARING, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('Preferences has a Sharing section of its own', railUp)) return false
  await page.click(RAIL_SHARING, { timeout: 15_000 })
  const fieldUp = (await settleCount(page, FIELD, 1, { timeoutMs: 20_000 })) === 1
  return check('…offering somewhere to paste a Discord webhook URL', fieldUp)
}

/** Type a value, press Save, and read back whatever the card decided to say about it. */
async function saveWebhook(page: Page, value: string): Promise<string> {
  await page.fill(FIELD, value, { timeout: 15_000 })
  await page.click(SAVE, { timeout: 15_000 })
  return settle(() => textOf(page, STATUS), (t) => t !== '' && t !== 'Working…', { timeoutMs: 20_000 })
}

async function stepPreferences(page: Page): Promise<boolean> {
  if (!(await openSharing(page))) return false

  // NOTHING STORED YET: Test and Remove have nothing to act on and say so by being off.
  check('with nothing stored, Test is disabled', await disabledOf(page, TEST))
  check('…and so is Remove', await disabledOf(page, REMOVE))
  check('…and the card says there is no webhook yet', (await textOf(page, CURRENT)).includes('No channel webhook'), await textOf(page, CURRENT))

  // A JUNK PASTE FIRST, because the refusal is what a reader meets by accident and main's own
  // prose is what has to reach them. The renderer never decides whether a URL is legal.
  const refused = await saveWebhook(page, JUNK)
  check('a paste that is not a webhook URL is refused, in words', refused.includes('not a Discord webhook'), refused)
  check('…and nothing was stored for it', await disabledOf(page, TEST))

  // …then a well-formed one.
  const saved = await saveWebhook(page, HOOK_URL)
  check('a well-formed webhook URL is accepted', saved.toLowerCase().startsWith('saved'), saved)
  const current = await settle(() => textOf(page, CURRENT), (t) => t.includes('webhooks'), { timeoutMs: 15_000 })
  check('…and the card states it MASKED, never the token', current.includes(HOOK_ID) && current.includes('••••'), current)
  check('…showing only the last four characters of the token', !current.includes(HOOK_TOKEN.slice(0, 12)), current)
  check('…the field is cleared, because what is stored is a secret it can never show', (await page.inputValue(FIELD)) === '')
  check('…Test is now live', !(await disabledOf(page, TEST)))
  check('…and so is Remove', !(await disabledOf(page, REMOVE)))
  return true
}

/** Take the webhook away again, so this spec leaves the store as it found it. */
async function stepRemove(page: Page): Promise<void> {
  await page.click(NAV_PREFS, { timeout: 30_000 })
  await page.waitForSelector(RAIL_SHARING, { timeout: 30_000 })
  await page.click(RAIL_SHARING, { timeout: 15_000 })
  await settleCount(page, REMOVE, 1, { timeoutMs: 20_000 })
  await page.click(REMOVE, { timeout: 15_000 })
  const said = await settle(() => textOf(page, STATUS), (t) => t !== '' && t !== 'Working…', { timeoutMs: 20_000 })
  check('Remove takes the webhook away and says so', said.toLowerCase().startsWith('removed'), said)
  check('…and Test goes back to being disabled', await disabledOf(page, TEST))
}

// ── the share dialog's button ──────────────────────────────────────────────────────────────

async function openShareDialog(page: Page): Promise<boolean> {
  await page.click(NAV_GEAR, { timeout: 60_000 })
  const barUp = await page.waitForSelector(TAB_GEAR, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('the gear area is reachable', barUp)) return false
  await page.click(TAB, { timeout: 15_000 })
  const mounted = await page.waitForSelector(SHEET, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('the Character tab mounts a sheet built from the staged dump', mounted)) return false
  await page.click(SHARE, { timeout: 15_000 })
  const up = (await settleCount(page, CARD, 1, { timeoutMs: 30_000 })) === 1
  return check('…and the Share button opens the card', up)
}

async function stepButtonBefore(page: Page): Promise<boolean> {
  if (!(await openShareDialog(page))) return false
  check('the share dialog offers a Post to Discord button', (await countOf(page, DISCORD)) === 1)
  // NO WEBHOOK YET: the button is off, and it says why rather than being mysteriously grey.
  const off = await settle(() => disabledOf(page, DISCORD), (d) => d, { timeoutMs: 15_000 })
  check('…disabled while no webhook is set up', off)
  const hint = await hintOf(page, DISCORD)
  check('…carrying the reason, and the way to fix it', hint === 'Add a Discord webhook in Preferences, Sharing', hint)
  await page.click(CLOSE, { timeout: 15_000 })
  return true
}

async function stepButtonAfter(page: Page): Promise<void> {
  if (!(await openShareDialog(page))) return
  // THE DIALOG READS THE VIEW WHEN IT OPENS, so a webhook saved in another tab is live here.
  // `settle` answers what it LAST READ, and what it reads here is "disabled" - so the enabled
  // state is the negation of it, not the reading itself.
  const stillOff = await settle(() => disabledOf(page, DISCORD), (d) => !d, { timeoutMs: 20_000 })
  check('with a webhook stored, Post to Discord is enabled', !stillOff)
  check('…and no longer needs a reason for being off', (await hintOf(page, DISCORD)) === '')

  // PRESSED, WITH THE ENDPOINT DARK. An `EQ_E2E` build compiles with no Discord origin at all, so
  // no request is possible; what is asserted is the OUTCOME REPORTING, and that the dialog lives.
  await page.click(DISCORD, { timeout: 15_000 })
  const flash = await settle(() => flashOf(page, DISCORD), (f) => f !== '', { timeoutMs: 20_000 })
  const said = (await countOf(page, DISCORD_ERROR)) === 1 ? await textOf(page, DISCORD_ERROR) : ''
  check('pressing it reports an outcome rather than going quiet', flash !== '' || said !== '', `${flash} | ${said}`)
  check('…and under a dark build the outcome is the dark sentence', said === 'This build cannot post to Discord.', said)
  check('…the dialog is still on screen afterwards', (await countOf(page, CARD)) === 1)
  await page.click(CLOSE, { timeout: 15_000 })
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

    // The button BEFORE anything is stored, then the settings, then the button after. In that
    // order because the disabled state is only interesting while it is the honest one.
    if (await stepButtonBefore(page)) {
      if (await stepPreferences(page)) {
        await stepButtonAfter(page)
        await stepRemove(page)
      }
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'discord-share-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the discord-share spec did not complete')
  process.exitCode = 1
})
