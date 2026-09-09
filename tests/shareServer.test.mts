// ============================================================================
// shareServer.test.mts — THE SHARE LINK SERVICE (share-server/, phase 2).
// ============================================================================
//
// The worker turns a character profile into a URL. It runs on Cloudflare, but `handleRequest` is a
// PURE function of (request, bindings, clock) — no Cloudflare imports, no ambient time — so the
// whole service is exercised here under plain node:test with an in-memory KV fake. That is the
// point of the shape: a workerd emulator would have made this suite slow, platform-specific and
// therefore optional, and an optional suite is one nobody runs.
//
// What is guarded here, and why each one is load-bearing:
//
//   * THE ROUND TRIP. create -> read -> HTML -> PNG -> delete -> 404. If any link in that chain is
//     wrong the feature does not exist, and every later guard is about a way it could be wrong
//     while still appearing to work.
//   * THE SERVICE NEVER TRUSTS THE APP. A tampered envelope (a body edited under a stale `sum`) is
//     REFUSED rather than stored, and a `kind:'settings'` envelope is refused too: this service
//     stores character profiles, and "it is a valid EQC1 string" is not the same claim. Both are
//     400s a hostile client sees before a byte reaches KV.
//   * THE STRING ON THE PAGE IS THE REAL FORMAT. The page's `EQC1-` string is built by the SERVER
//     with `CompressionStream('deflate-raw')`; the app reads it with `node:zlib`. Two runtimes,
//     one format — so the test decodes the page's own string with `decodeShareString` and compares
//     the body. A drift here would be invisible until a user pasted a string that would not open.
//   * ESCAPING. The body is arbitrary text from a stranger. An item named `<img onerror=...>` must
//     not put a raw `<` in the page, ever. This is the one that turns a share link into an XSS
//     hole if it regresses.
//   * THE CLOCK (owner ruling 2). 180-day TTL; a view refreshes it only when the record is more
//     than 30 days stale. Asserted by COUNTING KV WRITES against an injected clock — a read at 20
//     days writes nothing, a read at 40 days rewrites both keys — because "it refreshed" and "it
//     rewrote on every read" look identical from the outside until the free tier's write budget
//     runs out.
//   * THE TOKEN. A share carries a private delete token, stored only as a SHA-256 digest. A wrong
//     token is 401 on both update and delete, and a delete actually stops it serving (ruling 4:
//     revoking must revoke).
//
// IT RUNS ON THE REAL DUMP. The profile under test is built from
// `Primitive_freeport-Inventory.txt` joined to the committed item DB, the same way
// `tests/characterShare.test.mts` does it — so the envelope the service is handed is the shape the
// app actually produces, not a toy with two fields.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { sheetCells, sumGear, type SheetCellView, type WornItemBlock } from '../src/shared/characterSheet'
import { buildItemDbIndex, itemKey, type ItemDbFile } from '../src/main/itemsDb'
import { buildCharacterShare, type CharacterProfileShare } from '../src/shared/characterShare'
import { canonicalJson, makeEnvelope, type ShareEnvelope } from '../src/shared/shareSchema'
import { decodeShareString } from '../src/main/shareCodec'
import { handleRequest } from '../share-server/src/handler'
import type { Env, KvLike, KvPutOptions } from '../share-server/src/env'

const APP = '1.20.0'
const CAPTURED = 1_757_000_000_000
const ORIGIN = 'https://share.eqzera.com'
const DAY = 24 * 60 * 60 * 1000
/** A fixed epoch so every expiry assertion is a number, not a moving target. */
const T0 = Date.UTC(2026, 8, 8, 12, 0, 0)

// ---- the real character, joined the way the handler joins it -----------------------------

