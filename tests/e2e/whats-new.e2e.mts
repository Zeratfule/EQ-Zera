/**
 * WHAT'S NEW, driven through the real app (JOS-73).
 *
 * `tests/releaseNotes.test.mts` pins the derivation as pure logic, which is most of the feature.
 * What a unit test structurally cannot see is the part this spec exists for: the whole promise
 * rests on a STORE KEY that main owns, read once at launch, and the two most load-bearing claims
 * are about a launch rather than about a function.
 *
 *   1. A FRESH INSTALL IS NOT TOLD IT WAS UPDATED. The e2e channel gives every launch its own
 *      temp userData (src/main/channel.ts), so this run IS a fresh install — no stub, no seeded
 *      state, no flag. The teaser strip must be absent, and the panel must mark nothing new. If
 *      the absent-key case ever reads as "everything is new", this is where it shows up, and it
 *      would show up as the first sentence the app ever says to a new user.
 *   2. …AND AN UPGRADED INSTALL IS. The stamp is written through the same bridge method the
 *      panel and the teaser's dismiss use, the window is RELOADED (the state is read once per
 *      launch, on purpose — features/whatsnew/session.ts), and the strip has to come back naming
 *      the newest release with the right releases marked behind it.
 *
 * It also asserts the DEV variant control is ABSENT here, for the same reason the feedback spec
 * asserts `nav-triage` is: this build is production-shaped, and "compiled out" is a claim about
 * bytes that only a build can answer.
 *
 * JOS-254 adds the two ends of "patch notes, one click from the version number":
 *
 *   3. THE ICON IS BESIDE THE VERSION NUMBER AND IT OPENS THE PANEL. Both halves are geometry
 *      and navigation, which is exactly what a unit test cannot see — "next to" is a rendered
 *      relationship between two boxes, and the click crosses the nav → Preferences → section
 *      seam that only the real app has.
 *   4. …AND THE PANEL CARRIES A WAY OUT TO GITHUB. The href is checked against
 *      `allowedExternalUrl` — main's OWN boundary, imported here — because a link this app
 *      renders but main refuses to open is a dead control that looks alive, and that is the
 *      failure mode a rendered-attribute check alone would miss.
 *
 * Run: `npm run test:e2e -- whats-new`
 */
import type { ElectronApplication, Page } from 'playwright-core'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  reportRun,
  settle,
  settleCount,
  settleStable
} from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'
import { RELEASE_NOTES, variantLastSeen } from '../../src/shared/releaseNotes'
// Main's own link boundary, as a pure function (no Electron — that is the point of security.ts).
import { allowedExternalUrl } from '../../src/main/security'

const TEASER = '[data-testid="whats-new-teaser"]'
const PANEL = '[data-testid="whats-new-panel"]'
const RAIL = '[data-testid="prefs-rail-whatsnew"]'
const DEV_ROW = '[data-testid="whats-new-dev"]'
/** The patch-notes icon beside the version number in the nav chip (JOS-254). */
const NOTES_ICON = '[data-testid="update-chip-notes"]'
const GITHUB_LINK = '[data-testid="whats-new-github"]'

const NEWEST = RELEASE_NOTES[0]!.version
/** Derived from the data, never typed twice: the spec asserts the panel drew what the module
 *  holds, and `tests/releaseNotes.test.mts` is what pins the module's own counts. */
const EXPECTED_BULLETS = RELEASE_NOTES.reduce((n, r) => n + r.entries.length, 0)
/**
 * The release whose notes spend extra bullets INTRODUCING two new surfaces (JOS-80) — the What's
 * new panel and the "This week" lockout view.
 *
 * Asserted separately from the panel-wide total because the total cannot tell a release that
 * grew from a release that shrank while another grew. An introduction is plain bullets in the
 * same list, with no marker of its own, so its own count in the RENDERED panel is the only place
 * "the extra bullets actually reached the screen" is observable.
 */
