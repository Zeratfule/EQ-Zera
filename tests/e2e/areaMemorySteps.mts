// AWAY AND BACK — the shared round trips that prove the gear area's forms survive leaving it
// (JOS-329), used by the gear, planner and character specs.
//
// WHY A MODULE. The claim is identical on all four tabs and only the FINGERPRINT differs: set some
// state, leave, come back, and find the same thing on screen. Writing that three times would be
// three chances to write a weaker version of it, and two of the three specs are already at the
// repo's 400-code-line factoring ceiling (the drill.mts / plannerSteps.mts precedent).
//
// THE LAW THIS ENFORCES, AND THE TRAP IT NAMES (AGENTS.md, JOS-90/97/116): "Prove it with a spec
// that actually navigates and asserts the view was GONE first (sky-filters is the template); a unit
// test of the read passes while the feature stays broken." So `leaveArea` does not merely click
// another nav row — it WAITS FOR THE VIEW TO UNMOUNT and fails if it does not. Without that step
// the whole file would pass on a build that never unmounted anything, which is the one build where
// the bug cannot reproduce and the fix is untested.
//
// TWO ROUND TRIPS, BECAUSE THE OWNER REPORTED TWO. Leaving for another MODULE (the nav drawer) and
// drilling into the Loot tab from a row and pressing BACK are different paths through
// appRouting/navOrigin — the second parks a trail and the first clears it — and the ticket names
// both. `awayAndBack` and `drillAndBack` are those two, over the same fingerprint machinery.
//
// A FINGERPRINT IS A MAP OF STRINGS, and every value in it is read off the SCREEN rather than out
// of storage. That is deliberate: `tests/areaMemory.test.mts` already proves the readers, and a
// spec that asserted `localStorage.getItem(...)` would pass while the view ignored what it read.
// What is under test here is that the CONTROLS come back wearing the state — the lit chip, the
// filled box, the count the filter produces.

import type { Page } from 'playwright-core'
import { check, countOf, note, settle } from './appHarness.mjs'
import { clearPicks, pickIn } from './gearFilterSteps.mjs'

/** The one nav row the whole gear area hangs off (JOS-324), and a module that is not in it. */
export const NAV_GEAR = '[data-testid="nav-gear"]'
export const NAV_LOOT = '[data-testid="nav-loot"]'
/** The Loot ledger's own list — what "we really are on another module" looks like. */
export const LOOT_LIST = '[data-testid="loot-list"]'
/** The Loot drill-down and its origin-aware back arrow (JOS-43). */
export const LOOT_DETAIL = '[data-testid="loot-detail"]'
export const LOOT_BACK = '[data-testid="loot-back"]'

const until = (fn: () => Promise<boolean>, ms: number): Promise<boolean> => settle(fn, (ok) => ok, { timeoutMs: ms })

/** What one surface looks like right now: field name → what the screen says. */
export type Fingerprint = Record<string, string>

/** How a spec reads its own surface. Called before leaving and again after coming back. */
export type ReadFingerprint = (page: Page) => Promise<Fingerprint>

// ---- the DOM readers a fingerprint is built from -----------------------------------------------

/** A text box's CURRENT value — `inputValue`, never `innerText`: an input's text is not its DOM. */
export async function valueOf(page: Page, sel: string): Promise<string> {
  return page.inputValue(sel, { timeout: 15_000 }).catch(() => '')
}

