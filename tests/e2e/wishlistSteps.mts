// THE WISH LIST'S STEPS (JOS-326), a module rather than a spec of its own — the plannerSteps.mts /
// gearSetSteps.mts precedent.
//
// WHY IT SHARES THE EXALTATIONS LAUNCH RATHER THAN TAKING ITS OWN. The two tabs are one feature
// seen from two sides: the browse decides what you want, the wish list is where it goes. The
// central claim — "adding from the browse puts a row on the other tab" — spans them, and a spec
// that launched twice could only ever assert the halves. They are also sibling tabs of one nav
// area, so the trip between them is two clicks rather than a relaunch.
//
// AND THE SEED NEEDS A STORE THAT ALREADY HAS PLANS IN IT, which is the other reason this rides
// the planner spec's launch: that spec owns a userData dir it wrote an exaltation set into before
// the app started (see planner.e2e.mts `seedStore`). Nothing in the product can create a plan any
// more — the board that did is gone — so a pre-written store is the ONLY way the one-time import
// is reachable in an app at all.

import type { Page } from 'playwright-core'
import { check, countOf, note, settle } from './appHarness.mjs'
import { textOf, until } from './plannerSteps.mjs'

export const WISH_TAB = '[data-testid="tab-wishlist"]'
export const WISH_VIEW = '[data-testid="wishlist-view"]'
export const WISH_LIST = '[data-testid="wishlist-list"]'
export const WISH_ROW = '[data-testid="wishlist-row"]'
export const WISH_GROUP = '[data-testid="wishlist-group"]'
export const WISH_GROUP_OUT_OF_ERA = '[data-testid="wishlist-group"][data-out-of-era="true"]'
export const WISH_REMOVE = '[data-testid="wishlist-remove"]'
export const WISH_SEARCH = '[data-testid="wishlist-search"] input'
export const WISH_ERA_TOGGLE = '[data-testid="wishlist-era-toggle"]'
export const WISH_ERA_HIDDEN = '[data-testid="wishlist-era-hidden"]'
export const WISH_EMPTY = '[data-testid="wishlist-empty"]'
export const WISH_COUNT = '[data-testid="wishlist-count"]'
export const IMPORT_CHIP = '[data-testid="wishlist-import-chip"]'
export const DONE_STRIP = '[data-testid="wishlist-done"]'
export const DONE_CLEAR = '[data-testid="wishlist-done-clear"]'
export const DONE_ROW = '[data-testid="wishlist-done-row"]'

export const ADD_OPEN = '[data-testid="wishlist-add-open"]'
export const ADD_SEARCH = '[data-testid="wishlist-add-search"] input'
export const ADD_HITS = '[data-testid="wishlist-add-hits"]'
export const ADD_HIT = '[data-testid="wishlist-hit"]'
export const ADD_HIT_GEAR = '[data-testid="wishlist-hit"][data-kind="gear"]'
export const ADD_HIT_DONOR = '[data-testid="wishlist-hit"][data-kind="donor"]'
export const ADD_EMPTY = '[data-testid="wishlist-add-empty"]'

/** Every wish name currently on the pane, in DOM order. */
function rowNames(page: Page): Promise<string[]> {
  return page.evaluate(
    (s) => Array.from(document.querySelectorAll(s)).map((e) => (e as HTMLElement).innerText.split('\n')[0].trim()),
    WISH_ROW
  )
}

/**
 * 1. THE TAB MOUNTS, AND THE ONE-TIME SEED HAS ALREADY RUN.
 *
 * The store this app launched on carries an exaltation set with one unmet socket in it (the spec's
 * `seedStore`), and the wish list's whole reason for reading that store is to carry those
 * decisions across the board's removal. So the first thing asserted here is the import: a row on
 * screen, wearing the chip that says where it came from.
 *
 * The chip's PRESENCE is the assertion, never its count. What the seed imports depends on the
 * progress join, which reads three sources that settle asynchronously — a socket the log has
 * already seen merged to its extraction tier is finished work and is correctly NOT imported. One
 * labelled row is the contract; how many is the corpus's and the character's business.
 */
export async function stepSeedImport(page: Page): Promise<boolean> {
  const mounted = await until(async () => (await countOf(page, WISH_VIEW)) > 0, 30_000)
  if (!check('clicking the Wish list tab mounts the pane', mounted)) return false

  const imported = await until(async () => (await countOf(page, IMPORT_CHIP)) > 0, 20_000)
  check(
    'the one-time seed carried the stored exaltation plan across, labelled as an import',
    imported,
    `${String(await countOf(page, IMPORT_CHIP))} imported rows of ${String(await countOf(page, WISH_ROW))}`
  )
  if (imported) {
    const label = (await textOf(page, IMPORT_CHIP)).replace(/\s+/g, ' ').trim()
    check(
      '…and the label says where it came from, in words rather than in a colour',
      label.toLowerCase().includes('exaltation plan'),
      `reads "${label}"`
    )
  }
  return true
}

