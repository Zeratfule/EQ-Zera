// deathCard.ts — THE PURE READING OF A DEATH RECAP: the Overview card's view model, and the one
// sentence the live toast prints.
//
// Two consumers, one module, on purpose. `DeathCard.tsx` draws the last death in full and
// `features/deaths/useDeathToast.ts` announces it in a line; if each built its own words the card
// and the card-that-pops would eventually disagree about who killed you. Everything either of them
// says is decided here, where a node test can read it without Electron.
//
// ── IT NEVER SORTS OR SUMS A SHARED ROW (ruling 4) ────────────────────────────────────────────
//
// `DeathRecap`, `DeathRecapHit` and `DeathRecapShare` are declared in `src/shared/deathTypes.ts`,
// so they are domain data and the renderer may not filter, sort or reduce a list of them. It does
// not have to: the engine already publishes `hits` ascending, `byAttacker`/`bySkill` largest first
// and `recaps` newest last. This module only ever WALKS them with a for-loop and PROJECTS them into
// the row types below, which are its own.
//
// ── WHAT IT REFUSES TO SAY ────────────────────────────────────────────────────────────────────
//
// `taken` is the window's sum and NOT what killed you — the log never prints your hit points, so
// how much of those fifteen seconds you were alive for is unknowable (deathTypes.ts's own header).
// Every string here therefore says "damage in the last 15 s" and never "the damage that killed
// you". A killer the line did not name is omitted, not guessed; a zone the scan had not reached is
// omitted too. There is no fabricated attacker anywhere in this file.

import type { DeathRecap, DeathSnap } from '../../../../shared/deathTypes'
import { formatNum } from '../../lib/formatRate'

/** Most attacker/skill rows the card prints. Beyond five a "share" list stops being a glance. */
export const DEATH_SHARE_CAP = 5

/** One incoming instant, as the card draws it. OUR row type — see the header. */
export interface DeathHitRow {
  /** stable react key: the instant plus its position in the window. */
  key: string
  ts: number
  /** who swung, as the line spelled it; '' for a caster-less DoT tick (never invented). */
  attacker: string
  /** the skill or spell, as the line named it; '' when the line named none. */
  skill: string
  amount: number
  crit: boolean
}

/** One attacker's or one skill's share of the window. */
export interface DeathShareRow {
  key: string
  name: string
  amount: number
  hits: number
}

/** One spell you resisted inside the window. Carries no amount, by law 8. */
export interface DeathResistRow {
  key: string
  ts: number
  caster: string
  spell: string
}

/** The last death, as the Overview card draws it. */
export interface DeathCardView {
  ts: number
  /** '' when the death line named nobody (the killerless `You died.` a DoT tick produces). */
  killer: string
  /** '' before the scan reached a zone line. */
  zone: string
  taken: number
  /** how far back the window reaches, in whole seconds — published so it can be said out loud. */
  windowSec: number
  /** the window, NEWEST FIRST (the card reads down from the killing instant). */
  hits: DeathHitRow[]
  byAttacker: DeathShareRow[]
  bySkill: DeathShareRow[]
  resists: DeathResistRow[]
  /** how many deaths this whole log holds - the footer's number. */
  deaths: number
  /** that number as the footer's sentence. */
  footer: string
}

/** `a fire giant warrior` when the line named one, else ''. */
function nameOf(recap: DeathRecap): string {
  return recap.killer ?? ''
}

/** The window in whole seconds. `windowMs` travels beside `taken` so this is a read, not a guess. */
function windowSecOf(recap: DeathRecap): number {
  return Math.max(0, Math.round(recap.windowMs / 1000))
}

/** The hits, newest first. A for-loop over a shared row type — never `.reverse()` or `.sort()`. */
function hitRows(recap: DeathRecap): DeathHitRow[] {
  const out: DeathHitRow[] = []
  for (let i = recap.hits.length - 1; i >= 0; i--) {
    const h = recap.hits[i]
    out.push({
      key: `${String(h.ts)}:${String(i)}`,
      ts: h.ts,
      attacker: h.attacker,
      skill: h.skill,
      amount: h.amount,
      crit: h.crit
    })
  }
  return out
}

/** The top `DEATH_SHARE_CAP` of a share list, in the order the engine published it. */
function shareRows(shares: DeathRecap['byAttacker'], lane: string): DeathShareRow[] {
  const out: DeathShareRow[] = []
  for (let i = 0; i < shares.length && i < DEATH_SHARE_CAP; i++) {
    const s = shares[i]
    out.push({ key: `${lane}:${s.name}:${String(i)}`, name: s.name, amount: s.amount, hits: s.hits })
  }
  return out
}

function resistRows(recap: DeathRecap): DeathResistRow[] {
  const out: DeathResistRow[] = []
  for (let i = 0; i < recap.resisted.length; i++) {
    const r = recap.resisted[i]
    out.push({ key: `${String(r.ts)}:${String(i)}`, ts: r.ts, caster: r.caster, spell: r.spell })
  }
  return out
}

/** `1 death in this log` / `4 deaths in this log`. */
function footerOf(deaths: number): string {
  return `${String(deaths)} ${deaths === 1 ? 'death' : 'deaths'} in this log`
}

/**
 * The newest recap as a card, or null when the log holds no death at all (the empty state) — and
 * null too while the module has said nothing yet, which the card draws the same way because
 * "no deaths" is the honest reading of both for a HISTORY surface.
 */
export function deathCardView(snap: DeathSnap | null): DeathCardView | null {
  if (!snap || snap.recaps.length === 0) return null
  // `recaps` is newest LAST (deathTypes.ts) — an index, not a sort.
  const recap = snap.recaps[snap.recaps.length - 1]
  return {
    ts: recap.ts,
    killer: nameOf(recap),
    zone: recap.zone ?? '',
    taken: recap.taken,
    windowSec: windowSecOf(recap),
    hits: hitRows(recap),
    byAttacker: shareRows(recap.byAttacker, 'att'),
    bySkill: shareRows(recap.bySkill, 'skill'),
    resists: resistRows(recap),
    deaths: snap.recaps.length,
    footer: footerOf(snap.recaps.length)
  }
}

/** The two lines the celebration card prints. */
export interface DeathToastText {
  title: string
  subtitle: string
}

/**
 * What the live card says about one death.
 *
 * THE TITLE NAMES THE KILLER ONLY WHEN THE LINE DID. `You died` is the whole title for the
 * killerless shape; anything else would be the card picking a mob out of the context (law 1).
 *
 * THE SUBTITLE IS A LIST OF WHAT IS KNOWN, joined with the app's own separator: the window's
 * damage, then the attacker who dealt the most of it, then the skill that dealt the most. A clause
 * whose fact is missing is DROPPED - never printed as a dash, and never filled in from a
 * neighbour.
 */
export function deathToastText(recap: DeathRecap): DeathToastText {
  const killer = nameOf(recap)
  const parts: string[] = [`${formatNum(recap.taken)} damage in the last ${String(windowSecOf(recap))} s`]
  const topAttacker = recap.byAttacker[0]
  if (topAttacker && topAttacker.name !== '') parts.push(topAttacker.name)
  const topSkill = recap.bySkill[0]
  if (topSkill && topSkill.name !== '') parts.push(topSkill.name)
  return {
    title: killer === '' ? 'You died' : `You died - killed by ${killer}`,
    subtitle: parts.join(' · ')
  }
}

/** The card's dedupe key. The death's own log timestamp, so a replayed beat refreshes one card. */
export function deathToastId(recap: DeathRecap): string {
  return `death:${String(recap.ts)}`
}
