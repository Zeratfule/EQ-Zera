/**
 * PREVIEW THIS ITEM ON MY CHARACTER (EQ Zera) — the chain, end to end, in a real app.
 *
 * WHAT NEEDS A REAL APP HERE, and what does not. The pure half is already pinned without a DOM:
 * `shared/characterModel.ts` decides which model slot an item's equip slots map to, what one cell
 * overridden looks like (`applyPreview`), and which slots the client draws nothing for at all
 * (`INVISIBLE_MODEL_SLOTS`). What no unit test can see is the JOURNEY — a control on a windowed
 * gear row, an app-level focus slot with a nonce, a tab that UNMOUNTS on every switch and therefore
 * has to read the request on mount, a model card, a grid cell that must say it is not quoting the
 * dump any more, and a way back that puts the reader's own gear on the figure again. Two views, one
 * router, four surfaces: that is what this spec is for.
 *
 * IT LAUNCHES ON THE SAME STAGED DUMP THE CHARACTER SPEC USES (`Primitive_freeport-Inventory.txt`),
 * because the interesting assertion after "Back to my gear" is that the chest cell names the
 * DUMP'S OWN chest item again — which needs there to be one. The spec reads that name off the
 * screen before it previews anything rather than typing it here: the fixture is the owner's real
 * inventory and a frozen item name would rot the day it is re-staged.
 *
 * AND IT NAMES NO CORPUS ITEM EITHER. The plate chest and the ring it previews are FOUND: the era
 * filter is switched off and the class picker emptied so nothing is hidden, a search narrows the
 * table, and the first row whose Slot cell reads CHEST (or FINGER) is the subject. A spec that
 * typed "Blood Ember Breastplate" here would be asserting the scrape, not the feature.
 *
 * THE 3D FIGURE IS DELIBERATELY NOT ASSERTED beyond `data-preview-slot` on the model card. The real
 * `global_chr.s3d` is absent on CI and on most contributors' machines, so the card draws the
 * stylised doll there and the game's own model at the owner's desk; the preview contract is the
 * same on both paths and this spec pins the half that exists either way.
 *
 * Run: `node --import tsx tests/e2e/item-preview.e2e.mts`.
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

/** The gear area's one nav row, and the two tabs of it this spec walks between. */
const NAV_GEAR = '[data-testid="nav-gear"]'
const NAV_LOOT = '[data-testid="nav-loot"]'
const TAB_GEAR = '[data-testid="tab-gear"]'
const TAB_CHARACTER = '[data-testid="tab-character"]'

const GEAR_VIEW = '[data-testid="gear-view"]'
const GEAR_ROW = '[data-testid="gear-row"]'
const GEAR_SEARCH = '[data-testid="gear-search"] input'
const GEAR_CLASSES = '[data-testid="gear-classes"]'
const ERA_TOGGLE = '[data-testid="gear-era-toggle"]'
const GEAR_COUNT = '[data-testid="gear-count"]'
const DONOR_NAME = '[data-testid="planner-donor-name"]'

const SHEET = '[data-testid="character-sheet"]'
const MODEL = '[data-testid="character-model"]'
const BANNER = '[data-testid="character-preview"]'
const CLEAR = '[data-testid="character-preview-clear"]'
const CHEST_CELL = '[data-testid="character-slot-chest"]'

const LOOT_DETAIL = '[data-testid="loot-detail"]'
const LOOT_TITLE = '[data-testid="loot-detail-title"]'
const LOOT_ROW = '[data-testid="loot-row"]'
const LOOT_PREVIEW = '[data-testid="loot-preview"]'

/** The staged dump — the owner's own, and the one every other character spec reads. */
const DUMP = 'Primitive_freeport-Inventory.txt'

/** The caption the invisible slots must produce, verbatim enough to be the claim. */
const NO_LOOK = 'no look in the game files'

const textOf = (page: Page, sel: string): Promise<string> =>
  page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)

const until = (fn: () => Promise<boolean>, ms = 20_000): Promise<boolean> => settle(fn, (ok) => ok, { timeoutMs: ms })

