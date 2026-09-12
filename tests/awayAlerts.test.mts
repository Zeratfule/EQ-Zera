// ============================================================================
// awayAlerts.test.mts — alerts that reach you when you are not at the keyboard.
// ============================================================================
//
// THE FEATURE'S WHOLE RISK IS A DECISION MADE WHILE NOBODY IS WATCHING, which is the one kind of
// decision a person cannot check by using the app: if "away" is read wrongly, or if a burst of
// firings becomes a burst of phone notifications, the only evidence is a muted channel a week
// later. So every decision is pure (`src/shared/awayAlerts.ts` imports one type and nothing else)
// and every one of them is a table here.
//
// SIX CLAIMS:
//
//   1. THE FILTER. A settings file is a file somebody else can also write to, and two of these
//      fields steer a network post. An absent, garbage, partial or hostile blob reads as the
//      shipped behaviour: off, five minutes, nothing selected.
//   2. THE AWAY MATRIX, as a table over both readings. It is an OR, and the "game is closed" half
//      is switchable — a user who turns it off is judged on input alone, at any idle time.
//   3. THE MESSAGE. One embed, one line per firing, ten lines then a count, the clamp on a matched
//      line, and Discord's markup escaped so a mob called `**Innoruuk**` cannot bold the message.
//   4. THE BATCH TIMING, on a fake clock: nothing before ten seconds, everything at ten, and a
//      full batch of ten goes the instant it fills rather than waiting out the window.
//   5. THE CEILING. Twenty posts per ten minutes per process, dropped rather than queued, counted
//      in ITEMS — and the window SLIDES, so the twenty-first post goes once the first has aged out.
//   6. THE DELIVERY. Nothing connected means a sentence and NO POST AT ALL; a refusal and a thrown
//      transport both mean a sentence and no exception; a success clears the complaint and keeps
//      the last-sent stamp across a later failure.
//
// The wired half (src/main/awayAlerts.ts, the one call in dataServer/alertsAudio.ts) imports
// Electron and cannot be loaded here; the two claims about it that are not arithmetic — the fire
// hook runs AFTER the sound and inside a `try`, and the filter is by `alertIds` — are read as
// SOURCE at the foot, the way closeToTray.test.mts reads the close listener.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AWAY_MATCHED_MAX,
  AWAY_MAX_LINES,
  AwayBatcher,
  BATCH_MAX,
  BATCH_MS,
  DEFAULT_AWAY_ALERTS,
  MAX_AWAY_ALERT_IDS,
  RATE_MAX,
  RATE_WINDOW_MS,
  awayAlertBody,
  deliverAwayBatch,
  isAway,
  sanitizeAwayAlertsPrefs,
  type AwayAlertsPrefs,
  type AwayItem,
  type AwayPostResult
} from '../src/shared/awayAlerts'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A well-formed webhook id: the only shape `channelId` accepts. */
const CHANNEL = '123456789012345678'

function item(name: string, matchedText: string, ts: number): AwayItem {
  return { name, matchedText, ts }
}

/** The one embed of a body, asserted to exist so every claim below reads as a claim. */
function embedOf(items: readonly AwayItem[]): {
  title: string
  description: string
  color: number
  footer: { text: string }
  timestamp: string
} {
  const body = awayAlertBody(items)
  const embed = body.embeds[0]
  assert.ok(embed !== undefined, 'a body always carries exactly one embed')
  return embed
}

// ------------------------------------------------------------------------ 1. the store filter

test('an absent, garbage or partial store reads as the shipped behaviour', () => {
  for (const raw of [undefined, null, 0, '', 'off', [], [1, 2], true]) {
    assert.deepEqual(sanitizeAwayAlertsPrefs(raw), DEFAULT_AWAY_ALERTS, JSON.stringify(raw ?? null))
  }
  assert.deepEqual(sanitizeAwayAlertsPrefs({}), DEFAULT_AWAY_ALERTS)
  // The shipped default itself: off, five minutes, nothing selected, and "the game is closed"
  // counts — the case this feature is FOR.
  assert.equal(DEFAULT_AWAY_ALERTS.enabled, false)
  assert.equal(DEFAULT_AWAY_ALERTS.idleMinutes, 5)
  assert.deepEqual(DEFAULT_AWAY_ALERTS.alertIds, [])
  assert.equal(DEFAULT_AWAY_ALERTS.alsoWhenGameClosed, true)
})

