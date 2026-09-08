/**
 * toastFitSteps.mts — THE CELEBRATION WINDOW IS THE CARDS, AND THE BUBBLE IS NEVER CUT OFF.
 *
 * The owner's report against 1.19.2: "the overlay pop ups when quest items drop and what not
 * doesn't look like a complete bubble. The bottom of the bubble appears cut off." The lane was a
 * fixed 560x360 (times the text scale) and a quest-item card — chrome row, title, subtitle, the
 * item card and up to three quest blocks — is taller than that, so the card ran off the bottom edge
 * of its own window. A boss or a level card fits, which is why it took a quest drop to find it.
 * Since 2026-09-08 the toast is the second FIT-HEIGHT kind (main/overlayLayout.ts): the renderer
 * measures its card stack and main resizes the window around it.
 *
 * WHAT ONLY THE REAL APP CAN SAY. The clamp is pinned pure in tests/overlayLayout.test.mts and the
 * step window in tests/toastQuest.test.mts. What no unit test can claim is that the LOOP CLOSES:
 * the renderer measures, main resizes a live BrowserWindow, and the card that comes back fits —
 * read as the window's real bounds out of the main process, and as every card's own bottom edge
 * measured against them.
 *
 * SPLIT OUT OF tests/e2e/toast.e2e.mts for the reason toastDeepLinkSteps.mts was: the spec had
 * reached the repo's 400-code-line factoring ceiling, and the answer to that is a split, not a
 * widened threshold. This is a coherent piece to lift — everything about the window's HEIGHT and
 * the shape of a quest-item card — and the spec keeps what a toast IS.
 *
 * Read toast.e2e.mts's header first; it carries the frame these steps run inside (no window is ever
 * shown, the overlay has no pointer, `el.click()` is a real DOM click).
 *
 * THESE RUN LAST, and they own the lane: they empty it, refill it with the cards whose height is
 * the claim, and empty it again. Every step above them wants the stack it built left alone.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import { check, note, settle } from './appHarness.mjs'
import { overlayBounds, setOverlayTextScale, type Bounds } from './stripScaleSteps.mjs'

/** A Sky reward that exists in the committed item DB, so the card resolves with NO network. The
 *  spec's own copy of this constant is the same string for the same reason. */
const REWARD = 'Shining Metallic Robes'

/** The looted item these steps celebrate — 27 quests in the committed catalog want it. */
const FIT_ITEM = 'Bone Chips'

/**
 * Three REAL catalog pages that all name `Bone Chips` as a turn-in, chosen for their shapes:
 *
 *   Cursed Wafers Quest — 9 steps, and NONE of them spells the item, so nothing in it can light.
 *   Monk Sash Quests    — 42 steps with the item named at step 9: the block that must open.
 *   Bone Chips Qeynos   — 7 steps, the item named in the first.
 *
 * In that order on purpose. The card opens the block that NAMES the drop, not the first one, so a
 * first block with nothing lit is the only arrangement that can tell the two rules apart.
 */
const FIT_QUEST_PAGES = ['Cursed Wafers Quest', 'Monk Sash Quests', 'Bone Chips Qeynos']

/** The quest block that must be the open one — the middle page above. */
const OPEN_QUEST = 'Monk Sash Quests'

/** `TOAST_MAX_QUEST_STEPS` (src/shared/toast.ts), 6 until 2026-09-08. Spelled out rather than
 *  imported: an e2e file loads no `src` module (tests/e2e/overlayMinSizeSteps.mts states the rule),
 *  so a change to the cap that forgets this line fails loudly here. */
const MAX_STEPS = 4

/** ToastOverlay's own inset, each side. Spelled out for the same reason. */
const PAD = 6

/** `FIT_MAX_WORK_AREA_FRACTION` (src/main/overlayLayout.ts), likewise. */
const MAX_SHARE = 0.7

/** A window is whole pixels and a layout box is not; a pixel either way is nobody's intent. */
const SLACK = 2

interface FitSnap {
  /** what the measured content box is worth, in the window's own CSS px */
  content: number
  /**
   * The lowest card's bottom edge, in client px — what may not fall past the window's height.
   *
   * MEASURED AGAINST MAIN'S BOUNDS, NOT AGAINST THE DOCUMENT'S OWN HEIGHT, and that is a finding
   * rather than a preference: an overlay under `EQ_E2E=1` is never shown, and a window that is
   * never composited does not shrink its viewport when `setBounds` makes it smaller. Measured here:
   * `window.innerHeight` stayed at 640 — the tallest that window had ever been — while main's
   * bounds said 207. It HIGH-WATER-MARKS, so it can hide an overflow and (mid-resize) invent one.
   * Card bottoms are laid out against the WIDTH, which is stable, so they are the honest half.
   */
  lowest: number
  /** the renderer's own idea of its height. Informational: see above. */
  inner: number
}

