/**
 * SHARING A CHARACTER PROFILE (EQ Zera) — the card, the string, and the round trip between them.
 *
 * The owner asked for a way to show somebody else your gear and your gear scores. V1 has no
 * server, so the feature is two artefacts and this spec drives both:
 *
 *   THE CARD — a fixed 720px block with the twenty-four armory places, the gear totals, and the
 *   four Build-tab meters. Photographed by main (`character:shareImage`) rather than rendered
 *   offscreen, which is why "Copy image" is asserted through its OWN reported outcome and not
 *   through pixels: main's clipboard write answers a boolean, and the button says what it got.
 *
 *   THE STRING — the app's `EQC1-` envelope, `kind:'character'`. The round trip is the assertion
 *   that matters: encode this character, paste that string into the viewer, and the viewer must
 *   draw the same character. That is a claim about the WHOLE pipe (renderer -> deflate in main ->
 *   checksum -> sanitize -> render) and no unit test can make it.
 *
 * ---------------------------------------------------------------------------
 * HOW THE STRING GETS INTO THIS SPEC, AND WHY IT IS A PRODUCT AFFORDANCE
 * ---------------------------------------------------------------------------
 * `navigator.clipboard.readText()` cannot work here: this app denies every web permission
 * wholesale (`hardenSession`, src/main/windows.ts) and the clipboard is IPC-only by design, so
 * reading back what "Copy share string" copied is not available to a page. A spec may not import
 * `src/` either, so it cannot encode the profile itself.
 *
 * So the dialog PUBLISHES the string it would copy, as `data-share-string` on its own root. That
 * is not a test hook bolted on: it is the exact value the Copy button hands to the clipboard, and
 * having it on the element is what lets the whole round trip be driven end to end here. The spec
 * reads it, pastes it into the viewer, and asserts the viewer drew the same character.
 *
 * Run: `npm run test:e2e -- character-share` (or node --import tsx this file).
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
const DIALOG = '[data-testid="character-share-dialog"]'
const CARD = '[data-testid="character-share-card"]'
const SLOT = '[data-testid="character-share-slot"]'
const FILLED = '[data-testid="character-share-slot"][data-filled="true"]'
const RANK = '[data-testid="character-share-rank"]'
const TIP = '[data-testid="share-cell-tooltip"]'
const SCORE = '[data-testid="character-share-score"]'
const NO_SCORES = '[data-testid="character-share-no-scores"]'
const COPY_STRING = '[data-testid="character-share-copy-string"]'
const COPY_IMAGE = '[data-testid="character-share-copy-image"]'
const COPY_TEXT = '[data-testid="character-share-copy-text"]'
const COPY_LINK = '[data-testid="character-share-copy-link"]'
const LINK_ERROR = '[data-testid="character-share-link-error"]'
const CLOSE = '[data-testid="character-share-close"]'

const VIEW = '[data-testid="character-share-view"]'
const PASTE = '[data-testid="character-share-paste"]'
const SHOW = '[data-testid="character-share-show"]'
const VIEW_ERROR = '[data-testid="character-share-error"]'
const VIEW_CLOSE = '[data-testid="character-share-view-close"]'
const STAMP = '[data-testid="character-share-stamp"]'

/** The staged dump, and the numbers it makes exact. Pinned by tests/characterShare.test.mts too. */
const DUMP = 'Primitive_freeport-Inventory.txt'
/** The armory is a fixed set of places, drawn filled or not - the card keeps the grid's law. */
const CELLS = 24
/** …and the real dump fills all but two of them. */
const WORN = 22
/** Tank, DPS, Healer, Solo. */
const METERS = 4
/** The character the fixture dump belongs to - the name the card prints and the viewer reads back. */
const NAME = 'Primitive'
/**
 * THE OWNER'S REPORT (2026-09-09), as two numbers off the staged dump. The hands cell wears
 * `Gauntlets of Fiery Might +5`: the rank used to ride the end of a name the cell ellipsized, and
 * now it is a badge on the icon, so the `+5` is on screen whatever the name's length. The item
 * window behind that cell is drawn from the BODY - the stat is what the gauntlets read at +5.
 */
const RANK_SLOT = 'hands'
const RANK_TEXT = '5'
const RANK_STAT = 'Strength'

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** The share string the dialog publishes - what Copy hands the clipboard. '' until main answers. */
function shareString(page: Page): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.getAttribute('data-share-string') ?? '', DIALOG)
}

/** Every score tile's number, read off the attribute the tile states it in. */
function scores(page: Page): Promise<number[]> {
  return page.evaluate(
    (s) => [...document.querySelectorAll(s)].map((el) => Number(el.getAttribute('data-score'))),
    SCORE
  )
}

/** Every rank badge on the card, as the number it states. */
function ranks(page: Page): Promise<string[]> {
  return page.evaluate(
    (s) => [...document.querySelectorAll(s)].map((el) => el.getAttribute('data-rank') ?? ''),
    RANK
  )
}

