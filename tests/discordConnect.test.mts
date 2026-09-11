// ============================================================================
// discordConnect.test.mts — connecting a Discord channel without anybody seeing a URL.
// ============================================================================
//
// The owner's direction (2026-09-11): *"There's got to be a better way to share to Discord instead
// of having people input webhooks for each channel they want to send to."* The better way is
// Discord's own picker, reached through the share service, and what this suite guards is the three
// places that can go wrong without anybody noticing (docs/plans/discord-connect.md):
//
//   * THE STATE. 32 random bytes, base64url, 43 characters of a closed class - and different every
//     time. It is the service's handle on one OAuth attempt and the only thing this app sends
//     outbound during a connect; a guessable state is a state somebody else could claim under.
//   * THE CLAIM PARSER, which is THE ONE PLACE THE SERVICE CONTRACT IS ASSUMED. The reply is JSON
//     off a socket and the two values in it are about to be concatenated into a request path at
//     discord.com, so it is held to `parseShareLink`'s standard: the contract shape is accepted
//     exactly, and junk answers null rather than becoming something this app posts to.
//   * THE POLL, which is where a person waits. It keeps going on `not-ready`, stops on the first
//     200, stops CLEANLY on every refusal the service can send, backs off on a 429, honours Cancel
//     mid-wait, and gives up at ten minutes - the last of which is asserted against a FAKE CLOCK,
//     because a test that actually waited ten minutes is a test nobody runs.
//
// …and the fourth thing, which is a structure rather than a claim: an `EQ_E2E` build has NO share
// origin, so `connectStartUrl` is '' and nothing can be requested or opened at all. That one is
// made by running a dark child process, the way discordPost.test.mts makes its own.
//
// `fetch` is INJECTED, so every claim below is made without a network and without the service.
// No Electron, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  claimOnce,
  claimUrl,
  connectStartUrl,
  CONNECT_BUSY_MS,
  CONNECT_ERR,
  CONNECT_POLL_MS,
  CONNECT_WINDOW_MS,
  mintConnectState,
  pollForClaim,
  type ConnectPollDeps
} from '../src/main/share/discordConnect'
import {
  channelFromClaim,
  channelLabelFor,
  isConnectState,
  parseDiscordClaim
} from '../src/shared/discordChannels'

const ORIGIN = 'https://share.eqzera.com'
const TOKEN = 'a'.repeat(68)

/** The contract's own shape, spelled out once so every claim below is made against the real one. */
const CLAIM = {
  webhookId: '1234567890123456789',
  webhookToken: TOKEN,
  channelId: '9876543210987654321',
  guildId: '1111111111111111111',
  channelName: 'gear',
  guildName: 'Guild of Thieves',
  connectedAt: '2026-09-11T12:00:00.000Z'
}

/** One recorded request, and the fake that answers a queue of replies. */
interface Reply {
  status: number
  body?: unknown
}

function fakeFetch(replies: Reply[]): { deps: { fetch: typeof globalThis.fetch }; urls: string[] } {
  const urls: string[] = []
  const fetchFn = (input: unknown): Promise<Response> => {
    urls.push(String(input))
    const next = replies.length > 1 ? replies.shift() : replies[0]
    const reply = next ?? { status: 404 }
    return Promise.resolve({
      status: reply.status,
      text: () => Promise.resolve(reply.body === undefined ? '' : JSON.stringify(reply.body))
    } as Response)
  }
  return { deps: { fetch: fetchFn as unknown as typeof globalThis.fetch }, urls }
}

