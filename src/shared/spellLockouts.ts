// spellLockouts.ts — when a spell can land on the same targets again (the dirge lockout overlay).
//
// THE MODEL IS THE ENGINE'S: `buffTimers` publishes `lockouts` — the rule table and one row per
// landing burst of YOUR spell, live tail only (engine fold `buff_timers/lockouts.rs`, where the
// patch quote and the assumptions are written). This file only reads a row against the wall clock.
//
// THREE PHASES, because the game states a RANGE and prints nothing when a target is locked:
//   locked  — before `earliestMs`: it will not land on those targets.
//   maybe   — between the two: it may, depending on where in the tick it landed.
//   ready   — past `certainMs`: it will. A ready row lingers briefly, then leaves.
// `startedTs` is the LOG stamp of the landing (second resolution); `certainMs` already covers that.
//
// Pure and node-tested (tests/spellLockouts.test.mts); relative imports only, repo law.

/** One target name a landing hit, and how many of that name. */
export interface LockoutTarget {
  name: string
  count: number
}

/** One landing burst, and the window it locks. */
export interface SpellLockout {
  /** The rule's base name, rank stripped. */
  spell: string
  /** The name the landing line printed, rank included. */
  castName: string
  /** LOG timestamp (epoch ms) of the first landing line of the burst. */
  startedTs: number
  earliestMs: number
  certainMs: number
  /** Landing lines in the burst. */
  count: number
  targets: LockoutTarget[]
}

export interface LockoutRule {
  spell: string
  earliestMs: number
  certainMs: number
}

export interface SpellLockoutsSnap {
  rules: LockoutRule[]
  active: SpellLockout[]
}

export const EMPTY_LOCKOUTS: SpellLockoutsSnap = { rules: [], active: [] }

/** How long a row stays on screen saying `ready` before it leaves. */
export const LOCKOUT_LINGER_MS = 5_000

export type LockoutPhase = 'locked' | 'maybe' | 'ready'

export interface LockoutReading {
  phase: LockoutPhase
  /** Until the phase ends: to earliest while locked, to certain while maybe, 0 once ready. */
  remainingMs: number
  /** Share of the whole window (to `certainMs`) already elapsed, 0..1. */
  fraction: number
  /** Where `earliestMs` sits on that same 0..1 scale — the bar's marker. */
  earliestFraction: number
}

/** Read one row at `nowMs`, or `null` once it has been ready for longer than the linger. */
export function lockoutReading(l: SpellLockout, nowMs: number): LockoutReading | null {
  // A stamp a little ahead of this machine's clock reads as just landed, never as negative.
  const elapsed = Math.max(0, nowMs - l.startedTs)
  if (elapsed > l.certainMs + LOCKOUT_LINGER_MS) return null
  const span = Math.max(1, l.certainMs)
  const fraction = Math.min(1, elapsed / span)
  const earliestFraction = Math.min(1, l.earliestMs / span)
  if (elapsed < l.earliestMs) return { phase: 'locked', remainingMs: l.earliestMs - elapsed, fraction, earliestFraction }
  if (elapsed < l.certainMs) return { phase: 'maybe', remainingMs: l.certainMs - elapsed, fraction, earliestFraction }
  return { phase: 'ready', remainingMs: 0, fraction: 1, earliestFraction }
}

/** The rows still on screen at `nowMs`, oldest landing first (the next one to free up on top). */
export function shownLockouts(
  snap: SpellLockoutsSnap,
  nowMs: number
): { lockout: SpellLockout; reading: LockoutReading }[] {
  const out: { lockout: SpellLockout; reading: LockoutReading }[] = []
  for (const lockout of snap.active) {
    const reading = lockoutReading(lockout, nowMs)
    if (reading) out.push({ lockout, reading })
  }
  return out.sort((a, b) => a.lockout.startedTs - b.lockout.startedTs)
}

/** The rules with no row on screen — each draws one idle `<spell>: ready` line. */
export function idleLockoutRules(snap: SpellLockoutsSnap, shown: readonly { lockout: SpellLockout }[]): LockoutRule[] {
  return snap.rules.filter((r) => !shown.some((s) => s.lockout.spell === r.spell))
}

/** `an ice giant x2, a priest of Nagafen` — the targets line. */
export function lockoutTargetsLabel(l: SpellLockout): string {
  return l.targets.map((t) => (t.count > 1 ? `${t.name} x${String(t.count)}` : t.name)).join(', ')
}

/** The rank the landing printed (`VII`), or null when it printed none. */
export function lockoutRankLabel(l: SpellLockout): string | null {
  if (!l.castName.startsWith(l.spell)) return null
  const rest = l.castName.slice(l.spell.length).trim()
  return rest.length > 0 ? rest : null
}

/** The right-hand words: `locked 9s`, `maybe 4s`, `ready`. `fmt` is the app's duration formatter. */
export function lockoutTimeLabel(r: LockoutReading, fmt: (ms: number) => string): string {
  if (r.phase === 'ready') return 'ready'
  const secs = fmt(Math.ceil(r.remainingMs / 1000) * 1000)
  return r.phase === 'locked' ? `locked ${secs}` : `maybe ${secs}`
}