const INTRO_RELEASE = '0.9.0'
const INTRO_RELEASE_BULLETS =
  RELEASE_NOTES.find((r) => r.version === INTRO_RELEASE)?.entries.length ?? 0
const EXPECTED_TAGGED = RELEASE_NOTES.reduce(
  (n, r) => n + r.entries.filter((e) => e.fromReport === true).length,
  0
)
// The thanks line renders ONCE at the panel top (owner, 2026-08-07), gated on any release
// carrying a tagged entry — the check below asserts exactly one line panel-wide.
/** The state a one-release upgrade leaves behind — exactly what the DEV control's second button
 *  writes, so the hand test and this spec are driving the same configuration. */
const PREVIOUS = variantLastSeen('previous')

/** Write the last-seen stamp through the very bridge method the app's own surfaces call. */
function setSeen(page: Page, version: string | null): Promise<string | null> {
  return page.evaluate(
    (v) =>
      (
        window as unknown as {
          eq: { setReleaseNotesSeen: (x: string | null) => Promise<string | null> }
        }
      ).eq.setReleaseNotesSeen(v),
    version
  )
}

/** Open Preferences → What's new and read the panel back. */
async function openPanel(page: Page): Promise<{ releases: number; marked: string[] }> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector(RAIL, { timeout: 20_000 })
  await page.click(RAIL)
  await page.waitForSelector(PANEL, { timeout: 20_000 })
  return page.evaluate(() => ({
    releases: document.querySelectorAll('[data-testid^="whats-new-release-"]').length,
    marked: [...document.querySelectorAll('[data-testid^="whats-new-release-"][data-new="true"]')].map(
      (el) => el.getAttribute('data-testid')?.replace('whats-new-release-', '') ?? ''
    )
  }))
}

/**
 * The geometry that says "it fills the pane" (JOS-76): where the scroll box's bottom sits, versus
 * where the content area it lives in ends.
 *
 * MEASURED, NOT INFERRED FROM CSS. `flexGrow:1` is easy to write and easy to have swallowed by
 * one missing `minHeight: 0` somewhere up the chain — the symptom of which is that the box grows
 * past the pane and the PAGE scrolls instead of the list. So the reading is the rendered box
 * against the rendered pane, plus whether the page itself acquired a scrollbar.
 */
function paneFit(page: Page): Promise<{
  gap: number
  footerGap: number
  boxHeight: number
  pageOverflow: number
}> {
  return page.evaluate(() => {
    const box = document.querySelector('[data-testid="whats-new-history"]')?.getBoundingClientRect()
    const pane = document.querySelector('main')?.getBoundingClientRect()
    const footer = document.querySelector('[data-testid="whats-new-github"]')?.getBoundingClientRect()
    const scroller = document.querySelector('main > div')
    return {
      // The list ends where the ONE thing under it begins (JOS-254 put the GitHub link there).
      gap: box && footer ? footer.top - box.bottom : Number.NaN,
      // …and that link is the last thing in the pane. Two readings rather than one, because
      // "the box claims the height" and "nothing else is squatting at the bottom" are two
      // claims, and a single pane-bottom measurement could not tell them apart any more.
      footerGap: footer && pane ? pane.bottom - footer.bottom : Number.NaN,
      boxHeight: box ? box.height : 0,
      // How far the pane's own scroller can travel. The list scrolls; the page must not.
      pageOverflow: scroller ? scroller.scrollHeight - scroller.clientHeight : Number.NaN
    }
  })
}

/**
 * Resize the (never-shown) main window from the MAIN process — the only place that can — and
 * WAIT FOR THE RENDERER TO HAVE SEEN IT.
 *
 * The wait is the whole point and it cost this spec a red run: `settleStable` is the wrong
 * instrument here, because the measurement is stable BEFORE the resize as well as after, so it
 * returned the pre-resize geometry immediately and both window sizes measured identically. The
 * condition is `window.innerHeight`, which is the renderer's own answer to "how big am I now" —
 * so this waits for the positive signal rather than for a settling that had already happened.
 *
 * The main window is identified POSITIVELY, by the page whose bounds we are about to read, not by
 * "the one that isn't an overlay" — the toast overlay is open by default and window order is not
 * a promise (appWindow.mts's rule).
 */
