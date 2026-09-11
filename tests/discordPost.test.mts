// ============================================================================
// discordPost.test.mts — share/discord.ts, the app's SECOND outbound origin.
// ============================================================================
//
// `fetch` is INJECTED, so every claim below is made without a network and without Discord. What
// is guarded, and why each one is load-bearing (docs/plans/discord-webhook.md §2):
//
//   * THE REQUEST URL IS REBUILT, NOT REPLAYED. It is exactly
//     `https://discord.com/api/webhooks/<id>/<token>` — the compiled host, the one path, the two
//     closed-class values — whichever of the two accepted spellings the user pasted. A webhook
//     whose id or token is not in the class produces NO request at all.
//   * POST, JSON, AND A TIMEOUT. One method, one content type, and an `AbortSignal` on every
//     attempt: an outbound call with no deadline is a hang the user cannot cancel.
//   * EVERY OUTCOME IS A SENTENCE, INCLUDING THE ONES THAT THREW. A transport failure, a 404, a
//     429 and a 400 are all `{ ok:false, error }`, because these results cross an IPC boundary
//     and there is nothing a reader can do with "TypeError: fetch failed".
//   * DARK UNDER `EQ_E2E`, PROVEN BY RUNNING ONE. The module reads the flag at import, so the
//     claim is made in a CHILD PROCESS with the flag set — asserting both the sentence and that
//     the injected `fetch` was never called. A webhook a developer pasted while testing points at
//     a real channel with real people in it; "the harness probably will not post" is not good
//     enough, and a structure is.
//
// No Electron, no network, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DISCORD_ERR,
  DISCORD_TIMEOUT_MS,
  MAX_POST_FILE_BYTES,
  discordEndpointConfigured,
  discordOriginFor,
  isPostableFile,
  postDiscordWebhook,
  postDiscordWebhookWithFile,
  testDiscordWebhook,
  webhookUrl,
  type DiscordPostFile
} from '../src/main/share/discord'
import { discordFightEmbed, type FightShare } from '../src/shared/fightShare'
import { discordEmbedFor, type DiscordWebhook } from '../src/shared/discordWebhook'
import { pickChannel, type DiscordChannel } from '../src/shared/discordChannels'
import type { CharacterProfileShare } from '../src/shared/characterShare'

const HOOK: DiscordWebhook = { id: '1234567890123456789', token: 'a'.repeat(68) }
const EXPECT_URL = `https://discord.com/api/webhooks/${HOOK.id}/${HOOK.token}`

/** One recorded call, and the fake that records it. */
interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
  hasSignal: boolean
}

function fakeFetch(status: number | 'throws'): { deps: { fetch: typeof globalThis.fetch }; calls: Call[] } {
  const calls: Call[] = []
  const fetchFn = (input: unknown, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      hasSignal: init?.signal instanceof AbortSignal
    })
    if (status === 'throws') return Promise.reject(new Error('fetch failed'))
    return Promise.resolve({ status, text: () => Promise.resolve('') } as Response)
  }
  return { deps: { fetch: fetchFn as unknown as typeof globalThis.fetch }, calls }
}

const PROFILE: CharacterProfileShare = {
  v: 2,
  capturedAt: 1_757_500_000_000,
  name: 'Primitive',
  level: 60,
  classes: ['Enchanter'],
  look: { race: 'HU', sex: 'M' },
  cells: [{ slot: 'chest', label: 'Chest', item: 'Breastplate', exaltations: [], stats: [], effects: [], flags: [] }],
  totals: { ac: 412, stats: [{ label: 'HP', total: 2400 }], saves: [], unsummed: [], counted: 1, unknown: 0 },
  scores: { tank: 71, dps: 64, heal: 33, solo: 58 }
}

// ---- the origin -------------------------------------------------------------------------------

test('this process has a Discord endpoint, and it is the compiled one', () => {
  assert.equal(discordEndpointConfigured(), true)
  assert.equal(discordOriginFor(false), 'https://discord.com')
  // THE DECISION AS A FUNCTION OF ITS INPUT — the shape shareOriginFor uses, so the gate is a
  // thing a test can watch being made rather than a constant it has to trust.
  assert.equal(discordOriginFor(true), '')
})

