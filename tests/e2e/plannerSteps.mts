// STEPS AND SELECTORS OF THE EXALTATIONS SPEC that live next door, because planner.e2e.mts sits
// AT the repo max-lines budget and the rule here is to SPLIT, never ratchet (drill.mts set the
// precedent, combatSteps.mts followed it). The spec still owns the ORDER and the launch.
//
// WHAT LIVES HERE, and why it is a coherent half rather than an overflow bin:
//   * every `planner-*` SELECTOR, so one file names the DOM and the two halves cannot drift into
//     two spellings of the same testid, and
//   * the steps that measure THE EFFECT LIST — the era filter, the non-equippable escape hatch,
//     the focus-family fold, JOS-42's readability and JOS-210's item narrowing — which are all the
//     same measurement (how tall is the list, what is on its rows) asked five ways, plus the DOM
//     helpers that measurement needs.
//
// WHAT JOS-326 TOOK OUT OF THIS FILE, and it is a lot: the Exaltations tab is SEARCH-ONLY now. The
// set switcher, the three-mode toggle, the Inventory board (its cells, its host picker, its
// `/outputfile` freshness line and its socket preset) and the Farm rollup are gone from the
// product, so their selectors and their steps are gone from here. A removal removes its claims —
// `checkReportedPairs`, `stepSocketEffect`, `checkReplaceLabels` and `stepOutputsRegistry` were
// assertions ABOUT those surfaces and there is nothing left for them to be true of. Two notes on
// what that did and did not cost:
//   * The BOARD's own claims (both ring cells, both any-cells, a planned socket's hover line) were
//     about a UI this ticket deleted. The MODEL under them — `PLAN_SLOTS` and its twenty-three
//     cells — is still pinned by tests/plannerInventory.test.mts, which never needed the app.
//   * `stepOutputsRegistry` asserted the `/outputfile` registry over IPC and the capture steps the
//     freshness line teaches. The registry half is still asserted by
//     tests/e2e/sky-inventory-autoload.e2e.mts over the same channel; the CAPTURE STEPS half — the
//     Hoard-before-the-command order — is not asserted anywhere else yet, and that is a real gap
//     rather than a claim the removal invalidated. `OutputFileLine` still ships and the Sky, Gear
//     and Character tabs still render it, so the assertion wants re-homing on one of those specs.

import type { Page } from 'playwright-core'
import { check, countOf, note, settle } from './appHarness.mjs'

/**
 * HOW THIS SPEC ENTERS, since JOS-324 collapsed four nav rows into one.
 *
 * There is no `nav-planner` row any more. Exaltations is the SECOND TAB of the gear area, which
 * hangs off the single `nav-gear` row, so the entry is two clicks: the row, then the tab. Both
 * handles are exported because the spec asserts things about each — the row's label and its
 * selected state, the tab's label and the pane it mounts.
 */
export const NAV = '[data-testid="nav-gear"]'
export const TAB = '[data-testid="tab-planner"]'
export const VIEW = '[data-testid="planner-view"]'
export const EFFECT_LIST = '[data-testid="planner-effect-list"]'
export const ERA_TOGGLE = '[data-testid="planner-era-toggle"]'
/**
 * The wish control on a donor row. Since JOS-326 it writes a WISH, not a socket; since JOS-343 it
 * TOGGLES, which is why this selector had to grow a second exclusion.
 *
 * `:not([data-wished])` IS NOT COSMETIC. Until JOS-343 an already-wished donor's button was
 * DISABLED, so `:not([disabled])` alone meant "a control that would ADD something". A toggle is
 * enabled in both states, and the seed puts wishes on the list before this spec's first click — so
 * without the second exclusion the add step could pick a wished row and REMOVE instead. What this
 * names is the unadded control; `ADD_WISHED` names the other state, and `ANY_ADD` names both.
 */
export const ADD_BUTTON = '[data-testid="planner-add"]:not([disabled]):not([data-wished])'
/** Either state, for the "is a donor row on screen at all" question. */
export const ANY_ADD = '[data-testid="planner-add"]'
/** A donor already on the wish list — the control reads REMOVE and the row wears the chip. */
export const ADD_WISHED = '[data-testid="planner-add"][data-wished="true"]'
export const WISHED_CHIP = '[data-testid="planner-wished-chip"]'
/** The REMOVE half of the toggle, on the row that is wearing the wished chip (JOS-343). */
export const ADD_ON_WISHED_ROW =
  '[data-testid="planner-donor-row"]:has([data-testid="planner-wished-chip"]) [data-testid="planner-add"]'
