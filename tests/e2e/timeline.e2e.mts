/**
 * Headless Electron integration test for the COMBAT TIMELINE's SIZING — the owner's
 * "the combat timeline flickers when its surface is smaller than the timeline; it moves back and
 * forth quickly" (2026-08-04).
 *
 * WHY ITS OWN SPEC rather than another step in combat-dashboard.e2e.mts: that file and its
 * harness are both at the 400-code-line factoring ceiling, and this needs the window RESIZED to
 * cramped sizes — a state no other assertion there wants to share.
 *
 * WHAT THE BUG WAS, and therefore what this measures. `timelineMetrics` derives lane height from
 * the available HEIGHT, and the left label gutter steps 132 → 148 → 168px as lane height crosses
 * 26 / 32 — so once the plot is clamped at its minimum width, the SVG's WIDTH is a step function
 * of the measured HEIGHT. Pointing the ResizeObserver at the SCROLLING box closed a loop through
 * Chromium's layout: the SVG overflows → a scrollbar appears → the measured content box loses
 * 12px on the CROSS axis → lane height drops under a gutter threshold → the SVG narrows → it
 * fits → the scrollbar leaves → the box grows back → forever. tests/timelineGeometry.test.mts
 * pins that arithmetic (it finds hundreds of container sizes with no fixed point); this spec
 * pins the DOM the arithmetic runs in.
 *
 * FOUR ASSERTIONS PER SIZE, and the third is the one that cannot rot:
 *   1. the chart's WIDTH never moves at a fixed window size — the loop's fingerprint, and the one
 *      dimension a LIVE fight cannot change (new lanes make it taller, never wider);
 *   2. no geometry value is REVISITED across six samples — the general form of "it oscillates",
 *      stated so that a live fight growing monotonically taller is not mistaken for one;
 *   3. the MEASURED element is not a scroll container at all (`overflow: visible`), which is what
 *      makes 1–2 structural rather than lucky. A debounce would satisfy them for a while and
 *      still be an oscillation;
 *   4. the frame keeps a usable box — the absolutely-positioned scroller leaves it with a flex
 *      basis of 0, so without its `minHeight` floor a short window resolves it to 0px and the
 *      chart disappears (MEASURED at 900×420 while building this).
 *
 * Sizes are deliberately CRAMPED — the report is specifically about a surface smaller than the
 * timeline — and the window minimum is lifted to reach them, exactly as the responsive step in
 * the dashboard spec does.
 *
 * HONESTY: the Timeline view needs a selected fight that actually has an event ring. A quiet log
 * may have none; that is `note()`d and the size assertions are skipped, never faked.
 *
 * Run: `npm run test:e2e`.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleCount,
  settleStable,
  snapshot,
  sleep,
  timelineDisabled,
  waitHydrated
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

/** The window sizes to measure at. 520x320 is well under the app's own 900x600 minimum. */
const SIZES = [
  { width: 900, height: 420 },
  { width: 760, height: 640 },
  { width: 620, height: 360 },
  { width: 520, height: 320 }
]

/** One sample of the timeline's geometry: what was measured, and what got drawn. */
interface TlGeom {
  /** the observed frame's content box — what the ResizeObserver reports */
  fw: number
  fh: number
  /** the frame's own overflow: 'visible' is the point — it can never gain a scrollbar */
  overflow: string
  /** the `<svg>`'s attribute size */
  sw: number
  sh: number
}

function timelineGeom(page: Page): Promise<TlGeom | null> {
  return page.evaluate(() => {
    const frame = document.querySelector('[data-testid="timeline-frame"]')
    // The plot SVG carries no testid and the view is full of MUI icon svgs, so it is identified
    // by the clip path only it owns (CombatTimeline.tsx).
    const svg = document.querySelector('svg:has(#tl-plot-clip)')
    if (!frame || !svg) return null
    const s = getComputedStyle(frame)
    return {
      fw: Math.round(frame.clientWidth),
      fh: Math.round(frame.clientHeight),
      overflow: `${s.overflowX}/${s.overflowY}`,
      sw: Math.round(Number(svg.getAttribute('width') ?? 0)),
      sh: Math.round(Number(svg.getAttribute('height') ?? 0))
    }
  })
}