test('the request URL is rebuilt from the two closed-class values, and canonicalized', () => {
  assert.equal(webhookUrl(HOOK), EXPECT_URL)
  // A record that does not survive the classes produces NO url, and therefore no request.
  assert.equal(webhookUrl({ id: 'nope', token: HOOK.token }), '')
  assert.equal(webhookUrl({ id: HOOK.id, token: 'short' }), '')
})

// ---- the transport ----------------------------------------------------------------------------

test('a successful post is one POST of JSON, to exactly that url, with a deadline', async () => {
  const { deps, calls } = fakeFetch(204)
  const body = discordEmbedFor(PROFILE, 'https://share.eqzera.com/s/aB3xY9kQ2m', 'https://share.eqzera.com/c/aB3xY9kQ2m.png?v=1')
  assert.deepEqual(await postDiscordWebhook(HOOK, body, deps), { ok: true })

  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.ok(call)
  assert.equal(call.url, EXPECT_URL, 'the compiled host and the one path, nothing else')
  assert.equal(call.method, 'POST')
  assert.equal(call.headers['Content-Type'], 'application/json')
  assert.equal(call.headers['User-Agent'], 'eq-zera/0.1 (discord)')
  // An outbound call with no deadline is a hang the user cannot cancel.
  assert.equal(call.hasSignal, true)
  assert.equal(DISCORD_TIMEOUT_MS, 15_000)

  // The body reached the wire as the embed, not as a string of it.
  const sent = call.body as { embeds: { title: string; url: string }[] }
  assert.equal(sent.embeds.length, 1)
  assert.equal(sent.embeds[0]?.title, 'Primitive · Level 60 · Enchanter')
  assert.equal(sent.embeds[0]?.url, 'https://share.eqzera.com/s/aB3xY9kQ2m')
})

test('200 is a success too - Discord answers it when asked to wait for the message', async () => {
  const { deps } = fakeFetch(200)
  assert.deepEqual(await postDiscordWebhook(HOOK, {}, deps), { ok: true })
})

test('every failure is a sentence, and none of them names a status code or the url', async () => {
  const cases: [number | 'throws', string][] = [
    [404, DISCORD_ERR.gone],
    [401, DISCORD_ERR.gone],
    [403, DISCORD_ERR.gone],
    [429, DISCORD_ERR.busy],
    [400, DISCORD_ERR.refused],
    [500, DISCORD_ERR.refused],
    // A transport that never answered: offline, DNS, TLS and the timeout are all this, and all
    // one situation to the reader.
    ['throws', DISCORD_ERR.offline]
  ]
  for (const [status, sentence] of cases) {
    const { deps } = fakeFetch(status)
    const res = await postDiscordWebhook(HOOK, {}, deps)
    assert.deepEqual(res, { ok: false, error: sentence }, String(status))
    assert.ok(!res.ok && !res.error.includes(HOOK.token), 'the token is never in a sentence')
    assert.ok(!res.ok && !res.error.includes('discord.com'), 'nor is the host')
  }
})

test('the exact sentences are the agreed ones', () => {
  assert.equal(DISCORD_ERR.gone, 'That webhook no longer exists or the URL is wrong. Check Preferences, Sharing.')
  assert.equal(DISCORD_ERR.busy, 'Discord is rate limiting this webhook. Try again in a moment.')
  assert.equal(DISCORD_ERR.refused, 'Discord refused the message.')
  assert.equal(DISCORD_ERR.offline, 'Could not reach Discord.')
  assert.equal(DISCORD_ERR.dark, 'This build cannot post to Discord.')
  // Reworded 2026-09-11 with Discord's own picker: there is nothing to add and nothing to paste.
  assert.equal(DISCORD_ERR.unset, 'Connect a Discord channel in Preferences, Sharing.')
})

test('a webhook outside the classes never reaches the network at all', async () => {
  const { deps, calls } = fakeFetch(204)
  const res = await postDiscordWebhook({ id: 'nope', token: 'nope' }, {}, deps)
  assert.deepEqual(res, { ok: false, error: DISCORD_ERR.unset })
  assert.equal(calls.length, 0, 'no url, no request')
})