export const CLASS_FILTER = '[data-testid="planner-classes"]'

/** JOS-210's item narrowing — the filter bar's own picker, and the chip that names what it found. */
export const ITEM_FILTER = '[data-testid="planner-item-filter"]'
export const ITEM_CHIP = '[data-testid="planner-item-chip"]'
export const ITEM_SEARCH = '[data-testid="planner-item-search"] input'
export const ITEM_HIT = '[data-testid="planner-item-hit"]'

export const EFFECTS_EMPTY = '[data-testid="planner-effects-empty"]'
export const EXPLAINER = '[data-testid="planner-explainer"]'
export const EXPLAINER_OPEN = '[data-testid="planner-explainer-open"]'
export const NONEQUIP_TOGGLE = '[data-testid="planner-nonequip-toggle"]'
export const NOSLOT_CHIP = '[data-testid="planner-noslot-chip"]'
export const DONOR_NAME = '[data-testid="planner-donor-name"]'

/**
 * THE SELECTORS THAT WENT WITH THE PLAN BOARD (JOS-326), listed once so a reader of this file's
 * history does not have to guess which testids were retired rather than renamed:
 * `planner-new-set-empty`, `planner-set-chip`, `planner-mode-*`, `planner-board`,
 * `planner-board-cell`, `planner-socket-line`, `planner-socket-open`, `planner-socket-browse`,
 * `planner-socket-effect`, `planner-preset-chip`, `planner-host-*`, `planner-inventory-*`,
 * `planner-farm-*`, `planner-slot-choice`. None of them is rendered by any build after this
 * ticket.
 */

export const EFFECT_ROW = '[data-testid="planner-effect-row"]'
export const FAMILY_ROW = '[data-testid="planner-effect-row"][data-axis="family"]'
export const GROUPBY = '[data-testid="planner-groupby"]'
export const SOCKET_FOCUS = '[data-testid="planner-socket-focus"]'
export const SOCKET_PROC = '[data-testid="planner-socket-proc"]'
export const BEST_CHIP = '[data-testid="planner-best-chip"]'
export const DONOR_ROW = '[data-testid="planner-donor-row"]'
export const EFFECT_SAYS = '[data-testid="planner-effect-says"]'
export const GROUP_SAYS = '[data-testid="planner-group-says"]'
export const DONOR_EFFECT = '[data-testid="planner-donor-effect"]'

// ---- DOM measurements ------------------------------------------------------------------

/** Rendered text of the first match; '' when the node isn't mounted. */
export function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

/** Box + scroll geometry — enough to prove a growing list is a BOUNDED scroller. */
export function boxOf(
  page: Page,
  sel: string
): Promise<{ h: number; scrollH: number; clientH: number } | null> {
  return page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    return { h: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, clientH: el.clientHeight }
  }, sel)
}

/**
 * How many matching nodes are ELLIPSIZED — `scrollWidth` past `clientWidth` on a `noWrap` line.
 *
 * The measurement JOS-42 turns on: the owner's screenshot showed "Burning Af…" and "String
 * Resonan…" on every donor of a focus family, and the fix is a layout one (the row stopped
 * repeating the family's one-liner, and the source text now shrinks ~99% before the effect name
 * gives up a pixel). Only a browser can say whether text fits, so only the e2e can assert it.
 * The 1px slack is sub-pixel rounding, not tolerance for a truncated word.
 */
export function truncated(page: Page, sel: string): Promise<{ total: number; clipped: string[] }> {
  return page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s))
    return {
      total: els.length,
      clipped: els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => (e as HTMLElement).innerText)
    }
  }, sel)
}

/** Poll a predicate until it holds or the deadline passes. */
export function until(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  return settle(fn, (ok) => ok, { timeoutMs: ms })
}

/**
 * The effect list's SCROLL HEIGHT — the total row count, in pixels.
 *
 * Not a count of rows in the DOM: the list is windowed, so the number of mounted rows says how
 * tall the viewport is, not how many rows exist. And it POLLS for the element, because the view
 * legitimately remounts while the app is still reading the log (App keys the view on the
 * character), and a measurement taken inside that gap would read as "the list vanished".
 */
export async function listHeight(page: Page): Promise<number> {
  let last = 0
  await until(async () => {
    last = (await boxOf(page, EFFECT_LIST))?.scrollH ?? 0
    return last > 0
  }, 20_000)
  return last
}

/** Poll until the list's height settles at something other than `was` (or give up and report). */
async function heightAfterToggle(page: Page, was: number): Promise<number> {
  let now = was
  await until(async () => {
    now = await listHeight(page)
    return now !== was
  }, 15_000)
  return now
}

