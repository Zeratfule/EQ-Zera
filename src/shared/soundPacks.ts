// soundPacks.ts — WHICH PACK IS YOURS, WHICH ONES YOU THREW AWAY, AND WHAT PLAYS WHEN A REF
// POINTS AT SOMETHING THAT IS GONE (JOS-273).
//
// THE DEFECT THIS ANSWERS, in the reporter's words: "I like Alan Rickman as much as the next
// person, but it re-enables itself with every update and I have to delete it each time to use the
// pack I want — can I just set one and it sticks." Nothing was resetting: the shipped pack was
// HARDCODED as the pack every picker pre-selects and every suggested/seeded alert uses, and
// startup provisioning re-installed it whenever it was missing, additively and with no memory of
// a deletion. There was simply nothing to set. The owner's ruling, verbatim law: "if someone
// deletes alan rickman, they should be able to set a default and it should persist."
//
// SO THERE ARE THREE THINGS HERE, and they are separable on purpose:
//   1. THE PREFERENCE (`defaultPackId`) — the pack the pickers pre-select, the suggestion builder
//      authors against, and the seeds are written with. Absent means the SHIPPED default, which
//      is why a fresh install is unchanged by all of this.
//   2. THE TOMBSTONE (`removedPackIds`) — shipped pack ids the user deleted. Provisioning skips
//      them; installing one again from the registry browser clears its stone. Deletion is a
//      statement, and this is where it is remembered.
//   3. THE RESOLUTION (`resolveSoundRef`) — a ref whose pack (or sound) is gone resolves THROUGH
//      the preference instead of going silently mute, keeping the sound's INTENT by CESP category
//      (a completion sting stays a completion line). That mapping is the same argument
//      `migrateAlertSoundRef` makes for a retired pack in src/main/data/defaultPacks.ts — this is
//      its live, pack-agnostic form, and it reports WHY it answered what it did so a caller can
//      say so on screen rather than shrugging.
//
// PURE AND SHARED ON PURPOSE. Main serves the bytes (sounds.ts) and the renderer draws the
// pickers, so a second opinion about "which pack" is exactly how the two would drift. The shipped
// default id is NOT here — it is a fact about what src/main ships (data/defaultPacks.ts), and the
// renderer's mirror of it (features/alerts/suggestions.ts DEFAULT_PACK_ID) keeps its own
// mirror-sync law. Everything below takes that id as an ARGUMENT instead of importing it, which
// is what lets both sides stay honest about who owns it.
//
// Value imports stay RELATIVE (repo law for anything node:test loads); the type import is erased.

import type { AlertSoundRef, SoundPack } from './types'

/** The persisted blob. Both keys ABSENT is the shipped behaviour, and that is the common case. */
export interface SoundPackPrefs {
  /**
   * The pack every picker pre-selects and every authored alert points at. Absent ⇒ the shipped
   * default. It is NOT cleared when the pack it names is deleted — that is the whole point of the
   * ruling: the preference persists and the surface says the pack is gone.
   */
  defaultPackId?: string
  /**
   * SHIPPED pack ids the user removed. Only shipped ids are ever recorded, because this list has
   * exactly one reader (provisioning, which only ever considers shipped ids) — a user who tries
   * and discards twenty registry packs should not accumulate twenty rows of nothing.
   */
  removedPackIds?: string[]
}

/**
 * A pack id, as strictly as the rest of the app spells one.
 *
 * Deliberately the same shape as main's `isSafePackId` (src/main/security.ts), restated here
 * rather than imported because this module is shared and that one reaches into main's trust
 * boundary. It is a NORMALIZER's check, not the boundary — the IPC handler still validates what
 * the renderer sends. What it buys is that a hand-edited store can never put a path fragment
 * where a pack id goes.
 */
const PACK_ID = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/

function safeId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128 && PACK_ID.test(v)
}

/**
 * Read a stored blob into the shape above — total over `unknown`, like every prefs normalizer in
 * this app (store.ts's discipline: read through it, write through the SAME one).
 *
 * An unusable `defaultPackId` degrades to ABSENT, which is the shipped default — never to a
 * partial value, and never to a throw.
 */
