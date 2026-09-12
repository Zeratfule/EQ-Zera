/**
 * AWAY ALERTS, AS A PREFERENCES SECTION (src/shared/awayAlerts.ts).
 *
 * ONE TARGETED CLAIM, in four parts, and all of it about the SURFACE — the batching, the away
 * matrix, the embed and the rate ceiling are pure and are pinned in tests/awayAlerts.test.mts,
 * which is the right instrument for arithmetic. What only the real app can show is this:
 *
 *   1. THE SECTION EXISTS AND ITS CARD IS GATED. With no Discord channel connected there is
 *      nowhere to post, so the switch is DISABLED and the card says why in one clause — not a
 *      feature a reader can turn on and then wonder about.
 *   2. THE SWITCH REVEALS THE CONTROLS. Off, the card is one switch and one caption; on, it grows
 *      the channel rules, the alert checklist and the test button. A control that is on screen
 *      while it governs nothing is what the owner's 2026-08-17 review threw out.
 *   3. AN ALERT CHECKBOX TOGGLES AND PERSISTS. The proof is MAIN's own snapshot
 *      (`getAwayAlerts`), not the checkbox's opinion of itself.
 *   4. SEND A TEST REPORTS AN OUTCOME. Under `EQ_E2E` there is no Discord endpoint compiled in at
 *      all (src/main/share/discord.ts item 4), so the honest ending is the dark sentence — and
 *      what matters is that the button ENDS rather than going quiet.
 *
 * NOTHING IS EVER POSTED. The dark origin is structural, and the channel this spec connects is a
 * synthetic, well-formed webhook that names nothing — stored through the same main-side parse the
 * Advanced paste box uses, so no browser is opened either.
 *
 * Run: `npm run test:e2e -- away-alerts`
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
const RAIL_AWAY = '[data-testid="prefs-rail-away"]'
const RAIL_GAME = '[data-testid="prefs-rail-game"]'
const CARD = '[data-testid="pref-away-alerts"]'
const SWITCH = '[data-testid="pref-away-enabled"] input'
const IDLE = '[data-testid="pref-away-idle"]'
const GAME_CLOSED = '[data-testid="pref-away-game-closed"] input'
const SEARCH = '[data-testid="pref-away-search"] input'
const ALL = '[data-testid="pref-away-all"]'
const NONE = '[data-testid="pref-away-none"]'
const TEST = '[data-testid="pref-away-test"]'
const FLASH = '[data-testid="pref-away-flash"]'

/** A seeded alert that ships ENABLED on a fresh store (src/main/alertSeeds.ts). */
const ALERT = 'charm-break'
const ALERT_BOX = `[data-testid="pref-away-alert-${ALERT}"] input`

/** A well-formed webhook that names nothing: 19 digits and 68 token characters. */
const HOOK_URL = `https://discord.com/api/webhooks/1234567890123456789/${'abcdefghij'.repeat(6)}12345678`

/** What main stores for this feature. Mirrors `AwayAlertsView`'s two fields this spec reads. */
interface AwayView {
  prefs: { enabled: boolean; alertIds: string[]; idleMinutes: number; alsoWhenGameClosed: boolean }
  idleSeconds: number
}

/** The stored preference, straight from main - the proof rather than the control's own opinion. */
function stored(page: Page): Promise<AwayView> {
  return page.evaluate(() =>
    (window as unknown as { eq: { getAwayAlerts: () => Promise<AwayView> } }).eq.getAwayAlerts()
  )
}

/** Store a pasted webhook through main's own parse. No network, no browser. */
function connectChannel(page: Page, url: string): Promise<unknown> {
  return page.evaluate(
    (u) =>
      (
        window as unknown as { eq: { setDiscordWebhook: (t: string) => Promise<unknown> } }
      ).eq.setDiscordWebhook(u),
    url
  )
}

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** An `<input>`'s live `checked` / `disabled`, read as DOM properties rather than as classes. */
function inputState(page: Page, sel: string): Promise<{ checked: boolean; disabled: boolean }> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    return el instanceof HTMLInputElement
      ? { checked: el.checked, disabled: el.disabled }
      : { checked: false, disabled: true }
  }, sel)
}

/** The whole card's text, which is where the caption and the gate sentence live. */
function cardText(page: Page): Promise<string> {
  return textOf(page, CARD)
}

/**
 * THE CONSENT SNACKBAR GOES FIRST. It sits over the bottom of the content area and would cover a
 * MUI menu opened down there (AGENTS.md's e2e note), and this card opens one.
 */
async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  await page.waitForSelector(notice, { timeout: 30_000 }).catch(() => undefined)
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  check(
    'the analytics first-run notice can be answered out of the way',
    await settleGone(page, notice, { timeoutMs: 8_000 })
  )
}

/** Switch the rail to `id` and wait for `marker`. Also how this spec REMOUNTS the card. */
async function openSection(page: Page, id: string, marker: string): Promise<boolean> {
  await page.click(`[data-testid="prefs-rail-${id}"]`, { timeout: 20_000 })
  return page.waitForSelector(marker, { timeout: 20_000 }).then(
    () => true,
    () => false
  )
}