/** Rendered text of the first match, whitespace-collapsed; '' when the node is not mounted. */
export async function textOf(page: Page, sel: string): Promise<string> {
  const raw = await page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Is this toggle chip LIT? The bar's ON/OFF idiom is `color="primary" variant="filled"` when on and
 * `outlined` when off (GearFilterBar/EffectFilterBar's `ToggleChip`), so the class list is the
 * honest reading — a chip's label says the same thing whichever state it is in.
 */
export async function chipLit(page: Page, sel: string): Promise<string> {
  const cls = await page.getAttribute(sel, 'class').catch(() => null)
  if (cls === null) return 'absent'
  return cls.includes('MuiChip-filled') ? 'on' : 'off'
}

/**
 * Put a toggle chip into a STATE, rather than clicking it and hoping.
 *
 * A blind `click` is a toggle, and a step that toggles inherits whatever the step before it left
 * behind — which is how the first run of this file asked for "era off", clicked an era that
 * `stepEra` had already switched off, and fingerprinted the SHIPPED DEFAULT while believing it had
 * moved off it. An assertion that a default came back is indistinguishable from forgetting.
 */
export async function setChip(page: Page, sel: string, want: 'on' | 'off'): Promise<void> {
  if ((await chipLit(page, sel)) === want) return
  await page.click(sel, { timeout: 15_000 })
  await until(async () => (await chipLit(page, sel)) === want, 15_000)
}

/**
 * Which sort header is lit, as `KEY:direction`.
 *
 * READ OFF `TableSortLabel`, NOT off `aria-sort`, and that is a MEASUREMENT rather than a taste.
 * MUI only emits `aria-sort` when the TableCell is handed a `sortDirection` prop, and
 * `GearTable.SortHeader` does not pass one — so the first spelling of this function returned "none"
 * on every call and the `sort` field asserted nothing at all. The DOM the run actually saved
 * (artifacts/…/gear-FAIL.html) settles what to read instead: the active label carries `Mui-active`
 * and the direction is a class on that same root (`MuiTableSortLabel-directionDesc`), not on the
 * icon inside it.
 */
export async function sortedBy(page: Page): Promise<string> {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('[data-testid^="gear-sort-"]'))
    const active = labels.find((l) => l.classList.contains('Mui-active'))
    if (active === undefined) return 'none'
    const key = active.getAttribute('data-testid')?.replace('gear-sort-', '') ?? '?'
    const asc = active.className.includes('directionAsc')
    return `${key}:${asc ? 'asc' : 'desc'}`
  })
}

// ---- the two round trips -----------------------------------------------------------------------

/**
 * LEAVE THE GEAR AREA FOR ANOTHER MODULE, and prove the view we left is really gone.
 *
 * The unmount is the PRECONDITION of everything this file asserts, so it is a `check` of its own
 * rather than a silent wait: a build where `viewKey` stopped unmounting would make every
 * away-and-back step below pass without the feature existing.
 */
export async function leaveArea(page: Page, view: string): Promise<boolean> {
  await page.click(NAV_LOOT, { timeout: 15_000 })
  const landed = await until(async () => (await countOf(page, LOOT_LIST)) > 0, 20_000)
  const gone = await until(async () => (await countOf(page, view)) === 0, 20_000)
  return (
    check('…the other module is really up', landed) &&
    check('…and the tab we left UNMOUNTED - the precondition this whole claim rests on', gone)
  )
}

/** Come back through the nav row and the tab, and wait for the view to mount again. */
export async function returnToTab(page: Page, tab: string, view: string): Promise<boolean> {
  await page.click(NAV_GEAR, { timeout: 15_000 })
  const hasTab = await until(async () => (await countOf(page, tab)) > 0, 20_000)
  if (!hasTab) return false
  await page.click(tab, { timeout: 15_000 })
  return until(async () => (await countOf(page, view)) > 0, 20_000)
}

/**
 * Compare two fingerprints field by field and report the fields that MOVED, never just "differs".
 *
 * A failure here is somebody's filter silently resetting, and the useful failure message is which
 * one — `slots "PRIMARY" -> ""` names the control to go and look at.
 */
function diff(before: Fingerprint, after: Fingerprint): string[] {
  const moved: string[] = []
  for (const [field, was] of Object.entries(before)) {
    const now = after[field] ?? '<missing>'
    if (now !== was) moved.push(`${field} "${was}" -> "${now}"`)
  }
  return moved
}

/**
 * Read the surface until it AGREES with `before`, or until the timeout — then hand back the last
 * reading, whatever it is, for the caller to assert on.
 *
 * WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (AGENTS.md), and the condition here is a re-mounted
 * view finishing its asynchronous work. This is not tolerance for a slow restore: a returning Gear
 * tab re-asks main for the `/outputfile` ownership payload and re-reads the loot module's snapshot,
 * and until BOTH land the Owned filter legitimately matches nothing — the first run of this file
 * read "0 of 6,814" a few frames after Back and called the restore broken when it was merely
 * mid-flight. A restore that never arrives still fails, and fails with the same diff it always did.
 */
async function settleTo(page: Page, before: Fingerprint, read: ReadFingerprint): Promise<Fingerprint> {
  let last = await read(page)
  await settle(
    async () => {
      last = await read(page)
      return diff(before, last).length === 0
    },
    (ok) => ok,
    { timeoutMs: 20_000 }
  )
  return last
}

interface TripOptions {
  /** the surface's name, for the check sentence — "the Gear tab", "the Exaltations browser" */
  label: string
  /** the area tab that re-opens this surface (`tab-gear`, `tab-planner`, …) */
  tab: string
  /** the view's own testid selector, which must be GONE while we are away */
  view: string
  read: ReadFingerprint
}

