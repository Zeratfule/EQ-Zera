// ============================================================================
// discordWebhook.test.mts — the URL grammar and the embed (docs/plans/discord-webhook.md).
// ============================================================================
//
// `shared/discordWebhook.ts` is the READ FILTER between a string a user pasted out of another
// program and a POST from the main process, so it is held to `parseShareLink`'s standard and
// tested the same way. What is guarded, and why each one is load-bearing:
//
//   * TWO HOSTS AND ONLY THEM, by exact hostname compare. `discord.com.evil.com` must fail, and
//     so must http, a deeper path, a port, credentials, and a bare token. A pasted word must
//     never become a network request.
//   * CLOSED CHARACTER CLASSES on both halves, because both are concatenated into a request path.
//     A token one character short of the class is refused rather than sent.
//   * THE MASK SHOWS THE ID AND FOUR CHARACTERS. The id is not a secret; the token is, and the
//     Preferences card draws this instead of ever holding the value.
//   * THE EMBED SAYS WHAT THE PLAIN-TEXT SUMMARY SAYS. Its description is `characterShareText`'s
//     own scores line and its own `With gear:` line, taken out of that function's output - so
//     this test compares them against that function rather than against a literal. Three
//     spellings of the same numbers is three places to disagree.
//   * EVERY STRING IS UNDER DISCORD'S CEILING, which is what stops one long name refusing the
//     whole message.
//
// No Electron, no network, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  discordEmbedFor,
  discordTestBody,
  maskWebhook,
  parseDiscordWebhook
} from '../src/shared/discordWebhook'
import { characterShareText, type CharacterProfileShare } from '../src/shared/characterShare'

const ID = '1234567890123456789'
const TOKEN = 'a'.repeat(68)
const URL_OK = `https://discord.com/api/webhooks/${ID}/${TOKEN}`

/** The fixture profile every embed claim below is made against. */
const PROFILE: CharacterProfileShare = {
  v: 2,
  capturedAt: 1_757_500_000_000,
  name: 'Primitive',
  level: 60,
  classes: ['Enchanter', 'Rogue'],
  look: { race: 'HU', sex: 'M' },
  cells: [
    {
      slot: 'chest',
      label: 'Chest',
      item: 'Crested Mistmoore Breastplate +3',
      tier: 3,
      exaltations: ['Fine Steel'],
      stats: [],
      effects: [],
      flags: []
    }
  ],
  totals: {
    ac: 412,
    stats: [
      { label: 'HP', total: 2400 },
      { label: 'Mana', total: 1800 },
      { label: 'Strength', total: 95 }
    ],
    saves: [{ label: 'Magic', total: 40 }],
    unsummed: [],
    counted: 1,
    unknown: 0
  },
  scores: { tank: 71, dps: 64, heal: 33, solo: 58 }
}

// ---- the grammar ------------------------------------------------------------------------------

test('the two hosts Discord actually hands out are accepted, and nothing else is', () => {
  assert.deepEqual(parseDiscordWebhook(URL_OK), { id: ID, token: TOKEN })
  // The legacy spelling, still produced by older copy buttons - refusing it would refuse a real
  // user's real URL.
  assert.deepEqual(parseDiscordWebhook(`https://discordapp.com/api/webhooks/${ID}/${TOKEN}`), {
    id: ID,
    token: TOKEN
  })
  // A trailing slash, a query and a fragment are all the same webhook; the extras are DROPPED.
  assert.deepEqual(parseDiscordWebhook(`${URL_OK}/`), { id: ID, token: TOKEN })
  assert.deepEqual(parseDiscordWebhook(`${URL_OK}?wait=true`), { id: ID, token: TOKEN })
  assert.deepEqual(parseDiscordWebhook(`${URL_OK}#x`), { id: ID, token: TOKEN })
  // Whitespace around a paste is a paste, not a different URL.
  assert.deepEqual(parseDiscordWebhook(`  ${URL_OK}\n`), { id: ID, token: TOKEN })
})

