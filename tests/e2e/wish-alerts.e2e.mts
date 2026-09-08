/**
 * Headless Electron smoke test for the WISH-LIST DROP ALERTS (EQ Zera).
 *
 * THE CLAIM, IN TWO HALVES. A wish list is a list of things you want; this feature is the app
 * answering it out loud. (1) A live loot line naming an item on the list produces a celebration
 * card titled `<Item> dropped`, carrying the item's own card. (2) Walking into a zone the committed
 * mob catalog says a wished item drops in produces a card naming it, and clicking that card lands
 * on the Wish list tab. Every pure half is pinned in tests/wishAlerts.test.mts (the join, the
 * grammar, the destroy rule, the verified rename); what no unit test can claim is that THE PIECES
 * ARE WIRED — a line arriving in a tailed log crosses the engine's live fold, the renderer's two
 * detectors, main's validation and item lookup, and lands in the toast window's DOM.
 *
 * WHY `Earthen Blade`. It has to satisfy three unrelated corpora at once and this one does: the
 * GEAR INDEX carries it (so the app's own add control can offer it, which is how the wish is
 * written — through the UI, not through a hand-seeded store), the MOB CATALOG names eight mobs
 * that drop it, and every one of those mobs is homed in "The Hole". So one item exercises both
 * halves, and the zone the spec walks into is a zone the catalog actually knows.
 *
 * REPLAY NEVER POPS, and that is asserted FIRST. The fixture is replayed at boot and a startup
 * replay describes the PAST (AGENTS.md: hydration seeds a silent baseline). The zone half has the
 * same trap in a different shape — a zone is a VALUE, not an event, so the zone the replay leaves
 * the character standing in must seed silently rather than announce itself. Both absences are
 * proved before either presence is asked for, which is the only order in which either means
 * anything.
 *
 * AND THE SEEDED ALERTS ARE PART OF THE FEATURE, not decoration. `fireAppSignal` walks the USER'S
 * OWN alert list, so a signal with no def against it plays nothing: the card would appear in
 * silence. The last step opens Preferences → Alerts and reads the two seeded rows by name.
 *
 * NO WINDOW IS EVER SHOWN. `EQ_E2E=1` is the whole test mode: the toast overlay here is created,
 * loaded and driven off-screen. It has no pointer, so `el.click()` is how a click is made.
 *
 * AND THE CARD IS ON A CLOCK. A detector-sent card holds for the config's 6 s and the hidden
 * window cannot be hovered to pin it, so the read and the deep-link CLICK happen in ONE evaluate
 * the moment the card is seen.
 *
 * Run: `node --import tsx tests/e2e/wish-alerts.e2e.mts`.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleStable
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'

/** The wished item under test - see the header for why this one. */
const ITEM = 'Earthen Blade'
/** Its corpus key (`itemKey`), which is what the wish list rows carry as `data-item`. */
const ITEM_KEY = 'earthen blade'
/** The zone the catalog homes every one of its sources in, spelled as the catalog spells it. */
const ZONE = 'The Hole'

/** The loot line, in the client's own dashed self-loot spelling (engine parse/world.rs). */
const LOOT_LINE = `--You have looted a ${ITEM} from a shadowed man corpse.--`
/** The zone line, in the one shape the engine reads (`^You have entered (.+?)\\.$`). */
const ZONE_LINE = `You have entered ${ZONE}.`

const DROP_CARD = '[data-toast-kind="wishDrop"]'
const ZONE_CARD = '[data-toast-kind="wishZone"]'

/** The gear AREA's nav row - the tab bar only exists once you are inside it (JOS-324). */
const NAV_GEAR = '[data-testid="nav-gear"]'
const WISH_TAB = '[data-testid="tab-wishlist"]'
const WISH_VIEW = '[data-testid="wishlist-view"]'
const ADD_OPEN = '[data-testid="wishlist-add-open"]'
const ADD_SEARCH = '[data-testid="wishlist-add-search"] input'
const ADD_HIT = '[data-testid="wishlist-hit"]'

/** The toast overlay's page, identified by the `?kind=` query its window was opened with. */
async function findToastWindow(app: ElectronApplication): Promise<Page | null> {
  for (const w of app.windows()) {
    const search = await w.evaluate(() => window.location.search).catch(() => '')
    if (search.includes('kind=toast')) return w
  }
  return null
}

/** Poll until the toast window exists (window creation + page load is asynchronous). */
function waitForToastWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page | null> {
  return settle(() => findToastWindow(app), (w) => w !== null, { timeoutMs })
}

/** Every rendered card's text, in stack order. */
function cardTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast-card"]')].map((el) =>
      (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )
  )
}

/**
 * The introduction card (JOS-83) is what a fresh install sees first, and every launch here is a
 * fresh install. It is not this spec's claim - toast.e2e.mts owns it - so it is closed and the lane
 * is put back to empty, which is the state the absence assertions below need.
 */
