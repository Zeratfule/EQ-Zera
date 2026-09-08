// alertSeeds.ts — the seeded alert set, written through the DEFAULT-PACK PREFERENCE (JOS-273).
//
// A FILE OF ITS OWN, AND NOT storeSoundPacks.ts, BECAUSE OF THE IMPORT GRAPH. The seeds live in
// store.ts (SEED_ALERTS), the preference is a key in the same store, and storeSoundPacks.ts
// imports `settingsStore` FROM store.ts — so putting this there and calling it from store.ts
// would make the settings store an import cycle, which is the hazard STORE_READY_MS already
// documents about the perf module. This module takes the stored value as an ARGUMENT and reaches
// nothing that reaches back, so the graph stays a tree. store.ts is also at the repo's
// 400-code-line factoring ceiling, whose stated answer is a split rather than a widened threshold.
//
// WHAT IT DOES, in one sentence: point each seeded ref at the pack the user chose, then let the
// shared resolver find that pack's line of the same CESP category (a completion sting stays a
// completion line — the intent-preserving rule `migrateAlertSoundRef` established for retired
// packs). With no preference stored, or with nothing installed yet, it is the identity function:
// a FRESH INSTALL seeds exactly the bytes it always did, which is what the owner's ruling asks.

import { normalizeSoundPackPrefs, seedSoundRef } from '../shared/soundPacks'
import { DEFAULT_ALERT_PACK_ID, DEFAULT_ALERT_SOUNDS } from './data/defaultPacks'
import { listPacks } from './sounds'
import type { AlertDef } from '../shared/types'

/**
 * Rewrite a seed list's sound refs onto the user's default pack.
 *
 * `storedPrefs` is the RAW `soundPacks` value off the store — normalized here, through the same
 * function every other reader of that key uses, so a hand-edited file cannot put a path fragment
 * where a pack id goes.
 */
export function seedAlertsWith(seeds: readonly AlertDef[], storedPrefs: unknown): AlertDef[] {
  const packId = normalizeSoundPackPrefs(storedPrefs).defaultPackId ?? DEFAULT_ALERT_PACK_ID
  const fallback = { defaultPackId: packId, fallbackSoundId: DEFAULT_ALERT_SOUNDS.buffWearsOff }
  const packs = listPacks()
  return seeds.map((a) => ({ ...a, sound: seedSoundRef(a.sound, packs, fallback) }))
}

// ---- the seeds themselves ---------------------------------------------------------------
//
// THEY LIVE HERE RATHER THAN IN store.ts, AND THAT MOVE IS THE REPO'S OWN ANSWER TO A FULL FILE.
// `src/main/store.ts` measured EXACTLY 400 code lines - the factoring ceiling - so the two
// wish-list seeds below could not be written there without widening a threshold, and the stated
// law is to SPLIT instead (windows.ts -> windowErrors.ts, store.ts -> storePlans.ts, uiScale.ts).
// This file already existed for the sound-repointing half of seeding and already imports exactly
// what the list needs, so the list joins the function that rewrites it. store.ts imports the name
// and nothing else about seeding changed: `getAlerts` still writes them only when the `alerts` key
// is ABSENT, and `resetAlerts` still rewrites them wholesale.

/**
 * Alerts seeded once, the first time the alerts store is empty. Kept minimal and
 * self-documenting: a charm-break warning (live 'uncharm' event), a boss-defeat
 * fanfare (renderer app signal), a Sky quest completion, and the two WISH-LIST signals.
 * A future agent adds more via saveAlert().
 */
export const SEED_ALERTS: AlertDef[] = [
  {
    id: 'charm-break',
    name: 'Charm break',
    enabled: true,
    trigger: { type: 'event', kind: 'uncharm' },
    // "I find myself... requiring your attention." — the calm-but-pointed read lands
    // better than a joke sting for suddenly losing your charmed pet (Task #21).
    sound: { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.charmBreak },
    note: 'Seeded default - fires when a charm spell wears off (you lose your pet).'
  },
  {
    id: 'boss-defeat',
    name: 'Raid target defeated',
    enabled: true,
    trigger: { type: 'app', signal: 'bossDefeat' },
    // "The matter is settled."
    sound: { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.bossDefeat },
    note: 'Seeded default - fires the same moment boss confetti does.'
  },
  {
    id: 'quest-complete',
    name: 'Sky quest complete',
    enabled: true,
    // Fires the same instant a Plane of Sky quest auto-completes from a detected
    // turn-in (giver received every required item) — the renderer's questComplete
    // app signal, fired exactly where the quest-complete confetti + snackbar do
    // (Task #46). Never fires on load/hydration or manual checkbox completion.
    trigger: { type: 'app', signal: 'questComplete' },
    // "It is done."
    sound: { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.questComplete },
    note: 'Seeded default - fires the same moment a Sky quest turn-in celebration does.'
  },
  {
    id: 'wish-drop',
    name: 'Wished item dropped',
    enabled: true,
    // A SEEDED DEF IS WHAT MAKES A SIGNAL AUDIBLE. `fireAppSignal` walks the user's OWN alert
    // list, so a signal nothing is defined against plays nothing - the card would appear in
    // silence. These two ship enabled for the same reason the boss fanfare does: the feature is
    // the sound, and an alert the user never asked for is one row to switch off.
    trigger: { type: 'app', signal: 'wishDrop' },
    // The completion sting: the thing you wrote down that you wanted just landed in your bags.
    sound: { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.questComplete },
    note: 'Seeded default - fires when you loot an item on your wish list.'
  },
  {
    id: 'wish-zone',
    name: 'Wished items drop here',
    enabled: true,
    trigger: { type: 'app', signal: 'wishZone' },
    // The acknowledge blip rather than a second fanfare: walking into a zone is a heads-up, not
    // a win, and a completion sting for "you could farm this here" would cry wolf on every gate.
    sound: { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.debuffLands },
    note: 'Seeded default - fires when you enter a zone where a wished item drops.'
  }
]