test('the minute ladder is a CLOSED set; anything else reads as the default', () => {
  for (const m of [2, 5, 10, 15]) {
    assert.equal(sanitizeAwayAlertsPrefs({ idleMinutes: m }).idleMinutes, m)
  }
  for (const m of [0, 1, 3, 7, 20, 4.9, -5, '5', null, NaN, Infinity]) {
    assert.equal(sanitizeAwayAlertsPrefs({ idleMinutes: m }).idleMinutes, 5, String(m))
  }
})

test('a channel id is a snowflake or it is ABSENT - never an empty or invented string', () => {
  assert.equal(sanitizeAwayAlertsPrefs({ channelId: CHANNEL }).channelId, CHANNEL)
  for (const bad of ['', '123', 'abcdefghijklmnopqr', `${CHANNEL}0000`, 42, null, {}]) {
    const out = sanitizeAwayAlertsPrefs({ channelId: bad })
    assert.equal(out.channelId, undefined, JSON.stringify(bad))
    assert.equal('channelId' in out, false, 'the key is omitted, not set to undefined')
  }
})

test('the alert list is de-duplicated, type-filtered and bounded', () => {
  assert.deepEqual(sanitizeAwayAlertsPrefs({ alertIds: ['a', 'b', 'a', '', 3, null, 'c'] }).alertIds, [
    'a',
    'b',
    'c'
  ])
  // Order is preserved: the list a user built stays the list they built.
  assert.deepEqual(sanitizeAwayAlertsPrefs({ alertIds: ['z', 'a'] }).alertIds, ['z', 'a'])
  // An id longer than the file filter allows is dropped rather than cut — a cut id names nothing.
  assert.deepEqual(sanitizeAwayAlertsPrefs({ alertIds: ['x'.repeat(65)] }).alertIds, [])
  const many = Array.from({ length: MAX_AWAY_ALERT_IDS + 50 }, (_v, i) => `id${String(i)}`)
  assert.equal(sanitizeAwayAlertsPrefs({ alertIds: many }).alertIds.length, MAX_AWAY_ALERT_IDS)
  assert.deepEqual(sanitizeAwayAlertsPrefs({ alertIds: 'nope' }).alertIds, [])
})

test('the filter is idempotent - reading back what it wrote changes nothing', () => {
  const once = sanitizeAwayAlertsPrefs({
    enabled: true,
    channelId: CHANNEL,
    idleMinutes: 15,
    alertIds: ['a', 'a', 'b'],
    alsoWhenGameClosed: false
  })
  assert.deepEqual(sanitizeAwayAlertsPrefs(once), once)
  assert.deepEqual(once, {
    enabled: true,
    channelId: CHANNEL,
    idleMinutes: 15,
    alertIds: ['a', 'b'],
    alsoWhenGameClosed: false
  })
})

// ------------------------------------------------------------------------------ 2. "away"

/** The preference, spelled for one row of the matrix. */
function prefs(patch: Partial<AwayAlertsPrefs>): AwayAlertsPrefs {
  return { ...DEFAULT_AWAY_ALERTS, ...patch }
}

test('away is idle-past-the-threshold OR (optionally) the game not running', () => {
  const rows: { idleSeconds: number; eqRunning: boolean; p: AwayAlertsPrefs; want: boolean }[] = [
    // Five minutes, the default, with the game up: the boundary is inclusive.
    { idleSeconds: 0, eqRunning: true, p: prefs({}), want: false },
    { idleSeconds: 299, eqRunning: true, p: prefs({}), want: false },
    { idleSeconds: 300, eqRunning: true, p: prefs({}), want: true },
    { idleSeconds: 5_000, eqRunning: true, p: prefs({}), want: true },
    // The game closed is away ON ITS OWN, whatever the keyboard says…
    { idleSeconds: 0, eqRunning: false, p: prefs({}), want: true },
    // …unless the user turned that reading off, in which case only input counts.
    { idleSeconds: 0, eqRunning: false, p: prefs({ alsoWhenGameClosed: false }), want: false },
    { idleSeconds: 300, eqRunning: false, p: prefs({ alsoWhenGameClosed: false }), want: true },
    // The two ends of the ladder.
    { idleSeconds: 119, eqRunning: true, p: prefs({ idleMinutes: 2 }), want: false },
    { idleSeconds: 120, eqRunning: true, p: prefs({ idleMinutes: 2 }), want: true },
    { idleSeconds: 899, eqRunning: true, p: prefs({ idleMinutes: 15 }), want: false },
    { idleSeconds: 900, eqRunning: true, p: prefs({ idleMinutes: 15 }), want: true }
  ]
  for (const row of rows) {
    assert.equal(
      isAway({ idleSeconds: row.idleSeconds, eqRunning: row.eqRunning, prefs: row.p }),
      row.want,
      JSON.stringify(row)
    )
  }
})

