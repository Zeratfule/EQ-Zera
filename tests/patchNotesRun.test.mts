// patchNotesRun.test.mts — one patch-notes check end to end against a FAKE site serving the
// committed fixtures (src/main/patchNotes/run.ts), plus the origin gate and the GET itself
// (src/main/patchNotes/net.ts). No Electron, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UNREACHABLE, UNREADABLE, runCheck, type CheckDeps } from '../src/main/patchNotes/run'
import { BROWSER_UA, fetchPageText, loopbackOrigin, patchNotesOriginFor } from '../src/main/patchNotes/net'
import { EMPTY_PATCH_NOTES_CACHE, PATCH_NOTES_ORIGIN, unreadCount, type PatchNotesCache } from '../src/shared/patchNotes'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'patch-notes')
const ORIGIN = 'http://127.0.0.1:9'
const INDEX = readFileSync(join(FIX, 'index.html'), 'utf8')

/** The index fixture with its newest row removed: the site as it stood before November 10. */
function olderIndex(): string {
  const marker = 'window.EQL.News.articles = '
  const at = INDEX.indexOf(marker) + marker.length
  const end = INDEX.indexOf('\n', at)
  const rows = JSON.parse(INDEX.slice(at, end)) as unknown[]
  return INDEX.slice(0, at) + JSON.stringify(rows.slice(1)) + INDEX.slice(end)
}

interface FakeSite {
  deps: CheckDeps
  requested: string[]
  maxInFlight: () => number
}

function fakeSite(opts: { index?: string; fail?: (url: string) => boolean } = {}): FakeSite {
  const requested: string[] = []
  let inFlight = 0
  let max = 0
  const deps: CheckDeps = {
    origin: ORIGIN,
    now: () => 1_800_000_000_000,
    keepHref: () => true,
    progress: () => Promise.resolve(),
    fetchText: async (url) => {
      requested.push(url)
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      if (opts.fail?.(url)) throw new Error('HTTP 503')
      if (url === `${ORIGIN}/patch-notes`) return opts.index ?? INDEX
      const name = url.slice(`${ORIGIN}/patch-notes/`.length)
      return readFileSync(join(FIX, `${name}.html`), 'utf8')
    }
  }
  return { deps, requested, maxInFlight: () => max }
}

test('a first check: the index, then every article ONE AT A TIME, and nothing announced', async () => {
  const site = fakeSite()
  const r = await runCheck(EMPTY_PATCH_NOTES_CACHE, site.deps)
  assert.equal(r.error, null)
  assert.equal(r.requests, 5)
  assert.equal(site.maxInFlight(), 1)
  assert.equal(site.requested[0], `${ORIGIN}/patch-notes`)
  assert.equal(site.requested[1], `${ORIGIN}/patch-notes/eql-update-notes-11-10-2026`)
  assert.equal(Object.keys(r.cache.articles).length, 4)
  assert.deepEqual(r.arrived, [])
  assert.equal(unreadCount(r.cache), 1)
})

test('a second check of an unchanged site asks for the index and the newest note only', async () => {
  const first = await runCheck(EMPTY_PATCH_NOTES_CACHE, fakeSite().deps)
  const site = fakeSite()
  const r = await runCheck(first.cache, site.deps)
  assert.deepEqual(site.requested, [`${ORIGIN}/patch-notes`, `${ORIGIN}/patch-notes/eql-update-notes-11-10-2026`])
  assert.deepEqual(r.arrived, [])
})

test('a note posted since the last check is announced and downloaded', async () => {
  const before = await runCheck(EMPTY_PATCH_NOTES_CACHE, fakeSite({ index: olderIndex() }).deps)
  assert.equal(before.cache.index.length, 3)
  const r = await runCheck(before.cache, fakeSite().deps)
  assert.deepEqual(r.arrived.map((x) => x.pageName), ['eql-update-notes-11-10-2026'])
  assert.ok('eql-update-notes-11-10-2026' in r.cache.articles)
  assert.equal(unreadCount(r.cache), 2)
})

test('an unreachable index stops the check before any article and starts the backoff', async () => {
  const site = fakeSite({ fail: () => true })
  const r = await runCheck(EMPTY_PATCH_NOTES_CACHE, site.deps)
  assert.equal(r.error, UNREACHABLE)
  assert.equal(site.requested.length, 1)
  assert.equal(r.cache.failures, 1)
  assert.equal(r.cache.index.length, 0)
})

