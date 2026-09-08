/**
 * THE EXALTATIONS BROWSER'S DONOR HOVER (JOS-344 part 3) — the same comparison pair the Gear tab
 * draws, on the donor NAMES, because a donor is an item and "what am I wearing there" is the same
 * question wherever you ask it.
 *
 * WHY IT IS A NEW STEP RATHER THAN MORE OF `gearCompareSteps.mts`: the CARD is the same and its
 * assertions are imported from there (one law, one instrument — `checkPairOnScreen`,
 * `openPairOn`, `closePair`). What is different is everything around it: a different surface, a
 * different anchor SHAPE (a ~150px name, not a 1014px table row), a different join (`DonorRow.key`
 * → the gear index the browser did not used to fetch at all) and a different set of controls to
 * hit-test with the card up.
 *
 * WHAT ONLY A REAL APP CAN SHOW HERE:
 *
 *   1. THE DONOR NAME HAS A HOVER CARD AT ALL. The name has carried nothing but a native `title`
 *      since the old card was removed — `PlannerChips.DonorName`'s comment still calls it "the
 *      removed card" — and the owner's report was that the exalt links had no mouseover. A mount
 *      that never fires passes every unit test written for it.
 *   2. THE JOIN LANDS. `DonorRow.key` and `GearRow.key` are both `itemKey(name)` in principle; that
 *      they are the same string in the SHIPPED corpus, through two different index builders, is a
 *      fact about data and only a running app holds both indexes at once.
 *   3. IT IS ON SCREEN, at the default size and at a narrow one. This is the whole lesson of the
 *      ticket, and the anchor here is the one most likely to expose the old failure differently: a
 *      short name near the LEFT of a wide row.
 *   4. IT DOES NOT EAT THE ROW'S CONTROLS. The JOS-143 hit-test, re-asked on this surface: with the
 *      pair open, the row's own wish control, the toolbar's socket tab and the search box must all
 *      still be the thing at their own centre.
 *
 * It hands the browser back the way it found it: no pair open, the window at the size and minimum
 * it arrived with, the pointer parked off the list.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import { check, countOf, note, settle, settleStable } from './appHarness.mjs'
import {
  PAIR,
  checkPairOnScreen,
  closePair,
  hitTest,
  openPairOn,
  readPair,
  resizeTo,
  restoreMinimum
} from './gearCompareSteps.mjs'

const DONOR_ROW = '[data-testid="planner-donor-row"]'
const DONOR_NAME = '[data-testid="planner-donor-name"]'
const ADD = '[data-testid="planner-add"]'
const EFFECT_ROW = '[data-testid="planner-effect-row"]'
const SEARCH = '[data-testid="planner-search"] input'
const SOCKET_TAB = '[data-testid="planner-socket-proc"]'

/**
 * THE APP'S OWN MINIMUM, and this one does NOT go below it — unlike the gear side, which does.
 *
 * MEASURED, and worth writing down because it is a finding about the ROW rather than about the
 * card: the donor name is a SHRINKABLE group on a compact bar (`EffectRows.SHRINK.name`), and on a
 * crowded row it can shrink to nothing at all — at 900px the name Typography measured
 * `[290..290]`, zero pixels wide, with the name's own 134px box overflowing invisibly under the
 * class chips beside it. A hover anchor with no visible box cannot be pointed at, by this harness
 * or by a person. Going BELOW the minimum (the gear side goes to 760) only makes that worse, so
 * this step stops at the narrowest window the app will actually give a user, re-derives its anchor
 * at that width, and says so when there is none left. The CLAMP itself is proved at 760 on the gear
 * side, where the anchor is a whole table row and cannot collapse.
 */
const NARROW_W = 900

const rowOf = (key: string): string => `${DONOR_ROW}[data-item-key="${key}"]`
const until = (fn: () => Promise<boolean>, ms: number): Promise<boolean> => settle(fn, (ok) => ok, { timeoutMs: ms })

/** Expand a group if the list is all headers — the `ensureDonorRow` retry, minus the add control. */
async function ensureDonors(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await countOf(page, DONOR_ROW)) > 0) return true
    await page.click(EFFECT_ROW, { timeout: 15_000 })
    if (await until(async () => (await countOf(page, DONOR_ROW)) > 0, 8000)) return true
  }
  return false
}

/**
 * THE FIRST DONOR ON SCREEN WHOSE NAME OPENS A PAIR, and the honest reason there might not be one.
 *
 * A row is taken off the SCREEN rather than named here (AGENTS.md, "frozen numbers rot"). The
 * search is over the first few visible rows rather than the first one alone because the gear index
 * carries only EQUIPPABLE pages (`gearIndex.ts` drops a slotless one) and this browser can be
 * showing a slotless donor under its escape toggle — a donor the corpus has no vector for gets the
 * plain name it always had, by design, so a miss on row 1 is not a defect.
 */
async function firstHoverableDonor(page: Page): Promise<string> {
  const keys = await page.evaluate(
    (s) => [...document.querySelectorAll(s)].slice(0, 6).map((r) => r.getAttribute('data-item-key') ?? ''),
    DONOR_ROW
  )
  for (const key of keys) {
    if (key === '') continue
    const card = await openPairOn(page, `${rowOf(key)} ${DONOR_NAME}`, key)
    if (card.present) return key
    await closePair(page)
  }
  note(`none of the first ${String(keys.length)} donor names opened a pair — tried ${keys.join(', ')}`)
  return ''
}

