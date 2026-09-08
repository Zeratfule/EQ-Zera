/**
 * toastDeepLinkSteps.mts — WHERE A CELEBRATION CARD'S CLICK ACTUALLY PUTS YOU.
 *
 * Split out of tests/e2e/toast.e2e.mts, which JOS-330 pushed past the repo's 400-code-line
 * factoring ceiling — the answer to that is a split, not a widened threshold (appWindow.mts's
 * precedent, and levelingLayoutSteps.mts's). This is a coherent piece to lift: everything about
 * the two DEEP LINKS a toast can carry, plus the geometry instruments those claims need. The
 * spec keeps what a toast IS — the window, the queue, the card, the refusals.
 *
 * Read toast.e2e.mts's header first; it carries the frame these steps run inside (no window is
 * ever shown, the overlay has no pointer, `el.click()` is a real DOM click).
 *
 * WHAT CHANGED IN JOS-334. The level-up card grew a visible call to action, so the roundtrip
 * clicks THE BUTTON a reader would aim at rather than the invisible card-wide target — and then
 * clicks the card body too, because the ticket's whole claim is that the two are one link.
 *
 * WHAT CHANGED IN JOS-330. The roundtrip step used to stop at "the Leveling tab is mounted with
 * the panel set to 24", which was true the entire time the reader was looking at the top of a
 * screen of charts with the panel a screen and a half below the fold (the tab is one tall page
 * since JOS-289 and the panel is the bottom of its left column since JOS-300). These steps now
 * assert the ARRIVAL: the panel is fully inside the content area's visible box, and it says so
 * itself through `data-highlighted` — the cue as a data attribute rather than a computed colour,
 * so the claim survives any restyle of the pulse.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import { check, countOf, note, settle, settleStable } from './appHarness.mjs'

/** The level a synthetic ding celebrates, and the level its click must anchor the panel at. */
export const DING_LEVEL = 24

/** The app's ONE scroller (JOS-289) — the box a landing has to put the panel inside. */
const CONTENT = '[data-testid="app-content"]'

/** The panel the level-up link is FOR: the bottom of the Leveling tab's left column since JOS-300. */
const PANEL = '[data-testid="new-at-level"]'

/**
 * Is `sel` fully inside the content area's visible box right now?
 *
 * A LOCAL COPY of the helper in tests/e2e/levelingLayoutSteps.mts, deliberately. That module is
 * the LAYOUT spec's step list; this is the toast spec, and importing one spec's steps into another
 * to borrow twelve lines of geometry couples two suites that otherwise have no reason to know each
 * other exists. The one ADDITION is the over-tall verdict: the layout spec asks whether the page
 * can REACH this panel, while this one asks whether a deep link LANDED on it — and a panel taller
 * than the window cannot be fully in frame however correct the landing was, which is a fact about
 * the fixture's loadout rather than a regression.
 */
function fullyInContent(page: Page, sel: string): Promise<string> {
  return page.evaluate(
    (a) => {
      const el = document.querySelector(a.sel)
      const box = document.querySelector(a.content)
      if (!el || !box) return 'absent'
      const r = el.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      if (r.height < 1) return 'collapsed to nothing'
      if (r.height > b.height) return 'taller than the content viewport'
      if (r.bottom > b.bottom + 2) return `${String(Math.round(r.bottom - b.bottom))}px below the fold`
      if (r.top < b.top - 2) return `${String(Math.round(b.top - r.top))}px above the fold`
      return 'in view'
    },
    { sel, content: CONTENT }
  )
}

/** The panel's own account of whether it is lit — the CUE as a data attribute, never a colour. */
function panelHighlight(page: Page): Promise<string> {
  return page.evaluate(
    (s) => document.querySelector(s)?.getAttribute('data-highlighted') ?? 'absent',
    PANEL
  )
}

/** The content scroller's own two numbers: how tall it IS, and how tall its content is. */
function contentBox(page: Page): Promise<{ client: number; height: number }> {
  return page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null
    return el
      ? { client: Math.round(el.clientHeight), height: Math.round(el.scrollHeight) }
      : { client: -1, height: -1 }
  }, CONTENT)
}

/** The panel's rendered height, which is what decides whether a squeezed window can still hold it. */
function panelHeight(page: Page): Promise<number> {
  return page.evaluate(
    (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().height ?? -1),
    PANEL
  )
}