test('a page that is not the patch notes list does not empty the cache', async () => {
  const first = await runCheck(EMPTY_PATCH_NOTES_CACHE, fakeSite().deps)
  const r = await runCheck(first.cache, fakeSite({ index: '<html>maintenance</html>' }).deps)
  assert.equal(r.error, UNREADABLE)
  assert.equal(r.cache.index.length, 4)
  assert.equal(Object.keys(r.cache.articles).length, 4)
})

test('an article that fails stops the rest; what landed before it is kept', async () => {
  const site = fakeSite({ fail: (url) => url.endsWith('eql-hotfix-notes-11-3-2026') })
  const r = await runCheck(EMPTY_PATCH_NOTES_CACHE, site.deps)
  assert.equal(r.error, UNREACHABLE)
  assert.equal(site.requested.length, 4)
  assert.deepEqual(Object.keys(r.cache.articles).sort(), ['eql-hotfix-notes-11-4-2026', 'eql-update-notes-11-10-2026'])
  assert.equal(r.cache.failures, 1)
  assert.equal(r.cache.index.length, 4)
})

test('progress is published after the index and after every article', async () => {
  const seen: PatchNotesCache[] = []
  const site = fakeSite()
  await runCheck(EMPTY_PATCH_NOTES_CACHE, { ...site.deps, progress: (c) => (seen.push(c), Promise.resolve()) })
  assert.deepEqual(seen.map((c) => Object.keys(c.articles).length), [0, 1, 2, 3, 4])
})

// ---- the origin and the GET ---------------------------------------------------------------------

test('a packaged build talks to www.everquestlegends.com and only there', () => {
  assert.equal(PATCH_NOTES_ORIGIN, 'https://www.everquestlegends.com')
  assert.equal(patchNotesOriginFor(false, undefined), PATCH_NOTES_ORIGIN)
  // The e2e variable means nothing outside the headless test build.
  assert.equal(patchNotesOriginFor(false, 'http://127.0.0.1:5000'), PATCH_NOTES_ORIGIN)
})

test('the headless test build is dark unless it names a numeric loopback stub', () => {
  assert.equal(patchNotesOriginFor(true, undefined), '')
  assert.equal(patchNotesOriginFor(true, 'http://127.0.0.1:5000'), 'http://127.0.0.1:5000')
  for (const bad of ['https://www.everquestlegends.com', 'http://localhost:5000', 'http://10.0.0.1:80', 'http://127.0.0.1:5000/x', 'http://u:p@127.0.0.1:1', 'not a url']) {
    assert.equal(loopbackOrigin(bad), '', bad)
  }
})

function fakeResponse(body: string, init: { status?: number; url?: string } = {}): Response {
  const res = new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'text/html' } })
  Object.defineProperty(res, 'url', { value: init.url ?? `${ORIGIN}/patch-notes` })
  return res
}

test('the GET sends a browser User-Agent, no credentials, and nothing about the user', async () => {
  let seen: RequestInit | undefined
  const fake = ((_url: string, init?: RequestInit) => {
    seen = init
    return Promise.resolve(fakeResponse('ok'))
  }) as typeof fetch
  assert.equal(await fetchPageText(`${ORIGIN}/patch-notes`, ORIGIN, fake), 'ok')
  assert.equal(seen?.method, 'GET')
  assert.equal(seen?.credentials, 'omit')
  assert.deepEqual(seen?.headers, { 'User-Agent': BROWSER_UA, Accept: 'text/html' })
  assert.ok(seen?.signal, 'every request carries a timeout')
})

test('the GET refuses a redirect off the origin and a non-2xx answer', async () => {
  const off = (() => Promise.resolve(fakeResponse('x', { url: 'https://evil.example/patch-notes' }))) as typeof fetch
  await assert.rejects(fetchPageText(`${ORIGIN}/patch-notes`, ORIGIN, off))
  const down = (() => Promise.resolve(fakeResponse('x', { status: 503 }))) as typeof fetch
  await assert.rejects(fetchPageText(`${ORIGIN}/patch-notes`, ORIGIN, down))
})
