// alertDefMigrations.ts — one-time rewrites of SHIPPED alert defs already sitting in a user's
// store, for the case where the app changed its mind about what a curated def should match.
//
// WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A SCHEMA MIGRATION. `storeMigrations.ts` owns
// changes to the SHAPE of the persisted file — every reader must see a shape it understands, so
// that chain is version-stamped, append-only and runs before anything reads the store. Nothing
// here changes a shape: `cooldownScope` is optional and absent means what it always meant. What
// changes is a VALUE the app once authored and now authors differently, and the only honest rule
// for that is "rewrite the copy the app wrote; never touch the copy the user wrote". That is
// exactly the rule `migrateAlertSounds` (data/defaultPacks.ts) already follows for retired sound
// packs, so this module follows its precedent to the letter: a pure function over the alert
// list, a separate integer stamp in the store, run once from `getAlerts()` and never again.
//
// THE INCIDENT (owner, 2026-08-04, verified twice against eqlog_Primitive_freeport.txt). The
// rogue-slow def matched `where:{effect:'slow'}` under ONE alert-wide 30 s cooldown, and THE
// GLOBAL CLOCK ATE THE FIRST SLOW ON A FRESH MOB: Weakening Strike landed on King Tranix at
// 22:31:16 (fired) and on a fire giant warrior at 22:31:43 — 27 s later, so it was SUPPRESSED
// and the add's slow was never announced. The player died at 22:33:40. A re-land on the mob you
// are already fighting must not silence the first slow on the mob you just pulled. The engine
// answer is `cooldownScope:'target'` (modules/alerts.ts), and step 1 below carries an existing
// user's stored def onto it.
//
// THE SAME WAVE ALSO WIDENED THE TRIGGER, AND THE OWNER SENT IT BACK. Step 1 shipped a trigger
// of `/^(slow|spellSlow)$/` so the def would also fire on Clumsiness Strike, the CASTING slow
// (`<mob>'s fingers slow down.`). Living with it for an afternoon: "i dont want the spell cast
// time slow to count. one proc, one family." Step 2 reverts exactly that half — the trigger goes
// back to `effect:'slow'` and the per-target scope, which was the real fix, stays.
//
// APPEND-ONLY, LIKE EVERY MIGRATION CHAIN HERE. `STEPS` is ordered and never renumbered; a
// store runs the steps NEWER than its own stamp and nothing else. Two live stores prove why the
// chain has to exist rather than one "set it to today's def" rewrite: the owner's dev store was
// stamped 1 by the shipped build and holds the WIDENED trigger, while an un-relaunched store is
// still unstamped and holds the ORIGINAL one. 1→2 lands both on `effect:'slow'` + target scope;
// a single step keyed on either shape would leave the other behind.
//
// EVERY STEP'S OUTPUT IS A FROZEN LITERAL, never `poisonSlowAlertDefs()`. Step 1 used to read
// today's shipped def, which was fine for exactly as long as the def never changed again — the
// day it did (today) that step would have silently started writing something no build ever
// wrote. The literals below are BYTES PAST BUILDS WROTE, which is fixed history: pinning them is
// what keeps step 1 the step that shipped, not an edit of it.
//
// WHAT IT WILL NOT DO. Each step matches its input trigger EXACTLY, deep-equal. A user who
// edited the def — narrowed it, widened it, turned it into a composite, pointed it at another
// effect — has stated an intent, and no step touches that def at all. Everything the user chose
// about the def they did keep (sound, volume, cooldownMs, name, note, speech, enabled) is
// preserved verbatim; only the trigger and the cooldown SCOPE ever move.

import { POISON_SLOW_ALERT_ID } from '../../shared/alertGroups'
import type { AlertDef, AlertTrigger } from '../../shared/types'

/**
 * Bumped by every appended step. It is its own stamp, independent of
 * ALERT_SOUND_MIGRATION_VERSION: the two migrations answer different questions and a user can
 * legitimately have had one and not the other. Always equal to the last step's `version`.
 */
export const ALERT_TRIGGER_MIGRATION_VERSION = 2

/**
 * The trigger the rogue-slow def shipped with before 2026-08-04 — and, after the revert, the
 * trigger it ships with again. One literal for one shape: what a step MEANS by it is stated at
 * the step, not encoded in the constant's name.
 */
