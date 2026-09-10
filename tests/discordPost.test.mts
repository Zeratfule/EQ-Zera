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
  discordEndpointConfigured,
  discordOriginFor,
  postDiscordWebhook,
  testDiscordWebhook,
  webhookUrl
} from '../src/main/share/discord'
import { discordEmbedFor, type DiscordWebhook } from '../src/shared/discordWebhook'
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
  assert.equal(DISCORD_ERR.unset, 'Add a Discord webhook in Preferences, Sharing.')
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
