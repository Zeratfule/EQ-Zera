// WHAT THE TWO LEVELING PLOTS DRAW, ON SCREEN — the assertions (JOS-292) and the photographs
// (JOS-339). Two exports, called at two different moments of the spec; the second half's own
// section banner is further down.
//
// THE FRACTIONAL LEVEL CURVE (JOS-292) — the half of that ticket no unit test can
// reach: what is actually in the DOM after a real fold of a real log, and what the readout says
// when the cursor is standing on a stretch the log refused to state.
//
// LIVING NEXT DOOR because leveling.e2e.mts sits AT the repo max-lines budget and the rule here is
// to SPLIT, never ratchet (sliceSteps.mts states the precedent; dropSteps.mts and
// levelingLayoutSteps.mts set it).
//
// WHAT IT PINS, and why each one needs the app rather than a fixture:
//   1. THE PICTURE CHANGED. The level chart used to be the ding series alone — three steps over
//      this window. It now carries a vertex for every stated percentage between them, so the
//      curve must have strictly MORE vertices than the chart has ding markers. That is the
//      ticket's headline stated as an identity rather than as a count that would rot.
//   2. THE DINGS SURVIVED. They are markers now, not the whole plot; a curve that swallowed them
//      would have answered a different ticket.
//   3. NOTHING IS DRAWN OUTSIDE THE PLOT. The y domain grew a level to make room for the live
//      bar's fraction, which is exactly the kind of change that puts a vertex over the panel
//      above — the same geometric tripwire `bandsOutsidePlot` is for the zone strip.
//   4. THE REFUSALS ARE VISIBLE AND EMPTY. The committed window carries unstated experience lines
//      (`You gain experience!` with no percent), so an uncertainty band must exist — and NOT ONE
//      CURVE VERTEX may sit inside one. "Never interpolate through them" is a claim about pixels,
//      and this is that claim read back out of the pixels.
//   5. THE READOUT AGREES WITH THE PICTURE. Hovering inside a band must print the refusal, not a
//      percentage; hovering on the curve must print a bar position. A tooltip naming a bar
//      position over a span the chart shaded out is the standing sin of this chart
//      (levelCharts.tsx's honesty fix) and it is the one thing here worth catching in the app.
//
// Floors and identities only, never today's numbers (AGENTS.md: frozen numbers rot).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from 'playwright-core'
import { ARTIFACTS, check, countOf, hoverAt, note, settle, settleCount, settleGone, settleStable } from './appHarness.mjs'
// The JOS-339 shape tripwires the camera fires at every window — next door, same line budget rule.
import { checkChartShape } from './chartShapeSteps.mjs'

const CURVE = '[data-testid="leveling-curve-run"]'
const DING = '[data-testid="leveling-level-ding"]'
const GAP = '[data-testid="leveling-curve-gap"]'
const TOOLTIP = '[data-testid="chart-tooltip"]'

/** The four refusals levelCurve.ts can report — the vocabulary levelEta already speaks. */
const REFUSALS = ['unstated', 'overfull', 'clipped', 'swapped']

interface CurveGeometry {
  /** every curve vertex, in viewBox user units. */
  points: { x: number; y: number }[]
  /** every uncertainty band, in the same units. */
  gaps: { kind: string; x: number; w: number }[]
  /** the plot's own viewBox, so "inside the plot" is asked in the chart's own coordinates. */
  vbW: number
  vbH: number
}

/**
 * Read the drawn curve straight out of the SVG.
 *
 * The polylines are `preserveAspectRatio="none"`, so CSS pixels are NOT viewBox units — the
 * whole reason `pxToUser` exists. Everything here therefore stays in the viewBox coordinates the
 * geometry was written in, and only the hover fractions below cross back into screen space.
 */