/**
 * Set the window's HEIGHT and wait for the renderer to agree.
 *
 * The waiting is levelingLayoutSteps' lesson, and it is the whole reason this is a function: a
 * resize crosses Electron, the OS, Chromium's layout and React, and a geometry read taken too
 * early settles on the OLD number as confidently as on the new one. So the condition is the
 * content box holding still, not the bounds call returning.
 *
 * The app's own 900x600 minimum is lowered while this is in force and PUT BACK by the restore
 * function, so this spec cannot leak a short window into whatever runs after it. It is lowered
 * FURTHER than levelingLayoutSteps' 360 — this rig has to get UNDER the height of a tab that is
 * only a few hundred pixels tall on this fixture, and the claim being measured (a link scrolls the
 * page to the panel) is indifferent to the viewport it is measured in. Nothing here is a statement
 * about how the app looks at 200px; it is a statement about what a deep link does when the panel
 * is off screen, and a short window is the cheapest way to put it there.
 */
async function withWindowHeight(app: ElectronApplication, page: Page, height: number): Promise<() => Promise<void>> {
  const win = await app.browserWindow(page)
  const original = await win.evaluate((w) => w.getBounds())
  const settleLayout = (): Promise<string> =>
    settleStable(() => contentBox(page).then((b) => JSON.stringify(b)), { timeoutMs: 15_000, stable: 4, pollMs: 150 })
  await win.evaluate((w, h) => {
    w.setMinimumSize(200, 200)
    w.setBounds({ ...w.getBounds(), height: h })
  }, height)
  await settleLayout()
  return async (): Promise<void> => {
    await win.evaluate((w, b) => {
      w.setBounds(b)
      w.setMinimumSize(900, 600)
    }, original)
    await settleLayout()
  }
}

/**
 * Click the level-up card in the overlay — either its VISIBLE ACTION or the card body behind it —
 * and say whether there was anything there to click.
 *
 * TWO TARGETS, ONE LINK (JOS-334). The card gained a compact "See what's new at 24" button, and
 * that button fires the SAME `focusApp` the whole-card click has always fired. Both are exercised
 * because the ticket's promise is precisely that they are one behaviour: the action is the card's
 * click made visible, not a second path that could drift from it.
 *
 * `'card'` clicks the card ELEMENT itself, so the button inside it is never involved — an
 * `el.click()` dispatches on that node and React's delegated listener handles it exactly as it
 * handles a user's. (The overlay is always-on-top and NEVER SHOWN under EQ_E2E; it has no pointer
 * to move, which is why every click in this file is dispatched inside the page.)
 */
function clickLevelUp(toast: Page, target: 'action' | 'card'): Promise<boolean> {
  return toast.evaluate(
    (a) => {
      const card = [...document.querySelectorAll('[data-testid="toast-card"]')].find((e) =>
        (e as HTMLElement).innerText.includes(a.needle)
      )
      if (!card) return false
      const el = a.target === 'card' ? card : card.querySelector('[data-testid="toast-action"]')
      if (!el) return false
      ;(el as HTMLElement).click()
      return true
    },
    { needle: `Level ${String(DING_LEVEL)}!`, target }
  )
}

/** The content area's scrollTop, or -1 when there is no content area to read. */
function contentTop(page: Page): Promise<number> {
  return page.evaluate((s) => {
    const el = document.querySelector(s) as HTMLElement | null
    return el ? Math.round(el.scrollTop) : -1
  }, CONTENT)
}

/** Put the page back at the top and WAIT for it, so the repeat link measures a known scroll. */
function resetContentScroll(page: Page): Promise<number> {
  return page
    .evaluate((s) => {
      const el = document.querySelector(s) as HTMLElement | null
      if (el) el.scrollTop = 0
    }, CONTENT)
    .then(() => settle(() => contentTop(page), (v) => v === 0, { timeoutMs: 5_000 }))
}

/**
 * THE DEEP-LINK ROUNDTRIP, end to end and through the REAL plumbing: a click on the toast card in
 * the overlay window → `eqOverlay.focusApp` → main's `focusView` handler (which re-validates the
 * view AND the anchor) → the app renderer's `applyDeepLink` → the Leveling tab, with the "New at
 * this level" panel opened ON THE LEVEL THAT DINGED.
 *
 * WHAT GETS CLICKED CHANGED IN JOS-334, AND THAT IS THE POINT. The card now carries a visible
 * "See what's new at 24" action, so the click this step fires is THAT BUTTON — the affordance a
 * real reader would actually aim at — and the whole-card click it replaced is re-proven at the
 * end of the step. If the two ever stop meaning the same thing, one of the two halves goes red.
 * Both go through `clickLevelUp` above, which explains why the clicks are dispatched in-page.
 *
 * AND SINCE JOS-330 IT ASSERTS THE ARRIVAL, not merely the destination. The tab is one tall page
 * (JOS-289) and this panel is the bottom of its left column (JOS-300), so "the Leveling tab is
 * mounted with the panel set to 24" was true the whole time the reader was looking at the top of a
 * screen of charts. Two measurements say the link now lands ON the thing: the panel is fully
 * inside the content area's visible box, and it says so itself with `data-highlighted` — the CUE
 * as a data attribute rather than a computed colour, so the claim survives any restyle of the
 * pulse. The highlight is also asserted to EXPIRE: a permanent outline is a different feature.
 */
