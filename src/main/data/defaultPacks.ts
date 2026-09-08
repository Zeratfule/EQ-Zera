// defaultPacks.ts — the pack the app ships with, defined once.
//
// EQ ZERA (2026-09-06): THE SHIPPED DEFAULT IS `eq-zera-console`, an ORIGINAL synthesized pack
// (scripts/gen-sounds.mts) that is COMMITTED under resources/soundpacks/ and bundled by
// electron-builder.yml like the wiki art — so it is on disk in a source checkout, in `npm run dev`
// and in every installer, and nothing is downloaded at first launch. `DEFAULT_PACKS` (the list the
// runtime self-provisioner installs from the registry) is therefore EMPTY; the Alan Rickman pack
// that used to be provisioned stays installable from the in-app Sound Packs browser, and its
// registry entry below is kept because the legacy-migration tables were written against it.
//
// The paragraphs that follow describe the upstream history that shaped the tables.
//
// WHY ONE PACK: the app used to self-provision the PeonPing og-packs `peon` +
// `sc_marine` packs and seed alerts against a synthesized `default` chime pack. Those
// read as robotic/joke defaults; the shipped default is now Alan Rickman — spoken-word
// lines that fit EverQuest's tone. The synthesized `default` pack is GONE (its
// generator + assets were deleted, Task #57); `peon`/`sc_marine` were never ours —
// they're still in the openpeon registry and installable from the in-app Sound Packs
// browser. Provisioning only ADDS what's missing and never removes a pack on disk.
//
// STABLE SOUND IDS: the pack is pinned to a release TAG, so its openpeon.json is
// immutable and the ids the shared CESP→manifest conversion derives (deriveSoundId:
// "<category-slug>-<file-slug>") are deterministic and identical whether the pack
// arrives via self-provisioning, `npm run fetch:packs`, or a user-initiated registry
// install. DEFAULT_ALERT_SOUNDS below are those derived ids; provisionPacks verifies
// they resolved after an install, so drift is caught in errors.log rather than silently
// muting an alert.

import type { AlertDef, AlertSoundRef, RegistryPack } from '../../shared/types'
// The curated one-click alert GROUPS live in shared/ (the renderer authors them and cannot
// import from src/main). Their sound ids are pulled in here so provisionPacks verifies THEM
// too after an install — a group that quietly resolves to a missing file is a mute alert.
import { GROUP_SOUND_IDS } from '../../shared/alertGroups'

/** The default pack's id (== its directory under resources/soundpacks == its manifest id). */
export const DEFAULT_ALERT_PACK_ID = 'eq-zera-console'

/** The registry pack the app USED to provision as its default (kept for the migration tables). */
export const ALAN_RICKMAN_PACK_ID = 'alan-rickman'

/**
 * The registry entry we provision from, inlined so first run needs ZERO registry
 * requests (one tarball GET, at a pinned tag). Field-for-field the same shape the
 * openpeon index serves, so provisioning reuses the tested installPack path and
 * produces a byte-identical install to clicking "Install" in the Sound Packs dialog.
 */
export const DEFAULT_PACK: RegistryPack = {
  name: ALAN_RICKMAN_PACK_ID,
  display_name: 'Alan Rickman',
  source_repo: 'utensils/openpeon-alan-rickman-soundpack',
  source_ref: 'v1.1.2',
  source_path: '.',
  categories: [
    'input.required',
    'resource.limit',
    'session.start',
    'task.acknowledge',
    'task.complete',
    'task.error'
  ],
  sound_count: 60,
  total_size_bytes: 1964096,
  description:
    'Claudette notification sounds, voiced in the manner of the late Alan Rickman. Slow. Deliberate. Faintly amused.',
  license: 'CC-BY-4.0',
  version: '1.1.2'
}

/**
 * Sound ids the shipped alert defs reference (derived, see header). Split out so the
 * seeded alerts (src/main/store.ts) and the suggested-alert templates
 * (src/renderer/src/features/alerts/suggestions.ts — renderer, so it repeats the
 * literals) name the same lines, and so provisionPacks can verify them post-install.
 */
export const DEFAULT_ALERT_SOUNDS = {
  /** the alternating alarm — charm broke, you've lost your pet. */
  charmBreak: 'input-required-alarm-01',
  /** the fanfare — raid target down. */
  bossDefeat: 'task-complete-fanfare-01',
  /** the victory arpeggio — a Sky quest turn-in completed. */
  questComplete: 'task-complete-fanfare-02',
  /** the siren — a buff wore off you/your pet. */
  buffWearsOff: 'input-required-alarm-02',
  /** the low double thud — a buff faded on your pet/target. */
  buffFade: 'resource-limit-thud-01',
  /** the two-tone blip — a debuff landed on a target. */
  debuffLands: 'task-acknowledge-blip-01',
  /** the descending buzz — your illusion dropped. */
  illusionFade: 'task-error-buzz-01'
} as const