/** CLAIM 1: the section is in the rail, and with nothing connected the switch is a closed door. */
async function stepGated(page: Page): Promise<boolean> {
  await page.click(NAV_PREFS, { timeout: 60_000 })
  const railUp = await page.waitForSelector(RAIL_AWAY, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('Preferences grows an `Away alerts` section of its own', railUp)) return false
  if (!check('…and its card mounts', await openSection(page, 'away', SWITCH))) return false

  const sw = await inputState(page, SWITCH)
  check('the switch opens OFF, which is the shipped default', !sw.checked)
  check('…and DISABLED, because this install has nowhere to post', sw.disabled)
  const said = await cardText(page)
  check(
    '…and the card says so in one clause',
    said.includes('Connect a Discord channel first.'),
    said
  )
  check('with the switch off, no rules and no checklist are on screen', (await countOf(page, IDLE)) === 0)
  check('main agrees, on a store that has never been written', !(await stored(page)).prefs.enabled)
  return true
}

/** CLAIM 2: a connected channel opens the door, and the switch reveals everything behind it. */
async function stepReveal(page: Page): Promise<boolean> {
  await connectChannel(page, HOOK_URL)
  // The card reads the channel list ONCE per mount (lib/discordChannels), and the rail is a
  // switcher - so leaving the section and coming back IS the remount.
  await openSection(page, 'game', RAIL_GAME)
  if (!check('the card comes back after a rail round trip', await openSection(page, 'away', SWITCH))) {
    return false
  }

  const live = await settle(() => inputState(page, SWITCH), (s) => !s.disabled, { timeoutMs: 15_000 })
  if (!check('with a channel connected the switch is live', !live.disabled)) return false
  const said = await cardText(page)
  check(
    '…and the caption is now the feature, including the half that happens inside Discord',
    said.includes('turn on its mobile notifications in Discord') &&
      said.includes('at most one message every ten seconds'),
    said
  )

  await page.click(SWITCH, { timeout: 15_000 })
  const on = await settle(() => stored(page), (v) => v.prefs.enabled, { timeoutMs: 10_000 })
  check('turning it on is what main stores', on.prefs.enabled)
  check(
    'and main reports an idle reading for this machine, which is what the threshold is judged against',
    Number.isFinite(on.idleSeconds) && on.idleSeconds >= 0,
    String(on.idleSeconds)
  )

  check('the switch reveals the away rules', (await settleCount(page, IDLE, 1, { timeoutMs: 15_000 })) === 1)
  check('…the game-closed checkbox', (await countOf(page, GAME_CLOSED)) === 1)
  check('…the alert search box and its two bulk actions', (await countOf(page, SEARCH)) === 1)
  check('…Select all / Select none', (await countOf(page, ALL)) === 1 && (await countOf(page, NONE)) === 1)
  check('…and the test button', (await countOf(page, TEST)) === 1)
  // ONE CHANNEL, NO PICKER: a dropdown with one row in it is a question nobody needed asking
  // (lib/discordChannels states the rule).
  check(
    'with ONE connected channel there is no channel picker to answer',
    (await countOf(page, '[data-testid="pref-away-channel"]')) === 0
  )
  return true
}

/** CLAIM 3: a checkbox toggles, and MAIN's snapshot is what says it persisted. */
async function stepAlertPersists(page: Page): Promise<void> {
  const boxUp = (await settleCount(page, ALERT_BOX, 1, { timeoutMs: 15_000 })) === 1
  if (!check(`a seeded enabled alert ("${ALERT}") is offered as a row`, boxUp)) return
  check('…and it starts unticked, because the default selects nothing', !(await inputState(page, ALERT_BOX)).checked)

  await page.click(ALERT_BOX, { timeout: 15_000 })
  const picked = await settle(() => stored(page), (v) => v.prefs.alertIds.includes(ALERT), {
    timeoutMs: 10_000
  })
  check('ticking it is what main stores', picked.prefs.alertIds.includes(ALERT), picked.prefs.alertIds.join(','))

  // AND IT SURVIVES A REMOUNT, which is the half a unit test of the write cannot see: the rail is a
  // switcher, so every trip away from this section unmounts the card entirely.
  await openSection(page, 'game', RAIL_GAME)
  await openSection(page, 'away', ALERT_BOX)
  check('…and the card paints it ticked when it comes back', (await inputState(page, ALERT_BOX)).checked)

  await page.click(NONE, { timeout: 15_000 })
  const cleared = await settle(() => stored(page), (v) => v.prefs.alertIds.length === 0, {
    timeoutMs: 10_000
  })
  check('Select none empties the selection through the same door', cleared.prefs.alertIds.length === 0)
}

/** CLAIM 4: the test button reports an outcome rather than going quiet. */
async function stepTest(page: Page): Promise<void> {
  await page.click(TEST, { timeout: 15_000 })
  const said = await settle(() => textOf(page, FLASH), (t) => t !== '', { timeoutMs: 20_000 })
  check('pressing Send a test reports an outcome', said !== '', said)
  check(
    '…and under a dark build the outcome is the dark sentence',
    said === 'This build cannot post to Discord.',
    said
  )
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: production-shaped build on a staged log…')
  const { app, close } = await launchOnFixture('e2e-telemetry.log')

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

    if (await stepGated(page)) {
      if (await stepReveal(page)) {
        await stepAlertPersists(page)
        await stepTest(page)
      }
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'away-alerts-FAIL')
  } finally {
    await close()
  }

  if (failures.length === 0) {
    note('nothing was posted: EQ_E2E compiles no Discord endpoint, and the connected webhook is synthetic')
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the away-alerts spec did not complete')
  process.exitCode = 1
})