async function stepClearIntro(toast: Page): Promise<void> {
  const cards = await settle(() => cardTexts(toast), (c) => c.length >= 1, { timeoutMs: 20_000 })
  if (cards.length === 0) {
    note('no introduction card to clear - the lane was already empty')
    return
  }
  await toast.evaluate(() => {
    ;(document.querySelector('[data-testid="toast-close"]') as HTMLElement | null)?.click()
  })
  const rest = await settleStable(() => cardTexts(toast), { timeoutMs: 10_000, stable: 4, pollMs: 150 })
  check('the introduction card clears, leaving the celebration lane empty', rest.length === 0, rest.join(' | '))
}

/**
 * NEITHER HALF POPS ON REPLAY. The staged fixture is folded at boot; whatever it contains is
 * history. It ends with `You have entered The Southern Desert of Ro.`, so the zone watch is being
 * asked the harder question here: it holds a VALUE, and the value it is handed at hydration is
 * where the character already is rather than a place they just walked into.
 */
async function stepNoReplayPopup(toast: Page): Promise<void> {
  const drops = await settleStable(() => countOf(toast, DROP_CARD), { timeoutMs: 8_000, stable: 5, pollMs: 150 })
  const zones = await countOf(toast, ZONE_CARD)
  check(
    'the startup replay celebrates NOTHING - neither a past loot nor the zone it left you standing in',
    drops === 0 && zones === 0,
    `${String(drops)} drop card(s), ${String(zones)} zone card(s)`
  )
}

/**
 * THE WISH IS WRITTEN THROUGH THE APP'S OWN CONTROL, not into a pre-seeded store: the add control
 * is the only thing that proves the item this spec picked is really offerable, and a store written
 * behind the app's back would let a corpus change break the feature with the spec still green.
 *
 * The DOCUMENT is what is then asserted, over the bridge, rather than a row on screen: the wish
 * list groups by zone and filters by era, so "is it on the list" and "is its heading drawn today"
 * are two questions and only the first one arms the detectors.
 */
async function stepAddWish(page: Page): Promise<boolean> {
  // Two clicks, because the Wish list is the fifth face of the gear AREA: the nav row opens the
  // area, the tab bar it mounts opens the face (character-sheet.e2e.mts takes the same trip).
  await page.click(NAV_GEAR, { timeout: 60_000 })
  await page.waitForSelector(WISH_TAB, { timeout: 30_000 })
  await page.click(WISH_TAB, { timeout: 30_000 })
  if (!check('the Wish list tab mounts', (await settle(() => countOf(page, WISH_VIEW), (n) => n > 0, { timeoutMs: 30_000 })) > 0)) {
    return false
  }
  await page.click(ADD_OPEN, { timeout: 20_000 })
  await page.fill(ADD_SEARCH, ITEM, { timeout: 20_000 })
  const hits = await settle(() => countOf(page, ADD_HIT), (n) => n > 0, { timeoutMs: 20_000 })
  if (!check(`the add control offers "${ITEM}" from the corpus`, hits > 0, `${String(hits)} hits`)) return false
  // NO NAMED INNER FUNCTION HERE: tsx compiles this file with esbuild's keepNames, which wraps a
  // named function in a `__name(...)` helper that exists only in the Node bundle. Anonymous arrows
  // handed straight to `find` get no name and so no wrapper.
  const picked = await page.evaluate(
    (arg) => {
      const rows = [...document.querySelectorAll(arg.sel)]
      const row = rows.find((r) => (r as HTMLElement).innerText.split('\n')[0].trim() === arg.name)
      if (!row) return false
      ;(row as HTMLElement).click()
      return true
    },
    { sel: ADD_HIT, name: ITEM }
  )
  if (!check(`…and one of them is exactly "${ITEM}"`, picked)) return false
  const keys = await settle(
    () =>
      page.evaluate(async () => {
        const list = await (window as unknown as { eq: { getWishlist: () => Promise<{ entries: { itemKey: string }[] }> } }).eq.getWishlist()
        return list.entries.map((e) => e.itemKey)
      }),
    (k) => k.includes(ITEM_KEY),
    { timeoutMs: 20_000 }
  )
  return check('clicking the offer writes the wish to the character`s list', keys.includes(ITEM_KEY), keys.join(', ') || '(empty)')
}

/**
 * THE LIVE DROP. One line, written into the very log the app is tailing, travelling chokidar →
 * tailer → the engine's live fold → the loot delta → the detector → main's item lookup → the
 * overlay. Thirty seconds is the budget because that whole chain has to happen.
 */
