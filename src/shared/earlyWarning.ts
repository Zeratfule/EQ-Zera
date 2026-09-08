// earlyWarning.ts — THE EARLY WARNING OFFSET (JOS-216), as pure functions.
//
// THE ASK, in the reporter's own words: "the ability to program a 10 second warning on mez, slow,
// tash". The owner's ruling is that this is an OFFSET ON AN EXISTING ALERT and not a new kind of
// alert: an alert that already fires when a debuff lands can instead fire N seconds before that
// debuff's ESTIMATED END. One option on the alert, one number, and everything else — the sound,
// the speech, the cooldown, the trigger — is the alert the user already wrote.
//
// IT ADDS NO DURATION TRACKING, AND THAT IS THE WHOLE DESIGN. The estimated end already exists and
// is already on screen: `shared/buffTimers.ts buildTimerRows` projects the buffs model and the CC
// half into rows, and a `mode:'countdown'` row states `startedTs + durationMs` — the SAME number
// the debuffs overlay draws a bar from, which since JOS-117/JOS-140 is the shared estimator
// max(DB floor, this caster's recent observed max). So the warning is that projection minus N
// seconds, and there is exactly one duration in the app.
//
// WHICH MEANS THE HONESTY LAW REACHES THIS SURFACE UNCHANGED (shared/buffTimers.ts's header):
// a row the model can put no honest number on counts UP and has no `durationMs`, and there is no
// end to count backwards from. Such a landing arms NOTHING — silence is the honest answer, and
// inventing a duration to warn against would be exactly the invented "remaining" that law forbids.
// The tooltip beside the field in the alert editor says the other half out loud: early on, the
// number is the DB floor and the warning can be early; it sharpens as your own log teaches it.
//
// Pure and Electron-free (it is `shared/`, and node:test loads it directly): no clock of its own,
// no state, and every input is handed in.

import type { AlertTrigger, AlertTriggerPrimitive } from './alertTypes'
import type { BuffTimerRow } from './buffTimers'
import { timerNameKey } from './buffTimers'
import { timerNameBase } from './buffTimers'
import type { LogEvent } from './logEvents'

/**
 * The bounds on the offset, in SECONDS.
 *
 * The floor is 1 because the model's own clock is a 1-second heartbeat (the registry's `onTick`,
 * which is what fires these) — an offset finer than the tick cannot be delivered, so promising it
 * would be a lie in the UI.
 *
 * The ceiling is 120 because it is past the longest thing anybody warns about early: the CC roster
 * tops out at Ensnare's 660 s and the debuffs people actually watch (mez 24-96 s, a slow a few
 * minutes) are shorter still, so two minutes covers "warn me well before the slow drops" and
 * refuses the typo that would arm a warning before the spell had finished landing.
 */
export const MIN_EARLY_WARN_SEC = 1
export const MAX_EARLY_WARN_SEC = 120

/**
 * A stored/typed/imported offset as a number this app will act on, or undefined for "no warning".
 *
 * UNDEFINED IS THE DEFAULT AND THE FALLBACK, both of which mean the same thing: fire when the
 * trigger matches, which is what every alert written before this existed already did. A zero, a
 * negative, a NaN, a string and an absent key all land here, so nothing has to be migrated and a
 * stranger's shared bundle cannot arm a warning with a value this build would not have offered.
 */
export function normalizeEarlyWarnSec(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const sec = Math.round(raw)
  if (sec < MIN_EARLY_WARN_SEC) return undefined
  return Math.min(MAX_EARLY_WARN_SEC, sec)
}

/**
 * WHAT A LANDING WAS ABOUT — the half of the arming event that decides which timer row it made.
 *
 * `targetKey` is the canonical (idKey'd) entity the spell landed on; absent means the player, and
 * the two are exclusive because the projection's `group` is exactly that distinction.
 *
 * `spellNames` is EVERY name the line could be, not a name (JOS-84's law): the landing sentences
 * this feature is aimed at are shared across whole spell families — `<mob> has been mesmerized.`
 * is four spells — so the event's `spell` field is a documented best-effort pick and `candidates`
 * carries the truth. Both go in here, and the match below accepts any of them.
 */
export interface EarlyWarnSubject {
  /** Canonical entity key (idKey), or undefined when the landing was on the player. */
  targetKey?: string
  /** Every spell name the arming line could have been, display casing, possibly empty. */
  spellNames: readonly string[]
}