/**
 * Did any value come BACK after something else intervened? That is what an oscillation is, and
 * it is the one signature a legitimate change cannot produce: a LIVE fight gains lanes while the
 * samples are taken, which makes the chart monotonically taller — new values, never a revisit.
 */
function revisited(keys: string[]): string {
  const seen = new Set<string>()
  let prev = ''
  for (const k of keys) {
    if (k !== prev && seen.has(k)) return `${k} returns after ${prev}`
    seen.add(k)
    prev = k
  }
  return ''
}

/**
 * THE ONE PLACE IN THIS SUITE WHERE A TIMER IS THE INSTRUMENT, not a bet (wave E3 keeps it).
 *
 * Everywhere else a sleep is a guess at how long a change takes; here the SUBJECT is change over
 * time. An oscillation is a value that comes back, and the only way to see one is to sample the
 * geometry repeatedly with the clock running. A condition wait would be the wrong tool: there is
 * no state to wait for — the whole claim is that the state stops moving and stays stopped.
 */
const SAMPLE_GAP_MS = 160

async function checkAtSize(page: Page, tag: string): Promise<void> {
  const samples: TlGeom[] = []
  for (let i = 0; i < 6; i++) {
    const g = await timelineGeom(page)
    if (g) samples.push(g)
    await sleep(SAMPLE_GAP_MS)
  }
  if (!check(`[${tag}] the timeline chart is mounted`, samples.length === 6, `${String(samples.length)}/6 samples`)) {
    return
  }
  const keys = samples.map((s) => `${String(s.fw)}x${String(s.fh)}→${String(s.sw)}x${String(s.sh)}`)
  // THE FLICKER'S FINGERPRINT. The loop was driven by the label gutter stepping with lane
  // height, so what oscillated was the chart's WIDTH — and width is exactly what a live fight's
  // new lanes cannot change (they make it taller). A constant width at a fixed window size is
  // therefore the sharp assertion; the revisit test below is the general one.
  const widths = [...new Set(samples.map((s) => `${String(s.fw)}/${String(s.sw)}`))]
  check(`[${tag}] the chart's WIDTH never moves at a fixed window size`, widths.length === 1, widths.join(' | '))
  const back = revisited(keys)
  check(`[${tag}] no geometry is revisited — the measure→scrollbar→measure loop is gone`, back === '', back)
  check(
    `[${tag}] the MEASURED frame is not a scroller, so no scrollbar can change it`,
    samples[0].overflow === 'visible/visible',
    samples[0].overflow
  )
  check(
    `[${tag}] …and the frame keeps a usable box (it never collapses to 0)`,
    samples[0].fh >= 120 && samples[0].fw >= 100,
    `${String(samples[0].fw)}x${String(samples[0].fh)}`
  )
}

