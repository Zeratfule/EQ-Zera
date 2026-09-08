// The LAST SESSION card's pure summary (the "last session" polish).
//
// THE BOUNDARY IS THE THING THIS FILE PINS. `offlineStart`/`offlineEnd` are the absences the LOG
// stated, and a row exists only once the login line that ENDED one has been written. So the
// previous session is bounded by two rows the app can see — `offlineEnd[n-2]` to
// `offlineStart[n-1]` — and a log with fewer than two of them has NO previous session. That is an
// empty state, not a fallback: calling the prologue before the only logout "your last session"
// would be inventing a boundary the log never drew (law 1).
//
// AND COIN IS NEVER CONVERTED. `12p 5g`, never `12.5p`: EverQuest's denomination ladder appears in
// no line the client prints, so a converted total is a number this repo cannot source. A
// denomination no row named is ABSENT from the string, because "the line did not say" is not "you
// got none".
//
// Pure — no Electron, no renderer, no fixtures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LAST_SESSION_ZONE_CAP, coinText, lastSessionView } from '../src/renderer/src/features/overview/lastSession'
import type { ProgressionSnap } from '../src/shared/progressionTypes'
import type { CoinSnap } from '../src/shared/coinTypes'
import type { DeathSnap } from '../src/shared/deathTypes'

const T = 1_700_000_000_000
const MIN = 60_000

const EMPTY: ProgressionSnap = {
  expTs: [], expPct: [], expFlag: [],
  killTs: [], killZone: [], killCredit: [],
  witnessTs: [],
  recentKills: [],
  lootTs: [],
  zoneStart: [], zoneEnd: [], zoneName: [],
  offlineStart: [], offlineEnd: [], offlineCamped: [],
  levelTs: [], levelValue: [], aaGainTs: [], aaGainAmount: [],
  lastTs: 0, windowStart: 0, dropped: 0
}

/**
 * A record with two stated absences around one session:
 *
 *   … [gap A: T+0 → T+10m] ← THE PREVIOUS SESSION, T+10m → T+70m → [gap B: T+70m → T+80m] … now
 */
function record(): ProgressionSnap {
  const t0 = T + 10 * MIN
  const t1 = T + 70 * MIN
  return {
    ...EMPTY,
    offlineStart: [T, T + 70 * MIN],
    offlineEnd: [T + 10 * MIN, T + 80 * MIN],
    offlineCamped: [1, 1],
    // Two kills and one level inside the session, one kill of each outside it.
    killTs: [T + 5 * MIN, t0 + MIN, t0 + 2 * MIN, t1 + 15 * MIN],
    killZone: [-1, 0, 0, -1],
    killCredit: [0, 0, 0, 0],
    // Two experience lines inside, each stating half a level of progress.
    expTs: [t0 + MIN, t0 + 2 * MIN, t1 + 15 * MIN],
    expPct: [25, 25, 90],
    expFlag: [0, 0, 0],
    lootTs: [T + 5 * MIN, t0 + MIN, t0 + 30 * MIN, t0 + 40 * MIN, t1 + 15 * MIN],
    zoneStart: [t0, t0 + 30 * MIN],
    zoneEnd: [t0 + 30 * MIN, 0],
    zoneName: ['Lower Guk', 'Befallen'],
    lastTs: t1 + 20 * MIN
  }
}

const NO_COIN: CoinSnap = { v: 1, rows: [] }
const NO_DEATHS: DeathSnap = { v: 1, recaps: [] }

test('no progression at all is the empty state', () => {
  assert.equal(lastSessionView({ progression: null, coin: null, deaths: null }), null)
})

test('FEWER THAN TWO STATED ABSENCES ⇒ NO PREVIOUS SESSION (never a guessed boundary)', () => {
  assert.equal(lastSessionView({ progression: EMPTY, coin: NO_COIN, deaths: NO_DEATHS }), null)
  const one: ProgressionSnap = { ...EMPTY, offlineStart: [T], offlineEnd: [T + MIN], offlineCamped: [1] }
  assert.equal(lastSessionView({ progression: one, coin: NO_COIN, deaths: NO_DEATHS }), null)
})