function curveGeometry(page: Page, sels: { curve: string; gap: string }): Promise<CurveGeometry> {
  return page.evaluate((s) => {
    const lines = Array.from(document.querySelectorAll<SVGPolylineElement>(s.curve))
    const points: { x: number; y: number }[] = []
    for (const line of lines) {
      for (let i = 0; i < line.points.numberOfItems; i++) {
        const p = line.points.getItem(i)
        points.push({ x: p.x, y: p.y })
      }
    }
    const gaps = Array.from(document.querySelectorAll<SVGRectElement>(s.gap)).map((r) => ({
      kind: r.getAttribute('data-kind') ?? '',
      x: r.x.baseVal.value,
      w: r.width.baseVal.value
    }))
    const svg = lines[0]?.ownerSVGElement ?? document.querySelector<SVGSVGElement>(s.gap)?.ownerSVGElement
    return { points, gaps, vbW: svg?.viewBox.baseVal.width ?? 0, vbH: svg?.viewBox.baseVal.height ?? 0 }
  }, sels)
}

/** The rendered tooltip text, whitespace-folded; '' when no card is up. */
function tooltipText(page: Page): Promise<string> {
  return page.evaluate(
    (s) => ((document.querySelector(s) as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    TOOLTIP
  )
}

/**
 * Hover at a viewBox X and read the card. The chart stretches, so the viewBox coordinate is
 * converted to a FRACTION of the element and handed to `hoverAt`, which is the helper that
 * clips against every scrolling ancestor and verifies the point with `elementFromPoint` (the
 * fix that made this chart reachable at all — see leveling.e2e.mts's `dragRange`).
 */
async function readAt(page: Page, chart: string, ux: number, vbW: number): Promise<string> {
  await page.mouse.move(2, 2)
  await settleGone(page, TOOLTIP, { timeoutMs: 5000 })
  if (!(await hoverAt(page, chart, ux / vbW, 0.55))) return ''
  // The card's own presence is the condition, never a sleep (the standing e2e law).
  await settleCount(page, TOOLTIP, 1, { timeoutMs: 8000 })
  return tooltipText(page)
}

/**
 * 3b. THE CURVE — mounted, denser than the dings it is anchored on, inside its own plot, and
 * honest about the stretches it will not draw.
 */
export async function stepLevelCurve(page: Page, chart: string): Promise<void> {
  const geo = await curveGeometry(page, { curve: CURVE, gap: GAP })
  const dings = await countOf(page, DING)
  if (
    !check(
      'the level chart draws a curve',
      geo.points.length > 0,
      `${String(geo.points.length)} vertices over ${String(dings)} ding markers`
    )
  ) {
    return
  }

  // 1. THE HEADLINE, as an identity: the picture carries the game's own percentages, so it has
  // strictly more vertices than the ding series that used to be the whole of it. (The step-after
  // rendering emits two vertices per sample, so the ding series ALONE would already be 2xdings —
  // the floor is deliberately above that.)
  check(
    'the curve carries the stated percentages between dings, not just the dings',
    geo.points.length > Math.max(4, dings * 2),
    `${String(geo.points.length)} vertices vs ${String(dings)} dings`
  )
  check('…and the dings are still drawn, as markers on it', dings > 0, `${String(dings)} markers`)

  // 3. INSIDE THE PLOT. The y domain grew a level to give the live bar's fraction somewhere to
  // be; a vertex outside the viewBox means the axis and the curve stopped agreeing.
  const outside = geo.points.filter((p) => p.x < -0.01 || p.x > geo.vbW + 0.01 || p.y < -0.01 || p.y > geo.vbH + 0.01)
  check(
    'every curve vertex is inside the plot it is drawn in',
    outside.length === 0,
    `${String(outside.length)} of ${String(geo.points.length)} outside ${String(geo.vbW)}x${String(geo.vbH)}`
  )

  await stepCurveRefusals(page, chart, geo)
}

/** 4 + 5. The uncertainty bands, and the readout standing on one. */
async function stepCurveRefusals(page: Page, chart: string, geo: CurveGeometry): Promise<void> {
  if (geo.gaps.length === 0) {
    // A legitimate outcome on a log whose every experience line states a percentage — the WL40
    // farm run is exactly that shape. Nothing to draw is not a half-drawn feature.
    note('every experience line in this window stated its percentage, so the curve draws no uncertainty band this run')
    return
  }
  const kinds = [...new Set(geo.gaps.map((g) => g.kind))]
  check(
    'each uncertainty band names WHY the log could not place it',
    kinds.every((k) => REFUSALS.includes(k)),
    `[${kinds.join(', ')}]`
  )

  // THE CLAIM, READ BACK OUT OF THE PIXELS: not one vertex inside a refused span. A dashed
  // interpolation across an unstated line would put dozens here.
  const inside = geo.points.filter((p) => geo.gaps.some((g) => p.x > g.x + 0.01 && p.x < g.x + g.w - 0.01))
  check(
    'no curve vertex is drawn inside a span the log did not state (nothing is interpolated through one)',
    inside.length === 0,
    `${String(inside.length)} of ${String(geo.points.length)} vertices inside a band`
  )

  // 5. THE READOUT. Widest band, so the hover has room to land inside it whatever the window.
  const widest = geo.gaps.reduce((m, g) => (g.w > m.w ? g : m), geo.gaps[0])
  if (widest.w < 12) {
    note('the widest uncertainty band is under 12 user units — too narrow to land a cursor inside honestly, so the readout assertion is skipped this run')
    return
  }
  const refused = await readAt(page, chart, widest.x + widest.w / 2, geo.vbW)
  if (!check('the hover readout resolves a cursor inside an uncertainty band', refused.length > 0)) return
  check(
    'standing on a refused span, the readout says so instead of naming a bar position',
    refused.includes('unstated') && !/into the bar\s*\d/.test(refused),
    refused.slice(0, 160)
  )

  // …and the other side of the same claim: on the curve itself there IS a bar position. The
  // MEDIAN clear vertex, not the first: the first is a run's anchor, which sits exactly on a
  // ding and legitimately reads 0.0% — a true answer that proves nothing about the accumulation.
  const clear = geo.points.filter((p) => !geo.gaps.some((g) => p.x >= g.x && p.x <= g.x + g.w)).sort((a, b) => a.x - b.x)
  const onCurve = clear[Math.floor(clear.length / 2)] as { x: number; y: number } | undefined
  if (!onCurve) return
  const stated = await readAt(page, chart, onCurve.x, geo.vbW)
  check(
    '…and standing on the curve it names one',
    stated.includes('into the bar'),
    stated.slice(0, 160)
  )
  await page.mouse.move(2, 2)
  await settleGone(page, TOOLTIP, { timeoutMs: 5000 })
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// THE CAMERA (JOS-339) — the same two plots, PHOTOGRAPHED.
//
// WHY A SPEC STEP TAKES PICTURES. JOS-339 reports that these charts regressed as a LOOK at short
// windows, and its acceptance criterion is the OWNER'S EYE: no assertion in this suite can rule on
// whether a plot reads as a chart. So the step below produces EVIDENCE rather than a verdict —
// three PNGs of the chart column at three window shapes, into the same artifacts/<runId>/<spec>/
// tree every other artifact lands in, so a reviewer can put the before run beside the after run.
//
// THREE WINDOWS, AND WHY THOSE THREE (the ticket names them):
//   • a 12-MINUTE slice — the shape in the owner's screenshot, and the one the geometry got most
//     wrong: two AA gained, one level's worth of curve, one zone covering the whole domain.
//   • ~1 HOUR — the narrowest PRESET rung the control offers, where most short sessions land.
//   • ALL — the full history, the picture that must NOT change character while the short ones are
//     being fixed.
// The 12-minute one goes through the CUSTOM range (JOS-332's scope seam): the preset ladder stops
// at 1h, and twelve minutes is a window only the two datetime fields can say.
//
// IT SHOOTS WIDE ON PURPOSE. The plots draw at a fixed 720u viewBox with preserveAspectRatio=none,
// so everything inside them is scaled by paneWidth/720. The owner's window is far wider than the
// 1280 the harness launches at, which is why stretched axis text is glaring on their screen and
// nearly invisible at the default size. The step widens the window for the shots and puts it back.
//
// EQ_E2E_SHOT_TAG names the run in the file name (before-12m.png, after-all.png, …). Unset, the
// shots are just shot-*.png; the run directory already separates runs, the tag is for the human.
/** The tab's own slice bar and the two plots — the band the shots frame. */
const SLICE = '[data-testid="leveling-slice"]'
const SLICE_WINDOW = '[data-testid="leveling-slice-window"]'
const AA_CHART = '[data-testid="leveling-aa-chart"]'
const LEVEL_CHART = '[data-testid="leveling-level-chart"]'
const LEGEND = '[data-testid="leveling-zone-legend"]'
/** The app shell's ONE scroller (JOS-289) — the charts live inside it, not in the document. */
const SCROLLER = '[data-testid="app-content"]'

/** The viewBox width both plots draw at (levelChartGeometry.CHART_W). Duplicated rather than
 *  imported: the e2e tree runs under tsx with no `@renderer` alias, and one number that the
 *  note below only DESCRIBES is not worth a second module boundary. */
const VIEWBOX_W = 720

/**
 * Wide enough that paneWidth/720 is unmistakably greater than 1 — see the header — and CLAMPED to
 * the display at run time by `shotSize` below.
 *
 * MEASURED THE HARD WAY: asking for 1800x1040 on a 1920x1080 desktop lands within a hair of the
 * work area, and Windows answers a `setBounds` that big by MAXIMIZING the window. A maximized
 * window then ignores every later `setBounds` — so the restore silently did nothing and the narrow
 * layout step ran at 1800px and failed. The clamp and the `unmaximize()` in `resizeTo` are both
 * that bug; either alone would leave the trap armed on a different-sized desktop.
 */
const SHOT_W = 1800
const SHOT_H = 1040
/** Kept clear of the work area's edges so the OS never reads the request as "maximize". */
const SCREEN_MARGIN = 120

const SHOT_TAG = process.env.EQ_E2E_SHOT_TAG ?? 'shot'

/** `datetime-local` wants LOCAL wall-clock parts, exactly as SliceBar's own `toLocalInput` writes
 *  them — `toISOString` here would hand the field a different minute than the app is showing. */
function toLocalInput(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Resize and WAIT FOR THE CONDITION, the same two-stage wait `levelingLayoutSteps.mts` documents:
 * the renderer's own viewport first (a resize crosses Electron, the OS, Chromium and React before
 * any box moves), and only then the drawn geometry settling.
 */
async function resizeTo(app: ElectronApplication, page: Page, width: number, height: number): Promise<number> {
  const win = await app.browserWindow(page)
  await win.evaluate((w, b) => {
    // See SHOT_W: a maximized window ignores setBounds, and a wide-enough request maximizes it.
    if (w.isMaximized()) w.unmaximize()
    w.setBounds({ ...w.getBounds(), width: b.w, height: b.h })
  }, { w: width, h: height })
  const got = await settle(
    () => page.evaluate(() => document.documentElement.clientWidth),
    (v) => Math.abs(v - width) <= 24,
    { timeoutMs: 15_000 }
  )
  await settleStable(() => plotGeometry(page).then((g) => JSON.stringify(g)), { timeoutMs: 15_000 })
  return got
}

/** The shot size this desktop can actually hold — see SHOT_W for what happens when it cannot. */
async function shotSize(app: ElectronApplication): Promise<{ w: number; h: number }> {
  const area = await app
    .evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize)
    .catch(() => ({ width: SHOT_W, height: SHOT_H }))
  return {
    w: Math.max(1280, Math.min(SHOT_W, area.width - SCREEN_MARGIN)),
    h: Math.max(800, Math.min(SHOT_H, area.height - SCREEN_MARGIN))
  }
}

/** The two plots' boxes — the thing that must stop moving before a shutter opens. */
function plotGeometry(page: Page): Promise<{ w: number; h: number }[]> {
  return page.evaluate((sels) =>
    sels.flatMap((s) =>
      Array.from(document.querySelectorAll(s)).map((el) => {
        const r = el.getBoundingClientRect()
        return { w: Math.round(r.width), h: Math.round(r.height) }
      })
    ), [AA_CHART, LEVEL_CHART])
}

/**
 * Scroll the app's content area so the slice bar sits just under its top edge.
 *
 * Not `scrollIntoViewIfNeeded`: that promises the element is VISIBLE, and what a shot needs is the
 * whole band — control, both plots, legend — inside one viewport in a known place. Setting the
 * scroller's own offset is the only way to ask for that.
 */
async function alignToSlice(page: Page): Promise<void> {
  await page.evaluate(([scrollerSel, sliceSel]) => {
    const sc = document.querySelector(scrollerSel)
    const el = document.querySelector(sliceSel)
    if (!sc || !el) return
    sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 10
  }, [SCROLLER, SLICE])
  await settleStable(() => plotGeometry(page).then((g) => JSON.stringify(g)), { timeoutMs: 8_000 })
}

interface Clip {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The union of whichever of `sels` are on screen, clamped to the viewport and given a small margin.
 *
 * Clamped because `page.screenshot({clip})` is asked in VIEWPORT coordinates and a clip that runs
 * off the bottom fails the call outright — and a chart column that does not quite fit is a smaller
 * picture, never a lost one.
 */
function unionRect(page: Page, sels: readonly string[], pad = 12): Promise<Clip | null> {
  return page.evaluate((arg: { sels: string[]; pad: number }) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const s of arg.sels) {
      const el = document.querySelector(s)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      x0 = Math.min(x0, r.left)
      y0 = Math.min(y0, r.top)
      x1 = Math.max(x1, r.right)
      y1 = Math.max(y1, r.bottom)
    }
    if (!Number.isFinite(x0)) return null
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const x = Math.max(0, Math.floor(x0 - arg.pad))
    const y = Math.max(0, Math.floor(y0 - arg.pad))
    return {
      x,
      y,
      width: Math.max(1, Math.min(vw - x, Math.ceil(x1 - x0 + arg.pad * 2))),
      height: Math.max(1, Math.min(vh - y, Math.ceil(y1 - y0 + arg.pad * 2)))
    }
  }, { sels: [...sels], pad })
}

/**
 * THE SHUTTER, and the two ways a never-shown window lies to one.
 *
 * `page.screenshot()` is the obvious call and it waits on the RENDERER's compositor. This window is
 * never shown, so its frame production is throttled to whatever happens to be repainting: measured
 * on the first capture run, two of three shots landed and the third timed out after ten seconds
 * waiting for a frame that never came — and the failed call left its device-metrics override
 * behind, so the NEXT shot came out framed on the whole window instead of on its clip.
 *
 * `webContents.capturePage()` asks the BROWSER process for the surface it already holds. It never
 * hangs and never leaves an override — but it will hand back a STALE surface just as happily,
 * which is the second run's failure: the 1h shot was a pixel-perfect copy of the 12m one, taken
 * after the caption had already changed.
 *
 * So the shutter does both halves of the job: `invalidate()` schedules a real repaint, a warm-up
 * capture pulls the new surface across, and the picture is REJECTED IF IT IS BYTE-IDENTICAL TO THE
 * PREVIOUS WINDOW'S. Three windows of one chart cannot legitimately produce the same pixels, so an
 * exact repeat is proof of staleness rather than a coincidence worth keeping.
 */
let lastShot = ''

/**
 * THE PICTURE THAT ALWAYS LANDS: the chart column as a STANDALONE HTML page.
 *
 * Every pixel path out of a window that is never shown turned out to be unreliable, and each in a
 * different direction — `page.screenshot` hangs waiting for a frame and leaves a device-metrics
 * override behind that pins the viewport for later steps; `capturePage` returns whatever surface
 * the browser process is holding, which can be a window out of date; `Page.captureScreenshot` with
 * `fromSurface:false` through a raw CDP session hung the spec outright. `dumpArtifacts` already
 * says the quiet part in its own comment: the HTML is the evidence that matters and the PNG is a
 * bonus with a three-second budget.
 *
 * So the primary artifact is a self-contained page: every `<style>` the app has injected (MUI's
 * emotion sheets included), then the chart column's own markup, on the app's background at the
 * exact pane width it was measured at. It opens in any browser, it is byte-for-byte what the
 * renderer built, and — this matters for the axis-text half of the ticket — the reviewer can drag
 * the browser window and watch the labels at any pane width, which no PNG can show.
 */
function writeColumnHtml(page: Page, path: string, width: number): Promise<boolean> {
  return page
    .evaluate((arg: { sels: { sel: string; paper: boolean }[]; width: number }) => {
      // `paper: true` walks up to the panel the plot lives in, so the picture carries the title and
      // the caption that say what the reader is looking at.
      const parts = arg.sels
        .map((s) => {
          const el = document.querySelector(s.sel)
          if (!el) return ''
          return (s.paper ? (el.closest('.MuiPaper-root') ?? el) : el).outerHTML
        })
        .filter((h) => h.length > 0)
      if (parts.length === 0) return ''
      // THE RULES, NOT THE TAGS. Emotion (MUI's engine) inserts its rules through `insertRule` in
      // production, so every `<style>` element in this document has EMPTY text content — the first
      // cut of this artifact shipped four blank style tags and a page of unstyled markup. The rules
      // are only reachable through the CSSOM.
      const styles = Array.from(document.styleSheets)
        .map((sheet) => {
          try {
            return Array.from(sheet.cssRules)
              .map((r) => r.cssText)
              .join('\n')
          } catch {
            return ''
          }
        })
        .join('\n')
      const bg = getComputedStyle(document.body).backgroundColor
      return [
        '<!doctype html><meta charset="utf-8">',
        `<style>${styles}</style>`,
        `<body style="margin:0;padding:16px;background:${bg}">`,
        `<div style="width:${String(arg.width)}px">${parts.join('')}</div>`
      ].join('\n')
    }, {
      sels: [
        { sel: SLICE_WINDOW, paper: false },
        { sel: AA_CHART, paper: true },
        { sel: LEVEL_CHART, paper: true }
      ],
      width
    })
    .then((html) => {
      if (!html) return false
      writeFileSync(path, html, 'utf8')
      console.log(`artifact: ${path}`)
      return true
    })
    .catch(() => false)
}

/**
 * …and the PNG beside it, BEST EFFORT ONLY.
 *
 * `capturePage` is the one pixel path that cannot hang and cannot leave an override behind, so it
 * is the only one used. Before it fires, the content area is scrolled by a pixel and back: a scroll
 * dirties the compositor, which is the cheapest honest way to make a never-shown window paint. The
 * result is rejected if it is byte-identical to the previous window's — three windows of one chart
 * cannot legitimately produce the same pixels — and a rejected shot is a note, never a failure. The
 * HTML above is the artifact the acceptance rests on.
 */
async function shootPng(app: ElectronApplication, page: Page, path: string, clip: Clip): Promise<boolean> {
  const win = await app.browserWindow(page)
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate((s) => {
      const sc = document.querySelector(s)
      if (sc) sc.scrollTop += 1
    }, SCROLLER)
    await page.evaluate((s) => {
      const sc = document.querySelector(s)
      if (sc) sc.scrollTop -= 1
    }, SCROLLER)
    const b64 = await win
      .evaluate(async (w, r) => {
        const wait = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))
        w.webContents.invalidate()
        await wait(300)
        // TWO CAPTURES. The first pulls the surface across (and on this window frequently returns
        // an empty image doing it); the second is the one worth keeping.
        await w.webContents.capturePage(r).catch(() => undefined)
        await wait(200)
        const img = await w.webContents.capturePage(r)
        return img.isEmpty() ? '' : img.toPNG().toString('base64')
      }, clip)
      .catch(() => '')
    if (b64 && b64 !== lastShot) {
      lastShot = b64
      writeFileSync(path, Buffer.from(b64, 'base64'))
      console.log(`artifact: ${path}`)
      return true
    }
  }
  return false
}

