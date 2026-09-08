/**
 * Headless Electron integration test for USAGE ANALYTICS (docs/plans/usage-analytics.md, A1).
 *
 * WHY IT IS AN E2E SPEC AND NOT A UNIT TEST: every promise this feature makes is a SEAM.
 *   - "the notice is shown before anything could be sent" crosses the store, a migration, an
 *     IPC handler, App.tsx and a MUI Snackbar. Only the real app can show the bar appearing on
 *     a genuinely fresh userData.
 *   - "Opt out persists" is a claim about a FILE surviving a process, so it is asserted the
 *     only way that means anything: two launches against the same userData dir.
 *   - "this run sends nothing" is asserted of the HARNESS independently of the build: `EQ_E2E=1`
 *     is what keeps this spec silent, and it would keep it silent with the endpoint lit. The EQ
 *     Zera fork is DARK (`endpointConfigured:false`, 2026-09-06), so the pane's empty-state
 *     wording is read from the build rather than pinned; either way `lastBatch` is null.
 *   - "the schema cannot carry a name" is asserted against the REAL buffer this session filled
 *     by switching tabs, not against a constructed sample.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: reach the network. `EQ_E2E=1` shuts the flush gate on its
 * own (plan T7), so no flush timer is ever created — and the assertions below prove the visible
 * consequence: nothing was ever sent from any of these four launches.
 *
 * Identities only, never today's numbers: the buffer is asserted to GROW and to contain only
 * schema-legal events, never to hold N of them.
 *
 * Run: `node --import tsx tests/e2e/telemetry.e2e.mts` (it is also in tests/e2e/run-all.mts).
 */
import type { Page } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildIfStale,
  check,
  countOf,
  dumpArtifacts,
  failures,
  note,
  reportRun,
  settle,
  settleGone,
  sleep
} from './appHarness.mjs'
import { closeWindows, mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture, type FixtureLog } from './logFixture.mjs'
// The error-report steps (JOS-100) live next door: adding them here put this spec past the
// repo's 400-code-line ceiling, and the split follows a real seam. See errorReportSteps.mts.
import { DELIBERATE, stepErrorReport, stepThrowRendererError } from './errorReportSteps.mjs'
// …and the two readings that ride a session report and are read off the RING after the process
// exits — the startup replay (JOS-57) and the live-session probe (JOS-367). Same seam, same split.
import { stepLiveRiders, stepStartupReading } from './sessionRiderSteps.mjs'

const NOTICE = '[data-testid="telemetry-notice"]'
const TEXT = '[data-testid="telemetry-notice-text"]'
const DETAILS = '[data-testid="telemetry-notice-details"]'
const DISMISS = '[data-testid="telemetry-notice-dismiss"]'
const OFF = '[data-testid="telemetry-notice-off"]'
const PANE = '[data-testid="pref-telemetry"]'
const SWITCH = '[data-testid="pref-telemetry-enabled"] input'
/** `useViewDwell` ignores anything under a second — a pass-through is not a visit. */
const DWELL_MS = 1_400
/**
 * The settings file inside the launch's userData, spelled out rather than imported: `STORE_NAME` lives in
 * src/main/channel.ts, which imports `electron` at module scope and therefore cannot be loaded by
 * a plain node process. tests/storeMigrations.test.mts hardcodes the same name for the same reason.
 */
const STORE_NAME = 'everquest-companion-progress'

interface Prefs {
  enabled: boolean
  noticeShown: boolean
  analyticsId: string | null
}
interface Payload {
  prefs: Prefs
  endpointConfigured: boolean
  buffered: { ts: number; ev: Record<string, unknown> }[]
  lastBatch: unknown
}

/** The bridge the app's own UI uses — so the spec observes exactly what the app observes. */
function payload(page: Page): Promise<Payload> {
  return page.evaluate(
    () => (window as unknown as { eq: { getTelemetryPayload: () => Promise<Payload> } }).eq.getTelemetryPayload()
  )
}

function textOf(page: Page, selector: string): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText ?? '',
    selector
  )
}

// ---- launch 1: the first run --------------------------------------------------------------

