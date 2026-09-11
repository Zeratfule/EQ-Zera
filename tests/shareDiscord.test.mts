// shareDiscord.test.mts — the "connect a Discord channel" flow (share-server/src/discord.ts).
//
// Three routes on the share worker: /discord/start sends a browser to Discord's channel picker,
// /discord/callback trades the code Discord sends back for a webhook and parks it under the
// app's `state`, and /discord/claim/<state> hands it to the app exactly once. `handleRequest` is
// pure, so the whole flow runs here under node:test with the in-memory KV of shareCard.test.mts
// and a FAKE FETCH standing in for discord.com's token endpoint — recording what the worker sent
// (the client secret and the redirect_uri are the two facts worth pinning) and answering with a
// canned webhook grant.
//
// What is load-bearing:
//   * THE STATE IS THE ONLY KEY. A callback for a state /start never issued is refused before
//     Discord is asked anything; a claim reads the row once and the second read is 404.
//   * THE TOKEN NEVER REACHES A BROWSER. The "Connected" page names the channel and nothing else
//     from Discord's reply; the fake's token is asserted absent from every byte of HTML.
//   * OFF MEANS OFF. Without the client secret (this suite, `wrangler dev`) /start and /callback
//     answer 503 `discord-off`, so a deploy without the secret fails loudly rather than mid-flow.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleRequest } from '../share-server/src/handler'
import type { Env, KvLike, KvPutOptions } from '../share-server/src/env'

const ORIGIN = 'https://share.eqzera.com'
const T0 = Date.UTC(2026, 8, 11, 12, 0, 0)
/** 32 bytes as base64url: 43 chars, the shape the app mints. */
const STATE = 'A'.repeat(21) + 'b-_' + 'C'.repeat(19)
const CLIENT_ID = '123456789012345678'
const CLIENT_SECRET = 'shh-this-is-the-client-secret'
const WEBHOOK_ID = '987654321098765432'
const WEBHOOK_TOKEN = 'tok_' + 'x'.repeat(64)
const CHANNEL_ID = '111111111111111111'
const GUILD_ID = '222222222222222222'

// ---- the harness -------------------------------------------------------------------------------

class MemKv implements KvLike {
  readonly map = new Map<string, { value: string; ttl?: number }>()
  get(key: string, type: 'json'): Promise<unknown>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  get(key: string, type: 'text'): Promise<string | null>
  get(key: string, type: 'json' | 'arrayBuffer' | 'text'): Promise<unknown> {
    const v = this.map.get(key)
    if (!v) return Promise.resolve(null)
    if (type === 'arrayBuffer') return Promise.resolve(new TextEncoder().encode(v.value).buffer)
    return Promise.resolve(type === 'json' ? JSON.parse(v.value) : v.value)
  }
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: KvPutOptions): Promise<void> {
    const text = typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer)
    this.map.set(key, { value: text, ttl: options?.expirationTtl })
    return Promise.resolve()
  }
  delete(key: string): Promise<void> {
    this.map.delete(key)
    return Promise.resolve()
  }
}

interface TokenCall {
  url: string
  method: string
  contentType: string
  body: URLSearchParams
}

/** Discord's token endpoint, faked: records the request, answers a canned webhook grant. */
function fakeDiscord(reply: () => Response): { calls: TokenCall[]; fetchImpl: typeof fetch } {
  const calls: TokenCall[] = []
  const fetchImpl: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      contentType: headers.get('Content-Type') ?? '',
      body: new URLSearchParams(String(init?.body ?? ''))
    })
    return Promise.resolve(reply())
  }
  return { calls, fetchImpl }
}

function grant(extra: Record<string, unknown> = {}): Response {
  return Response.json({
    access_token: 'unused',
    token_type: 'Bearer',
    scope: 'webhook.incoming',
    webhook: {
      id: WEBHOOK_ID,
      token: WEBHOOK_TOKEN,
      channel_id: CHANNEL_ID,
      guild_id: GUILD_ID,
      name: 'raid-logs',
      url: `https://discord.com/api/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`,
      ...extra
    },
    guild: { id: GUILD_ID, name: 'Legends of Norrath' }
  })
}

interface Harness {
  kv: MemKv
  calls: TokenCall[]
  call: (path: string, method?: string) => Promise<Response>
}

