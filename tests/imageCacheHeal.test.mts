// ============================================================================
// imageCacheHeal.test.mts — a cached image that will not read back (JOS-266).
// ============================================================================
//
// THE READING THIS SUITE EXISTS FOR: `image cache: could not read <path>` arrived in the error
// store as a new family — ~290 occurrences across 0.20–0.23, the largest fingerprint
// 8f0e7721ddcad03b at 198 on one build — and the exemplar carries `code=ENOENT`. A file that
// `existsSync` had just confirmed was gone by the time `readFile` opened it: antivirus taking the
// folder, a cleaner emptying it, a permission changing under a running app. The app's answer was to
// file an error and show the user nothing.
//
// TWO CHANGES, ONE DECISION, and this suite drives both because neither is worth much alone:
//   * IT HEALS. The entry is evicted (userData only) and the request falls through to the same
//     fetch a never-cached image takes, so the outcome is the picture, a beat late.
//   * IT IS A WARNING. One console line per failure CODE per session plus the
//     `imageCacheReadFailures` counter, instead of an errors.log line and a `mainErrorLogLines`
//     tick — so the error store stops counting a self-healed read as an error.
//
// WHAT IS DRIVEN AND HOW. The whole `eqimg://` handler, for real: Electron is INJECTED
// (`installImageCacheProtocol` takes a `protocol` and the userData dir), the fetch is injected, and
// the two sinks are injected — so this runs the production request path with no Electron, no
// network and no fixtures, exactly as `tests/imageCache.test.mts` runs the pure half.
//
// THE UNREADABLE ENTRY IS A DIRECTORY, and that is the honest limit of what a test can stage: the
// wild failure is ENOENT (a race with something else deleting the file) and EPERM (a scanner
// holding it), and neither can be produced deterministically on either platform from inside Node. A
// directory sitting where a file should be fails the read the same way at the same line — `EISDIR`
// rather than `ENOENT` — which is what this suite pins, and the branch does not read the code for
// anything but the one warn line. The EVICTION, which a directory cannot demonstrate (unlinking one
// fails, deliberately harmlessly), is pinned as source at the bottom.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  IMAGE_CACHE_DIR_NAME,
  MAX_WARNED_READ_CODES,
  type ProtocolLike,
  cacheStem,
  describeReadFailure,
  installImageCacheProtocol,
  parseEqImgUrl,
  resetImageFailures,
  resetImageFetchWarnings,
  resetImageReadWarnings,
  takeImageReadWarning
} from '../src/main/imageCache'
import { resetHealth, takeHealth } from '../src/main/telemetry/health'

const TEST_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Sixteen bytes that sniff as a PNG — `sniffImageMime` refuses anything under twelve. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8, 7)])

/** A real boss portrait URL, wrapped the way `lib/imageUrl.ts cachedImageUrl` wraps one. */
const BOSS = 'https://wiki.project1999.com/images/thumb/Npc_lord_nagafen.png/300px-Npc_lord_nagafen.png'
const BOSS_REQ = `eqimg://url/${encodeURIComponent(BOSS)}`

interface Harness {
  /** `<temp>/…/image-cache`, already created by the installer. */
  readonly cacheDir: string
  /** A pretend shipped-images directory, empty until a test puts something in it. */
  readonly bundledDir: string
  /** Every upstream URL the handler asked for, in order. */
  readonly fetches: string[]
  /** Every line the `warn` sink was given (production default: `logWarn`, console only). */
  readonly warns: string[]
  /** Every line the `onError` sink was given (production default: `logError` — errors.log). */
  readonly errors: string[]
  ask(url: string): Promise<GlobalResponse>
  dispose(): void
}

/** Install the real handler over a throwaway userData dir with every side effect injected. */
function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'eqc-imgheal-'))
  const bundledDir = join(root, 'wiki-images')
  mkdirSync(bundledDir, { recursive: true })
  const fetches: string[] = []
  const warns: string[] = []
  const errors: string[] = []
  let handler: ((request: GlobalRequest) => GlobalResponse | Promise<GlobalResponse>) | null = null
  const protocol: ProtocolLike = {
    registerSchemesAsPrivileged: () => undefined,
    handle: (_scheme, h) => {
      handler = h
    }
  }
  installImageCacheProtocol(protocol, {
    userData: root,
    bundledDir,
    fetchImpl: (input) => {
      fetches.push(String(input))
      return Promise.resolve(new Response(new Uint8Array(PNG), { status: 200 }))
    },
    log: () => undefined,
    onError: (msg) => errors.push(msg),
    warn: (msg) => warns.push(msg)
  })
  assert.ok(handler, 'the installer registers its handler synchronously')
  const registered = handler as (request: GlobalRequest) => GlobalResponse | Promise<GlobalResponse>
  return {
    cacheDir: join(root, IMAGE_CACHE_DIR_NAME),
    bundledDir,
    fetches,
    warns,
    errors,
    ask: (url) => Promise.resolve(registered(new Request(url))),
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}