export function normalizeSoundPackPrefs(raw: unknown): SoundPackPrefs {
  const v = (raw ?? {}) as Partial<SoundPackPrefs>
  const out: SoundPackPrefs = {}
  if (safeId(v.defaultPackId)) out.defaultPackId = v.defaultPackId
  const removed = Array.isArray(v.removedPackIds) ? v.removedPackIds.filter(safeId) : []
  if (removed.length > 0) out.removedPackIds = [...new Set(removed)].sort()
  return out
}

/**
 * Set (or clear, with null) the default pack.
 *
 * Clearing is a real answer and not a tidy-up: "use whatever the app ships" is what an absent key
 * has always meant, so choosing it again writes nothing rather than pinning today's shipped id.
 */
export function withDefaultPack(prefs: SoundPackPrefs, packId: string | null): SoundPackPrefs {
  const next: SoundPackPrefs = { ...prefs }
  if (packId !== null && safeId(packId)) next.defaultPackId = packId
  else delete next.defaultPackId
  return normalizeSoundPackPrefs(next)
}

/** Remember (or forget) that a shipped pack was deleted. Forgetting is what a re-install does. */
export function withTombstone(
  prefs: SoundPackPrefs,
  packId: string,
  removed: boolean
): SoundPackPrefs {
  const current = prefs.removedPackIds ?? []
  const next = removed ? [...current, packId] : current.filter((id) => id !== packId)
  return normalizeSoundPackPrefs({ ...prefs, removedPackIds: next })
}

/** Is this pack one the user deleted? (Only shipped ids are ever recorded — see the type.) */
export function isTombstoned(prefs: SoundPackPrefs, packId: string): boolean {
  return (prefs.removedPackIds ?? []).includes(packId)
}

// ---- the CESP category a derived soundId carries ------------------------------------
//
// Registry installs derive ids as `<category-slug>-<file-slug>` (sounds.ts `deriveSoundId`), so
// the category a sound BELONGED to is recoverable from the id itself. That is the whole mechanism
// behind keeping intent when a ref has to move packs: a `task-complete-*` line becomes another
// pack's `task-complete-*` line rather than whatever happens to sort first.

/**
 * The nine CESP categories, slugified exactly the way `deriveSoundId` slugifies them.
 *
 * The source of truth for the category NAMES is `CESP_CATEGORY_LABEL` in src/main/sounds.ts (the
 * conversion that writes these ids). This is the slug form of those same keys; it is a short
 * closed list that has not changed since the format was adopted, and a category missing from it
 * simply means "no intent recovered", which the fallback below already answers well.
 */
export const CESP_CATEGORY_SLUGS: readonly string[] = [
  'session-start',
  'session-end',
  'task-acknowledge',
  'task-progress',
  'task-complete',
  'task-error',
  'input-required',
  'resource-limit',
  'user-spam'
]

/**
 * The category slug a derived soundId starts with, or null when it carries none (a hand-made
 * pack, or the user's own imported audio, whose ids are just file slugs).
 *
 * LONGEST MATCH WINS, so `session-start-…` is never read as a shorter neighbour's prefix.
 */
export function soundCategorySlug(soundId: string): string | null {
  const id = soundId.toLowerCase()
  let best: string | null = null
  for (const slug of CESP_CATEGORY_SLUGS) {
    if (!id.startsWith(`${slug}-`)) continue
    if (!best || slug.length > best.length) best = slug
  }
  return best
}

/** What a pack can answer with for a given source id — same category first, else nothing. */
function sameCategorySound(pack: SoundPack, soundId: string): string | null {
  const slug = soundCategorySlug(soundId)
  if (!slug) return null
  return Object.keys(pack.sounds).find((id) => id.toLowerCase().startsWith(`${slug}-`)) ?? null
}

/** Why a resolution answered what it did — the caller SAYS this, it never swallows it. */
export type SoundRefStatus =
  /** The ref's own pack has the ref's own sound. Nothing moved. */
  | 'exact'
  /** The pack or the sound was gone; this is the honest stand-in (same category where possible). */
  | 'substituted'
  /** Nothing could answer — no pack resolved at all. The alert row must SAY so. */
  | 'missing'

export interface SoundRefResolution {
  packId: string
  soundId: string
  status: SoundRefStatus
  /** The pack the ref asked for, when that is not the one that answered. */
  askedPackId?: string
}