test('a lookalike host, a lookalike path and a plaintext scheme are all refused', () => {
  // THE EXACT-HOST CLAUSE. A suffix match would open every one of these.
  assert.equal(parseDiscordWebhook(`https://discord.com.evil.com/api/webhooks/${ID}/${TOKEN}`), null)
  assert.equal(parseDiscordWebhook(`https://evil.com/api/webhooks/${ID}/${TOKEN}`), null)
  assert.equal(parseDiscordWebhook(`https://cdn.discord.com/api/webhooks/${ID}/${TOKEN}`), null)
  // http, ever, anywhere.
  assert.equal(parseDiscordWebhook(`http://discord.com/api/webhooks/${ID}/${TOKEN}`), null)
  // Another path on the right host is not a webhook.
  assert.equal(parseDiscordWebhook(`https://discord.com/api/channels/${ID}/${TOKEN}`), null)
  assert.equal(parseDiscordWebhook(`https://discord.com/api/v10/webhooks/${ID}/${TOKEN}`), null)
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/${ID}/${TOKEN}/slack`), null)
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/${ID}`), null)
  // Credentials and a port, both of which change WHERE the request goes.
  assert.equal(parseDiscordWebhook(`https://u:p@discord.com/api/webhooks/${ID}/${TOKEN}`), null)
  assert.equal(parseDiscordWebhook(`https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`), null)
})

test('the id and the token are closed classes, and a near miss is a refusal', () => {
  // Too short by one, too long by one, and not digits at all.
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/1234567890123456/${TOKEN}`), null)
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/123456789012345678901/${TOKEN}`), null)
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/12345678901234567a/${TOKEN}`), null)
  // A SHORT TOKEN, which is the shape a truncated copy actually takes.
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/${ID}/${'a'.repeat(59)}`), null)
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/${ID}/${'a'.repeat(101)}`), null)
  // …and one carrying a character the class does not contain.
  assert.equal(parseDiscordWebhook(`https://discord.com/api/webhooks/${ID}/${'a'.repeat(67)}.`), null)
  // The bounds themselves are reachable, so this is a class and not an accident.
  assert.ok(parseDiscordWebhook(`https://discord.com/api/webhooks/${ID}/${'a'.repeat(60)}`))
  assert.ok(parseDiscordWebhook(`https://discord.com/api/webhooks/${ID}/${'-'.repeat(100)}`))
})

test('anything that is not a URL at all answers null rather than throwing', () => {
  for (const bad of ['', '   ', 'hello', TOKEN, 'discord.com/api/webhooks', 'javascript:alert(1)']) {
    assert.equal(parseDiscordWebhook(bad), null, bad)
  }
  for (const bad of [null, undefined, 42, {}, [], { id: ID, token: TOKEN }]) {
    assert.equal(parseDiscordWebhook(bad), null)
  }
  // The length bound is a bound, not a suggestion.
  assert.equal(parseDiscordWebhook(`${URL_OK}?x=${'y'.repeat(3000)}`), null)
})

// ---- the mask ---------------------------------------------------------------------------------

test('the mask shows the id and four characters of the token, and never the rest', () => {
  const masked = maskWebhook(ID, `${'b'.repeat(64)}wxyz`)
  assert.equal(masked, `…/webhooks/${ID}/••••wxyz`)
  assert.ok(masked.includes(ID), 'the id is not a secret and naming it is how you tell two apart')
  assert.ok(!masked.includes('b'.repeat(10)), 'the token itself never appears')
})

// ---- the embed --------------------------------------------------------------------------------

const LINK = 'https://share.eqzera.com/s/aB3xY9kQ2m'
const CARD = 'https://share.eqzera.com/c/aB3xY9kQ2m.png?v=1757500000000'

test('the embed wraps the link and states who it is about', () => {
  const body = discordEmbedFor(PROFILE, LINK, CARD)
  assert.equal(body.username, 'EQ Zera')
  assert.equal(body.avatar_url, 'https://share.eqzera.com/logo.png')
  // THE EMBED IS THE MESSAGE. A line above it would be the same facts twice.
  assert.equal(body.content, '')
  assert.equal(body.embeds.length, 1)
  const embed = body.embeds[0]
  assert.ok(embed)
  assert.equal(embed.title, 'Primitive · Level 60 · Enchanter / Rogue')
  assert.equal(embed.url, LINK)
  assert.equal(embed.image.url, CARD)
  assert.equal(embed.color, 0x5ee6ff)
  assert.equal(embed.footer.text, 'EQ Zera · eqzera.com')
  assert.equal(embed.timestamp, new Date(PROFILE.capturedAt).toISOString())
})