/** The cache file name for an `eqimg://` request, with the extension the fetch will sniff. */
function stemOf(url: string): string {
  const req = parseEqImgUrl(url)
  assert.ok(req, 'the test asks for a shape the parser accepts')
  return cacheStem(req)
}

/** Every suite-visible piece of session state these tests share, back to a fresh session. */
function freshSession(): void {
  resetHealth()
  resetImageReadWarnings()
  resetImageFetchWarnings()
  resetImageFailures()
}

test('an entry that will not read back is served by RE-FETCHING it, not by a gap', async () => {
  freshSession()
  const h = harness()
  try {
    // A shipped icon that cannot be opened. The BUNDLE is probed first and is not ours to delete,
    // so this is the case where the heal is the fall-through alone.
    mkdirSync(join(h.bundledDir, 'item-1234.png'))

    const res = await h.ask('eqimg://item/1234')

    // THE USER GETS THE PICTURE. That is the whole ticket: a blank image became a re-download.
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array(PNG))
    assert.deepEqual(h.fetches, ['https://eqlwiki.com/index.php?title=Special:Redirect/file/Item_1234.png'])
    // …and it is kept, so the next launch pays nothing.
    assert.deepEqual(readFileSync(join(h.cacheDir, 'item-1234.png')), PNG)

    // THE SEVERITY. A warning, once, with a counter — and NOTHING on the sink that writes
    // errors.log. Before JOS-266 this request filed `image cache: could not read <path>`.
    assert.deepEqual(h.errors, [])
    assert.equal(h.warns.length, 1)
    assert.match(h.warns[0], /^\[everquest-companion\] image cache: could not read item-1234\.png \(EISDIR\)/)
    assert.match(h.warns[0], /re-fetching it/)
    assert.match(h.warns[0], /counted, not logged/)
    assert.equal(takeHealth().imageCacheReadFailures, 1)

    // THE BUNDLE IS NOT OURS TO EVICT: deleting an installer's file would not restore it, and on a
    // per-machine install the directory may not even be writable.
    assert.ok(existsSync(join(h.bundledDir, 'item-1234.png')))
  } finally {
    h.dispose()
    freshSession()
  }
})

test('the warn line names the FILE and the CODE, and never the path it was kept at', async () => {
  // The line goes to a dev console, but the rule this repo keeps everywhere is that a diagnostic
  // says the smallest thing that identifies the fact. The cache is one flat directory, so the name
  // identifies the entry completely and `<userData>` — which carries a Windows account name —
  // never has to appear.
  freshSession()
  const h = harness()
  try {
    mkdirSync(join(h.bundledDir, 'item-77.png'))
    await h.ask('eqimg://item/77')
    assert.equal(h.warns.length, 1)
    assert.doesNotMatch(h.warns[0], /eqc-imgheal-/)
    assert.doesNotMatch(h.warns[0], /[\\/]/)
    // And it is a WARN, not an error: no `:error` in the prefix, so neither a grep nor the error
    // store's shape-based ingest can read it as one.
    assert.doesNotMatch(h.warns[0], /everquest-companion:error/)
  } finally {
    h.dispose()
    freshSession()
  }
})

test('a runtime-cache entry is EVICTED and replaced — the bad name does not survive the request', async () => {
  // The userData cache OWNS its entries, so a `url` entry whose bytes are not an image is deleted
  // and re-fetched. This is the eviction-then-refetch machinery the read failure now shares, driven
  // on a real file: a directory cannot demonstrate a successful unlink, and nothing inside Node can
  // make a plain file fail to READ on demand.
  freshSession()
  const h = harness()
  try {
    const stem = stemOf(BOSS_REQ)
    // Under `.jpg` so the eviction is VISIBLE: the replacement is named by the sniffed bytes, so a
    // bad entry under the name the fetch will reuse would be indistinguishable from an overwrite.
    const bad = join(h.cacheDir, `${stem}.jpg`)
    writeFileSync(bad, Buffer.from('<html>the wiki said no</html>'))

    const res = await h.ask(BOSS_REQ)

    assert.equal(res.status, 200)
    assert.equal(existsSync(bad), false, 'the entry that could not serve is gone')
    assert.deepEqual(readFileSync(join(h.cacheDir, `${stem}.png`)), PNG, 'and real bytes replaced it')
    assert.deepEqual(h.fetches, [BOSS])
  } finally {
    h.dispose()
    freshSession()
  }
})