/**
 * THE MODULE ROUND TRIP: set your filters, go look at Loot, come back, find them exactly as left.
 *
 * This is the owner's own reproduction, and the one that lost the most state — a nav-row click is
 * MANUAL navigation, so it clears the parked trail and the return is a fresh mount of the view with
 * nothing to restore it but what was written down.
 */
export async function awayAndBack(page: Page, opts: TripOptions): Promise<void> {
  const { label, tab, view, read } = opts
  const before = await read(page)
  if (!(await leaveArea(page, view))) return
  if (!check(`…and ${label} comes back when the area is re-entered`, await returnToTab(page, tab, view))) return
  const after = await settleTo(page, before, read)
  const moved = diff(before, after)
  check(
    `${label} restores every form field after a trip to another module`,
    moved.length === 0,
    moved.length === 0 ? Object.entries(before).map(([k, v]) => `${k}=${v}`).join(' · ') : moved.join(' | ')
  )
}

interface DrillOptions extends TripOptions {
  /** the row link that deep-links into the Loot drill-down (`openLoot`, the standing idiom) */
  link: string
}

/**
 * THE DRILL ROUND TRIP: click an item name, read its Loot drill-down, press Back, find your filters.
 *
 * The ticket names this one first ("Filters on the Gear tab must survive the Back button from a
 * Loot drill-down") and it is a DIFFERENT path from the one above: the deep link parks an origin
 * (JOS-43/navOrigin.ts) and the back arrow follows it home, so the view can be remounted by a
 * route rather than by a click. Same fingerprint, same promise.
 *
 * It degrades to a note rather than a failure when there is no link on screen: a spec whose filters
 * legitimately narrowed the list to nothing has nothing to click, and inventing a row to satisfy
 * the step would be measuring a different state than the one under test.
 */
export async function drillAndBack(page: Page, opts: DrillOptions): Promise<void> {
  const { label, tab, view, link, read } = opts
  const before = await read(page)
  if ((await countOf(page, link)) === 0) {
    note(`${label}: no row on screen to drill into — the Back round trip is skipped this run`)
    return
  }
  await page.click(link, { timeout: 15_000 })
  const drilled = await until(async () => (await countOf(page, LOOT_DETAIL)) > 0, 20_000)
  if (!check(`clicking a row name from ${label} opens the Loot drill-down`, drilled)) return
  // The same precondition as the module trip, asserted on this path too — the drill takes the whole
  // Loot view over, so the tab we came from is unmounted exactly as it is by a nav click.
  check('…and the tab we drilled out of UNMOUNTED', (await countOf(page, view)) === 0)

  await page.click(LOOT_BACK, { timeout: 15_000 })
  const home = await until(async () => (await countOf(page, view)) > 0, 20_000)
  if (!check(`…and Back returns to ${label}`, home)) {
    // The arrow is origin-aware; if it went somewhere else, re-enter by hand so the steps after
    // this one still run against the surface they were written for.
    await returnToTab(page, tab, view)
    return
  }
  const after = await settleTo(page, before, read)
  const moved = diff(before, after)
  check(
    `${label} restores every form field after a Loot drill-down and Back`,
    moved.length === 0,
    moved.length === 0 ? `${String(Object.keys(before).length)} fields intact` : moved.join(' | ')
  )
}

// ================================================================================================
// THE THREE SURFACES, EACH AS ONE STEP
// ================================================================================================
//
// Each does the same three things: put the form into a state NOTHING DEFAULTS TO, take the round
// trips, and hand the tab back the way it found it so the steps around it are unaffected. The
// "nothing defaults to" part is what makes the assertion mean anything — restoring a default is
// indistinguishable from forgetting one, so every field is moved off its shipped value first.

/**
 * Wait until a selector's MATCH COUNT stops moving, and hand it back.
 *
 * The condition a windowed list needs before anything may be CLICKED. A deferred search re-runs the
 * filter, the fold and the row flattening after the box echoes (the standing search law), so the
 * first `planner-effect-row` a click resolves is routinely detached and replaced a frame later —
 * Playwright retries, the list moves again, and the click times out against a list that is working
 * perfectly. Measured, not guessed: that is exactly how the first run of `stepBrowseMemory` failed.
 */
async function settleRows(page: Page, sel: string): Promise<number> {
  let last = -1
  await settle(
    async () => {
      const now = await countOf(page, sel)
      const stable = now === last && now > 0
      last = now
      return stable
    },
    (ok) => ok,
    { timeoutMs: 20_000 }
  )
  return last
}