/**
 * 2. THE LIST IS A ROUTE — zone headings, and the JOS-42 trust invariant asked about wishes.
 *
 * The grouping arithmetic is pinned pure (tests/plannerFarm.test.mts, tests/wishFarm.test.mts);
 * what only a launched app can show is that the pane DRAWS it against the real corpus. Two claims:
 * there are headings at all, and — with the era filter on, which is its default — not one of them
 * names a zone this server cannot reach. That second one is the bug the owner reported about the
 * Farm rollup, re-asserted about the surface that inherited the rollup.
 */
export async function stepZoneGrouping(page: Page): Promise<void> {
  const grouped = await until(async () => (await countOf(page, WISH_GROUP)) > 0, 20_000)
  if (!check('the wish list groups its rows under headings — where to go, not just what to want', grouped)) {
    note(`the list drew no group: ${(await textOf(page, WISH_LIST)).replace(/\s+/g, ' ').trim().slice(0, 120)}`)
    return
  }
  const unreachable = await countOf(page, WISH_GROUP_OUT_OF_ERA)
  check(
    'no wish-list heading sends you to a zone this era cannot reach (JOS-42, inherited)',
    unreachable === 0,
    `${String(unreachable)} out-of-era headings`
  )
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s)
    return el === null ? null : { h: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, clientH: el.clientHeight }
  }, WISH_LIST)
  check(
    'the wish list is its own scroller (a growing list never grows the page)',
    box !== null && box.h > 0 && box.scrollH >= box.clientH,
    box ? `${String(box.h)}px tall · scrollHeight ${String(box.scrollH)} vs clientHeight ${String(box.clientH)}` : 'absent'
  )
}

/**
 * 2b. THE ERA TOGGLE HIDES ROWS FROM THE ROUTE, AND THE COUNT BESIDE IT IS HONEST.
 *
 * This is the one filter on the tab that can hide a wish somebody just wrote down, so the number
 * it states has to be exactly the number it is holding — a filter that hid four and admitted to
 * three would be worse than one that hid them silently. Asserted as an IDENTITY rather than a
 * count: rows-with-the-filter-on plus what it says it is hiding must equal rows-with-it-off.
 *
 * IT LEAVES THE FILTER OFF, deliberately. The committed corpus is majority Kunark/Velious, so
 * whether any given wish survives the filter is the corpus's business — and every row-level step
 * after this one (add, search, remove, deep-link) needs to be able to find the row it just made.
 * The trust invariant that needs the filter ON is asserted by `stepZoneGrouping`, above.
 */
export async function stepEraOff(page: Page): Promise<void> {
  if (!check('the wish list offers the shared current-era filter', (await countOf(page, WISH_ERA_TOGGLE)) > 0)) return
  const before = await countOf(page, WISH_ROW)
  const line = (await countOf(page, WISH_ERA_HIDDEN)) > 0 ? await textOf(page, WISH_ERA_HIDDEN) : ''
  const claimed = Number(/^(\d+)/.exec(line.trim())?.[1] ?? '0')

  await page.click(WISH_ERA_TOGGLE, { timeout: 15_000 })
  const after = await settle(
    () => countOf(page, WISH_ROW),
    (n) => n === before + claimed,
    { timeoutMs: 10_000 }
  )
  check(
    'turning the era filter off reveals exactly what it said it was hiding',
    after === before + claimed,
    `${String(before)} rows + ${String(claimed)} claimed hidden = ${String(after)} rows`
  )
}

/**
 * 3. ONE ADD CONTROL REACHES THE WHOLE CORPUS — gear rows AND donors, in one result list.
 *
 * The union is pinned pure over fixtures (tests/wishSearch.test.mts); what needs the real app and
 * the real 8.6 MB corpus is that BOTH indices are actually wired to the control. "sword" is a
 * query the committed corpus certainly answers from both sides — there are swords to wear and
 * swords that carry procs.
 *
 * Then the add itself: click the first hit, and a row with that name appears on the list. Returns
 * the name it added so the removal step can take the same row back off again.
 */