export async function stepDeepLinkRoundtrip(mainPage: Page, toast: Page): Promise<void> {
  const clicked = await clickLevelUp(toast, 'action')
  if (!check('the level-up card’s VISIBLE ACTION is a click target (JOS-334), and it is what fires here', clicked)) {
    return
  }

  const landed = await mainPage
    .waitForSelector('[data-testid="new-at-level"]', { timeout: 20_000 })
    .then(
      () => true,
      () => false
    )
  if (!check('…and the click lands the app on the Leveling tab’s "New at this level" panel', landed)) return

  // THE HIGHLIGHT FIRST, and it is not politeness about ordering: the pulse is deliberately brief
  // (two seconds, useFocusLanding), so the assertion that could time out has to be the one that
  // starts polling soonest. It is also the assertion that does not depend on the layout settling.
  const lit = await settle(() => panelHighlight(mainPage), (v) => v === 'true', { timeoutMs: 8_000 })
  check('…and the panel LIGHTS UP on arrival, so the reader can see what they were sent to', lit === 'true', lit)

  const view = await settle(() => fullyInContent(mainPage, PANEL), (v) => v === 'in view', { timeoutMs: 8_000 })
  if (view === 'taller than the content viewport') {
    note('this loadout’s unlock lists make the panel taller than the window — a landing cannot put ALL of it in frame, which is the fixture speaking and not a regression')
  } else {
    check(
      '…scrolled FULLY into the app content area (JOS-330 — the panel is the bottom of the left column)',
      view === 'in view',
      `${view} at scrollTop ${String(await contentTop(mainPage))}`
    )
  }

  const value = await mainPage.evaluate(
    () => (document.querySelector('[data-testid="new-at-level-value"]') as HTMLElement | null)?.innerText ?? ''
  )
  check('…anchored at the level that dinged, not at the character’s own', value.includes(String(DING_LEVEL)), value)
  check(
    '…with the level stepper mounted (the panel is browsable, not just historical)',
    (await countOf(mainPage, '[data-testid="new-at-level-next"]')) === 1
  )

  // AND IT IS A CUE, NOT A COSTUME. Waiting for the attribute to fall back is what proves the
  // highlight is transient — and it is also what arms the repeat step below, which can only claim
  // a RE-fire from a panel that is demonstrably dark first.
  const dark = await settle(() => panelHighlight(mainPage), (v) => v === 'false', { timeoutMs: 10_000 })
  check('…and the highlight is a brief cue, not a permanent outline: it comes back off', dark === 'false', dark)

  // THE WHOLE CARD IS STILL THE LINK (JOS-334). The button is the promise becoming visible, and a
  // reader who clicks the card ANYWHERE — as they have been able to since the kind shipped — must
  // land in the same place. Armed by the dark panel above: a re-light can only have come from this
  // click. A card that has aged out of its 25 s hold NOTES rather than fails; the hold is this
  // spec's fixture, not a claim about the app.
  if (await clickLevelUp(toast, 'card')) {
    const relit = await settle(() => panelHighlight(mainPage), (v) => v === 'true', { timeoutMs: 8_000 })
    check(
      'clicking the card ITSELF still fires the same link — the action is a promise, not a second path',
      relit === 'true',
      relit
    )
    // Left dark again on the way out, because the repeat step below arms itself the same way.
    await settle(() => panelHighlight(mainPage), (v) => v === 'false', { timeoutMs: 10_000 })
  } else {
    note('the level-up card aged out before the whole-card click could be re-tested — its hold is the fixture speaking, not a regression')
  }
}