/** A control's settled reading — the count text is the condition, never a sleep (the search law). */
async function settleText(page: Page, sel: string): Promise<void> {
  let last = ''
  await settle(
    async () => {
      const now = await textOf(page, sel)
      const stable = now === last && now !== ''
      last = now
      return stable
    },
    (ok) => ok,
    { timeoutMs: 15_000 }
  )
}

// ---- the Gear tab -------------------------------------------------------------------------------

const GEAR_TAB = '[data-testid="tab-gear"]'
const GEAR_VIEW = '[data-testid="gear-view"]'
const GEAR_SEARCH = '[data-testid="gear-search"] input'
const GEAR_SLOT = '[data-testid="gear-slot"]'
const GEAR_ERA = '[data-testid="gear-era-toggle"]'
const GEAR_OWNED = '[data-testid="gear-owned-toggle"]'
const GEAR_COUNT = '[data-testid="gear-count"]'
const GEAR_UPGRADE_LABEL = '[data-testid="gear-upgrade-label"]'
const GEAR_TIER_SLIDER = '[data-testid="gear-tier-slider"] input[type="range"]'
const GEAR_SORT_HP = '[data-testid="gear-sort-HP"]'
/** Any gear row's name — `PlannerChips.DonorName`, the app's one deep-link idiom. */
const GEAR_ROW_NAME = '[data-testid="gear-row"] [data-testid="planner-donor-name"]'

/** The search term the gear trip parks — real enough to match rows, odd enough to be unmistakable. */
const GEAR_PARKED_SEARCH = 'shield'
/** …and the slot it parks beside it, which SURVIVES A RESTART where the search does not. */
const GEAR_PARKED_SLOT = 'SECONDARY'

/**
 * EVERYTHING THE GEAR TAB'S FORM PUTS ON SCREEN — the fingerprint both round trips compare.
 *
 * The COUNT is in here on purpose and is the strongest field of the seven: it is the number the
 * whole filter pipeline produces, so it moves if ANY narrowing was silently dropped — including one
 * this list forgot to read a control for.
 */
async function readGear(page: Page): Promise<Fingerprint> {
  return {
    search: await valueOf(page, GEAR_SEARCH),
    slots: await textOf(page, GEAR_SLOT),
    era: await chipLit(page, GEAR_ERA),
    owned: await chipLit(page, GEAR_OWNED),
    sort: await sortedBy(page),
    upgrade: await textOf(page, GEAR_UPGRADE_LABEL),
    count: await textOf(page, GEAR_COUNT)
  }
}

/**
 * THE GEAR TAB'S ROUND TRIPS (JOS-329).
 *
 * Six fields are moved off their defaults first — the search box, a slot pick, the era toggle, the
 * owned toggle, the sort column and the plus-state slider. The slider is the one worth naming: it
 * was documented as deliberately not persisted until the owner overruled that on 2026-08-13, so a
 * label still reading `Tier 1` on the far side of a module switch IS that ruling, on screen.
 *
 * It PARKS the slot pick and the era toggle rather than clearing them, so the spec's SECOND LAUNCH
 * can prove the restart half of the split (`stepGearMemoryRelaunched`). Everything else is handed
 * back, because the steps around this one were written against the defaults.
 */
export async function stepGearMemory(page: Page): Promise<void> {
  await page.fill(GEAR_SEARCH, GEAR_PARKED_SEARCH, { timeout: 15_000 })
  await pickIn(page, GEAR_SLOT, GEAR_PARKED_SLOT)
  // STATES, NOT CLICKS (see `setChip`): the steps above this one leave the era toggle OFF and the
  // owned toggle OFF, so a blind click on era would have put it back to its shipped default and
  // fingerprinted that. Era OFF is not the default; owned ON is not the default; both are asked for
  // by name so this step is independent of whatever ran before it.
  await setChip(page, GEAR_ERA, 'off')
  await setChip(page, GEAR_OWNED, 'on')
  await page.click(GEAR_SORT_HP, { timeout: 15_000 })
  await page.focus(GEAR_TIER_SLIDER, { timeout: 15_000 })
  await page.press(GEAR_TIER_SLIDER, 'Home', { timeout: 15_000 })
  await page.press(GEAR_TIER_SLIDER, 'ArrowRight', { timeout: 15_000 })
  await settleText(page, GEAR_COUNT)

  const parked = await readGear(page)
  check(
    'the Gear tab is holding a form nothing defaults to before it is taken away',
    parked.search === GEAR_PARKED_SEARCH &&
      parked.slots.includes(GEAR_PARKED_SLOT) &&
      parked.era === 'off' &&
      parked.owned === 'on' &&
      parked.upgrade.includes('Tier 1'),
    Object.entries(parked)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ')
  )

  const trip = { label: 'the Gear tab', tab: GEAR_TAB, view: GEAR_VIEW, read: readGear }
  await awayAndBack(page, trip)
  await drillAndBack(page, { ...trip, link: GEAR_ROW_NAME })

  // …and hand the tab back. The slot pick and the era toggle STAY — the second launch reads them.
  await page.fill(GEAR_SEARCH, '', { timeout: 15_000 })
  await setChip(page, GEAR_OWNED, 'off')
  await settleText(page, GEAR_COUNT)
}