test('the Test button posts one plain line and no embed', async () => {
  const { deps, calls } = fakeFetch(204)
  assert.deepEqual(await testDiscordWebhook(HOOK, deps), { ok: true })
  const body = calls[0]?.body as { username: string; content: string; embeds?: unknown }
  assert.equal(body.username, 'EQ Zera')
  assert.equal(body.content, 'EQ Zera connected. Character cards you post will appear here.')
  assert.equal(body.embeds, undefined)
})

// ---- dark under EQ_E2E ------------------------------------------------------------------------

/**
 * THE DARK CLAIM, MADE BY RUNNING A DARK PROCESS. `share/discord.ts` reads `EQ_E2E` at import, so
 * the only honest way to assert what an `EQ_E2E` build does is to be one. The child imports the
 * module with the flag set, posts through a `fetch` that would record a call, and prints what it
 * got; this process asserts on that.
 */
test('an EQ_E2E build is DARK: the dark sentence, and the fetch is never called', () => {
  const module = JSON.stringify(new URL('../src/main/share/discord.ts', import.meta.url).href)
  const script = [
    `const m = await import(${module});`,
    'let calls = 0;',
    'const deps = { fetch: () => { calls++; return Promise.resolve({ status: 204 }); } };',
    "const res = await m.postDiscordWebhook({ id: '1234567890123456789', token: 'a'.repeat(68) }, {}, deps);",
    'console.log(JSON.stringify({ configured: m.discordEndpointConfigured(), origin: m.DISCORD_ORIGIN, res, calls }));'
  ].join('\n')
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, EQ_E2E: '1' },
    encoding: 'utf8'
  })
  const said = JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as {
    configured: boolean
    origin: string
    res: { ok: boolean; error?: string }
    calls: number
  }
  assert.equal(said.origin, '', 'no origin at all, so no request is possible')
  assert.equal(said.configured, false)
  assert.deepEqual(said.res, { ok: false, error: DISCORD_ERR.dark })
  assert.equal(said.calls, 0, 'and nothing was even attempted')
})

// ---- WHICH CHANNEL A POST GOES TO (2026-09-11) --------------------------------------------------
//
// Connecting channels through Discord's own picker made this a LIST, and therefore made "where
// does this card go" a question with a wrong answer available. The decision is pure and lives in
// `shared/discordChannels.ts` so it can be made here without a store; `src/main/storeDiscord.ts`
// reads the list and calls it, and `src/main/ipc/discord.ts` turns a null into the sentence.
//
// THE REFUSAL IS THE POINT OF THE LAST CASE. With two channels and no default, picking one of them
// would be this app guessing which of somebody's servers gets their character card - so it refuses
// in words and the share dialog's selector is how they say.

const GEAR: DiscordChannel = {
  id: '1234567890123456789',
  token: 'g'.repeat(68),
  channelId: '9876543210987654321',
  guildId: '1111111111111111111',
  label: '#gear · Guild of Thieves',
  addedAt: 2
}
const FRIENDS: DiscordChannel = {
  id: '2234567890123456789',
  token: 'f'.repeat(68),
  channelId: '8876543210987654321',
  guildId: '2111111111111111111',
  label: '#friends · Tavern',
  addedAt: 1
}

test('a post with no channel named goes to the default', () => {
  assert.equal(pickChannel([FRIENDS, GEAR], GEAR.id)?.id, GEAR.id)
})

test('…or to the only channel there is, so one channel never needs a default', () => {
  assert.equal(pickChannel([GEAR], undefined)?.id, GEAR.id)
})

test('…and a named channel wins over the default, which is what the selector is for', () => {
  assert.equal(pickChannel([FRIENDS, GEAR], GEAR.id, FRIENDS.id)?.id, FRIENDS.id)
})

test('a name this install does not hold is refused, never quietly swapped for another server', () => {
  assert.equal(pickChannel([FRIENDS, GEAR], GEAR.id, '9999999999999999999'), null)
})

test('with several channels and no default, the app asks rather than guessing', () => {
  assert.equal(pickChannel([FRIENDS, GEAR], undefined), null)
  assert.equal(pickChannel([], undefined), null)
  // …and the sentence a refusal becomes is the one the share dialog matches to offer the door.
  assert.equal(DISCORD_ERR.unset, 'Connect a Discord channel in Preferences, Sharing.')
})