/** True when a row states an end at all — the only rows an early warning can be measured against. */
function hasStatedEnd(row: BuffTimerRow): boolean {
  return row.mode === 'countdown' && row.durationMs != null && row.durationMs > 0
}

/** Every spell name a row answers to, rank-stripped and folded (its own, plus its family). */
function rowNameKeys(row: BuffTimerRow): string[] {
  return [row.name, ...(row.candidates ?? [])].map(timerNameKey)
}

/**
 * THE ROW A LANDING IS TRACKED BY, or undefined when the model states no end for it.
 *
 * THE RULE, in the order it is applied, and its honest limit stated with it:
 *
 *  1. Only rows with a STATED end (see the header). A count-up row arms nothing.
 *  2. The row must be on the subject's entity — the mob the line named, or the player.
 *  3. If ANY of those rows answers to one of the subject's spell names, only those rows are
 *     considered. Rank-stripped and case-folded on both sides, because the row's name comes from
 *     the CAST line (`Mesmerization VII` — the only line in the family that carries a rank) while
 *     the arming event's names come from the DB candidates for a landing sentence that carries
 *     none. A subject whose names match nothing on that entity falls back to all of them rather
 *     than to nothing: the parser's candidate list is DB-derived and a row the model resolved from
 *     the player's own cast history is the better answer when the two disagree.
 *  4. Of what is left, the MOST RECENT landing — the largest `startedTs`. The arming event is the
 *     line that produced the row, so on the ordinary path there is exactly one and this picks it.
 *
 * THE LIMIT: two different debuffs landing on one mob in the same second, whose sentences name no
 * spell this build can tell apart, are one entity with two rows and step 4 takes the newer. That
 * is a warning about the wrong one of two things the user is holding on that mob — never a warning
 * about a mob they are not fighting.
 */
export function earlyWarnRowFor(
  rows: readonly BuffTimerRow[],
  subject: EarlyWarnSubject
): BuffTimerRow | undefined {
  const onSubject = rows.filter(
    (r) => hasStatedEnd(r) && (subject.targetKey == null ? r.group === 'self' : r.targetKey === subject.targetKey)
  )
  if (onSubject.length === 0) return undefined
  const wanted = new Set(subject.spellNames.map(timerNameKey))
  const named = wanted.size === 0 ? [] : onSubject.filter((r) => rowNameKeys(r).some((k) => wanted.has(k)))
  const pool = named.length > 0 ? named : onSubject
  return pool.reduce((best, r) => (r.startedTs > best.startedTs ? r : best))
}

/**
 * WHEN THE WARNING FOR THIS ROW IS DUE — the row's estimated end minus the offset.
 *
 * Re-read on every tick rather than computed once at the landing, because both halves move: the
 * learner can raise the estimate mid-hold (`restatLine` re-states every live bar when a sample
 * beats the floor) and a re-land moves `startedTs`. A warning that fixed its own deadline at the
 * landing would go on describing a countdown the app had already corrected.
 *
 * Undefined when the row states no end — the same refusal as `earlyWarnRowFor`, restated here so a
 * caller holding a row that has since lost its number cannot compute a deadline from nothing.
 */