async function setWindowHeight(page: Page, app: ElectronApplication, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, h) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isAlwaysOnTop())
    win?.setContentSize(1280, h)
  }, height)
  const got = await settle(
    () => page.evaluate(() => window.innerHeight),
    (h) => h === height
  )
  check(`the window really resized to ${String(height)}px`, got === height, `innerHeight=${String(got)}`)
}

/** The one line the strip says, or '' when there is no strip. */
function teaserText(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-testid="whats-new-teaser-text"]')?.textContent?.trim() ?? ''
  )
}

/**
 * THE PANEL FILLS THE PANE (JOS-76), measured at TWO window heights.
 *
 * Two, because "fills" is a claim about a RELATIONSHIP and a single measurement cannot tell it
 * apart from a fixed height that happens to look right at this window size — which is exactly the
 * thing being replaced. So the box must end where the GitHub link under it begins (JOS-254), that
 * link must be the last thing in the pane, the page must never take over the scrolling, and the
 * box must GROW between the two heights.
 */
async function checkFillsPane(page: Page, app: ElectronApplication): Promise<void> {
  const heights: number[] = []
  for (const [label, height] of [['tall', 1000] as const, ['short', 620] as const]) {
    await setWindowHeight(page, app, height)
    // The resize has landed by now (setWindowHeight waited for it); THIS settle is for the
    // reflow that follows it, where "stopped changing" really is the right condition.
    const fit = await settleStable(() => paneFit(page))
    check(
      `${label} window: the history box runs down to the link under it`,
      fit.gap >= 0 && fit.gap < 24,
      `gap=${fit.gap.toFixed(1)}px boxHeight=${fit.boxHeight.toFixed(1)}px`
    )
    check(
      `${label} window: …and that link is the last thing in the pane`,
      fit.footerGap >= 0 && fit.footerGap < 48,
      `footerGap=${fit.footerGap.toFixed(1)}px`
    )
    check(
      `${label} window: the LIST scrolls, never the page`,
      fit.pageOverflow <= 1,
      `pageOverflow=${fit.pageOverflow.toFixed(1)}px`
    )
    heights.push(fit.boxHeight)
  }
  const [tall = 0, short = 0] = heights
  check(
    'the box GREW with the window — it is filling, not a fixed height that happened to fit',
    tall > short + 200,
    `tall=${tall.toFixed(1)}px short=${short.toFixed(1)}px`
  )
  await setWindowHeight(page, app, 900)
}

/** Bullets, the player-report chip, and the collective thanks line (JOS-76). */
async function checkBulletsAndThanks(page: Page): Promise<void> {
  const seen = await page.evaluate((introRelease: string) => ({
    total: document.querySelectorAll('[data-testid="whats-new-bullet"]').length,
    intro: document.querySelectorAll(
      `[data-testid="whats-new-release-${introRelease}"] [data-testid="whats-new-bullet"]`
    ).length,
    tagged: document.querySelectorAll('[data-testid="whats-new-bullet"][data-from-report="true"]').length,
    chips: document.querySelectorAll('[data-testid="whats-new-report-chip"]').length,
    thanks: document.querySelectorAll('[data-testid="whats-new-thanks"]').length,
    firstThanks: document.querySelector('[data-testid="whats-new-thanks"]')?.textContent?.trim() ?? ''
  }), INTRO_RELEASE)
  check(
    'every entry renders as a BULLET, not a packed sentence',
    seen.total === EXPECTED_BULLETS,
    `bullets=${String(seen.total)} expected=${String(EXPECTED_BULLETS)}`
  )
  check(
    `a release that INTRODUCES a surface spends extra bullets on it, and they reach the screen`,
    seen.intro === INTRO_RELEASE_BULLETS && seen.intro > 5,
    `v${INTRO_RELEASE} bullets=${String(seen.intro)} expected=${String(INTRO_RELEASE_BULLETS)}`
  )
  check(
    'a player-reported bullet wears its chip, and only those bullets do',
    seen.tagged === EXPECTED_TAGGED && seen.chips === EXPECTED_TAGGED,
    `tagged=${String(seen.tagged)} chips=${String(seen.chips)} expected=${String(EXPECTED_TAGGED)}`
  )
  check(
    '…and the panel thanks the people who filed them ONCE, at the top (owner, 2026-08-07)',
    seen.thanks === 1,
    `thanksLines=${String(seen.thanks)} expected=1`
  )
  check(
    '…collectively, naming nobody',
    seen.firstThanks === 'Thanks to everyone who filed reports - many of these came from you.',
    `line="${seen.firstThanks}"`
  )
}

