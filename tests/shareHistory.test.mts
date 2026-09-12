// ============================================================================
// shareHistory.test.mts — GEAR HISTORY on a share link (share-server/src/history.ts + pageHistory.ts).
// ============================================================================
//
// A share link is re-published under the same id every time the sharer re-shares that character,
// and the state it replaces used to be gone. Now each PUT pushes that state onto `hist:<id>` and
// the page renders the difference. What is load-bearing here:
//
//   * A CREATE REMEMBERS NOTHING. A POST writes no history key at all — a share nobody has
//     re-published must not cost a KV row, and the page must draw no empty panel.
//   * THE SNAPSHOT IS THE STATE BEING REPLACED, stamped with when THAT state was published
//     (`record.updatedAt`), not with the moment of the write that displaced it. Get this backwards
//     and every row on the page is dated one re-share late.
//   * THE DELTAS ARE AGAINST THE NEXT-NEWER STATE. Row 0 is compared with the profile on the page
//     right now; row i with row i-1. This is the arithmetic the whole panel exists for.
//   * ESCAPING, AGAIN. An item name in a PAST state is a stranger's text too, and it reaches the
//     page through a second renderer — so the `<` that the gear list escapes must not walk in
//     through the History panel.
//   * ALL THREE KEYS EXPIRE TOGETHER. `touch` rewrites the history beside the record and the card;
//     a delete takes it with them. A history that outlived its share would be unreachable, and one
//     that died first would empty the panel under a page that still serves.
//   * KV IS A PLACE, NOT A TYPE. Junk written into `hist:<id>` is dropped on the way out rather
//     than rendered.
//
// It runs on the same real dump as the rest of the share suite (`characterShareFixture.mts`).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEnvelope, type ShareEnvelope } from '../src/shared/shareSchema'
import { sanitizeCharacterShare, type CharacterProfileShare } from '../src/shared/characterShare'
import { APP, CAPTURED, profileOf } from './characterShareFixture.mjs'
import { handleRequest } from '../share-server/src/handler'
import { renderPage } from '../share-server/src/page'
import type { Snapshot } from '../share-server/src/history'
import type { Env, KvLike, KvPutOptions } from '../share-server/src/env'

const ORIGIN = 'https://share.eqzera.com'
const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 8, 11, 12, 0, 0)

// ---- the harness ------------------------------------------------------------------------------

/** Workers KV in memory. No TTL model: the clock rules this suite cares about are write COUNTS. */
class MemKv implements KvLike {
  readonly map = new Map<string, string>()
  writes = 0
  get(key: string, type: 'json'): Promise<unknown>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  get(key: string, type: 'text'): Promise<string | null>
  get(key: string, type: 'json' | 'arrayBuffer' | 'text'): Promise<unknown> {
    const value = this.map.get(key)
    if (value === undefined) return Promise.resolve(null)
    if (type === 'arrayBuffer') return Promise.resolve(new TextEncoder().encode(value).buffer)
    return Promise.resolve(type === 'json' ? JSON.parse(value) : value)
  }
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, _options?: KvPutOptions): Promise<void> {
    this.writes += 1
    const text = typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer)
    this.map.set(key, text)
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
  write: (path: string, body: unknown, token?: string) => Promise<Response>
}