async function run(app: ElectronApplication, page: Page): Promise<void> {
  await page.click('[data-testid="nav-combat"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="segment-select"]', { timeout: 60_000 })

  const { snap } = await waitHydrated(page)
  if (!check('hydration completes (replay hands off to the live tail)', !snap.hydrating)) return

  // THE WORLD MUST HOLD STILL BEFORE THE FLICKER MEASUREMENT BEGINS. A fixture replays in
  // milliseconds, so the engine's idle-close of the slice's last encounter now lands AFTER
  // hydration rather than long before it — and a fight finalizing mid-sample relabels the chart,
  // which steps the label gutter and reads exactly like the oscillation this spec hunts
  // (MEASURED 2026-08-06 at 760x640: a single 602→462 step, ~1.5s in, surviving a 0.9s quiet
  // gate). So wait for the last fight to close: after that, nothing but the window size can
  // change the geometry, which is precisely the claim.
  const settledWorld = await settle(
    () => snapshot(page),
    (s) => !s.segments.some((seg) => seg.kind === 'current'),
    { timeoutMs: 90_000, pollMs: 500 }
  )
  check(
    'the fixture’s last fight has closed — nothing but the window can move the chart now',
    !settledWorld.segments.some((s) => s.kind === 'current'),
    settledWorld.segments.find((s) => s.kind === 'current')?.name ?? 'none open'
  )

  // The Timeline is only offered once a selection HAS an event ring; that resolution is a couple
  // of IPC hops after the handoff, so wait for the answer instead of sleeping past it.
  if (await settle(() => timelineDisabled(page), (d) => !d, { timeoutMs: 15_000 })) {
    note('no selection with an event ring in this fixture — the Timeline view is disabled, so its sizing cannot be measured')
    return
  }
  await page.click('[data-testid="view-toggle"] button:nth-child(2)')
  await settleCount(page, '[data-testid="timeline-frame"]', 1, { timeoutMs: 15_000 })

  const win = await app.browserWindow(page)
  const wide = await win.evaluate((w) => w.getBounds())
  await win.evaluate((w) => { w.setMinimumSize(400, 300) })
  for (const size of SIZES) {
    // The resize, the ResizeObserver callback and React's render all have to land BEFORE the
    // samples start, or the first sample legitimately differs from the rest and reads as a
    // flicker. "Settled" ALONE is not that signal — the pre-resize geometry is perfectly stable
    // and would satisfy it three times over, and then the real layout would arrive mid-sample
    // (MEASURED 2026-08-06: a 602→462 step inside the sample window, reported as a moving width).
    // So: wait for the frame to actually BE the new size, and only then for it to hold still.
    const was = (await timelineGeom(page))?.fw ?? -1
    await win.evaluate((w, b) => { w.setBounds(b) }, { ...wide, ...size })
    await settle(() => timelineGeom(page), (g) => g !== null && g.fw !== was, { timeoutMs: 15_000 })
    // …and then HOLD STILL, which is the part that has to be generous here.
    //
    // The frame takes the window's new size SYNCHRONOUSLY; the SVG is redrawn by React off the
    // ResizeObserver, and MEASURED 2026-08-06 that redraw can be a full second behind on a
    // hidden, non-compositing window (a 602→462 step, deterministic, at 760x640 coming down from
    // 900x420 — while a fresh window at the same size converges inside 100 ms and then holds for
    // eight seconds). So the STALE geometry is itself stable for about a second, and a short
    // agreement window would settle on it and then report the catch-up as a flicker. 12 readings
    // 150 ms apart is ~1.8 s of genuine quiet — a real measurement rather than the flat 1500 ms
    // sleep it replaces, and one that a real oscillation could never satisfy.
    await settleStable(() => timelineGeom(page), { timeoutMs: 20_000, stable: 12, pollMs: 150 })
    await checkAtSize(page, `${String(size.width)}x${String(size.height)}`)
  }
  await win.evaluate((w, b) => {
    w.setMinimumSize(900, 600)
    w.setBounds(b)
  }, wide)
  await settleStable(() => timelineGeom(page), { timeoutMs: 15_000 })
}

async function main(): Promise<void> {
  buildIfStale()

  console.log('launch: hidden Electron (EQ_E2E=1) against tests/fixtures/e2e-timeline.log…')
  const { app, close } = await launchOnFixture('e2e-timeline.log')

  let page: Page | null = null
  try {
    page = await mainWindow(app)
    const consoleErrors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })
    page.on('pageerror', (e) => consoleErrors.push(String(e)))

    await run(app, page)

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
    if (failures.length) await dumpArtifacts(page, 'timeline-FAIL')
  } finally {
    await close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