/**
 * THE T1 ASSERTION. Opt-out is only honest if the telling comes first, so the notice must appear
 * on a genuinely fresh install — and `noticeShown` is the flag main's network gate reads, so a
 * missing bar is not a cosmetic bug, it is the gate never being opened legitimately.
 *
 * T1 AMENDED (2026-08-04, owner): the notice is a slim BOTTOM BAR, not a modal. So the copy
 * assertion is now an assertion of BREVITY — one sentence, no list, no second paragraph. The
 * explanation lives in Preferences and TELEMETRY.md; a consent wall the user clicks through to
 * reach the app buys agreement, not understanding.
 */
async function stepNoticeShown(page: Page): Promise<boolean> {
  await page.waitForSelector(NOTICE, { timeout: 30_000 })
  const shown = await countOf(page, NOTICE)
  if (!check('the first-run notice renders on a fresh install', shown === 1, `${String(shown)} bar(s)`)) {
    return false
  }
  const sentence = (await textOf(page, TEXT)).replace(/\s+/g, ' ').trim()
  check(
    'it says what it does, in one sentence, before anything could be sent',
    sentence === 'We collect completely anonymous usage data.',
    sentence.slice(0, 110)
  )
  // …and NOTHING else. The whole bar — sentence plus the three action labels — has to stay
  // shorter than the first paragraph of the modal this replaced.
  const body = (await textOf(page, NOTICE)).replace(/\s+/g, ' ').trim()
  check(
    'no second paragraph, no list — the amended T1 shape',
    body.length <= 80 && (await countOf(page, `${NOTICE} li`)) === 0,
    `${String(body.length)} chars: ${body}`
  )
  return true
}

/**
 * THE SHAPE OF THE BAR, measured. The way this pattern goes dishonest once the wall of text is
 * gone is by BURYING the opt-out — a plain "Details" link beside a grey whisper of an opt-out,
 * or an opt-out hidden behind the Details page. So: opt out is a real button, and it is never
 * smaller than the Details link beside it.
 */
async function stepBarShape(page: Page): Promise<void> {
  // NO named function bindings inside this callback: tsx/esbuild `keepNames` wraps
  // `const f = (…) => …` in a `__name` helper that lives in the NODE bundle, and Playwright
  // ships only the callback's source to the page — so the evaluated code throws
  // `__name is not defined`. Anonymous callbacks passed straight to .map are the one shape
  // that stays unwrapped (appHarness.mts learned this the hard way).
  const els = await page.evaluate(
    (sels) =>
      sels.map((s) => {
        const el = document.querySelector(s) as HTMLElement | null
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { h: Math.round(r.height), fs: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName }
      }),
    [OFF, DETAILS, DISMISS]
  )
  if (
    !check(
      'the bar carries all three exits: Opt out, Details, dismiss',
      els.every((e) => e != null),
      JSON.stringify(els)
    )
  ) {
    return
  }
  const off = els[0] as { h: number; fs: number; tag: string }
  const details = els[1] as { h: number; fs: number; tag: string }
  check(
    'Opt out is a BUTTON, never smaller than the Details link beside it',
    off.tag === 'BUTTON' && off.fs >= details.fs && off.h >= details.h,
    `off ${String(off.h)}px/${String(off.fs)} vs details ${String(details.h)}px/${String(details.fs)}`
  )
  check(
    '…and nothing is pre-checked: the notice is actions, not a form',
    (await countOf(page, `${NOTICE} input`)) === 0
  )
  // A bar, not a panel: it may not eat the app. Anything taller than ~1/5 of the window is a
  // modal wearing a bar's clothes.
  const tall = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    return el ? el.getBoundingClientRect().height / window.innerHeight : 1
  }, NOTICE)
  check('it is a slim bar — it does not take the window over', tall < 0.2, `${(tall * 100).toFixed(0)}% of the window`)
}

/**
 * DISMISSAL KEEPS IT ON — the honest half of opt-out, and the one most easily got wrong. The X
 * must mark the question ASKED (so it is never asked twice) while leaving collection running,
 * because that is exactly what "on by default, and we told you" means.
 */
