/**
 * POSTING A CHARACTER CARD TO DISCORD (owner, 2026-09-10 and 2026-09-11;
 * docs/plans/discord-connect.md).
 *
 * The feature is a list of CHANNELS in Preferences, Sharing, after which the share dialog's Post to
 * Discord button goes live. A channel is normally CONNECTED - Discord's own picker, reached through
 * the share service, with nothing to copy or paste (owner: *"There's got to be a better way to
 * share to Discord instead of having people input webhooks for each channel they want to send
 * to."*) - and a webhook URL can still be pasted under Advanced. Both halves are driven here,
 * against the real app.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EVER POSTED, NO BROWSER IS EVER OPENED, AND BOTH ARE STRUCTURES
 * ---------------------------------------------------------------------------
 * `EQ_E2E` builds have NO Discord endpoint and NO share origin compiled in at all
 * (src/main/share/discord.ts item 4, src/main/share/net.ts). So `discordEndpointConfigured()` is
 * false and every post answers the dark sentence BEFORE anything is photographed or published; and
 * `connectStartUrl` is '', so pressing Connect cannot open a browser window on somebody's machine
 * in the middle of a headless run. `tests/discordPost.test.mts` and `tests/discordConnect.test.mts`
 * prove those claims about the modules by running dark processes; what is proved HERE is the
 * PRODUCT: Connect says why it cannot, the advanced field refuses junk and accepts a real URL, the
 * channel appears as a row with Test, Rename, Remove and a Default radio, and the share dialog's
 * button goes from disabled-with-a-reason to enabled-and-reporting.
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
const DISCORD_PICK = '[data-testid="character-share-discord-channel"]'
const DISCORD_ERROR = '[data-testid="character-share-discord-error"]'

const NAV_PREFS = '[data-testid="nav-preferences"]'
const RAIL_SHARING = '[data-testid="prefs-rail-sharing"]'
const CONNECT = '[data-testid="pref-discord-connect"]'
const ADVANCED = '[data-testid="pref-discord-advanced"]'
const FIELD = '[data-testid="pref-discord-webhook"] input'
const SAVE = '[data-testid="pref-discord-save"]'
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

/** The row that webhook becomes, and its three buttons and its radio. */
const ROW = `[data-testid="pref-discord-channel-${HOOK_ID}"]`
const ROW_TEST = `[data-testid="pref-discord-test-${HOOK_ID}"]`
const ROW_RENAME = `[data-testid="pref-discord-rename-${HOOK_ID}"]`
const ROW_REMOVE = `[data-testid="pref-discord-remove-${HOOK_ID}"]`
const ROW_DEFAULT = `[data-testid="pref-discord-default-${HOOK_ID}"] input`

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

/** Is this radio the one that is on? */
function checkedOf(page: Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    return el instanceof HTMLInputElement && el.checked
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

/** A share button's transient outcome ("Posted to …" / "Could not"), or '' while idle. */
function flashOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.getAttribute('data-flash') ?? '', sel)
}

/** Whatever the card is saying right now, once it has stopped saying "Working…". */
function saidOf(page: Page): Promise<string> {
  return settle(() => textOf(page, STATUS), (t) => t !== '' && t !== 'Working…', { timeoutMs: 20_000 })
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
  const up = (await settleCount(page, CONNECT, 1, { timeoutMs: 20_000 })) === 1
  return check('…offering Connect a Discord channel as the first thing on the card', up)
}

/**
 * THE CONNECT BUTTON, IN A BUILD THAT HAS NOWHERE TO CONNECT TO.
 *
 * This is the only honest thing a headless run can assert about it, and it is worth asserting: the
 * dark path has to REPORT rather than hang on a spinner waiting for a browser nobody opened.
 */
async function stepConnectIsDark(page: Page): Promise<void> {
  check('with nothing connected, the card says so', (await textOf(page, CURRENT)).includes('No Discord channels'), await textOf(page, CURRENT))
  await page.click(CONNECT, { timeout: 15_000 })
  const said = await saidOf(page)
  check('pressing Connect under a dark build says why, in words', said === 'This build cannot connect a Discord channel.', said)
  check('…and it does not sit there waiting for a browser nobody opened', (await countOf(page, '[data-testid="pref-discord-waiting"]')) === 0)
}

/** Type a value into the advanced box, press Save, and read back what the card decided. */
async function savePasted(page: Page, value: string): Promise<string> {
  await page.fill(FIELD, value, { timeout: 15_000 })
  await page.click(SAVE, { timeout: 15_000 })
  return saidOf(page)
}