test('a channel posts exactly the way a pasted webhook did: same url, same body', async () => {
  const { deps, calls } = fakeFetch(204)
  assert.deepEqual(await testDiscordWebhook(GEAR, deps), { ok: true })
  assert.equal(calls[0]?.url, `https://discord.com/api/webhooks/${GEAR.id}/${GEAR.token}`)
})

// ---- WITH A FILE: the fight card rides inside the post (2026-09-11) ------------------------------
//
// The owner's ask: *"We should also make the Discord sharing be able to have DPS meter sharing
// also."* A character card is PUBLISHED and the embed points Discord at the picture; a fight has no
// page to publish, so the bytes travel INSIDE the message as `multipart/form-data`. What is guarded:
//
//   * THE ENVELOPE IS DISCORD'S DOCUMENTED SHAPE: a `payload_json` part that parses back to the
//     embed, and a `files[0]` part carrying the picture under the name the embed refers to.
//   * THE BOUNDARY IS IN THE HEADER AND IN THE BODY, and they are the same boundary. A mismatch is
//     a 400 nobody can debug from the sentence it becomes.
//   * THE BYTES SURVIVE. The head and tail are text and the picture is not - encoding the whole
//     body as a string would silently mangle every PNG.
//   * SAME LAW, SAME DEADLINE, SAME SENTENCES as the JSON path. It is one transport.

/** One recorded multipart call. The body is kept as it was handed over - bytes stay bytes. */
interface BinaryCall {
  url: string
  type: string
  body: Uint8Array
  hasSignal: boolean
}

function fakeBinaryFetch(status: number): {
  deps: { fetch: typeof globalThis.fetch }
  calls: BinaryCall[]
} {
  const calls: BinaryCall[] = []
  const fetchFn = (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    const raw = init?.body
    calls.push({
      url: String(input),
      type: headers['Content-Type'] ?? '',
      body: raw instanceof Uint8Array ? raw : new TextEncoder().encode(String(raw)),
      hasSignal: init?.signal instanceof AbortSignal
    })
    return Promise.resolve({ status, text: () => Promise.resolve('') } as Response)
  }
  return { deps: { fetch: fetchFn as unknown as typeof globalThis.fetch }, calls }
}

/** A PNG's first eight bytes, plus one that is deliberately not valid UTF-8. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff])
const CARD: DiscordPostFile = { name: 'fight.png', bytes: PNG_BYTES, type: 'image/png' }

const FIGHT: FightShare = {
  v: 1,
  mob: 'a dark elf priest',
  zone: 'Befallen',
  startedAt: 1_757_600_000_000,
  durationMs: 66_000,
  totalDamage: 48_204,
  members: [
    { name: 'Zeratfule', damage: 31_204, dps: 471, share: 0.647, isYou: true },
    { name: 'Gorak', damage: 12_000, dps: 181.2, share: 0.249, isYou: false, pet: true }
  ],
  you: { dps: 471, share: 0.647 }
}

/** The boundary the module chose, read back out of the header it set. */
function boundaryOf(type: string): string {
  return type.slice(type.indexOf('boundary=') + 'boundary='.length)
}

/** The body as one latin1 string, so byte offsets and text offsets are the same number. */
function bodyText(call: BinaryCall | undefined): string {
  return Buffer.from(call?.body ?? new Uint8Array()).toString('latin1')
}

test('a post WITH a file is multipart, to exactly the same url, with the same deadline', async () => {
  const { deps, calls } = fakeBinaryFetch(204)
  const body = discordFightEmbed(FIGHT, true)
  assert.deepEqual(await postDiscordWebhookWithFile(HOOK, body, CARD, deps), { ok: true })

  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.ok(call)
  assert.equal(call.url, EXPECT_URL, 'the compiled host and the one path, nothing else')
  assert.ok(call.type.startsWith('multipart/form-data; boundary='), call.type)
  assert.equal(call.hasSignal, true)

  // The BOUNDARY in the header is the boundary in the body. A mismatch is an undebuggable 400.
  const boundary = boundaryOf(call.type)
  assert.ok(boundary.length > 16, boundary)
  const text = bodyText(call)
  assert.ok(text.startsWith(`--${boundary}\r\n`), text.slice(0, 80))
  assert.ok(text.endsWith(`\r\n--${boundary}--\r\n`), text.slice(-60))
})

