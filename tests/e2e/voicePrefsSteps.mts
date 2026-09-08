/**
 * JOS-362 — THE VOICE LIVES IN PREFERENCES, AND NOWHERE ELSE.
 *
 * THE OWNER'S REPORT (2026-08-14, hands-on): "it appears that alerts created with a certain global
 * voice type selected under natural don't change when you select a new voice for natural in
 * preferences. all voices alert with natural voice should change the underlying voice when you
 * change this option. in fact, our settings shouldn't store which voice per alert, only the
 * preferences should (within Voice (spoken))."
 *
 * WHAT WAS ACTUALLY THERE. Nothing snapshotted the global voice at creation — but an alert COULD
 * own one: the editor's Speech block offered a per-alert voice override (`AlertSpeech.voiceId`),
 * the row carried it through every edit on purpose, and the firing path passed it to `speak()` in
 * preference to the prefs blob. A def that had ever been given one therefore kept speaking in it
 * no matter what Preferences said afterwards, which is precisely the symptom reported. The fix is
 * not a better default: the second place for the answer to live is GONE (the picker, the form
 * field, the write, and the read at speak time), so there is only one voice in the app.
 *
 * WHY THIS IS AN E2E CLAIM. The rule is about a value crossing four boundaries — the preferences
 * panel, main's electron-store, the player's live prefs copy (`refreshAlertStore` → `loadVoicePrefs`,
 * on the app's own focus event), and `speak()`. A unit test can pin any one of them and none of
 * them together, and the bug lived exactly in the joint. The observable is the engine seam's own
 * ring (`window.__eqSpeech`), which records the voice id each utterance went out with — and which
 * this channel never actually utters (`uttered:false`).
 *
 * A STEP MODULE rather than a spec, the alwaysPlayAllSteps.mts / customPhraseSteps.mts precedent:
 * voice-alerts.e2e.mts already stands up an app, a def list and this ring, and it is over its line
 * budget.
 */
import type { Page } from 'playwright-core'
import { check, settle } from './appHarness.mjs'

const ALERT_ID = 'e2e:voice-follows-prefs'
/** Two ids that are not real machine voices — the ring records what was ASKED for, unresolved. */
const VOICE_A = 'e2e:voice-one'
const VOICE_B = 'e2e:voice-two'

interface Spoken {
  text: string
  engine: string
  voiceId: string | null
  uttered: boolean
}

function spoken(page: Page): Promise<Spoken[]> {
  return page.evaluate(
    () => (window as unknown as { __eqSpeech?: { spoken: Spoken[] } }).__eqSpeech?.spoken ?? []
  ) as Promise<Spoken[]>
}

/**
 * Store voice prefs through main and make the renderer adopt them the way a returning user does.
 *
 * `setVoicePrefs` is the exact IPC the preferences panel saves with, and the player re-reads the
 * blob on the app's own `focus` event (player.tsx) — a hidden e2e window is never focused, so the
 * event is dispatched. No test-only back door is involved in either half.
 */
async function useVoice(page: Page, voiceId: string): Promise<string | null> {
  const stored = await page.evaluate(
    async (id) => {
      const eq = (
        window as unknown as {
          eq: {
            getVoicePrefs: () => Promise<Record<string, unknown>>
            setVoicePrefs: (p: Record<string, unknown>) => Promise<Record<string, unknown>>
          }
        }
      ).eq
      const prefs = await eq.getVoicePrefs()
      const next = await eq.setVoicePrefs({ ...prefs, voiceId: id })
      return (next.voiceId as string | null) ?? null
    },
    voiceId
  )
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  return stored
}

/** Test-fire the def and hand back the utterance the seam recorded for it. */
async function fireAndHear(page: Page): Promise<Spoken | null> {
  const before = (await spoken(page)).length
  await page.click(`[data-alert-id="${ALERT_ID}"] [data-testid="alert-test"]`)
  const all = await settle(() => spoken(page), (list) => list.length > before, {
    timeoutMs: 10_000
  }).catch(() => null)
  return all?.[all.length - 1] ?? null
}

/** A def that speaks a fixed sentence, and carries a DEAD per-alert voice id to be ignored. */
async function seedSpeakingDef(page: Page): Promise<number> {
  const saved = await page.evaluate(
    async (id) => {
      const eq = (window as unknown as { eq: { saveAlert: (d: unknown) => Promise<unknown[]> } }).eq
      const defs = await eq.saveAlert({
        id,
        name: 'Voice follows prefs',
        enabled: true,
        trigger: { type: 'event', kind: 'uncharm' },
        sound: { packId: 'alan-rickman', soundId: 'attention' },
        cooldownMs: 0,
        audio: 'speech',
        // THE RETIRED OVERRIDE, stored exactly as an older build would have written it. It must be
        // ignored rather than honoured — if anything still reads it, every check below sees it.
        speech: { mode: 'alertName', voiceId: 'e2e:stale-per-alert-voice' }
      })
      return defs.length
    },
    ALERT_ID
  )
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await settle(
    () => page.evaluate((sel) => document.querySelectorAll(sel).length, `[data-alert-id="${ALERT_ID}"]`),
    (n) => n === 1,
    { timeoutMs: 20_000 }
  )
  return saved
}

export async function stepVoiceFollowsPrefs(page: Page): Promise<void> {
  const saved = await seedSpeakingDef(page)
  if (!check('a speaking def saves through the app’s own IPC', saved > 0, `${String(saved)} defs stored`)) {
    return
  }

  const storedA = await useVoice(page, VOICE_A)
  if (!check('the voice preference round-trips through main', storedA === VOICE_A, String(storedA))) return
  const first = await fireAndHear(page)
  if (!check('the alert speaks', first !== null, 'the engine seam recorded nothing')) return
  check(
    'a firing uses the voice from Preferences, NOT the id stored on the def',
    first?.voiceId === VOICE_A,
    `spoke with "${String(first?.voiceId)}"`
  )
  check('…and this channel stayed mute doing it', first?.uttered === false, `uttered=${String(first?.uttered)}`)

  // THE REPORT, reproduced: change the preference and fire the SAME def again.
  const storedB = await useVoice(page, VOICE_B)
  if (!check('the second voice round-trips too', storedB === VOICE_B, String(storedB))) return
  const second = await fireAndHear(page)
  check(
    'THE REPORT: changing the voice in Preferences changes what an existing alert speaks with',
    second?.voiceId === VOICE_B,
    `spoke with "${String(second?.voiceId)}" after switching to "${VOICE_B}"`
  )

  // …and the editor offers no way to pin one back onto this alert.
  await page.click(`[data-alert-id="${ALERT_ID}"] [data-testid="alert-edit"]`)
  await page.waitForSelector('[data-testid="alert-speech-block"]', { timeout: 15_000 })
  check(
    'the alert editor offers no per-alert voice picker any more',
    (await page.evaluate(() => document.querySelectorAll('[data-testid="alert-speech-voice"]').length)) === 0
  )
  check(
    '…while the ▶ that auditions the real voice is still there',
    (await page.evaluate(() => document.querySelectorAll('[data-testid="alert-speech-test"]').length)) === 1
  )
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="alert-dialog"]', { state: 'detached', timeout: 10_000 })
}