interface FitRead {
  bounds: Bounds | null
  snap: FitSnap
}

/** What the toast window is drawing right now, measured in its own document. */
function fitSnap(page: Page): Promise<FitSnap> {
  return page.evaluate(() => {
    // NO NAMED FUNCTION (and no const-assigned arrow) INSIDE THIS EVALUATE: tsx compiles this file
    // with esbuild's keepNames, whose `__name` helper exists only in the Node bundle — the callback
    // is re-evaluated in the window, where it is undefined (quest-item-toast.e2e.mts, at length).
    const fit = document.querySelector('[data-testid="toast-fit"]') as HTMLElement | null
    const cards = [...document.querySelectorAll('[data-testid="toast-card"]')]
    const bottoms = cards.map((c) => (c as HTMLElement).getBoundingClientRect().bottom)
    const lowest = bottoms.length > 0 ? Math.max(...bottoms) : 0
    return {
      content: fit ? fit.scrollHeight : 0,
      lowest,
      inner: window.innerHeight
    }
  })
}

/** Every rendered card's text, in stack order — the spec's own helper, kept local (see the
 *  `fullyInContent` argument in toastDeepLinkSteps.mts: two suites, no coupling). */
function cardTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast-card"]')].map((el) =>
      (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
    )
  )
}

/** Send one toast request over the REAL renderer→main channel, and wait for the stack it makes. */
async function sendAndSettle(main: Page, toast: Page, req: Record<string, unknown>, expect: number): Promise<void> {
  await main.evaluate(
    (r) => (window as unknown as { eq: { showToast: (x: unknown) => void } }).eq.showToast(r),
    req
  )
  await settle(() => cardTexts(toast), (c) => c.length >= expect, { timeoutMs: 15_000 })
}

/**
 * Poll until main has resized the window around whatever the lane is drawing.
 *
 * `ceiling` is the OTHER way this settles: a request main clamped (70% of the work area) will never
 * satisfy "tall enough for the content", and waiting fifteen seconds for it would push the card
 * past its own hold and measure an empty lane. A window sitting at the ceiling has finished moving.
 *
 * THE CONDITION IS MAIN'S, and the reading it gates is the renderer's — two processes, and the
 * resize reaches them at different moments. Settling on the WINDOW (it is tall enough for the
 * content the renderer just measured) is what makes the card-edge reading below mean anything: it
 * is taken after the window has finished moving rather than in the middle of it.
 */
function settleFit(app: ElectronApplication, toast: Page, ceiling: number): Promise<FitRead> {
  return settle(
    async () => ({ bounds: await overlayBounds(app, 'toast'), snap: await fitSnap(toast) }),
    (m) =>
      m.bounds !== null &&
      m.snap.content > 0 &&
      (m.bounds.height >= m.snap.content + 2 * PAD || m.bounds.height >= ceiling - SLACK),
    { timeoutMs: 15_000 }
  )
}

/** 70% of this display's work area — the ceiling main clamps a fit request to. */
function fitCeiling(area: Bounds): number {
  return Math.round(area.height * MAX_SHARE)
}

/** The height a read is worth, or 0 when main had no window to answer about. */
function heightOf(m: FitRead | Bounds | null): number {
  if (m === null) return 0
  return 'height' in m ? m.height : (m.bounds?.height ?? 0)
}

/**
 * The three promises, made about one measurement. `label` names the card in the check text.
 *
 * THE CEILING IS PART OF THE PROMISE, NOT AN EXCUSE FOR BREAKING IT. Two of these claims — the
 * window holds what it drew, and nothing hangs below its bottom edge — are about a REQUEST MAIN
 * GRANTED. A request main clamped at 70% of the work area is the one case where the card genuinely
 * cannot fit, and the honest report of it is a note: the alternative to a clipped card there is a
 * window that ate the display, which is the thing the ceiling exists to refuse. Every card this
 * spec sends alone is well under it; the clamp is reachable by STACKING them, or by 200% text.
 */