/**
 * Every sound id the shipped defaults depend on (verified after provisioning) — the seeded
 * alerts' lines PLUS every line the curated alert groups (shared/alertGroups.ts) point at.
 */
export const REQUIRED_SOUND_IDS: string[] = [
  ...new Set([...Object.values(DEFAULT_ALERT_SOUNDS), ...GROUP_SOUND_IDS])
]

/** The packs the app provisions from the registry on startup if missing: NONE - the default is bundled. */
export const DEFAULT_PACKS: RegistryPack[] = []

/** The pack ids the app ships with (and provisions on startup if missing). */
export const DEFAULT_PACK_IDS: string[] = DEFAULT_PACKS.map((p) => p.name)

// ---- Retired-pack → Alan Rickman alert migration (Task #57) --------------------
//
// Alerts persist a `{packId, soundId}` pair, so alerts authored before the default
// changed still point at packs the app no longer ships (`default`, which no longer
// EXISTS anywhere, plus the `peon` / `sc_marine` / `bastion` packs the app used to
// provision or that a user tried out). store.ts runs the rewrite below exactly once per
// install (version-stamped) so an upgrading user's existing alerts land on the shipped
// pack instead of silently going mute when the old dir is gone.
//
// The rewrite is pack-wide and one-way: any ref into a legacy pack becomes an
// alan-rickman ref. Those packs stay installable from the in-app registry browser — a
// user who reinstalls one can re-point any alert at it, and this migration never runs
// again to undo that.

/**
 * Packs whose alert refs the one-time migration rewrites onto the shipped default.
 *
 * ADDING AN ID HERE POINTS EVERY UNSTAMPED USER'S ALERTS AWAY FROM THAT PACK, so the list is
 * pinned verbatim by tests/alertSoundMigrationPin.test.mts. In particular
 * `DEFAULT_ALERT_PACK_ID` may never appear in it: that would make the rewrite a rewrite of
 * itself and, paired with a version bump, would re-point every alert in the fleet.
 */
export const LEGACY_ALERT_PACK_IDS: string[] = ['default', 'peon', 'sc_marine', 'bastion']

/**
 * Bumped when the mapping below changes in a way that should re-run for every user.
 *
 * IT IS A FLEET-WIDE REWRITE SWITCH, NOT A VERSION NUMBER (JOS-272). A bump makes
 * `alertSoundMigrationPending` true again for EVERY install that has ever run this app, and the
 * next `getAlerts()` on each of them re-runs the rewrite against whatever the mapping says at that
 * moment. That is a legitimate thing to want — a retired pack really can need re-pointing later —
 * but it is never a thing to do incidentally, and it has no undo: the stamp records that the
 * rewrite ran, not what it did.
 *
 * `tests/alertSoundMigrationPin.test.mts` freezes this number, `LEGACY_ALERT_PACK_IDS`, and the
 * whole input→output table below. Bumping any of them turns that suite red, which is the point: the
 * change becomes something a human states in a diff rather than something that happens.
 */
export const ALERT_SOUND_MIGRATION_VERSION = 1

/**
 * Does this store still owe the retired-pack rewrite? The gate `store.ts` runs, extracted so it can
 * be driven without Electron (JOS-272).
 *
 * A store stamped at or ABOVE the current version is finished — including a store stamped by a
 * NEWER build, which must never be walked backwards through an older build's mapping. Anything that
 * is not a whole number at all (absent, or hand-edited to nonsense) counts as never migrated, which
 * is the safe direction: running the rewrite once too often on legacy refs costs nothing, and
 * legacy refs are the only thing it can touch.
 */
export function alertSoundMigrationPending(stamp: unknown): boolean {
  return !(typeof stamp === 'number' && Number.isInteger(stamp) && stamp >= ALERT_SOUND_MIGRATION_VERSION)
}

/**
 * CESP category → the Alan Rickman line a legacy sound in that category becomes.
 * Registry-derived ids are `<category-slug>-<file-slug>` (bastion: `task-complete-3`),
 * so the category is recoverable from the id itself and the replacement keeps the
 * alert's INTENT (a "complete" sting stays a completion line).
 */