/**
 * THE RESTART HALF OF THE SPLIT, on the spec's second launch over the same `userData`.
 *
 * This is the only place a TIER can be proved, because a tier is a claim about outliving a PROCESS.
 * Both directions are asserted, and the second is the one that would otherwise rot silently: the
 * structural picks come back, AND the search box does not. A week-old query greeting a fresh launch
 * is exactly what the split exists to prevent, so "it persisted everything" has to fail here just
 * as loudly as "it persisted nothing".
 */
export async function stepGearMemoryRelaunched(page: Page): Promise<void> {
  const back = await readGear(page)
  check(
    'a structural pick survives the process — the slot the last launch chose is still chosen',
    back.slots.includes(GEAR_PARKED_SLOT),
    `slots read "${back.slots}"`
  )
  check(
    '…and so does a toggle that was switched off, rather than reverting to its shipped default',
    back.era === 'off',
    `the era chip reads ${back.era}`
  )
  check(
    'a TYPED search does NOT survive the process — the box is empty on a fresh launch',
    back.search === '',
    `the box reads "${back.search}"`
  )
  // Leave the tab clean for anything that runs after this: the parked slot is the last of it.
  await clearPicks(page, GEAR_SLOT)
}

// ---- the Exaltations browser ---------------------------------------------------------------------

const PLANNER_TAB = '[data-testid="tab-planner"]'
const PLANNER_VIEW = '[data-testid="planner-view"]'
const PLANNER_SEARCH = '[data-testid="planner-search"] input'
const PLANNER_GROUPBY = '[data-testid="planner-groupby"]'
const PLANNER_SOCKET_WORN = '[data-testid="planner-socket-worn"]'
const PLANNER_SOCKET_PROC = '[data-testid="planner-socket-proc"]'
const PLANNER_ERA = '[data-testid="planner-era-toggle"]'
const PLANNER_NONEQUIP = '[data-testid="planner-nonequip-toggle"]'
const PLANNER_EFFECT_ROW = '[data-testid="planner-effect-row"]'
const PLANNER_DONOR_ROW = '[data-testid="planner-donor-row"]'

/** The Exaltations browser's form, as the screen states it. */
async function readBrowse(page: Page): Promise<Fingerprint> {
  return {
    search: await valueOf(page, PLANNER_SEARCH),
    socket: await page.evaluate(
      (s) => (document.querySelector(s)?.classList.contains('Mui-selected') === true ? 'worn' : 'other'),
      PLANNER_SOCKET_WORN
    ),
    groupBy: await textOf(page, PLANNER_GROUPBY),
    era: await chipLit(page, PLANNER_ERA),
    nonEquip: await chipLit(page, PLANNER_NONEQUIP),
    groups: String(await countOf(page, PLANNER_EFFECT_ROW)),
    donors: String(await countOf(page, PLANNER_DONOR_ROW))
  }
}

/**
 * THE EXALTATIONS BROWSER'S ROUND TRIP (JOS-329).
 *
 * The interesting field is `donors`: it is non-zero only while a group is EXPANDED, so it is how
 * "the expanded state came back" is asserted without naming a group id the corpus owns. The socket
 * tab and the search box cover both tiers on one bar — until this ticket the era, non-equippable
 * and group-by controls sitting beside them survived a tab switch and these did not, which is the
 * inconsistency the owner was reporting: one row of controls, two behaviours.
 */
/**
 * A SEARCH TERM THE CORPUS ACTUALLY ANSWERS, taken from a row that is on screen.
 *
 * Not a string typed into this file, and for the standing reason frozen numbers rot: the first
 * spelling of this step hardcoded `resist`, which matches nothing on the WORN tab, so the step
 * emptied the list, failed its own precondition and proved nothing about the search box. A word
 * lifted off a visible row cannot miss, whatever a rescrape does to the effect names.
 */