// ---- the steps that measure the effect list ----------------------------------------------

/**
 * 4. THE ERA FILTER IS ON BY DEFAULT, AND TURNING IT OFF REVEALS MORE.
 *
 * This is an identity, not a number: the committed corpus documents every expansion, so a filter
 * that is genuinely hiding out-of-era donors must have a SHORTER list than the same filter off,
 * and switching it back must land on exactly the height it started at.
 */
export async function stepEra(page: Page): Promise<void> {
  if (!check('the effect browser offers the current-era filter', (await countOf(page, ERA_TOGGLE)) > 0)) return
  const filtered = await listHeight(page)

  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const unfiltered = await heightAfterToggle(page, filtered)
  check(
    'the era filter is ON by default and hides out-of-era donors (turning it off can only reveal more)',
    unfiltered > filtered,
    `list ${String(filtered)}px filtered → ${String(unfiltered)}px unfiltered`
  )

  // Put it back: the rest of the run should see the default surface.
  await page.click(ERA_TOGGLE, { timeout: 15_000 })
  const again = await heightAfterToggle(page, unfiltered)
  check('…and switching it back on restores exactly the filtered list', again === filtered, `${String(again)}px`)
}

/**
 * 4b. THE NON-EQUIPPABLE FILTER IS OFF BY DEFAULT, AND TURNING IT ON REVEALS MORE.
 *
 * The mirror image of the era check, and an identity for the same reason: R2 only lets an
 * exaltation move between items sharing an equipment slot, so the 284 slotless donor rows in the
 * committed corpus (the potion aisle, plus poisons on the Proc tab) can never legally donate and
 * are hidden by default. Switching the escape hatch on can therefore only ADD rows — and each one
 * it adds must carry the `no slot` chip that says why it was hidden.
 */
export async function stepNonEquip(page: Page): Promise<void> {
  if (!check('the effect browser offers the non-equippable escape toggle', (await countOf(page, NONEQUIP_TOGGLE)) > 0)) {
    return
  }
  const hidden = await listHeight(page)
  check('slotless donors are hidden by default, so no row claims "no slot"', (await countOf(page, NOSLOT_CHIP)) === 0)

  await page.click(NONEQUIP_TOGGLE, { timeout: 15_000 })
  const shown = await heightAfterToggle(page, hidden)
  check(
    'turning non-equippable ON can only reveal more donors (R2 hides them, it never invents them)',
    shown > hidden,
    `list ${String(hidden)}px equippable-only → ${String(shown)}px with consumables`
  )

  await page.click(NONEQUIP_TOGGLE, { timeout: 15_000 })
  const again = await heightAfterToggle(page, shown)
  check('…and switching it back off restores exactly the equippable list', again === hidden, `${String(again)}px`)
}

/**
 * 4c-ii. A FAMILY'S ROWS ARE READABLE — the effect NAME always fits (JOS-42 refinement 2).
 *
 * Two halves of one fix, and both are identities rather than numbers.
 *
 * NO ROW REPEATS ITS OWN HEADER'S LINE. Note the scope: not "headers have lines XOR rows do",
 * which is a different (and false) claim — the list is windowed, so a dozen COLLAPSED family
 * headers are on screen carrying lines of their own, and one open family may legitimately hold a
 * rank that says something the header could not (Percussion Resonance is the corpus's one such
 * family, carrying two different durations). The contract is the DUPLICATION, so the walk pairs
 * each donor row with the header above it and asks only about that pair.
 *
 * AND NO EFFECT NAME IS ELLIPSIZED. "Improved Healing III" is not "Improved Healing I", and a row
 * that truncates it is a row you cannot read.
 */
async function stepFamilyReadability(page: Page): Promise<void> {
  const dupes = await page.evaluate(() => {
    const out: string[] = []
    let header = ''
    for (const row of document.querySelectorAll(
      '[data-testid="planner-effect-row"],[data-testid="planner-donor-row"]'
    )) {
      if (row.getAttribute('data-testid') === 'planner-effect-row') {
        header = row.querySelector('[data-testid="planner-group-says"]')?.textContent?.trim() ?? ''
        continue
      }
      const says = row.querySelector('[data-testid="planner-effect-says"]')?.textContent?.trim() ?? ''
      if (says !== '' && says === header) out.push(says)
    }
    return out
  })
  check(
    'no donor row repeats the one-liner its own family header already states',
    dupes.length === 0,
    dupes.length > 0 ? `${String(dupes.length)} rows repeated "${dupes[0]}"` : 'nothing duplicated'
  )
  const names = await truncated(page, DONOR_EFFECT)
  check(
    'every effect name under a family header renders whole (it outranks the source text now)',
    names.total > 0 && names.clipped.length === 0,
    names.clipped.length > 0
      ? `${String(names.clipped.length)} of ${String(names.total)} clipped — e.g. "${names.clipped[0]}"`
      : `${String(names.total)} names, none clipped`
  )
}

