// ============================================================================
// celebrationPost.test.mts — shared/celebrationPost.ts, the celebration mirror.
// ============================================================================
//
// The feature is one switch: every card the celebration overlay shows also becomes a message in a
// connected Discord channel. The clock, the transport and the channel lookup are INJECTED, so every
// claim below is made with no network, no store, no Electron and no waiting.
//
// What is guarded, and why each one is load-bearing:
//
//   * THE POSTABLE LIST IS SIX MEMBERS AND THE UNION IS NINE. 'intro' is the overlay introducing
//     itself, 'update' is the updater, and 'wishZone' is a nag about where you are standing - none
//     of them is something that HAPPENED, and any of them reaching a guild channel is the feature
//     being embarrassing in public. The list is a constant here, checked against `ToastKind` by the
//     type system and against itself by the sanitizer.
//   * WHAT IS READ BACK IS RE-VALIDATED. A store file is a file on a disk somebody else can also
//     write to (storeDiscord.ts's law): an unknown kind, a channel id outside the closed class and
//     a blob that is not an object at all all degrade to something the app can run on.
//   * THE EMBED CARRIES TEXT AND NEVER A PICTURE. The item icons are `eqimg://` URLs out of a local
//     cache that Discord cannot fetch, and an embed naming a picture nobody can load renders as a
//     broken one. So: no `image`, no `url`, one colour per kind, the shared footer, and the
//     timestamp of the MOMENT THE CARD HAPPENED rather than of the send.
//   * SPACING AND DEDUPE ARE THE WHOLE DIFFERENCE between a feature and a rate-limited webhook.
//     A Sky completion can fire three cards in one tick, and a repeat id refreshes a card in place
//     on the overlay while a channel just gets the same message twice.
//   * A FAILURE IS ONE SENTENCE, AND NOTHING THROWS. These outcomes reach a Preferences card over
//     IPC; a switch that silently posts nothing is indistinguishable from a broken one, and a
//     rejected promise on a detached send would be an unhandled rejection in the main process.
//
// No Electron, no network, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CELEBRATION_DEDUPE_MS,
  CELEBRATION_EMBED_COLOR,
  CELEBRATION_KIND_LABEL,
  CELEBRATION_POST_KINDS,
  CELEBRATION_POST_SPACING_MS,
  DEFAULT_CELEBRATION_POST,
  celebrationEmbed,
  createCelebrationQueue,
  isCelebrationPostKind,
  mergeCelebrationPostPrefs,
  sanitizeCelebrationPostPrefs,
  shouldPostCelebration,
  type CelebrationPostKind,
  type CelebrationPostOutcome,
  type CelebrationPostPrefs
} from '../src/shared/celebrationPost'
import type { DiscordWebhookBody } from '../src/shared/discordWebhook'
import type { ToastPayload } from '../src/shared/toast'

/** A well-formed webhook id - the closed class `channelId` is held to. */
const CHANNEL = '1234567890123456789'

/** One card, with only the fields a test cares about spelled out. */
function card(over: Partial<ToastPayload> = {}): ToastPayload {
  return { id: 't1', kind: 'levelUp', title: 'Level 42', durationMs: 6000, ...over }
}

// ────────────────────────────────────────────────────────────── the kinds and the sanitizer

test('the postable kinds are the six celebrations, and not the three that are not', () => {
  assert.deepEqual([...CELEBRATION_POST_KINDS], [
    'levelUp',
    'bossKill',
    'skyQuestComplete',
    'questItem',
    'wishDrop',
    'death'
  ])
  for (const kind of ['intro', 'update', 'wishZone']) {
    assert.equal(isCelebrationPostKind(kind), false, `${kind} must never be postable`)
  }
  assert.equal(isCelebrationPostKind('levelUp'), true)
  assert.equal(isCelebrationPostKind(42), false)
  // Every kind draws a checkbox and a colour; a seventh kind with neither is a silent blank.
  for (const kind of CELEBRATION_POST_KINDS) {
    assert.equal(typeof CELEBRATION_KIND_LABEL[kind], 'string')
    assert.equal(typeof CELEBRATION_EMBED_COLOR[kind], 'number')
  }
})

test('the shipped default is OFF, with deaths and quest items opt-in', () => {
  assert.equal(DEFAULT_CELEBRATION_POST.enabled, false)
  assert.deepEqual(DEFAULT_CELEBRATION_POST.kinds, ['levelUp', 'bossKill', 'skyQuestComplete', 'wishDrop'])
  assert.equal(DEFAULT_CELEBRATION_POST.channelId, undefined)
})

