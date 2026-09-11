// ============================================================================
// fightShare.test.mts — shared/fightShare.ts: the wire shape, the words, the embed.
// ============================================================================
//
// The owner's ask (2026-09-11): *"We should also make the Discord sharing be able to have DPS meter
// sharing also."* What is guarded here, and why each claim is load-bearing:
//
//   * THE RANKING AND THE CAP. A share is damage-descending and cut at 24 from the BOTTOM, so what
//     a raid loses is always the smallest contribution - never an arbitrary 24 of them.
//   * SHARE IS A SHARE OF THE FIGHT. `SourceView.pct` is a BAR FILL (a fraction of the largest
//     row), and reading it as a percentage of the fight would have printed 100% beside the top row
//     of every pull in the app's own channel. The shares sum to ~1 because they are computed from
//     the fight's own total.
//   * IT IS RE-VALIDATED, because the renderer composes it and main posts it. A body with no rows,
//     a name that is not a string, an infinite dps and a share of 40 all have defined answers.
//   * THE EMBED FITS DISCORD. Every string is cut to Discord's own ceiling, the row block is capped
//     with an honest `+N more`, and the picture is named `attachment://fight.png` EXACTLY when one
//     travelled - an embed pointing at a file that was not sent renders as a broken image.
//
// No Electron, no network, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_EMBED_ROWS,
  MAX_MEMBERS,
  buildFightShare,
  discordFightEmbed,
  fightClock,
  fightShareText,
  sanitizeFightShare,
  type FightShare
} from '../src/shared/fightShare'
import type { SegmentView, SourceView } from '../src/shared/combat'

/** One meter row, with only the fields a share reads spelled out. */
function source(name: string, kind: SourceView['kind'], total: number, dps: number): SourceView {
  return {
    id: `s:${name}`,
    name,
    kind,
    total,
    dps,
    // A BAR FILL, deliberately wrong as a share of the fight - see the header. Every row claims to
    // be the biggest, which is what `pct` says when there is one row in a category.
    pct: 100,
    hits: 1,
    crits: 0,
    critPct: 0,
    ambiguousHits: 0,
    ambiguousTotal: 0,
    misses: 0,
    hitPct: 100,
    missBreakdown: {} as unknown as SourceView['missBreakdown'],
    resists: 0,
    resistPct: 0,
    skills: [],
    categories: []
  }
}

/** The fixture fight: you, your pet, a group-mate, on a named mob in a named zone. */
const ENTITIES: SourceView[] = [
  source('Zeratfule', 'you', 31204, 471),
  source('Gorak', 'pet', 12000, 181.2),
  source('Marikel', 'member', 5000, 75.5)
]

function segment(over: Partial<SegmentView> = {}): SegmentView {
  return {
    id: 'e7',
    kind: 'fight',
    name: 'a dark elf priest',
    zone: 'Befallen',
    durationSec: 66,
    active: false,
    activeSec: 60,
    outTotal: 48204,
    outDps: 730,
    activeDps: 803,
    entities: ENTITIES,
    inTotal: 0,
    inDps: 0,
    incoming: [],
    enemyHealTotal: 0,
    incomingHealTotal: 0,
    incomingHealers: [],
    healing: {} as unknown as SegmentView['healing'],
    defense: {} as unknown as SegmentView['defense'],
    procs: {} as unknown as SegmentView['procs'],
    ...over
  }
}

const STARTED_AT = 1_757_600_000_000
const FIGHT: FightShare = buildFightShare(segment(), STARTED_AT)

// ---- the build ---------------------------------------------------------------------------------

test('a fight carries the mob, the zone, the clock and the total the fold stated', () => {
  assert.equal(FIGHT.v, 1)
  assert.equal(FIGHT.mob, 'a dark elf priest')
  assert.equal(FIGHT.zone, 'Befallen')
  assert.equal(FIGHT.startedAt, STARTED_AT)
  assert.equal(FIGHT.durationMs, 66_000)
  assert.equal(FIGHT.totalDamage, 48_204)
})

test('members are ranked by damage, and each knows what it is', () => {
  assert.deepEqual(
    FIGHT.members.map((m) => m.name),
    ['Zeratfule', 'Gorak', 'Marikel']
  )
  assert.equal(FIGHT.members[0]?.isYou, true)
  assert.equal(FIGHT.members[0]?.pet, undefined, 'you are not a pet')
  assert.equal(FIGHT.members[1]?.pet, true)
  assert.equal(FIGHT.members[2]?.pet, undefined, 'a group-mate is not a pet either')
})