function checkFits(label: string, m: FitRead, area: Bounds): void {
  if (!check(`the celebration window has bounds to read with the ${label} up`, m.bounds !== null)) return
  const height = heightOf(m)
  const ceiling = fitCeiling(area)
  check(
    `…and never past 70% of the work area, whatever the ${label} had to say`,
    height <= ceiling + SLACK,
    `${String(height)}px of a ${String(area.height)}px work area`
  )
  if (height >= ceiling - SLACK) {
    note(
      `the ${label} asked for ${String(m.snap.content + 2 * PAD)}px and this display's ceiling is ` +
        `${String(ceiling)}px — clamped, so what is below the fold is the clamp, not a fit bug`
    )
    return
  }
  check(
    `the window is TALL ENOUGH for the ${label} it drew`,
    height >= m.snap.content + 2 * PAD,
    `${String(height)}px window for ${String(m.snap.content)}px of cards + ${String(2 * PAD)}px padding`
  )
  check(
    `…with no card's bottom edge below the bottom of the ${label} window`,
    m.snap.lowest > 0 && m.snap.lowest <= height + 1,
    `lowest card edge at ${String(Math.round(m.snap.lowest))}px in a ${String(height)}px window`
  )
}

/** Close every card on screen and wait for the lane to be empty again. */
async function dismissAll(toast: Page): Promise<void> {
  await toast.evaluate(() => {
    for (const b of document.querySelectorAll('[data-testid="toast-close"]')) (b as HTMLElement).click()
  })
  await settle(() => cardTexts(toast), (c) => c.length === 0, { timeoutMs: 10_000 })
}

/** What the quest-item card's blocks are: which one is open, what the others are called, and the
 *  "+N steps" notes standing in for the steps they are not printing. */
function questBlocks(page: Page): Promise<{ open: string[]; shut: string[]; notes: string[]; steps: number }> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-toast-kind="questItem"]')
    const blocks = card ? [...card.querySelectorAll('[data-testid="toast-quest"]')] : []
    return {
      open: blocks
        .filter((b) => b.getAttribute('data-open') === 'true')
        .map((b) => (b.querySelector('[data-testid="toast-quest-name"]') as HTMLElement | null)?.innerText.trim() ?? ''),
      shut: blocks
        .filter((b) => b.getAttribute('data-open') !== 'true')
        .map((b) => (b.querySelector('[data-testid="toast-quest-name"]') as HTMLElement | null)?.innerText.trim() ?? ''),
      notes: (card ? [...card.querySelectorAll('[data-testid="toast-quest-steps-note"]')] : []).map((n) =>
        (n as HTMLElement).innerText.trim()
      ),
      steps: card ? card.querySelectorAll('[data-testid="toast-quest-step"]').length : 0
    }
  })
}

/** The quest-item card these steps measure, shaped exactly as the live detector sends one
 *  (renderer/features/quests/questItemToast.ts). */
function fitQuestRequest(): Record<string, unknown> {
  return {
    id: 'e2e-fit-quest',
    kind: 'questItem',
    title: FIT_ITEM,
    subtitle: `Quest item · needed for ${String(FIT_QUEST_PAGES.length)} quests`,
    itemName: FIT_ITEM,
    questPages: FIT_QUEST_PAGES,
    focus: { view: 'quests', quest: FIT_QUEST_PAGES[0] },
    durationMs: 25_000
  }
}

/**
 * THE CARD IS A NOTIFICATION, NOT A WALKTHROUGH (2026-09-08).
 *
 * Three quests are still NAMED — that is the fact a player needs, and the card's whole promise —
 * but exactly one prints its steps: the block naming the looted item, else the first. The other two
 * are a header line and a "+N steps" note, and each is still its own link into the Quests tab.
 */
async function checkQuestCardShape(toast: Page): Promise<void> {
  const blocks = await questBlocks(toast)
  check(
    'exactly ONE quest block on the card prints its steps',
    blocks.open.length === 1,
    `open: ${blocks.open.join(' | ') || 'none'}`
  )
  check(
    '…and it is the block that NAMES the looted item, not merely the first',
    blocks.open[0] === OPEN_QUEST,
    `${blocks.open[0] ?? '(none)'} — expected ${OPEN_QUEST}`
  )
  check(
    '…while the other quests are still NAMED, on their own header lines',
    blocks.shut.length === 2 && blocks.shut.every((n) => n.length > 0),
    blocks.shut.join(' | ') || 'none'
  )
  check(
    '…each saying how many steps it is not printing',
    blocks.notes.length === 2 && blocks.notes.every((t) => /^\+\d+ steps?$/.test(t)),
    blocks.notes.join(' | ') || 'none'
  )
  check(
    `…and the open block prints at most ${String(MAX_STEPS)} of them (TOAST_MAX_QUEST_STEPS)`,
    blocks.steps > 0 && blocks.steps <= MAX_STEPS,
    `${String(blocks.steps)} step row(s)`
  )
}