test('the range is offlineEnd[n-2] → offlineStart[n-1], and nothing else', () => {
  const view = lastSessionView({ progression: record(), coin: NO_COIN, deaths: NO_DEATHS })
  assert.ok(view)
  assert.equal(view.t0, T + 10 * MIN)
  assert.equal(view.t1, T + 70 * MIN)
  assert.equal(view.durationMs, 60 * MIN)
})

test('the tiles count only what happened INSIDE that range', () => {
  const view = lastSessionView({ progression: record(), coin: NO_COIN, deaths: NO_DEATHS })
  assert.ok(view)
  const by = new Map(view.tiles.map((t) => [t.id, t.value]))
  assert.equal(by.get('duration'), '1h 0m')
  // Two of the four kills; the ones before the session and after it do not count.
  assert.equal(by.get('kills'), '2')
  // Two stated 25% lines = half a level of PROGRESS. Not "you dinged".
  assert.equal(by.get('levels'), '0.50')
  // Three of the five loot instants.
  assert.equal(by.get('drops'), '3')
  assert.equal(by.get('deaths'), '0')
})

test('deaths are counted off the recap ring, in range', () => {
  const deaths: DeathSnap = {
    v: 1,
    recaps: [
      { ts: T + 5 * MIN, windowMs: 15_000, taken: 10, hits: [], byAttacker: [], bySkill: [], resisted: [] },
      { ts: T + 20 * MIN, windowMs: 15_000, taken: 200, hits: [], byAttacker: [], bySkill: [], resisted: [] },
      { ts: T + 40 * MIN, windowMs: 15_000, taken: 300, hits: [], byAttacker: [], bySkill: [], resisted: [] }
    ]
  }
  const view = lastSessionView({ progression: record(), coin: NO_COIN, deaths })
  assert.equal(view?.tiles.find((t) => t.id === 'deaths')?.value, '2')
})

test('the zones are the ones the range covered, capped and then counted', () => {
  const view = lastSessionView({ progression: record(), coin: NO_COIN, deaths: NO_DEATHS })
  assert.ok(view)
  assert.equal(view.zones.includes('Lower Guk'), true)
  assert.equal(view.zones.includes('Befallen'), true)
  assert.equal(LAST_SESSION_ZONE_CAP, 4)
})

// ---- coin: summed per denomination, converted never ---------------------------------------------

test('COIN IS SUMMED PER DENOMINATION AND NEVER CONVERTED', () => {
  const coin: CoinSnap = {
    v: 1,
    rows: [
      { ts: T + 20 * MIN, source: 'sold', platinum: 12 },
      { ts: T + 30 * MIN, source: 'corpse', gold: 3, silver: 4 },
      { ts: T + 40 * MIN, source: 'corpse', gold: 2 }
    ]
  }
  const view = lastSessionView({ progression: record(), coin, deaths: NO_DEATHS })
  assert.equal(view?.coin, '12p 5g 4s')
  // No ladder anywhere: 12p 5g 4s is not 12.54p and is never printed as one.
  assert.equal(view?.coin.includes('.'), false)
})

test('a denomination no row named is ABSENT — "the line did not say" is not "you got none"', () => {
  const coin: CoinSnap = { v: 1, rows: [{ ts: T + 20 * MIN, source: 'corpse', silver: 4 }] }
  assert.equal(coinText(coin, T + 10 * MIN, T + 70 * MIN), '4s')
})

test('coin outside the range is not this session’s coin, and no coin at all says nothing', () => {
  const coin: CoinSnap = { v: 1, rows: [{ ts: T + 5 * MIN, source: 'sold', platinum: 99 }] }
  assert.equal(coinText(coin, T + 10 * MIN, T + 70 * MIN), '')
  assert.equal(coinText(null, T, T + MIN), '')
  assert.equal(lastSessionView({ progression: record(), coin, deaths: NO_DEATHS })?.coin, '')
})

test('no tile value carries an em dash or an en dash (AGENTS.md, JOS-106)', () => {
  const view = lastSessionView({ progression: record(), coin: NO_COIN, deaths: NO_DEATHS })
  assert.ok(view)
  for (const tile of view.tiles) {
    assert.equal(/[—–]/.test(tile.value), false, tile.value)
    assert.equal(/[—–]/.test(tile.label), false, tile.label)
  }
})