/** Answer the analytics first-run notice; it sits along the bottom edge and eats clicks. */
async function answerNotice(page: Page): Promise<void> {
  if ((await countOf(page, '[data-testid="telemetry-notice"]')) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  await until(async () => (await countOf(page, '[data-testid="telemetry-notice"]')) === 0, 8_000)
}

// ── getting around ──────────────────────────────────────────────────────────────────────────

async function openGearArea(page: Page): Promise<boolean> {
  await page.waitForSelector(NAV_GEAR, { timeout: 60_000 })
  await page.click(NAV_GEAR, { timeout: 15_000 })
  const up = await page.waitForSelector(TAB_GEAR, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  return check('the gear area opens on a tab bar carrying both tabs this feature spans', up)
}

async function openCharacterTab(page: Page): Promise<boolean> {
  await page.click(TAB_CHARACTER, { timeout: 15_000 })
  return page.waitForSelector(SHEET, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
}

async function openGearTab(page: Page): Promise<void> {
  await page.click(TAB_GEAR, { timeout: 15_000 })
  await page.waitForSelector(GEAR_VIEW, { timeout: 30_000 })
}

/** Is the Character tab the one the bar says is selected? The other half of "we actually moved". */
function characterSelected(page: Page): Promise<boolean> {
  return page.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute('aria-selected') === 'true',
    TAB_CHARACTER
  )
}

// ── finding a subject in the corpus, rather than naming one ─────────────────────────────────

/** One candidate the table is currently drawing: its join key, its Slot cell, and its own name. */
interface Candidate {
  key: string
  slot: string
  item: string
}

/**
 * Every drawn row that carries a preview control, with the Slot cell it states. The NAME comes off
 * the control's own `data-item` rather than off the cell, because the Item cell also holds the era
 * chip and the wish button and `innerText` would hand back all three.
 */
function drawnRows(page: Page): Promise<Candidate[]> {
  return page.evaluate((sel) =>
    [...document.querySelectorAll(sel)].map((tr) => ({
      key: tr.getAttribute('data-item-key') ?? '',
      slot: (tr.querySelectorAll('td')[1] as HTMLElement | undefined)?.innerText.trim() ?? '',
      item: tr.querySelector('[data-testid="gear-preview"]')?.getAttribute('data-item') ?? ''
    })), GEAR_ROW)
}

/** The first drawn row for that slot which carries a preview control, or null. */
async function pickRow(page: Page, slot: string): Promise<Candidate | null> {
  const rows = await drawnRows(page)
  return rows.find((r) => r.slot === slot && r.item !== '') ?? null
}

/**
 * WAIT FOR THE TABLE TO STOP MOVING, not merely for a row to appear. The filter runs off a
 * `useDeferredValue` and the list is windowed, so a row that matches the first pass is routinely
 * REPLACED a frame later as the narrowing settles - and a click aimed at it lands on a detached
 * node. The count readout is the honest condition (gear.e2e's `typeAndSettle` uses the same one).
 */
async function settled(page: Page): Promise<void> {
  let last = ''
  await until(async () => {
    const now = await textOf(page, GEAR_COUNT)
    const stable = now !== '' && now === last
    last = now
    return stable
  }, 30_000)
}

/** Type into the search box and wait for the table to hold a row this spec can use. */
async function findCandidate(page: Page, term: string, slot: string): Promise<Candidate | null> {
  await page.fill(GEAR_SEARCH, term, { timeout: 15_000 })
  await settled(page)
  await until(async () => (await pickRow(page, slot)) !== null, 30_000)
  await settled(page)
  return pickRow(page, slot)
}

/**
 * Open the whole corpus. The era filter ships ON and the class picker mounts holding whatever the
 * log inferred, and either of them can legitimately hide a plate chest from a caster — which would
 * make this spec's subject a property of the fixture's class rather than of the corpus.
 */
async function openTheCorpus(page: Page): Promise<void> {
  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  for (let i = 0; i < 20; i++) {
    const chips = await countOf(page, `${GEAR_CLASSES} .MuiChip-root`)
    if (chips === 0) break
    await page.click(`${GEAR_CLASSES} input`, { timeout: 15_000 })
    await page.keyboard.press('Backspace')
  }
  await page.keyboard.press('Escape')
}

// ── the legs ────────────────────────────────────────────────────────────────────────────────

/**
 * 1. A PLATE CHEST, FROM THE GEAR TABLE ONTO THE MODEL, AND BACK OFF AGAIN.
 *
 * The whole journey in one step, because the interesting claims are about the seams between its
 * parts: the control belongs to a windowed row in one tab, the banner and the grid cell belong to
 * another tab that was not even mounted when it was clicked, and "Back to my gear" has to leave the
 * sheet saying exactly what it said before anybody previewed anything.
 */
async function stepChestPreview(page: Page, chest: Candidate, worn: string): Promise<void> {
  const { item, key } = chest
  note(`previewing "${item}" (${key})`)

  await page.click(`${GEAR_ROW}[data-item-key="${key}"] [data-testid="gear-preview"]`, { timeout: 15_000 })
  const landed = await page.waitForSelector(BANNER, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('clicking it lands on the Character tab with a preview banner up', landed)) return
  check('…and the tab bar agrees that is where we are', await characterSelected(page))
  check('…and the sheet is mounted under it', (await countOf(page, SHEET)) === 1)

  const banner = (await textOf(page, BANNER)).replace(/\s+/g, ' ')
  check('the banner names the item and the slot it is being tried in', banner.includes(item) && banner.includes('Chest'), banner)

  const cell = (await textOf(page, CHEST_CELL)).replace(/\s+/g, ' ')
  check('the grid`s chest cell names the previewed item instead of the worn one', cell.includes(item), cell)
  check(
    '…and SAYS it is a preview rather than swapping the name silently',
    (await page.getAttribute(CHEST_CELL, 'data-previewing')) === 'true'
  )
  check(
    'the model card states which slot the preview took over',
    (await page.getAttribute(MODEL, 'data-preview-slot')) === 'chest'
  )

  // BACK. The banner is the only affordance out, and what it has to restore is the DUMP'S answer.
  await page.click(CLEAR, { timeout: 15_000 })
  const gone = await until(async () => (await countOf(page, BANNER)) === 0)
  check('"Back to my gear" retires the banner', gone)
  const restored = (await textOf(page, CHEST_CELL)).replace(/\s+/g, ' ')
  check('…and the chest cell names the dump`s own chest item again', restored === worn, `"${restored}" vs "${worn}"`)
  check('…with the preview mark gone with it', (await page.getAttribute(CHEST_CELL, 'data-previewing')) === null)
  check('…and the model card no longer claims a previewed slot', (await page.getAttribute(MODEL, 'data-preview-slot')) === null)
}

/**
 * 2. A RING, WHICH THE CLIENT DRAWS NOTHING FOR.
 *
 * Ten of the twenty model slots change no pixel of the character in this client, and a preview that
 * quietly did nothing would read as a broken feature. The claim is that the banner SAYS so, in one
 * plain line, while still doing everything else it does.
 */
async function stepInvisibleSlot(page: Page): Promise<void> {
  await openGearTab(page)
  const ring = await findCandidate(page, 'ring', 'FINGER')
  check('the corpus offers a ring to try on', ring !== null)
  if (ring === null) return
  await page.click(`${GEAR_ROW}[data-item-key="${ring.key}"] [data-testid="gear-preview"]`, { timeout: 15_000 })
  const up = await page.waitForSelector(BANNER, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('a ring previews too, rather than the control being absent', up)) return
  const banner = (await textOf(page, BANNER)).replace(/\s+/g, ' ')
  check('…and the banner admits the game files hold no look for that slot', banner.includes(NO_LOOK), banner)
  check('…and names the item all the same', banner.includes(ring.item), banner)
  await page.click(CLEAR, { timeout: 15_000 })
  await until(async () => (await countOf(page, BANNER)) === 0)
}

/**
 * 3. THE ITEM PAGE'S OWN CONTROL, on the surface the feature was asked for.
 *
 * It gets there the way a reader does: the gear row's item NAME deep-links into the Loot tab's
 * drill-down, which is the app's item page. The control is drawn there for the same wearable this
 * spec has already previewed, so a present-and-working assertion is a real one.
 */
async function stepItemPage(page: Page, item: string): Promise<void> {
  await openGearTab(page)
  await page.fill(GEAR_SEARCH, item, { timeout: 15_000 })
  const row = await until(async () => (await countOf(page, `${GEAR_ROW} ${DONOR_NAME}`)) > 0)
  if (!check('the gear row for that item is on screen to drill from', row)) return
  await page.click(`${GEAR_ROW} ${DONOR_NAME}`, { timeout: 15_000 })
  const pane = await page.waitForSelector(LOOT_DETAIL, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('its name opens the item page in the Loot tab', pane)) return
  check('…on the item this spec asked for', (await textOf(page, LOOT_TITLE)).trim() === item, await textOf(page, LOOT_TITLE))
  if (!check('…and a wearable item page carries the preview control', (await countOf(page, LOOT_PREVIEW)) === 1)) return

  await page.click(LOOT_PREVIEW, { timeout: 15_000 })
  const landed = await page.waitForSelector(BANNER, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  check('clicking it takes the item page to the character, previewed', landed)
  if (landed) {
    check('…and the banner names it', (await textOf(page, BANNER)).includes(item))
    await page.click(CLEAR, { timeout: 15_000 })
    await until(async () => (await countOf(page, BANNER)) === 0)
  }
}

/**
 * 4. AND THE CONTROL IS ABSENT WHERE IT WOULD MEAN NOTHING.
 *
 * The fixture log loots exactly two things — `Jacinth` and `Mote of Major Potential` — and neither
 * is equippable, so neither has a row in the gear index. That is the majority case for item pages
 * in this app (a gem, a component, a note), and the house rule is absent, never disabled: the page
 * simply has one fewer control. Asserted on the fixture's own drop rather than on a name typed here.
 */
async function stepNonWearable(page: Page): Promise<void> {
  await page.click(NAV_LOOT, { timeout: 15_000 })
  const rows = await until(async () => (await countOf(page, LOOT_ROW)) > 0, 30_000)
  if (!check('the loot ledger has the fixture`s own drops in it', rows)) return
  await page.click(`${LOOT_ROW}`, { timeout: 15_000 })
  const pane = await page.waitForSelector(LOOT_DETAIL, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('a looted row opens its item page', pane)) return
  const name = (await textOf(page, LOOT_TITLE)).trim()
  check(
    `"${name}" is not something the model can wear, so its page draws NO preview control`,
    (await countOf(page, LOOT_PREVIEW)) === 0,
    name
  )
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

    if (await openGearArea(page)) {
      // The dump's own answer for the chest, read BEFORE anything is previewed — it is what "Back
      // to my gear" has to restore, and typing it here would pin the fixture instead of the feature.
      const sheetUp = await openCharacterTab(page)
      const worn = sheetUp ? (await textOf(page, CHEST_CELL)).replace(/\s+/g, ' ') : ''
      check('the sheet mounts from the staged dump, with a chest item to displace', sheetUp && worn !== '', worn)

      await openGearTab(page)
      await openTheCorpus(page)
      const chest = await findCandidate(page, 'breastplate', 'CHEST')
      check('the corpus offers a plate chest to try on', chest !== null)
      if (chest !== null) {
        await stepChestPreview(page, chest, worn)
        await stepInvisibleSlot(page)
        await stepItemPage(page, chest.item)
      }
      await stepNonWearable(page)
    } else {
      note('the gear area never opened — every claim below it is unmeasured, not passing')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'item-preview-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the item-preview spec did not complete')
  process.exitCode = 1
})
