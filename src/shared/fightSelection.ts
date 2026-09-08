// GLOBAL FIGHT SELECTION — the value model (docs/plans/combat-overlay-parity.md P4/P5/P6).
//
// One fight is selected AT A TIME, APP-WIDE. Picking a fight in the Combat tab's picker or in
// any fight-scoped overlay selector writes this; every fight-scoped surface follows it. It is
// deliberately tiny and deliberately DUMB — the whole model is one string:
//
//   '__live__'  the sentinel: "whatever the fight scope's head row currently is". The engine is
//               sent NO selectedId for it, so it re-resolves every tick (open fight → that
//               fight; none open → the most recent finalized one). Pinning a real id instead
//               would freeze every surface on the last fight the moment the next pull started.
//   'e<n>'      one finalized (or open) encounter, by the engine's own id
//               (`src/main/combat/lifecycle.ts` mints `e${++seq}`).
//
// WHAT IT IS NOT (P5, and the standing law in AGENTS.md): it is not a SCOPE. A surface sitting
// in Overall scope stays in Overall when this changes — the selection is what a fight-scoped
// surface shows, never a decision that a surface should BE fight-scoped. Zone-session
// ('overall' / 'heal-overall') selectors keep their own per-overlay selection and neither read
// nor write this.
//
// WHAT IT IS NOT, PART 2 (P4): it is not persisted. Main holds it in a module-scope variable
// that resets to the sentinel every launch — a fight id from a previous session names an
// encounter the engine has not replayed yet, and starting the app pinned to a fight the user
// has forgotten about is worse than starting live.
//
// This file is the SHARED half so main's validator and the renderer's default can never
// disagree about what a valid selection is. Value imports are relative: it is node-tested and
// reached from main, both of which resolve no `@shared/*` alias.

/** "Whatever the fight scope's head row currently is" — re-resolved by the engine each tick. */
export const LIVE_FIGHT = '__live__'

/**
 * An engine encounter id. `e` + the encounter sequence number, which starts at 1 and only
 * grows within one process (`e${++st.seq}`). The upper bound is a sanity cap on renderer input,
 * not a real limit — a nine-digit encounter count is a broken process, not a long session.
 */
const ENCOUNTER_ID = /^e[1-9][0-9]{0,8}$/

/** Is this exactly one of the two shapes a global fight selection may take? */
export function isFightSelection(v: unknown): v is string {
  return typeof v === 'string' && (v === LIVE_FIGHT || ENCOUNTER_ID.test(v))
}

/**
 * VALIDATE RENDERER INPUT (the setter's gate — main never trusts the string it is handed, here
 * as everywhere). Returns the value to store, or null when the input is not a fight selection
 * at all: a non-string, a zone-session id ('zone' / 'zs<n>' — those belong to a per-overlay
 * Overall selector and must never land in the global), or anything hand-crafted.
 *
 * A STALE-BUT-WELL-FORMED id is deliberately accepted (P6): `e900` for a fight that has aged
 * out of the engine's history is a legal selection that simply resolves to the engine's default
 * (`resolveSelectedId` in main/combat/engine.ts falls back on its own), exactly the way a stale
 * overlay drill renders level 1 without being cleared. Rejecting it here would clear the global
 * for every surface because one of them scrolled past the ring's edge.
 */
export function normalizeFightSelection(v: unknown): string | null {
  return isFightSelection(v) ? v : null
}