async function stepDismissKeepsOn(page: Page): Promise<void> {
  await page.click(DISMISS)
  check('dismissing closes the bar', await settleGone(page, NOTICE, { timeoutMs: 8_000 }))
  // The bar's exit is a renderer animation; the ANSWER it recorded is a main-process store write,
  // so the payload is read until it carries one rather than on whatever tick the DOM finished on.
  const p = await settle(() => payload(page), (x) => x.prefs.noticeShown, { timeoutMs: 8_000 })
  check('dismissal KEEPS collection on — it is not a silent opt-out', p.prefs.enabled === true, JSON.stringify(p.prefs))
  check(
    '…and still marks the notice shown, so it is a once-ever question',
    p.prefs.noticeShown === true,
    JSON.stringify(p.prefs)
  )
}

/**
 * THE FIRST-RUN FUNNEL, ON A REAL FIRST RUN — the assertion that JOS-39's producers are wired to
 * moments rather than merely to functions.
 *
 * It can only be made HERE. The steps are once-ever per install (the marks are persisted in the
 * telemetry prefs), so a unit test can prove the ledger's arithmetic and nothing else; whether
 * `installed` actually fires on the launch that mints the id, and whether `logDetected` fires when
 * this machine's real log is attached, is a fact about the running app on a genuinely fresh
 * userData — which is exactly what this spec already builds three times.
 *
 * `installed` is asserted STRICTLY: it is recorded in `startTelemetry`, before the bar renders.
 * `logDetected` / `firstParse` are reported rather than required, because they depend on this
 * machine having a log to find and on the replay having reached its first event by the time the
 * bar is dismissed — a floor-vs-timing distinction the harness must not turn into a flake.
 * What IS strict about all of them: every funnel step in the buffer is a DECLARED first-run step
 * and appears at most ONCE, which is the whole promise of the once-ever ledger.
 */
const FIRST_RUN_STEPS = [
  'installed',
  'logDetected',
  'firstParse',
  'firstNonOverviewView',
  'firstOverlayEnabled'
]

async function stepFirstRunFunnel(page: Page): Promise<void> {
  const p = await payload(page)
  const steps = p.buffered
    .filter((r) => r.ev.t === 'funnelStep' && r.ev.funnel === 'first-run')
    .map((r) => String(r.ev.step))
  check(
    'a first run records the funnel step that says a first run happened',
    steps.includes('installed'),
    `first-run steps: ${steps.join(', ') || '(none)'}`
  )
  check(
    'every recorded step is a DECLARED first-run step, exactly once',
    steps.every((s) => FIRST_RUN_STEPS.includes(s)) && new Set(steps).size === steps.length,
    steps.join(', ')
  )
  note(`first-run funnel on this machine: ${steps.join(' → ') || '(none)'}`)
}

/**
 * "DETAILS" IS THE REST OF THE SENTENCE. The bar is one line precisely because the explanation
 * lives somewhere a curious user can reach in one click — so that click is asserted to LAND, on
 * the pane that holds the switch, the id and the live payload. Reading is not consenting to
 * anything new, so it answers the notice the same way dismissal does: still on, still asked.
 */
async function stepDetailsOpensPane(page: Page): Promise<void> {
  await page.click(DETAILS)
  await page.waitForSelector(PANE, { timeout: 15_000 }).catch(() => undefined)
  check('“Details” closes the bar', (await countOf(page, NOTICE)) === 0)
  check('…and lands on Preferences → Usage analytics', (await countOf(page, PANE)) === 1)
  const p = await payload(page)
  check(
    '…and reading is not answering twice: collection stays on, the question is marked asked',
    p.prefs.enabled === true && p.prefs.noticeShown === true,
    JSON.stringify(p.prefs)
  )
}

