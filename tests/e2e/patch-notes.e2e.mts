/**
 * THE PATCH NOTES TAB, against a LOCAL STUB of www.everquestlegends.com.
 *
 * The suite never reaches the live site: this spec serves the committed fixtures
 * (tests/fixtures/patch-notes/*.html) from a loopback HTTP server and names it in
 * `EQ_E2E_PATCH_NOTES_ORIGIN`, the one variable src/main/patchNotes/net.ts reads, and only under
 * EQ_E2E. Without it the headless build is dark and would make no request at all.
 *
 * THREE LAUNCHES ON ONE userData, because the feature is about what changes BETWEEN launches:
 *
 *   1. the site as it stood before November 10 (the index fixture minus its newest row). A first
 *      launch is a baseline: the index plus the three articles, one request at a time; one unread
 *      note on the nav badge; the tab lists the three newest first with Hotfix chips; opening a note
 *      shows its body and clears its dot; the Preferences switch reads ON.
 *   2. the full index. The launch announces "Patch Notes - November 10, 2026" in a snackbar, the
 *      badge reads 1, "Read" opens the tab ON that note; "Check now" asks for the index and the
 *      newest note only. Then the switch is turned OFF.
 *   3. switch off: the launch makes no request at all, and the cached notes still draw.
 *
 * Run: `node --import tsx tests/e2e/run-all.mts patch-notes`.
 */
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import { ROOT, buildIfStale, check, countOf, dumpArtifacts, failures, note, reportRun, settle, settleStable } from './appHarness.mjs'
import { mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

const FIX = join(ROOT, 'tests', 'fixtures', 'patch-notes')
const NEWEST = 'eql-update-notes-11-10-2026'
const NAV = '[data-testid="nav-patchnotes"]'
const BADGE = '[data-testid="nav-patchnotes-badge"]'
const VIEW = '[data-testid="patchnotes-view"]'
const ROW = '[data-testid="patchnotes-row"]'
const DETAIL = '[data-testid="patchnotes-detail"]'
const BODY = '[data-testid="patchnotes-body"]'
const NOTICE = '[data-testid="patchnotes-notice"]'

// ---- the stub site ------------------------------------------------------------------------------

const INDEX = readFileSync(join(FIX, 'index.html'), 'utf8')

/** The index fixture with its newest row removed: the site before November 10. */
function olderIndex(): string {
  const marker = 'window.EQL.News.articles = '
  const at = INDEX.indexOf(marker) + marker.length
  const end = INDEX.indexOf('\n', at)
  const rows = JSON.parse(INDEX.slice(at, end)) as unknown[]
  return INDEX.slice(0, at) + JSON.stringify(rows.slice(1)) + INDEX.slice(end)
}

interface Stub {
  origin: string
  requests: string[]
  maxInFlight: () => number
  serveIndex: (html: string) => void
  close: () => Promise<void>
}

async function startStub(): Promise<Stub> {
  const requests: string[] = []
  let index = olderIndex()
  let inFlight = 0
  let max = 0
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/'
    requests.push(path)
    inFlight++
    max = Math.max(max, inFlight)
    const done = (status: number, body: string): void => {
      // A short delay, so two overlapping requests would actually overlap.
      setTimeout(() => {
        inFlight--
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
        res.end(body)
      }, 30)
    }
    if (path === '/patch-notes') return done(200, index)
    const m = /^\/patch-notes\/([a-z0-9-]+)$/.exec(path)
    try {
      if (m) return done(200, readFileSync(join(FIX, `${m[1]}.html`), 'utf8'))
    } catch {
      // fall through to the 404
    }
    return done(404, 'not found')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    maxInFlight: () => max,
    serveIndex: (html) => {
      index = html
    },
    close: () => new Promise<void>((r) => server.close(() => r()))
  }
}

// ---- helpers ------------------------------------------------------------------------------------

function textOf(page: Page, sel: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)
}

function rowPages(page: Page): Promise<string[]> {
  return page.evaluate(
    (s) => Array.from(document.querySelectorAll(s)).map((el) => el.getAttribute('data-page') ?? ''),
    ROW
  )
}