test('an absent, junk or partial blob reads as the shipped default', () => {
  for (const raw of [undefined, null, 42, 'on', [], { kinds: 'all' }]) {
    const prefs = sanitizeCelebrationPostPrefs(raw)
    assert.equal(prefs.enabled, false)
    assert.deepEqual(prefs.kinds, DEFAULT_CELEBRATION_POST.kinds)
  }
  // …and the default's own array is never handed out by reference.
  const one = sanitizeCelebrationPostPrefs(undefined)
  one.kinds.push('death')
  assert.deepEqual(sanitizeCelebrationPostPrefs(undefined).kinds, DEFAULT_CELEBRATION_POST.kinds)
})

test('a stored blob is re-validated: unknown kinds, duplicates and a bad channel id are dropped', () => {
  const prefs = sanitizeCelebrationPostPrefs({
    enabled: true,
    channelId: 'not-a-webhook-id',
    kinds: ['death', 'levelUp', 'death', 'wishZone', 'update', 7]
  })
  assert.equal(prefs.enabled, true)
  assert.equal(prefs.channelId, undefined, 'an id outside the class degrades to the default channel')
  assert.deepEqual(prefs.kinds, ['levelUp', 'death'], 'deduped and in the card’s own order')
})

test('an EMPTY kinds list is a statement and survives; a non-array is not', () => {
  assert.deepEqual(sanitizeCelebrationPostPrefs({ enabled: true, kinds: [] }).kinds, [])
  assert.deepEqual(sanitizeCelebrationPostPrefs({ enabled: true }).kinds, DEFAULT_CELEBRATION_POST.kinds)
})

test('a merge-patch changes only what it names', () => {
  const base: CelebrationPostPrefs = { enabled: true, channelId: CHANNEL, kinds: ['levelUp'] }
  assert.deepEqual(mergeCelebrationPostPrefs({ enabled: false }, base), {
    enabled: false,
    channelId: CHANNEL,
    kinds: ['levelUp']
  })
  assert.deepEqual(mergeCelebrationPostPrefs({ kinds: ['death', 'bossKill'] }, base).kinds, ['bossKill', 'death'])
  // NAMING the channel with something unusable CLEARS it; not naming it keeps it.
  assert.equal(mergeCelebrationPostPrefs({ channelId: null }, base).channelId, undefined)
  assert.equal(mergeCelebrationPostPrefs({}, base).channelId, CHANNEL)
  assert.equal(mergeCelebrationPostPrefs('nonsense', base).channelId, CHANNEL)
})

// ──────────────────────────────────────────────────────────────────────── shouldPostCelebration

test('shouldPostCelebration: enabled, postable and chosen - in that order', () => {
  const on: CelebrationPostPrefs = { enabled: true, kinds: ['levelUp', 'death'] }
  const off: CelebrationPostPrefs = { enabled: false, kinds: ['levelUp'] }
  const matrix: [CelebrationPostPrefs, ToastPayload['kind'], boolean][] = [
    [on, 'levelUp', true],
    [on, 'death', true],
    [on, 'bossKill', false],
    [on, 'wishZone', false],
    [on, 'intro', false],
    [on, 'update', false],
    [off, 'levelUp', false],
    [{ enabled: true, kinds: [] }, 'levelUp', false]
  ]
  for (const [prefs, kind, want] of matrix) {
    assert.equal(shouldPostCelebration(prefs, card({ kind })), want, `${kind} under ${String(prefs.enabled)}`)
  }
})

// ──────────────────────────────────────────────────────────────────────────────── the embed

test('the embed is the card, in text: title, the lines under it, the kind colour, the footer', () => {
  const at = Date.UTC(2026, 8, 12, 3, 4, 5)
  const body = celebrationEmbed(
    card({
      kind: 'skyQuestComplete',
      title: 'Quest complete: Test of Sacrifice',
      subtitle: 'Plane of Sky',
      item: { name: 'Shroud of Veeshan', iconId: 12, lines: ['MAGIC ITEM'] },
      quests: [
        { name: 'Test of Sacrifice', page: 'Test_of_Sacrifice', role: 'reward', steps: [], before: 0, after: 0 },
        { name: 'Trial of Fear', page: 'Trial_of_Fear', role: 'required', steps: [], before: 0, after: 0 }
      ]
    }),
    at
  )
  const embed = body.embeds[0]
  assert.ok(embed !== undefined)
  assert.equal(embed.title, 'Quest complete: Test of Sacrifice')
  assert.equal(embed.description, 'Plane of Sky\nShroud of Veeshan\nQuest: Test of Sacrifice\nQuest: Trial of Fear')
  assert.equal(embed.color, CELEBRATION_EMBED_COLOR.skyQuestComplete)
  assert.equal(embed.footer.text, 'EQ Zera · eqzera.com')
  assert.equal(embed.timestamp, new Date(at).toISOString())
  assert.deepEqual(embed.fields, [])
  assert.equal(embed.image, undefined, 'an eqimg:// icon is not reachable by Discord')
  assert.equal(embed.url, undefined, 'a celebration is not a link to anywhere')
  assert.equal(body.content, '', 'the embed IS the message')
})