/**
 * Hover one cell of the card and read the item window it opens, then move off and wait for it to
 * go. The move-off matters: a card left hovered would be photographed by the next Copy image.
 */
async function hoverCell(page: Page, slot: string): Promise<string> {
  await page.hover(`[data-testid="share-cell-${slot}"]`, { timeout: 15_000 })
  const up = (await settleCount(page, TIP, 1, { timeoutMs: 15_000 })) === 1
  const text = up ? await textOf(page, TIP) : ''
  await page.mouse.move(2, 2)
  await settleGone(page, TIP, { timeoutMs: 15_000 })
  return text
}

/** The rank badges, and the item window a filled cell opens. Both sides of the owner's report. */
async function checkGearDetail(page: Page, where: string): Promise<void> {
  const badges = await ranks(page)
  check(`${where}: an upgraded item shows its rank as a badge, not as the end of a long name`, badges.length > 0, `${String(badges.length)} badges`)
  check(`${where}: …and every badge states a number`, badges.length > 0 && badges.every((r) => /^\d+$/.test(r)), badges.join(' '))
  check(`${where}: …including the +${RANK_TEXT} the staged dump wears on its hands`, badges.includes(RANK_TEXT), badges.join(' '))

  const tip = await hoverCell(page, RANK_SLOT)
  check(`${where}: hovering a worn cell opens the item's own window`, tip !== '', tip.split('\n')[0] ?? '')
  check(`${where}: …carrying at least one stat line from the shared body`, tip.includes(RANK_STAT), tip.replace(/\n/g, ' · ').slice(0, 120))
}

/** A button's transient outcome ("Copied" / "Saved" / "Could not"), or '' while it names its action. */
function flashOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.getAttribute('data-flash') ?? '', sel)
}

async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
  check('the analytics first-run notice can be answered out of the way', await settleGone(page, notice, { timeoutMs: 8_000 }))
}

/** Open the gear area's Character tab and wait for the sheet the card is built from. */
async function openCharacterTab(page: Page): Promise<boolean> {
  const hasRow = await page.waitForSelector(NAV_GEAR, { timeout: 60_000 }).then(() => true, () => false)
  if (!check('the gear area has its one nav row', hasRow)) return false
  await page.click(NAV_GEAR, { timeout: 15_000 })
  const barUp = await page.waitForSelector(TAB_GEAR, { timeout: 30_000 }).then(() => true, () => false)
  if (!check('…and its tab bar is on screen', barUp)) return false
  await page.click(TAB, { timeout: 15_000 })
  const mounted = await page.waitForSelector(SHEET, { timeout: 30_000 }).then(() => true, () => false)
  return check('…and the Character tab mounts a sheet built from the staged dump', mounted)
}

// ── the card ───────────────────────────────────────────────────────────────────────────────

async function stepCard(page: Page): Promise<boolean> {
  if (!check('the Character tab offers a Share button', (await countOf(page, SHARE)) === 1)) return false
  await page.click(SHARE, { timeout: 15_000 })

  const up = (await settleCount(page, CARD, 1, { timeoutMs: 30_000 })) === 1
  if (!check('…and it opens a dialog holding the share card', up)) return false

  const slots = await countOf(page, SLOT)
  check(`the card draws every armory place, filled or not (${String(CELLS)})`, slots === CELLS, `${String(slots)} places`)
  const filled = await countOf(page, FILLED)
  check(`…and the staged dump fills ${String(WORN)} of them`, filled === WORN, `${String(filled)} filled`)

  // THE FOUR METERS. The Build tab's index is a main-side read, so the tiles arrive a beat after
  // the card does; the wait is for the tiles, and the assertion is on their numbers.
  const read = await settle(() => scores(page), (s) => s.length === METERS, { timeoutMs: 45_000 })
  if (read.length !== METERS && (await countOf(page, NO_SCORES)) === 1) {
    note('the Build tab had no reading on this launch, so the card states the absence - scores unmeasured')
  } else {
    check(`the card shows all four gear meters (${String(METERS)})`, read.length === METERS, read.join(' · '))
    check(
      '…and every one of them is a percent',
      read.length > 0 && read.every((n) => Number.isFinite(n) && n >= 0 && n <= 100),
      read.join(' · ')
    )
  }

  const head = await textOf(page, CARD)
  check('the card names the character the dump belongs to', head.includes(NAME), head.split('\n')[0] ?? '')
  await checkGearDetail(page, 'the card')
  return true
}

// ── the four ways out ──────────────────────────────────────────────────────────────────────

/** Click an action and wait for the outcome it reports on itself. */
async function pressed(page: Page, sel: string): Promise<string> {
  await page.click(sel, { timeout: 15_000 })
  return settle(() => flashOf(page, sel), (f) => f !== '', { timeoutMs: 15_000 })
}

