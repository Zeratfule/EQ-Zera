/**
 * Headless Electron regression test for JOS-348 — A LOOT TRIGGER KEEPS THE REGEX YOU TYPED.
 *
 * THE DEFECT, as the reporter hit it (01KZZY5J4F82HA9E6909QB3BXX, with a log slice): an alert with
 * trigger type `loot` does not save the regex field parameter the user entered. The slice says what
 * they were after — `--You have looted a Mote of Major Potential from a ratman warrior's corpse.--`
 * — an item family worth a sound.
 *
 * THE CAUSE is the pair of boxes in the condition editor. An 'event' condition is a kind plus ONE
 * optional field matcher, edited as `Field (optional)` + `Equals or /regex/`. `primitiveFromDraft`
 * can only build a `where` when it has BOTH halves, so a user who read "optional", typed the
 * pattern into the value box alone and pressed Save stored an alert that fires on EVERY loot line,
 * with the pattern discarded on the way out of the form. No error, no warning, and the box simply
 * empty the next time the dialog opened.
 *
 * WHY IT IS AN E2E SPEC AS WELL AS A UNIT TEST. `tests/alertConditionDraft.test.mts` pins the pure
 * rule and SOURCE-pins that `formCanSave` reads it, which is exactly the shape of claim that decays
 * — a source pin cannot see whether the Save button is really disabled, whether the error is really
 * rendered, or whether a saved `where` really survives IPC, electron-store and a re-hydration back
 * into the same dialog. This spec drives all four through the real app.
 *
 * HOW IT STAYS DETERMINISTIC ON A MACHINE WITH NO SOUND PACKS. `formCanSave` also requires a
 * `soundId`, and the shipped default pack self-provisions over the network into a userData
 * directory this run throws away — so on an offline machine Add is legitimately disabled for a
 * BRAND-NEW alert and a "Save is disabled" assertion would prove nothing. The probe def is
 * therefore WRITTEN FIRST through the same IPC the dialog saves with, carrying a sound of its own
 * (the trick `alert-dialog-focus.e2e.mts` already uses for the same reason), and edited from there.
 * Everything asserted about the button is then a fact about the CONDITION, not about the network.
 *
 * Run: `npm run test:e2e -- alert-loot-regex` (or
 * `node --import tsx tests/e2e/alert-loot-regex.e2e.mts`).
 */
import type { Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  reportRun,
  settle,
  settleGone
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const DIALOG = '[data-testid="alert-dialog"]'
const PROBE_ID = 'e2e:loot-regex-probe'
const ROW = `[data-alert-id="${PROBE_ID}"]`

/** The pattern the report was trying to author, verbatim from the shipped "Mote dropped" group. */
const REGEX = '/^Mote of /'
/** The field a loot line carries the dropped item in. The dialog never used to name it.  */
const FIELD = 'item'

interface StoredDef {
  id: string
  trigger?: { kind?: string; where?: Record<string, string> }
}

/** The value of an input inside a MUI TextField, addressed by the field's own testid. */
function valueOf(page: Page, testid: string): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLInputElement | null)?.value ?? '<missing>',
    `[data-testid="${testid}"] input`
  )
}

function fill(page: Page, testid: string, value: string): Promise<void> {
  return page.fill(`[data-testid="${testid}"] input`, value)
}

/**
 * WHICH EVENT KIND THE EDITOR IS SHOWING — found by the caption above it rather than by ordinal,
 * because the dialog holds several `Select`s (pack, sound, cooldown scope) and "the first one" is
 * a fact about layout, not about this control. MUI renders the closed Select as a `combobox`
 * whose text is the chosen `MenuItem`'s, which is the kind's own name.
 */
function eventKind(page: Page): Promise<string> {
  return page.evaluate(() => {
    const box = Array.from(document.querySelectorAll('[data-testid="alert-dialog"] div')).find(
      (d) => d.firstElementChild?.textContent?.trim() === 'Event kind'
    )
    return box?.querySelector('[role="combobox"]')?.textContent?.trim() ?? '<missing>'
  })
}

