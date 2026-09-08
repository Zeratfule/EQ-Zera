// Pure, renderer-side shaping for the DEFENSIVE panel (JOS-354, user report
// 01KZZ1X6B3A82XF1PQ238EPP82 — "Is it currently possible to see how often I'm blocking, dodging,
// parrying, or reposting?").
//
// No JSX, no MUI, and a RELATIVE type-only borrow of the shared model — the same surface
// procRows.ts and dashboardData.ts present, so node tests can exercise it without the renderer's
// `@shared` value alias.
//
// EVERY NUMBER COMES OFF `DefenseView` UNCHANGED. The engine already divided by the one honest
// denominator (melee swings aimed at you), so nothing here re-derives a rate: this module decides
// only what is SHOWN and what each row is called.
//
// THE FOUR ACTIVE DEFENCES ALWAYS DRAW, EVEN AT ZERO. A rogue with no shield wants to see that
// `Block 0` is his real answer rather than wonder whether the app forgot to look — the same
// argument JOS-113 made for showing `0% crit` on an ability that never crit. The two outcomes that
// are NOT skills of yours (the mob's own whiff, and a rune eating the blow) draw only when they
// happened, because a zero there says nothing about you at all.
//
// …AND THEY ARE STACK-RANKED (JOS-361, owner ruling 2026-08-14 with the screenshot in hand: "the
// misses should be at the top here (look like stack rank)"). Every other list on this surface —
// the source meter under it, the mob card beside it — is ordered by size, so a fixed-order block
// in the middle of them reads as a form rather than as a measurement. WHAT DRAWS did not change:
// the four active defences still draw at zero and simply sort to the bottom, which is the honest
// place for them.

import type { DefenseView, MissBreakdown } from '../../../../shared/combat'

/** One outcome's row. `active` marks the four the user actually asked about. */
export interface DefenseRow {
  key: keyof MissBreakdown
  label: string
  count: number
  /** share of swings aimed at you, as a percentage (the engine's own `rates`). */
  pct: number
  /** bar fill: this row's count against the biggest row's, so a 2% row is still visible. */
  fill: number
  /** one of YOUR four defensive skills (block/parry/dodge/riposte). */
  active: boolean
  /** what the row means — hover text, never a caveat the row itself has to carry. */
  hint: string
}

/**
 * The six outcomes. This order is no longer the DRAWING order (JOS-361 ranks the rows by count) —
 * it is the DECLARATION order, and it survives as the tie-break: `Array.prototype.sort` is stable,
 * so two outcomes with the same count keep the order the reporter named them in and the block does
 * not shuffle between two equal rows from one snapshot tick to the next.
 */
const ROWS: { key: keyof MissBreakdown; label: string; active: boolean; hint: string }[] = [
  { key: 'block', label: 'Block', active: true, hint: 'Swings you blocked ("but YOU block!").' },
  { key: 'dodge', label: 'Dodge', active: true, hint: 'Swings you dodged ("but YOU dodge!").' },
  { key: 'parry', label: 'Parry', active: true, hint: 'Swings you parried ("but YOU parry!").' },
  {
    key: 'riposte',
    label: 'Riposte',
    active: true,
    hint: 'Swings your riposte turned aside ("but YOU riposte!"). Each one also gives you a free counter-swing, which the game annotates (Riposte) on an ordinary damage line - counted separately below.'
  },
  {
    key: 'miss',
    label: 'Missed you',
    active: false,
    hint: 'The attacker simply failed to connect. Not a defensive skill of yours, so it is kept out of the "defended" rate.'
  },
  {
    key: 'absorb',
    label: 'Rune absorbed',
    active: false,
    hint: 'A rune ate the blow. Not a defensive skill either - it is your buff, not your reflexes.'
  }
]

