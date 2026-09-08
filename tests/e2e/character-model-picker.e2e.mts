/**
 * WHO THE MODEL CARD DRAWS — race, sex and face, through the real controls (EQ Zera, 2026-09-08).
 *
 * "Having the ability to change the character model faces for both sexes and all races should be
 * an option too. We want to represent everyone's characters." (owner). The card's one Select of
 * fused actor codes is now three controls, and this spec walks them: pick Female, pick Dwarf, and
 * read what actually landed in localStorage — because the pick is a PREFERENCE and the tab
 * unmounts on every switch, so a pick that does not reach storage is a pick the reader loses
 * (JOS-90/97/116, the same bug three times).
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT: a pixel of the 3D figure. `tests/e2e/item-preview.e2e.mts`
 * spells the policy out — `global_chr.s3d` is absent on CI and on the harness's own throwaway
 * install, so the card draws the stylised doll here and the game's own model at the owner's desk.
 * The picker DOM is the same on both paths, which is the half this spec pins. The FACE control is
 * the one thing that legitimately is not: it draws only when a payload has NAMED the faces that
 * exist (world-model law 1 — the renderer never guesses one), so its assertion is guarded on the
 * 3D host being on screen and NOTED, not silently passed, when it is not.
 *
 * The face table itself is measured against the real archives in `tests/eqAssets.test.mts`
 * (a dwarf female has seven faces, numbered from one, and her bare head binds face 2).
 *
 * Run: `npm run test:e2e -- character-model-picker` (or node --import tsx this file).
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const NAV_GEAR = '[data-testid="nav-gear"]'
const TAB_GEAR = '[data-testid="tab-gear"]'
const TAB_CHARACTER = '[data-testid="tab-character"]'
const MODEL = '[data-testid="character-model"]'
const MODEL_3D = '[data-testid="character-model-3d"]'

const RACE = '[data-testid="character-model-race"]'
const SEX_MALE = '[data-testid="character-model-sex-M"]'
const SEX_FEMALE = '[data-testid="character-model-sex-F"]'
const SEX = '[data-testid="character-model-sex"]'
const FACE = '[data-testid="character-model-face-picker"]'
const FACE_OPTION = '[data-testid="character-model-face-option"]'

/** The three keys the picks land in. The face is per actor code, so a human pick cannot dress a dwarf. */
const RACE_KEY = 'eq.character.race'
const SEX_KEY = 'eq.character.sex'
const FACE_KEY_DWF = 'eq.character.face.DWF'

/** The staged dump, so the card has a real sheet under it (the same fixture the sheet spec uses). */
const DUMP = 'Primitive_freeport-Inventory.txt'

function stored(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  }, key)
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
}

async function openCharacterTab(page: Page): Promise<boolean> {
  const hasRow = await page.waitForSelector(NAV_GEAR, { timeout: 60_000 }).then(() => true, () => false)
  if (!check('the gear area has its one nav row', hasRow)) return false
  await page.click(NAV_GEAR, { timeout: 15_000 })
  const barUp = await page.waitForSelector(TAB_GEAR, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('…and it opens an area whose tab bar is on screen', barUp)) return false
  await page.click(TAB_CHARACTER, { timeout: 15_000 })
  const card = await page.waitForSelector(MODEL, { timeout: 30_000 }).then(() => true, () => false)
  return check('…and the Character tab mounts the model card', card)
}

// ── the three controls ─────────────────────────────────────────────────────────────────────

async function stepControls(page: Page): Promise<void> {
  check('the model card has a RACE picker', (await countOf(page, RACE)) === 1)
  check('…a SEX picker, two buttons', (await countOf(page, SEX)) === 1 && (await countOf(page, SEX_MALE)) === 1 && (await countOf(page, SEX_FEMALE)) === 1)

  // Every playable race is NAMED, including the three this app has no model for - which are
  // listed disabled rather than left out, so the answer to "where is my Froglok" is on screen.
  await page.click(RACE, { timeout: 15_000 })
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('li[role="option"]')].map((el) => ({
      value: el.getAttribute('data-value') ?? '',
      text: (el as HTMLElement).innerText.trim(),
      disabled: el.getAttribute('aria-disabled') === 'true'
    }))
  )
  check('the race list offers all sixteen playable races', options.length === 16, `${String(options.length)} rows`)
  const drawable = options.filter((o) => !o.disabled).map((o) => o.value)
  check('…thirteen of them have a model here: the classic twelve plus the Iksar', drawable.length === 13 && drawable.includes('IK'), drawable.join(' '))
  const named = options.filter((o) => o.disabled)
  check(
    '…and the other three are named honestly, not hidden',
    named.length === 3 && named.every((o) => o.text.includes('no model in this app yet')),
    named.map((o) => o.text).join(' | ')
  )
  await page.keyboard.press('Escape')
}

// ── a pick is a preference, and a preference reaches storage ───────────────────────────────

async function pickRace(page: Page, code: string): Promise<string | null> {
  await page.click(RACE, { timeout: 15_000 })
  await page.click(`li[role="option"][data-value="${code}"]`, { timeout: 15_000 })
  return settle(() => stored(page, RACE_KEY), (v) => v === code, { timeoutMs: 8_000 })
}

async function stepPicks(page: Page): Promise<void> {
  await page.click(SEX_FEMALE, { timeout: 15_000 })
  const sex = await settle(() => stored(page, SEX_KEY), (v) => v === 'F', { timeoutMs: 8_000 })
  check('choosing Female is remembered under its own key', sex === 'F', `stored ${String(sex)}`)

  const race = await pickRace(page, 'DW')
  check('choosing Dwarf is remembered as the TWO-letter race, not the fused actor code', race === 'DW', `stored ${String(race)}`)
  check('…and the sex key is untouched by the race pick', (await stored(page, SEX_KEY)) === 'F')
}

// ── the faces, when this machine has the game's own files ──────────────────────────────────

async function stepFaces(page: Page): Promise<void> {
  if ((await countOf(page, MODEL_3D)) === 0) {
    note('no EverQuest model files under the staged install, so the card draws the stylised doll - the face control is unmeasured here, not passing (it is measured against the real archives in tests/eqAssets.test.mts)')
    check('…and with no payload there is no face control either, rather than a guessed one', (await countOf(page, FACE)) === 0)
    return
  }
  const options = await settle(() => countOf(page, FACE_OPTION), (n) => n > 0, { timeoutMs: 20_000 })
  check('the dwarf female offers exactly seven faces (she has no face 0 at all)', options === 7, `${String(options)} options`)
  const labels = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => (el as HTMLElement).innerText.trim()), FACE_OPTION)
  check('…numbered the way a player counts them, from one', labels.join(' ') === '2 3 4 5 6 7 8', labels.join(' '))

  // The pick is per ACTOR CODE, so a face chosen on a dwarf woman is hers alone.
  await page.click(`${FACE_OPTION}[data-face="4"]`, { timeout: 15_000 })
  const face = await settle(() => stored(page, FACE_KEY_DWF), (v) => v === '4', { timeoutMs: 8_000 })
  check('choosing a face is remembered against that actor alone', face === '4', `stored ${String(face)}`)
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

    if (await openCharacterTab(page)) {
      await stepControls(page)
      await stepPicks(page)
      await stepFaces(page)
    } else {
      note('the model card never mounted - every claim below it is unmeasured, not passing')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'character-model-picker-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the character-model-picker spec did not complete')
  process.exitCode = 1
})
