/**
 * dragPerfSteps.mts — WHAT ONE POINTERMOVE COSTS, measured inside the real app (JOS-290).
 *
 * THE DEFECT THIS PINS. The owner reported that drag-selecting a period over the leveling graph
 * is slow. Measured with a CPU profile over 60 real pointer moves on a frozen copy of the owner's
 * 1.64M-line log: 250.3 ms of main thread PER MOVE before the fix, 9.4 ms after — a 26.7x cut.
 * The cost was never the arithmetic (`rangeStats` does not run during a drag at all, and answers
 * the widest range on that log in 0.93 ms — tests/levelingDragDraft.test.mts re-measures both
 * every run). It was the CHANNEL: the draft band lived in `LevelingView`'s state, so every move
 * re-rendered the entire tab — ~10k nodes, 105 zone rows, 61 ledger rungs — and ~60% of the
 * samples were MUI/emotion re-serializing styles for output that had not changed. The band now
 * subscribes to a one-slot store (`selectionDraft.ts`) and is the only thing a move re-renders.
 *
 * WHY THE ASSERTIONS ARE RATIOS AND NOT MILLISECOND CEILINGS. A number like "under 20 ms per
 * move" says as much about the machine as about the code, and this suite runs on the owner's box
 * while he plays — and every `mouse.move` here additionally carries about a second of CDP round
 * trip and a fixed slab of V8 `(program)` work that is the harness, not the app. So nothing is
 * compared against a constant. THREE gestures are measured with one instrument, in one run:
 *
 *   HOVER  — the same sweep across the same chart with no button down. Identical harness cost,
 *            identical event plumbing, and it renders the crosshair and the tooltip CARD, which
 *            is more DOM than a drag's band. A drag must not cost more than this. THIS IS THE
 *            ASSERTION.
 *   DRAG   — the same sweep with the button down.
 *   COMMIT — the pointer-up, which re-derives the scope and re-renders the whole tab. That is
 *            precisely the work a move used to do, so it is the most INTERESTING comparison —
 *            and it is PRINTED, NOT ASSERTED. Measured across five runs it came back 21, 23, 30,
 *            53 and 74 ms for the same gesture on the same fixture: one commit is one burst, far
 *            too few samples to be a denominator, and a gate on it failed a correctly-fixed tree
 *            on the 21 ms run. AGENTS.md already records this exact mistake once (perf.e2e's
 *            heartbeat flake, "asked about the WRONG window"); a threshold whose denominator has
 *            been watched swing 3.5x is not a threshold, so it is a readout instead.
 *
 * The first attempt at this pin compared the drag against a no-op sweep over the hero strip and
 * got 0.461 (defect) against 0.153 (fixed) — a real signal with too little air around it to put
 * a threshold in, because the constant it subtracted was not the one that mattered. The hover
 * sweep is the right control: over the same runs it held at 5.6-6.5 ms/move in BOTH states while
 * the drag half moved from 31.8 to 4.2-7.3.
 *
 * THE MEASUREMENT IS PRINTED EVERY RUN (the JOS-283 rule), including the half that is not gated.
 *
 * It profiles rather than timing a wall clock on purpose: this window is never composited, so
 * `requestAnimationFrame` can be throttled to nothing and `backgroundThrottling` can stretch a
 * timer to a second (AGENTS.md records both traps). A CPU profile counts main-thread samples and
 * cares about neither.
 */
import type { Page } from 'playwright-core'
import { check, hoverAt, note } from './appHarness.mjs'

/**
 * How many moves each sweep is made of. Each `mouse.move` costs about a second of round trip in a
 * never-composited window, so this is a budget as much as a sample size — and it is a sample size
 * that had to be RAISED: at 12 the hover control came back anywhere between 2.85 and 6.45 ms per
 * move depending on how loaded the machine was, which put a correctly-fixed run at 2.04 against a
 * 2x gate. Twenty is what the spec can afford.
 */
const MOVES = 20
/**
 * How much dearer a DRAG move may be than a HOVER move across the same chart.
 *
 * MEASURED on the e2e fixture, with the fix in and then reverted back out — the JOS-283
 * discipline, because a gate nobody has watched FAIL is not a gate. The FULL observed range, not
 * the flattering part of it:
 *
 *   at MOVES=12   fixed 0.66 · 1.15 · 1.19 · 1.26 · 1.34 · 2.04     defect 4.93
 *   at MOVES=20   fixed 0.84 · 1.25 · 1.25                          defect 5.25
 *
 * Both halves drift with machine load and they do NOT drift together — at twelve moves the hover
 * control alone ranged 2.85 to 6.45 ms per move — which is how a 2x gate came to be watched
 * failing a correctly-fixed tree at 2.04. TWENTY MOVES IS HALF THE ANSWER (the spread closed to
 * 0.84-1.25) and the other half is placing the gate against the worst good run rather than the
 * median: 3x leaves 2.4x of air under the fixed tree and sits 1.75x under the defect.
 */