async function stepAdvancedPaste(page: Page): Promise<boolean> {
  check('the paste box starts COLLAPSED, because it is the unusual path now', (await countOf(page, FIELD)) === 0)
  await page.click(ADVANCED, { timeout: 15_000 })
  const fieldUp = (await settleCount(page, FIELD, 1, { timeoutMs: 15_000 })) === 1
  if (!check('…and Advanced opens it', fieldUp)) return false

  // A JUNK PASTE FIRST, because the refusal is what a reader meets by accident and main's own
  // prose is what has to reach them. The renderer never decides whether a URL is legal.
  const refused = await savePasted(page, JUNK)
  check('a paste that is not a webhook URL is refused, in words', refused.includes('not a Discord webhook'), refused)
  check('…and nothing was stored for it', (await countOf(page, ROW)) === 0)

  // …then a well-formed one.
  const saved = await savePasted(page, HOOK_URL)
  check('a well-formed webhook URL is accepted', saved.toLowerCase().startsWith('saved'), saved)
  const rowUp = (await settleCount(page, ROW, 1, { timeoutMs: 15_000 })) === 1
  if (!check('…and it becomes a CHANNEL ROW in the list', rowUp)) return false
  const row = await textOf(page, ROW)
  check('…labelled for what it is', row.includes('Pasted webhook'), row)
  check('…and never showing the token', !row.includes(HOOK_TOKEN.slice(0, 12)), row)
  check('…the field is cleared, because what is stored is a secret it can never show', (await page.inputValue(FIELD)) === '')
  return true
}

async function stepRowControls(page: Page): Promise<void> {
  check('the row offers Test', (await countOf(page, ROW_TEST)) === 1)
  check('…Rename', (await countOf(page, ROW_RENAME)) === 1)
  check('…Remove', (await countOf(page, ROW_REMOVE)) === 1)
  check('…and a Default radio, already on, because it is the first channel this install got', await checkedOf(page, ROW_DEFAULT))

  // RENAME IS MAIN'S: the row draws what was STORED, clamped, not the draft it was handed.
  await page.click(ROW_RENAME, { timeout: 15_000 })
  const box = `[data-testid="pref-discord-rename-field-${HOOK_ID}"] input`
  const boxUp = (await settleCount(page, box, 1, { timeoutMs: 15_000 })) === 1
  if (!check('Rename turns the row into a box', boxUp)) return
  await page.fill(box, 'Guild gear', { timeout: 15_000 })
  await page.click(ROW_RENAME, { timeout: 15_000 })
  const said = await saidOf(page)
  check('…and saving it says so', said.toLowerCase().startsWith('renamed'), said)
  const row = await settle(() => textOf(page, ROW), (t) => t.includes('Guild gear'), { timeoutMs: 15_000 })
  check('…with the row now carrying the name the user chose', row.includes('Guild gear'), row)
}

async function stepPreferences(page: Page): Promise<boolean> {
  if (!(await openSharing(page))) return false
  await stepConnectIsDark(page)
  if (!(await stepAdvancedPaste(page))) return false
  await stepRowControls(page)
  return true
}

/** Take the channel away again, so this spec leaves the store as it found it. */
async function stepRemove(page: Page): Promise<void> {
  await page.click(NAV_PREFS, { timeout: 30_000 })
  await page.waitForSelector(RAIL_SHARING, { timeout: 30_000 })
  await page.click(RAIL_SHARING, { timeout: 15_000 })
  await settleCount(page, ROW_REMOVE, 1, { timeoutMs: 20_000 })
  await page.click(ROW_REMOVE, { timeout: 15_000 })
  const said = await saidOf(page)
  check('Remove takes the channel away and says so', said.toLowerCase().startsWith('removed'), said)
  check('…and the row is gone', (await settleCount(page, ROW, 0, { timeoutMs: 15_000 })) === 0)
  check('…leaving the card back at its empty state', (await textOf(page, CURRENT)).includes('No Discord channels'))
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
  // NO CHANNEL YET: the button is off, and it says why rather than being mysteriously grey.
  const off = await settle(() => disabledOf(page, DISCORD), (d) => d, { timeoutMs: 15_000 })
  check('…disabled while no channel is connected', off)
  const hint = await hintOf(page, DISCORD)
  check('…carrying the reason, and the way to fix it', hint === 'Connect a Discord channel in Preferences, Sharing', hint)
  check('…and no channel picker at all, because there is nothing to pick', (await countOf(page, DISCORD_PICK)) === 0)
  await page.click(CLOSE, { timeout: 15_000 })
  return true
}

async function stepButtonAfter(page: Page): Promise<void> {
  if (!(await openShareDialog(page))) return
  // THE DIALOG READS THE LIST WHEN IT OPENS, so a channel saved in another tab is live here.
  // `settle` answers what it LAST READ, and what it reads here is "disabled" - so the enabled
  // state is the negation of it, not the reading itself.
  const stillOff = await settle(() => disabledOf(page, DISCORD), (d) => !d, { timeoutMs: 20_000 })
  check('with a channel connected, Post to Discord is enabled', !stillOff)
  check('…and no longer needs a reason for being off', (await hintOf(page, DISCORD)) === '')
  // ONE CHANNEL, NO PICKER: a dropdown with one row in it is a question nobody needed asking.
  check('…and with ONE channel there is still no picker beside it', (await countOf(page, DISCORD_PICK)) === 0)

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