/** One window, photographed: the standalone page always, the PNG when the surface cooperates.
 *  Returns the artifact stem, or null when even the markup could not be read. */
async function shoot(app: ElectronApplication, page: Page, window: string): Promise<string | null> {
  await alignToSlice(page)
  const clip = await unionRect(page, [SLICE, AA_CHART, LEVEL_CHART, LEGEND])
  if (!clip) return null
  mkdirSync(ARTIFACTS, { recursive: true })
  const stem = join(ARTIFACTS, `${SHOT_TAG}-${window}`)
  const wrote = await writeColumnHtml(page, `${stem}.html`, clip.width)
  if (!(await shootPng(app, page, `${stem}.png`, clip))) {
    note(`chart shot "${window}": no PNG — the surface never moved off the previous window's`)
  }
  return wrote ? `${stem}.html` : null
}

/** The caption the slice bar prints — the window in words, and the thing that must CHANGE when a
 *  different one is picked. */
function windowText(page: Page): Promise<string> {
  return page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', SLICE_WINDOW)
}

/** Pick a preset rung and wait for the caption to move off `from`; null when this log has no such
 *  rung to offer (the control renders only the windows the record can fill). */
async function pickPreset(page: Page, id: string, from: string): Promise<string | null> {
  const button = `[data-testid="leveling-slice-${id}"]`
  if ((await page.locator(button).count()) === 0) return null
  await page.click(button, { timeout: 10_000 })
  return settle(() => windowText(page), (t) => t !== from, { timeoutMs: 10_000 })
}

