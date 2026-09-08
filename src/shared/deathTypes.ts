// deathTypes.ts — the `deaths` module's transport: what the last seconds looked like, per death.
//
// Its own file on the characterTypes.ts precedent — `shared/types.ts` is at its measured ceiling.
//
// ── WHY THIS IS NOT A COMBAT-ENGINE QUERY ─────────────────────────────────────────────────────
//
// The combat engine's timeline ring already holds every instant of a fight, and it is the wrong
// place to ask this, twice over. Its incoming rows carry no target — the engine files a hit by
// SOURCE, so "you were the one hit" is not a field on the row. And law 8's tripwire says every
// damage total stays byte-identical across a change, so reaching into the engine to add a dimension
// is exactly the kind of edit that moves one. The recap is folded in its own module, off the same
// events, adding no number to any total.
//
// ── `taken` IS THE WINDOW'S SUM, NOT WHAT KILLED YOU ──────────────────────────────────────────
//
// The log never prints your hit points, so how much of the window you were actually alive for is
// unknowable (law 6). `windowMs` travels beside the number so a surface can say what it means —
// "damage taken in the last 15 s", never "the damage that killed you".
//
// ── EVERY DEATH GETS A RECAP, HISTORICAL ONES INCLUDED ────────────────────────────────────────
//
// A fold has no way to tell a death it is replaying from one that just happened, and it may not
// read a wall clock to find out (the fold-determinism law). So a hydrate publishes a recap for
// every past death. A renderer that celebrates or notifies gates on a LIVE transition, which it can
// see and the fold cannot.

/** One incoming instant: a swing, a tick or a nuke aimed at you. */
export interface DeathRecapHit {
  ts: number
  /**
   * the attacker as the line spelled it. EMPTY for a caster-less DoT tick, which the log prints
   * with `attacker: null` — the tick still happened, and the honest name for who did it is no name
   * rather than a mob picked from context (law 1).
   */
  attacker: string
  /** the skill or spell that landed it, as the line named it. */
  skill: string
  /** 'melee' | 'spell' | 'dot' | 'ds' … — absent when the line implied none. */
  dtype?: string
  amount: number
  crit: boolean
}

/**
 * One spell you resisted, inside the window. It carries NO amount, by law 8 — a resist is
 * damage-free, so it can sit beside the hits without entering `taken`.
 */
export interface DeathRecapResist {
  ts: number
  caster: string
  /** DISPLAY form, rank suffix preserved. */
  spell: string
}

/** One attacker's or one skill's share of the window, largest first. */
export interface DeathRecapShare {
  /** the attacker name or the skill name — whichever list this row is in. */
  name: string
  amount: number
  hits: number
}

/** What the last seconds before one death looked like. */
export interface DeathRecap {
  /** LOG timestamp of the death line. */
  ts: number
  /** who the line named. Absent for the killerless `You died.` a DoT tick produces. */
  killer?: string
  /** the zone the fold was standing in. Absent before the scan reached a zone line. */
  zone?: string
  /** how far back `taken`, `hits` and `resisted` reach. Published so the number can be read. */
  windowMs: number
  /** Σ of the window's amounts. NOT "what killed you" — see the header. */
  taken: number
  /** the window, ASCENDING. */
  hits: DeathRecapHit[]
  /** grouped by attacker, largest total first; ties break on the name so the order is a function
   *  of the bytes. */
  byAttacker: DeathRecapShare[]
  /** grouped by skill, on the same terms. */
  bySkill: DeathRecapShare[]
  /** the spells you resisted in the window, ascending. */
  resisted: DeathRecapResist[]
}

/** The `deaths` module's published state. `recaps` is newest last, capped at 50. */
export interface DeathSnap {
  /** shape version. */
  v: number
  recaps: DeathRecap[]
}

/** The delta is a WHOLE snapshot — the `RespawnDelta` posture; see hailTypes.ts. */
export type DeathDelta = DeathSnap

/** What a consumer holds before the fold has said anything. */
export const EMPTY_DEATH_SNAP: DeathSnap = { v: 1, recaps: [] }