/**
 * 4c. THE FOCUS TAB OPENS ON FAMILIES, AND THE BEST OF EACH IS CROWNED (V4 + V5).
 *
 * Two facts in one trip. The GROUPING is a per-socket default, not a global one: Proc opens on
 * effects (the browser's original fold) and Focus opens on families, because "the best Improved
 * Healing I can reach" is the question that tab exists to answer. And the CROWN is derived from
 * what survived the filters, so it can be asserted as an identity — every family header has at
 * least one donor, therefore expanding one must produce at least one crowned row.
 *
 * Skipped, with a note, when the class filter leaves the Focus tab empty: focus effects are caster
 * gear, and a melee trio filtering the tab down to nothing is a correct answer, not a failure.
 * Ends back on the Proc tab so every step after it sees the surface it expects.
 */
export async function stepFocusFamilies(page: Page): Promise<void> {
  if (!check('the effect browser offers a group-by control', (await countOf(page, GROUPBY)) > 0)) return
  await page.click(SOCKET_FOCUS, { timeout: 15_000 })
  const grouped = await until(async () => (await countOf(page, FAMILY_ROW)) > 0, 20_000)
  if (grouped) {
    check(
      'the Focus tab groups by focus family without being asked (the per-socket default)',
      (await textOf(page, GROUPBY)).includes('Focus family'),
      `${String(await countOf(page, FAMILY_ROW))} family headers`
    )
    await page.click(FAMILY_ROW, { timeout: 15_000 })
    check(
      'expanding a family crowns the best tier it can currently see',
      await until(async () => (await countOf(page, BEST_CHIP)) > 0, 10_000)
    )
    await stepFamilyReadability(page)
  } else {
    note('no focus donor survives the class filter — the family grouping step is skipped this run')
  }
  await page.click(SOCKET_PROC, { timeout: 15_000 })
  await until(async () => (await countOf(page, `${EFFECT_ROW}[data-axis="effect"]`)) > 0, 20_000)
}

// ---- the item narrowing (JOS-210) --------------------------------------------------------

const kindTab = (kind: string): string => `[data-testid="planner-socket-${kind}"]`

/**
 * ANY WORN ITEM FINDS ITS COMPATIBLE EFFECTS, AND THE NARROWING SURVIVES A KIND SWITCH (JOS-210).
 *
 * BOTH HALVES OF THAT TICKET NOW LIVE IN ONE STEP, because JOS-326 removed the other door. The
 * feature half was always this one: type a name into the filter bar's own picker, which reaches
 * every item the committed DB carries. The bug half was asserted through the Inventory tab's
 * socket preset — narrow from a cell, switch Proc → Worn, watch the item vanish — and that surface
 * is gone, so the same claim is asserted about the picked item instead. It is the SAME claim: one
 * shared change handler used to clear the narrowing on every filter-bar write, kind tabs included.
 *
 * Three things make it a filter rather than a search box, and all three are identities:
 *   * it NARROWS (a filter can only remove rows, so the list is never taller than it was),
 *   * it SURVIVES the kind tabs, and
 *   * clearing it gives the whole corpus back — the height it started at, to the pixel.
 *
 * MEASURED FROM A FRESH MOUNT, which is why the spec re-enters the tab before calling this: the
 * scroll box floors its own scrollHeight at its clientHeight, so a list that is already short
 * would answer the same number before and after and prove nothing.
 *
 * "sword" is a query the committed corpus certainly answers; if it somehow does not, the step says
 * so and stops rather than inventing a second guess. Ends with the filter cleared.
 */
