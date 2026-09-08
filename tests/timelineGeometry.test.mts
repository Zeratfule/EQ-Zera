// TIMELINE SIZING — the chart's geometry, and the layout FEEDBACK LOOP it used to close.
//
// The owner's report: "the combat timeline flickers when its surface is smaller than the
// timeline — it moves back and forth quickly." The cause is not a race and not a chatty
// observer; it is arithmetic. `timelineMetrics` derives lane height from the available HEIGHT,
// and `labelGutter(laneH)` steps the left gutter 132 → 148 → 168px at laneH 26 / 32 — so once
// `plotW` is clamped at MIN_PLOT_W the SVG's WIDTH is a step function of the measured HEIGHT.
// Point a ResizeObserver at the SCROLLING box and Chromium closes the loop:
//
//     svg overflows → a scrollbar appears → the measured content box loses SCROLLBAR_SIZE on the
//     CROSS axis → laneH drops under a gutter threshold → the svg gets 20px narrower → it fits →
//     the scrollbar leaves → the box grows back → …
//
// Test 1 MEASURES that: a 2-lane fight in a 476×140 box has NO fixed point — it alternates
// forever between two states — and thousands of container sizes are in the same boat. Test 1 is
// therefore the TRIPWIRE for tests 2–4: it proves this simulation can actually see the bug, so a
// green run of the rest is not vacuous.
//
// The fix is topological (CombatTimeline.tsx): the observed element is a NON-scrolling frame, and
// the scroller is an absolutely-positioned child of it. Test 2 pins that — with a measurement no
// scrollbar can touch, every container size settles on the FIRST pass. A debounce/guard was
// explicitly rejected: a damped oscillation is still an oscillation.
//
// Arithmetic only — no DOM, no React, no fixture, so it never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_LANE_H,
  MIN_PLOT_W,
  timelineMetrics,
  type WrapSize
} from '../src/renderer/src/features/combat/timelineGeometry'
import type { TimelineView } from '../src/shared/combat'

/**
 * The gutter a classic (webkit) scrollbar consumes, mirrored from `SCROLLBAR_SIZE` in
 * src/renderer/src/theme/theme.ts. It is a CONSTANT there on purpose (the theme sets both
 * `width` and `height`, so both axes cost the same); this copy is what lets the loop be
 * simulated without a browser.
 */
const SCROLLBAR = 12

/** useWrapSize's floors — below these it reports a box LARGER than reality, on purpose (the
 *  chart stops shrinking and the surface scrolls instead). */
const MIN_REPORTED_W = MIN_PLOT_W + 140
const MIN_REPORTED_H = 120

function view(lanes: number, opts: { markers?: number; pins?: number } = {}): TimelineView {
  const { markers = 3, pins = 2 } = opts
  return {
    id: 'tl',
    name: 'Test',
    startTs: 0,
    durationMs: 60_000,
    lanes: Array.from({ length: lanes }, (_, i) => ({
      lane: `Lane ${String(i)}`,
      category: 'melee' as const,
      total: 100,
      kind: 'you' as const
    })),
    events: [],
    stanceSpans: Array.from({ length: pins }, (_, i) => ({
      group: (i === 0 ? 'stance' : 'invocation') as 'stance' | 'invocation',
      name: 'x',
      start: 0,
      end: 100
    })),
    markers: Array.from({ length: markers }, (_, i) => ({
      t: i * 100,
      kind: 'slow' as const,
      label: 'a mob'
    })),
    downsampled: false,
    rawCount: 0,
    totalCount: 0,
    truncated: false
  }
}

/**
 * ONE round of "React renders the svg → Chromium lays it out → the ResizeObserver reports".
 *
 * `frame` is the container's outer box (what the flex column hands the chart). `wrap` is the size
 * the component currently BELIEVES. `measureScroller` picks the topology: true = the observed
 * element is the scroll box itself (the old DOM, and the bug), false = the observed element is a
 * non-scrolling frame and the scroller is inside it (today's DOM).
 */
function step(
  tl: TimelineView,
  wrap: WrapSize,
  frame: WrapSize,
  measureScroller: boolean
): WrapSize {
  const m = timelineMetrics(tl, wrap)
  // Chromium's overflow:auto resolution — add the axis that overflows, then re-test the other
  // (a bar on one axis steals from the cross axis and can force a second bar).
  let vertical = m.svgH > frame.h
  const horizontal = m.svgW > frame.w - (vertical ? SCROLLBAR : 0)
  if (horizontal && !vertical) vertical = m.svgH > frame.h - SCROLLBAR
  const w = measureScroller && vertical ? frame.w - SCROLLBAR : frame.w
  const h = measureScroller && horizontal ? frame.h - SCROLLBAR : frame.h
  return { w: Math.max(MIN_REPORTED_W, w), h: Math.max(MIN_REPORTED_H, h) }
}

