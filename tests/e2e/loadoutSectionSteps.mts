/**
 * JOS-239: A LOADOUT HEADER EITHER NAMES A TRIO OR SAYS WHY IT WILL NOT.
 *
 * Its own file for the reason `buffRestartSteps.mts` has one: bosses-week.e2e.mts is at the
 * measured 400-code-line ceiling, and this is a step about a DIFFERENT grouping than the week view
 * that spec is named for.
 *
 * THE DEFECT. The owner's roster showed Lord Nagafen defeated at D4 under a crisp `ENC / WIZ / MNK`
 * header. His wizard was level 25 and had never entered that zone. The interval behind it already
 * carried `overDetermined` and a level range one loadout cannot produce, and the sectioning printed
 * the ranking's top three anyway.
 *
 * WHY THIS BELONGS IN AN E2E AND NOT ONLY IN tests/loadoutSections.test.mts. The pure layer is
 * pinned there against hand-built intervals; what could not be checked anywhere was that the branch
 * MOUNTS AT ALL — `LoadoutSections` sits behind a toolbar switch nothing in this suite had ever
 * flipped, so the whole by-loadout view had zero app-level coverage and a render error in it would
 * have reached the owner exactly the way the wrong trio did.
 *
 * CLOCK-INDEPENDENT, like the rest of that spec. It never asserts that a gated section EXISTS —
 * which loadouts the owner has been running is a fact about his play and would rot on the next
 * `/who`. The claim is a PROPERTY of whatever is on screen: every header is exactly one of the three
 * sentences, and a header that declines to name a loadout draws no class chip. False under the old
 * code on any log holding an over-determined span, true on every log without one.
 */
import type { Page } from 'playwright-core'
import { check, countOf, note, settle, settleStable, waitHydrated } from './appHarness.mjs'

/** The grouping switch (JOS-239 added the testid — nothing had ever driven this branch). */
const BY_LOADOUT = '[data-testid="boss-by-loadout"]'
/** One section header, carrying which of the three sentences it is in `data-loadout`. */
const HEADER = '[data-testid="boss-loadout-header"]'
/** Spelled again rather than imported: this file must not make bosses-week export its constants. */
const CARD = '[data-testid="boss-card"]'

/** One loadout section header: which sentence it is, and what it drew. */
interface HeaderFact {
  kind: string
  /** class chips on it — the thing a gated header must not have */
  chips: number
  text: string
}

/** Every loadout header on screen, plus the cards under them, read in ONE paint. */
function loadoutView(page: Page): Promise<{ headers: HeaderFact[]; cards: number }> {
  return page.evaluate(
    (sel) => ({
      headers: [...document.querySelectorAll(sel.header)].map((h) => ({
        kind: h.getAttribute('data-loadout') ?? '',
        chips: h.querySelectorAll('.MuiChip-root').length,
        text: (h.textContent ?? '').trim()
      })),
      cards: document.querySelectorAll(sel.card).length
    }),
    { header: HEADER, card: CARD }
  )
}

/** Whether the by-loadout switch is on. `null` when the control is not mounted. */
function byLoadoutOn(page: Page): Promise<boolean | null> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    const input = root instanceof HTMLInputElement ? root : (root?.querySelector('input') ?? null)
    return input instanceof HTMLInputElement ? input.checked : null
  }, BY_LOADOUT)
}

/** Flip the grouping and wait for the control itself to report the new state. */
async function setByLoadout(page: Page, on: boolean): Promise<boolean> {
  if ((await byLoadoutOn(page)) === on) return true
  await page.click(BY_LOADOUT, { timeout: 15_000 })
  return (await settle(() => byLoadoutOn(page), (v) => v === on, { timeoutMs: 8_000 })) === on
}

export async function stepLoadoutSectionsAreHonest(page: Page): Promise<void> {
  await waitHydrated(page)
  if (!check('the by-loadout switch is on the toolbar', (await byLoadoutOn(page)) === false)) return
  if (!(await setByLoadout(page, true))) {
    check('the roster regroups by class loadout', false)
    return
  }
  const view = await settleStable(() => loadoutView(page), { timeoutMs: 20_000 })
  check(
    'THE BY-LOADOUT VIEW MOUNTS - it had never been driven before this',
    view.headers.length > 0,
    `${String(view.headers.length)} headers`
  )
  check(
    'every header is one of the three sentences and nothing else',
    view.headers.every((h) => h.kind === 'named' || h.kind === 'mixed' || h.kind === 'unknown'),
    view.headers.map((h) => h.kind).join(',')
  )
  const mixed = view.headers.filter((h) => h.kind === 'mixed')
  check(
    'A HEADER THAT CANNOT NAME THE LOADOUT NAMES NO CLASSES',
    mixed.every((h) => h.chips === 0 && h.text.includes('Mixed loadouts')),
    mixed.map((h) => `${String(h.chips)} chips: ${h.text}`).join(' | ')
  )
  check(
    '…and a header that DOES name one still draws its chips',
    view.headers.filter((h) => h.kind === 'named').every((h) => h.chips > 0)
  )
  if (mixed.length === 0) {
    note(
      'bosses-week: nothing on this log is currently gated, so the unresolved header is structurally covered only'
    )
  }
  check('the cards are still under the headers, not dropped', view.cards > 0, String(view.cards))

  // …and the switch is a DISPLAY choice: the progression grouping comes back untouched.
  if (!(await setByLoadout(page, false))) return
  const back = await settle(() => countOf(page, HEADER), (n) => n === 0, { timeoutMs: 15_000 })
  check('…and turning it off gives the progression categories back', back === 0, String(back))
}