test('each kind wears its own colour, and a card with nothing under the title says nothing', () => {
  const seen = new Set<number>()
  for (const kind of CELEBRATION_POST_KINDS) {
    const embed = celebrationEmbed(card({ kind }), 0).embeds[0]
    assert.ok(embed !== undefined)
    assert.equal(embed.color, CELEBRATION_EMBED_COLOR[kind as CelebrationPostKind])
    assert.equal(embed.description, '')
    seen.add(embed.color)
  }
  assert.equal(seen.size, CELEBRATION_POST_KINDS.length, 'six kinds, six distinct colours')
})

test('every string is cut to Discord’s ceiling', () => {
  const embed = celebrationEmbed(card({ title: 'x'.repeat(400), subtitle: 'y'.repeat(5000) }), 0).embeds[0]
  assert.ok(embed !== undefined)
  assert.equal(embed.title.length, 256)
  assert.equal(embed.description.length, 4096)
})

// ──────────────────────────────────────────────────────────────────────────────── the queue

/** A driven queue: a clock the test moves, a transport it reads, and a scheduler it fires. */
function harness(prefs: CelebrationPostPrefs, opts: { channel?: boolean; outcome?: CelebrationPostOutcome } = {}) {
  const posted: { body: DiscordWebhookBody; channelId?: string }[] = []
  const timers: { fn: () => void; ms: number }[] = []
  let now = 1_000_000
  let outcome: CelebrationPostOutcome = opts.outcome ?? { ok: true }
  const queue = createCelebrationQueue({
    now: () => now,
    prefs: () => prefs,
    configured: () => true,
    hasChannel: () => opts.channel !== false,
    post: (body, channelId) => {
      posted.push({ body, ...(channelId === undefined ? {} : { channelId }) })
      return Promise.resolve(outcome)
    },
    unsetError: 'Connect a Discord channel in Preferences, Sharing.',
    schedule: (fn, ms) => timers.push({ fn, ms })
  })
  return {
    queue,
    posted,
    timers,
    at: (t: number) => {
      now = 1_000_000 + t
    },
    fails: (error: string) => {
      outcome = { ok: false, error }
    },
    /** let the detached `.then` in `send` run */
    settle: () => new Promise((r) => setTimeout(r, 0))
  }
}

const ALL_ON: CelebrationPostPrefs = { enabled: true, kinds: [...CELEBRATION_POST_KINDS] }

test('a card the prefs do not want never reaches the transport', async () => {
  const h = harness({ enabled: true, kinds: ['bossKill'] })
  h.queue.offer(card({ kind: 'levelUp' }))
  h.queue.offer(card({ kind: 'wishZone' }))
  await h.settle()
  assert.equal(h.posted.length, 0)
  assert.equal(h.queue.view().lastError, undefined, 'a card nobody asked for is not a failure')
})

test('a dark build refuses before it reads a preference', async () => {
  const posted: unknown[] = []
  const queue = createCelebrationQueue({
    now: () => 0,
    prefs: () => ALL_ON,
    configured: () => false,
    hasChannel: () => true,
    post: (body) => {
      posted.push(body)
      return Promise.resolve<CelebrationPostOutcome>({ ok: true })
    },
    unsetError: 'unset',
    schedule: (fn) => fn()
  })
  queue.offer(card())
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(posted.length, 0)
  assert.equal(queue.view().lastError, undefined, 'a dark build does not accumulate complaints')
})

test('no connected channel records the sentence and posts nothing', async () => {
  const h = harness(ALL_ON, { channel: false })
  h.queue.offer(card())
  await h.settle()
  assert.equal(h.posted.length, 0)
  assert.equal(h.queue.view().lastError, 'Connect a Discord channel in Preferences, Sharing.')
  assert.equal(h.queue.view().lastErrorAt, 1_000_000)
})