async function answerNotice(page: Page): Promise<void> {
  if ((await countOf(page, '[data-testid="telemetry-notice"]')) === 0) return
  await page.click('[data-testid="telemetry-notice-off"]')
}

async function launch(userData: string, stub: Stub): Promise<{ page: Page; close: () => Promise<void> }> {
  const { app, close } = await launchOnFixture('e2e-telemetry.log', {
    userData,
    waitForEngine: false,
    env: { EQ_E2E_PATCH_NOTES_ORIGIN: stub.origin }
  })
  const page = await mainWindow(app)
  await page.waitForSelector(NAV, { timeout: 60_000 })
  await answerNotice(page)
  return { page, close }
}

const consoleErrors: string[] = []
function watchConsole(page: Page): void {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
}

// ---- launch 1: the baseline ---------------------------------------------------------------------

async function firstLaunch(page: Page, stub: Stub): Promise<void> {
  const n = await settle(() => Promise.resolve(stub.requests.length), (x) => x >= 4, { timeoutMs: 30_000, pollMs: 100 })
  check('a first launch asks for the index and the three articles', n === 4, stub.requests.join(' '))
  check('…with the index first', stub.requests[0] === '/patch-notes', String(stub.requests[0]))
  check('…and never two requests at once', stub.maxInFlight() === 1, String(stub.maxInFlight()))
  const badge = await settle(() => textOf(page, BADGE), (t) => t === '1', { timeoutMs: 15_000, pollMs: 100 })
  check('a first launch leaves exactly one note unread, on the nav badge', badge === '1', `badge "${badge}"`)
  check('…and announces nothing (the first index is a baseline)', (await countOf(page, NOTICE)) === 0)

  await page.click(NAV)
  await page.waitForSelector(VIEW, { timeout: 15_000 })
  const pages = await settle(() => rowPages(page), (p) => p.length === 3, { timeoutMs: 15_000, pollMs: 100 })
  check(
    'the tab lists the three notes, newest first',
    pages.join(',') === 'eql-hotfix-notes-11-4-2026,eql-hotfix-notes-11-3-2026,eql-update-notes-10-29-2026',
    pages.join(',')
  )
  check('…each one a Hotfix, read from its title', (await textOf(page, `${ROW}:nth-child(3)`)).includes('Hotfix'))
  const body = await settle(() => textOf(page, BODY), (t) => t.length > 0, { timeoutMs: 15_000, pollMs: 100 })
  check('the newest note opens with its body', body.includes('Mimics in Nektropos Castle see food.'), body.slice(0, 80))
  check('…and opening it clears the badge', await settle(() => countOf(page, BADGE), (c) => c === 0, { timeoutMs: 10_000 }).then((c) => c === 0))

  await page.click(`${ROW}[data-page="eql-hotfix-notes-11-3-2026"]`)
  const other = await settle(() => textOf(page, BODY), (t) => t.includes('deleveled'), { timeoutMs: 10_000, pollMs: 100 })
  check('selecting another note shows its body', other.includes('alternate ability activation requirements'), other.slice(0, 80))
  const href = await page.getAttribute('[data-testid="patchnotes-open-site"]', 'href')
  check(
    'and links to it on the real site, never the stub',
    href === 'https://www.everquestlegends.com/patch-notes/eql-hotfix-notes-11-3-2026',
    String(href)
  )

  await page.click('[data-testid="nav-preferences"]')
  await page.click('[data-testid="prefs-rail-patchnotes"]', { timeout: 15_000 })
  const sw = '[data-testid="pref-patch-notes-launch"] input'
  await page.waitForSelector(sw, { timeout: 15_000 })
  check('the Preferences switch is ON by default', await page.isChecked(sw))
}

// ---- launch 2: a new note -----------------------------------------------------------------------