export async function stepAddFromCorpus(page: Page): Promise<string | null> {
  if (!check('the wish list offers one add control', (await countOf(page, ADD_OPEN)) > 0)) return null
  await page.click(ADD_OPEN, { timeout: 15_000 })
  if (!check('…which opens a search over every item and effect', await until(async () => (await countOf(page, ADD_SEARCH)) > 0, 10_000))) {
    return null
  }
  // Before anything is typed the list says what to do rather than reporting an empty search.
  check(
    'an untouched search says what to type, not "no results"',
    (await textOf(page, ADD_EMPTY)).toLowerCase().includes('two letters'),
    (await textOf(page, ADD_EMPTY)).slice(0, 80)
  )

  await page.fill(ADD_SEARCH, 'sword', { timeout: 15_000 })
  const answered = await until(async () => (await countOf(page, ADD_HIT)) > 0, 15_000)
  if (!check('typing a name searches the whole corpus', answered)) return null
  const kinds = await settle(
    async () => ({ gear: await countOf(page, ADD_HIT_GEAR), donor: await countOf(page, ADD_HIT_DONOR) }),
    (r) => r.gear > 0 && r.donor > 0,
    { timeoutMs: 10_000 }
  )
  check(
    'the one result list carries BOTH indices — items to wear and items wanted for an effect',
    kinds.gear > 0 && kinds.donor > 0,
    `${String(kinds.gear)} gear rows · ${String(kinds.donor)} donor rows`
  )

  const name = (await textOf(page, ADD_HIT)).split('\n')[0].trim()
  const before = (await textOf(page, WISH_COUNT)).trim()
  await page.click(ADD_HIT, { timeout: 15_000 })
  // TWO READINGS, because they answer different questions. The tab's COUNT is the whole document
  // and proves the write landed whatever the era filter is doing; the ROW proves it is on screen.
  const counted = await until(async () => (await textOf(page, WISH_COUNT)).trim() !== before, 15_000)
  check(`adding "${name}" from the corpus search writes it to the list`, counted, `count was "${before}"`)
  const landed = await until(async () => (await rowNames(page)).includes(name), 15_000)
  check(`…and the row is on screen under its zone`, landed, (await rowNames(page)).slice(0, 4).join(', '))
  return landed ? name : null
}

/**
 * 4. THE SAME ITEM CANNOT BE WISHED FOR TWICE, and the search says so rather than accepting it.
 *
 * The model dedupes by `itemKey` (tests/wishlist.test.mts pins the fold); what an app adds is that
 * the control does not silently swallow a click. Re-opening the search on the same query must show
 * the row already taken.
 */
export async function stepNoDoubleWish(page: Page, name: string): Promise<void> {
  const before = (await rowNames(page)).length
  await page.click(ADD_OPEN, { timeout: 15_000 })
  await page.fill(ADD_SEARCH, name.slice(0, 12), { timeout: 15_000 })
  await until(async () => (await countOf(page, ADD_HIT)) > 0, 15_000)
  const taken = await page.evaluate(
    (s) => Array.from(document.querySelectorAll(s)).some((e) => (e as HTMLElement).innerText.includes('wished')),
    ADD_HIT
  )
  check('an item already on the list is shown as taken rather than offered again', taken)
  await page.keyboard.press('Escape')
  await until(async () => (await countOf(page, ADD_SEARCH)) === 0, 8_000)
  check('…and the list did not grow behind the closed popover', (await rowNames(page)).length === before)
}

/**
 * 5. THE SEARCH OVER THE WISHES IS A DIFFERENT SEARCH FROM THE ONE THAT ADDS THEM.
 *
 * A list you write yourself gets long, and it is grouped by ZONE — so "where is that thing on
 * here" is a question the headings cannot answer. Asserted as an identity: filtering to a name
 * that IS on the list leaves it, filtering to one that cannot be leaves nothing and says so.
 */
export async function stepSearchWishes(page: Page, name: string): Promise<void> {
  await page.fill(WISH_SEARCH, name.slice(0, 8), { timeout: 15_000 })
  const found = await until(async () => (await rowNames(page)).includes(name), 10_000)
  check(`searching the wishes for "${name.slice(0, 8)}" keeps the row that matches`, found)

  await page.fill(WISH_SEARCH, 'zzzzz no such item zzzzz', { timeout: 15_000 })
  const emptied = await until(async () => (await countOf(page, WISH_ROW)) === 0, 10_000)
  check('…and a query nothing matches empties the list and says so', emptied && (await countOf(page, WISH_EMPTY)) > 0)
  await page.fill(WISH_SEARCH, '', { timeout: 15_000 })
  await until(async () => (await countOf(page, WISH_ROW)) > 0, 10_000)
}

