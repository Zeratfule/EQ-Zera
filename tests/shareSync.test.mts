// ============================================================================
// shareSync.test.mts — SETTINGS SYNC (share-server/src/sync.ts): "send settings to another PC".
// ============================================================================
//
// The app encrypts its settings bundle CLIENT-SIDE (AES-GCM; the key never leaves the machine)
// and hands this service opaque bytes under a ten-character code. The whole contract is in
// docs/plans/settings-sync.md; what this suite holds down is the service's half of it:
//
//   * THE ROUND TRIP. POST -> code -> GET -> the same bytes back -> DELETE -> 404. If any link is
//     wrong the feature does not exist.
//   * READING DOES NOT CONSUME. A failed decrypt (a mistyped key segment) or an import the app
//     refused must be retryable; the 24-hour expiry is what ends the parcel, not the first reader.
//   * THE CODE IS THE ONLY KEY, and a code that does not exist and a code that is not even
//     well-formed get the SAME 404 — a distinguishable 400 would tell somebody walking the space
//     which of their guesses were shaped right.
//   * THE CAPS ARE REAL. 512 KB decoded, refused as 413 both before and after base64 decoding;
//     anything that is not base64 is a 400 rather than a row of garbage in KV.
//   * THE LIMITERS ARE WIRED. CREATE_LIMIT on the writes, READ_LIMIT on the read, and an ABSENT
//     binding allows — the same law the rest of this service runs under.
//   * NOTHING IS CACHED and NO CORS HEADER IS SENT: the bytes are a secret and the caller is the
//     app's main process, never a browser.
//
// The bundle in these tests is nonsense bytes on purpose. This service cannot read a real one
// either, and a test that fed it plaintext settings would be testing a design we do not have.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleRequest } from '../share-server/src/handler'
import { MAX_SYNC_BYTES, SYNC_TTL_SECONDS, type Env, type KvLike, type KvPutOptions } from '../share-server/src/env'

const ORIGIN = 'https://share.eqzera.com'
const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 8, 12, 9, 0, 0)

/** What the app would hand over: ciphertext, base64. Nonsense here, and necessarily so. */
const BLOB = Buffer.from('not-real-ciphertext-but-opaque-either-way').toString('base64')

// ---- the harness --------------------------------------------------------------------------------

interface Stored {
  value: string
  /** epoch millis, or null when the write carried no TTL (this route always carries one) */
  expiresAt: number | null
  ttl: number | undefined
}

/** Workers KV in memory, HONOURING `expirationTtl` — the 24-hour life is the whole expiry design. */
class MemKv implements KvLike {
  readonly map = new Map<string, Stored>()
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
    if (type === 'arrayBuffer') return Promise.resolve(new TextEncoder().encode(stored.value).buffer)
    return Promise.resolve(type === 'json' ? JSON.parse(stored.value) : stored.value)
  }
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: KvPutOptions): Promise<void> {
    const text = typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer)
    const ttl = options?.expirationTtl
    this.map.set(key, {
      value: text,
      ttl,
      expiresAt: ttl === undefined ? null : this.clock() + ttl * 1000
    })
    return Promise.resolve()
  }
  delete(key: string): Promise<void> {
    this.map.delete(key)
    return Promise.resolve()
  }
}

interface Harness {
  kv: MemKv
  setNow: (ms: number) => void
  call: (method: string, path: string, init?: RequestInit) => Promise<Response>
  post: (body: unknown, type?: string) => Promise<Response>
}

function harness(overrides: Partial<Env> = {}): Harness {
  let now = T0
  const clock = (): number => now
  const kv = new MemKv(clock)
  const env: Env = { SHARES: kv, PUBLIC_ORIGIN: ORIGIN, ...overrides }
  const call = (method: string, path: string, init: RequestInit = {}): Promise<Response> =>
    handleRequest(new Request(`${ORIGIN}${path}`, { method, ...init }), env, clock)
  return {
    kv,
    setNow: (ms) => { now = ms },
    call,
    post: (body, type = 'application/json') =>
      call('POST', '/api/v1/sync', {
        headers: { 'Content-Type': type },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      })
  }
}

interface Made {
  code: string
  expiresAt: string
}

async function send(h: Harness, blob = BLOB): Promise<Made> {
  const res = await h.post({ blob })
  assert.equal(res.status, 201, await res.clone().text())
  return (await res.json()) as Made
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error
}

// ---- the round trip -------------------------------------------------------------------------------

