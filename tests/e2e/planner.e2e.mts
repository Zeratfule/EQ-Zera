/**
 * Headless Electron integration test for THE EXALTATIONS TAB AND THE WISH LIST — two tabs of the
 * gear area, one feature, one launch (JOS-326; docs/plans/exaltation-planner.md §9).
 *
 * WHAT THIS SPEC BECAME. It used to drive a planner with three modes over a selected SET: Effects
 * picked what you wanted, Inventory laid it over the gear you were wearing, Farm turned what was
 * missing into a route. JOS-326 removed the set switcher, the mode toggle, the board and the Farm
 * tab: Exaltations is a SEARCH SURFACE now, and what you found there goes on a flat WISH LIST one
 * tab over, which inherited the zone rollup. So this spec walks the feature the way a player does
 * — browse, add, cross to the list, and see the route.
 *
 * THE PLAN BOARD'S CLAIMS WENT WITH THE PLAN BOARD, and the removals are stated rather than
 * silently dropped: the board's cells and pairs, the host picker, the socket preset, the planned
 * exaltation's hover line, the add button's Replace warning and the Farm rollup are gone from the
 * product, so their steps are gone from here (plannerSteps.mts lists them, with what still covers
 * the model underneath and the one assertion that wants re-homing).
 *
 * WHY ITS OWN FILE: one spec per surface, all of them sharing `appHarness.mts` and running back to
 * back from `npm run test:e2e`. `EQ_E2E=1` (src/main/e2e.ts) shows no window, skips the
 * single-instance lock and points `userData` at a throwaway temp dir, so this runs invisibly beside
 * the user's game and dev app.
 *
 * WHY THE STORE IS WRITTEN BEFORE THE LAUNCH. The wish list SEEDS ITSELF ONCE from the exaltation
 * sets a user had planned — that is how the board's removal keeps their work — and nothing in the
 * product can create a set any more. So this spec owns its `userData` dir and writes one plan into
 * it first. That is the only way an app can reach the import at all, and it is why the dir is
 * `makeUserData()`'s rather than the launcher's.
 *
 * WHAT IT ASSERTS, against the REAL committed item DB: the Gear nav row plus the Exaltations tab
 * mounts the pane; the pane is SEARCH-ONLY (no set chip, no mode toggle, no board, no rollup) and
 * still carries the class filter over the effect list; the browser lists at least one effect row
 * and expands it into at least one donor (asserted as a FLOOR, never as today's count); a majority
 * of donor rows state what their effect DOES, in one line joined from the committed spell DB; the
 * era filter is ON by default and actually removes rows when switched off; the non-equippable
 * escape hatch is off by default and only ever adds; the Focus tab opens on FAMILIES with the best
 * tier of each crowned; any item the DB carries can narrow the list, and that narrowing survives a
 * switch between the effect kinds (JOS-210, both halves); ADDING a donor puts it on the wish list
 * and turns its own row to `Wished`; the wish list carries the one-time plan import LABELLED, groups
 * its rows by zone without ever heading a zone this era cannot reach, searches the WHOLE corpus
 * from one add control (gear rows and donors together), refuses a second wish for the same item,
 * searches its own rows, removes one, and deep-links every name into the Loot drill-down; and the
 * exaltation rules card is NOT up on a first visit, comes up only from the toolbar's `?`, and
 * closes for good when dismissed (V10 as JOS-51 revised it).
 *
 * The one thing it deliberately does NOT assert is which effects or donors are on screen: a
 * rescrape may re-word an effect, and a spec that pinned today's proc names would rot (AGENTS.md:
 * frozen numbers rot).
 *
 * Run: `npm run test:e2e -- planner`.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  pageOverflow,
  reportRun,
  settleCount,
  settleGone,
  settleStable
} from './appHarness.mjs'

import { makeUserData, removeUserData } from './appWindow.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import { CURRENT_SCHEMA_VERSION } from '../../src/main/storeMigrations'
// Every `planner-*` selector, the DOM measurements, and the steps that measure the EFFECT LIST
// live next door — this spec sits at the repo's max-lines budget and the rule is to split, never
// ratchet (drill.mts, combatSteps.mts). The ORDER is still owned here.
import {
  ADD_BUTTON,
  ADD_WISHED,
  DONOR_NAME,
  DONOR_ROW,
  EFFECT_LIST,
  EFFECT_ROW,
  EFFECT_SAYS,
  EXPLAINER,
  EXPLAINER_OPEN,
  NAV,
  TAB,
  VIEW,
  WISHED_CHIP,
  boxOf,
  stepEra,
  stepFocusFamilies,
  stepItemFilter,
  stepNonEquip,
  stepSearchOnly,
  textOf,
  until
} from './plannerSteps.mjs'
import {
  WISH_TAB,
  stepAddFromCorpus,
  stepDoneStrip,
  stepEraOff,
  stepNoDoubleWish,
  stepRemove,
  stepSearchWishes,
  stepSeedImport,
  stepWishDeepLink,
  stepZoneGrouping
} from './wishlistSteps.mjs'
// JOS-329's away-and-back step for this browser, from the module the gear and character specs share.
import { stepBrowseMemory } from './areaMemorySteps.mjs'
// JOS-344 — the donor names got the Gear tab's comparison pair back. Its own module, and it
// imports the Gear side's assertions rather than restating them: one card, one instrument.
import { stepExaltCompare } from './exaltCompareSteps.mjs'

/** The Loot tab's drill-down, where an item name deep-links to. */
const LOOT_DETAIL = '[data-testid="loot-detail"]'
const LOOT_TITLE = '[data-testid="loot-detail-title"]'
const LOOT_DB_SOURCES = '[data-testid="loot-db-sources"]'
/** The drill's back ARROW — origin-aware since JOS-43, and the return leg of this spec. */
const LOOT_BACK = '[data-testid="loot-back"]'

