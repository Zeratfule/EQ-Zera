/**
 * THE CRAFTING TAB, against a staged inventory dump.
 *
 * WHY A STAGED DUMP. The whole feature is a JOIN between the committed recipe corpus and what the
 * character is carrying, so a launch against whatever the machine happens to have would leave every
 * interesting claim unmeasurable. `launchOnFixture(…, { inventory })` stages the committed 295-line
 * dump into a throwaway EQ install, and that dump has a property this spec is built on: it names
 * EXACTLY ONE KIND of thing that is an ingredient of anything: `Griffenne Blood`, two copies of it
 * stacked in the personal depot, which `Royal Temper` wants. Every number below is therefore the
 * same on every machine, and every one of them is predicted by a unit test first
 * (tests/craftIndex.test.mts).
 *
 * WHAT IT MEASURES, IN ORDER: the tab is on the gear area's bar and mounts; the footer states where
 * the data came from and when; both verdict sections say they are empty rather than leaving a gap;
 * a search finds a recipe by PRODUCT and opens it into its real ingredient list with the
 * returned-on-success tag drawn; a search finds a recipe by INGREDIENT and the one the dump holds
 * reads its stacked Count while the two it does not read 0; and the tradeskill select narrows the
 * All section.
 *
 * ONE CLAIM IS THE INVERSE OF WHAT THE FEATURE BRIEF EXPECTED, and it is asserted deliberately.
 * Royal Temper takes THREE ingredients (2 Essence of Sunlight, 1 Griffenne Blood, 1 Rain Water), so
 * holding the blood leaves it TWO kinds short: it belongs in All and in NEITHER verdict section.
 * The unit test pins that reading; this spec pins that the screen agrees with it, because "one away"
 * quietly meaning "two away" would be the feature lying in its loudest voice.
 *
 * SO BOTH VERDICT SECTIONS ARE EMPTY ON THIS DUMP, AND THAT IS THE POINT OF STAGING IT. The owner's
 * refinement to "one ingredient away" — exactly one consumed kind missing AND at least one already
 * held, so a single-ingredient recipe can never qualify — means a character who has started nothing
 * is one away from nothing. The reference character has started nothing. Measured on the committed
 * corpus: 0 makeable · 0 one away · 2,451 in all. A tab that answers that with two blank gaps is a
 * tab that looks broken, so the EMPTY STATES are asserted here as content, not as an absence.
 *
 * IT NEEDS THE THREE WIRING LINES (`registerCraftIpc()` in `src/main/ipc/index.ts`, `...craftApi` in
 * `src/preload/index.ts`, `<CraftingBranch …/>` in `src/renderer/src/App.tsx`) — all three are in.
 *
 * Run: `npm run test:e2e -- crafting` (or node --import tsx this file).
 */
import type { Page } from 'playwright-core'
import { buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

/** The gear area's one nav row, and the tab bar it opens. */
const NAV_GEAR = '[data-testid="nav-gear"]'
/** The area's FIRST tab, whose presence proves the bar mounted. */
const TAB_GEAR = '[data-testid="tab-gear"]'
const TAB = '[data-testid="tab-crafting"]'

const VIEW = '[data-testid="crafting-view"]'
const SEARCH = '[data-testid="crafting-search"]'
const SKILL = '[data-testid="crafting-skill"]'
const FOOTER = '[data-testid="crafting-footer"]'
const ROW = '[data-testid="crafting-row"]'
const INGREDIENT = '[data-testid="crafting-ingredient"]'
const NOT_CONSUMED = '[data-testid="crafting-not-consumed"]'
const ALL_COUNT = '[data-testid="crafting-all-count"]'
const ONE_AWAY = '[data-testid="crafting-one-away"]'
const MAKEABLE_COUNT = '[data-testid="crafting-makeable-count"]'
const ONE_AWAY_COUNT = '[data-testid="crafting-one-away-count"]'
const MAKEABLE_EMPTY = '[data-testid="crafting-makeable-empty"]'
const ONE_AWAY_EMPTY = '[data-testid="crafting-one-away-empty"]'

/** The staged dump, and the one ingredient in it. */
const DUMP = 'Primitive_freeport-Inventory.txt'
/** Its four ingredients, one of which comes back from the combine. */
const KABOB_INGREDIENTS = 4
/**
 * HOW MANY GRIFFENNE BLOOD THE STAGED DUMP HOLDS.
 *
 * TWO, not one. The dump's line 256 is `Personal-Depot1  Griffenne Blood  22526  2  10` and the
 * fourth column is Count, which `ownedCount` sums exactly as written. The first cut of this spec
 * said 1 because the CORPUS side of the join names the ingredient once; the number on screen comes
 * from the DUMP side, and the dump says two. Worth pinning rather than relaxing: a `data-have` that
 * silently read 1 for a stacked row would be the ownership join dropping the Count column, which is
 * a real defect that only a stack can catch.
 */
const BLOOD_HELD = 2

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** The number a section header states, or -1 when the header is not on screen. */
async function sectionCount(page: Page, sel: string): Promise<number> {
  const text = await textOf(page, sel)
  const m = /(\d+)\s*$/.exec(text.replace(/\s+/g, ' ').trim())
  return m ? Number.parseInt(m[1], 10) : -1
}

/** Answer the analytics first-run notice — a fresh `userData` always shows it, and this spec types. */
async function answerNotice(page: Page): Promise<void> {
  const notice = '[data-testid="telemetry-notice"]'
  if ((await countOf(page, notice)) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
}

/** The `data-recipe` of the first row on screen, or `''` when the list draws none. */
function firstRecipe(page: Page): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.getAttribute('data-recipe') ?? '',
    ROW
  )
}