async function stepLiveDrop(toast: Page, log: FixtureLog): Promise<void> {
  log.append(LOOT_LINE)
  const found = await settle(() => countOf(toast, DROP_CARD), (n) => n >= 1, { timeoutMs: 30_000 })
  if (!check(`a LIVE loot of a WISHED ${ITEM} pops a card`, found >= 1, `${String(found)} card(s)`)) return
  const snap = await toast.evaluate((sel) => {
    const card = document.querySelector(sel)
    if (!card) return null
    const title = card.querySelector('[data-testid="toast-title"]') as HTMLElement | null
    const sub = card.querySelector('[data-testid="toast-subtitle"]') as HTMLElement | null
    const text = (card as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    return {
      title: title ? title.innerText.replace(/\s+/g, ' ').trim() : '',
      subtitle: sub ? sub.innerText.replace(/\s+/g, ' ').trim() : '',
      // How many times the item names ITSELF on this card: once in the title, and again in the
      // resolved item block below it. Two is the proof main looked the item up.
      names: text.split('Earthen Blade').length - 1,
      text
    }
  }, DROP_CARD)
  if (!check('…and the card was still readable when the spec reached it', snap !== null)) return
  const s = snap as { title: string; subtitle: string; names: number; text: string }
  check('…titled with the item and what happened to it', s.title === `${ITEM} dropped`, `reads "${s.title}"`)
  check(
    '…saying where it came from, from the loot line itself rather than from the reader`s head',
    s.subtitle.includes('shadowed man'),
    s.subtitle || '(no subtitle)'
  )
  check(
    '…and carrying the ITEM`s own card, resolved in main like a Sky reward',
    s.names >= 2,
    `named ${String(s.names)} time(s) on: ${s.text.slice(0, 160)}`
  )
}

/**
 * PREFERENCES AGREES WITH THE WINDOW. The two seeded defs are what make either signal AUDIBLE, so
 * they are read where a user would read them: the Alerts list, by name. Doing it here also parks
 * the app on a tab that is NOT the wish list, which is what makes the deep link below a claim.
 */
async function stepSeededAlerts(page: Page): Promise<void> {
  await page.click('[data-testid="nav-alerts"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="alert-row"]', { timeout: 30_000 })
  const names = await settle(
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="alert-row"]')].map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
      ),
    (rows) => rows.some((r) => r.includes('Wished item dropped')),
    { timeoutMs: 20_000 }
  )
  check(
    'Preferences → Alerts ships a "Wished item dropped" alert, so the card is not silent',
    names.some((n) => n.includes('Wished item dropped')),
    names.length ? `${String(names.length)} rows` : 'no rows'
  )
  check(
    '…and a "Wished items drop here" alert beside it',
    names.some((n) => n.includes('Wished items drop here'))
  )
}

/**
 * THE ZONE CHANGE, AND THE LINK OUT OF IT. Walking into "The Hole" is news because the catalog
 * says the wished item drops there; the card names it, and the card ITSELF is the click target
 * (there is no item block to hang one on), which is what takes the reader to the list.
 */
async function stepZoneCard(toast: Page, page: Page, log: FixtureLog): Promise<void> {
  log.append(ZONE_LINE)
  const found = await settle(() => countOf(toast, ZONE_CARD), (n) => n >= 1, { timeoutMs: 30_000 })
  if (!check(`walking into ${ZONE} pops a wish-zone card`, found >= 1, `${String(found)} card(s)`)) return
  const text = await toast.evaluate((sel) => {
    const card = document.querySelector(sel)
    if (!card) return null
    const seen = (card as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    ;(card as HTMLElement).click()
    return seen
  }, ZONE_CARD)
  if (!check('…and it was still readable when the spec reached it', text !== null)) return
  const seen = text as string
  check('…counting what drops here, in a sentence rather than a template', seen.includes('drops here'), seen.slice(0, 160))
  check('…and NAMING the wished item, which is the whole reason to look up', seen.includes(ITEM), seen.slice(0, 160))
  const landed = await settle(() => countOf(page, WISH_VIEW), (n) => n > 0, { timeoutMs: 20_000 })
  check('clicking the zone card lands the app on the Wish list tab', landed > 0, `${String(landed)} wish views`)
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against a staged copy of tests/fixtures/e2e-toast.log…')
  // Staged HERE rather than by name, because this spec's whole subject is a line written while the
  // app is up: holding the `FixtureLog` is what makes `log.append` possible (gear.e2e.mts).
  const log = stageFixture('e2e-toast.log')
  const { app, close } = await launchOnFixture(log)

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })

    const toast = await waitForToastWindow(app)
    if (check('the celebration overlay is up (it is on for a fresh install)', toast !== null)) {
      const t = toast as Page
      await stepClearIntro(t)
      await stepNoReplayPopup(t)
      if (await stepAddWish(page)) {
        await stepLiveDrop(t, log)
        await stepSeededAlerts(page)
        await stepZoneCard(t, page, log)
      }
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'wish-alerts-FAIL')
  } finally {
    await close()
    await log.dispose()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the wish-alerts spec did not complete')
  process.exitCode = 1
})