test('send -> receive -> delete -> 404, with a 24-hour code and no caching anywhere', async () => {
  const h = harness()
  const made = await send(h)
  assert.match(made.code, /^[A-Za-z0-9]{10}$/, 'ten characters of the id alphabet, nothing to mistype')
  assert.equal(made.expiresAt, new Date(T0 + SYNC_TTL_SECONDS * 1000).toISOString(), '24 hours')
  assert.equal(h.kv.map.get(`sync:${made.code}`)?.ttl, SYNC_TTL_SECONDS, 'the row carries the TTL, not a sweeper')

  const got = await h.call('GET', `/api/v1/sync/${made.code}`)
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('Cache-Control'), 'no-store', 'a secret is never cached')
  assert.equal(got.headers.get('X-Content-Type-Options'), 'nosniff')
  const payload = (await got.json()) as { blob: string; expiresAt: string }
  assert.equal(payload.blob, BLOB, 'the same bytes, verbatim')
  assert.equal(payload.expiresAt, made.expiresAt, 'measured from the POST, not from this read')

  const gone = await h.call('DELETE', `/api/v1/sync/${made.code}`)
  assert.equal(gone.status, 204)
  assert.equal((await gone.text()).length, 0)
  const after = await h.call('GET', `/api/v1/sync/${made.code}`)
  assert.equal(after.status, 404)
  assert.equal(await errorCode(after), 'not-found')
})

test('the create reply is no-store and carries no CORS header', async () => {
  const h = harness()
  const res = await h.post({ blob: BLOB })
  assert.equal(res.status, 201)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null, 'the app calls this from main')
})

test('reading does NOT consume: the import can be retried until the parcel expires', async () => {
  const h = harness()
  const made = await send(h)
  for (let i = 0; i < 3; i++) {
    const res = await h.call('GET', `/api/v1/sync/${made.code}`)
    assert.equal(res.status, 200, `read ${String(i + 1)}`)
    assert.equal(((await res.json()) as { blob: string }).blob, BLOB)
  }
  h.setNow(T0 + 25 * HOUR)
  assert.equal((await h.call('GET', `/api/v1/sync/${made.code}`)).status, 404, 'and then the TTL ends it')
})

test('two sends get two codes', async () => {
  const h = harness()
  const first = await send(h)
  const second = await send(h, Buffer.from('another bundle').toString('base64'))
  assert.notEqual(first.code, second.code)
  assert.equal(h.kv.map.size, 2)
  const got = await h.call('GET', `/api/v1/sync/${second.code}`)
  assert.equal(((await got.json()) as { blob: string }).blob, Buffer.from('another bundle').toString('base64'))
})

// ---- what is refused ------------------------------------------------------------------------------

test('an unknown code and a malformed one are the SAME 404', async () => {
  const h = harness()
  for (const code of ['AbCdEfGhIj', 'short', 'way-too-long-to-be-a-code', 'not$a$code']) {
    const res = await h.call('GET', `/api/v1/sync/${code}`)
    assert.equal(res.status, 404, code)
    assert.equal(await errorCode(res), 'not-found', code)
  }
})

test('a bundle over 512 KB is 413, whether it is caught before or after decoding', async () => {
  const h = harness()
  // 699052 base64 chars decode to exactly 512 KB + 1: past the decoded cap, under the body cap.
  const justOver = 'A'.repeat(Math.ceil((MAX_SYNC_BYTES + 1) / 3) * 4)
  const decoded = await h.post({ blob: justOver })
  assert.equal(decoded.status, 413)
  assert.equal(await errorCode(decoded), 'too-large')
  // And a body so large it is refused before `JSON.parse` ever allocates from it.
  const huge = await h.post({ blob: 'A'.repeat(900_000) })
  assert.equal(huge.status, 413)
  assert.equal(await errorCode(huge), 'too-large')
  assert.equal(h.kv.map.size, 0, 'nothing was stored')
})

test('a blob that is not base64, or not a string, is 400 bad-blob', async () => {
  const h = harness()
  const notBase64 = await h.post({ blob: 'not base64 !!!!' })
  assert.equal(notBase64.status, 400)
  assert.equal(await errorCode(notBase64), 'bad-blob')
  for (const body of [{}, { blob: 42 }, { blob: '' }, { blob: null }]) {
    const res = await h.post(body)
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.equal(await errorCode(res), 'bad-blob', JSON.stringify(body))
  }
  assert.equal(h.kv.map.size, 0)
})