/**
 * Type into the search box and wait for THE LIST ITSELF to change — never for a count.
 *
 * THE FIRST CUT SETTLED ON THE ALL-SECTION COUNT AND THAT WAS A REAL TRAP, paid for once: the tab
 * filters on a `useDeferredValue` copy of the box, so there is a window in which the typed text has
 * landed and the rendered list has not. Both of this spec's searches happen to narrow to exactly one
 * recipe, so going from "gnome kabobs" to "griffenne blood" is a transition from 1 to 1 — the
 * predicate `n === 1` was already true, `settle` returned on its very first read, and the assertion
 * that followed read the PREVIOUS search's row. A count is a poor identity for a list; the row's own
 * `data-recipe` is the thing under test, so that is what the wait is on.
 */
function searchFor(page: Page, term: string, want: string): Promise<string> {
  return page
    .fill(SEARCH, term, { timeout: 15_000 })
    .then(() => settle(() => firstRecipe(page), (r) => r === want, { timeoutMs: 15_000, pollMs: 100 }))
}

async function openTab(page: Page): Promise<boolean> {
  const hasRow = await page.waitForSelector(NAV_GEAR, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the gear area has its one nav row', hasRow)) return false
  await page.click(NAV_GEAR, { timeout: 15_000 })
  const barUp = await page.waitForSelector(TAB_GEAR, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('…and it opens an area whose tab bar is on screen', barUp)) return false
  if (!check('the Crafting tab is on that bar', (await countOf(page, TAB)) === 1)) return false
  const label = (await textOf(page, TAB)).replace(/\s+/g, ' ').trim()
  // CASE-INSENSITIVE: the theme upper-cases tab labels, and the claim is the tab's NAME.
  check('…and it is called Crafting', /crafting/i.test(label), `reads "${label}"`)
  await page.click(TAB, { timeout: 15_000 })
  const mounted = await page.waitForSelector(VIEW, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  return check('…and clicking it mounts the Crafting view', mounted)
}

async function stepFooter(page: Page): Promise<void> {
  const footer = await settle(() => textOf(page, FOOTER), (t) => t.includes('recipes'), {
    timeoutMs: 30_000,
    pollMs: 150
  })
  check('the footer says how much it knows and WHEN the wiki data is from', footer.includes('wiki data as of'), footer)
  check('…and it counts both recipes and the ingredients they name', /recipes/.test(footer) && /ingredients known/.test(footer), footer)
  const all = await sectionCount(page, ALL_COUNT)
  check('the All section opens on the whole corpus', all > 2_000, `${String(all)} recipes`)
}

/**
 * THE TWO EMPTY STATES, ASSERTED AS CONTENT.
 *
 * The staged character holds one ingredient, of a three-ingredient brew, so they can make nothing
 * and — under the refined rule, which needs one kind already held — they are one away from nothing
 * either. Both sections must SAY that. Two silent gaps where a list should be is the single most
 * common way a data-joined tab reads as broken on a fresh install.
 */
async function stepEmptyStates(page: Page): Promise<void> {
  const makeable = await sectionCount(page, MAKEABLE_COUNT)
  const oneAway = await sectionCount(page, ONE_AWAY_COUNT)
  check('this character can complete no recipe', makeable === 0, `${String(makeable)} makeable`)
  check(
    'and is one ingredient away from none either — one KIND of thing, of a three-ingredient brew',
    oneAway === 0,
    `${String(oneAway)} one away`
  )
  check(
    '…and the makeable section SAYS so rather than leaving a gap',
    (await textOf(page, MAKEABLE_EMPTY)).includes('Nothing you hold completes a recipe'),
    await textOf(page, MAKEABLE_EMPTY)
  )
  check(
    '…and so does the one-away section',
    (await textOf(page, ONE_AWAY_EMPTY)).includes('Nothing is one ingredient away'),
    await textOf(page, ONE_AWAY_EMPTY)
  )
  // A SINGLE-INGREDIENT RECIPE MUST NOT BE HERE. 87 of them consume one kind, and an empty-handed
  // character is one ingredient from every one — which is what the refined rule exists to refuse.
  check('…and no row at all is drawn under it', (await countOf(page, `${ONE_AWAY} ${ROW}`)) === 0)
}

/** Search by PRODUCT, open the row, and read the ingredient list the wiki actually states. */
async function stepKabobs(page: Page): Promise<void> {
  const first = await searchFor(page, 'gnome kabobs', 'Gnome Kabobs')
  if (!check('searching a product name narrows the list to that one recipe', first === 'Gnome Kabobs', first)) return
  check('…and exactly one row is drawn', (await countOf(page, ROW)) === 1)
  check('…which the All section counts as one', (await sectionCount(page, ALL_COUNT)) === 1)

  // CLICK THE ROW, not a chevron — the whole row is the affordance.
  await page.click(ROW, { timeout: 15_000 })
  // SCOPED UNDER THE ROW, here and below: an ingredient line is only ever a claim about the recipe
  // it hangs off, and a bare `crafting-ingredient` selector would happily read one belonging to a
  // row this step is not talking about.
  const lines = `${ROW}[data-recipe="Gnome Kabobs"] ${INGREDIENT}`
  const drawn = await settle(() => countOf(page, lines), (n) => n > 0, { timeoutMs: 15_000, pollMs: 100 })
  check(
    `opening it draws all ${String(KABOB_INGREDIENTS)} ingredients the wiki states`,
    drawn === KABOB_INGREDIENTS,
    `${String(drawn)} ingredients`
  )
  check(
    'Skewers are tagged NOT CONSUMED — they are Returned on Success, a tool rather than a component',
    (await countOf(page, `${lines}[data-ingredient="Skewers"] ${NOT_CONSUMED}`)) === 1
  )
  check('…and only that one line carries the tag', (await countOf(page, NOT_CONSUMED)) === 1)
  // Nothing in this dump is gnome meat, so the consumed lines read zero held.
  const meat = await page.getAttribute(`${lines}[data-ingredient="Gnome Meat"]`, 'data-have')
  check('an ingredient the dump does not name reads `you hold 0`', meat === '0', String(meat))
}

/** Search by INGREDIENT, and read the one thing this character is actually carrying. */
async function stepGriffenne(page: Page): Promise<void> {
  const product = await searchFor(page, 'griffenne blood', 'Royal Temper')
  if (!check('searching an INGREDIENT name finds the recipe that wants it', product === 'Royal Temper', product)) {
    return
  }
  check('…and it is the only recipe that wants it', (await countOf(page, ROW)) === 1)

  await page.click(ROW, { timeout: 15_000 })
  const lines = `${ROW}[data-recipe="Royal Temper"] ${INGREDIENT}`
  await settle(() => countOf(page, lines), (n) => n === 3, { timeoutMs: 15_000, pollMs: 100 })
  const held = await page.getAttribute(`${lines}[data-ingredient="Griffenne Blood"]`, 'data-have')
  const need = await page.getAttribute(`${lines}[data-ingredient="Griffenne Blood"]`, 'data-need')
  check(
    `the ingredient the staged dump carries reads its stacked Count (${String(BLOOD_HELD)})`,
    held === String(BLOOD_HELD),
    String(held)
  )
  check('…against a stated need of 1', need === '1', String(need))
  const sunlight = await page.getAttribute(`${lines}[data-ingredient="Essence of Sunlight"]`, 'data-need')
  check('…and the recipe still wants two Essence of Sunlight it does not have', sunlight === '2', String(sunlight))
  const sunlightHeld = await page.getAttribute(`${lines}[data-ingredient="Essence of Sunlight"]`, 'data-have')
  check('…and holds none of them', sunlightHeld === '0', String(sunlightHeld))

  // THE INVERSION (see the header): two kinds short is not one away, on either half of the rule.
  const oneAway = await countOf(page, `${ONE_AWAY} ${ROW}[data-recipe="Royal Temper"]`)
  check('Royal Temper is NOT in "One ingredient away" — it is two kinds short, and the tab says so', oneAway === 0)
}

/** The tradeskill select is a filter, and a filter narrows. */
async function stepSkillFilter(page: Page): Promise<void> {
  // Clearing the box restores the whole corpus, which is the baseline this step narrows FROM.
  await page.fill(SEARCH, '', { timeout: 15_000 })
  const before = await settle(() => sectionCount(page, ALL_COUNT), (n) => n > 2_000, { timeoutMs: 15_000, pollMs: 100 })
  check('clearing the search box restores the whole corpus', before > 2_000, `${String(before)} recipes`)
  await page.click(SKILL, { timeout: 15_000 })
  await page.waitForSelector('li[data-value="Baking"]', { timeout: 10_000 })
  await page.click('li[data-value="Baking"]')
  const after = await settle(() => sectionCount(page, ALL_COUNT), (n) => n > 0 && n < before, {
    timeoutMs: 15_000,
    pollMs: 100
  })
  check(
    'picking a tradeskill narrows the All section',
    after > 0 && after < before,
    `${String(after)} of ${String(before)}`
  )
  check('…and every drawn row belongs to it', await allRowsAreBaking(page))
}

function allRowsAreBaking(page: Page): Promise<boolean> {
  return page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].every((el) => (el as HTMLElement).innerText.includes('Baking')),
    ROW
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

    if (await openTab(page)) {
      await stepFooter(page)
      await stepEmptyStates(page)
      await stepKabobs(page)
      await stepGriffenne(page)
      await stepSkillFilter(page)
    } else {
      note('the Crafting tab never mounted — every claim below it is unmeasured, not passing')
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'crafting-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  note('the crafting spec did not complete')
  process.exitCode = 1
})
