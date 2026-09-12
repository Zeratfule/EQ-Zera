// ============================================================================
// sessionShare.test.mts — shared/sessionShare.ts: the wire shape, the words, the embed.
// ============================================================================
//
// "Share this session" is the fight share applied to a night of play. What is guarded here, and why
// each claim is load-bearing:
//
//   * THE WINDOW IS THE WHOLE POINT. The drop feed this reads is the app's RECENT drops - the newest
//     rows whatever session they belong to - and the combat snapshot holds whatever fight is on
//     screen NOW. A session card that listed tonight's pickups, or ranked tonight's pull, under last
//     night's heading would be the quietest kind of wrong, so both are filtered to `[t0, t1)`.
//   * THERE IS NO EXPERIENCE NUMBER. The log states a level-bar percentage and nothing else, so the
//     card speaks in levels of progress, dings and kills. `levelEquiv` is carried to two decimals -
//     the resolution the Overview card itself prints - and never multiplied into points.
//   * IT IS RE-VALIDATED, because the renderer composes it and main posts it. A body with no
//     duration, a name that is not a string, an infinite rate and a level of 9,001 all have defined
//     answers.
//   * THE EMBED FITS DISCORD. Four inline tiles, the text summary as the description, and the
//     picture named `attachment://session.png` EXACTLY when one travelled - an embed pointing at a
//     file that was not sent renders as a broken image.
//
// No Electron, no network, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DROPS,
  SESSION_CARD_FILE,
  buildSessionShare,
  discordSessionEmbed,
  sanitizeSessionShare,
  sessionDuration,
  sessionShareText,
  type SessionShareInput
} from '../src/shared/sessionShare'

/** Midnight-ish bounds for the fixture session: three hours, ending an hour before "now". */
const T0 = 1_756_000_000_000
const T1 = T0 + 3 * 3_600_000

/** The fixture input: one character, two zones, a ding, three drops and two fights. */
function input(over: Partial<SessionShareInput> = {}): SessionShareInput {
  return {
    character: 'Primitive',
    classes: ['PAL', 'CLR|PAL'],
    level: 42,
    session: { t0: T0, t1: T1, durationMs: T1 - T0, coin: '12p 5g' },
    stats: {
      kills: 412,
      levelEquiv: 2.3149,
      activeMs: 2 * 3_600_000,
      killsPerHourActive: 206.04,
      levelUps: [{ ts: T0 + 1000, level: 41 }, { ts: T0 + 2000, level: 42 }],
      zones: [{ zone: 'Befallen' }, { zone: 'Befallen' }, { zone: 'Guk' }]
    },
    deaths: 1,
    drops: [
      { ts: T0 + 10, item: 'Bone Chips', count: 4 },
      { ts: T0 + 20, item: 'Bone Chips', count: 2 },
      { ts: T0 + 30, item: 'Rusty Dagger' },
      // OUTSIDE the window - tonight's pickup, which must not travel under last night's heading.
      { ts: T1 + 60_000, item: 'Sphinx Claw', count: 9 }
    ],
    fights: [
      { kind: 'fight', name: 'a fire giant warrior', zone: 'Befallen', durationSec: 42, dps: 1204, startTs: T0 + 500 },
      { kind: 'fight', name: 'a decaying skeleton', durationSec: 10, dps: 300, startTs: T0 + 900 },
      // The zone AGGREGATE is not a fight, and it always out-dps-es nothing at all.
      { kind: 'zone', name: 'Befallen', durationSec: 3000, dps: 5000, startTs: T0 + 100 },
      // …and the pull that is open right now belongs to the session you are in, not to this one.
      { kind: 'current', name: 'a sand giant', durationSec: 20, dps: 9999, startTs: T1 + 90_000 }
    ],
    ...over
  }
}

test('buildSessionShare carries the session the card drew', () => {
  const s = buildSessionShare(input())
  assert.equal(s.v, 1)
  assert.equal(s.character, 'Primitive')
  assert.deepEqual(s.classes, ['PAL', 'CLR|PAL'])
  assert.equal(s.level, 42)
  assert.equal(s.t0, T0)
  assert.equal(s.t1, T1)
  assert.equal(s.durationMs, 3 * 3_600_000)
  assert.equal(s.activeMs, 2 * 3_600_000)
  assert.equal(s.kills, 412)
  assert.equal(s.killsPerHour, 206)
  // Two decimals, and "levels of progress" - never an experience number.
  assert.equal(s.levelEquiv, 2.31)
  assert.deepEqual(s.levelUps, [41, 42])
  assert.equal(s.deaths, 1)
  assert.equal(s.coin, '12p 5g')
  // The zone the query grouped twice is named once, in the order it grouped them.
  assert.deepEqual(s.zones, ['Befallen', 'Guk'])
})