/**
 * THE PLAN THIS RUN INHERITS — one socket, written into the store before the app ever starts.
 *
 * `batfang headband` is this repo's standing corpus anchor (tests/plannerFarm.test.mts rests three
 * zone claims on the same committed mob rows). The effect and socket are its real corpus values,
 * so the imported row resolves to a real donor with a real merge tier — and if a rescrape ever
 * re-words the effect, the seed still imports the item under the key it was stored with, which is
 * exactly the fallback the collection is built to make (tests/wishFarm.test.mts pins it). Nothing
 * below asserts the effect's spelling.
 */
const PLANNED_DONOR = 'batfang headband'

/**
 * …AND ONE WISH FOR SOMETHING THIS CHARACTER ALREADY OWNS, so the DONE STRIP is reachable.
 *
 * The strip appears when the progress join says a wish is fulfilled, and for a GEAR wish that
 * means "you hold one, or you have looted one". `Red Dragonscale Armor` is worn in the committed
 * `/outputfile inventory` dump this launch stages into the install root (`Chest  Red Dragonscale
 * Armor +1`, tests/fixtures/Primitive_freeport-Inventory.txt) and the gear index carries the row
 * under that key — so the join has both witnesses and the strip is a deterministic assertion
 * rather than a machine-dependent one.
 *
 * WRITTEN INTO THE STORE rather than added through the UI on purpose: what is under test is the
 * JOIN, and a wish typed during the run would prove the same thing only on a machine whose dump
 * happened to hold whatever the search returned first.
 */
const OWNED_WISH = { key: 'red dragonscale armor', name: 'Red Dragonscale Armor' }