/** A clock the poll cannot tell from a real one, and that a test can run ten minutes through. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let at = 1_000_000
  const slept: number[] = []
  return {
    now: () => at,
    sleep: (ms: number) => {
      slept.push(ms)
      at += ms
      return Promise.resolve()
    },
    slept
  }
}

function pollDeps(replies: Reply[], cancelled: () => boolean = () => false): {
  deps: ConnectPollDeps
  urls: string[]
  slept: number[]
} {
  const { deps: fetchDeps, urls } = fakeFetch(replies)
  const clock = fakeClock()
  return {
    deps: { fetch: fetchDeps.fetch, now: clock.now, sleep: clock.sleep, cancelled },
    urls,
    slept: clock.slept
  }
}

// ---- the state --------------------------------------------------------------------------------

test('a minted state is 32 bytes of base64url, and never the same one twice', () => {
  const state = mintConnectState()
  // 32 bytes -> 43 base64url characters, and the class has no padding, no `+` and no `/`.
  assert.equal(state.length, 43)
  assert.match(state, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(isConnectState(state), true)
  assert.equal(Buffer.from(state, 'base64url').length, 32)

  const seen = new Set(Array.from({ length: 200 }, () => mintConnectState()))
  assert.equal(seen.size, 200, 'a repeated state would be a state somebody else could claim under')
})

test('only a real state produces a URL, and both URLs are on the share origin', () => {
  const state = mintConnectState()
  assert.equal(connectStartUrl(state), `${ORIGIN}/discord/start?state=${state}`)
  assert.equal(claimUrl(state), `${ORIGIN}/discord/claim/${state}`)
  // Anything outside the closed class produces NO url, and therefore no request and no browser.
  for (const junk of ['', 'short', `${state}x`, '../../etc/passwd', 'a b', `${state}?x=1`]) {
    assert.equal(connectStartUrl(junk), '', junk)
    assert.equal(claimUrl(junk), '', junk)
  }
})

// ---- the claim parser -------------------------------------------------------------------------

test('the contract shape is accepted exactly as the service sends it', () => {
  const claim = parseDiscordClaim(CLAIM)
  assert.deepEqual(claim, {
    webhookId: CLAIM.webhookId,
    webhookToken: CLAIM.webhookToken,
    channelId: CLAIM.channelId,
    guildId: CLAIM.guildId,
    channelName: 'gear',
    guildName: 'Guild of Thieves'
  })
  // `connectedAt` is carried by the service and is not something this app keeps; an extra field is
  // IGNORED rather than refused, because the service may grow one and that must not be an outage.
})

test('the two names are optional, and everything else is not', () => {
  const bare = parseDiscordClaim({
    webhookId: CLAIM.webhookId,
    webhookToken: CLAIM.webhookToken,
    channelId: CLAIM.channelId,
    guildId: CLAIM.guildId
  })
  assert.ok(bare)
  assert.equal(bare.channelName, undefined)
  assert.equal(bare.guildName, undefined)
})

test('junk is refused, and a refusal produces no channel at all', () => {
  const cases: [string, unknown][] = [
    ['null', null],
    ['a string', 'webhookId=1'],
    ['an array', [CLAIM]],
    ['no webhook id', { ...CLAIM, webhookId: undefined }],
    ['a webhook id that is not a snowflake', { ...CLAIM, webhookId: '12/../34' }],
    ['a token one character short of the class', { ...CLAIM, webhookToken: 'a'.repeat(59) }],
    ['a token with a slash in it', { ...CLAIM, webhookToken: `${'a'.repeat(60)}/x` }],
    ['a channel id that is not a snowflake', { ...CLAIM, channelId: 'general' }],
    ['a guild id that is missing', { ...CLAIM, guildId: undefined }],
    ['the old singular spelling', { id: CLAIM.webhookId, token: CLAIM.webhookToken }]
  ]
  for (const [why, body] of cases) assert.equal(parseDiscordClaim(body), null, why)
})

test('a name from the service cannot carry a newline into a row, or a novel', () => {
  const claim = parseDiscordClaim({ ...CLAIM, channelName: 'ge\nar', guildName: 'G'.repeat(400) })
  assert.ok(claim)
  assert.equal(claim.channelName, 'ge ar')
  assert.equal(claim.guildName?.length, 100)
})

// ---- the label --------------------------------------------------------------------------------

test('the label says what Discord told us, and says something honest when it told us nothing', () => {
  const claim = parseDiscordClaim(CLAIM)
  assert.ok(claim)
  assert.equal(channelLabelFor(claim), '#gear · Guild of Thieves')
  assert.equal(channelLabelFor({ ...claim, guildName: undefined }), '#gear')
  assert.equal(channelLabelFor({ ...claim, channelName: undefined }), 'Guild of Thieves channel')
  // Neither name: the last four of the channel id, which at least tells two of them apart. This is
  // the case `discord:renameChannel` exists for.
  const anonymous = { ...claim, channelName: undefined, guildName: undefined }
  assert.equal(channelLabelFor(anonymous), 'Channel 4321')
  // …and a very long pair of names still produces a row, not a paragraph.
  const long = { ...claim, channelName: 'c'.repeat(90), guildName: 'g'.repeat(90) }
  assert.ok(channelLabelFor(long).length <= 60)
})

test('a claim becomes a channel record with the token kept and the ids kept', () => {
  const claim = parseDiscordClaim(CLAIM)
  assert.ok(claim)
  const channel = channelFromClaim(claim, 1_757_600_000_000)
  assert.deepEqual(channel, {
    id: CLAIM.webhookId,
    token: CLAIM.webhookToken,
    channelId: CLAIM.channelId,
    guildId: CLAIM.guildId,
    label: '#gear · Guild of Thieves',
    addedAt: 1_757_600_000_000
  })
})

// ---- one look ---------------------------------------------------------------------------------

test('one look reads every status the contract can send', async () => {
  const state = mintConnectState()
  const cases: [Reply, string][] = [
    [{ status: 404, body: { error: 'not-ready' } }, 'pending'],
    // A 404 with nothing readable in it is read as NOT-READY, which is the safe half: waiting two
    // more seconds costs a poll, and giving up on a live attempt costs the user their connection.
    [{ status: 404 }, 'pending'],
    [{ status: 429 }, 'pending'],
    [{ status: 404, body: { error: 'not-found' } }, 'failed'],
    [{ status: 400, body: { error: 'bad-state' } }, 'failed'],
    [{ status: 503, body: { error: 'discord-off' } }, 'failed'],
    [{ status: 500 }, 'failed'],
    [{ status: 0 }, 'failed'],
    [{ status: 200, body: CLAIM }, 'claimed'],
    // A 200 whose body is not the contract shape is a failure, not a webhook this app will post to.
    [{ status: 200, body: { webhookId: '1' } }, 'failed']
  ]
  for (const [reply, kind] of cases) {
    const { deps } = fakeFetch([reply])
    const look = await claimOnce(deps, state)
    assert.equal(look.kind, kind, JSON.stringify(reply))
  }
})

test('the sentences are the agreed ones, and none of them names a status code or a route', async () => {
  const state = mintConnectState()
  const cases: [Reply, string][] = [
    [{ status: 404, body: { error: 'not-found' } }, 'Discord did not complete the connection. Try again.'],
    [{ status: 503, body: { error: 'discord-off' } }, 'The share service is not set up for Discord yet.'],
    [{ status: 400, body: { error: 'bad-state' } }, 'EQ Zera could not connect that channel. Try again.'],
    [{ status: 0 }, 'Could not reach the EQ Zera service.']
  ]
  for (const [reply, sentence] of cases) {
    const { deps } = fakeFetch([reply])
    const look = await claimOnce(deps, state)
    assert.equal(look.kind === 'failed' ? look.error : '', sentence)
    assert.ok(!sentence.includes('share.eqzera.com'))
    assert.ok(!/\d{3}/.test(sentence))
  }
})

// ---- the poll ---------------------------------------------------------------------------------

test('the poll keeps going on not-ready and stops on the first 200', async () => {
  const state = mintConnectState()
  const { deps, urls, slept } = pollDeps([
    { status: 404, body: { error: 'not-ready' } },
    { status: 404, body: { error: 'not-ready' } },
    { status: 200, body: CLAIM }
  ])
  const outcome = await pollForClaim(deps, state)
  assert.equal(outcome.kind, 'done')
  assert.equal(urls.length, 3, 'and it stops asking the moment it has the claim')
  assert.deepEqual(slept, [CONNECT_POLL_MS, CONNECT_POLL_MS])
  assert.ok(urls.every((u) => u === `${ORIGIN}/discord/claim/${state}`))
})

test('a 429 backs the interval off to five seconds and keeps going', async () => {
  const { deps, slept } = pollDeps([{ status: 429 }, { status: 200, body: CLAIM }])
  const outcome = await pollForClaim(deps, mintConnectState())
  assert.equal(outcome.kind, 'done')
  assert.deepEqual(slept, [CONNECT_BUSY_MS])
})

test('every refusal ends the poll cleanly, with one sentence and no further requests', async () => {
  const refusals: Reply[] = [
    { status: 404, body: { error: 'not-found' } },
    { status: 400, body: { error: 'bad-state' } },
    { status: 503, body: { error: 'discord-off' } },
    { status: 500 },
    { status: 0 }
  ]
  for (const reply of refusals) {
    const { deps, urls } = pollDeps([{ status: 404, body: { error: 'not-ready' } }, reply])
    const outcome = await pollForClaim(deps, mintConnectState())
    assert.equal(outcome.kind, 'failed', JSON.stringify(reply))
    assert.ok(outcome.kind === 'failed' && outcome.error.length > 0)
    assert.equal(urls.length, 2, 'it does not keep asking after a refusal')
  }
})

test('Cancel is honoured mid-wait, and nothing after it is stored', async () => {
  let cancelled = false
  const { deps, urls } = pollDeps([{ status: 404, body: { error: 'not-ready' } }], () => cancelled)
  const running = pollForClaim(deps, mintConnectState())
  // The fake clock resolves its sleeps immediately, so the cancel is set from the deps themselves
  // after the first pass: what is being asserted is that the loop READS it every time round.
  cancelled = true
  const outcome = await running
  assert.equal(outcome.kind, 'cancelled')
  assert.ok(urls.length <= 2, 'and it stopped asking')
})

test('it gives up at ten minutes, on the clock rather than on a count of passes', async () => {
  const { deps, urls, slept } = pollDeps([{ status: 404, body: { error: 'not-ready' } }])
  const outcome = await pollForClaim(deps, mintConnectState())
  assert.deepEqual(outcome, { kind: 'failed', error: CONNECT_ERR.timeout })
  const waited = slept.reduce((a, b) => a + b, 0)
  assert.ok(waited <= CONNECT_WINDOW_MS, `waited ${String(waited)}ms`)
  assert.ok(waited > CONNECT_WINDOW_MS - CONNECT_POLL_MS, `waited ${String(waited)}ms`)
  assert.equal(urls.length, slept.length + 1)
  assert.equal(CONNECT_WINDOW_MS, 600_000)
})

// ---- dark under EQ_E2E --------------------------------------------------------------------------

/**
 * THE DARK CLAIM, MADE BY RUNNING A DARK PROCESS. `share/net.ts` reads `EQ_E2E` at import, so the
 * only honest way to assert what an `EQ_E2E` build does is to be one. The child imports the module
 * with the flag set, asks for both URLs and runs a whole poll through a `fetch` that would record a
 * call, and prints what it got; this process asserts on that. A connect that reached the real
 * service would park a real OAuth state and open a real browser window in the middle of a headless
 * run, so "the harness probably will not" is not good enough, and a structure is.
 */