async function secondLaunch(page: Page, stub: Stub): Promise<void> {
  await page.waitForSelector(NOTICE, { timeout: 30_000 }).catch(() => undefined)
  const text = await textOf(page, '[data-testid="patchnotes-notice-text"]')
  check('a launch that finds a new note says so, naming it', text.includes('Patch Notes - November 10, 2026'), text)
  check('…the request was the index, then the new note first', stub.requests.slice(0, 2).join(' ') === `/patch-notes /patch-notes/${NEWEST}`, stub.requests.join(' '))
  check('…and the badge counts it', (await settle(() => textOf(page, BADGE), (t) => t === '1', { timeoutMs: 10_000 })) === '1')

  await page.click('[data-testid="patchnotes-notice-open"]')
  await page.waitForSelector(VIEW, { timeout: 15_000 })
  const shown = await settle(() => page.getAttribute(DETAIL, 'data-page'), (p) => p === NEWEST, { timeoutMs: 10_000 })
  check('"Read" opens the tab ON the announced note', shown === NEWEST, String(shown))
  const body = await settle(() => textOf(page, BODY), (t) => t.includes('Reincarnation'), { timeoutMs: 10_000 })
  check('…with its body drawn from the sanitized tree', body.includes('Throwing a spear now throws the pointed end forward'), body.slice(0, 80))
  check('…its headings are real headings', (await countOf(page, `${BODY} h2`)) === 6)
  check('…and the notice is gone', await settle(() => countOf(page, NOTICE), (c) => c === 0, { timeoutMs: 10_000 }).then((c) => c === 0))

  const before = stub.requests.length
  await page.click('[data-testid="patchnotes-check"]')
  const after = await settle(() => Promise.resolve(stub.requests.length), (x) => x >= before + 2, { timeoutMs: 15_000, pollMs: 100 })
  await settle(() => page.isEnabled('[data-testid="patchnotes-check"]'), (ok) => ok, { timeoutMs: 15_000 })
  check(
    '"Check now" asks for the index and the newest note only',
    after === before + 2 && stub.requests.slice(before).join(' ') === `/patch-notes /patch-notes/${NEWEST}`,
    stub.requests.slice(before).join(' ')
  )

  await page.click('[data-testid="nav-preferences"]')
  await page.click('[data-testid="prefs-rail-patchnotes"]', { timeout: 15_000 })
  const sw = '[data-testid="pref-patch-notes-launch"] input'
  await page.click(sw)
  check('the switch turns off', await settle(() => page.isChecked(sw), (c) => !c, { timeoutMs: 10_000 }).then((c) => !c))
}

// ---- launch 3: switched off ---------------------------------------------------------------------

async function thirdLaunch(page: Page, stub: Stub): Promise<void> {
  await page.click(NAV)
  const pages = await settle(() => rowPages(page), (p) => p.length === 4, { timeoutMs: 15_000, pollMs: 100 })
  check('with the switch off the saved notes still draw', pages.length === 4, String(pages.length))
  const n = await settleStable(() => Promise.resolve(stub.requests.length), { pollMs: 1_500, stable: 4, timeoutMs: 30_000 })
  check('…and the launch made no request at all', n === 0, stub.requests.join(' '))
}

async function main(): Promise<void> {
  await buildIfStale()
  const stub = await startStub()
  const userData = makeUserData()
  let page: Page | null = null
  try {
    console.log('launch 1: the site before November 10…')
    let run = await launch(userData, stub)
    page = run.page
    watchConsole(page)
    await firstLaunch(page, stub)
    if (failures.length) await dumpArtifacts(page, 'patch-notes-1-FAIL')
    await run.close()

    console.log('launch 2: a new note on the site…')
    stub.requests.length = 0
    stub.serveIndex(INDEX)
    run = await launch(userData, stub)
    page = run.page
    watchConsole(page)
    await secondLaunch(page, stub)
    if (failures.length) await dumpArtifacts(page, 'patch-notes-2-FAIL')
    await run.close()

    console.log('launch 3: the switch off…')
    stub.requests.length = 0
    run = await launch(userData, stub)
    page = run.page
    watchConsole(page)
    await thirdLaunch(page, stub)
    if (failures.length) await dumpArtifacts(page, 'patch-notes-3-FAIL')
    await run.close()

    check('no renderer console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
  } finally {
    await stub.close()
    await removeUserData(userData)
  }
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error -', err)
  note('the patch-notes spec did not complete')
  process.exitCode = 1
})