test('an eviction that FAILS still heals the request — the unlink is tidying, not the fix', async () => {
  // A file that cannot be read often cannot be deleted either (that is what a scanner holding it
  // looks like). The heal must not depend on the cleanup succeeding, so the cleanup failure is
  // swallowed and the fall-through does the work.
  freshSession()
  const h = harness()
  try {
    const stem = stemOf(BOSS_REQ)
    const stuck = join(h.cacheDir, `${stem}.gif`) // probed third; unlinking a directory fails
    mkdirSync(stuck)

    const res = await h.ask(BOSS_REQ)

    assert.equal(res.status, 200)
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), new Uint8Array(PNG))
    assert.ok(existsSync(stuck), 'the eviction failed, and was swallowed')
    // The bytes decide the name, so the replacement lands under `.png` beside it.
    assert.deepEqual(readFileSync(join(h.cacheDir, `${stem}.png`)), PNG)
    assert.deepEqual(h.errors, [])
    assert.equal(takeHealth().imageCacheReadFailures, 1)
  } finally {
    h.dispose()
    freshSession()
  }
})

test('IT CANNOT SPIN: every candidate is read once, and one request fetches at most once', async () => {
  // The heal-loop failure mode, pinned. Two unreadable candidates in one request must produce two
  // counts, ONE warn (same code) and exactly ONE fetch — never a retry of the read that just failed.
  freshSession()
  const h = harness()
  try {
    const stem = stemOf(BOSS_REQ)
    // The third and fourth names a `url` entry is probed under, so the two failures happen and the
    // replacement (named by the sniffed bytes: `.png`) still lands on a free name.
    mkdirSync(join(h.cacheDir, `${stem}.gif`))
    mkdirSync(join(h.cacheDir, `${stem}.webp`))

    const first = await h.ask(BOSS_REQ)
    assert.equal(first.status, 200)
    assert.equal(h.fetches.length, 1)
    assert.equal(h.warns.length, 1)
    assert.equal(takeHealth().imageCacheReadFailures, 2)

    // …and asking again does NOT re-fetch: the replacement landed under `.png`, which is probed
    // FIRST, so the healed entry answers before either directory is reached.
    const second = await h.ask(BOSS_REQ)
    assert.equal(second.status, 200)
    assert.equal(h.fetches.length, 1, 'the second request is served from the healed cache')
    assert.equal(h.warns.length, 1, 'one line per code per session, however many requests')
    assert.equal(takeHealth().imageCacheReadFailures, 0, 'and the healed request reads nothing bad')
    assert.deepEqual(h.errors, [])
  } finally {
    h.dispose()
    freshSession()
  }
})