test('a body that is not JSON is 415, and JSON that is not JSON is 400', async () => {
  const h = harness()
  const wrongType = await h.post('hello', 'text/plain')
  assert.equal(wrongType.status, 415)
  assert.equal(await errorCode(wrongType), 'not-json')
  const broken = await h.post('{ not json')
  assert.equal(broken.status, 400)
  assert.equal(await errorCode(broken), 'bad-json')
  const notAnObject = await h.post('"a string"')
  assert.equal(notAnObject.status, 400)
  assert.equal(await errorCode(notAnObject), 'bad-json')
})

test('a delete needs no token, and deleting a code that was never issued is still 204', async () => {
  const h = harness()
  const made = await send(h)
  // The code IS the secret (sync.ts header): whoever can read it can end it, and nothing else.
  assert.equal((await h.call('DELETE', `/api/v1/sync/${made.code}`)).status, 204)
  assert.equal((await h.call('DELETE', `/api/v1/sync/${made.code}`)).status, 204, 'idempotent')
  assert.equal((await h.call('DELETE', '/api/v1/sync/QqQqQqQqQq')).status, 204, 'and no membership oracle')
  assert.equal((await h.call('DELETE', '/api/v1/sync/nope')).status, 404, 'a malformed code is nothing at all')
})

test('a wrong method on a real path is 404, not a 405 this service has never had', async () => {
  const h = harness()
  const made = await send(h)
  assert.equal((await h.call('GET', '/api/v1/sync')).status, 404)
  assert.equal((await h.call('DELETE', '/api/v1/sync')).status, 404)
  assert.equal((await h.call('PUT', `/api/v1/sync/${made.code}`)).status, 404)
  assert.equal((await h.call('POST', `/api/v1/sync/${made.code}`)).status, 404)
  assert.equal((await h.call('GET', '/api/v1/sync/')).status, 404)
  // …and the share routes are untouched by the new prefix.
  assert.equal((await h.call('GET', '/api/v1/shares')).status, 404)
})

// ---- the limiters ----------------------------------------------------------------------------------

test('CREATE_LIMIT guards the writes, READ_LIMIT the read, and an ABSENT binding allows', async () => {
  const deny = { limit: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }) }
  const open = harness()
  const made = await send(open)

  const noWrites = harness({ CREATE_LIMIT: deny })
  const refused = await noWrites.post({ blob: BLOB })
  assert.equal(refused.status, 429)
  assert.equal(await errorCode(refused), 'rate-limited')
  assert.equal(noWrites.kv.map.size, 0, 'a refused send never touches KV')
  assert.equal((await noWrites.call('DELETE', `/api/v1/sync/${made.code}`)).status, 429, 'the delete too')
  assert.equal((await noWrites.call('GET', `/api/v1/sync/${made.code}`)).status, 404, 'but not the read')

  const noReads = harness({ READ_LIMIT: deny })
  const readRefused = await noReads.call('GET', `/api/v1/sync/${made.code}`)
  assert.equal(readRefused.status, 429)
  assert.equal(await errorCode(readRefused), 'rate-limited')
  assert.equal((await noReads.post({ blob: BLOB })).status, 201, 'the create limiter is a different budget')

  // No binding at all — `wrangler dev` and this suite — takes the SAME path, and it allows.
  assert.equal((await open.call('GET', `/api/v1/sync/${made.code}`)).status, 200)
})

// ---- the namespace ---------------------------------------------------------------------------------

test('the parcel lives under sync:<code> and holds nothing but the ciphertext and its stamp', async () => {
  const h = harness()
  const made = await send(h)
  const row = h.kv.map.get(`sync:${made.code}`)
  assert.ok(row, 'one key, named for the code')
  const stored = JSON.parse(row.value) as Record<string, unknown>
  assert.deepEqual(Object.keys(stored).sort(), ['at', 'blob'])
  assert.equal(stored.blob, BLOB)
  assert.equal(stored.at, T0)
  assert.equal([...h.kv.map.keys()].length, 1, 'and nothing else was written')
})

test('junk under sync:<code> is a 404, not a reply shaped out of whatever KV held', async () => {
  const h = harness()
  const made = await send(h)
  for (const junk of ['"a string"', '{"blob":42,"at":1}', '{"at":1}', '{"blob":"ok"}', 'null']) {
    h.kv.map.set(`sync:${made.code}`, { value: junk, expiresAt: null, ttl: undefined })
    const res = await h.call('GET', `/api/v1/sync/${made.code}`)
    assert.equal(res.status, 404, junk)
  }
})
