/**
 * POST CELEBRATIONS TO DISCORD — Preferences → Sharing, against the real app.
 *
 * The feature is one switch under the channel card: every card the celebration overlay shows also
 * becomes a message in a connected channel. `tests/celebrationPost.test.mts` proves the kinds, the
 * embed, the spacing and the dedupe under plain node; what is proved HERE is the PRODUCT — the
 * switch is there, it refuses to arm itself while there is nowhere to post, connecting channels
 * makes it live, turning it on reveals the picker and the six kinds, and a kind the user toggles is
 * a kind MAIN is holding a moment later.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS EVER POSTED, AND THAT IS A STRUCTURE
 * ---------------------------------------------------------------------------
 * `EQ_E2E` builds compile with NO Discord endpoint at all (src/main/share/discord.ts item 4), so
 * `discordEndpointConfigured()` is false and the queue refuses every card before it looks at a
 * preference. The webhook URLs below are SYNTHETIC — well-formed shapes (19 digits, 68 token
 * characters) naming no real channel — and the app never opens a socket to one in this build. They
 * exist because storing a channel is what makes the switch honest to test.
 *
 * TWO of them, on purpose: `lib/discordChannels` draws no picker at all for a single channel (a
 * dropdown with one row in it is a question nobody needed asking), so a spec that connected one
 * could not see the control it is here to assert.
 *
 * Run: `npm run test:e2e -- celebration-post` (or node --import tsx this file).
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

const NAV_PREFS = '[data-testid="nav-preferences"]'
const RAIL_SHARING = '[data-testid="prefs-rail-sharing"]'

/** The channel card above, which is how this spec gets somewhere to post. */
const ADVANCED = '[data-testid="pref-discord-advanced"]'
const FIELD = '[data-testid="pref-discord-webhook"] input'
const SAVE = '[data-testid="pref-discord-save"]'
const STATUS = '[data-testid="pref-discord-status"]'

/** …and the card this spec is about. */
const CARD = '[data-testid="pref-celebration-post"]'
const SWITCH = '[data-testid="pref-celebration-post-enabled"] input'
const HINT = '[data-testid="pref-celebration-post-hint"]'
const PICKER = '[data-testid="pref-celebration-post-channel"]'
const KINDS = '[data-testid="pref-celebration-post-kinds"]'
const DEATH = '[data-testid="pref-celebration-post-kind-death"] input'

/** The six kinds the card draws a checkbox for, in the order it draws them. */
const KIND_IDS = ['levelUp', 'bossKill', 'skyQuestComplete', 'questItem', 'wishDrop', 'death']

/** Two well-formed webhooks that name nothing. See the header. */
const HOOKS = [
  { id: '1234567890123456789', token: 'abcdefghij'.repeat(6).concat('12345678') },
  { id: '9876543210987654321', token: 'klmnopqrst'.repeat(6).concat('87654321') }
]

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Is this input checked right now? Reads the real DOM property, not a class. */
function checkedOf(page: Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    return el instanceof HTMLInputElement && el.checked
  }, sel)
}

/** …and is it disabled? A switch with nowhere to post must be off AND unusable. */
function disabledOf(page: Page, sel: string): Promise<boolean> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    return el instanceof HTMLInputElement ? el.disabled : true
  }, sel)
}

/**
 * WHAT MAIN IS HOLDING, asked of main rather than read off the card. The whole point of the last
 * step is that a checkbox click reached the store, and a second reading of the same DOM would
 * prove only that React re-rendered.
 */
function storedKinds(page: Page): Promise<string[]> {
  return page.evaluate(() => window.eq.getCelebrationPost().then((v) => v.prefs.kinds as string[]))
}