/**
 * THE ICON SITS BESIDE THE VERSION NUMBER, AND CLICKING IT LANDS ON THE NOTES (JOS-254).
 *
 * "Beside" is asserted as geometry rather than as DOM order: the two boxes must share a line and
 * the icon must start at or after the version line's right edge, close enough to read as one row.
 * A DOM-order check would pass on a layout that stacked them, which is the failure this is for.
 *
 * The version LINE is whichever of the two states prints the installed version — the muted quiet
 * line in a build whose updater runs, the dev line in one whose updater is off. Named positively
 * rather than assumed, because which one this build shows is not this spec's subject.
 */
function versionIconGeometry(page: Page): Promise<{
  text: string
  sameLine: boolean
  gap: number
  label: string
}> {
  return page.evaluate(() => {
    const icon = document.querySelector('[data-testid="update-chip-notes"]')
    const line =
      document.querySelector('[data-testid="update-chip-quiet"]') ??
      document.querySelector('[data-testid="update-chip-disabled"]')
    if (!icon || !line) return { text: '', sameLine: false, gap: Number.NaN, label: '' }
    const i = icon.getBoundingClientRect()
    const l = line.getBoundingClientRect()
    return {
      text: line.textContent?.trim() ?? '',
      sameLine: i.top < l.bottom && l.top < i.bottom,
      gap: i.left - l.right,
      label: icon.getAttribute('aria-label') ?? ''
    }
  })
}

async function checkVersionIcon(page: Page): Promise<void> {
  // The version arrives over IPC a frame or two after mount; wait for the line to actually NAME
  // one, or "beside the version number" would be asserted against an empty line.
  const seen = await settle(
    () => versionIconGeometry(page),
    (s) => /v\d+\.\d+\.\d+/.test(s.text)
  )
  if (!check('the nav chip names the version this app is running', seen.text !== '', seen.text || 'no version line')) {
    return
  }
  check(
    'a patch-notes icon sits BESIDE the version number, on the same line',
    seen.sameLine && seen.gap >= -1 && seen.gap < 40,
    `line="${seen.text}" sameLine=${String(seen.sameLine)} gap=${seen.gap.toFixed(1)}px`
  )
  check(
    '…and it says what it opens, without a popper that could eat the row above it',
    seen.label === "What's new in this version" && (await countOf(page, '.MuiTooltip-popper')) === 0,
    `label="${seen.label}" poppers=${String(await countOf(page, '.MuiTooltip-popper'))}`
  )

  await page.click(NOTES_ICON, { timeout: 20_000 })
  const landed = await settleCount(page, PANEL, 1)
  check(
    'ONE click from the version number lands on the notes, in the app',
    landed === 1,
    `panels=${String(landed)}`
  )
}

/**
 * THE PANEL'S WAY OUT (JOS-254) — and it has to be a link main will actually open.
 *
 * `target="_blank"` is the whole mechanism: main's `setWindowOpenHandler` turns it into
 * `shell.openExternal` for an allowlisted https host and drops everything else on the floor. So
 * the rendered href is run through that very allowlist here — a link the panel draws and main
 * refuses is a control that looks alive and does nothing, and nothing else in the suite would say
 * so.
 */
