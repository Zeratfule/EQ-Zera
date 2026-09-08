// ============================================================================
// shareLinks.test.mts — share/links.ts, the app's half of "neither side trusts the other".
// ============================================================================
//
// `fetch` is INJECTED, so every claim below is made without a network and without Cloudflare. What
// is guarded, and why each one is load-bearing:
//
//   * PUBLISH SHAPE. The wire body is `{ envelope, card }`, the envelope is the app's own `EQC1`
//     wrapper over a RE-SANITIZED profile, and the card is base64 PNG. The service validates the
//     same envelope, so a shape drift here is a share nobody can store.
//   * POST CREATES, PUT REPLACES, AND A REFUSED PUT FALLS BACK. A token revoked from another
//     install (401) or a record that aged out (404, ruling 2) must not leave a character unable to
//     ever share again — both create a fresh record instead.
//   * THE ID AND THE URL ARE OURS. A reply naming its own `url` is ignored: the link is rebuilt
//     from the compiled origin, and a reply with an id outside the closed class is refused
//     outright rather than concatenated into a request path.
//   * THE READ IS AS UNTRUSTED AS A PASTE. A served envelope goes through `validateEnvelope` +
//     `sanitizeCharacterShare` — the same function a pasted string uses — so a tampered body, a
//     stale checksum and a settings bundle each get the paste box's own sentence.
//   * NOTHING THROWS. A transport failure, a timeout, a non-JSON reply and an HTTP 500 are all
//     `{ ok: false, error: <sentence> }`, because these results cross an IPC boundary.
//
// No Electron, no network, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, checksum, makeEnvelope } from '../src/shared/profiles'
import { encodeShareString } from '../src/main/shareCodec'
import { decodeCharacterShare } from '../src/main/characterShare'
import { fetchSharedProfile, publishShare, revokeShare, type ShareTarget } from '../src/main/share/links'
import { SHARE_ORIGIN } from '../src/main/share/net'

const APP = '1.20.0'
const ID = 'aB3xY9kQ2m'
const TOKEN = 'x'.repeat(43)
const EXISTING: ShareTarget = { id: ID, deleteToken: TOKEN }

/** A profile with exactly enough in it to survive the sanitizer. */
const PROFILE = {
  v: 1,
  capturedAt: 1_757_000_000_000,
  name: 'Primitive',
  level: 60,
  classes: ['Enchanter', 'Rogue'],
  look: { race: 'HUM', sex: 0 },
  cells: [{ slot: 'primary', label: 'Primary', item: 'Shiny Sword', exaltations: ['Fine Steel'] }],
  totals: { ac: 400, stats: [{ label: 'STR', total: 90 }], saves: [], unsummed: [], counted: 1, unknown: 0 }
}

/** One recorded call, and the fake that records it. */
interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

interface Reply {
  status: number
  json?: unknown
  /** a body that is not JSON at all — the "answered something we cannot read" case */
  text?: string
}

/**
 * A `fetch` that answers a scripted list of replies and remembers what it was asked. `throws`
 * makes the transport itself fail, which is what an offline machine and a timeout both look like.
 */
function fakeFetch(replies: Reply[] | 'throws'): { deps: { fetch: typeof globalThis.fetch }; calls: Call[] } {
  const calls: Call[] = []
  const queue = replies === 'throws' ? [] : [...replies]
  const fetchFn = (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const raw = typeof init?.body === 'string' ? init.body : ''
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: raw === '' ? null : (JSON.parse(raw) as unknown)
    })
    if (replies === 'throws') return Promise.reject(new Error('fetch failed'))
    const next = queue.shift() ?? { status: 500 }
    const text = next.text ?? (next.json === undefined ? '' : JSON.stringify(next.json))
    return Promise.resolve({ status: next.status, text: () => Promise.resolve(text) } as Response)
  }
  return { deps: { fetch: fetchFn as unknown as typeof globalThis.fetch }, calls }
}

/** The reply a create answers with. */
const created = { status: 201, json: { id: ID, url: 'https://evil.example/pwned', deleteToken: TOKEN } }

// ---- publishing -----------------------------------------------------------------------------

test('a first share POSTs the envelope and the card, and answers OUR url', async () => {
  const { deps, calls } = fakeFetch([created])
  const res = await publishShare(
    { profile: PROFILE, card: Buffer.from('PNGBYTES'), appVersion: APP },
    deps
  )
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.id, ID)
  assert.equal(res.updated, false)
  assert.equal(res.deleteToken, TOKEN)
  // THE REPLY'S OWN `url` IS IGNORED. What lands on somebody's clipboard is built here.
  assert.equal(res.url, `${SHARE_ORIGIN}/s/${ID}`)

  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.ok(call)
  assert.equal(call.method, 'POST')
  assert.equal(call.url, `${SHARE_ORIGIN}/api/v1/shares`)
  assert.equal(call.headers['Content-Type'], 'application/json')
  assert.equal(call.headers.Authorization, undefined)

  const body = call.body as { envelope: { kind: string; app: string; sum: string; body: unknown }; card: string }
  assert.equal(body.envelope.kind, 'character')
  assert.equal(body.envelope.app, APP)
  assert.equal(body.card, Buffer.from('PNGBYTES').toString('base64'))
  // The envelope's checksum is over the SANITIZED body, exactly as a pasted string's is.
  assert.equal(body.envelope.sum, checksum(canonicalJson(body.envelope.body)))
})