function seedStore(userData: string): void {
  const now = Date.now()
  const store = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    byCharacter: {
      primitive_freeport: {
        inventory: {},
        completedQuests: [],
        exaltPlans: [
          {
            id: 'e2e-seeded-set',
            name: 'Set 1',
            classes: [],
            createdAt: now,
            updatedAt: now,
            slots: { HEAD: { sockets: { focus: { effect: 'Extended Enhancement II', donorKey: PLANNED_DONOR } } } }
          }
        ],
        wishlist: {
          entries: [
            { itemKey: OWNED_WISH.key, name: OWNED_WISH.name, kind: 'gear', addedAt: now, source: 'user' }
          ],
          clearedDone: []
        }
      }
    }
  }
  writeFileSync(join(userData, 'everquest-companion-progress.json'), `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

/**
 * 1. THE GEAR ROW, THEN THE EXALTATIONS TAB, MOUNTS THE PANE. False on the no-logs machine, where
 *    no feature view mounts.
 *
 * TWO CLICKS SINCE JOS-324, and the change was only to the door. Exaltations used to own a nav row
 * (`nav-planner`); it is the second TAB of the gear area, which hangs off the one `nav-gear` row.
 * The view id, the route, the store keys and every surviving `planner-*` testid are what they
 * always were — JOS-42 renamed the LABEL and JOS-324 moved the DOOR, and neither was a refactor.
 *
 * THE PANE MOUNTS STRAIGHT ONTO ITS BROWSE NOW. There is no create-a-set empty state to pass
 * through: a search surface has nothing to create, which is itself the first thing JOS-326 changed
 * about arriving here.
 */
async function stepMount(page: Page): Promise<boolean> {
  const hasRow = await page.waitForSelector(NAV, { timeout: 60_000 }).then(
    () => true,
    () => false
  )
  if (!check('the nav drawer has a Gear row — the one door to all four gear tabs', hasRow)) return false
  // CASE-INSENSITIVE ON PURPOSE, here and on the tab below. `innerText` reports RENDERED text,
  // and the 2026-09-06 theme rework sets `text-transform: uppercase` on nav rows and tab labels,
  // so these read "GEAR beta" and "EXALTATIONS". The claim is the NAME, not the letter-casing.
  const rowLabel = (await textOf(page, NAV)).replace(/\s+/g, ' ').trim()
  check('…and the row is called Gear, the area rather than the tab', /gear/i.test(rowLabel), `reads "${rowLabel}"`)
  await page.click(NAV, { timeout: 15_000 })

  const hasTab = await page.waitForSelector(TAB, { timeout: 30_000 }).then(
    () => true,
    () => false
  )
  if (!check('…and it opens an area whose tab bar offers Exaltations', hasTab)) return false
  const tabLabel = (await textOf(page, TAB)).replace(/\s+/g, ' ').trim()
  check('…called Exaltations, the name the game uses', /exaltations/i.test(tabLabel), `reads "${tabLabel}"`)
  await page.click(TAB, { timeout: 15_000 })

  const mounted = await until(async () => (await countOf(page, VIEW)) > 0, 30_000)
  if (!mounted) {
    const noLogs = (await textOf(page, 'main')).includes('No EverQuest logs found')
    check('clicking Exaltations mounts the pane (or the no-logs empty state explains why not)', noLogs)
    if (noLogs) note('no character logs on this machine — the app shows its fresh-machine empty state')
    return false
  }
  check('clicking the Exaltations tab mounts the pane straight onto its browse', true)
  return true
}

/**
 * 2. THE RULES CARD WAITS TO BE ASKED, AND DISMISSING IT STICKS (V10, revised by JOS-51).
 *
 * The one collaborative explainer this app allows — but the owner overturned the "meet the rules on
 * your first visit" argument it used to open on (2026-08-06): the card is CLOSED on a fresh install
 * and the toolbar's `?` is the only door in. So the first assertion here is an ABSENCE, taken the
 * settle way: wait for the toolbar's own reading to STOP CHANGING (the pane legitimately remounts
 * while the app is still reading the log) and only then assert nothing is up. Never a sleep.
 *
 * It ends dismissed so every measurement below sees the pane at the height a returning player sees.
 */
async function stepExplainer(page: Page): Promise<void> {
  const first = await settleStable(
    async () => ({ card: await countOf(page, EXPLAINER), ask: await countOf(page, EXPLAINER_OPEN) }),
    { timeoutMs: 20_000 }
  )
  check(
    'the planner does NOT teach unasked — no rules card on a first visit',
    first.card === 0,
    `${String(first.card)} cards up before anyone asked`
  )
  if (!check('…and the toolbar carries the ? that is now the only way in', first.ask > 0)) return

  await page.click(EXPLAINER_OPEN, { timeout: 15_000 })
  if (!check('asking with the ? puts the exaltation rules card up', (await settleCount(page, EXPLAINER, 1, { timeoutMs: 8_000 })) > 0)) {
    return
  }
  // The numbers are read from the rules, never written here — so the unlock tiers must be on it.
  const text = (await textOf(page, EXPLAINER)).replace(/\s+/g, ' ')
  check('…and it states the unlock tiers it reads out of the rules', /Focus at \+\d/.test(text), text.slice(0, 90))

  await page.click(`${EXPLAINER} .MuiAlert-action button`, { timeout: 15_000 })
  check('dismissing the card puts it away', await settleGone(page, EXPLAINER, { timeoutMs: 8_000 }))

  await page.click(EXPLAINER_OPEN, { timeout: 15_000 })
  check('the ? brings it back after a dismissal', (await settleCount(page, EXPLAINER, 1, { timeoutMs: 8_000 })) > 0)
  await page.click(`${EXPLAINER} .MuiAlert-action button`, { timeout: 15_000 })
  await settleGone(page, EXPLAINER, { timeoutMs: 8_000 })
}

/** 3. THE EFFECT BROWSER LISTS THE COMMITTED CORPUS, in a bounded box. */
async function stepEffects(page: Page): Promise<boolean> {
  const listed = await until(async () => (await countOf(page, EFFECT_ROW)) > 0, 60_000)
  const box = await boxOf(page, EFFECT_LIST)
  check('the effect browser renders rows from the committed item DB', listed, `${String(await countOf(page, EFFECT_ROW))} rows`)
  check(
    'the effect list is its own scroller (a growing list never grows the page)',
    box !== null && box.h > 0 && box.scrollH >= box.clientH,
    box ? `${String(box.h)}px tall · scrollHeight ${String(box.scrollH)} vs clientHeight ${String(box.clientH)}` : 'absent'
  )
  return listed
}

/**
 * Expand an effect group so its donors are on screen. Retried once: the view remounts while the
 * app is still reading the log (App keys it on the character), and a remount collapses the tree —
 * which is correct behaviour for a fresh mount, and must not be read as "effects have no donors".
 */
async function ensureDonorRow(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await countOf(page, ADD_BUTTON)) > 0) return true
    await page.click(EFFECT_ROW, { timeout: 15_000 })
    if (await until(async () => (await countOf(page, ADD_BUTTON)) > 0, 8000)) return true
  }
  return false
}

/**
 * 4b. EVERY DONOR ROW SAYS WHAT ITS EFFECT DOES (V6).
 *
 * The index-build join is pinned in `tests/plannerEffectIndex.test.mts`; what only a launched app
 * can show is that the row DRAWS it. A count rather than a text match: the wording is the spell
 * DB's, and a spec that pinned "Beneficial · Single Friendly · 27 minutes" would rot on the next
 * rescrape. A MAJORITY is the assertion, because a miss is deliberately silent (law 1) and the
 * measured hit rate is 94% — a collapse to nothing means the join broke, not that the wiki moved.
 */
async function stepEffectSays(page: Page): Promise<void> {
  const rows = await countOf(page, DONOR_ROW)
  const says = await countOf(page, EFFECT_SAYS)
  check(
    'a donor row states what its effect DOES, in one line from the spell DB',
    says * 2 > rows && rows > 0,
    `${String(says)} of ${String(rows)} visible rows — e.g. ${await textOf(page, EFFECT_SAYS)}`
  )
}

/** The wish control of the donor row bearing a given name — `DonorName` puts it in the `title`. */
const controlOfDonor = (name: string): string =>
  `${DONOR_ROW}:has([data-testid="planner-donor-name"][title="${name}"]) [data-testid="planner-add"]`

/**
 * 5. ADDING A DONOR IS ONE CLICK, AND IT WRITES A WISH (JOS-326) — AND CLICKING IT AGAIN TAKES THE
 *    WISH BACK OFF (JOS-343, owner ruling 2026-08-13).
 *
 * The button used to say "Add to set", could open a slot menu when the donor fit more than one
 * cell, and turned into a warning-coloured "Replace" over an occupied socket. All three came from
 * the plan board, and all three are gone.
 *
 * WHAT THIS STEP USED TO CLAIM AND NO LONGER DOES: "the add control goes quiet rather than
 * accepting a click that would change nothing". That was true of a one-way add and the owner
 * overruled the one-way add. The control is enabled in both states now and a second click REMOVES,
 * so the claim it is replaced by is the opposite one — the toggle flips, both ways, in place.
 *
 * THE RE-ADD AT THE END IS NOT DECORATION. Everything downstream (`wishlistSteps`) reads this
 * donor's row off the ROUTE, which is what proves the ADD reached the store; the store half of the
 * REMOVE is proven at the end of the run by `stepUnwishFromBrowse`, where taking it off costs
 * nothing. Toggling here and putting it back is what lets both be asserted in one launch.
 *
 * Returns the donor's NAME so the wish-list half can find the row it just made.
 */
async function stepAddWish(page: Page): Promise<string | null> {
  if (!check('an effect row expands into at least one donor', await ensureDonorRow(page), `${String(await countOf(page, ADD_BUTTON))} donors`)) {
    return null
  }
  await stepEffectSays(page)
  const name = (await textOf(page, DONOR_NAME)).trim()
  const label = (await textOf(page, ADD_BUTTON)).replace(/\s+/g, ' ').trim()
  check('the add control names where the click sends it', label.toLowerCase().includes('wish'), `reads "${label}"`)

  await page.click(ADD_BUTTON, { timeout: 15_000 })
  // No slot menu can open any more — the flat list has no cell to disambiguate. Asserted as an
  // absence the settle way, because a menu that opened would only be visible for a moment.
  const menu = await settleCount(page, '.MuiMenu-root .MuiMenuItem-root', 0, { timeoutMs: 3_000 })
  check('adding never asks which cell — a flat wish has none to ask about', menu === 0, `${String(menu)} menu items`)

  const marked = await until(async () => (await countOf(page, WISHED_CHIP)) > 0, 10_000)
  check(`adding "${name}" chips its own row as wished`, marked)
  check(
    '…and the control reads its added state rather than staying an add (JOS-343)',
    (await countOf(page, ADD_WISHED)) > 0
  )
  if (!marked) return null

  // THE TOGGLE, IN PLACE. Same control, same row, no tab in between: the second click is a REMOVE.
  const control = controlOfDonor(name)
  if (!check(`the wished donor's own control is findable by name — "${name}"`, (await countOf(page, control)) === 1)) {
    return name
  }
  await page.click(control, { timeout: 15_000 })
  check(
    'a second click on a wished donor removes the wish — the lit no-op is overruled',
    await until(async () => (await countOf(page, `${control}[data-wished="true"]`)) === 0, 10_000)
  )
  check('…and its row drops the wished chip with it', (await countOf(page, `${DONOR_ROW}:has([data-testid="planner-donor-name"][title="${name}"]) ${WISHED_CHIP}`)) === 0)

  // …and back on, because the route half of the run is built on this wish existing.
  await page.click(control, { timeout: 15_000 })
  const readded = await until(async () => (await countOf(page, `${control}[data-wished="true"]`)) === 1, 10_000)
  check('a third click puts it back — the toggle is a toggle, not a one-shot', readded)
  return readded ? name : null
}