function harness(overrides: Partial<Env> = {}, reply: () => Response = grant): Harness {
  const kv = new MemKv()
  const env: Env = {
    SHARES: kv,
    PUBLIC_ORIGIN: ORIGIN,
    DISCORD_CLIENT_ID: CLIENT_ID,
    DISCORD_CLIENT_SECRET: CLIENT_SECRET,
    ...overrides
  }
  const discord = fakeDiscord(reply)
  return {
    kv,
    calls: discord.calls,
    call: (path, method = 'GET') =>
      handleRequest(new Request(`${ORIGIN}${path}`, { method }), env, () => T0, discord.fetchImpl)
  }
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error
}

// ---- /discord/start ----------------------------------------------------------------------------

test('start: 302 to the picker with the right parameters, and a pending row under the state', async () => {
  const h = harness()
  const res = await h.call(`/discord/start?state=${STATE}`)
  assert.equal(res.status, 302)
  const to = new URL(res.headers.get('Location') ?? '')
  assert.equal(to.origin + to.pathname, 'https://discord.com/oauth2/authorize')
  assert.equal(to.searchParams.get('client_id'), CLIENT_ID)
  assert.equal(to.searchParams.get('scope'), 'webhook.incoming', 'a webhook and nothing else: no bot, no identity')
  assert.equal(to.searchParams.get('response_type'), 'code')
  assert.equal(to.searchParams.get('redirect_uri'), `${ORIGIN}/discord/callback`, 'built from PUBLIC_ORIGIN')
  assert.equal(to.searchParams.get('state'), STATE)
  const pending = h.kv.map.get(`discord:pending:${STATE}`)
  assert.ok(pending, 'the state is recorded before the browser leaves')
  assert.equal(pending.value, '1')
  assert.equal(pending.ttl, 600, 'ten minutes')
  assert.equal(h.calls.length, 0, 'nothing was sent to Discord yet')
})

test('start: a state that is not 43 base64url chars is 400 bad-state, and nothing is written', async () => {
  const h = harness()
  for (const bad of ['', 'short', 'A'.repeat(44), 'A'.repeat(42) + '!', 'A'.repeat(43) + '/x']) {
    const res = await h.call(`/discord/start?state=${encodeURIComponent(bad)}`)
    assert.equal(res.status, 400, JSON.stringify(bad))
    assert.equal(await errorCode(res), 'bad-state')
  }
  assert.equal((await h.call('/discord/start')).status, 400, 'missing is bad too')
  assert.equal(h.kv.map.size, 0)
})

// ---- /discord/callback -------------------------------------------------------------------------

test('callback: a state /start never issued is refused with a 400 HTML page, before Discord is asked', async () => {
  const h = harness()
  const res = await h.call(`/discord/callback?code=abc&state=${STATE}`)
  assert.equal(res.status, 400)
  assert.match(res.headers.get('Content-Type') ?? '', /^text\/html/)
  const html = await res.text()
  assert.match(html, /expired/i)
  assert.equal(h.calls.length, 0, 'the token endpoint (and the client secret) were never touched')
})

test('callback: access_denied renders a Cancelled page (200) and closes the pending state', async () => {
  const h = harness()
  await h.call(`/discord/start?state=${STATE}`)
  const res = await h.call(`/discord/callback?error=access_denied&state=${STATE}`)
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /Cancelled/)
  assert.match(html, /close this tab/i)
  assert.equal(h.calls.length, 0)
  assert.equal(h.kv.map.has(`discord:pending:${STATE}`), false, 'the state cannot be reused')
  // …and the app's poll now says "start over", not "keep waiting".
  assert.equal(await errorCode(await h.call(`/discord/claim/${STATE}`)), 'not-found')
})