/** Is the dialog's Save/Add button disabled right now? */
function saveDisabled(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (document.querySelector('[data-testid="alert-save"]') as HTMLButtonElement | null)?.disabled ??
      true
  )
}

/** The helper text under the Field box — the sentence that has to say what is missing. */
function fieldKeyHelp(page: Page): Promise<string> {
  return page.evaluate(() => {
    const box = document.querySelector('[data-testid="alert-field-key"]')
    const id = (box?.querySelector('input') as HTMLInputElement | null)?.getAttribute('aria-describedby')
    const help = id ? document.getElementById(id) : null
    return (help?.textContent ?? '').trim()
  })
}

/** The def as main has it stored, read back over the real IPC. */
function storedProbe(page: Page): Promise<StoredDef | null> {
  return page.evaluate(
    (id) =>
      (window as unknown as { eq: { listAlerts: () => Promise<StoredDef[]> } }).eq
        .listAlerts()
        .then((defs) => defs.find((d) => d.id === id) ?? null),
    PROBE_ID
  ) as Promise<StoredDef | null>
}

/**
 * Write the probe def straight through `alerts:save`, then wait for its row.
 *
 * It is already a LOOT event trigger with NO `where` — the state a user reaches by picking the kind
 * — so the editor opens on the event branch with both boxes blank and the spec can type exactly
 * what the reporter typed. The sound is any installed one, or the shipped default's id when there
 * are none: the dialog hydrates `packId`/`soundId` from the def itself, so a non-empty pair is all
 * `formCanSave` needs and the button's state is decided by the condition alone.
 */
async function seedProbe(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 })
  await page.evaluate(async (id) => {
    const eq = (
      window as unknown as {
        eq: {
          saveAlert: (d: unknown) => Promise<unknown[]>
          listSoundPacks: () => Promise<{ id: string; sounds: Record<string, unknown> }[]>
        }
      }
    ).eq
    const packs = await eq.listSoundPacks()
    const pack = packs[0]
    // The shipped pack's charm-break alarm when nothing is installed (EQ_E2E skips provisioning):
    // a real cue of `eq-zera-console`, so the stored ref names something the app actually has.
    const fallback = 'input-required-alarm-01'
    const soundId = pack ? (Object.keys(pack.sounds)[0] ?? fallback) : fallback
    await eq.saveAlert({
      id,
      name: 'Mote dropped (JOS-348 probe)',
      enabled: true,
      trigger: { type: 'event', kind: 'loot' },
      sound: { packId: pack?.id ?? 'eq-zera-console', soundId },
      cooldownMs: 4000
    })
  }, PROBE_ID)
  // A def written straight through main is invisible to the OPEN view until something makes it
  // re-read: `useAlertsStore.reload()` runs on window focus, which the always-mounted AlertPlayer
  // listens for (player.tsx). A hidden e2e window is never given real OS focus by design, so the
  // event is dispatched — the same honest trick voice-alerts.e2e.mts and alert-dialog-focus.e2e.mts
  // already use, and the row appearing is the proof the reload really ran.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
  })
  const seen = await settle(() => countOf(page, ROW), (n) => n === 1, { timeoutMs: 20_000 })
  if (!check('the probe loot alert is in the list, ready to edit', seen === 1, `${String(seen)} rows`)) return false
  // …AND IT WENT IN AS A LOOT TRIGGER. Read back over the same IPC, because everything below is
  // about what the DIALOG does to this def and that only means something if the def main is
  // holding is the one this step asked for.
  const stored = await storedProbe(page)
  return check(
    '…stored as the loot event trigger it was written as',
    stored?.trigger?.kind === 'loot',
    JSON.stringify(stored?.trigger)
  )
}