/**
 * Two donor rows on screen, unadded, whose names are unique among the mounted rows — so a selector
 * built from either name addresses exactly one control.
 *
 * NO NAMED INNER FUNCTION IN THE `evaluate` BODY, deliberately. tsx's esbuild transform keeps
 * function names by wrapping them in a `__name` helper that exists in the SPEC's module scope and
 * not in the page's, so a `const nameOf = …` inside here dies with `__name is not defined` the
 * moment the browser runs it. Measured on the first run of this step.
 */
function pickTwoUnwished(page: Page): Promise<[string, string] | null> {
  return page.evaluate((rowSel) => {
    const names = Array.from(document.querySelectorAll(rowSel)).map((row) => ({
      row,
      name: (row.querySelector('[data-testid="planner-donor-name"]') as HTMLElement | null)?.innerText.trim() ?? ''
    }))
    const seen = new Map<string, number>()
    for (const n of names) seen.set(n.name, (seen.get(n.name) ?? 0) + 1)
    const picked: string[] = []
    for (const n of names) {
      const control = n.row.querySelector('[data-testid="planner-add"]')
      if (n.name === '' || seen.get(n.name) !== 1) continue
      if (control === null || control.hasAttribute('disabled') || control.hasAttribute('data-wished')) continue
      picked.push(n.name)
      if (picked.length === 2) return [picked[0], picked[1]] as [string, string]
    }
    return null
  }, DONOR_ROW)
}