test('the description IS the plain summary’s two lines, taken from that function’s own output', () => {
  const embed = discordEmbedFor(PROFILE, LINK, CARD).embeds[0]
  assert.ok(embed)
  const lines = characterShareText(PROFILE).split('\n')
  const at = lines.findIndex((line) => line.startsWith('With gear:'))
  assert.ok(at >= 1, 'the summary carries a With gear line, and a scores line above it')
  // Compared against `characterShareText`, never against a literal: the point of the claim is that
  // the two cannot drift, and a literal here would drift with neither.
  assert.equal(embed.description, `${String(lines[at - 1])}\n${String(lines[at])}`)
  assert.ok(embed.description.includes('Tank 71%'))
  assert.ok(embed.description.includes('AC 412'))
})

test('the four score tiles are all four or none', () => {
  const withScores = discordEmbedFor(PROFILE, LINK, CARD).embeds[0]
  assert.ok(withScores)
  assert.deepEqual(
    withScores.fields,
    [
      { name: 'Tank', value: '71%', inline: true },
      { name: 'DPS', value: '64%', inline: true },
      { name: 'Healer', value: '33%', inline: true },
      { name: 'Solo', value: '58%', inline: true }
    ],
    'the Build tab’s own four labels, inline, as percents'
  )

  // A PROFILE THE BUILD TAB COULD NOT READ states the absence rather than four zeroes (law 1).
  const { scores: _drop, ...unscored } = PROFILE
  const none = discordEmbedFor(unscored, LINK, CARD).embeds[0]
  assert.ok(none)
  assert.deepEqual(none.fields, [])
  assert.ok(!none.description.includes('Tank'), 'and the scores line is not said either')
  assert.ok(none.description.startsWith('With gear:'))
})

test('a profile missing a name, a level or a class simply does not say it', () => {
  const bare: CharacterProfileShare = { ...PROFILE, classes: [] }
  delete bare.level
  delete bare.name
  const embed = discordEmbedFor(bare, LINK, CARD).embeds[0]
  assert.ok(embed)
  assert.equal(embed.title, 'A character')

  const noLevel: CharacterProfileShare = { ...PROFILE }
  delete noLevel.level
  const second = discordEmbedFor(noLevel, LINK, CARD).embeds[0]
  assert.ok(second)
  assert.equal(second.title, 'Primitive · Enchanter / Rogue')
})

test('every string stays under Discord’s ceiling, so one long name cannot refuse the message', () => {
  const huge: CharacterProfileShare = {
    ...PROFILE,
    name: 'N'.repeat(600),
    classes: Array.from({ length: 40 }, () => 'Necromancer'),
    totals: {
      ...PROFILE.totals,
      stats: Array.from({ length: 200 }, (_v, i) => ({ label: `Stat${String(i)}`, total: i }))
    }
  }
  const embed = discordEmbedFor(huge, LINK, CARD).embeds[0]
  assert.ok(embed)
  assert.ok(embed.title.length <= 256, `title ${String(embed.title.length)}`)
  assert.ok(embed.description.length <= 4096, `description ${String(embed.description.length)}`)
  assert.ok(embed.footer.text.length <= 2048)
  for (const field of embed.fields) {
    assert.ok(field.name.length <= 256)
    assert.ok(field.value.length <= 1024)
  }
})

test('a body with no capture instant still carries a timestamp Discord can read', () => {
  const noStamp: CharacterProfileShare = { ...PROFILE, capturedAt: 0 }
  const embed = discordEmbedFor(noStamp, LINK, CARD).embeds[0]
  assert.ok(embed)
  assert.ok(!Number.isNaN(Date.parse(embed.timestamp)), embed.timestamp)
})

// ---- the connection test ----------------------------------------------------------------------

test('the Test message is one plain line and carries no profile at all', () => {
  const body = discordTestBody()
  assert.equal(body.username, 'EQ Zera')
  assert.equal(body.content, 'EQ Zera connected. Character cards you post will appear here.')
  // A connection test that also published somebody's gear would be a surprise.
  assert.equal((body as { embeds?: unknown }).embeds, undefined)
})