test('a profile with nothing in it is refused before a request is made', async () => {
  const { deps, calls } = fakeFetch([created])
  const res = await publishShare({ profile: { cells: [] }, card: null, appVersion: APP }, deps)
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.match(res.error, /nothing in that profile/i)
  assert.equal(calls.length, 0)
})

test('a card-less publish sends the envelope alone rather than refusing', async () => {
  const { deps, calls } = fakeFetch([created])
  const res = await publishShare({ profile: PROFILE, card: null, appVersion: APP }, deps)
  assert.equal(res.ok, true)
  assert.equal((calls[0]?.body as { card?: string }).card, undefined)
})

test('re-sharing PUTs over the same record, with the token in the header', async () => {
  const { deps, calls } = fakeFetch([{ status: 200, json: { id: ID } }])
  const res = await publishShare(
    { profile: PROFILE, card: null, appVersion: APP, existing: EXISTING },
    deps
  )
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.updated, true)
  assert.equal(res.url, `${SHARE_ORIGIN}/s/${ID}`)
  // A PUT is never handed a token, so the caller keeps the one it already had.
  assert.equal(res.deleteToken, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.method, 'PUT')
  assert.equal(calls[0]?.url, `${SHARE_ORIGIN}/api/v1/shares/${ID}`)
  assert.equal(calls[0]?.headers.Authorization, `Bearer ${TOKEN}`)
})

test('a PUT the service refuses as unauthorized or unknown falls back to a create', async () => {
  for (const status of [401, 404]) {
    const { deps, calls } = fakeFetch([{ status }, created])
    const res = await publishShare(
      { profile: PROFILE, card: null, appVersion: APP, existing: EXISTING },
      deps
    )
    assert.equal(res.ok, true, String(status))
    if (!res.ok) continue
    // A REPLACEMENT RECORD, not an update: the id may be new and the caller must store it.
    assert.equal(res.updated, false)
    assert.equal(res.deleteToken, TOKEN)
    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.method, 'PUT')
    assert.equal(calls[1]?.method, 'POST')
  }
})

test('a stored record whose id or token is not ours is not sent at all', async () => {
  const { deps, calls } = fakeFetch([created])
  await publishShare(
    { profile: PROFILE, card: null, appVersion: APP, existing: { id: '../api/v1', deleteToken: TOKEN } },
    deps
  )
  // Straight to the create — the malformed id never reaches a URL.
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.method, 'POST')
})

test('a create whose reply this app cannot read is a sentence, not a link', async () => {
  for (const json of [{ id: ID }, { id: 'a/b', deleteToken: TOKEN }, { id: ID, deleteToken: 'short' }, 'nope']) {
    const { deps } = fakeFetch([{ status: 201, json }])
    const res = await publishShare({ profile: PROFILE, card: null, appVersion: APP }, deps)
    assert.equal(res.ok, false, JSON.stringify(json))
    if (res.ok) continue
    assert.match(res.error, /could not read/i)
  }
})

test('every failure is a short sentence, and nothing ever throws', async () => {
  const cases: [Reply | 'throws', RegExp][] = [
    ['throws', /could not be reached/i],
    [{ status: 429 }, /too many shares/i],
    [{ status: 413 }, /too large/i],
    [{ status: 500 }, /would not store/i],
    [{ status: 400 }, /would not store/i],
    [{ status: 201, text: '<html>oops</html>' }, /could not read/i]
  ]
  for (const [reply, matcher] of cases) {
    const { deps } = fakeFetch(reply === 'throws' ? 'throws' : [reply])
    const res = await publishShare({ profile: PROFILE, card: null, appVersion: APP }, deps)
    assert.equal(res.ok, false, JSON.stringify(reply))
    if (res.ok) continue
    assert.match(res.error, matcher)
    // A sentence, not a stack: no status codes, no host names, no verbs.
    assert.ok(!/\d{3}|http|fetch/i.test(res.error), res.error)
  }
})

// ---- revoking -------------------------------------------------------------------------------

test('a revoke DELETEs with the token, and reads a missing record as success', async () => {
  const { deps, calls } = fakeFetch([{ status: 204 }])
  assert.deepEqual(await revokeShare(ID, TOKEN, deps), { ok: true })
  assert.equal(calls[0]?.method, 'DELETE')
  assert.equal(calls[0]?.url, `${SHARE_ORIGIN}/api/v1/shares/${ID}`)
  assert.equal(calls[0]?.headers.Authorization, `Bearer ${TOKEN}`)

  // Already gone is exactly the state that was asked for.
  const gone = fakeFetch([{ status: 404 }])
  assert.deepEqual(await revokeShare(ID, TOKEN, gone.deps), { ok: true })
})