test('SHARE IS A SHARE OF THE FIGHT, never SourceView.pct, and the shares add up', () => {
  // Every fixture row claims `pct: 100`. If that had been read as a share, the top row alone would
  // say 100% - which is the defect this assertion exists to make impossible.
  assert.ok((FIGHT.members[0]?.share ?? 0) < 0.7, String(FIGHT.members[0]?.share))
  const sum = FIGHT.members.reduce((a, m) => a + m.share, 0)
  assert.ok(Math.abs(sum - 1) < 0.001, `shares sum to ${String(sum)}`)
})

test('your own two numbers are lifted out of your row', () => {
  assert.equal(FIGHT.you.dps, 471)
  assert.ok(Math.abs(FIGHT.you.share - 31204 / 48204) < 1e-9)
})

test('…and are HONESTLY ZERO when you landed nothing, rather than borrowing the top row', () => {
  const theirs = buildFightShare(segment({ entities: [ENTITIES[1] as SourceView] }), STARTED_AT)
  assert.deepEqual(theirs.you, { dps: 0, share: 0 })
})

test('a fight with no total states no shares rather than dividing by zero', () => {
  const empty = buildFightShare(segment({ outTotal: 0 }), STARTED_AT)
  assert.deepEqual(
    empty.members.map((m) => m.share),
    [0, 0, 0]
  )
  // The RATE is still the fold's own number: a segment that states a dps and a zero total is
  // saying something odd, and the share is the only part this file is entitled to answer with 0.
  assert.deepEqual(empty.you, { dps: 471, share: 0 })
})

test('a zone the log never stated is simply not said', () => {
  const nowhere = buildFightShare(segment({ zone: undefined }), STARTED_AT)
  assert.equal(nowhere.zone, undefined)
  assert.ok(!Object.prototype.hasOwnProperty.call(nowhere, 'zone'))
})

test('the member list is capped, and the cut is from the BOTTOM of the ranking', () => {
  const many: SourceView[] = []
  for (let i = 0; i < MAX_MEMBERS + 9; i += 1) many.push(source(`Ally${String(i)}`, 'member', 1000 - i, 10))
  const big = buildFightShare(segment({ entities: many, outTotal: 30_000 }), STARTED_AT)
  assert.equal(big.members.length, MAX_MEMBERS)
  assert.equal(big.members[0]?.name, 'Ally0', 'the biggest contributor survives')
  assert.equal(big.members.at(-1)?.name, `Ally${String(MAX_MEMBERS - 1)}`, 'the smallest ones are what go')
})

test('a name with a newline in it is one line by the time it is drawn', () => {
  const dirty = buildFightShare(segment({ entities: [source('Zera\nfule', 'you', 10, 1)] }), STARTED_AT)
  assert.equal(dirty.members[0]?.name, 'Zera fule')
})

// ---- the re-check at the handler ---------------------------------------------------------------

test('main re-validates what the renderer composed', () => {
  const clean = sanitizeFightShare({
    v: 1,
    mob: 'a dark elf priest',
    startedAt: -4,
    durationMs: Number.POSITIVE_INFINITY,
    totalDamage: 100,
    members: [
      { name: 'Zeratfule', damage: 60, dps: Number.NaN, share: 40, isYou: true },
      { name: 42, damage: 1, dps: 1, share: 1 },
      { name: 'Gorak', damage: 40, dps: 3.14159, share: 0.4, pet: true }
    ],
    you: { dps: -1, share: 0.6 },
    somethingElse: 'dropped'
  })
  assert.ok(clean)
  assert.equal(clean.startedAt, 0, 'a negative timestamp is no timestamp')
  assert.equal(clean.durationMs, 0, 'and an infinite duration is no duration')
  assert.equal(clean.members.length, 2, 'a row with no name is not a row')
  assert.equal(clean.members[0]?.dps, 0)
  assert.equal(clean.members[0]?.share, 1, 'a share of 40 is clamped, not believed')
  assert.equal(clean.members[1]?.dps, 3.1)
  assert.equal(clean.you.dps, 0)
  assert.ok(!Object.prototype.hasOwnProperty.call(clean, 'somethingElse'))
})

test('…and refuses a body there is nothing to post about', () => {
  assert.equal(sanitizeFightShare(null), null)
  assert.equal(sanitizeFightShare('a fight'), null)
  assert.equal(sanitizeFightShare({ mob: 'x', members: [] }), null)
  assert.equal(sanitizeFightShare({ mob: 'x' }), null)
})

