/**
 * JOS-222 — THE GLOBAL "ALWAYS PLAY" PREFERENCE, and the per-alert box it takes over.
 *
 * A step module rather than a spec of its own (the suggestRowSteps.mts precedent): everything it
 * needs — a launched app, a seeded alert list, the Alerts tab — is already standing in
 * voice-alerts.e2e.mts, which is also the spec that owns the throttle opt-out this preference
 * overrides. A second Electron launch to click one switch would buy nothing but 40 seconds.
 *
 * WHY IT IS AN E2E CLAIM AT ALL. The DECISION is pure and unit-tested (coalesceAudio, in
 * tests/voiceAlerts.test.mts); what cannot be unit-tested is the WIRING, and its failure mode is
 * silent. `allAlwaysPlay` is an optional prop that defaults to false down two components
 * (AlertsView → AlertDialog → SpeechBlock), so a forgotten hand-off type-checks perfectly and
 * ships an editor whose switch simply never greys out — the app would go on obeying the
 * preference while telling the user, in the one place they look, that it does not. Only the real
 * app can show the preference reaching the modal.
 *
 * IT ASSERTS THE DEFAULT FIRST, and this is the one place that reading is honest: every e2e
 * launch gets a FRESH userData dir (channel 'e2e'), so the toolbar switch here is genuinely what
 * a brand-new install shows, and the owner's binding "starts OFF" is a first-run claim.
 *
 * IT RESTORES WHAT IT CHANGED. The steps that follow in the host spec fire alerts and count
 * utterances; leaving the audio throttle switched off for them would be this module reaching into
 * somebody else's assertions. Off → on → off, and the last transition is checked like the first.
 */
import type { Page } from 'playwright-core'
import { check, countOf, settle, settleGone } from './appHarness.mjs'

/** The global switch, in the alerts toolbar beside Global volume and Mute all. */
const TOGGLE = '[data-testid="alerts-always-play-all"] input'
/** The per-alert opt-out inside the editing modal, and the span that carries its hover line. */
const PER_ALERT = '[data-testid="alert-always-play"] input'
const PER_ALERT_WRAP = '[data-testid="alert-always-play-wrap"]'

/** One switch as the DOM has it. A missing node reads as absent rather than as null, so every
 *  caller can ask its question without first asking whether there is anything to ask about. */
interface SwitchState {
  present: boolean
  checked: boolean
  disabled: boolean
}

const ABSENT: SwitchState = { present: false, checked: false, disabled: false }

function switchState(page: Page, sel: string): Promise<SwitchState> {
  return page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLInputElement | null
    return el
      ? { present: true, checked: el.checked, disabled: el.disabled }
      : { present: false, checked: false, disabled: false }
  }, sel)
}

/** The native `title` on the wrapping span — the hover explanation, or '' when there is none. */
function wrapTitle(page: Page): Promise<string> {
  return page.evaluate(
    (s) => (document.querySelector(s) as HTMLElement | null)?.getAttribute('title') ?? '',
    PER_ALERT_WRAP
  )
}

/** Open the first alert's editor and wait for the Speech block to be laid out. */
async function openFirstEditor(page: Page): Promise<void> {
  await page.click('[data-testid="alert-row"]:first-of-type [data-testid="alert-edit"]')
  await page.waitForSelector('[data-testid="alert-speech-block"]', { timeout: 15_000 })
}

async function closeEditor(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await settleGone(page, '[data-testid="alert-dialog"]', { timeoutMs: 10_000 })
}

/** The per-alert switch as the editor currently renders it, waited for rather than sampled. */
async function perAlertWhen(page: Page, disabled: boolean): Promise<SwitchState> {
  await openFirstEditor(page)
  return settle(() => switchState(page, PER_ALERT), (s) => s.disabled === disabled, {
    timeoutMs: 10_000
  }).catch(() => ABSENT)
}

/**
 * Flip the toolbar switch and wait for MAIN to agree.
 *
 * The click is optimistic in the renderer and the write is an IPC round trip, so the condition is
 * the STORE's answer (`alertPrefs:get`), not the switch's own paint — that is the seam a
 * preference can fall through, and reading the control we just clicked would prove nothing.
 */
async function setGlobal(page: Page, on: boolean): Promise<boolean> {
  await page.click(TOGGLE)
  const stored = await settle(
    () => page.evaluate(() => window.eq.getAlertPrefs().then((p) => p.alwaysPlayAll === true)),
    (v) => v === on,
    { timeoutMs: 10_000 }
  ).catch(() => !on)
  return stored === on
}

/** OFF out of the box, and every alert still holding its own opt-out. */
async function stepDefaultOff(page: Page): Promise<SwitchState> {
  const toolbar = await switchState(page, TOGGLE)
  if (!check('the alerts toolbar offers the global always-play preference', toolbar.present)) {
    return ABSENT
  }
  check(
    'a fresh install has it OFF — the audio throttle keeps its default behaviour (owner spec)',
    toolbar.checked === false,
    `checked=${String(toolbar.checked)}`
  )
  const box = await perAlertWhen(page, false)
  // `present` is asserted, not assumed: an ABSENT control also reads `disabled:false`, so without
  // this the whole module would go green against an editor that had lost the switch entirely.
  check(
    '…so each alert still owns its own opt-out, editable, with nothing to explain',
    box.present && box.disabled === false && (await wrapTitle(page)) === '',
    `present=${String(box.present)} disabled=${String(box.disabled)}`
  )
  await closeEditor(page)
  return box
}

/** ON: the modal's box greys out, keeps this alert's own value, and says why on hover. */
async function stepGreyedOut(page: Page, before: SwitchState): Promise<void> {
  const box = await perAlertWhen(page, true)
  check(
    'the per-alert option GREYS OUT while the global preference is on',
    box.disabled,
    `disabled=${String(box.disabled)}`
  )
  check(
    '…still showing THIS alert’s own saved value — the global one is a bypass, not a rewrite',
    box.checked === before.checked,
    `${String(before.checked)} → ${String(box.checked)}`
  )
  const title = await wrapTitle(page)
  check(
    '…and one short sentence on hover says the global preference is what controls it',
    title.includes('Always play is on for every alert') && title.length < 160,
    `title="${title}"`
  )
  await closeEditor(page)
}

/** …and back, which is both the other direction and the cleanup the host spec needs. */
async function stepHandedBack(page: Page): Promise<void> {
  const box = await perAlertWhen(page, false)
  const title = await wrapTitle(page)
  check(
    'switching the preference back off hands the per-alert option straight back',
    box.present && box.disabled === false && title === '',
    `disabled=${String(box.disabled)} title="${title}"`
  )
  await closeEditor(page)
}

export async function stepAlwaysPlayAll(page: Page): Promise<void> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 })

  const before = await stepDefaultOff(page)
  if (!before.present) return

  if (!check('turning it on reaches main and is stored', await setGlobal(page, true))) return
  await stepGreyedOut(page, before)

  if (!check('turning it off again is stored too', await setGlobal(page, false))) return
  await stepHandedBack(page)
  check('the alert list survived the round trip', (await countOf(page, '[data-testid="alert-row"]')) > 0)
}