/**
 * 9. THE BROWSE'S TOGGLE REACHES THE DOCUMENT, BOTH WAYS (JOS-343) — the half `stepAddWish` cannot
 *    see, because a control's own state is not a store.
 *
 * IT IS A DIFFERENTIAL, AND THE SHAPE IS THE WHOLE POINT. Two donors are picked off the screen. One
 * is ADDED and left. The other is ADDED and then CLICKED AGAIN. Then the Wish list tab is opened
 * ONCE and asked about both: the first is on it, the second is not. "Add then remove leaves nothing
 * behind" on its own would also pass a build where neither click did anything at all — the donor
 * that stayed is what rules that out, in the same launch, off the same document.
 *
 * WHY IT IS SHAPED THIS WAY RATHER THAN AS A ROUND TRIP. The obvious version — add, go look, come
 * back, click again, go look again — needs the SAME donor row to still be windowed after two
 * remounts of a virtualised list whose era filter `stepEraOff` has since changed underneath it. It
 * was written that way first and it skipped itself on the first run ("Bloodclaw Battle Axe is not
 * windowed on the way out"), which is a spec measuring `useWindowedRows` rather than the toggle.
 * One trip, taken after both clicks, needs nothing to survive anything.
 *
 * RUNS LAST for the reason every destructive step in this spec runs last: nothing after it needs
 * the wishes it leaves behind, and it ends on the Wish list tab.
 */