const SLOW_ONLY_TRIGGER: AlertTrigger = {
  type: 'event',
  kind: 'poisonProc',
  where: { effect: 'slow' }
}

/**
 * The trigger step 1 wrote (commit 57ae911) — both slow Strikes under one regex. It shipped,
 * so stores carry it; it is no longer what the app authors. Step 2's input, verbatim.
 */
const BOTH_SLOWS_TRIGGER: AlertTrigger = {
  type: 'event',
  kind: 'poisonProc',
  where: { effect: '/^(slow|spellSlow)$/' }
}

/** One appended rewrite of the shipped rogue-slow def. */
interface TriggerMigrationStep {
  /** the stamp a store must be BELOW for this step to run. Never renumbered. */
  version: number
  /** the def as this step leaves it, or null when this step has nothing to say about it. */
  rewrite: (def: AlertDef) => AlertDef | null
}

/**
 * THE CHAIN, oldest first. Append only — never edit or renumber a shipped entry.
 */
const STEPS: readonly TriggerMigrationStep[] = [
  {
    // 1 (2026-08-04, commit 57ae911): the original def → both slow effects, cooldown scoped
    // per mob. The scope is the half that survived; the widening is undone by step 2.
    version: 1,
    rewrite: (def) =>
      sameTrigger(def.trigger, SLOW_ONLY_TRIGGER)
        ? { ...def, trigger: BOTH_SLOWS_TRIGGER, cooldownScope: 'target' }
        : null
  },
  {
    // 2 (2026-08-04, the owner's revert): step 1's widened def → the melee slow alone.
    // `cooldownScope` is deliberately NOT touched — a def that reached here through step 1
    // already carries 'target', and a user who took it off since said something by doing so.
    version: 2,
    rewrite: (def) =>
      sameTrigger(def.trigger, BOTH_SLOWS_TRIGGER) ? { ...def, trigger: SLOW_ONLY_TRIGGER } : null
  }
]

/** Structural equality for a trigger — key order in a stored JSON object is not meaningful. */
function sameTrigger(a: AlertTrigger, b: AlertTrigger): boolean {
  if ('conditions' in a || 'conditions' in b) return false
  if (a.type !== b.type) return false
  if (a.type !== 'event' || b.type !== 'event') return false
  if (a.kind !== b.kind) return false
  const aw = a.where ?? {}
  const bw = b.where ?? {}
  const keys = Object.keys(aw)
  if (keys.length !== Object.keys(bw).length) return false
  return keys.every((k) => aw[k] === bw[k])
}

/**
 * Run the steps NEWER than `from` over the stored rogue-slow def. `from` is the store's
 * `alertTriggerMigration` stamp (absent ⇒ 0, every store written before the chain existed).
 *
 * `changed` counts defs whose SHAPE actually moved, compared start to finish rather than step
 * by step. That distinction is the difference between an honest count and a lie: a store that
 * has never been stamped runs 1 THEN 2, and those two steps take the original def out to the
 * widened trigger and straight back again. The def ends where it began, the caller must not
 * rewrite the store for it, and a second pass must agree — so a round trip counts as zero, and
 * `alerts` is returned by identity when nothing moved (the same contract `migrateAlertSounds`
 * returns).
 *
 * cooldownMs, sound, volume, name, note, speech and enabled are the USER'S and are never read
 * here; only `trigger` and `cooldownScope` are ours to move.
 */
export function migrateAlertTriggers(
  alerts: AlertDef[],
  from = 0
): { alerts: AlertDef[]; changed: number } {
  const steps = STEPS.filter((s) => s.version > from)
  if (steps.length === 0) return { alerts, changed: 0 }
  let changed = 0
  const next = alerts.map((a) => {
    if (a.id !== POISON_SLOW_ALERT_ID) return a
    let def = a
    for (const step of steps) def = step.rewrite(def) ?? def
    // No step claimed it — the overwhelmingly common case, and the one where `a.trigger` may be
    // a raw or composite shape `sameTrigger` deliberately refuses to compare.
    if (def === a) return a
    if (sameTrigger(def.trigger, a.trigger) && def.cooldownScope === a.cooldownScope) return a
    changed++
    return def
  })
  return { alerts: changed > 0 ? next : alerts, changed }
}