/** Open the probe in the editor and confirm it arrived as a blank-matcher loot condition. */
async function openProbe(page: Page): Promise<boolean> {
  await page.click(`${ROW} [data-testid="alert-edit"]`)
  await page.waitForSelector(DIALOG, { timeout: 20_000 })
  const key = await valueOf(page, 'alert-field-key')
  const val = await valueOf(page, 'alert-field-val')
  // THE KIND IS PART OF THE PRECONDITION, not scenery: two empty boxes are also what a BLANK draft
  // looks like, so without this the step cannot tell "the editor hydrated from the loot def" from
  // "the editor never hydrated at all" - and the difference is what the save writes down.
  const named = await settle(() => valueOf(page, 'alert-name'), (v) => v !== '', { timeoutMs: 10_000 })
  const kind = await eventKind(page)
  return check(
    'the editor opens on the loot condition with both matcher boxes empty',
    key === '' && val === '' && kind === 'loot',
    `name "${named}", kind "${kind}", key "${key}", value "${val}"`
  )
}

/**
 * THE DEFECT ITSELF: a pattern typed with no field name must NOT be quietly saveable.
 *
 * Under the old code Save was enabled here, the click wrote a def with no `where` at all, and the
 * pattern was gone. The button staying disabled is the whole of the fix's refusal half.
 */
async function checkHalfWrittenIsRefused(page: Page): Promise<void> {
  await fill(page, 'alert-field-val', REGEX)
  const disabled = await settle(() => saveDisabled(page), (d) => d, { timeoutMs: 10_000 })
  check(
    'a regex typed with no field name cannot be saved, so it cannot be silently dropped',
    disabled,
    // An enabled button here IS the defect: the click would store a def with no `where` at all.
    `Save disabled: ${String(disabled)}`
  )
  const help = await fieldKeyHelp(page)
  check(
    '…and the Field box says what is missing, naming the field a loot alert wants',
    help.includes(FIELD),
    `helper text read "${help}"`
  )
  const kept = await valueOf(page, 'alert-field-val')
  check('…while the pattern stays on screen rather than being cleared', kept === REGEX, `read "${kept}"`)
}

/** Answer the error the way the user now can, and prove the def really carries the regex. */
async function checkNamingTheFieldSaves(page: Page): Promise<void> {
  await fill(page, 'alert-field-key', FIELD)
  const stillDisabled = await settle(() => saveDisabled(page), (d) => !d, { timeoutMs: 10_000 })
  if (!check('naming the field completes the condition and Save comes back', !stillDisabled)) return
  await page.click('[data-testid="alert-save"]')
  await settleGone(page, DIALOG, { timeoutMs: 15_000 })

  const stored = await settle(() => storedProbe(page), (d) => d?.trigger?.where !== undefined, {
    timeoutMs: 15_000
  })
  check(
    'the stored loot trigger carries the regex the user typed — through IPC and electron-store',
    stored?.trigger?.kind === 'loot' && stored.trigger.where?.[FIELD] === REGEX,
    JSON.stringify(stored)
  )
}

/** The half the reporter actually SAW: reopen the alert and the box is not empty. */
async function checkReopenShowsIt(page: Page): Promise<void> {
  await page.click(`${ROW} [data-testid="alert-edit"]`)
  await page.waitForSelector(DIALOG, { timeout: 20_000 })
  const key = await valueOf(page, 'alert-field-key')
  const val = await valueOf(page, 'alert-field-val')
  check(
    'reopening the alert shows the pattern, which is where the report noticed the loss',
    key === FIELD && val === REGEX,
    `key "${key}", value "${val}"`
  )
  check('and a complete condition leaves Save available', !(await saveDisabled(page)))
  await page.keyboard.press('Escape')
  await settleGone(page, DIALOG, { timeoutMs: 10_000 })
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-voice.log…')
  const { app, close } = await launchOnFixture('e2e-voice.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-alerts"]', { timeout: 60_000 })
    if ((await seedProbe(page)) && (await openProbe(page))) {
      await checkHalfWrittenIsRefused(page)
      await checkNamingTheFieldSaves(page)
      await checkReopenShowsIt(page)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'alert-loot-regex-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