async function stepBrowseToggleReachesStore(page: Page): Promise<void> {
  if (!(await ensureDonorRow(page))) {
    note('no donor rows on screen on the way out — the browse-side store step is skipped this run')
    return
  }
  // THE PRECONDITION THE FIRST DRAFT OF THIS STEP DID NOT HAVE, and it cost a red run. The browse
  // was remounted by the trip through Loot, and its controls used to render BEFORE the wish
  // document came back — so every row read unadded and the pick chose a donor that was on the list.
  // The product answer is `PlannerView`'s `donorToggle` (no control at all until `ready`); this is
  // the spec's half of the same fact, and it is a real claim rather than a wait: the run reaches
  // here with wishes on the list, so a browse showing none of them has not re-read the store.
  if (!check(
    'the remounted browse has re-read the wish document before a row is picked off it',
    await until(async () => (await countOf(page, ADD_WISHED)) > 0, 20_000)
  )) return
  const pair = await pickTwoUnwished(page)
  if (!check('two unwished donor rows are on screen to toggle against each other', pair !== null)) return
  const [kept, undone] = pair as [string, string]

  const keptControl = controlOfDonor(kept)
  const undoneControl = controlOfDonor(undone)
  await page.click(keptControl, { timeout: 15_000 })
  if (!check(`"${kept}" is added and stays added`, await until(async () => (await countOf(page, `${keptControl}[data-wished="true"]`)) === 1, 10_000))) return

  await page.click(undoneControl, { timeout: 15_000 })
  if (!check(`"${undone}" is added too`, await until(async () => (await countOf(page, `${undoneControl}[data-wished="true"]`)) === 1, 10_000))) return
  await page.click(undoneControl, { timeout: 15_000 })
  if (!check(`…and a second click on "${undone}" reads as removed`, await until(async () => (await countOf(page, `${undoneControl}[data-wished="true"]`)) === 0, 10_000))) return

  await page.click(WISH_TAB, { timeout: 15_000 })
  if (!check('the Wish list tab mounts to be asked about both', await until(async () => (await countOf(page, '[data-testid="wishlist-view"]')) > 0, 20_000))) return
  // Both row kinds, because a wish the progress join calls fulfilled is filed in the done strip
  // rather than the route and is still very much ON the list.
  const WISH_ROWS = '[data-testid="wishlist-row"], [data-testid="wishlist-done-row"]'
  const readNames = (): Promise<string[]> =>
    page.evaluate(
      (s) => Array.from(document.querySelectorAll(s)).map((e) => (e as HTMLElement).innerText.split('\n')[0].trim()),
      WISH_ROWS
    )
  // AND THE MOUNT IS NOT THE ROWS. The route is a fold over BOTH corpus indices and the progress
  // join, so a freshly mounted pane draws its shell with nothing under it for a beat — read at the
  // mount, this step got an EMPTY list and reported the added donor missing (its first red run).
  // So it waits for the condition rather than for the pane (AGENTS.md), and reads the final list
  // afterwards either way — a list that never fills fails on the claim below, not on a timeout.
  await until(async () => (await readNames()).includes(kept), 20_000)
  const listed = await readNames()
  check(`the donor left added is on the wish list — "${kept}"`, listed.includes(kept), listed.slice(0, 6).join(', '))
  check(
    `…and the one clicked twice is not — the browse's second click used the wish list's own delete — "${undone}"`,
    !listed.includes(undone),
    listed.slice(0, 6).join(', ')
  )
}