/** Opting out must take effect NOW: the pref flips and the local buffer is dropped. */
async function stepOptOut(page: Page): Promise<void> {
  await page.click(OFF)
  check('answering closes the bar', await settleGone(page, NOTICE, { timeoutMs: 8_000 }))
  const p = await settle(() => payload(page), (x) => x.prefs.noticeShown, { timeoutMs: 8_000 })
  check('“Opt out” switches collection off', p.prefs.enabled === false, JSON.stringify(p.prefs))
  check(
    '…and marks the notice shown either way, so it is a once-ever question',
    p.prefs.noticeShown === true
  )
  check(
    '…and drops everything already buffered, immediately',
    p.buffered.length === 0,
    `${String(p.buffered.length)} event(s) still held`
  )
  // …AND the id goes with it. This assertion is what found the original bug: because the
  // feature is opt-OUT, an id is minted on the very first launch, BEFORE the notice is
  // answered — so declining used to leave the user carrying an identifier for the thing they
  // had just declined. Off must mean off, with no asterisk.
  check(
    'no analytics id is left behind for a user who declined',
    p.prefs.analyticsId === null,
    String(p.prefs.analyticsId)
  )
}

// ---- launch 3: the restart -------------------------------------------------------------------

/**
 * THE ANSWER, ON DISK, BETWEEN THE TWO PROCESSES — read with launch 3 gone and launch 4 not yet
 * started, so nothing is holding it in memory and the only thing that can be true here is what
 * the file says.
 *
 * It exists to SPLIT the failure that `stepPersisted` reports. "Still off after relaunch" is one
 * assertion over two very different mechanisms — did the app write the answer, and did the answer
 * survive until the next process read it — and when it failed, it could not say which. (It was
 * the second: a neighbouring spec, sharing the one userData dir this harness used to hand every
 * launch, wiped the file in between. The dir below is minted by THIS spec and shared only with
 * its own launch 4.) With this step, a write bug fails here and an environment eating the file
 * fails only below.
 */
function stepOnDisk(userData: string): void {
  const path = join(userData, `${STORE_NAME}.json`)
  let telemetry: unknown
  try {
    telemetry = (JSON.parse(readFileSync(path, 'utf8')) as { telemetry?: unknown }).telemetry
  } catch (err) {
    check('the opt-out is on disk after the app that made it has exited', false, String(err))
    return
  }
  const prefs = telemetry as Prefs | undefined
  check(
    'the opt-out is on disk after the app that made it has exited',
    prefs?.enabled === false && prefs.noticeShown === true,
    JSON.stringify(telemetry)
  )
}

/** THE PERSISTENCE ASSERTION — a real second process against the same userData dir. */
async function stepPersisted(page: Page): Promise<void> {
  const p = await payload(page)
  check(
    'the answer SURVIVES a restart — analytics is still off after relaunch',
    p.prefs.enabled === false,
    JSON.stringify(p.prefs)
  )
  check('…and the notice is not asked again', (await countOf(page, NOTICE)) === 0)
}

/** The Preferences pane: the switch, the honest "nothing sent yet" copy, and the payload viewer. */
async function stepPane(page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 30_000 })
  await page.click('[data-testid="prefs-rail-analytics"]', { timeout: 15_000 })
  await page.waitForSelector(PANE, { timeout: 15_000 })
  check('Preferences has a Usage analytics section', (await countOf(page, PANE)) === 1)

  const off = await page.evaluate((sel) => (document.querySelector(sel) as HTMLInputElement | null)?.checked, SWITCH)
  check('the switch reflects the stored answer (off)', off === false, String(off))

  // THE BUILD AS THE USER MEETS IT: not an empty box to interpret, a sentence. Which sentence is
  // a property of the BUILD, so it is read from the build rather than hard-coded — the EQ Zera
  // fork compiled the endpoint back OUT (2026-09-06), and a spec pinned to the lit wording would
  // have to be edited again the day it is lit. Either way the claim is the same: this run sent
  // nothing (EQ_E2E=1 shuts the gate), and the pane says so in words.
  const { endpointConfigured } = await payload(page)
  const empty = (await textOf(page, '[data-testid="telemetry-last-batch-empty"]')).replace(/\s+/g, ' ')
  check(
    'the pane says, in words, that nothing has been sent from this install',
    endpointConfigured
      ? /nothing has been sent yet/i.test(empty) && !/no analytics endpoint compiled in/i.test(empty)
      : /^nothing,/i.test(empty) && /no analytics endpoint compiled in/i.test(empty),
    `endpointConfigured=${String(endpointConfigured)} · ${empty.slice(0, 100)}`
  )
}