test('the payload_json part parses back to the embed that was handed over', async () => {
  const { deps, calls } = fakeBinaryFetch(204)
  await postDiscordWebhookWithFile(HOOK, discordFightEmbed(FIGHT, true), CARD, deps)
  const text = bodyText(calls[0])
  assert.ok(text.includes('Content-Disposition: form-data; name="payload_json"'), text.slice(0, 200))
  assert.ok(text.includes('Content-Type: application/json'))
  // Offsets come from the latin1 reading (one char per byte) and the SLICE is decoded as UTF-8:
  // the embed's separators are middots, and reading the whole body as text would mangle them
  // exactly the way a body built as a string would mangle the PNG.
  const from = text.indexOf('{"username"')
  const json = Buffer.from(calls[0]?.body ?? new Uint8Array())
    .subarray(from, text.indexOf('\r\n--', from))
    .toString('utf8')
  const sent = JSON.parse(json) as {
    username: string
    embeds: { title: string; image?: { url: string } }[]
  }
  assert.equal(sent.username, 'EQ Zera')
  assert.equal(sent.embeds[0]?.title, 'a dark elf priest · 1:06 · 48,204 damage')
  assert.deepEqual(sent.embeds[0]?.image, { url: 'attachment://fight.png' })
})

test('the files[0] part is named fight.png and its bytes are not mangled', async () => {
  const { deps, calls } = fakeBinaryFetch(204)
  await postDiscordWebhookWithFile(HOOK, discordFightEmbed(FIGHT, true), CARD, deps)
  const text = bodyText(calls[0])
  assert.ok(
    text.includes('Content-Disposition: form-data; name="files[0]"; filename="fight.png"'),
    text.slice(0, 400)
  )
  assert.ok(text.includes('Content-Type: image/png'))
  // THE BYTES SURVIVE. `0xff` is not valid UTF-8; a body built as a string would have replaced it.
  const at = Buffer.from(calls[0]?.body ?? new Uint8Array()).indexOf(Buffer.from(PNG_BYTES))
  assert.ok(at > 0, 'the picture is in the body, byte for byte')
})

test('a file outside the classes is refused, and nothing is sent', async () => {
  const bad: [string, DiscordPostFile][] = [
    ['a name that is a header injection', { ...CARD, name: 'a"; name="files[1]' }],
    ['a name with a path in it', { ...CARD, name: '../fight.png' }],
    ['a type that is not one', { ...CARD, type: 'image/png; charset=x' }],
    ['no bytes at all', { ...CARD, bytes: new Uint8Array() }],
    ['more bytes than Discord takes', { ...CARD, bytes: new Uint8Array(MAX_POST_FILE_BYTES + 1) }]
  ]
  for (const [why, file] of bad) {
    assert.equal(isPostableFile(file), false, why)
    const { deps, calls } = fakeBinaryFetch(204)
    const res = await postDiscordWebhookWithFile(HOOK, {}, file, deps)
    assert.deepEqual(res, { ok: false, error: DISCORD_ERR.refused }, why)
    assert.equal(calls.length, 0, `${why}: no request at all`)
  }
  assert.equal(isPostableFile(CARD), true, 'and the real card is fine')
})

test('the multipart path answers the same sentences the JSON path does', async () => {
  const cases: [number, string][] = [
    [404, DISCORD_ERR.gone],
    [429, DISCORD_ERR.busy],
    [400, DISCORD_ERR.refused]
  ]
  for (const [status, sentence] of cases) {
    const { deps } = fakeBinaryFetch(status)
    const res = await postDiscordWebhookWithFile(HOOK, {}, CARD, deps)
    assert.deepEqual(res, { ok: false, error: sentence }, String(status))
  }
})

test('two posts never share a boundary', async () => {
  const { deps, calls } = fakeBinaryFetch(204)
  await postDiscordWebhookWithFile(HOOK, {}, CARD, deps)
  await postDiscordWebhookWithFile(HOOK, {}, CARD, deps)
  assert.notEqual(boundaryOf(calls[0]?.type ?? ''), boundaryOf(calls[1]?.type ?? ''))
})