/**
 * 6. A DONOR NAME DEEP-LINKS INTO THE LOOT DRILL-DOWN — and the drill is worth the trip.
 *
 * The click is the app's standing link idiom (`openLoot`, appRouting.ts): it takes the Loot pane
 * over with that item's detail. The second half of the check is the one that matters — the drill
 * used to build "Dropped by / Zones" from OBSERVED loot events alone, so a donor you have never
 * looted answered "No source recorded" one click after the planner told you which mob drops it.
 * `loot-db-sources` is the section that closes that contradiction, so its presence is the actual
 * contract this link depends on.
 *
 * AND IT IS A ROUND TRIP (JOS-43). The reported bug was the return leg: Back on that drill meant
 * the top of the loot ledger, so reading one donor cost you your place. The arrow names the tab
 * that sent you and goes there, which is asserted both by its accessible name (before the click)
 * and by the Exaltations tab being on screen after it.
 */
async function stepDeepLink(page: Page): Promise<void> {
  if (!(await ensureDonorRow(page))) {
    note('no donor row on screen to click through — the deep-link step is skipped this run')
    return
  }
  const name = (await textOf(page, DONOR_NAME)).trim()
  await page.click(DONOR_NAME, { timeout: 15_000 })

  const landed = await until(async () => (await countOf(page, LOOT_DETAIL)) > 0, 20_000)
  if (!check('clicking a donor name opens the Loot tab’s item drill-down', landed, `donor "${name}"`)) return
  const title = (await textOf(page, LOOT_TITLE)).replace(/\s+/g, ' ').trim()
  check('…on the item that was clicked, not on the ledger', title === name, `"${title}" vs "${name}"`)
  check(
    'the drill states what the committed DBs know about where it drops (never-looted items included)',
    (await countOf(page, LOOT_DB_SOURCES)) > 0
  )

  // THE RETURN LEG (JOS-43). The arrow says where it goes before you press it — one string feeds
  // the tooltip and the accessible name — and then it goes there.
  const label = await page.getAttribute(LOOT_BACK, 'aria-label')
  check('the drill’s back arrow names Exaltations, not the loot list', label === 'Back to Exaltations', String(label))
  await page.click(LOOT_BACK, { timeout: 15_000 })
  const home = await until(async () => (await countOf(page, VIEW)) > 0, 20_000)
  check('…and pressing Back returns to the Exaltations tab you were reading', home)
  check('…with the browse still on screen, not the loot ledger', (await countOf(page, LOOT_DETAIL)) === 0)
  // BOTH HALVES OF "WHERE AM I" SINCE JOS-324. The nav row stands for the whole gear area, so it
  // reads selected on any of the four tabs and cannot by itself say we came back to Exaltations —
  // the TAB is what says that.
  check('…and the nav agreeing about where we are', (await countOf(page, `${NAV}.Mui-selected`)) === 1)
  check('…down to which of the area’s tabs is up', (await countOf(page, `${TAB}.Mui-selected`)) === 1)
}

/** Everything the EXALTATIONS tab owns, in order. */
async function exaltationSteps(app: ElectronApplication, page: Page): Promise<string | null> {
  await stepExplainer(page)
  await stepSearchOnly(page)
  if (!(await stepEffects(page))) return null
  await stepEra(page)
  await stepNonEquip(page)
  await stepFocusFamilies(page)
  await stepItemFilter(page)
  // JOS-329. It runs BEFORE the add step and after every measuring step: it needs a browse it can
  // put into a non-default state (a socket tab, the escape hatch, an expanded group) and it hands
  // all of that back, so `stepAddWish` still finds the proc tab it was written against.
  await stepBrowseMemory(page)
  // JOS-344 runs HERE, before the add step, on a browse nothing has written to yet: it hovers a
  // donor NAME and hit-tests that row's own wish control with the card up, and reading that control
  // in the state the surface opens in is the honest reading. (It would survive running after
  // `stepAddWish` too, since JOS-343 made the control a TOGGLE that stays enabled once lit — but
  // that is a fact about a sibling ticket's design, not a dependency worth taking.) It resizes the
  // window and puts it back, parks the pointer, and touches no filter.
  await stepExaltCompare(app, page)
  return stepAddWish(page)
}