test('a re-fetch that also fails falls through to the fetch failure path, unchanged', async () => {
  // The other half of "cannot spin": when the heal cannot complete, nothing new happens. The
  // status branch is still an error (a host that ANSWERED said no — that is ours to fix) and the
  // read failure beside it is still one warn and one count.
  freshSession()
  const root = mkdtempSync(join(tmpdir(), 'eqc-imgheal-'))
  const warns: string[] = []
  const errors: string[] = []
  let handler: ((request: GlobalRequest) => GlobalResponse | Promise<GlobalResponse>) | null = null
  installImageCacheProtocol(
    {
      registerSchemesAsPrivileged: () => undefined,
      handle: (_s, h) => {
        handler = h
      }
    },
    {
      userData: root,
      bundledDir: null,
      fetchImpl: () => Promise.resolve(new Response(null, { status: 404, statusText: 'Not Found' })),
      log: () => undefined,
      onError: (msg) => errors.push(msg),
      warn: (msg) => warns.push(msg)
    }
  )
  const ask = handler as unknown as (request: GlobalRequest) => Promise<GlobalResponse>
  try {
    mkdirSync(join(root, IMAGE_CACHE_DIR_NAME, 'item-9.png'))
    const res = await ask(new Request('eqimg://item/9'))
    assert.equal(res.status, 404)
    assert.equal(warns.length, 1, 'the read failure warned, once')
    assert.equal(errors.length, 1, 'and the 404 from a host that answered is still an error')
    assert.match(errors[0], /image cache: 404 for/)
    assert.equal(takeHealth().imageCacheReadFailures, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
    freshSession()
  }
})

test('the warn gate is ONE LINE PER CODE PER SESSION, and the code is bounded', () => {
  // Per code, because ENOENT (the file vanished), EPERM (something is holding it) and EISDIR
  // (something else is under that name) are three different stories about the machine — and the
  // second copy of any one of them says nothing the first did not.
  resetImageReadWarnings()
  assert.equal(takeImageReadWarning('ENOENT'), true)
  for (let i = 0; i < 500; i++) assert.equal(takeImageReadWarning('ENOENT'), false)
  assert.equal(takeImageReadWarning('EPERM'), true)
  assert.equal(takeImageReadWarning('EPERM'), false)
  // A pathological disk cannot grow the set without bound: past the ceiling nothing new warns, and
  // the counter carries the whole story anyway.
  for (let i = 0; i < 100; i++) takeImageReadWarning(`E${String(i)}`)
  assert.equal(takeImageReadWarning('EBUSY'), false, 'the ceiling holds')
  resetImageReadWarnings()
  assert.equal(takeImageReadWarning('EBUSY'), true, 'a new session warns again')
  resetImageReadWarnings()
  assert.ok(MAX_WARNED_READ_CODES < 100)
})

test('the failure description is TOTAL, and nothing can put free text into the line', () => {
  // It runs inside a catch, so it must never become the throw it is describing — and it is the one
  // place a value from the filesystem reaches a printed line.
  assert.equal(describeReadFailure(Object.assign(new Error('x'), { code: 'ENOENT' })), 'ENOENT')
  assert.equal(describeReadFailure(Object.assign(new Error('x'), { code: 'ERR_FS_FILE_TOO_LARGE' })), 'ERR_FS_FILE_TOO_LARGE')
  // Not an errno spelling ⇒ the NAME, which is the same bound the fetch side keeps.
  assert.equal(describeReadFailure(Object.assign(new TypeError('x'), { code: 'C:\\Users\\someone' })), 'TypeError')
  assert.equal(describeReadFailure(Object.assign(new Error('x'), { code: 42 })), 'Error')
  assert.equal(describeReadFailure(new Error('boom')), 'Error')
  for (const junk of [undefined, null, 'a string', 42, {}] as unknown[]) {
    assert.equal(describeReadFailure(junk), 'unknown')
  }
})

test('THE WIRING: the read failure evicts, counts, and never reaches the error sink', () => {
  // A SOURCE PIN for the one thing a staged failure cannot show — a successful unlink of an entry
  // whose READ failed (no plain file can be made to fail a read on demand from inside Node). The
  // order is the pin: evict, then count, then decide whether to say anything.
  const src = readFileSync(join(TEST_ROOT, 'src/main/imageCache.ts'), 'utf8')
  // The catch does one thing and files nothing.
  // The closer also ends normalizeUpstreamImageUrl's catch ~600 lines EARLIER in the file, so an
  // unanchored indexOf sliced backwards and yielded an empty string that matched nothing. Search
  // for it FROM the opener: the block pinned here is the catch inside `serveFromDisk`.
  const catchStart = src.indexOf('const bytes = await readFile(path)')
  const readCatch = src.slice(catchStart, src.indexOf('return null\n  }', catchStart))
  assert.match(readCatch, /await healUnreadableEntry\(path, err, repair, warn\)/)
  assert.doesNotMatch(readCatch, /onError\(/, 'a self-healed read never files an error')
  // …and that one thing is: evict (userData only), count, then decide whether to say anything.
  const heal = src.slice(
    src.indexOf('async function healUnreadableEntry'),
    src.indexOf('export function installImageCacheProtocol')
  )
  assert.match(heal, /if \(repair\) await unlink\(path\)\.catch\(ignoreCleanupFailure\)\s*\n\s*noteImageCacheReadFailure\(\)/)
  assert.match(heal, /const code = describeReadFailure\(err\)/)
  assert.match(heal, /if \(takeImageReadWarning\(code\)\) \{/)
  // The counter has ONE call site, and it is that one.
  assert.equal(src.match(/noteImageCacheReadFailure\(\)/g)?.length, 1)
  // And the sink it uses is the console-only one, as JOS-133 left it: `logWarn` writes to stdout
  // and never to errors.log, so a demoted condition cannot re-enter the error count.
  assert.match(src, /const warn = opts\.warn \?\? \(\(m: string\) => logWarn\(m\)\)/)
  assert.equal(src.match(/logError\(/g), null, 'imageCache never writes errors.log directly')
})
