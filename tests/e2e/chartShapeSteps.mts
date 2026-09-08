// chartShapeSteps.mts — THE SHAPE TRIPWIRES (JOS-339): the half of that ticket that does NOT need
// an eye.
//
// The ticket is a look-and-feel regression and its acceptance is the owner's judgement of three
// photographs (curveSteps.mts takes them). But three of the four things that went wrong leave a
// mark a machine can find, and a fix nobody can re-break by accident is worth more than a fix
// somebody looked at once. Each check below is written so that it FAILED on the reported build:
// the labels were <text> inside a stretched SVG, and the AA maximum mapped to the top of the
// drawing band exactly, at every window, forever.
//
// Its own module because curveSteps.mts is now at the repo max-lines budget too, and the rule
// here is to split rather than ratchet.

import type { Page } from 'playwright-core'
import { check, note } from './appHarness.mjs'

/**
 * The top of the AA plot's drawing band — `PAD_X + BAND_PAD` in levelCharts.tsx. Duplicated rather
 * than imported (no renderer alias under tsx here) because the shape check below needs a number
 * the chart cannot supply about itself: "is the data touching the top edge".
 */
const AA_PLOT_TOP = 18

/** Everything the shape tripwires need, read out of the two plots at whatever window is in force. */
function shapeOf(page: Page): Promise<{
  svgText: number
  labels: string[]
  aaTopY: number
  bands: number
  strip: string
  stripH: number
  coverW: number
  plotW: number
}> {
  return page.evaluate(() => {
    const plots = ['[data-testid="leveling-aa-chart"]', '[data-testid="leveling-level-chart"]']
    const svgText = plots.reduce((n, s) => n + document.querySelectorAll(`${s} svg text`).length, 0)
    const labels = Array.from(document.querySelectorAll('[data-testid="leveling-axis-label"]')).map(
      (e) => e.textContent ?? ''
    )
    const line = document.querySelector<SVGPolylineElement>('[data-testid="leveling-aa-chart"] svg polyline')
    let aaTopY = Number.POSITIVE_INFINITY
    if (line) {
      for (let i = 0; i < line.points.numberOfItems; i++) aaTopY = Math.min(aaTopY, line.points.getItem(i).y)
    }
    const rects = Array.from(
      document.querySelectorAll<SVGRectElement>('[data-testid="leveling-aa-chart"] [data-testid="leveling-zone-band"]')
    )
    const group = document.querySelector('[data-testid="leveling-aa-chart"] [data-testid="leveling-zone-bands"]')
    const svg = document.querySelector<SVGSVGElement>('[data-testid="leveling-aa-chart"] svg')
    return {
      svgText,
      labels,
      aaTopY,
      bands: rects.length,
      strip: group?.getAttribute('data-strip') ?? '',
      stripH: rects[0]?.height.baseVal.value ?? 0,
      coverW: rects.reduce((m, r) => Math.max(m, r.width.baseVal.value), 0),
      plotW: (svg?.viewBox.baseVal.width ?? 0) - 16
    }
  })
}

/**
 * THE SHAPE, ASSERTED — the half of JOS-339 that does not need an eye (run at every window).
 *
 *   1. NO TEXT INSIDE EITHER PLOT. The axis labels moved out of the `preserveAspectRatio="none"`
 *      SVG and into an HTML overlay precisely because everything inside one is scaled by
 *      paneWidth/720. A `<text>` node reappearing in there is the stretched-label regression
 *      coming back, and it is invisible in a DOM dump — this is the only cheap way to catch it.
 *   2. THE LABELS STILL SAY NUMBERS. This ticket was allowed to move labels, never to change what
 *      they say.
 *   3. THE AA CURVE IS NOT ON THE CEILING. Its topmost vertex must sit clear of the top of the
 *      drawing band. Under the old rule the maximum mapped to that edge EXACTLY, at every window,
 *      which is the reported picture; under the padded axis it never can, at any window.
 *   4. A STRIP WITH NOTHING TO DISTINGUISH IS QUIET. Only checked when this window actually is one
 *      zone end to end — on a log that changes zone inside the window the strip is doing its job
 *      and full weight is correct.
 */
export async function checkChartShape(page: Page, window: string): Promise<void> {
  const s = await shapeOf(page)
  check(`${window}: no text is drawn INSIDE the stretched plots (the labels are HTML)`, s.svgText === 0, `${String(s.svgText)} <text> node(s)`)
  check(
    `${window}: …and the axis labels still state plain numbers`,
    s.labels.length > 0 && s.labels.every((t) => /^[\d,]+$/.test(t)),
    s.labels.join(' / ') || 'no labels'
  )
  check(
    `${window}: the AA curve has headroom above it — it is not pinned to the top edge`,
    s.aaTopY > AA_PLOT_TOP + 1,
    `topmost vertex at y=${s.aaTopY.toFixed(1)}, band opens at ${String(AA_PLOT_TOP)}`
  )
  if (s.bands === 1 && s.plotW > 0 && s.coverW >= s.plotW * 0.98) {
    check(`${window}: one zone covering the window reads as quiet context`, s.strip === 'quiet', `${s.strip} strip, ${String(s.stripH)}u tall`)
  } else {
    note(`${window}: ${String(s.bands)} zone band(s) — the strip is distinguishing, so full weight is correct`)
  }
}