async function termFromScreen(page: Page): Promise<string> {
  const row = await textOf(page, PLANNER_EFFECT_ROW)
  return (/[A-Za-z]{4,}/.exec(row)?.[0] ?? 'a').toLowerCase()
}

export async function stepBrowseMemory(page: Page): Promise<void> {
  await page.click(PLANNER_SOCKET_WORN, { timeout: 15_000 })
  // A STATE, not a click — `stepNonEquip` ran before this and its parting state is its business.
  await setChip(page, PLANNER_NONEQUIP, 'on')
  // SETTLE BEFORE READING OR CLICKING, never merely "wait for one" — see `settleRows`. A deferred
  // fold is still replacing rows when the first one appears, and a click on a row that is about to
  // be swapped fails against a browser behaving perfectly.
  if ((await settleRows(page, PLANNER_EFFECT_ROW)) > 0) {
    const term = await termFromScreen(page)
    await page.fill(PLANNER_SEARCH, term, { timeout: 15_000 })
    const listed = (await settleRows(page, PLANNER_EFFECT_ROW)) > 0
    if (check('the browser has groups to expand before the memory step takes it away', listed, `searched "${term}"`)) {
      await page.click(PLANNER_EFFECT_ROW, { timeout: 15_000 })
      const expanded = await until(async () => (await countOf(page, PLANNER_DONOR_ROW)) > 0, 15_000)
      check('…and one of them is expanded, so the round trip has an expansion to restore', expanded)
      check('…with a search in the box that nothing defaults to', (await valueOf(page, PLANNER_SEARCH)) === term)

      await awayAndBack(page, {
        label: 'the Exaltations browser',
        tab: PLANNER_TAB,
        view: PLANNER_VIEW,
        read: readBrowse
      })
    }
  }

  // HAND THE TAB BACK ON EVERY PATH, including the ones that gave up above. This step is the only
  // one in the spec that moves the socket tab and types in the box, and the steps after it were
  // written against the proc tab with an empty search — an early return that skipped this left
  // `stepAddWish` looking for donor rows on a tab that had none, which turned one step's bad search
  // term into a spec-wide failure.
  await page.fill(PLANNER_SEARCH, '', { timeout: 15_000 })
  await setChip(page, PLANNER_NONEQUIP, 'off')
  await page.click(PLANNER_SOCKET_PROC, { timeout: 15_000 })
  await settleRows(page, PLANNER_EFFECT_ROW)
}

// ---- the Character tab's carry-all search ----------------------------------------------------------

const CHAR_TAB = '[data-testid="tab-character"]'
const CHAR_VIEW = '[data-testid="character-sheet"]'
const CARRY_SEARCH = '[data-testid="character-carry-search"]'
const CARRY_COUNT = '[data-testid="character-carry-count"]'
const CARRY_CHIP_ALL = '[data-testid="character-carry-chip-all"]'

async function readCarry(page: Page): Promise<Fingerprint> {
  return {
    search: await valueOf(page, CARRY_SEARCH),
    lane: await chipLit(page, CARRY_CHIP_ALL),
    count: await textOf(page, CARRY_COUNT)
  }
}

/**
 * THE CARRY-ALL BOX, which JOS-327's own header had already argued should behave exactly this way.
 *
 * That file said the query is not persisted because "a box that greeted you with last week's query
 * would be a worse surface" — true, and it was being paid for by the query also dying on every tab
 * switch, which nobody asked for. The session tier is what lets both halves of that sentence be
 * true at once, so the only assertion needed here is the round trip; the restart half is the tier
 * table's, pinned in `tests/areaMemory.test.mts`.
 */
export async function stepCarryMemory(page: Page, term: string): Promise<void> {
  await page.fill(CARRY_SEARCH, term, { timeout: 15_000 })
  await settleText(page, CARRY_COUNT)
  check(
    'the carry-all box is holding a query before the tab is taken away',
    (await valueOf(page, CARRY_SEARCH)) === term,
    `reads "${await valueOf(page, CARRY_SEARCH)}"`
  )

  await awayAndBack(page, { label: 'the Character tab', tab: CHAR_TAB, view: CHAR_VIEW, read: readCarry })

  await page.fill(CARRY_SEARCH, '', { timeout: 15_000 })
  await settleText(page, CARRY_COUNT)
}