test('the verdict does not consult `enabled` - being away is a fact about the machine', () => {
  const on = prefs({ enabled: true, alsoWhenGameClosed: false })
  const off = prefs({ enabled: false, alsoWhenGameClosed: false })
  assert.equal(isAway({ idleSeconds: 600, eqRunning: true, prefs: on }), true)
  assert.equal(isAway({ idleSeconds: 600, eqRunning: true, prefs: off }), true)
})

// ------------------------------------------------------------------------------ 3. the message

test('the embed names itself, its footer and the LAST firing`s instant', () => {
  const embed = embedOf([item('Slow', 'a', 1_000), item('Mez', 'b', 9_000)])
  assert.equal(embed.title, 'EQ Zera · while you were away')
  assert.equal(embed.footer.text, 'EQ Zera · eqzera.com')
  assert.equal(embed.color, 0xffc857)
  assert.equal(embed.timestamp, new Date(9_000).toISOString())
})

test('the body wears this app`s own bot identity and carries no content line', () => {
  const body = awayAlertBody([item('Slow', 'a', 1)])
  assert.equal(body.username, 'EQ Zera')
  assert.equal(body.content, '')
  assert.equal(body.embeds.length, 1)
})

test('one line per firing, name bolded, matched text beside it', () => {
  const embed = embedOf([item('Raid target', 'Lord Nagafen begins to cast', 5)])
  assert.equal(embed.description, '**Raid target** - Lord Nagafen begins to cast')
})

test('a firing with no matched text is just its name', () => {
  assert.equal(embedOf([item('Tell', '', 5)]).description, '**Tell**')
})

test('past ten lines it COUNTS rather than lists', () => {
  const many = Array.from({ length: AWAY_MAX_LINES + 4 }, (_v, i) => item(`A${String(i)}`, 'x', i))
  const lines = embedOf(many).description.split('\n')
  assert.equal(lines.length, AWAY_MAX_LINES + 1)
  assert.equal(lines[AWAY_MAX_LINES], '+4 more')
  // Exactly ten needs no counter.
  const ten = many.slice(0, AWAY_MAX_LINES)
  assert.equal(embedOf(ten).description.split('\n').length, AWAY_MAX_LINES)
})

test('a matched line is clamped to 160 characters', () => {
  const long = 'z'.repeat(500)
  const said = embedOf([item('A', long, 1)]).description
  assert.equal(said, `**A** - ${'z'.repeat(AWAY_MATCHED_MAX)}`)
})

test('Discord`s markup is escaped, so a mob name cannot format the message', () => {
  const said = embedOf([item('**Boss**', 'a|b_c~d`e[f](g) >h', 1)]).description
  assert.equal(said, '**\\*\\*Boss\\*\\*** - a\\|b\\_c\\~d\\`e\\[f\\]\\(g\\) \\>h')
})

test('a newline inside a value becomes a space, so one firing stays one line', () => {
  const said = embedOf([item('A', 'one\ntwo\r\tthree', 1)]).description
  assert.equal(said, '**A** - one two  three')
  assert.equal(said.includes('\n'), false)
})

test('a hyphen is NOT escaped - it is markup only at the start of a line, and no line starts with one', () => {
  assert.equal(embedOf([item('A', 'x - y', 1)]).description, '**A** - x - y')
})

// ------------------------------------------------------------------------- 4 + 5. the batcher

/** A batcher on a clock the test moves by hand, plus the batches it handed over. */
function harness(): {
  batcher: AwayBatcher
  sent: AwayItem[][]
  at: (ms: number) => void
} {
  let now = 0
  const sent: AwayItem[][] = []
  const batcher = new AwayBatcher({
    now: () => now,
    post: (items) => {
      sent.push(items)
    }
  })
  return {
    batcher,
    sent,
    at: (ms) => {
      now = ms
    }
  }
}