export function earlyWarnFireAt(row: BuffTimerRow, sec: number): number | undefined {
  if (!hasStatedEnd(row) || row.durationMs == null) return undefined
  return row.startedTs + row.durationMs - sec * 1000
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// THE BREAK FAMILY (JOS-235) — and why the offset had to mean something different for it.
//
// JOS-216 (everything above) reads: a def with an offset does not fire when its trigger matches;
// the match ARMS a warning against the row that landing produced. That is exactly right for a
// LANDING-triggered def and exactly WRONG for a def whose trigger IS the ending — the per-spell
// `breaks` alert, the "Mez / root broke" group, the charm break, the slow wear-off. For those the
// arming event and the end are the SAME event: by the time the arm is resolved on the next
// heartbeat the row it is looking for has already been removed by that very line, no row is ever
// found, and `ARM_RESOLVE_WINDOW_MS` drops the request in silence. Net effect, and it is the worst
// possible one: typing a number into "Warn early" DELETED the alert. The owner found it in release
// testing with `earlyWarnSec: 90` on his breaks-for-Dazzle alert — no warning, and no break alert.
//
// SO A BREAK-FAMILY DEF ARMS FROM THE ROW APPEARING, NOT FROM ITS OWN TRIGGER. When a timer row
// lands for a spell whose break this def would announce, the warning is scheduled at that row's
// estimated end minus the offset. The trigger keeps its ordinary meaning: the break line still
// FIRES the alert. One landing yields exactly one firing, and which one it is depends on what the
// world did:
//
//   * the hold survives to the deadline  → the WARNING speaks, and the at-break firing for THAT
//                                          landing is suppressed (the alert already spoke).
//   * the hold breaks BEFORE the deadline → nothing was warned, so the break fires normally.
//
// AN EARLY BREAK MUST NEVER BE SILENT. That is the whole ticket, and it is why every failure mode
// here degrades to "the alert behaves exactly as it did before the offset existed": a row with no
// stated end arms nothing, a def whose probe matches no row arms nothing, an offset longer than the
// spell arms nothing — and in every one of those cases the break line still fires the alert.
// ═════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The event kinds whose arrival means a tracked row has ENDED.
 *
 * Measured against the parser rather than assumed (`log/parseCasts.ts classifyWornOff` routes the
 * one sentence `Your <X> spell has worn off of <mob>.` three ways, and this file's tests drive all
 * of them through the real parser):
 *   'cc'          — a mez/root spell's wear-off, `refresh:true` (the `ccSpell` roster).
 *   'uncharm'     — a charm spell's wear-off (the `charmSpell` roster, tested first).
 *   'buffFade'    — everything else that wore off a NAMED target: a slow, a Largo, a Pacify.
 *   'buffWearOff' — a shared-message wear-off ON YOU (`Your speed returns.`).
 *   'buffExpired' — the buffs module's derived, resolved "wore off you / your pet".
 */
export type BreakTriggerKind = 'cc' | 'uncharm' | 'buffFade' | 'buffWearOff' | 'buffExpired'

/**
 * Whether a `where` matcher SPEC accepts a value — MIRRORING `compileFieldMatch` in
 * main/modules/alerts.ts (a `/…/` spec is a case-insensitive regex, anything else is a
 * case-insensitive exact match, and an invalid regex degrades to the literal).
 *
 * It is repeated rather than imported because that function lives in main and this file is shared
 * (the alert EDITOR asks the same question, to caption the field honestly). The two must stay
 * identical, and `tests/earlyWarning.test.mts` pins the equality against the real compiled matcher
 * — the same arrangement `shared/spellLines.ts`'s RANK_TAIL_RE has with the parser's.
 *
 * IT IS KEY-BLIND, AND ITS ONE CALLER ASKS ABOUT `refresh` (below). The rank fold that makes a
 * literal matcher rank-blind belongs to the keys that NAME A SPELL — `spell`, and `damage.skill`
 * since JOS-276 — so it lives in `compileFieldMatch`/`accepts` where the trigger's kind and key
 * are both known, and NOT here: `refresh` is 'true', not a spell name, and folding it would be a
 * fold over nothing. A caller that ever wants to ask this about a spell-naming spec must ask for
 * the fold too, or it will be asking the older question. Re-checked in the JOS-276 sweep — this
 * function still has exactly the one caller, and it still asks about `refresh`.
 */
export function matcherAccepts(spec: string, value: string): boolean {
  if (spec.length >= 2 && spec.startsWith('/') && spec.endsWith('/')) {
    try {
      return new RegExp(spec.slice(1, -1), 'i').test(value)
    } catch {
      // fall through to literal, exactly as the compiler does
    }
  }
  return spec.toLowerCase() === value.toLowerCase()
}

/**
 * The break kind ONE primitive condition watches for, or null when it is not a break condition.
 *
 * THE `cc` KIND CARRIES BOTH HALVES and so has to be read rather than listed: the same event is
 * the application (`a turmoil toad has been mesmerized.`) and the break (`Your Dazzle spell has
 * worn off of a turmoil toad.`). Two things separate them, and a def only has to state either:
 *
 *   `refresh` — present and 'true' ONLY on the break shape. What both `breaks` templates pin.
 *   `spell`   — the APPLICATION SENTENCE NAMES NO SPELL. It carries `candidates` and no `spell`
 *               field at all (measured — see the probe below), and an absent field is a no-match
 *               before the JOS-84 candidate widening is ever consulted. So a `cc` condition that
 *               constrains `spell` can only ever fire on a break, whether or not it also says
 *               `refresh`. That is not a nicety: the alert EDITOR keeps only the FIRST `where`
 *               entry of a condition, so a stored `{spell, refresh}` breaks def that has been
 *               through the dialog comes back out as `{spell}` alone — and it still fires only on
 *               breaks, so it must still be read as one.
 *
 * A bare `{kind:'cc'}` with no such constraint matches the APPLICATION too and stays a
 * landing-family def, which is what keeps JOS-216's behavior byte-for-byte for every def written
 * before this existed.
 */
function breakKindOf(t: AlertTriggerPrimitive): BreakTriggerKind | null {
  if (t.type !== 'event') return null
  if (t.kind === 'uncharm' || t.kind === 'buffFade') return t.kind
  if (t.kind === 'buffWearOff' || t.kind === 'buffExpired') return t.kind
  if (t.kind !== 'cc') return null
  const where = t.where ?? {}
  if (where.spell !== undefined) return 'cc'
  return where.refresh !== undefined && matcherAccepts(where.refresh, 'true') ? 'cc' : null
}

/**
 * THE BREAK KINDS A DEF WATCHES FOR — empty when it is not a break-family def at all.
 *
 * EVERY condition must be a break condition, and there must be at least one. A def with a `raw` or
 * an 'app' condition is therefore never break-family, which is the honest answer twice over: this
 * file cannot build a hypothetical LOG LINE for a pattern to match (the probe below builds a
 * projected sentence, deliberately not a log-shaped one), and a renderer-evaluated app signal never
 * sees a LogEvent at all. A mixed composite (one landing condition, one break condition) keeps
 * JOS-216's landing behavior rather than half of each.
 *
 * The `wearsOff` suggestion template is the reason this returns a LIST: it is an `any` composite
 * over `buffExpired` + `buffWearOff` (JOS-103 made it one, because the derived event can never
 * fire for a buff somebody else cast on you), and both halves have to be probed.
 */
export function breakTriggerKinds(trigger: AlertTrigger): BreakTriggerKind[] {
  const conds: AlertTriggerPrimitive[] = 'conditions' in trigger ? trigger.conditions : [trigger]
  const out: BreakTriggerKind[] = []
  for (const c of conds) {
    const kind = breakKindOf(c)
    if (kind === null) return []
    if (!out.includes(kind)) out.push(kind)
  }
  return out
}

/**
 * Every spell name a running row could be announced under, as the wear-off line would print it.
 *
 * An unambiguous row answers to its own name; a FAMILY row (JOS-84: one landing sentence, four
 * spells) answers to every candidate, because the log itself has not said which one it is and the
 * break line will name exactly one of them. Ranks are stripped (see `timerNameBase`) and the list
 * is deduped case-insensitively, first spelling wins.
 */
export function rowBreakNames(row: BuffTimerRow): string[] {
  const raw = row.candidates && row.candidates.length > 0 ? row.candidates : [row.name]
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of raw) {
    const base = timerNameBase(n)
    const key = base.toLowerCase()
    if (base === '' || seen.has(key)) continue
    seen.add(key)
    out.push(base)
  }
  return out
}