async function stepActions(page: Page): Promise<string> {
  // The string first: everything below depends on main having encoded one.
  const text = await settle(() => shareString(page), (s) => s.startsWith('EQC1-'), { timeoutMs: 30_000 })
  check('the dialog publishes the share string it would copy', text.startsWith('EQC1-'), `${String(text.length)} chars`)
  check('…and it is a single line with nothing a chat client mangles', !/[\s+/=]/.test(text.slice(5)))

  check('Copy share string reports that it copied', (await pressed(page, COPY_STRING)) === 'Copied')
  check('Copy text reports that it copied', (await pressed(page, COPY_TEXT)) === 'Copied')
  // COPY IMAGE, THROUGH ITS OWN REPORT AND NOT THROUGH PIXELS. Main captures the card's rectangle
  // and writes a NativeImage to the OS clipboard; 'Copied' is that write having happened. What the
  // image LOOKS like is not something a spec can assert without becoming a screenshot test.
  check('Copy image reports that the card reached the clipboard', (await pressed(page, COPY_IMAGE)) === 'Copied')

  // COPY LINK, WITH THE ENDPOINT DARK. `share.eqzera.com` is a live host, and the harness must
  // never publish a real record, so an `EQ_E2E` build compiles with NO share origin at all
  // (src/main/share/net.ts) and a publish is structurally impossible rather than merely unlikely.
  // What is asserted here is therefore the OUTCOME REPORTING: main answers a sentence, the button
  // says so or the row prints it, and - the part that matters - the dialog still works afterwards.
  const linkFlash = await pressed(page, COPY_LINK)
  const linkError = (await countOf(page, LINK_ERROR)) === 1 ? await textOf(page, LINK_ERROR) : ''
  check('Copy link reports its outcome rather than going quiet', linkFlash !== '' || linkError !== '', `${linkFlash} | ${linkError}`)
  check('…and the dialog is still on screen', (await countOf(page, CARD)) === 1)
  check('…and Copy share string still works after it', (await pressed(page, COPY_STRING)) === 'Copied')

  await page.click(CLOSE, { timeout: 15_000 })
  check('…and the dialog closes', await settleGone(page, CARD, { timeoutMs: 15_000 }))
  return text
}

// ── the round trip ─────────────────────────────────────────────────────────────────────────

async function stepViewer(page: Page, text: string): Promise<void> {
  if (!check('there is a share string to paste back', text.startsWith('EQC1-'))) return
  if (!check('the Character tab offers a way to view somebody else’s profile', (await countOf(page, VIEW)) === 1)) return
  await page.click(VIEW, { timeout: 15_000 })
  if (!check('…and it opens a paste box', (await settleCount(page, PASTE, 1, { timeoutMs: 15_000 })) === 1)) return

  // A JUNK PASTE FIRST, because the error path is the one a reader meets by accident and the
  // validator's own prose is what must reach them.
  await page.fill(PASTE, 'hey check out my character', { timeout: 15_000 })
  await page.click(SHOW, { timeout: 15_000 })
  const errored = (await settleCount(page, VIEW_ERROR, 1, { timeoutMs: 15_000 })) === 1
  check('a paste that is not a share string is refused, in words', errored, await textOf(page, VIEW_ERROR))
  check('…and nothing is drawn for it', (await countOf(page, CARD)) === 0)

  // …then the real one: the same string the dialog published, back through main's decoder.
  await page.fill(PASTE, text, { timeout: 15_000 })
  await page.click(SHOW, { timeout: 15_000 })
  const drawn = (await settleCount(page, CARD, 1, { timeoutMs: 20_000 })) === 1
  if (!check('the same string, pasted back, renders a card', drawn, await textOf(page, VIEW_ERROR))) return

  const filled = await countOf(page, FILLED)
  check(`…carrying the same ${String(WORN)} worn items`, filled === WORN, `${String(filled)} filled`)
  check(`…and the same ${String(CELLS)} armory places`, (await countOf(page, SLOT)) === CELLS)
  const card = await textOf(page, CARD)
  check('…and the same character', card.includes(NAME), card.split('\n')[0] ?? '')
  const stamp = await textOf(page, STAMP)
  check('…under a provenance line naming who shared it and when', /^Shared by /.test(stamp), stamp)
  // THE READER'S HALF OF THE OWNER'S REPORT. This viewer holds a decoded STRING and nothing else -
  // no sheet, no item database lookup - so a rank badge and an item window here are proof that the
  // body carried them across the wire.
  await checkGearDetail(page, 'the pasted profile')

  await page.click(VIEW_CLOSE, { timeout: 15_000 })
  check('the viewer closes', await settleGone(page, CARD, { timeoutMs: 15_000 }))
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
      if (await stepCard(page)) {
        const text = await stepActions(page)
        await stepViewer(page, text)
      }
    } else {
      note('the Character tab never mounted - every claim below it is unmeasured, not passing')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'character-share-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the character-share spec did not complete')
  process.exitCode = 1
})