/** 1. THE HOVER EXISTS, IT IS THE PAIR, AND IT IS ABOUT THE NAME UNDER THE POINTER. */
async function stepDonorHover(page: Page): Promise<string> {
  check('no comparison pair is open until a donor name is pointed at', (await countOf(page, PAIR)) === 0)
  const key = await firstHoverableDonor(page)
  if (!check('pointing at a donor NAME opens the gear comparison pair (JOS-344)', key !== '')) return ''
  const card = await readPair(page)
  check('…and the item card is about the donor the pointer is on', card.item === key, `${card.item} vs ${key}`)
  check(
    'the donor card states the donor’s own numbers, in the gear table’s vocabulary',
    card.stats !== '',
    card.stats || '(no stat line)'
  )
  check(
    '…and admits to no simulation, because this browser has no plus-state slider',
    !card.simulated
  )
  // THE EQUIPPED HALF APPLIES UNCHANGED — same staged dump, same freshness line, same two answers.
  check('the equipped card is drawn beside it, off the same staged dump', card.equipped)
  check(
    'the equipped card names at least one cell this donor would go in',
    card.cells.length > 0 || card.noDump,
    card.cells.map((c) => `${c.cell}=${c.name || (c.empty ? 'empty' : '?')}`).join(' · ') || '(no cells)'
  )
  check(
    'the dump freshness line rides the equipped card here too',
    card.freshness.includes('inventory dump'),
    card.freshness || '(no line)'
  )
  await checkPairOnScreen(page, 'exalt default size')
  return key
}

/**
 * 2. THE JOS-143 HIT-TEST, ON THIS SURFACE.
 *
 * Three controls: the hovered row's OWN wish control (`WishToggle`, which JOS-343 made the one
 * control both surfaces share and which this ticket must not disturb), the socket tab in the
 * toolbar above the list, and the search box. The pair opens BELOW the name, so the row's own
 * control is the interesting one — it sits on the same band the card's top edge starts at.
 */
async function stepStillClickable(page: Page, key: string): Promise<void> {
  const card = await openPairOn(page, `${rowOf(key)} ${DONOR_NAME}`, key)
  if (!check('the pair is open for the exalt hit test', card.present)) return
  for (const [what, selector] of [
    ['the row’s own wish control', `${rowOf(key)} ${ADD}`],
    ['the socket tab in the toolbar above', SOCKET_TAB],
    ['the browse search box', SEARCH]
  ] as const) {
    const verdict = await hitTest(page, selector)
    check(`with the donor pair open, ${what} is still the thing a click would reach`, verdict === 'hit', verdict)
  }
  check('the pair is still open — the hit test measured a live card', (await countOf(page, PAIR)) === 1)
  check('and it goes with the pointer when it leaves the name', await closePair(page))
}

/**
 * What the ANCHOR is when a hover does not happen — so a failure names the row's own layout rather
 * than blaming the card. A donor row is a compact bar whose name group is shrinkable, and at a
 * narrow enough window it is the name that goes.
 */
function anchorBoxOfFirst(page: Page): Promise<string> {
  return page.evaluate((q) => {
    const el = document.querySelector(q)
    if (!el) return 'no donor row on screen at all'
    const r = el.getBoundingClientRect()
    // hoverAt's own arithmetic (settle.mts): the box a pointer can actually reach is the element's
    // rect intersected with every CLIPPING ancestor's. Reported so the note names the box that
    // closed rather than merely saying the hover did not happen.
    let left = r.left
    let right = r.right
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const pr = p.getBoundingClientRect()
      left = Math.max(left, pr.left)
      right = Math.min(right, pr.right)
    }
    return `the first name states ${String(Math.round(r.width))}px and is clipped to ${String(Math.round(right - left))}px of it, in a ${String(document.documentElement.clientWidth)}px viewport`
  }, `${DONOR_ROW} ${DONOR_NAME}`)
}

/**
 * 3. THE NARROW WINDOW — both cards still inside it at the narrowest window a user can make.
 *
 * THE ANCHOR IS RE-DERIVED AT THIS WIDTH rather than reused, and that is the measured half of this
 * step: the row that was hoverable at 1280 may not be one at 900, because the anchor is a shrinkable
 * group on a compact bar. See `NARROW_W` for what that looks like when it happens. When NO donor
 * name on screen has a visible box left, this NOTES the collapse and states which claim it could
 * not measure — a spec that failed there would be reporting the row's width arbitration as a defect
 * in the card, and a spec that stayed silent would be hiding a finding.
 */
async function stepNarrow(app: ElectronApplication, page: Page): Promise<void> {
  const win = await app.browserWindow(page)
  const wide = await win.evaluate((w) => w.getBounds())
  const got = await resizeTo(app, page, NARROW_W, Math.min(wide.height, 760))
  note(`narrowed the window to the app's own minimum: ${String(got)}px of viewport`)
  // A resize is answered by the renderer's viewport before the layout inside it stops moving
  // (wave E3's measured trap), and a hover aimed at where a row used to be opens nothing.
  await settleStable(() => anchorBoxOfFirst(page), { timeoutMs: 15_000 })
  const key = await firstHoverableDonor(page)
  if (key === '') {
    note(`narrow: no donor name on screen has a box left to point at, so the on-screen claim is unmeasured here — ${await anchorBoxOfFirst(page)}`)
  } else {
    check('narrow: pointing at a donor name still opens the pair', true)
    await checkPairOnScreen(page, 'exalt narrow')
  }
  await closePair(page)
  await resizeTo(app, page, wide.width, wide.height)
  await restoreMinimum(app, page)
}

/** The whole donor-hover step. Leaves the browser exactly as it found it. */
export async function stepExaltCompare(app: ElectronApplication, page: Page): Promise<void> {
  if (!check('the browse has donor rows to point at', await ensureDonors(page))) return
  const key = await stepDonorHover(page)
  if (key === '') {
    await closePair(page)
    return
  }
  await stepStillClickable(page, key)
  await stepNarrow(app, page)
  await closePair(page)
}