/** One hypothetical break, ready to be offered to a def's own matcher. */
export interface BreakProbe {
  /** The event a break of this row would be, as the parser would emit it. */
  ev: LogEvent
  /** The spell name this probe stands for — what the firing SAYS, and what the break line prints. */
  spell: string
}

/**
 * WHAT A BREAK OF THIS ROW WOULD LOOK LIKE — the seam, stated in one place.
 *
 * A def's `where` is written against the shape of the BREAK EVENT, so the only honest way to ask
 * "would this def announce the break of this row" is to ask the def's own matcher, with the event
 * it was written for. Re-implementing the question — "compare the def's spell key to the row's
 * name" — would be a second matcher beside the real one, which is exactly the two-models drift
 * world-model law 4 exists to forbid: it would have to re-derive regex specs, the candidate
 * widening and the field-absence rule, and it would drift the first time any of them changed.
 *
 * SO THE PROBE IS A FABRICATION, AND HERE IS ITS ENTIRE BLAST RADIUS. It is built here, handed to
 * `AlertsModule.matches`, and dropped. It is never emitted on the bus, never folded by any module,
 * never counted, and never learned from. Nothing downstream can mistake it for a line the game
 * printed, because `raw` is deliberately NOT log-shaped: it is a projection sentence ("Dazzle on a
 * turmoil toad is about to end"), which is also what the recent-fires panel shows for such a
 * firing — the truth, rather than a sentence the log never carried (AGENTS.md: never hand-author a
 * shape no real log has printed).
 *
 * THE FIELDS ARE THE MEASURED ONES, per kind — verified by driving every family through the real
 * parser in tests/earlyWarning.test.mts:
 *   cc          `{ mob, spell, refresh:true }`  — no candidates: the BREAK shape carries none.
 *   uncharm     `{ mob, spell }`                — no refresh; a charm break never carries one.
 *   buffFade    `{ spell, target }`             — `target` omitted for a row on you.
 *   buffWearOff `{ spell, candidates, target:'self' }` — self rows only; the field is typed 'self'.
 *   buffExpired `{ spell, target }`             — 'self' for a self row, else the entity's name.
 *
 * A kind that cannot describe this row yields NOTHING (a `cc` break names a mob, so it can say
 * nothing about a buff on you), which is a def that arms no warning and still fires at the break.
 */