/**
 * The rows to draw, STACK-RANKED by count (JOS-361). The four active defences always; the two
 * non-skill outcomes only when they occurred.
 *
 * The sort is on the COUNT, not on the rate: they share one denominator (the engine divided every
 * outcome by the same swings), so ranking by either gives the same order — and the count is the
 * number the row actually leads with.
 */
export function defenseRows(d: DefenseView): DefenseRow[] {
  const shown = ROWS.filter((r) => r.active || d.avoided[r.key] > 0).sort(
    (a, b) => d.avoided[b.key] - d.avoided[a.key]
  )
  const max = Math.max(1, ...shown.map((r) => d.avoided[r.key]))
  return shown.map((r) => ({
    key: r.key,
    label: r.label,
    count: d.avoided[r.key],
    pct: d.rates[r.key],
    fill: (d.avoided[r.key] / max) * 100,
    active: r.active,
    hint: r.hint
  }))
}

/** One row as a single string — the spelling the clipboard uses, so a paste and a screenshot of
 *  the panel say the same thing about the same row. */
export function defenseRowText(r: DefenseRow): string {
  return `${r.label} ${r.count} (${r.pct.toFixed(1)}%)`
}

/**
 * The headline over the rows: what share of the swings aimed at you never landed, and how much of
 * that you can take credit for. The DENOMINATOR RIDES ALONG (law 11's spirit — a rate whose
 * exposure is off screen is a lie), and it is stated in swings because that is what was divided.
 *
 * PARTS, not a sentence, because the clipboard has a width to respect and the app's one packer
 * (`copyTable.statLines`) wraps on the ' · ' separator — a pre-joined sentence cannot be wrapped
 * without inventing a break point. The panel joins them itself.
 */
export function defenseHeadlineParts(d: DefenseView): string[] {
  if (d.swings === 0) return ['nothing has swung at you yet']
  return [
    `${Math.round(d.avoidedPct)}% of ${d.swings} swings at you avoided`,
    `${Math.round(d.defendedPct)}% by block/parry/dodge/riposte`
  ]
}

export function defenseHeadline(d: DefenseView): string {
  if (d.swings === 0) return 'Nothing has swung at you in this segment.'
  return defenseHeadlineParts(d).join(' · ')
}

/**
 * THE COUNTER-SWING LINE, or null when you never riposted.
 *
 * Both halves are printed because the log prints both and they are not the same fact: `events` is
 * the swing your riposte turned aside, `swings`/`damage` are the free counter that follows. Double
 * Riposte makes the second exceed the first, so the panel states them side by side rather than
 * reconciling them into one number the log never claimed.
 *
 * The damage is labelled as being INSIDE your melee total, because it is (see
 * shared/combat.ts RiposteView.damage) — a reader who adds it to the meter's bar would
 * double-count his own swings.
 */
export function riposteLine(d: DefenseView): string | null {
  const r = d.riposte
  if (r.events === 0 && r.swings === 0) return null
  const dmg =
    r.swings === 0
      ? 'no counter-swing was logged'
      : `${r.swings} counter-swings (${r.hits} landed) for ${r.damage} damage - already inside your melee total, ${r.pctOfSwingDamage.toFixed(1)}% of it`
  return `Riposte: ${r.events} swings turned aside · ${dmg}`
}

/**
 * What the MOBS riposted off you — their annotated counter-swings, the other end of the same
 * annotation. Null when there were none.
 *
 * IT IS NOT A DEFENSIVE STAT OF YOURS and is worded so it cannot be read as one: it belongs on
 * this panel because it is the only place riposte is explained, and because "why am I taking hits
 * between my swings" is answered by it.
 *
 * The count is EVERY annotated counter, landed and avoided alike — the same tally
 * `SourceRoundsView.ripostesTaken` carries — so the wording says "swung", never "landed".
 */
export function ripostesTakenLine(d: DefenseView): string | null {
  const n = d.riposte.taken
  if (n === 0) return null
  return `Riposted by mobs: ${n} counter-swings swung at you off your own attacks`
}