test('a revoke the service would not honour says so, and never leaves the record dropped', async () => {
  // 401: the record still serves and the token we hold is not its.
  const { deps } = fakeFetch([{ status: 401 }])
  const res = await revokeShare(ID, TOKEN, deps)
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.match(res.error, /could not be revoked/i)

  // A malformed id never reaches a request at all.
  const bad = fakeFetch([{ status: 204 }])
  assert.equal((await revokeShare('a/b', TOKEN, bad.deps)).ok, false)
  assert.equal(bad.calls.length, 0)
})

// ---- reading --------------------------------------------------------------------------------

/** The `{ envelope }` the service answers a `/p/:id` read with. */
function served(body: unknown): Reply {
  return { status: 200, json: { envelope: makeEnvelope('character', body, APP), createdAt: 1 } }
}

test('a fetched profile travels the SAME checks a pasted string does', async () => {
  const { deps, calls } = fakeFetch([served(PROFILE)])
  const res = await fetchSharedProfile(`${SHARE_ORIGIN}/s/${ID}`, deps)
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.profile.name, 'Primitive')
  assert.equal(res.profile.cells.length, 1)
  assert.equal(res.appVersion, APP)
  // The READ route, not the page - the app asks for JSON even when handed the /s/ link.
  assert.equal(calls[0]?.method, 'GET')
  assert.equal(calls[0]?.url, `${SHARE_ORIGIN}/p/${ID}`)

  // …and it is the same answer the paste box gives for the same envelope.
  const pasted = decodeCharacterShare(encodeShareString(makeEnvelope('character', PROFILE, APP)))
  assert.equal(pasted.ok, true)
  if (!pasted.ok) return
  assert.deepEqual(res.profile, pasted.profile)
})

test('a wrong-origin link is refused before a request is made', async () => {
  for (const url of [
    `https://share.eqzera.com.evil.com/s/${ID}`,
    `http://share.eqzera.com/s/${ID}`,
    `${SHARE_ORIGIN}/api/v1/shares`,
    ID,
    'EQC1-abcdef',
    'hey check out my character'
  ]) {
    const { deps, calls } = fakeFetch([served(PROFILE)])
    const res = await fetchSharedProfile(url, deps)
    assert.equal(res.ok, false, url)
    if (res.ok) continue
    assert.match(res.error, /share\.eqzera\.com link/i)
    assert.equal(calls.length, 0, url)
  }
})

test('a served envelope that does not validate gets the paste box own prose', async () => {
  // A BODY EDITED UNDER A STALE SUM. The service is not trusted to have checked this.
  const tampered = makeEnvelope('character', PROFILE, APP)
  const bent = { ...tampered, body: { ...PROFILE, name: 'NotPrimitive' } }
  const { deps } = fakeFetch([{ status: 200, json: { envelope: bent } }])
  const res = await fetchSharedProfile(`${SHARE_ORIGIN}/p/${ID}`, deps)
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.match(res.error, /integrity check/i)

  // A SETTINGS BUNDLE gets the sentence that says where it belongs, not a generic refusal.
  const settings = fakeFetch([{ status: 200, json: { envelope: makeEnvelope('settings', { ui: {} }, APP) } }])
  const other = await fetchSharedProfile(`${SHARE_ORIGIN}/p/${ID}`, settings.deps)
  assert.equal(other.ok, false)
  if (other.ok) return
  assert.match(other.error, /settings, not a character/i)

  // AN EMPTY BODY is an empty payload, not a character.
  const empty = fakeFetch([served({ ...PROFILE, cells: [] })])
  assert.equal((await fetchSharedProfile(`${SHARE_ORIGIN}/p/${ID}`, empty.deps)).ok, false)

  // A reply with no envelope at all, and one that is not JSON.
  const none = fakeFetch([{ status: 200, json: { hello: 'world' } }])
  assert.equal((await fetchSharedProfile(`${SHARE_ORIGIN}/p/${ID}`, none.deps)).ok, false)
  const junk = fakeFetch([{ status: 200, text: '<html>' }])
  assert.equal((await fetchSharedProfile(`${SHARE_ORIGIN}/p/${ID}`, junk.deps)).ok, false)
})

test('an expired or unreachable link says which, in a sentence', async () => {
  const gone = fakeFetch([{ status: 404 }])
  const expired = await fetchSharedProfile(`${SHARE_ORIGIN}/s/${ID}`, gone.deps)
  assert.equal(expired.ok, false)
  if (expired.ok) return
  assert.match(expired.error, /expired or was revoked/i)

  const dead = fakeFetch('throws')
  const offline = await fetchSharedProfile(`${SHARE_ORIGIN}/s/${ID}`, dead.deps)
  assert.equal(offline.ok, false)
  if (offline.ok) return
  assert.match(offline.error, /could not be reached/i)
})