test('drops are summed per item, ranked, and clipped to the session window', () => {
  const s = buildSessionShare(input())
  assert.deepEqual(s.drops, [
    { name: 'Bone Chips', count: 6 },
    { name: 'Rusty Dagger', count: 1 }
  ])
  // A line that named no count is one of the thing, which is what the log means by it.
  assert.equal(s.drops.every((d) => d.count >= 1), true)
})

test('the drop list is capped, and the cap keeps the biggest stacks', () => {
  const drops = Array.from({ length: MAX_DROPS + 8 }, (_, i) => ({
    ts: T0 + i,
    item: `Item ${String(i)}`,
    count: i + 1
  }))
  const s = buildSessionShare(input({ drops }))
  assert.equal(s.drops.length, MAX_DROPS)
  assert.equal(s.drops[0].name, `Item ${String(MAX_DROPS + 7)}`)
})

test('the best fight is the fastest REAL fight inside the window, or nothing', () => {
  const s = buildSessionShare(input())
  assert.deepEqual(s.bestFight, {
    name: 'a fire giant warrior',
    dps: 1204,
    durationSec: 42,
    zone: 'Befallen'
  })
  // No segments at all is the COMMON case for a session that ended before the app started.
  assert.equal(buildSessionShare(input({ fights: [] })).bestFight, undefined)
  // …and so is a snapshot holding only fights from the session you are in now.
  const outside = input().fights.filter((f) => f.startTs > T1)
  assert.equal(buildSessionShare(input({ fights: outside })).bestFight, undefined)
})

test('a fact the log never stated is absent, never zero', () => {
  const bare = buildSessionShare({
    session: { t0: 0, t1: 0, durationMs: 60_000, coin: '' },
    stats: { kills: 0, levelEquiv: 0, activeMs: 0, killsPerHourActive: null, levelUps: [], zones: [] },
    deaths: 0,
    drops: [],
    fights: []
  })
  assert.equal(bare.character, undefined)
  assert.equal(bare.level, undefined)
  assert.equal(bare.coin, undefined)
  assert.equal(bare.bestFight, undefined)
  assert.deepEqual(bare.classes, [])
  assert.deepEqual(bare.zones, [])
  assert.equal(bare.killsPerHour, 0)
})

test('sanitizeSessionShare refuses junk and a body with no session in it', () => {
  assert.equal(sanitizeSessionShare(null), null)
  assert.equal(sanitizeSessionShare('EQC1-nope'), null)
  assert.equal(sanitizeSessionShare(42), null)
  assert.equal(sanitizeSessionShare({}), null)
  assert.equal(sanitizeSessionShare({ durationMs: 0, kills: 9 }), null)
  assert.equal(sanitizeSessionShare({ durationMs: -1 }), null)
})

test('sanitizeSessionShare degrades every field rather than losing the post', () => {
  const s = sanitizeSessionShare({
    v: 99,
    character: `Primi\ntive`,
    classes: ['PAL', 'PAL', 17, '', 'ROG', 'BER', 'WAR'],
    level: 9001,
    // Past 2100, so it is not a timestamp at all.
    t0: 99_999_999_999_999,
    t1: T1,
    durationMs: 3 * 3_600_000,
    // An active time larger than the session is a broken caller, not a longer session.
    activeMs: 99 * 3_600_000,
    zones: ['Befallen', 'Befallen'],
    kills: Number.POSITIVE_INFINITY,
    killsPerHour: '206',
    levelEquiv: 2.3149,
    levelUps: [41, 0, -3, 42, 'nope'],
    deaths: 2,
    drops: [{ name: 'Bone Chips', count: 6 }, { name: '' }, 'nope', { name: 'Rusty Dagger' }],
    coin: '12p 5g',
    bestFight: { name: 'a fire giant warrior', dps: 1204, durationSec: 42 },
    somethingElse: 'not copied'
  })
  assert.notEqual(s, null)
  if (s === null) return
  assert.equal(s.v, 1)
  // The newline is what a card row and a code block both break on.
  assert.equal(s.character, 'Primi tive')
  // Capped, de-duplicated, and the non-string never becomes a class.
  assert.deepEqual(s.classes, ['PAL', 'ROG', 'BER', 'WAR'])
  assert.equal(s.level, undefined)
  assert.equal(s.t0, 0)
  assert.equal(s.activeMs, s.durationMs)
  assert.equal(s.kills, 0)
  assert.equal(s.killsPerHour, 0)
  assert.equal(s.levelEquiv, 2.31)
  assert.deepEqual(s.levelUps, [41, 42])
  assert.deepEqual(s.zones, ['Befallen'])
  assert.deepEqual(s.drops, [{ name: 'Bone Chips', count: 6 }, { name: 'Rusty Dagger', count: 1 }])
  assert.deepEqual(s.bestFight, { name: 'a fire giant warrior', dps: 1204, durationSec: 42 })
  assert.equal('somethingElse' in s, false)
})