/**
 * 6. A ROW COMES BACK OFF — the only destructive control on the tab, and it means it.
 *
 * Removed by NAME rather than by index: the list is grouped by zone and re-groups on every change,
 * so "the first row" is not a stable handle for the thing that was just added.
 */
export async function stepRemove(page: Page, name: string): Promise<void> {
  const before = await rowNames(page)
  const removed = await page.evaluate(
    (args) => {
      for (const row of document.querySelectorAll(args.row)) {
        if ((row as HTMLElement).innerText.split('\n')[0].trim() !== args.name) continue
        const button = row.querySelector<HTMLElement>(args.remove)
        if (button === null) return false
        button.click()
        return true
      }
      return false
    },
    { row: WISH_ROW, remove: WISH_REMOVE, name }
  )
  if (!check(`the row for "${name}" carries a remove control`, removed)) return
  const gone = await until(async () => !(await rowNames(page)).includes(name), 15_000)
  check(
    'removing a wish takes it off the list',
    gone,
    `${String(before.length)} rows → ${String((await rowNames(page)).length)}`
  )
}

/**
 * 7. EVERY WISH NAME OPENS THE LOOT DRILL-DOWN — the same contract the browse's donor names use.
 *
 * The claim is the ROUTE, not the drill: `openLoot` is the app's standing link idiom, and a wish
 * list whose names were inert would be the one surface in the app where an item name is not a
 * link. The drill's own content is asserted by the Exaltations half of this spec.
 */
export async function stepWishDeepLink(page: Page, detail: string, title: string): Promise<void> {
  const names = await rowNames(page)
  if (names.length === 0) {
    note('no wish on the list to click through — the wish deep-link step is skipped this run')
    return
  }
  await page.click(`${WISH_ROW} [data-testid="planner-donor-name"]`, { timeout: 15_000 })
  const landed = await until(async () => (await countOf(page, detail)) > 0, 20_000)
  if (!check('clicking a wish name opens the Loot tab’s item drill-down', landed, `wish "${names[0]}"`)) return
  const drilled = (await textOf(page, title)).replace(/\s+/g, ' ').trim()
  check('…on the item that was clicked, not on the ledger', drilled === names[0], `"${drilled}" vs "${names[0]}"`)
}

/**
 * 8. THE DONE STRIP — the progress join, END TO END, and a Clear that DISMISSES rather than deletes.
 *
 * `expected` is a wish this launch's store carries for an item the staged `/outputfile inventory`
 * dump says the character is WEARING (planner.e2e.mts `OWNED_WISH`). That makes the strip a
 * deterministic assertion rather than a machine-dependent one, and it exercises the whole chain
 * only a launched app has: the dump on disk → main's parse → the store's inventory counts → the
 * renderer's progress join → `wishFulfilled`'s gear rule → this row, out of the route.
 *
 * A fulfilled wish must be in the strip AND NOT in the route, which is one claim asserted twice:
 * a row in both places would be the same trip listed as still to make.
 */
export async function stepDoneStrip(page: Page, expected: string): Promise<void> {
  const up = await until(async () => (await countOf(page, DONE_STRIP)) > 0, 20_000)
  if (!check('a wish the character already owns is filed as done, not as a trip to make', up)) {
    note(`no done strip: the progress join placed nothing, with rows ${(await rowNames(page)).join(', ')}`)
    return
  }
  const done = await page.evaluate(
    (s) => Array.from(document.querySelectorAll(s)).map((e) => (e as HTMLElement).innerText.split('\n')[0].trim()),
    DONE_ROW
  )
  check(`…and it is the one the dump says is worn — "${expected}"`, done.includes(expected), done.join(', '))
  check('…which is therefore NOT in the route', !(await rowNames(page)).includes(expected))
  const rows = done.length
  check('the done strip lists what it says it has', rows > 0, `${String(rows)} fulfilled rows`)
  // The tab's own count is the WHOLE list — dismissals and fulfilled rows included — so it is the
  // one reading that can tell a dismissal from a deletion.
  const before = (await textOf(page, WISH_COUNT)).trim()
  await page.click(DONE_CLEAR, { timeout: 15_000 })
  const cleared = await until(async () => (await countOf(page, DONE_STRIP)) === 0, 10_000)
  check('Clear dismisses the strip', cleared)
  const after = (await textOf(page, WISH_COUNT)).trim()
  check(
    '…and it is a DISMISSAL, not a deletion — the list is the same length it was',
    after === before,
    `"${before}" → "${after}"`
  )
}