test('a batch waits ten seconds for company, then goes as one message', () => {
  const h = harness()
  h.batcher.offer(item('A', 'a', 1))
  h.batcher.offer(item('B', 'b', 2))
  assert.equal(h.batcher.pending(), 2)
  assert.equal(h.batcher.flushDue(BATCH_MS - 1), false, 'not due yet')
  assert.deepEqual(h.sent, [])
  assert.equal(h.batcher.flushDue(BATCH_MS), true, 'due on the tick it reaches the window')
  assert.equal(h.batcher.pending(), 0)
  assert.equal(h.sent.length, 1)
  assert.deepEqual(h.sent[0]?.map((i) => i.name), ['A', 'B'])
  assert.equal(h.batcher.stats.posted, 1)
  // An empty batcher is never due, and asking costs nothing.
  assert.equal(h.batcher.flushDue(BATCH_MS * 10), false)
})

test('a FULL batch goes immediately rather than waiting out the window', () => {
  const h = harness()
  for (let i = 0; i < BATCH_MAX; i++) h.batcher.offer(item(`A${String(i)}`, 'x', i))
  assert.equal(h.sent.length, 1, 'the tenth item sent the batch')
  assert.equal(h.sent[0]?.length, BATCH_MAX)
  assert.equal(h.batcher.pending(), 0)
  // …and the NEXT item starts a fresh window from where it arrived, not from the first one.
  h.at(100_000)
  h.batcher.offer(item('next', 'x', 1))
  assert.equal(h.batcher.flushDue(100_000 + BATCH_MS - 1), false)
  assert.equal(h.batcher.flushDue(100_000 + BATCH_MS), true)
  assert.equal(h.sent.length, 2)
})

test('flushNow sends whatever is pending, whatever the clock says', () => {
  const h = harness()
  assert.equal(h.batcher.flushNow(0), false, 'nothing pending')
  h.batcher.offer(item('A', 'a', 1))
  assert.equal(h.batcher.flushNow(1), true)
  assert.equal(h.sent.length, 1)
})

test('twenty posts per ten minutes, then DROPPED and counted in items', () => {
  const h = harness()
  for (let i = 0; i < RATE_MAX; i++) {
    h.at(i * 1000)
    h.batcher.offer(item(`A${String(i)}`, 'x', i))
    assert.equal(h.batcher.flushNow(i * 1000), true, `post ${String(i)}`)
  }
  assert.equal(h.sent.length, RATE_MAX)
  assert.equal(h.batcher.stats.posted, RATE_MAX)
  assert.equal(h.batcher.stats.dropped, 0)

  // The twenty-first, inside the same window, is refused — and the ITEMS it carried are counted,
  // because what a user lost is firings rather than envelopes.
  h.at(30_000)
  h.batcher.offer(item('X', 'x', 1))
  h.batcher.offer(item('Y', 'y', 2))
  assert.equal(h.batcher.flushNow(30_000), false)
  assert.equal(h.sent.length, RATE_MAX, 'nothing left')
  assert.equal(h.batcher.stats.dropped, 2)
  assert.equal(h.batcher.stats.posted, RATE_MAX)
  // Dropped, NOT queued: nothing is pending afterwards waiting for the window to open.
  assert.equal(h.batcher.pending(), 0)
})

test('the ceiling`s window SLIDES - the first post aging out makes room for one more', () => {
  const h = harness()
  for (let i = 0; i < RATE_MAX; i++) {
    h.batcher.offer(item(`A${String(i)}`, 'x', i))
    h.batcher.flushNow(i)
  }
  // Still inside the window: refused.
  h.batcher.offer(item('no', 'x', 1))
  assert.equal(h.batcher.flushNow(RATE_WINDOW_MS - 1), false)
  // The very first post is now `RATE_WINDOW_MS` old, so exactly one slot has opened.
  h.batcher.offer(item('yes', 'x', 1))
  assert.equal(h.batcher.flushNow(RATE_WINDOW_MS), true)
  assert.equal(h.batcher.stats.posted, RATE_MAX + 1)
})

test('stats are a COPY - a caller cannot move the counters', () => {
  const h = harness()
  const before = h.batcher.stats
  before.posted = 999
  assert.equal(h.batcher.stats.posted, 0)
})