const dump = parseInventoryDump(
  readFileSync(join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'), 'utf8')
)
const dbIndex = buildItemDbIndex(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'data', 'items.json'), 'utf8')
  ) as ItemDbFile
)
const cells: SheetCellView[] = sheetCells(dump).cells.map((cell) => {
  if (!cell.item) return { ...cell, item: null }
  const record = dbIndex.get(itemKey(cell.item.baseName))
  return {
    ...cell,
    item: {
      ...cell.item,
      known: record !== undefined,
      ...(record?.iconId === undefined ? {} : { iconId: record.iconId })
    }
  }
})
const worn: WornItemBlock[] = []
for (const cell of cells) {
  if (cell.item) worn.push({ tier: cell.item.tier, block: dbIndex.get(itemKey(cell.item.baseName))?.stats })
}
const totals = sumGear(worn)

function profile(): CharacterProfileShare {
  return buildCharacterShare({
    cells,
    totals,
    look: { race: 'DW', sex: 'F', face: 2 },
    classes: ['WAR', 'CLR', 'SHM'],
    name: 'Primitive',
    level: 60,
    scores: { tank: 74, dps: 61, heal: 38, solo: 55 },
    capturedAt: CAPTURED
  })
}

function envelopeFor(body: CharacterProfileShare): ShareEnvelope {
  return makeEnvelope('character', body, APP, new Date(CAPTURED))
}

/** The eight-byte PNG signature plus filler. The service checks the magic, never the pixels. */
const CARD_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x04, 0xb0, 0x00, 0x00, 0x02, 0x76, 0x08, 0x06, 0x00, 0x00, 0x00
])
const CARD_B64 = Buffer.from(CARD_BYTES).toString('base64')

// ---- the harness --------------------------------------------------------------------------

interface Stored {
  value: Uint8Array
  /** epoch millis, or null when the write carried no TTL (this service always carries one) */
  expiresAt: number | null
}

/**
 * Workers KV, in memory, HONOURING `expirationTtl` against the injected clock.
 *
 * The TTL is the whole of the expiry design (there is no sweeper in the service), so a fake that
 * ignored it would make the 180-day rule untestable. `writes` counts `put` calls: that is how the
 * 30-day read-refresh window is observed, since a refreshing read and a non-refreshing read return
 * byte-identical bodies.
 */
class FakeKv implements KvLike {
  readonly map = new Map<string, Stored>()
  writes = 0
  constructor(private readonly clock: () => number) {}

  private live(key: string): Stored | null {
    const stored = this.map.get(key)
    if (!stored) return null
    if (stored.expiresAt !== null && stored.expiresAt <= this.clock()) {
      this.map.delete(key)
      return null
    }
    return stored
  }

  get(key: string, type: 'json'): Promise<unknown>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  get(key: string, type: 'text'): Promise<string | null>
  get(key: string, type: 'json' | 'arrayBuffer' | 'text'): Promise<unknown> {
    const stored = this.live(key)
    if (!stored) return Promise.resolve(null)
    if (type === 'arrayBuffer') {
      return Promise.resolve(stored.value.buffer.slice(0) as ArrayBuffer)
    }
    const text = new TextDecoder().decode(stored.value)
    return Promise.resolve(type === 'json' ? JSON.parse(text) : text)
  }

  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: KvPutOptions
  ): Promise<void> {
    this.writes += 1
    let bytes: Uint8Array
    if (typeof value === 'string') bytes = new TextEncoder().encode(value)
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value.slice(0))
    else bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    const ttl = options?.expirationTtl
    this.map.set(key, { value: bytes, expiresAt: ttl === undefined ? null : this.clock() + ttl * 1000 })
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.map.delete(key)
    return Promise.resolve()
  }
}

interface Harness {
  env: Env
  kv: FakeKv
  /** move the injected clock */
  setNow: (ms: number) => void
  call: (method: string, path: string, init?: RequestInit) => Promise<Response>
  postJson: (path: string, body: unknown, token?: string) => Promise<Response>
}