test('posts are spaced, and the third one waits twice as long', async () => {
  const h = harness(ALL_ON)
  h.queue.offer(card({ id: 'a', title: 'Level 42' }))
  h.queue.offer(card({ id: 'b', title: 'Level 43' }))
  h.queue.offer(card({ id: 'c', title: 'Level 44' }))
  await h.settle()
  assert.equal(h.posted.length, 1, 'the first goes out at once')
  assert.deepEqual(h.timers.map((t) => t.ms), [CELEBRATION_POST_SPACING_MS, CELEBRATION_POST_SPACING_MS * 2])
  for (const timer of h.timers) timer.fn()
  await h.settle()
  assert.equal(h.posted.length, 3)
  assert.deepEqual(
    h.posted.map((p) => p.body.embeds[0]?.title),
    ['Level 42', 'Level 43', 'Level 44'],
    'in the order they happened'
  )
})

test('a card offered after the slot has passed goes out at once', async () => {
  const h = harness(ALL_ON)
  h.queue.offer(card({ id: 'a', title: 'Level 42' }))
  h.at(CELEBRATION_POST_SPACING_MS + 1)
  h.queue.offer(card({ id: 'b', title: 'Level 43' }))
  await h.settle()
  assert.equal(h.posted.length, 2)
  assert.equal(h.timers.length, 0)
})

test('the same card twice inside a minute is said once, and again after it', async () => {
  const h = harness(ALL_ON)
  const again = card({ id: 'x1', kind: 'bossKill', title: 'Lord Nagafen defeated', subtitle: 'D4 · Fused' })
  h.queue.offer(again)
  h.at(30_000)
  // A DIFFERENT id, the SAME words - which is all anybody reading the channel can see.
  h.queue.offer({ ...again, id: 'x2' })
  await h.settle()
  for (const timer of h.timers) timer.fn()
  await h.settle()
  assert.equal(h.posted.length, 1, 'the repeat inside the window is dropped')

  h.at(CELEBRATION_DEDUPE_MS + 1)
  h.queue.offer({ ...again, id: 'x3' })
  await h.settle()
  assert.equal(h.posted.length, 2, 'past the window it is news again')
})

test('a different subtitle is a different card', async () => {
  const h = harness(ALL_ON)
  h.queue.offer(card({ kind: 'bossKill', title: 'Maestro of Rancor defeated', subtitle: 'D1' }))
  h.queue.offer(card({ kind: 'bossKill', title: 'Maestro of Rancor defeated', subtitle: 'D4' }))
  await h.settle()
  for (const timer of h.timers) timer.fn()
  await h.settle()
  assert.equal(h.posted.length, 2)
})

test('a failed post keeps the sentence, never throws, and the next success clears it', async () => {
  const h = harness(ALL_ON)
  h.fails('Discord is rate limiting this webhook. Try again in a moment.')
  h.queue.offer(card({ title: 'Level 42' }))
  await h.settle()
  assert.equal(h.posted.length, 1)
  assert.equal(h.queue.view().lastError, 'Discord is rate limiting this webhook. Try again in a moment.')
  assert.equal(h.queue.view().lastErrorAt, 1_000_000)

  h.fails('')
  const ok = harness(ALL_ON)
  ok.queue.offer(card({ title: 'Level 43' }))
  await ok.settle()
  assert.equal(ok.queue.view().lastError, undefined, 'a post that lands is not a failure report')
})

test('a transport that rejects is still just a sentence', async () => {
  const queue = createCelebrationQueue({
    now: () => 5,
    prefs: () => ALL_ON,
    configured: () => true,
    hasChannel: () => true,
    post: () => Promise.reject(new Error('fetch failed')),
    unsetError: 'Could not reach Discord.',
    schedule: (fn) => fn()
  })
  queue.offer(card())
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(queue.view().lastError, 'Could not reach Discord.')
  assert.equal(queue.view().lastErrorAt, 5)
})

test('the view carries the prefs main actually holds', () => {
  const h = harness({ enabled: true, channelId: CHANNEL, kinds: ['levelUp'] })
  assert.deepEqual(h.queue.view().prefs, { enabled: true, channelId: CHANNEL, kinds: ['levelUp'] })
})

test('the chosen channel rides with the post', async () => {
  const h = harness({ enabled: true, channelId: CHANNEL, kinds: ['levelUp'] })
  h.queue.offer(card())
  await h.settle()
  assert.equal(h.posted[0]?.channelId, CHANNEL)
})