const DRAG_OVER_HOVER = 3

interface ProfileNode {
  id: number
  callFrame: { functionName: string }
}
interface Profile {
  nodes: ProfileNode[]
  samples?: number[]
  startTime: number
  endTime: number
}

/** Non-idle main-thread milliseconds inside a profile. */
function busyMs(p: Profile): number {
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const interval = (p.endTime - p.startTime) / Math.max(1, (p.samples ?? []).length)
  let n = 0
  for (const s of p.samples ?? []) if (byId.get(s)?.callFrame.functionName !== '(idle)') n++
  return (n * interval) / 1000
}

/**
 * Sweep `sel` three ways — hovering, dragging, committing — and report what each cost.
 *
 * The drag is a REAL one — pointer capture, the `DRAG_THRESHOLD_PX` gate and the
 * `MIN_SELECTION_MS` floor all apply — because a synthesized event would measure a path the user
 * never takes. `hoverAt` lands the first point (it clips against every scrolling ancestor and
 * verifies with `elementFromPoint`, which is the fix that made this chart reachable at all);
 * after that the geometry is fixed and the moves go through `mouse.move`, so the harness's own
 * re-derivation stays out of the samples.
 */
export async function stepDragCost(page: Page, sel: string): Promise<void> {
  if (!(await hoverAt(page, sel, 0.08, 0.5))) {
    note('drag cost: the chart could not be reached — nothing measured')
    return
  }
  const box = await page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect()
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
  }, sel)
  if (!box || box.w <= 0) {
    note('drag cost: the chart has no box — nothing measured')
    return
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 })

  // THE COMPARABLE GESTURE: the same sweep across the same chart with no button down. That is
  // the HOVER path — identical harness cost, identical event plumbing, and it renders a tooltip
  // card, which is a bigger piece of DOM than the band a drag renders. So "a drag costs no more
  // than a hover" is a claim about the app and not about the machine, and it is exactly the claim
  // the defect broke: with the draft in view state, a move rendered the tooltip's worth of work
  // AND the whole tab on top of it.
  await cdp.send('Profiler.start')
  for (let i = 1; i <= MOVES; i++) {
    await page.mouse.move(box.x + box.w * (0.08 + (0.84 * i) / MOVES), box.y + box.h * 0.5)
  }
  const hover = busyMs((await cdp.send('Profiler.stop')).profile as Profile)

  await page.mouse.move(box.x + box.w * 0.08, box.y + box.h * 0.5)
  await page.mouse.down()
  await cdp.send('Profiler.start')
  for (let i = 1; i <= MOVES; i++) {
    await page.mouse.move(box.x + box.w * (0.08 + (0.84 * i) / MOVES), box.y + box.h * 0.5)
  }
  const moves = busyMs((await cdp.send('Profiler.stop')).profile as Profile)

  // THE COMMIT: pointer-up derives the scope and re-renders the tab. Profiled with a settle
  // inside the window, so the render is finished before the profiler is stopped rather than
  // half-counted.
  await cdp.send('Profiler.start')
  await page.mouse.up()
  await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)))
  const commit = busyMs((await cdp.send('Profiler.stop')).profile as Profile)
  await cdp.detach().catch(() => undefined)

  note(
    `drag cost over ${String(MOVES)} moves: ${(moves / MOVES).toFixed(2)} ms of main thread per DRAG move, ` +
      `${(hover / MOVES).toFixed(2)} ms per HOVER move across the same chart ` +
      `(ratio ${(moves / Math.max(1, hover)).toFixed(2)}); ` +
      `${commit.toFixed(0)} ms for the one commit that re-derived and re-rendered the whole tab, ` +
      `which a move used to cost — reported, not gated (see the header)`
  )
  check(
    'a drag move costs no more than a hover move over the same chart (the drag renders a band, not the tab)',
    moves <= hover * DRAG_OVER_HOVER,
    `${(moves / MOVES).toFixed(2)} ms/drag-move vs ${(hover / MOVES).toFixed(2)} ms/hover-move`
  )
}
