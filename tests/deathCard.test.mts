// The DEATH RECAP's pure reading (ROADMAP item 7): the Overview card's view model, and the one
// sentence the live celebration card prints.
//
// WHAT IS PINNED HERE. That the newest recap is the one drawn (`recaps` is newest LAST); that the
// window is quoted rather than re-derived; that the share lists are cut at the card's cap in the
// order the engine published them; that a killer the line did not name is OMITTED and never
// guessed; and that the toast's subtitle DROPS a clause it has no fact for rather than printing a
// placeholder for it.
//
// Pure — no Electron, no renderer, no fixtures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEATH_SHARE_CAP,
  deathCardView,
  deathToastId,
  deathToastText
} from '../src/renderer/src/features/deaths/deathCard'
import { EMPTY_DEATH_SNAP, type DeathRecap, type DeathSnap } from '../src/shared/deathTypes'

const T = 1_700_000_000_000

/** One recap, with only the fields a case cares about spelled out. */
function recap(over: Partial<DeathRecap> = {}): DeathRecap {
  return {
    ts: T,
    killer: 'a fire giant warrior',
    zone: 'Nagafen’s Lair',
    windowMs: 15_000,
    taken: 253,
    hits: [
      { ts: T - 3000, attacker: 'a fire giant warrior', skill: 'bash', amount: 31, crit: false },
      { ts: T - 1000, attacker: 'a fire giant warrior', skill: 'hit', amount: 120, crit: true },
      { ts: T - 500, attacker: 'a fire giant warrior pet', skill: 'bite', amount: 102, crit: false }
    ],
    byAttacker: [
      { name: 'a fire giant warrior', amount: 151, hits: 2 },
      { name: 'a fire giant warrior pet', amount: 102, hits: 1 }
    ],
    bySkill: [
      { name: 'hit', amount: 120, hits: 1 },
      { name: 'bite', amount: 102, hits: 1 },
      { name: 'bash', amount: 31, hits: 1 }
    ],
    resisted: [{ ts: T - 2000, caster: 'King Tranix', spell: 'Heat Blood' }],
    ...over
  }
}

function snap(...recaps: DeathRecap[]): DeathSnap {
  return { v: 1, recaps }
}

test('no snapshot and no deaths both read as the EMPTY STATE, never as a blank card', () => {
  assert.equal(deathCardView(null), null)
  assert.equal(deathCardView(EMPTY_DEATH_SNAP), null)
  assert.equal(deathCardView(snap()), null)
})

test('the card draws the NEWEST recap — `recaps` is newest LAST, and this is an index, not a sort', () => {
  const older = recap({ ts: T - 600_000, killer: 'a sand giant', taken: 40 })
  const view = deathCardView(snap(older, recap()))
  assert.ok(view)
  assert.equal(view.ts, T)
  assert.equal(view.killer, 'a fire giant warrior')
  assert.equal(view.taken, 253)
  // …and the footer counts every death in the log, not just the one on screen.
  assert.equal(view.deaths, 2)
  assert.equal(view.footer, '2 deaths in this log')
})

test('one death says "death", not "deaths" — the footer is a sentence, not a template', () => {
  assert.equal(deathCardView(snap(recap()))?.footer, '1 death in this log')
})

test('the window is QUOTED from the snapshot, in whole seconds', () => {
  assert.equal(deathCardView(snap(recap()))?.windowSec, 15)
  assert.equal(deathCardView(snap(recap({ windowMs: 30_000 })))?.windowSec, 30)
})

test('the hits are drawn NEWEST FIRST — the card reads down from the killing instant', () => {
  const view = deathCardView(snap(recap()))
  assert.ok(view)
  assert.deepEqual(
    view.hits.map((h) => h.amount),
    [102, 120, 31]
  )
  assert.equal(view.hits[1].crit, true)
  // Distinct keys, so two instants in the same millisecond are still two rows.
  assert.equal(new Set(view.hits.map((h) => h.key)).size, view.hits.length)
})

test('the share lists keep the engine’s order and are CUT at the card’s cap', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `skill${String(i)}`, amount: 100 - i, hits: 1 }))
  const view = deathCardView(snap(recap({ bySkill: many })))
  assert.ok(view)
  assert.equal(view.bySkill.length, DEATH_SHARE_CAP)
  assert.deepEqual(
    view.bySkill.map((s) => s.name),
    ['skill0', 'skill1', 'skill2', 'skill3', 'skill4']
  )
  // The attacker list is the same rule, and the two lanes never collide on a key.
  assert.equal(view.byAttacker[0].key.startsWith('att:'), true)
  assert.equal(view.bySkill[0].key.startsWith('skill:'), true)
})

test('an unnamed killer and an unreached zone are ABSENT, never invented (law 1)', () => {
  const bare = recap({ killer: undefined, zone: undefined })
  const view = deathCardView(snap(bare))
  assert.ok(view)
  assert.equal(view.killer, '')
  assert.equal(view.zone, '')
})

test('resists ride along with no amount — a resist is damage-free (law 8)', () => {
  const view = deathCardView(snap(recap()))
  assert.ok(view)
  assert.equal(view.resists.length, 1)
  assert.equal(view.resists[0].spell, 'Heat Blood')
  assert.equal(view.resists[0].caster, 'King Tranix')
  assert.equal('amount' in view.resists[0], false)
})

// ---- the live card's two lines -----------------------------------------------------------------

test('the toast names the killer when the line named one', () => {
  const { title, subtitle } = deathToastText(recap())
  assert.equal(title, 'You died - killed by a fire giant warrior')
  assert.equal(subtitle, '253 damage in the last 15 s · a fire giant warrior · hit')
})

test('…and says only "You died" when it did not', () => {
  assert.equal(deathToastText(recap({ killer: undefined })).title, 'You died')
})

test('a clause with no fact behind it is DROPPED, never printed as a placeholder', () => {
  const quiet = recap({ taken: 0, hits: [], byAttacker: [], bySkill: [], resisted: [] })
  assert.equal(deathToastText(quiet).subtitle, '0 damage in the last 15 s')
  // A caster-less DoT tick files an EMPTY attacker name; an empty name is not a name to print.
  const nameless = recap({
    byAttacker: [{ name: '', amount: 12, hits: 1 }],
    bySkill: [{ name: 'Choking', amount: 12, hits: 1 }]
  })
  assert.equal(deathToastText(nameless).subtitle, '253 damage in the last 15 s · Choking')
})

test('no user-facing string here carries an em dash or an en dash (AGENTS.md, JOS-106)', () => {
  const strings = [deathToastText(recap()).title, deathToastText(recap()).subtitle, deathCardView(snap(recap()))?.footer]
  for (const s of strings) assert.equal(/[—–]/.test(s ?? ''), false, s)
})

test('the dedupe key is the death’s own LOG timestamp', () => {
  assert.equal(deathToastId(recap()), `death:${String(T)}`)
  // Two deaths, two cards — the overlay keys its cards by id.
  assert.notEqual(deathToastId(recap()), deathToastId(recap({ ts: T + 1 })))
})