/** THE STEP: an empty lane, a Sky card, then the card the owner's report was about. */
export async function stepWindowFitsItsCards(
  app: ElectronApplication,
  mainPage: Page,
  toast: Page
): Promise<void> {
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  await dismissAll(toast)
  const idle = await overlayBounds(app, 'toast')
  note(`celebration window, empty lane: ${String(idle?.width)}x${String(heightOf(idle))}`)

  // A Sky completion — a title, a subtitle and the reward item card main resolved and embedded.
  await sendAndSettle(
    mainPage,
    toast,
    {
      id: 'e2e-fit-sky',
      kind: 'skyQuestComplete',
      title: 'Quest complete: Test of Sacrifice',
      subtitle: 'Paladin',
      itemName: REWARD,
      focus: { view: 'posky' },
      durationMs: 25_000
    },
    1
  )
  const sky = await settleFit(app, toast, fitCeiling(area))
  checkFits('Sky card', sky, area)
  note(`Sky completion card: ${String(sky.snap.content)}px of card in a ${String(heightOf(sky))}px window`)

  // …and the quest-item card, ALONE in the lane: the report is about one bubble being cut off, and
  // a STACK of two tall cards is the one shape that can legitimately hit the 70% ceiling on a short
  // display, which would make the interesting assertion untestable rather than false.
  await dismissAll(toast)
  await sendAndSettle(mainPage, toast, fitQuestRequest(), 1)
  const quest = await settleFit(app, toast, fitCeiling(area))
  checkFits('quest-item card', quest, area)
  note(`quest-item card: ${String(quest.snap.content)}px of cards in a ${String(heightOf(quest))}px window`)
  check(
    'the window GREW to hold the quest-item card rather than clipping the bubble',
    heightOf(quest) > heightOf(sky),
    `${String(heightOf(sky))}px -> ${String(heightOf(quest))}px`
  )
  // ONLY THE HEIGHT MOVES. The width and the position are the user's — persisted bounds win for
  // both — and a fit that walked the lane sideways every time a card arrived would be a worse bug
  // than the one this ticket is about.
  check(
    '…and ONLY the height: the lane is the same width, in the same place, card after card',
    Math.abs((quest.bounds?.width ?? 0) - (idle?.width ?? 0)) <= SLACK &&
      quest.bounds?.x === idle?.x &&
      quest.bounds?.y === idle?.y,
    `${JSON.stringify(idle)} -> ${JSON.stringify(quest.bounds)}`
  )
  await checkQuestCardShape(toast)
}

/**
 * …AND THE FIT COMPOSES WITH THE TEXT SIZE (JOS-406 meets the fit).
 *
 * The two mechanisms answer different halves of the same window: the text scale is main re-placing
 * the strip's layout box (the WIDTH doubles, `stepStripScalesWithText`), and the fit is the
 * renderer measuring the card drawn inside it — a measurement already carrying the CSS `zoom`, so
 * at 200% it is twice the number and the window follows it there. Neither may clip the other.
 *
 * It puts the scale back and empties the lane afterwards, because it is the last thing to touch
 * this strip.
 */
export async function stepFitAtDoubleText(app: ElectronApplication, toast: Page): Promise<void> {
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
  const small = heightOf(await overlayBounds(app, 'toast'))
  await setOverlayTextScale(toast, 2)
  const big = await settleFit(app, toast, fitCeiling(area))
  checkFits('quest-item card at 200%', big, area)
  note(`at 200% text: ${String(big.snap.content)}px of cards in a ${String(heightOf(big))}px window`)
  check(
    'the window at 200% is TALLER than the same cards at 100% — the two mechanisms compose',
    heightOf(big) > small,
    `${String(small)}px -> ${String(heightOf(big))}px`
  )

  await setOverlayTextScale(toast, 1)
  const back = await settleFit(app, toast, fitCeiling(area))
  checkFits('quest-item card back at 100%', back, area)

  // …AND WHEN THE CARDS LEAVE, the window comes back down or holds — never grows. An empty lane
  // renders nothing, so its height is nobody's business and a shrink-then-grow around every
  // celebration would be thrash the user can see; what must never happen is the window RISING with
  // nothing in it.
  const ceiling = heightOf(back)
  await dismissAll(toast)
  const rest = heightOf(
    await settle(() => overlayBounds(app, 'toast'), (b) => b !== null && b.height <= ceiling, { timeoutMs: 8_000 })
  )
  check(
    'with the lane empty again the window came back down, or held — it never grew',
    rest > 0 && rest <= ceiling && rest <= Math.round(area.height * MAX_SHARE) + SLACK,
    `${String(ceiling)}px -> ${String(rest)}px`
  )
}