function harness(): Harness {
  let now = T0
  const kv = new MemKv()
  const env: Env = { SHARES: kv, PUBLIC_ORIGIN: ORIGIN }
  const call = (method: string, path: string, init: RequestInit = {}): Promise<Response> =>
    handleRequest(new Request(`${ORIGIN}${path}`, { method, ...init }), env, () => now)
  return {
    kv,
    setNow: (ms) => { now = ms },
    call,
    write: (path, body, token) =>
      call(path === '/api/v1/shares' ? 'POST' : 'PUT', path, {
        headers: {
          'Content-Type': 'application/json',
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` })
        },
        body: JSON.stringify(body)
      })
  }
}

/** The fixture profile with whatever this test wants moved on it. */
function variant(over: Partial<CharacterProfileShare> = {}): CharacterProfileShare {
  return { ...profileOf(), ...over }
}

function envelopeOf(body: CharacterProfileShare): ShareEnvelope {
  return makeEnvelope('character', body, APP, new Date(CAPTURED))
}

interface Made {
  id: string
  deleteToken: string
}

/** The eight-byte PNG signature plus filler: the service checks the magic, never the pixels. */
const CARD_B64 = Buffer.from(
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
).toString('base64')

async function create(h: Harness, body = variant(), card?: string): Promise<Made> {
  const res = await h.write('/api/v1/shares', {
    envelope: envelopeOf(body),
    ...(card === undefined ? {} : { card })
  })
  assert.equal(res.status, 201, await res.clone().text())
  return (await res.json()) as Made
}

async function republish(h: Harness, made: Made, body: CharacterProfileShare): Promise<void> {
  const res = await h.write(`/api/v1/shares/${made.id}`, { envelope: envelopeOf(body) }, made.deleteToken)
  assert.equal(res.status, 200, await res.clone().text())
}

async function historyOf(h: Harness, id: string): Promise<Snapshot[]> {
  const res = await h.call('GET', `/p/${id}`)
  assert.equal(res.status, 200)
  return ((await res.json()) as { history: Snapshot[] }).history
}

/** The same page the handler renders, called directly so a history can be handed in whole. */
function page(history: readonly Snapshot[], profile = variant()): string {
  const stored = sanitizeCharacterShare(profile)
  assert.ok(stored, 'the fixture sanitizes')
  return renderPage({
    id: 'AbCdEfGhIj',
    profile: stored,
    origin: ORIGIN,
    shareString: 'EQC1-not-a-real-string',
    hasCard: false,
    cardMap: [],
    updatedAt: T0,
    history,
    nonce: 'nonce123'
  })
}

/** A hand-built past state — what the store would have kept for a profile this suite invents. */
function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    at: new Date(T0 - DAY).toISOString(),
    ac: 231,
    scores: { tank: 70, dps: 61, heal: 38, solo: 55 },
    level: 59,
    classes: ['WAR', 'CLR', 'SHM'],
    items: [{ slot: 'chest', item: 'Old Name +3', tier: 3 }],
    ...over
  }
}

// ---- what a write does ------------------------------------------------------------------------

test('a create remembers nothing: no history key, no panel, an empty list on /p/:id', async () => {
  const h = harness()
  const made = await create(h)
  assert.equal(h.kv.map.has(`hist:${made.id}`), false, 'a POST writes no history row')
  assert.deepEqual(await historyOf(h, made.id), [], 'and the key is always present in the reply')
  const html = await (await h.call('GET', `/s/${made.id}`)).text()
  assert.ok(!html.includes('<h2>History</h2>'), 'an empty history draws no panel at all')
})

test('a re-publish keeps the state it REPLACED, stamped with when that state was published', async () => {
  const h = harness()
  const first = variant({ level: 60 })
  const made = await create(h, first)
  h.setNow(T0 + 3 * DAY)
  await republish(h, made, variant({ level: 61, totals: { ...first.totals, ac: first.totals.ac + 16 } }))

  const history = await historyOf(h, made.id)
  assert.equal(history.length, 1)
  const past = history[0]!
  assert.equal(past.at, new Date(T0).toISOString(), 'the moment the REPLACED state was published')
  assert.equal(past.ac, first.totals.ac, 'its AC, not the new one')
  assert.equal(past.level, 60)
  assert.deepEqual(past.classes, ['WAR', 'CLR', 'SHM'])
  assert.deepEqual(past.scores, { tank: 74, dps: 61, heal: 38, solo: 55 })
  assert.equal(past.items.length, first.cells.length, 'one entry per worn cell')
  assert.deepEqual(past.items[0], {
    slot: first.cells[0]!.slot,
    item: first.cells[0]!.item,
    tier: first.cells[0]!.tier
  }, 'slot, the verbatim name with its +N, and the tier')
  // Nothing but those five fields and `items` reaches the app.
  assert.deepEqual(Object.keys(past).sort(), ['ac', 'at', 'classes', 'items', 'level', 'scores'])
})

test('the list is newest first and stops at thirty', async () => {
  const h = harness()
  const base = variant()
  const made = await create(h, base)
  for (let i = 1; i <= 32; i++) {
    h.setNow(T0 + i * DAY)
    await republish(h, made, variant({ totals: { ...base.totals, ac: 100 + i } }))
  }
  const history = await historyOf(h, made.id)
  assert.equal(history.length, 30, 'the cap holds')
  assert.equal(history[0]!.ac, 100 + 31, 'newest first: the state the last PUT replaced')
  assert.equal(history[29]!.ac, 100 + 2, 'and the oldest two fell off the end')
})

// ---- the panel ---------------------------------------------------------------------------------

test('the History panel sits below Worn gear, newest first, with the delta against the next-newer state', () => {
  const current = variant({ totals: { ...profileOf().totals, ac: 247 } })
  const html = page([snapshot()], current)
  assert.ok(html.includes('<h2>History</h2>'))
  assert.ok(html.indexOf('<h2>Worn gear</h2>') < html.indexOf('<h2>History</h2>'), 'below the gear it explains')
  assert.ok(html.indexOf('<h2>History</h2>') < html.indexOf('<h2>Open this in EQ Zera</h2>'))
  assert.ok(html.includes(`<p class="when">${new Date(T0 - DAY).toISOString().slice(0, 10)}</p>`))
  assert.ok(
    html.includes('<span class="k">AC</span><span class="v">231 → 247</span><span class="d up">+16</span>'),
    'AC moved: old, new and the signed delta'
  )
  assert.ok(
    html.includes('<span class="k">Tank</span><span class="v">70% → 74%</span><span class="d up">+4</span>'),
    'a score that moved reads the same way, in percent'
  )
  assert.ok(
    html.includes('<span class="k">DPS</span><span class="v">61%</span>'),
    'a score that did not move is stated once, with no arrow and no delta'
  )
  assert.ok(!html.includes('61% → 61%'))
})

test('a fall is signed downwards, and the slots that changed are named (unchanged ones are not)', () => {
  const current = variant({ totals: { ...profileOf().totals, ac: 200 } })
  const worn = current.cells[0]!
  const past = snapshot({
    ac: 231,
    items: [
      { slot: worn.slot, item: 'Old Name +3', tier: 3 },
      { slot: current.cells[1]!.slot, item: current.cells[1]!.item },
      { slot: 'ear9', item: 'A Ring Long Since Sold' }
    ]
  })
  const html = page([past], current)
  assert.ok(html.includes('<span class="v">231 → 200</span><span class="d down">-31</span>'))
  assert.ok(
    html.includes(`<span class="slot">${worn.label}</span><span class="v">Old Name +3 → ${worn.item}</span>`),
    'the slot whose item changed, by its screen label, old name then new'
  )
  assert.ok(
    html.includes(`<span class="v">A Ring Long Since Sold → (empty)</span>`),
    'a slot that stopped being worn says so'
  )
  assert.ok(
    html.includes(`<span class="slot">${current.cells[2]!.label}</span>`) === false ||
      !html.includes(`${current.cells[2]!.item} →`),
    'a slot the current profile wears that the past state never listed reads as an addition, once'
  )
  assert.ok(!html.includes(`${current.cells[1]!.item} → ${current.cells[1]!.item}`), 'unchanged slots are omitted')
  assert.ok(html.includes(`<span class="v">(empty) → ${current.cells[2]!.item}</span>`), 'an added slot reads from (empty)')
})

test('ten rows are drawn and the rest are counted', () => {
  const history = Array.from({ length: 14 }, (_, i) =>
    snapshot({ at: new Date(T0 - (i + 1) * DAY).toISOString(), ac: 200 + i })
  )
  const html = page(history)
  assert.equal((html.match(/<p class="when">/g) ?? []).length, 10, 'the rendering is capped at ten')
  assert.ok(html.includes('<p class="muted">4 earlier snapshots</p>'))
  assert.ok(!html.includes(new Date(T0 - 12 * DAY).toISOString().slice(0, 10)), 'the eleventh is not drawn')
  // Row i is judged against row i-1: the second row's delta is the first row's AC.
  assert.ok(html.includes('<span class="v">201 → 200</span><span class="d down">-1</span>'))
})

test('exactly ten snapshots draws ten rows and counts nothing', () => {
  const html = page(Array.from({ length: 10 }, () => snapshot()))
  assert.equal((html.match(/<p class="when">/g) ?? []).length, 10)
  assert.ok(!html.includes('earlier snapshots'))
})

test('a hostile item name in a PAST state reaches the page escaped, and is still shown', () => {
  const hostile = '<img src=x onerror="alert(1)"> +3'
  const html = page([snapshot({ items: [{ slot: 'chest', item: hostile, tier: 3 }] })])
  assert.ok(!html.includes('<img src=x'), 'the past item name is escaped')
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; +3'), 'and it is still SHOWN')
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'the only <script> is ours')
  assert.ok(!html.includes('style='), 'no style attribute: the CSP would block one')
})

test('a slot the current profile no longer wears keeps its raw slot id rather than going blank', () => {
  const html = page([snapshot({ items: [{ slot: 'relic7', item: 'A Thing' }] })])
  assert.ok(html.includes('<span class="slot">relic7</span>'))
})

test('scores are compared only when BOTH states carried them (absent, never zeroed)', () => {
  const noScores = variant()
  delete noScores.scores
  const html = page([snapshot()], noScores)
  assert.ok(html.includes('<h2>History</h2>'))
  assert.ok(!html.includes('<span class="k">Tank</span><span class="v">70%'), 'no score row against a state that has none')
  assert.ok(html.includes('<span class="k">AC</span>'), 'AC is always comparable')
})

// ---- the three keys live and die together -------------------------------------------------------

test('a view past the 30-day window rewrites the history beside the record and the card', async () => {
  const h = harness()
  const made = await create(h, variant(), CARD_B64)
  await republish(h, made, variant({ level: 61 }))
  const before = h.kv.writes
  h.setNow(T0 + 40 * DAY)
  assert.equal((await h.call('GET', `/p/${made.id}`)).status, 200)
  assert.equal(h.kv.writes, before + 3, 'the record, the card and the history')

  // A share nobody has re-published still costs exactly two: there is no history to rewrite.
  const plain = harness()
  const other = await create(plain, variant(), CARD_B64)
  const plainBefore = plain.kv.writes
  plain.setNow(T0 + 40 * DAY)
  assert.equal((await plain.call('GET', `/p/${other.id}`)).status, 200)
  assert.equal(plain.kv.writes, plainBefore + 2)
})

test('revoking takes the history with it', async () => {
  const h = harness()
  const made = await create(h)
  await republish(h, made, variant({ level: 61 }))
  assert.ok(h.kv.map.has(`hist:${made.id}`))
  const gone = await h.call('DELETE', `/api/v1/shares/${made.id}`, {
    headers: { Authorization: `Bearer ${made.deleteToken}` }
  })
  assert.equal(gone.status, 204)
  assert.equal(h.kv.map.has(`hist:${made.id}`), false, 'no orphan row behind a revoked share')
})

test('junk under hist:<id> is dropped on the way out, not rendered', async () => {
  const h = harness()
  const made = await create(h)
  h.kv.map.set(
    `hist:${made.id}`,
    JSON.stringify([
      { at: new Date(T0).toISOString(), ac: 'not a number' },
      'a string where a snapshot should be',
      { at: new Date(T0).toISOString(), ac: 231, classes: 'WAR', items: [{ slot: 7 }, { slot: 'chest', item: 'Real' }] },
      null
    ])
  )
  const history = await historyOf(h, made.id)
  assert.equal(history.length, 1, 'only the readable entry survives')
  assert.deepEqual(history[0]!.classes, [], 'a classes field that is not a list is no classes')
  assert.deepEqual(history[0]!.items, [{ slot: 'chest', item: 'Real' }], 'and an item with no name is not an item')
  assert.equal((await h.call('GET', `/s/${made.id}`)).status, 200, 'the page still renders')
})
