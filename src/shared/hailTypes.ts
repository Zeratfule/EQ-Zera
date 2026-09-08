// hailTypes.ts — the `hails` module's transport: the NPCs you greeted, in order.
//
// Its own file on the characterTypes.ts precedent: `shared/types.ts` sits at the MEASURED
// 400-code-line factoring ceiling, so a new snapshot shape goes beside its own argument and is
// re-exported from `shared/types` — no importer moves, no import path changes.
//
// WHY A HAIL IS WORTH A MODULE. A hail opens every NPC dialogue tree in EverQuest, so the sequence
// of them IS the sequence of quest steps a session attempted. It is the one piece of your own chat
// that carries world meaning, which is why the parser claims `You say, 'Hail…` and leaves the rest
// of what you type as `{kind:'unknown'}`.
//
// WHAT THIS DOES NOT SAY. It does not say which quest an NPC belongs to, whether a step advanced,
// or whether the NPC answered. The log prints no reply of its own to a hail, so any of those would
// be an inference (law 1). Joining a name to the quest catalog is the renderer's job, done against
// the spelling below.

import type { LogEventBase } from './logEvents'

/**
 * `You say, 'Hail, <NPC>'` — the greeting that opens every NPC dialogue tree in EverQuest, and so
 * the first line of every quest step you took.
 *
 * THE ONLY `You say` LINE THAT IS CLAIMED. The rest of what you type is conversation and stays
 * `{kind:'unknown'}`; no generic `say` kind exists, because a kind whose only reader would be a
 * chat log is one nothing in this app has a use for (the awaiting-sample law).
 *
 * The comma is the player's own typing and both spellings are real — `Hail, Beur Tenlah` and
 * `Hail Nicholas`. `npc` is what came after it, verbatim.
 */
export interface HailEvent extends LogEventBase {
  kind: 'hail'
  /** who you greeted, as the line spelled it. */
  npc: string
}

/**
 * One greeting.
 *
 * `npc` is EXACTLY as the line spelled it (law 2 — canonicalize at boundaries, display raw). There
 * is no counting boundary here, so nothing is folded or stripped: a catalog join canonicalizes on
 * its own side, where the join key belongs.
 */
export interface HailRow {
  /** who you greeted, verbatim. */
  npc: string
  /** the LOG's clock, epoch millis — never a wall clock. */
  ts: number
}

/**
 * The `hails` module's published state.
 *
 * `recent` is NEWEST LAST and capped at 200, drop-oldest. A hail is a step you took rather than a
 * ledger entry: nothing is summed over the list, so dropping the oldest cannot move an answer, and
 * 200 covers several sessions of questing.
 */
export interface HailSnap {
  /** shape version — bumped when a reader could misread old rows as new ones. */
  v: number
  recent: HailRow[]
}

/**
 * The delta is a WHOLE snapshot, the `RespawnDelta` posture. The list is bounded and a hail moves
 * it by one row, so a per-row merge would buy nothing and cost a second definition of the state.
 */
export type HailDelta = HailSnap

/** What a consumer holds before the fold has said anything. */
export const EMPTY_HAIL_SNAP: HailSnap = { v: 1, recent: [] }