function storedEnabled(page: Page): Promise<boolean> {
  return page.evaluate(() => window.eq.getCelebrationPost().then((v) => v.prefs.enabled))
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  // The consent Snackbar covers controls near the window bottom, so it goes first (AGENTS.md).
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

async function openSharing(page: Page): Promise<boolean> {
  await page.click(NAV_PREFS, { timeout: 60_000 })
  const railUp = await page.waitForSelector(RAIL_SHARING, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('Preferences has a Sharing section', railUp)) return false
  await page.click(RAIL_SHARING, { timeout: 15_000 })
  const up = (await settleCount(page, CARD, 1, { timeoutMs: 20_000 })) === 1
  return check('…carrying a "Post celebrations to Discord" card under the channel card', up)
}

/** THE HONEST DEAD STATE: nowhere to post, so the switch says why instead of being grey. */
async function stepNoChannel(page: Page): Promise<void> {
  const off = await settle(() => checkedOf(page, SWITCH), (v) => !v, { timeoutMs: 15_000 })
  check('the switch is OFF on a fresh install, because this posts where other people read', !off)
  check('…and disabled while no channel is connected', await disabledOf(page, SWITCH))
  const hint = await textOf(page, HINT)
  check('…with the one line that says what to do about it', hint === 'Connect a Discord channel first.', hint)
  check('…and no kinds on screen while it is off', (await countOf(page, KINDS)) === 0)
}

/** Whatever the channel card is saying, once it has stopped saying "Working…". */
function saidOf(page: Page): Promise<string> {
  return settle(() => textOf(page, STATUS), (t) => t !== '' && t !== 'Working…', { timeoutMs: 20_000 })
}

/** Connect two channels the only way a headless run can: the Advanced paste box. */
async function stepConnect(page: Page): Promise<boolean> {
  await page.click(ADVANCED, { timeout: 15_000 })
  if (!check('Advanced opens the paste box', (await settleCount(page, FIELD, 1, { timeoutMs: 15_000 })) === 1)) {
    return false
  }
  for (const hook of HOOKS) {
    await page.fill(FIELD, `https://discord.com/api/webhooks/${hook.id}/${hook.token}`, { timeout: 15_000 })
    await page.click(SAVE, { timeout: 15_000 })
    const said = await saidOf(page)
    if (!check('a well-formed webhook URL becomes a channel', said.toLowerCase().startsWith('saved'), said)) return false
  }
  const live = await settle(() => disabledOf(page, SWITCH), (d) => !d, { timeoutMs: 20_000 })
  return check('with channels connected, the switch is live', !live)
}

/** TURN IT ON: the picker, the six kinds and the caption arrive together. */
async function stepTurnOn(page: Page): Promise<boolean> {
  await page.click(SWITCH, { timeout: 15_000 })
  const on = await settle(() => checkedOf(page, SWITCH), (v) => v, { timeoutMs: 15_000 })
  if (!check('the switch turns on', on)) return false
  check('…and main is holding it', await settle(() => storedEnabled(page), (v) => v, { timeoutMs: 15_000 }))
  check('…the channel picker appears, because there are two channels to choose between',
    (await settleCount(page, PICKER, 1, { timeoutMs: 15_000 })) === 1)
  check('…and the six kinds with it', (await countOf(page, KINDS)) === 1)
  for (const kind of KIND_IDS) {
    check(`…including a checkbox for ${kind}`, (await countOf(page, `[data-testid="pref-celebration-post-kind-${kind}"]`)) === 1)
  }
  const caption = await textOf(page, CARD)
  check('…and the card says what travels and what does not', caption.includes('item icons stay in the app'), caption.slice(0, 140))
  return true
}

/**
 * A KIND TOGGLES, AND MAIN IS THE ONE HOLDING THE ANSWER. Deaths ship OFF (they are private by
 * default), so turning that one ON is the change this step makes and reads back.
 */
async function stepToggleKind(page: Page): Promise<void> {
  const before = await storedKinds(page)
  check('deaths are opt-in, so they start unchosen', !before.includes('death'), before.join(','))
  check('…while level ups ship on', before.includes('levelUp'), before.join(','))
  await page.click(DEATH, { timeout: 15_000 })
  const kinds = await settle(() => storedKinds(page), (k) => k.includes('death'), { timeoutMs: 15_000 })
  check('checking Deaths reaches main', kinds.includes('death'), kinds.join(','))
  check('…and takes nothing else with it', kinds.includes('levelUp') && kinds.includes('bossKill'), kinds.join(','))
  // SETTLED, not read once: the box draws what main answered, which arrives a render after the
  // store already has it - so a bare read here races the card's own re-render rather than the write.
  check('…and the box reads back checked', await settle(() => checkedOf(page, DEATH), (v) => v, { timeoutMs: 15_000 }))
}

/** The four steps in order, each gating the next. Its own function so `main` stays one level of
 *  nesting deep - the repo's `max-depth 3`. */
async function runSteps(page: Page): Promise<void> {
  if (!(await openSharing(page))) return
  await stepNoChannel(page)
  if (!(await stepConnect(page))) return
  if (!(await stepTurnOn(page))) return
  await stepToggleKind(page)
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: production-shaped build on a staged log…')
  const { app, close } = await launchOnFixture('e2e-planner.log')

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

    await runSteps(page)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'celebration-post-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the celebration-post spec did not complete')
  process.exitCode = 1
})