/** Turn it back on and prove the machinery is real: an id is minted, and the ring fills. */
async function stepCollects(page: Page): Promise<void> {
  await page.click(SWITCH)
  // The MINTING is the condition: the switch write crosses into main, which generates the id and
  // hands it back. Waiting for the id to exist is waiting for exactly what is asserted next.
  const after = await settle(() => payload(page), (p) => p.prefs.enabled && p.prefs.analyticsId !== null, {
    timeoutMs: 10_000
  })
  check('turning it back on mints an anonymous id', /^[0-9a-f-]{36}$/i.test(after.prefs.analyticsId ?? ''), String(after.prefs.analyticsId))
  check(
    'the id is NOT the feedback install id — the two data sets cannot be joined',
    after.prefs.analyticsId !== null
  )

  // Fill the ring the way a user would: switch tabs. `useViewDwell` reports on the switch.
  // THE ONE DELIBERATE TIMER LEFT HERE, and it is the feature's own rule rather than a guess at
  // latency: `useViewDwell` reports nothing for a visit under a second, so a tab has to be LOOKED
  // AT for longer than that before there is an event to record at all.
  for (const view of ['combat', 'loot', 'overview']) {
    await page.click(`[data-testid="nav-${view}"]`, { timeout: 15_000 })
    await sleep(DWELL_MS)
  }
  // …and the ring filling is a condition, so it is one.
  const p = await settle(() => payload(page), (x) => x.buffered.some((r) => r.ev.t === 'viewDwell'), {
    timeoutMs: 10_000
  })
  check(
    'switching tabs records viewDwell events into the LOCAL ring',
    p.buffered.some((r) => r.ev.t === 'viewDwell'),
    `${String(p.buffered.length)} buffered: ${[...new Set(p.buffered.map((r) => String(r.ev.t)))].join(', ')}`
  )

  // THE SETUP SNAPSHOT (JOS-364), on the machine the suite is really running on. It is the one
  // event in this schema whose producer reads the OS, the GPU process, the screen and the store,
  // so a unit test can pin every mapping and still not prove that any of those four answer inside
  // a running Electron app — which is exactly what went wrong for three waves, when the event had
  // a rollup, a doc section and no producer at all.
  //
  // Polled rather than timed: the producer waits out its own delay after the replay finishes, and
  // a fixed sleep here would be a flake waiting for a slow CI box.
  const settled = await settle(() => payload(page), (x) => x.buffered.some((r) => r.ev.t === 'setupSnapshot'), { timeoutMs: 30_000 })
  const setup = settled.buffered.filter((r) => r.ev.t === 'setupSnapshot')
  check(
    'the setup snapshot is PRODUCED — once, on the machine this suite is running on',
    setup.length === 1,
    `${String(setup.length)} among ${[...new Set(settled.buffered.map((r) => String(r.ev.t)))].join(', ')}`
  )
  // The machine class, as SHAPE rather than as values: the cores and the GPU of the box running
  // this suite are properties of THAT box, and frozen numbers rot. What must hold on any machine
  // is that every axis is present and is a bucket index or a member of its own closed enum.
  const ev: Record<string, unknown> = setup[0]?.ev ?? {}
  const ENUMS = { gpuVendor: 'nvidia amd intel other unknown', gpuCompositing: 'hardware software off unknown', eqWindowMode: 'fullscreen windowed unknown' }
  check(
    '…carrying the machine class: four bucket INDICES, three closed enums and a safe-mode flag',
    ['cpuCountBucket', 'totalMemBucket', 'displayCountBucket', 'primaryScaleBucket'].every((k) => typeof ev[k] === 'number') &&
      Object.entries(ENUMS).every(([k, allowed]) => allowed.split(' ').includes(String(ev[k]))) &&
      typeof ev.safeMode === 'boolean',
    JSON.stringify(ev)
  )

  // …AND MAIN DERIVES THE FUNNEL STEP FROM THEM. `firstNonOverviewView` is never sent by the
  // renderer: main watches the `viewDwell` events it already validates and mints the once-ever
  // step itself, so the renderer cannot manufacture a first-run step. This launch is the honest
  // test of it — its install opted OUT in launch 3, so the step was never marked (a step is not
  // spent while collection is off), and switching to Combat here is the first time it can be.
  const derived = p.buffered.filter((r) => r.ev.t === 'funnelStep' && r.ev.funnel === 'first-run')
  check(
    'main derives firstNonOverviewView from the renderer dwell it already receives',
    derived.some((r) => String(r.ev.step) === 'firstNonOverviewView'),
    derived.map((r) => String(r.ev.step)).join(', ') || '(no first-run steps)'
  )
  check(
    '…once, and only for tabs that are not the one the app opens on',
    derived.filter((r) => String(r.ev.step) === 'firstNonOverviewView').length === 1,
    `${String(derived.length)} first-run step(s) after visiting combat, loot, overview`
  )

  // THE PRIVACY PROPERTY, against the buffer this session actually produced. Every string in
  // every buffered event must be a short, lowercase enum-ish token — a character name, a zone,
  // a path or a log line could not survive the validator, and this is that claim measured on
  // real data rather than on a constructed sample.
  const strings = p.buffered.flatMap((r) =>
    Object.entries(r.ev)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}=${String(v)}`)
  )
  const suspicious = strings.filter((s) => {
    const value = s.slice(s.indexOf('=') + 1)
    return value.length > 24 || /[\\/@'"]|\s/.test(value)
  })
  check(
    'nothing in the buffer is free text — every string is a short closed-enum token',
    suspicious.length === 0,
    suspicious.slice(0, 3).join(' | ') || `${String(strings.length)} strings, all enum tokens`
  )

  // …and it does not INVENT the part it could not have measured. This session began with
  // analytics off, so there is no honest cold-start figure for it — a bucketed guess would be
  // indistinguishable from a measurement once aggregated (world-model law 1).
  check(
    'enabling mid-session records no sessionStart — the number was never measurable',
    !p.buffered.some((r) => r.ev.t === 'sessionStart'),
    [...new Set(p.buffered.map((r) => String(r.ev.t)))].join(', ')
  )

  // THE LIT BUILD, AND THE E2E LAW TOGETHER: the endpoint IS compiled in (that is the whole
  // change this spec was updated for) and this run STILL sent nothing, because `EQ_E2E=1` shuts
  // the flush gate on its own (plan T7). A `lastBatch` here would mean the harness had reached
  // the live ingest API behind the test's back.
  check(
    'the running build has NO telemetry endpoint (EQ Zera fork is dark)',
    p.endpointConfigured === false,
    `endpointConfigured=${String(p.endpointConfigured)}`
  )
  check(
    '…and this e2e run still sent nothing: no batch ever left the harness',
    p.lastBatch === null,
    `lastBatch=${JSON.stringify(p.lastBatch)}`
  )
}

/** Every launch collects renderer errors the same way — a missing IPC handler surfaces here. */
function watch(page: Page, consoleErrors: string[]): void {
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes(DELIBERATE)) consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => {
    if (!String(e).includes(DELIBERATE)) consoleErrors.push(String(e))
  })
}

/**
 * ONE FIRST RUN, wiped userData and all — because the notice is once-ever, and each of its
 * three exits therefore needs an install of its own rather than a second click on a bar that
 * is already gone.
 */
interface FirstRun {
  label: string
  errors: string[]
  step: (p: Page) => Promise<void>
  log: FixtureLog
  /** Launches 1 and 3 name one: each is a dir something is read out of after the process exits. */
  userData?: string
  /** Quit by CLOSING THE WINDOWS rather than by `app.quit()` — see `closeWindows`. */
  byWindow?: boolean
}

// `closeWindows` — QUIT THE WAY A USER QUITS — moved to ./appWindow.mts, which is where
// `launchApp` and `mainWindow` already live and where any spec asserting about a session's LAST
// record can reach it. Its whole measured story is in that file's header, unchanged.

async function firstRun({ label, errors, step, log, userData, byWindow }: FirstRun): Promise<void> {
  console.log(label)
  const { app, close } = await launchOnFixture(log, userData === undefined ? {} : { userData })
  try {
    const page = await mainWindow(app)
    watch(page, errors)
    if (await stepNoticeShown(page)) await step(page)
    if (failures.length) await dumpArtifacts(page, `telemetry-FAIL-${label.split(':')[0].replace(/\s+/g, '-')}`)
    if (byWindow === true) await closeWindows(app)
  } finally {
    await close()
  }
}

/**
 * Three fresh installs, one per exit — dismiss, Details, Opt out — and then the RESTART, which
 * runs on the userData the opt-out left behind so "it persists" means a real second process.
 */
async function main(): Promise<void> {
  buildIfStale()
  const consoleErrors: string[] = []

  // Launches 1 and 2 each take a dir of their own (that IS the fresh install). Launches 3 and 4
  // share one that this spec owns and names explicitly, because the assertion between them is
  // that the dir OUTLIVES the process — the one thing a per-launch dir must not do by itself.
  const restartData = makeUserData()
  // Launch 1's dir is NAMED for the same reason launch 3's is: something is read out of it after
  // the process that wrote it has exited. Here it is the ring — the only place the startup
  // reading is observable, because it rides the `sessionEnd` written on the way out.
  const firstRunData = makeUserData()
  // ONE staged log for all four launches: none of them reads it for anything but "this machine
  // has a character", and staging it once keeps the four boots comparable.
  const log = stageFixture('e2e-telemetry.log')

  await firstRun({
    label: 'launch 1: hidden Electron (EQ_E2E=1), fresh userData — the bar, and dismissing it…',
    errors: consoleErrors,
    log,
    userData: firstRunData,
    // …and it exits by CLOSING ITS WINDOWS, so `window-all-closed` fires and the session's last
    // record is actually written. Every other launch here exits the harness's usual way.
    byWindow: true,
    step: async (page) => {
      await stepBarShape(page)
      await stepDismissKeepsOn(page)
      await stepFirstRunFunnel(page)
      // LAST in this launch, deliberately: it throws a real uncaught error into the renderer,
      // and every step above wants a window that has not been shouted at. The ErrorBoundary is
      // untouched (this is a `window.onerror`, not a render throw), so the app stays usable —
      // but there is nothing after it here that needs it to be.
      await stepThrowRendererError(page, log)
    }
  })
  // …and now that launch is gone, what it left behind. It is the one launch that ends with
  // collection ON (dismissal is not an opt-out), so it is the one whose ring holds a reading.
  stepStartupReading(firstRunData)
  // …and the LIVE half of the same chain (JOS-367), off the same ring: the startup probes stop at
  // `replayDone` and these two start there, so one launch leaves both readings behind.
  stepLiveRiders(firstRunData)
  stepErrorReport(firstRunData, log)
  await firstRun({ label: 'launch 2: fresh userData — the Details link…', errors: consoleErrors, log, step: stepDetailsOpensPane })
  await firstRun({ label: 'launch 3: fresh userData — opting out…', errors: consoleErrors, log, step: stepOptOut, userData: restartData })

  stepOnDisk(restartData)

  console.log('launch 4: same userData as launch 3 — does the answer survive a restart…')
  const { app, close } = await launchOnFixture(log, { userData: restartData })
  try {
    const page = await mainWindow(app)
    watch(page, consoleErrors)
    await page.waitForSelector('[data-testid="nav-preferences"]', { timeout: 60_000 })
    // The stored answer arrives over IPC after the window mounts; the CONDITION is the payload
    // being readable at all, which is also the first thing `stepPersisted` asserts about.
    await settle(() => payload(page).then((p) => p.prefs.noticeShown).catch(() => false), (ok) => ok, {
      timeoutMs: 15_000
    })
    await stepPersisted(page)
    await stepPane(page)
    await stepCollects(page)
    if (failures.length) await dumpArtifacts(page, 'telemetry-FAIL-restart')
  } finally {
    await close()
    await removeUserData(restartData)
    await removeUserData(firstRunData)
    await log.dispose()
  }

  // A missing IPC handler shows up here first (`invoke` rejects into an unhandled rejection).
  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  if (consoleErrors.length === 0) note('four launches, three fresh installs — the persistence claim is a real restart')

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