test('a fight that survives the build survives the re-check unchanged in every number', () => {
  const again = sanitizeFightShare(JSON.parse(JSON.stringify(FIGHT)))
  assert.ok(again)
  assert.equal(again.totalDamage, FIGHT.totalDamage)
  assert.equal(again.members.length, FIGHT.members.length)
  assert.equal(again.members[0]?.damage, FIGHT.members[0]?.damage)
})

// ---- the words ----------------------------------------------------------------------------------

test('the clock is m:ss, the one spelling every combat surface uses', () => {
  assert.equal(fightClock(66_000), '1:06')
  assert.equal(fightClock(0), '0:00')
  assert.equal(fightClock(3_723_000), '62:03')
})

test('the text summary is a headline and one line per member', () => {
  const lines = fightShareText(FIGHT).split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[0], 'a dark elf priest · Befallen · 1:06 · 48,204 damage')
  assert.equal(lines[1], '1. Zeratfule 31,204 (471 dps, 65%)')
  assert.equal(lines[2], '2. Gorak 12,000 (181 dps, 25%)')
  assert.equal(lines[3], '3. Marikel 5,000 (76 dps, 10%)')
})

// ---- the embed -----------------------------------------------------------------------------------

test('the embed titles the fight, tiles your numbers and signs itself', () => {
  const body = discordFightEmbed(FIGHT, true)
  assert.equal(body.username, 'EQ Zera')
  assert.equal(body.content, '', 'the embed IS the message')
  const embed = body.embeds[0]
  assert.ok(embed)
  assert.equal(embed.title, 'a dark elf priest · 1:06 · 48,204 damage')
  assert.equal(embed.color, 0xff6b6b)
  assert.equal(embed.footer.text, 'EQ Zera · eqzera.com')
  assert.equal(embed.timestamp, new Date(STARTED_AT).toISOString())
  assert.equal(embed.url, undefined, 'a fight is not a link - Discord refuses an empty one')
  assert.deepEqual(
    embed.fields.map((f) => [f.name, f.value, f.inline]),
    [
      ['Your DPS', '471 dps', true],
      ['Your share', '65%', true],
      ['Duration', '1:06', true]
    ]
  )
  assert.ok(embed.description.startsWith('```\n1. Zeratfule'), embed.description)
  assert.ok(embed.description.endsWith('\n```'))
})

test('the attachment is named EXACTLY when one travelled', () => {
  assert.deepEqual(discordFightEmbed(FIGHT, true).embeds[0]?.image, { url: 'attachment://fight.png' })
  const alone = discordFightEmbed(FIGHT, false).embeds[0]
  assert.ok(alone)
  assert.equal(alone.image, undefined, 'an embed naming a file that was not sent draws as broken')
  assert.ok(!Object.prototype.hasOwnProperty.call(alone, 'image'))
})

test('a fight with more rows than the embed can hold says how many more', () => {
  const many: SourceView[] = []
  for (let i = 0; i < MAX_MEMBERS; i += 1) many.push(source(`Ally${String(i)}`, 'member', 1000 - i, 10))
  const big = buildFightShare(segment({ entities: many, outTotal: 30_000 }), STARTED_AT)
  const rows = (discordFightEmbed(big, true).embeds[0]?.description ?? '').split('\n')
  // The fence, the capped rows, the tail, the fence.
  assert.equal(rows.length, MAX_EMBED_ROWS + 3)
  assert.equal(rows.at(-2), `+${String(MAX_MEMBERS - MAX_EMBED_ROWS)} more`)
})

test('every string in the embed is inside Discord’s own ceilings', () => {
  const long = 'x'.repeat(400)
  const huge = buildFightShare(segment({ name: long, entities: [source(long, 'you', 10, 1)] }), STARTED_AT)
  const embed = discordFightEmbed(huge, true).embeds[0]
  assert.ok(embed)
  assert.ok(embed.title.length <= 256, String(embed.title.length))
  assert.ok(embed.description.length <= 4096)
  for (const field of embed.fields) {
    assert.ok(field.name.length <= 256)
    assert.ok(field.value.length <= 1024)
  }
  assert.ok(embed.footer.text.length <= 2048)
})

test('a fight that never stated a start timestamps itself at the moment of posting', () => {
  const before = Date.now()
  const stamp = discordFightEmbed({ ...FIGHT, startedAt: 0 }, false).embeds[0]?.timestamp ?? ''
  const at = new Date(stamp).getTime()
  assert.ok(at >= before && at <= Date.now() + 1000, stamp)
})