function harness(overrides: Partial<Env> = {}): Harness {
  let now = T0
  const clock = (): number => now
  const kv = new FakeKv(clock)
  const env: Env = { SHARES: kv, PUBLIC_ORIGIN: ORIGIN, ...overrides }
  const call = (method: string, path: string, init: RequestInit = {}): Promise<Response> =>
    handleRequest(new Request(`${ORIGIN}${path}`, { method, ...init }), env, clock)
  const postJson = (path: string, body: unknown, token?: string): Promise<Response> =>
    call(path.startsWith('/api/v1/shares/') ? 'PUT' : 'POST', path, {
      headers: {
        'Content-Type': 'application/json',
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` })
      },
      body: JSON.stringify(body)
    })
  return { env, kv, setNow: (ms) => { now = ms }, call, postJson }
}

interface CreateReply {
  id: string
  url: string
  deleteToken: string
  expiresAt: string
}

async function create(h: Harness, body?: unknown): Promise<CreateReply> {
  const res = await h.postJson('/api/v1/shares', body ?? {
    envelope: envelopeFor(profile()),
    card: CARD_B64
  })
  assert.equal(res.status, 201, await res.clone().text())
  return (await res.json()) as CreateReply
}

// ---- the round trip -------------------------------------------------------------------------

test('create -> read -> HTML -> PNG -> delete -> 404', async () => {
  const h = harness()
  const made = await create(h)
  assert.match(made.id, /^[A-Za-z0-9]{10}$/, 'ten characters of the id alphabet')
  assert.equal(made.url, `${ORIGIN}/s/${made.id}`, 'the URL is built from PUBLIC_ORIGIN')
  assert.ok(made.deleteToken.length >= 40, 'a 32-byte token, base64url')
  assert.equal(made.expiresAt, new Date(T0 + 180 * DAY).toISOString(), '180 days from the write')

  const read = await h.call('GET', `/p/${made.id}`)
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('Cache-Control'), 'no-store')
  assert.equal(read.headers.get('X-Content-Type-Options'), 'nosniff')
  const payload = (await read.json()) as { envelope: ShareEnvelope; createdAt: string }
  assert.equal(canonicalJson(payload.envelope.body), canonicalJson(profile()), 'the body survives')
  assert.equal(payload.createdAt, new Date(T0).toISOString())

  const page = await h.call('GET', `/s/${made.id}`)
  assert.equal(page.status, 200)
  assert.match(page.headers.get('Content-Type') ?? '', /^text\/html/)

  const png = await h.call('GET', `/c/${made.id}.png`)
  assert.equal(png.status, 200)
  assert.equal(png.headers.get('Content-Type'), 'image/png')
  assert.equal(png.headers.get('Cache-Control'), 'public, max-age=3600')
  assert.deepEqual(new Uint8Array(await png.arrayBuffer()), CARD_BYTES)

  const gone = await h.call('DELETE', `/api/v1/shares/${made.id}`, {
    headers: { Authorization: `Bearer ${made.deleteToken}` }
  })
  assert.equal(gone.status, 204)
  // Ruling 4: revoking a link must ACTUALLY stop it serving — all three routes, not just the app's.
  for (const path of [`/p/${made.id}`, `/s/${made.id}`, `/c/${made.id}.png`]) {
    assert.equal((await h.call('GET', path)).status, 404, path)
  }
})

// ---- the string on the page -----------------------------------------------------------------

test("the page's EQC1 string decodes with the app's own decoder", async () => {
  const h = harness()
  const made = await create(h)
  const html = await (await h.call('GET', `/s/${made.id}`)).text()
  const match = /EQC1-[A-Za-z0-9_-]+/.exec(html)
  assert.ok(match, 'the page offers a share string to paste')
  const decoded = decodeShareString(match[0])
  assert.ok(decoded.ok, `the server-built string must decode: ${decoded.ok ? '' : decoded.error}`)
  assert.equal(decoded.envelope.kind, 'character')
  assert.equal(canonicalJson(decoded.envelope.body), canonicalJson(profile()))
})

test('the page carries the Open Graph tags an unfurl needs, built from PUBLIC_ORIGIN', async () => {
  const h = harness()
  const made = await create(h)
  const res = await h.call('GET', `/s/${made.id}`)
  const html = await res.text()
  assert.ok(
    html.includes(`<meta property="og:image" content="${ORIGIN}/c/${made.id}.png">`),
    'og:image is the card URL on the public origin'
  )
  assert.ok(html.includes(`<meta property="og:url" content="${ORIGIN}/s/${made.id}">`))
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image">'))
  assert.ok(/<meta property="og:title" content="Primitive · Level 60 WAR \/ CLR \/ SHM">/.test(html))
  const csp = res.headers.get('Content-Security-Policy') ?? ''
  assert.match(csp, /default-src 'none'/)
  assert.match(csp, /script-src 'nonce-[A-Za-z0-9_-]+'/)
})

test('the card image is skipped, not faked, when the share carries none', async () => {
  const h = harness()
  const made = await create(h, { envelope: envelopeFor(profile()) })
  const html = await (await h.call('GET', `/s/${made.id}`)).text()
  assert.ok(!html.includes('<img class="card"'), 'no card <img> when there is no card to point it at')
  const png = await h.call('GET', `/c/${made.id}.png`)
  assert.equal(png.status, 404)
  assert.match(png.headers.get('Content-Type') ?? '', /^application\/json/)
  assert.equal(((await png.json()) as { error: string }).error, 'not-found')
})

// ---- escaping -------------------------------------------------------------------------------

test('a hostile item name never puts a raw < in the page', async () => {
  const h = harness()
  const hostile = profile()
  // `base` too: the page prefers the tier-stripped name, so the hostile text must be there as well.
  const name = `<img src=x onerror="alert(1)">`
  hostile.cells[0] = { ...hostile.cells[0]!, item: name, base: name, label: '</h1><script>' }
  hostile.name = '<script>alert(2)</script>'
  const made = await create(h, { envelope: envelopeFor(hostile) })
  const html = await (await h.call('GET', `/s/${made.id}`)).text()
  assert.ok(!html.includes('<img src=x'), 'the item name is escaped')
  assert.ok(!html.includes('<script>alert'), 'the name is escaped')
  assert.ok(!html.includes('</h1><script>'), 'the slot label is escaped')
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'), 'and it is still SHOWN')
  // The only <script> on the page is ours, and it carries the nonce.
  assert.equal((html.match(/<script/g) ?? []).length, 1)
  assert.match(html, /<script nonce="[A-Za-z0-9_-]+">/)
})

// ---- the trust gates ------------------------------------------------------------------------

test('a tampered envelope is refused before a byte reaches KV', async () => {
  const h = harness()
  const envelope = envelopeFor(profile()) as ShareEnvelope<'character', CharacterProfileShare>
  envelope.body.totals.ac += 500 // the numbers moved; the `sum` did not
  const res = await h.postJson('/api/v1/shares', { envelope })
  assert.equal(res.status, 400)
  assert.equal(((await res.json()) as { error: string }).error, 'checksum')
  assert.equal(h.kv.map.size, 0, 'nothing was stored')
})

test('a kind:settings envelope is refused - this service stores characters', async () => {
  const h = harness()
  const envelope = makeEnvelope('settings', { alerts: [] }, APP, new Date(CAPTURED))
  const res = await h.postJson('/api/v1/shares', { envelope })
  assert.equal(res.status, 400)
  assert.equal(((await res.json()) as { error: string }).error, 'unsupported-kind')
})

test('a body with no worn gear is not a character', async () => {
  const h = harness()
  const empty = { ...profile(), cells: [] }
  const res = await h.postJson('/api/v1/shares', { envelope: makeEnvelope('character', empty, APP) })
  assert.equal(res.status, 400)
  assert.equal(((await res.json()) as { error: string }).error, 'unreadable-profile')
})

test('the stored envelope is the SANITIZED one, so a smuggled key never reaches a reader', async () => {
  const h = harness()
  const smuggled = { ...profile(), evil: '<script>', capturedAt: CAPTURED } as unknown as CharacterProfileShare
  const made = await create(h, { envelope: makeEnvelope('character', smuggled, APP) })
  const read = await h.call('GET', `/p/${made.id}`)
  const payload = (await read.json()) as { envelope: ShareEnvelope }
  assert.ok(!JSON.stringify(payload.envelope).includes('evil'), 'the extra key did not survive')
  // …and the envelope we hand back is still self-consistent: its `sum` matches its own body.
  assert.equal(canonicalJson(payload.envelope.body), canonicalJson(profile()))
})

// ---- size ------------------------------------------------------------------------------------

test('an oversize envelope is 413, not a 64 KB row in KV', async () => {
  const h = harness()
  const envelope = { ...envelopeFor(profile()), junk: 'x'.repeat(70_000) }
  const res = await h.postJson('/api/v1/shares', { envelope })
  assert.equal(res.status, 413)
  assert.equal(((await res.json()) as { error: string }).error, 'too-large')
})

test('an oversize card is 413, and a non-PNG card is 400', async () => {
  const h = harness()
  const big = await h.postJson('/api/v1/shares', {
    envelope: envelopeFor(profile()),
    card: 'A'.repeat(600_000)
  })
  assert.equal(big.status, 413)
  const notPng = await h.postJson('/api/v1/shares', {
    envelope: envelopeFor(profile()),
    card: Buffer.from('GIF89a this is not a png').toString('base64')
  })
  assert.equal(notPng.status, 400)
  assert.equal(((await notPng.json()) as { error: string }).error, 'bad-card')
})

test('a body that is not JSON is 415, and JSON that is not JSON is 400', async () => {
  const h = harness()
  const wrongType = await h.call('POST', '/api/v1/shares', {
    headers: { 'Content-Type': 'text/plain' },
    body: 'hello'
  })
  assert.equal(wrongType.status, 415)
  assert.equal(((await wrongType.json()) as { error: string }).error, 'not-json')
  const broken = await h.call('POST', '/api/v1/shares', {
    headers: { 'Content-Type': 'application/json' },
    body: '{ not json'
  })
  assert.equal(broken.status, 400)
  assert.equal(((await broken.json()) as { error: string }).error, 'bad-json')
})

// ---- the token ------------------------------------------------------------------------------

test('update and delete need the right token, and an update keeps the id and the URL', async () => {
  const h = harness()
  const made = await create(h)

  const wrong = await h.postJson(`/api/v1/shares/${made.id}`, { envelope: envelopeFor(profile()) }, 'not-the-token')
  assert.equal(wrong.status, 401)
  assert.equal(((await wrong.json()) as { error: string }).error, 'unauthorized')

  const none = await h.postJson(`/api/v1/shares/${made.id}`, { envelope: envelopeFor(profile()) })
  assert.equal(none.status, 401, 'no Authorization header is not a pass')

  const noToken = await h.call('DELETE', `/api/v1/shares/${made.id}`)
  assert.equal(noToken.status, 401)

  h.setNow(T0 + 5 * DAY)
  const grown = { ...profile(), level: 61 }
  const ok = await h.postJson(`/api/v1/shares/${made.id}`, { envelope: makeEnvelope('character', grown, APP) }, made.deleteToken)
  assert.equal(ok.status, 200)
  const reply = (await ok.json()) as { id: string; url: string; expiresAt: string }
  assert.equal(reply.id, made.id, 'the id is unchanged')
  assert.equal(reply.url, made.url, 'so the link already pasted in a channel still works')
  assert.equal(reply.expiresAt, new Date(T0 + 5 * DAY + 180 * DAY).toISOString(), 'an update always refreshes')

  const read = await h.call('GET', `/p/${made.id}`)
  const body = ((await read.json()) as { envelope: ShareEnvelope }).envelope.body as CharacterProfileShare
  assert.equal(body.level, 61, 'the new profile is what serves now')
})

test('an update with no card KEEPS the card, and its expiry moves with the record', async () => {
  const h = harness()
  const made = await create(h)
  h.setNow(T0 + 10 * DAY)
  const res = await h.postJson(`/api/v1/shares/${made.id}`, { envelope: envelopeFor(profile()) }, made.deleteToken)
  assert.equal(res.status, 200)
  const png = await h.call('GET', `/c/${made.id}.png`)
  assert.equal(png.status, 200, 'the card is still there')
  // …and it was REWRITTEN, so it cannot age out thirty days before the profile it illustrates.
  h.setNow(T0 + 10 * DAY + 179 * DAY)
  assert.equal((await h.call('GET', `/c/${made.id}.png`)).status, 200)
})

// ---- the clock (owner ruling 2) --------------------------------------------------------------

test('a view refreshes the 180-day clock only when the record is over 30 days stale', async () => {
  const h = harness()
  const made = await create(h)
  const afterCreate = h.kv.writes

  h.setNow(T0 + 20 * DAY)
  const early = await h.call('GET', `/p/${made.id}`)
  assert.equal(early.status, 200)
  assert.equal(h.kv.writes, afterCreate, 'a read inside the 30-day window writes nothing')
  assert.equal(
    ((await early.json()) as { expiresAt: string }).expiresAt,
    new Date(T0 + 180 * DAY).toISOString(),
    'and the expiry still counts from the create'
  )

  h.setNow(T0 + 40 * DAY)
  const late = await h.call('GET', `/p/${made.id}`)
  assert.equal(late.status, 200)
  assert.equal(h.kv.writes, afterCreate + 2, 'past the window BOTH keys are rewritten')
  assert.equal(
    ((await late.json()) as { expiresAt: string }).expiresAt,
    new Date(T0 + 40 * DAY + 180 * DAY).toISOString()
  )
})

test('a share nobody looks at expires 180 days after its last write', async () => {
  const h = harness()
  const made = await create(h)
  h.setNow(T0 + 179 * DAY)
  assert.equal((await h.call('GET', `/p/${made.id}`)).status, 200)
  // The read above was past the 30-day window, so it pushed the clock out; a share left alone
  // from that moment is gone 180 days later and every route says so.
  h.setNow(T0 + 179 * DAY + 181 * DAY)
  assert.equal((await h.call('GET', `/p/${made.id}`)).status, 404)
  assert.equal((await h.call('GET', `/s/${made.id}`)).status, 404)
  assert.equal((await h.call('GET', `/c/${made.id}.png`)).status, 404)
})

// ---- routing --------------------------------------------------------------------------------

test('GET / redirects to the website, and an unknown route is 404 JSON', async () => {
  const h = harness()
  const home = await h.call('GET', '/')
  assert.equal(home.status, 302)
  assert.equal(home.headers.get('Location'), 'https://eqzera.com/')
  assert.equal(home.headers.get('X-Content-Type-Options'), 'nosniff')

  for (const path of ['/nope', '/s/', '/p/not$an$id', '/api/v1/other', '/c/abc.jpg']) {
    const res = await h.call('GET', path)
    assert.equal(res.status, 404, path)
    assert.match(res.headers.get('Content-Type') ?? '', /^application\/json/, path)
    assert.equal(((await res.json()) as { error: string }).error, 'not-found', path)
  }
  // A wrong method on a real path is "there is nothing here", not a 405 the spec never listed.
  assert.equal((await h.call('GET', '/api/v1/shares')).status, 404)
  assert.equal((await h.call('POST', '/p/abcdefghij')).status, 404)
})

test('no CORS headers on /api - the app calls this from main, never from a browser', async () => {
  const h = harness()
  const res = await h.postJson('/api/v1/shares', { envelope: envelopeFor(profile()) })
  assert.equal(res.status, 201)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
})

// ---- rate limiting --------------------------------------------------------------------------

test('the rate limiters refuse with 429, and an ABSENT binding allows', async () => {
  const deny = { limit: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }) }
  const limited = harness({ CREATE_LIMIT: deny, READ_LIMIT: deny })
  const create429 = await limited.postJson('/api/v1/shares', { envelope: envelopeFor(profile()) })
  assert.equal(create429.status, 429)
  assert.equal(((await create429.json()) as { error: string }).error, 'rate-limited')
  assert.equal((await limited.call('GET', '/p/abcdefghij')).status, 429)
  assert.equal(limited.kv.map.size, 0, 'a refused create never touches KV')

  // No binding at all — `wrangler dev` and this suite — takes the SAME path, and it allows.
  const open = harness()
  assert.equal((await open.postJson('/api/v1/shares', { envelope: envelopeFor(profile()) })).status, 201)
})