/**
 * Everything the WISH LIST owns, in order — entered by its own tab of the same area.
 *
 * The order is the test in two places. `stepSeedImport` must run FIRST, because the seed is
 * one-shot and every step after it edits the list; and `stepRemove` must run LAST of the edits, so
 * the row the corpus search added is still there for the search and deep-link steps to find.
 */
async function wishlistSteps(page: Page, addedFromBrowse: string | null): Promise<void> {
  await page.click(WISH_TAB, { timeout: 15_000 })
  if (!(await stepSeedImport(page))) return
  if (addedFromBrowse !== null) {
    const names = await page.evaluate(
      (s) => Array.from(document.querySelectorAll(s)).map((e) => (e as HTMLElement).innerText.split('\n')[0].trim()),
      '[data-testid="wishlist-row"]'
    )
    check(
      `the donor added on the Exaltations tab is on the wish list — "${addedFromBrowse}"`,
      names.includes(addedFromBrowse),
      names.slice(0, 5).join(', ')
    )
  }
  await stepZoneGrouping(page)
  // …and it leaves the era filter OFF, so every row-level step below can find what it just made.
  await stepEraOff(page)
  const added = await stepAddFromCorpus(page)
  if (added !== null) {
    await stepNoDoubleWish(page, added)
    await stepSearchWishes(page, added)
  }
  await stepDoneStrip(page, OWNED_WISH.name)
  await stepWishDeepLink(page, LOOT_DETAIL, LOOT_TITLE)
  await page.click(LOOT_BACK, { timeout: 15_000 }).catch(() => {
    /* the deep-link step may have skipped itself; the tab click below is the recovery either way */
  })
  await page.click(WISH_TAB, { timeout: 15_000 })
  await until(async () => (await countOf(page, '[data-testid="wishlist-view"]')) > 0, 20_000)
  if (added !== null) await stepRemove(page, added)
}

async function main(): Promise<void> {
  buildIfStale()

  // A userData dir this spec OWNS, because the wish list's one-time seed has to have something to
  // import and nothing in the product can plan a socket any more (see `seedStore`). `launchApp`
  // only deletes a dir it created, so the teardown below is ours to run.
  const userData = makeUserData()
  seedStore(userData)

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-planner.log…')
  // …and a real `/outputfile inventory` dump in the install root beside it (JOS-185), so the
  // progress join the wish list reads has a dump to answer from rather than taking its never-run
  // branch on every launch.
  const { app, close } = await launchOnFixture('e2e-planner.log', {
    inventory: 'Primitive_freeport-Inventory.txt',
    userData
  })

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    if (await stepMount(page)) {
      const added = await exaltationSteps(app, page)
      const over = await pageOverflow(page)
      check(
        'Exaltations never scrolls the page (its lists clip inside their own boxes)',
        over.doc === 0 && over.content === 0,
        `document +${String(over.doc)}px · content area +${String(over.content)}px`
      )
      await wishlistSteps(page, added)
      const wishOver = await pageOverflow(page)
      check(
        'the Wish list never scrolls the page either',
        wishOver.doc === 0 && wishOver.content === 0,
        `document +${String(wishOver.doc)}px · content area +${String(wishOver.content)}px`
      )
      // Runs LAST: it leaves the app on Exaltations having passed through the Loot tab, so every
      // pane-scoped measurement above it has already been taken.
      await page.click(TAB, { timeout: 15_000 })
      await until(async () => (await countOf(page as Page, VIEW)) > 0, 20_000)
      await stepDeepLink(page)
      // …and then the claim the browse's toggle owns (JOS-343): that both of its clicks reach the
      // document. It ends on the Wish list tab, which is why nothing follows it.
      await stepBrowseToggleReachesStore(page)
    }

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

    if (failures.length) await dumpArtifacts(page, 'planner-FAIL')
    else await dumpArtifacts(page, 'planner-pass')
  } finally {
    await close()
    await removeUserData(userData)
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