/**
 * A window of exactly `minutes`, ending where the record does, through the CUSTOM fields.
 *
 * `custom` with nothing typed into it resolves to the WHOLE record (shared/timeslice.ts), so the
 * `To` field already holds the last instant this log knows about — the short slice is that value
 * minus the span, which is precisely how a user reaches the shape in the owner's report.
 */
async function pickCustomMinutes(page: Page, minutes: number, from: string): Promise<string | null> {
  const button = '[data-testid="leveling-slice-custom"]'
  if ((await page.locator(button).count()) === 0) return null
  await page.click(button, { timeout: 10_000 })
  const toField = '[data-testid="leveling-slice-custom-to"] input'
  const gotTo = await page.locator(toField).first().inputValue().catch(() => '')
  const t1 = new Date(gotTo).getTime()
  if (!Number.isFinite(t1)) return null
  await page.fill('[data-testid="leveling-slice-custom-from"] input', toLocalInput(t1 - minutes * 60_000), { timeout: 10_000 })
  return settle(() => windowText(page), (t) => t !== from && t.length > 0, { timeoutMs: 10_000 })
}

/** One window to photograph: what to call the file, and how to get the tab into that window.
 *  `go` returns the caption it landed on, or null when this log cannot offer that window at all. */
interface ShotPlan {
  name: string
  why: string
  go: (from: string) => Promise<string | null>
}