// ------------------------------------------------------------------------------ 6. the delivery

const SENTENCES = { unset: 'Connect a Discord channel.', failed: 'Could not reach Discord.' }

test('nothing connected means a sentence and NO POST AT ALL', async () => {
  let posts = 0
  const health = await deliverAwayBatch<string>([item('A', 'a', 1)], {
    now: () => 7_000,
    channel: () => null,
    post: () => {
      posts += 1
      return Promise.resolve({ ok: true })
    },
    sentences: SENTENCES
  })
  assert.equal(posts, 0, 'the transport is never reached')
  assert.equal(health.lastError, SENTENCES.unset)
  assert.equal(health.lastErrorAt, 7_000)
  assert.equal(health.lastSentAt, undefined)
})

test('a refusal from Discord is reported in ITS words, and nothing throws', async () => {
  const health = await deliverAwayBatch<string>([item('A', 'a', 1)], {
    now: () => 8_000,
    channel: () => 'c',
    post: () => Promise.resolve({ ok: false, error: 'Discord refused the message.' }),
    sentences: SENTENCES
  })
  assert.equal(health.lastError, 'Discord refused the message.')
  assert.equal(health.lastErrorAt, 8_000)
})

test('a transport that THROWS is reported as the caller`s failure sentence, not as an exception', async () => {
  const health = await deliverAwayBatch<string>([item('A', 'a', 1)], {
    now: () => 9_000,
    channel: () => 'c',
    post: () => Promise.reject(new Error('socket')),
    sentences: SENTENCES
  })
  assert.equal(health.lastError, SENTENCES.failed)
  assert.equal(health.lastErrorAt, 9_000)
})

test('a success clears the complaint; a later failure keeps the last-sent stamp', async () => {
  const deps = {
    now: () => 1_000,
    channel: () => 'c',
    post: () => Promise.resolve<AwayPostResult>({ ok: true }),
    sentences: SENTENCES
  }
  const ok = await deliverAwayBatch<string>([item('A', 'a', 1)], deps, {
    lastError: 'old',
    lastErrorAt: 1
  })
  assert.deepEqual(ok, { lastSentAt: 1_000 })

  const then = await deliverAwayBatch<string>([item('A', 'a', 1)], {
    ...deps,
    now: () => 2_000,
    post: () => Promise.resolve<AwayPostResult>({ ok: false, error: 'nope' })
  }, ok)
  assert.deepEqual(then, { lastSentAt: 1_000, lastError: 'nope', lastErrorAt: 2_000 })
})

test('the body handed to the transport is the batch`s own embed', async () => {
  let seen = ''
  await deliverAwayBatch<string>([item('Slow', 'it slows', 42)], {
    now: () => 1,
    channel: () => 'c',
    post: (_c, body) => {
      seen = body.embeds[0]?.description ?? ''
      return Promise.resolve({ ok: true })
    },
    sentences: SENTENCES
  })
  assert.equal(seen, '**Slow** - it slows')
})

// ------------------------------------------------------------ the two source pins (see the header)

test('the fire hook runs AFTER the sound and inside a try', () => {
  const src = readFileSync(join(REPO, 'src/main/dataServer/alertsAudio.ts'), 'utf8')
  const sound = src.indexOf('sendToMain(IPC.onAlertFired, firing)')
  const hook = src.indexOf('noteAlertFired(firing)')
  assert.ok(sound > 0, 'the sound send is still the last act of playEngineFire')
  assert.ok(hook > sound, 'the away hook is after it - the sound is the product')
  const between = src.slice(sound, hook)
  assert.ok(between.includes('try {'), 'and it is guarded, so it can never break the fire path')
})

test('the fire hook filters on the selected alert ids and on the away verdict', () => {
  const src = readFileSync(join(REPO, 'src/main/awayAlerts.ts'), 'utf8')
  assert.ok(src.includes('prefs.alertIds.includes(firing.alertId)'), 'only the ticked alerts travel')
  assert.ok(src.includes('!prefs.enabled'), 'and only while the feature is on')
  assert.ok(src.includes('awayNow(prefs)'), 'and only while nobody is at the keyboard')
  // The secret never reaches a log line: this module writes sentences, never a channel or a URL.
  assert.ok(!/logError\([^)]*channel/.test(src), 'no channel is ever logged')
})