/**
 * THE SAME LEVEL, ASKED FOR TWICE (JOS-330) — which is the entire reason `focusNonce` exists —
 * AND THE ONE PLACE THE SCROLL IS ACTUALLY LOAD-BEARING.
 *
 * Two claims in one step because they need the same rigged window:
 *
 *   THE REPEAT. Ding at 24, look away, ding at 24 again: the tab is already mounted and the panel
 *   is already set to 24, so nothing about the app's STATE changes on the second link. Only the
 *   nonce moves. A landing keyed off the level (or off a mount) would make that second card a dead
 *   link — click it and nothing at all happens, which is worse than the bug JOS-330 fixed, because
 *   the first click taught the reader to expect an answer.
 *
 *   THE SCROLL. This spec's fixture is a SMALL log — a Leveling tab of a few hundred pixels, in
 *   the chart-less state — so it fits the default window with the panel already on the first
 *   screen, and a landing measured there can report "fully in view" without anything ever having
 *   scrolled. That is a green tautology, and the exact regression this ticket is about would sail
 *   straight through it. So the window is SQUEEZED to just taller than the panel first: the page
 *   then genuinely overflows, the panel is genuinely below the fold at scrollTop 0, and "it came
 *   into view AND the content area's own scrollTop moved to get it there" is a claim with
 *   something behind it. (The layout spec proves the same geometry the other way round, on the
 *   real log, by SCROLLING to the panel — tests/e2e/levelingLayoutSteps.mts. Neither substitutes
 *   for the other: that one asks whether the page can REACH the panel, this one whether the LINK
 *   does.)
 *
 * THE SQUEEZE IS BEST-EFFORT AND SAYS SO. A fixture whose Leveling tab is shorter than the
 * smallest window this rig can make cannot be given a fold to hide the panel behind, and there is
 * no honest scroll claim to make about it — that case NOTES and keeps the nonce claim, rather than
 * failing over the shape of a log. The nonce half never depends on the rig.
 *
 * Driven through `focusApp` — the same door the card's own click goes through, already proven by
 * the step above — because the card that carried the first link may have aged out of the stack.
 */
export async function stepRepeatDeepLink(app: ElectronApplication, mainPage: Page, toast: Page): Promise<void> {
  const wide = await contentBox(mainPage)
  const panelH = await panelHeight(mainPage)
  const win = await app.browserWindow(mainPage)
  const bounds = await win.evaluate((w) => w.getBounds())
  // The chrome is everything the window spends on itself — frame, tab rail, the content box's own
  // padding — measured rather than assumed, because it differs per platform and per theme. The
  // target leaves the panel 60px of slack so a landing can still put ALL of it in frame.
  const chrome = bounds.height - wide.client
  const target = Math.max(240, chrome + panelH + 60)
  const restore = target < bounds.height ? await withWindowHeight(app, mainPage, target) : null
  if (!restore) {
    note(`the window is already shorter than the panel needs (${String(bounds.height)}px around a ${String(panelH)}px panel) — no squeeze to apply`)
  }

  try {
    const top = await resetContentScroll(mainPage)
    const squeezed = await contentBox(mainPage)
    const before = await fullyInContent(mainPage, PANEL)
    const hidden = top === 0 && before.includes('below the fold')
    const rig = `${String(squeezed.height)}px of tab in a ${String(squeezed.client)}px viewport at scrollTop ${String(top)}`
    if (hidden) {
      check('with the window squeezed, the level panel is genuinely BELOW THE FOLD at the top of the page', true, rig)
    } else {
      note(`this fixture's Leveling tab is too short to hide the panel behind a fold (${rig}) — the repeat link's SCROLL cannot be measured here, only its highlight`)
    }

    await toast.evaluate((level) => {
      ;(window as unknown as { eqOverlay: { focusApp: (f: unknown) => void } }).eqOverlay.focusApp({
        view: 'leveling',
        level
      })
    }, DING_LEVEL)

    const lit = await settle(() => panelHighlight(mainPage), (v) => v === 'true', { timeoutMs: 8_000 })
    check(
      'a SECOND link to the level ALREADY on screen lights the panel again (the nonce contract)',
      lit === 'true',
      lit
    )
    if (!hidden) return
    const view = await settle(() => fullyInContent(mainPage, PANEL), (v) => v === 'in view', { timeoutMs: 8_000 })
    const moved = await contentTop(mainPage)
    check(
      '…and SCROLLS it into the content area, from a page parked at its top',
      view === 'in view' && moved > 0,
      `${before} → ${view} at scrollTop ${String(moved)}`
    )
  } finally {
    // Unconditionally, even on a failed check: the quest-anchor step runs after this one and the
    // app's own 900x600 minimum must not leak out of here.
    if (restore) await restore()
  }
}