/** Where a substitution is allowed to land, and what it falls back to inside that pack. */
export interface SoundFallback {
  /** The user's default pack (the preference), or the shipped id when they have expressed none. */
  defaultPackId: string
  /**
   * The line to prefer inside the resolved pack when the source id carries no recoverable
   * category — the shipped pack's "A moment of your time, if you'd be so kind." in practice.
   * Absent (or missing from that pack) falls through to the pack's first sound.
   */
  fallbackSoundId?: string
}

/** First sound of a pack, or null for a pack with none (which is not listed anywhere anyway). */
function firstSound(pack: SoundPack): string | null {
  return Object.keys(pack.sounds)[0] ?? null
}

/**
 * WHAT ACTUALLY PLAYS for a stored `{packId, soundId}` — the no-silent-mute rule, as one function.
 *
 * Order, and the reason for each step:
 *   1. The ref as written. A working ref is never touched, so nothing about this is felt by a
 *      user whose packs are all present.
 *   2. The same pack, same CATEGORY — the sound went but the pack is still here (a re-cut pack, a
 *      removed custom sound). Staying inside the pack the user chose is more faithful than
 *      jumping to another one.
 *   3. The DEFAULT pack, same category — the pack is gone. This is the preference doing its job:
 *      the thing the user said is theirs answers for the thing that is not there.
 *   4. The default pack's stated fallback line, else its first sound — a pack with no line in that
 *      category still speaks rather than going quiet.
 *   5. `missing` — there is no pack at all to answer with. Nothing is invented; the caller says so.
 */
export function resolveSoundRef(
  ref: AlertSoundRef,
  packs: readonly SoundPack[],
  fallback: SoundFallback
): SoundRefResolution {
  const own = packs.find((p) => p.id === ref.packId)
  if (own?.sounds[ref.soundId]) return { packId: ref.packId, soundId: ref.soundId, status: 'exact' }
  if (own) {
    const near = sameCategorySound(own, ref.soundId) ?? firstSound(own)
    if (near) return { packId: own.id, soundId: near, status: 'substituted', askedPackId: ref.packId }
  }
  const def = packs.find((p) => p.id === fallback.defaultPackId)
  if (def) {
    const near =
      sameCategorySound(def, ref.soundId) ??
      (fallback.fallbackSoundId && def.sounds[fallback.fallbackSoundId]
        ? fallback.fallbackSoundId
        : null) ??
      firstSound(def)
    if (near) return { packId: def.id, soundId: near, status: 'substituted', askedPackId: ref.packId }
  }
  return { packId: ref.packId, soundId: ref.soundId, status: 'missing', askedPackId: ref.packId }
}

/**
 * The ref a SEEDED alert should be written with — the same resolution, entered from the other end.
 *
 * A seed names a shipped line by its derived id, so honouring the preference is two steps: point
 * the ref at the chosen pack FIRST (otherwise a ref that already resolves in the shipped pack
 * would be left there, which is the very thing the user asked to stop), then let `resolveSoundRef`
 * find that pack's line of the same category. Nothing installed, or no preference expressed, is
 * the identity function — which is what keeps a fresh install seeding exactly the bytes it always
 * did, before provisioning has even finished.
 */
export function seedSoundRef(
  ref: AlertSoundRef,
  packs: readonly SoundPack[],
  fallback: SoundFallback
): AlertSoundRef {
  const asked = { packId: fallback.defaultPackId, soundId: ref.soundId }
  const resolved = resolveSoundRef(asked, packs, fallback)
  return resolved.status === 'missing' ? asked : { packId: resolved.packId, soundId: resolved.soundId }
}

/**
 * The pack a picker should PRE-SELECT, and the pack an authored alert points at: the preference
 * when it is installed, else the shipped default, else whatever is installed at all.
 *
 * `null` means the machine has no sound pack — a real state (a first run before provisioning
 * finishes, or someone who deleted every pack), and the callers that draw a dropdown already have
 * an answer for it.
 */
export function preferredPack(
  packs: readonly SoundPack[],
  defaultPackId: string | undefined,
  shippedPackId: string
): SoundPack | null {
  return (
    (defaultPackId ? packs.find((p) => p.id === defaultPackId) : undefined) ??
    packs.find((p) => p.id === shippedPackId) ??
    packs[0] ??
    null
  )
}