async function checkGitHubLink(page: Page): Promise<void> {
  const found = await settleCount(page, GITHUB_LINK, 1)
  if (!check('the panel carries a way out to the full release history', found === 1, `links=${String(found)}`)) {
    return
  }
  const link = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="whats-new-github"]')
    return {
      href: a?.getAttribute('href') ?? '',
      target: a?.getAttribute('target') ?? '',
      rel: a?.getAttribute('rel') ?? '',
      text: a?.textContent?.trim() ?? ''
    }
  })
  check(
    "…pointing at this app's releases page",
    link.href === 'https://github.com/CHANGE-ME/eq-zera/releases',
    `href="${link.href}"`
  )
  check(
    '…in the SYSTEM browser, never an Electron window that would inherit the preload bridge',
    link.target === '_blank' && link.rel.includes('noreferrer'),
    `target="${link.target}" rel="${link.rel}"`
  )
  check(
    '…and main will really open it — the href passes the same allowlist the handler applies',
    allowedExternalUrl(link.href) === link.href,
    `allowed=${allowedExternalUrl(link.href) ?? 'null'}`
  )
  check('…under a label that says where it goes', link.text.includes('GitHub'), `text="${link.text}"`)
}

async function main(): Promise<void> {
  buildIfStale()

  const launched = await launchOnFixture('e2e-overview.log')
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })

    // ---- 1. a fresh install ------------------------------------------------
    // The ABSENCE is asserted the lawful way: wait for the reading to STOP CHANGING, then assert
    // nothing is there. A bare check here would pass while the state was still in flight.
    const settled = await settleStable(() => countOf(page as Page, TEASER))
    check(
      'A FRESH INSTALL IS NEVER TOLD IT WAS UPDATED — no teaser strip at all',
      settled === 0,
      `teasers=${String(settled)}`
    )

    // ---- the door beside the version number (JOS-254) ----------------------
    // Before any Preferences navigation, so the click under test is the ONLY thing that could
    // have put the panel on screen.
    await checkVersionIcon(page)

    const fresh = await openPanel(page)
    check(
      'the full history is browsable anyway — every release renders',
      fresh.releases === RELEASE_NOTES.length,
      `rendered=${String(fresh.releases)} expected=${String(RELEASE_NOTES.length)}`
    )
    check(
      '…and NOTHING is marked new, because a new user has no changes',
      fresh.marked.length === 0,
      `marked=${fresh.marked.join(',') || 'none'}`
    )
    check(
      'the DEV variant control is compiled OUT of a production-shaped build',
      (await countOf(page, DEV_ROW)) === 0
    )

    await checkFillsPane(page, launched.app)
    await checkBulletsAndThanks(page)
    await checkGitHubLink(page)

    // ---- 2. an upgraded install -------------------------------------------
    // The state is read ONCE per launch, so the reload is not a shortcut around anything: it is
    // the second launch, which is exactly when a real upgrade's teaser appears.
    const stored = await setSeen(page, PREVIOUS)
    check('the stamp round-trips through main', stored === PREVIOUS, `stored=${stored ?? 'null'}`)

    await page.reload({ timeout: 60_000 })
    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })

    const shown = await settleCount(page, TEASER, 1)
    check('…and the next launch says so, in one quiet line', shown === 1, `teasers=${String(shown)}`)
    const line = await teaserText(page)
    check(
      '…naming the NEWEST release and only it',
      line === `Updated to v${NEWEST}`,
      `line="${line}"`
    )

    const upgraded = await openPanel(page)
    check(
      'the panel marks every release since the one this install had seen',
      upgraded.marked.length > 0 && upgraded.marked[0] === NEWEST,
      `marked=${upgraded.marked.join(',') || 'none'}`
    )
    check(
      '…and nothing at or below the stamp',
      !upgraded.marked.includes(PREVIOUS ?? ''),
      `stamp=${PREVIOUS ?? 'null'} marked=${upgraded.marked.join(',')}`
    )

    if (failures.length) await dumpArtifacts(page, 'whats-new-FAIL')
  } finally {
    await launched.close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