test('a best fight with no rate at all is not a best fight', () => {
  const s = sanitizeSessionShare({ durationMs: 1000, bestFight: { name: 'a rat', dps: 0 } })
  assert.equal(s?.bestFight, undefined)
})

test('sessionDuration says what a person says', () => {
  assert.equal(sessionDuration(0), '0s')
  assert.equal(sessionDuration(45_000), '45s')
  assert.equal(sessionDuration(45 * 60_000), '45m')
  assert.equal(sessionDuration(3 * 3_600_000 + 12 * 60_000), '3h 12m')
  assert.equal(sessionDuration(50 * 3_600_000), '2d 2h')
})

test('sessionShareText is the summary both the button and the embed read', () => {
  const text = sessionShareText(buildSessionShare(input()))
  const lines = text.split('\n')
  assert.equal(lines[0], 'Primitive (PAL / CLR|PAL) level 42 · 3h 0m in Befallen, Guk')
  assert.equal(lines[1], '412 kills (206/h) · +2.31 levels · 1 death · best fight a fire giant warrior 1,204 DPS')
  assert.equal(lines[2], 'coin: 12p 5g')
  assert.equal(lines[3], 'drops: Bone Chips x6, Rusty Dagger')
  // The word the chat summary is quoted for, and never an experience number.
  assert.equal(text.includes('kills'), true)
  assert.equal(/\bxp\b|experience points/i.test(text), false)
})

test('one death is a death and none is deaths', () => {
  const none = sessionShareText(buildSessionShare(input({ deaths: 0 })))
  assert.equal(none.includes('0 deaths'), true)
  const two = sessionShareText(buildSessionShare(input({ deaths: 2 })))
  assert.equal(two.includes('2 deaths'), true)
})

test('discordSessionEmbed names the attachment exactly when one travelled', () => {
  const s = buildSessionShare(input())
  const withCard = discordSessionEmbed(s, true)
  const embed = withCard.embeds[0]
  assert.equal(embed.title, 'Primitive · 3h 0m session')
  assert.equal(embed.description, sessionShareText(s))
  assert.equal(embed.color, 0x5ee6ff)
  assert.equal(embed.image?.url, `attachment://${SESSION_CARD_FILE}`)
  assert.equal(embed.footer?.text, 'EQ Zera · eqzera.com')
  assert.equal(embed.timestamp, new Date(T1).toISOString())
  assert.deepEqual(
    embed.fields?.map((f) => [f.name, f.value, f.inline]),
    [
      ['Kills', '412', true],
      ['Levels', '+2.31', true],
      ['Deaths', '1', true],
      ['Best DPS', '1,204', true]
    ]
  )
  // A capture that produced nothing posts the numbers ALONE rather than a broken picture.
  assert.equal(discordSessionEmbed(s, false).embeds[0].image, undefined)
})

test('the embed survives a session with nothing in it', () => {
  const s = sanitizeSessionShare({ durationMs: 60_000 })
  assert.notEqual(s, null)
  if (s === null) return
  const embed = discordSessionEmbed(s, false).embeds[0]
  assert.equal(embed.title, '1m session')
  assert.equal(embed.fields?.[3]?.value, '-')
  assert.equal(typeof embed.timestamp, 'string')
})