const LEGACY_CATEGORY_SOUND: Record<string, string> = {
  'session-start': 'session-start-power-01', // the power-on arpeggio
  'session-end': DEFAULT_ALERT_SOUNDS.questComplete, // "It is done."
  'task-acknowledge': DEFAULT_ALERT_SOUNDS.debuffLands,
  'task-progress': DEFAULT_ALERT_SOUNDS.debuffLands,
  'task-complete': DEFAULT_ALERT_SOUNDS.bossDefeat,
  'task-error': DEFAULT_ALERT_SOUNDS.illusionFade,
  'input-required': DEFAULT_ALERT_SOUNDS.buffWearsOff,
  'resource-limit': DEFAULT_ALERT_SOUNDS.buffFade,
  'user-spam': 'user-spam-click-01'
}

/**
 * The four ids of the deleted synthesized `default` pack, mapped by the ROLE each one
 * played in the old seeded/suggested alerts (they carried no category prefix at all):
 * the victory fanfare fired on a kill, the two-tone warning was the charm break.
 */
const LEGACY_DEFAULT_PACK_SOUND: Record<string, string> = {
  victory: DEFAULT_ALERT_SOUNDS.bossDefeat,
  warning: DEFAULT_ALERT_SOUNDS.charmBreak,
  chime: DEFAULT_ALERT_SOUNDS.buffWearsOff,
  horn: DEFAULT_ALERT_SOUNDS.buffFade
}

/** Curated `peon` / `sc_marine` id prefixes → CESP category. */
const LEGACY_PREFIX_CATEGORY: [string, string][] = [
  ['session-start-', 'session-start'],
  ['session-end-', 'session-end'],
  ['task-acknowledge-', 'task-acknowledge'],
  ['task-progress-', 'task-progress'],
  ['task-complete-', 'task-complete'],
  ['task-error-', 'task-error'],
  ['input-required-', 'input-required'],
  ['resource-limit-', 'resource-limit'],
  ['user-spam-', 'user-spam'],
  ['start-', 'session-start'],
  ['ack-', 'task-acknowledge'],
  ['complete-', 'task-complete'],
  ['error-', 'task-error'],
  ['input-', 'input-required'],
  ['limit-', 'resource-limit'],
  ['spam-', 'user-spam']
]

/** Legacy ids with no prefix at all (peon's two session.start lines). */
const LEGACY_EXACT_CATEGORY: Record<string, string> = {
  ready: 'session-start',
  'need-doing': 'session-start'
}

/** Recover the CESP category a legacy soundId belonged to, or null if unrecognizable. */
function legacyCategory(soundId: string): string | null {
  const id = soundId.toLowerCase()
  if (LEGACY_EXACT_CATEGORY[id]) return LEGACY_EXACT_CATEGORY[id]
  for (const [prefix, category] of LEGACY_PREFIX_CATEGORY) {
    if (id.startsWith(prefix)) return category
  }
  return null
}

/**
 * Rewrite one alert sound ref onto the shipped pack when it points at a retired pack.
 * Refs already on `alan-rickman` (or on any other user-installed pack) are returned
 * unchanged — this only touches the ids in LEGACY_ALERT_PACK_IDS. An unrecognizable
 * legacy id falls back to the "needs your attention" line rather than staying mute.
 */
export function migrateAlertSoundRef(sound: AlertSoundRef): AlertSoundRef {
  if (!LEGACY_ALERT_PACK_IDS.includes(sound.packId)) return sound
  const byRole = LEGACY_DEFAULT_PACK_SOUND[sound.soundId.toLowerCase()]
  const category = legacyCategory(sound.soundId)
  const soundId =
    byRole ??
    (category ? LEGACY_CATEGORY_SOUND[category] : undefined) ??
    DEFAULT_ALERT_SOUNDS.buffWearsOff
  return { packId: DEFAULT_ALERT_PACK_ID, soundId }
}

/**
 * Apply migrateAlertSoundRef across an alert list. Returns the (possibly new) list plus
 * how many defs changed, so the caller can skip the store write when nothing moved.
 */
export function migrateAlertSounds(alerts: AlertDef[]): { alerts: AlertDef[]; changed: number } {
  let changed = 0
  const next = alerts.map((a) => {
    const sound = migrateAlertSoundRef(a.sound)
    if (sound.packId === a.sound.packId && sound.soundId === a.sound.soundId) return a
    changed++
    return { ...a, sound }
  })
  return { alerts: changed > 0 ? next : alerts, changed }
}

/**
 * raw.githubusercontent base for a pack's pinned release tree (no trailing slash).
 * Used by scripts/fetch-packs.mts to pull individual files; the in-app installer
 * fetches the release tarball instead (one request).
 */
export function packRawBase(pack: RegistryPack): string {
  const sub =
    pack.source_path && pack.source_path !== '.'
      ? pack.source_path.replace(/\\/g, '/').replace(/^\/|\/$/g, '')
      : ''
  const root = `https://raw.githubusercontent.com/${pack.source_repo}/${pack.source_ref}`
  return sub ? `${root}/${sub}` : root
}