export function breakProbes(kind: BreakTriggerKind, row: BuffTimerRow, ts: number): BreakProbe[] {
  const self = row.group === 'self'
  const target = row.target ?? ''
  if (!self && target === '') return []
  return rowBreakNames(row).flatMap((spell) => {
    const base = { ts, seq: 0, raw: breakProbeText(row, spell) }
    const ev = probeEvent(kind, { self, target, spell, base })
    return ev ? [{ ev, spell }] : []
  })
}

/** The per-kind shape, split out so `breakProbes` stays one idea (and under the depth ceiling). */
function probeEvent(
  kind: BreakTriggerKind,
  p: { self: boolean; target: string; spell: string; base: { ts: number; seq: number; raw: string } }
): LogEvent | null {
  const { self, target, spell, base } = p
  if (kind === 'cc') return self ? null : { kind, ...base, mob: target, spell, refresh: true }
  if (kind === 'uncharm') return self ? null : { kind, ...base, mob: target, spell }
  if (kind === 'buffFade') return { kind, ...base, spell, ...(self ? {} : { target }) }
  if (kind === 'buffWearOff') {
    return self ? { kind, ...base, spell, candidates: [spell], target: 'self' } : null
  }
  return { kind, ...base, spell, target: self ? 'self' : target }
}

/**
 * The projected sentence a break-armed firing carries as its `matchedText`.
 *
 * NOT a log line, on purpose (see `breakProbes`): this firing is a projection off the timer model,
 * and the recent-fires panel says so. It still names the two things the user needs to tell one
 * warning from another — the spell, and which mob it is on.
 */
export function breakProbeText(row: BuffTimerRow, spell: string): string {
  return row.group === 'self'
    ? `${spell} is about to wear off`
    : `${spell} on ${row.target ?? 'unknown target'} is about to end`
}

/**
 * THE IDENTITY A WARNING AND ITS BREAK SHARE — `<entity>|<spell family>`, folded on both sides.
 *
 * It is what lets the at-break firing be suppressed for a landing whose warning already spoke,
 * WITHOUT the alerts module having to re-derive a timer row id from a break line (that id scheme
 * belongs to `buildTimerRows`, and a second copy of it here is the drift this file is trying not
 * to be). A row contributes one key per name it answers to; an event contributes one per name it
 * could be, and any overlap is the same hold.
 *
 * 'self' is the entity key for a row on the player — the model's own word for it, and the one
 * `buffWearOff`/`buffExpired` already spell in their `target` field.
 *
 * RANK-BLIND BY CONSTRUCTION (JOS-276 sweep), and it has to be: the row's name comes from the
 * ranked CAST line while the break line prints the bare name, so an identity that kept the numeral
 * would match nothing it was built to match. `timerNameKey` is the fold — the same rank tail
 * `spellLineKey` strips — applied on both sides here and in `earlyWarnRowFor`'s `wanted` set. The
 * probes (`rowBreakNames` → `timerNameBase`) hand a def's own matcher the RANK-LESS spelling, and
 * a def pinned to a rank still accepts it through `accepts`'s fold. Nothing in this file compares
 * two spell names without folding first.
 */
export function breakIdentityKeys(entityKey: string, names: readonly string[]): string[] {
  const out: string[] = []
  for (const n of names) {
    const key = `${entityKey}|${timerNameKey(n)}`
    if (!out.includes(key)) out.push(key)
  }
  return out
}

/** The identity keys a live row would be broken under. */
export function rowBreakIdentity(row: BuffTimerRow): string[] {
  const entity = row.group === 'self' ? 'self' : (row.targetKey ?? row.target ?? '')
  return breakIdentityKeys(entity, rowBreakNames(row))
}