/**
 * THE THREE, in the order the ticket names them — short FIRST, because it is the reported shape and
 * the one worth having even if a later window somehow fails to settle.
 */
function planFor(page: Page): ShotPlan[] {
  return [
    { name: '12m', why: 'no 12-minute custom window this log can define', go: (f) => pickCustomMinutes(page, 12, f) },
    { name: '1h', why: 'no 1h rung offered for this log', go: (f) => pickPreset(page, 'h1', f) },
    { name: 'all', why: 'no All rung — impossible, but not assumed', go: (f) => pickPreset(page, 'all', f) }
  ]
}

/**
 * THE STEP. Three shots, then the window and the slice put back exactly as they were found.
 *
 * It asserts only what a camera can honestly assert — that there was something to photograph at
 * each window and that the file landed. The shape of what is in the frame is what the OWNER rules
 * on; the tripwires that keep the fixed shape from regressing again live in the spec's own steps.
 */
export async function stepChartShots(app: ElectronApplication, page: Page): Promise<void> {
  const win = await app.browserWindow(page)
  const was = await win.evaluate((w) => w.getBounds())
  let from = await windowText(page)
  const shots: string[] = []
  try {
    const size = await shotSize(app)
    const width = await resizeTo(app, page, size.w, size.h)
    const pane = (await plotGeometry(page))[0]?.w ?? 0
    note(
      `chart shots at ${String(width)}px of viewport: the plot pane measures ${String(pane)}px ` +
        `against a ${String(VIEWBOX_W)}u viewBox — everything drawn inside it is scaled ` +
        `${(pane / VIEWBOX_W).toFixed(2)}x horizontally`
    )
    for (const plan of planFor(page)) {
      const landed = await plan.go(from)
      if (landed === null) {
        note(`${plan.name} shot skipped — ${plan.why}`)
        continue
      }
      from = landed
      const path = await shoot(app, page, plan.name)
      if (path) shots.push(path)
      await checkChartShape(page, plan.name)
      note(`${plan.name} window: ${landed}`)
    }
    check(
      'the chart column was photographed at every window shape the ticket names',
      shots.length === 3,
      shots.length === 3 ? shots.map((s) => s.split(/[\\/]/).pop()).join(' · ') : `${String(shots.length)}/3 shots`
    )
  } finally {
    // The window goes back whatever happened above — everything after this step measures boxes.
    await resizeTo(app, page, was.width, was.height).catch(() => 0)
    await page.click('[data-testid="leveling-slice-all"]', { timeout: 10_000 }).catch(() => undefined)
    await settleStable(() => plotGeometry(page).then((g) => JSON.stringify(g)), { timeoutMs: 10_000 }).catch(() => '')
  }
}