test('callback: the happy path stores the result, drops the pending row, and shows the channel - never the token', async () => {
  const h = harness()
  await h.call(`/discord/start?state=${STATE}`)
  const res = await h.call(`/discord/callback?code=the-code&state=${STATE}`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('Content-Type') ?? '', /^text\/html/)
  assert.match(res.headers.get('Content-Security-Policy') ?? '', /default-src 'none'/)
  const html = await res.text()
  assert.match(html, /Connected/)
  assert.match(html, /#raid-logs/, 'the channel name is shown')
  assert.match(html, /go back to EQ Zera/)
  assert.ok(!html.includes(WEBHOOK_TOKEN), 'the token never reaches a browser')
  assert.ok(!html.includes(WEBHOOK_ID), 'nor the webhook id')
  assert.ok(!html.includes('<script'), 'the notice page has no script')
  assert.match(html, /<style nonce="[A-Za-z0-9_-]+">/)

  assert.equal(h.kv.map.has(`discord:pending:${STATE}`), false, 'pending is gone')
  const result = h.kv.map.get(`discord:result:${STATE}`)
  assert.ok(result, 'the result is parked under the state')
  assert.equal(result.ttl, 600)
  assert.deepEqual(JSON.parse(result.value), {
    webhookId: WEBHOOK_ID,
    webhookToken: WEBHOOK_TOKEN,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    channelName: 'raid-logs',
    guildName: 'Legends of Norrath',
    connectedAt: new Date(T0).toISOString()
  })
})

test('callback: the token request carries the client secret and the PUBLIC_ORIGIN redirect_uri', async () => {
  const h = harness()
  await h.call(`/discord/start?state=${STATE}`)
  await h.call(`/discord/callback?code=the-code&state=${STATE}`)
  assert.equal(h.calls.length, 1)
  const sent = h.calls[0]!
  assert.equal(sent.url, 'https://discord.com/api/oauth2/token')
  assert.equal(sent.method, 'POST')
  assert.match(sent.contentType, /^application\/x-www-form-urlencoded/)
  assert.equal(sent.body.get('client_id'), CLIENT_ID)
  assert.equal(sent.body.get('client_secret'), CLIENT_SECRET, 'the secret is sent to discord.com and nowhere else')
  assert.equal(sent.body.get('grant_type'), 'authorization_code')
  assert.equal(sent.body.get('code'), 'the-code')
  assert.equal(sent.body.get('redirect_uri'), `${ORIGIN}/discord/callback`, 'never from the request')
})

test('callback: the redirect_uri comes from PUBLIC_ORIGIN even when the request arrives under another host', async () => {
  const h = harness()
  await h.call(`/discord/start?state=${STATE}`)
  const kv = h.kv
  const env: Env = { SHARES: kv, PUBLIC_ORIGIN: ORIGIN, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_CLIENT_SECRET: CLIENT_SECRET }
  const discord = fakeDiscord(grant)
  const res = await handleRequest(
    new Request(`https://evil.example/discord/callback?code=c&state=${STATE}`),
    env,
    () => T0,
    discord.fetchImpl
  )
  assert.equal(res.status, 200)
  assert.equal(discord.calls[0]!.body.get('redirect_uri'), `${ORIGIN}/discord/callback`)
})

test('callback: a Discord failure is a 502 page, the pending row is closed, nothing is stored', async () => {
  for (const reply of [
    () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
    () => Response.json({ access_token: 'x' }), // 200 but no webhook in it
    () => grant({ token: 'too short' }), // a token the app's own filter would refuse
    () => { throw new TypeError('network down') }
  ]) {
    const h = harness({}, reply)
    await h.call(`/discord/start?state=${STATE}`)
    const res = await h.call(`/discord/callback?code=c&state=${STATE}`)
    assert.equal(res.status, 502)
    const html = await res.text()
    assert.match(html, /did not complete/)
    assert.ok(!html.includes(WEBHOOK_TOKEN))
    assert.equal(h.kv.map.size, 0, 'neither row remains')
    assert.equal(await errorCode(await h.call(`/discord/claim/${STATE}`)), 'not-found')
  }
})

test('callback: the channel name is escaped on the Connected page', async () => {
  const h = harness({}, () => grant({ name: '<img src=x onerror=alert(1)>' }))
  await h.call(`/discord/start?state=${STATE}`)
  const html = await (await h.call(`/discord/callback?code=c&state=${STATE}`)).text()
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
})

// ---- /discord/claim ----------------------------------------------------------------------------

test('claim: not-ready while pending, the exact row once, not-found after', async () => {
  const h = harness()
  await h.call(`/discord/start?state=${STATE}`)

  const early = await h.call(`/discord/claim/${STATE}`)
  assert.equal(early.status, 404)
  assert.equal(await errorCode(early), 'not-ready', 'the app keeps polling')

  await h.call(`/discord/callback?code=c&state=${STATE}`)
  const once = await h.call(`/discord/claim/${STATE}`)
  assert.equal(once.status, 200)
  assert.equal(once.headers.get('Cache-Control'), 'no-store')
  assert.equal(once.headers.get('Access-Control-Allow-Origin'), null, 'no CORS: the app calls from main')
  assert.deepEqual(await once.json(), {
    webhookId: WEBHOOK_ID,
    webhookToken: WEBHOOK_TOKEN,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    channelName: 'raid-logs',
    guildName: 'Legends of Norrath',
    connectedAt: new Date(T0).toISOString()
  })

  const again = await h.call(`/discord/claim/${STATE}`)
  assert.equal(again.status, 404)
  assert.equal(await errorCode(again), 'not-found', 'returned once, then gone')
  assert.equal(h.kv.map.size, 0)
})

test('claim: a state nobody started is not-found, a malformed one is bad-state', async () => {
  const h = harness()
  const unknown = await h.call(`/discord/claim/${'Z'.repeat(43)}`)
  assert.equal(unknown.status, 404)
  assert.equal(await errorCode(unknown), 'not-found')
  const bad = await h.call('/discord/claim/nope')
  assert.equal(bad.status, 400)
  assert.equal(await errorCode(bad), 'bad-state')
})

test('claim: names are optional - a grant without them yields a row without them', async () => {
  const h = harness({}, () =>
    Response.json({ webhook: { id: WEBHOOK_ID, token: WEBHOOK_TOKEN, channel_id: CHANNEL_ID, guild_id: GUILD_ID } })
  )
  await h.call(`/discord/start?state=${STATE}`)
  const html = await (await h.call(`/discord/callback?code=c&state=${STATE}`)).text()
  assert.match(html, /Connected/)
  assert.ok(!html.includes('<strong>#'), 'no channel name to show')
  const row = (await (await h.call(`/discord/claim/${STATE}`)).json()) as Record<string, unknown>
  assert.deepEqual(Object.keys(row).sort(), ['channelId', 'connectedAt', 'guildId', 'webhookId', 'webhookToken'])
})

// ---- off, methods, rate limits -----------------------------------------------------------------

test('without the client secret, start and callback are 503 discord-off', async () => {
  const h = harness({ DISCORD_CLIENT_SECRET: undefined })
  const start = await h.call(`/discord/start?state=${STATE}`)
  assert.equal(start.status, 503)
  assert.equal(await errorCode(start), 'discord-off')
  const cb = await h.call(`/discord/callback?code=c&state=${STATE}`)
  assert.equal(cb.status, 503)
  assert.equal(await errorCode(cb), 'discord-off')
  assert.equal(h.kv.map.size, 0)
  assert.equal(h.calls.length, 0)
  // The client id is public but just as necessary.
  const noId = harness({ DISCORD_CLIENT_ID: '' })
  assert.equal((await noId.call(`/discord/start?state=${STATE}`)).status, 503)
})

test('HEAD works like GET; other methods and other /discord paths are 404', async () => {
  const h = harness()
  const head = await h.call(`/discord/start?state=${STATE}`, 'HEAD')
  assert.equal(head.status, 302)
  for (const [path, method] of [
    [`/discord/start?state=${STATE}`, 'POST'],
    [`/discord/claim/${STATE}`, 'DELETE'],
    ['/discord/callback', 'PUT'],
    ['/discord/other', 'GET'],
    ['/discord/', 'GET']
  ] as const) {
    const res = await h.call(path, method)
    assert.equal(res.status, 404, `${method} ${path}`)
    assert.equal(await errorCode(res), 'not-found')
  }
})

test('start and callback count against CREATE_LIMIT, claim against READ_LIMIT', async () => {
  const deny = { limit: (): Promise<{ success: boolean }> => Promise.resolve({ success: false }) }
  const creates = harness({ CREATE_LIMIT: deny })
  assert.equal((await creates.call(`/discord/start?state=${STATE}`)).status, 429)
  assert.equal((await creates.call(`/discord/callback?code=c&state=${STATE}`)).status, 429)
  assert.equal((await creates.call(`/discord/claim/${STATE}`)).status, 404, 'reads are not the create budget')
  const reads = harness({ READ_LIMIT: deny })
  const res = await reads.call(`/discord/claim/${STATE}`)
  assert.equal(res.status, 429)
  assert.equal(await errorCode(res), 'rate-limited')
  assert.equal((await reads.call(`/discord/start?state=${STATE}`)).status, 302)
})