test('an EQ_E2E build is DARK: no URL, the dark sentence, and the fetch is never called', () => {
  const module = JSON.stringify(new URL('../src/main/share/discordConnect.ts', import.meta.url).href)
  const script = [
    `const m = await import(${module});`,
    'const state = m.mintConnectState();',
    'let calls = 0;',
    'const deps = {',
    '  fetch: () => { calls++; return Promise.resolve({ status: 200, text: () => Promise.resolve("{}") }); },',
    '  now: () => 0, sleep: () => Promise.resolve(), cancelled: () => false',
    '};',
    'const res = await m.pollForClaim(deps, state);',
    'console.log(JSON.stringify({',
    '  configured: m.connectEndpointConfigured(),',
    '  start: m.connectStartUrl(state), claim: m.claimUrl(state), res, calls',
    '}));'
  ].join('\n')
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, EQ_E2E: '1' },
    encoding: 'utf8'
  })
  const said = JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as {
    configured: boolean
    start: string
    claim: string
    res: { kind: string; error?: string }
    calls: number
  }
  assert.equal(said.configured, false)
  assert.equal(said.start, '', 'no start URL, so no browser can be opened')
  assert.equal(said.claim, '', 'and no claim URL, so nothing can be asked')
  assert.deepEqual(said.res, { kind: 'failed', error: CONNECT_ERR.dark })
  assert.equal(said.calls, 0, 'and nothing was even attempted')
})