/** Iterate the loop from the component's initial guess. `null` = it never settled. */
function settle(
  tl: TimelineView,
  frame: WrapSize,
  measureScroller: boolean,
  limit = 40
): { wrap: WrapSize; passes: number } | null {
  let wrap: WrapSize = { w: 900, h: 400 }
  for (let i = 1; i <= limit; i++) {
    const next = step(tl, wrap, frame, measureScroller)
    if (next.w === wrap.w && next.h === wrap.h) return { wrap, passes: i }
    wrap = next
  }
  return null
}

/** The sampled container sizes both topologies are judged over. */
function* frames(): Generator<{ lanes: number; frame: WrapSize }> {
  for (const lanes of [1, 2, 3, 4, 5, 6, 8, 10, 14]) {
    for (let w = 300; w <= 900; w += 4) {
      for (let h = 140; h <= 620; h += 4) yield { lanes, frame: { w, h } }
    }
  }
}

test('TRIPWIRE: measuring the SCROLL box has no fixed point — the reported flicker', () => {
  const tl = view(2)
  // The exact cycle, hand-read at a 460×140 surface with 2 lanes:
  //   believe 460×140 → svg 476×140 (laneH 28 ⇒ gutter 148) → 476 > 460, a HORIZONTAL bar
  //   appears → the measured height drops to 128 → laneH 22 ⇒ gutter 132 → svg 460×128 → it
  //   fits, the bar leaves → the measured height is 140 again → …
  assert.equal(settle(tl, { w: 460, h: 140 }, true), null, '460x140 must never settle')
  const tall = timelineMetrics(tl, { w: 460, h: 140 })
  const short = timelineMetrics(tl, { w: 460, h: 128 })
  assert.equal(tall.labelW, 148)
  assert.equal(short.labelW, 132)
  assert.equal(tall.svgW - short.svgW, 16, 'a 12px HEIGHT change moves the chart’s WIDTH by 16px')

  // …and it is not one unlucky size: the sweep below finds hundreds more.
  let stuck = 0
  let total = 0
  for (const { lanes, frame } of frames()) {
    total++
    if (settle(view(lanes), frame, true) === null) stuck++
  }
  assert.ok(stuck > 50, `expected many non-settling sizes, got ${String(stuck)}/${String(total)}`)
})

test('measuring a NON-scrolling frame settles on the first pass, at every container size', () => {
  for (const { lanes, frame } of frames()) {
    const got = settle(view(lanes), frame, false)
    assert.ok(got !== null, `no fixed point at ${String(lanes)} lanes in ${String(frame.w)}x${String(frame.h)}`)
    // One pass to adopt the frame, one to observe it unchanged: the measurement cannot depend
    // on what was drawn, so there is nothing left to converge.
    assert.ok(got.passes <= 2, `settled in ${String(got.passes)} passes at ${String(frame.w)}x${String(frame.h)}`)
    assert.deepEqual(got.wrap, {
      w: Math.max(MIN_REPORTED_W, frame.w),
      h: Math.max(MIN_REPORTED_H, frame.h)
    })
  }
})

test('the chart never demands a VERTICAL scrollbar for its own bottom padding', () => {
  for (const { lanes, frame } of frames()) {
    const wrap: WrapSize = {
      w: Math.max(MIN_REPORTED_W, frame.w),
      h: Math.max(MIN_REPORTED_H, frame.h)
    }
    const m = timelineMetrics(view(lanes), wrap)
    // A chart whose lanes are above the readability floor FITS: `svgH` (which includes PAD)
    // must land inside the measured box. Only a lane-starved chart may overflow.
    if (m.laneH > MIN_LANE_H) {
      assert.ok(m.svgH <= wrap.h, `svgH ${String(m.svgH)} > wrap.h ${String(wrap.h)} at ${String(lanes)} lanes`)
    }
  }
})

test('the chart only overflows HORIZONTALLY when the gutter + minimum plot no longer fit', () => {
  for (const { lanes, frame } of frames()) {
    const wrap: WrapSize = {
      w: Math.max(MIN_REPORTED_W, frame.w),
      h: Math.max(MIN_REPORTED_H, frame.h)
    }
    const m = timelineMetrics(view(lanes), wrap)
    if (m.plotW > MIN_PLOT_W) {
      assert.ok(m.svgW <= wrap.w, `svgW ${String(m.svgW)} > wrap.w ${String(wrap.w)}`)
    } else {
      // Clamped: the surface is genuinely too narrow to draw a readable plot, so it scrolls.
      assert.ok(m.svgW >= wrap.w - 8)
    }
  }
})

test('a fight with no markers and no stances still gets a whole-number lane block', () => {
  const m = timelineMetrics(view(4, { markers: 0, pins: 0 }), { w: 900, h: 400 })
  assert.equal(m.railH, 0)
  assert.equal(m.pinBlockH, 0)
  assert.equal(m.laneTop, 0)
  assert.equal(m.plotH, m.laneH * 4)
  assert.equal(m.svgH, m.totalH + 8)
})