export async function stepItemFilter(page: Page): Promise<void> {
  if (!check('the filter bar offers to narrow the list by an item', (await countOf(page, ITEM_FILTER)) > 0)) return
  const before = await listHeight(page)
  await page.click(ITEM_FILTER, { timeout: 15_000 })
  if (!check('…and it opens a search over the whole item database', await until(async () => (await countOf(page, ITEM_SEARCH)) > 0, 10_000))) {
    return
  }
  await page.fill(ITEM_SEARCH, 'sword', { timeout: 15_000 })
  await until(async () => (await countOf(page, ITEM_HIT)) > 0, 10_000)
  if ((await countOf(page, ITEM_HIT)) === 0) {
    note('the item index answered nothing for "sword" — the item-filter step is skipped this run')
    await page.keyboard.press('Escape')
    return
  }
  await page.click(ITEM_HIT, { timeout: 15_000 })
  if (!check('picking an item narrows the browser to it', await until(async () => (await countOf(page, ITEM_CHIP)) > 0, 10_000))) {
    return
  }
  // The chip is the app's own word for which item is being filled — read the name from there
  // rather than from the hit row, whose text also carries the slot chip beside it.
  const name = (await textOf(page, ITEM_CHIP)).replace(/\s+/g, ' ').trim()
  const narrowed = await listHeight(page)
  check(
    'the item filter can only REMOVE rows — it never invents an effect for an item',
    narrowed <= before,
    `list ${String(before)}px → ${String(narrowed)}px for "${name}"`
  )
  // …and it removes SOME: one item shares a slot with a slice of the corpus, never all of it. When
  // that slice is empty the list says so NAMING THE ITEM, which is the same claim by other means.
  const empty = (await textOf(page, EFFECTS_EMPTY)).replace(/\s+/g, ' ').trim()
  check(
    'narrowing to one item actually narrows — and an empty answer names the item, not the filters',
    narrowed < before || empty.includes(name),
    narrowed < before ? `${String(before)}px → ${String(narrowed)}px` : `empty state reads "${empty}"`
  )

  for (const kind of ['worn', 'click', 'proc'] as const) {
    await page.click(kindTab(kind), { timeout: 15_000 })
    const kept = await until(async () => (await countOf(page, ITEM_CHIP)) > 0, 10_000)
    if (!check(`the item filter survives the ${kind} tab (JOS-210)`, kept)) return
    const label = (await textOf(page, ITEM_CHIP)).replace(/\s+/g, ' ').trim()
    check(`…still naming the same item after the ${kind} tab`, label === name, `chip reads "${label}" vs "${name}"`)
  }

  await page.click(`${ITEM_CHIP} .MuiChip-deleteIcon`, { timeout: 15_000 })
  const cleared = await until(async () => (await countOf(page, ITEM_CHIP)) === 0, 10_000)
  check('clearing the item filter hands the browser back', cleared)
  const restored = await until(async () => (await listHeight(page)) === before, 15_000)
  check('…with the whole corpus in it again', restored, `${String(await listHeight(page))}px vs ${String(before)}px`)
}

/**
 * THE PLAN BOARD IS GONE, AND ITS DOOR IS GONE WITH IT (JOS-326).
 *
 * A removal is only complete when nothing left on screen offers the thing that was removed, and
 * that is not something a unit test can see: `PlanBoard.tsx` being deleted proves the file is
 * gone, not that the toolbar stopped rendering a mode toggle beside a set switcher. So this is an
 * ABSENCE, asserted the settle way — wait for the toolbar's reading to STOP CHANGING (the pane
 * legitimately remounts while the app is still reading the log) and only then count. Never a sleep.
 *
 * The class filter is counted in the SAME settled reading, deliberately: "the toggle is gone" and
 * "the filter is still here" are one claim about one toolbar, and asserting them apart would let a
 * broken pane satisfy the first by rendering nothing at all.
 */
export async function stepSearchOnly(page: Page): Promise<void> {
  const seen = await settle(
    async () => ({
      sets: await countOf(page, '[data-testid="planner-set-chip"]'),
      modes: await countOf(page, '[data-testid^="planner-mode-"]'),
      board: await countOf(page, '[data-testid="planner-board"]'),
      farm: await countOf(page, '[data-testid="planner-farm-list"]'),
      classes: await countOf(page, CLASS_FILTER),
      list: await countOf(page, EFFECT_LIST)
    }),
    (r) => r.list > 0,
    { timeoutMs: 20_000 }
  )
  check(
    'the Exaltations tab is search-only — no set switcher, no mode toggle, no board, no farm rollup',
    seen.sets === 0 && seen.modes === 0 && seen.board === 0 && seen.farm === 0,
    `${String(seen.sets)} set chips · ${String(seen.modes)} mode buttons · ${String(seen.board)} boards · ${String(seen.farm)} rollups`
  )
  check(
    '…and the browse it exists for is all still there: the class filter over the effect list',
    seen.classes > 0 && seen.list > 0,
    `${String(seen.classes)} class filters · ${String(seen.list)} effect lists`
  )
}
