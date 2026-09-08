// useWishAlerts — the WISH-LIST DROP and WISH-LIST ZONE detectors, mounted once app-wide.
//
// Two watches, one hook, no return value: they sit beside the boss-kill, Sky-turn-in, level-up,
// quest-item and quest-complete watches in `components/AppCelebrations.tsx` so they fire on any
// tab. The DECIDING is all in `wishAlerts.ts`, which is pure; this file owns the baselines, the
// refs and the send.
//
// ── THE CELEBRATIONS LAW ──────────────────────────────────────────────────────────────────────
//
// Exactly once per LIVE transition, and hydration seeds a SILENT baseline. Both halves obey it,
// and each obeys it in the shape its own module has:
//
//   LOOT IS A LIST, SO THE BASELINE IS A LENGTH. The startup replay fills the `loot` module with
//   every item this character ever picked up, and the snapshot is APPEND-ONLY (a delta is a
//   concat, forever), so the count of rows already seen is an exact cursor. A timestamp is not:
//   EverQuest prints several loot lines in the same second, so `ts > baseline` drops the second
//   and third items of one instant and `ts >= baseline` re-fires the first. A snapshot SHORTER
//   than the baseline is a rebuild rather than a retraction, and it re-seeds silently. This is
//   `useQuestItemToast`'s reasoning verbatim, because it is the same module.
//
//   A ZONE IS A VALUE, SO THE BASELINE IS THE PREVIOUS VALUE. There is no "zone changed" event to
//   subscribe to — `CharacterSnap.zone` simply reads differently on a later snapshot — so the
//   transition is derived from a `prevRef`. The launch replay ends with the character standing
//   somewhere, so the FIRST value this hook sees is where you already are and not news: it is
//   recorded and says nothing, exactly as the level-up watch does with the level you logged in at.
//
// BOTH RESET ON A CHARACTER SWITCH, for the reason every detector in this app does: main rebuilt
// the world, and the next snapshot is that world's HISTORY rather than news.
//
// ── AND WHY THE ZONE CARD HAS A REPEAT WINDOW ─────────────────────────────────────────────────
//
// A zone change is a value change, and a corpse run, a bind rush or a two-minute errand out of the
// entrance and back are all zone changes. Saying the same sentence about the same place three
// times in five minutes is how a helpful card becomes a thing to switch off, so a zone that has
// spoken holds its tongue for half an hour. The window is keyed on the FOLDED zone (`zoneKey`), so
// re-entering the same place at a different instance tier is the same place.
//
// The wish list itself is read through `useWishlist`, which is ONE module-scope document shared by
// every surface (JOS-346) — so a wish added on the Gear tab is armed here in the same tick, with
// no remount and no re-read. It is read at FIRE time through a ref (the `intervalsRef` idiom) so
// the loot effect depends on the SNAPSHOT alone: adding a wish must not re-run a batch that has
// already been sent.

import { useEffect, useMemo, useRef } from 'react'
import type { CharacterSnap, LootSnap } from '@shared/types'
// RELATIVE value imports, matching the pure modules this hook drives (mobSearch house law).
import { catalogZonesFor } from '../../../../shared/zones'
import type { WishEntry } from '../../../../shared/planner/wishlist'
import type { ToastRequest } from '../../../../shared/toast'
import { useModule } from '../../lib/useModule'
import { sourceItemKey, sourcesFor } from '../../lib/itemSources'
import { fireAppSignal } from '../alerts/player'
import { zoneKey } from '../mobs/mobZone'
import { useWishlist } from './useWishlist'
import { wishDropRequests, wishZoneRequest } from './wishAlerts'

/** How long a zone keeps quiet after it has said what drops in it. */
const ZONE_REPEAT_MS = 30 * 60_000

/** The wish list, keyed the way every join in this app keys an item. */
function wishMap(entries: readonly WishEntry[]): ReadonlyMap<string, WishEntry> {
  const map = new Map<string, WishEntry>()
  for (const entry of entries) map.set(entry.itemKey, entry)
  return map
}

/**
 * Say it, on both channels at once.
 *
 * The SIGNAL is what makes it audible: `fireAppSignal` walks the user's own alert definitions, so
 * the sound, the speech and the banner are whatever they configured for this signal — the app
 * never picks a sound here. The TOAST is the card. Two surfaces, one live transition.
 */
function announce(signal: 'wishDrop' | 'wishZone', context: string, req: ToastRequest): void {
  fireAppSignal(signal, context)
  window.eq.showToast(req)
}

/** Watch the loot module and card every LIVE drop of a wished item. */
function useWishDrops(wishes: ReadonlyMap<string, WishEntry>): void {
  const snap = useModule<LootSnap>('loot')
  const wishesRef = useRef(wishes)
  wishesRef.current = wishes
  // null = "no baseline yet"; the first snapshot sets it and celebrates nothing.
  const baselineRef = useRef<number | null>(null)

  useEffect(
    () =>
      window.eq.onCharacter(() => {
        baselineRef.current = null
      }),
    []
  )

  useEffect(() => {
    if (!snap) return
    const baseline = baselineRef.current
    baselineRef.current = snap.length
    // First sight, or a rebuild that left fewer rows than we had counted: seed, say nothing.
    if (baseline === null || snap.length < baseline) return
    const events = snap.slice(baseline)
    if (events.length === 0) return
    for (const req of wishDropRequests(events, wishesRef.current, sourceItemKey)) {
      announce('wishDrop', req.itemName ?? req.title, req)
    }
  }, [snap])
}

/** Watch where the character is and card a zone that wished items drop in. */
function useWishZones(wishes: ReadonlyMap<string, WishEntry>): void {
  const zone = useModule<CharacterSnap>('character')?.zone
  const wishesRef = useRef(wishes)
  wishesRef.current = wishes
  // null = "we have not been told where we are yet"; the first value seeds and says nothing.
  const prevRef = useRef<string | null>(null)
  // folded zone → when it last spoke. Lives across snapshots, cleared on a character switch.
  const spokeRef = useRef<Map<string, number>>(new Map())

  useEffect(
    () =>
      window.eq.onCharacter(() => {
        prevRef.current = null
        spokeRef.current.clear()
      }),
    []
  )

  useEffect(() => {
    if (zone === undefined || zone === '') return
    const prev = prevRef.current
    prevRef.current = zone
    if (prev === null || prev === zone) return
    const now = Date.now()
    const key = zoneKey(zone)
    const last = spokeRef.current.get(key)
    if (last !== undefined && now - last < ZONE_REPEAT_MS) return
    const entries: WishEntry[] = []
    for (const entry of wishesRef.current.values()) entries.push(entry)
    const req = wishZoneRequest({ zone, wishes: entries, sourcesFor, zoneKey, aliases: catalogZonesFor(zone), now })
    if (!req) return
    spokeRef.current.set(key, now)
    announce('wishZone', zone, req)
  }, [zone])
}

/**
 * Watch the loot module and the character's zone, and card the wish list's own news. Mount once,
 * app-wide.
 */
export function useWishAlerts(): void {
  const { list } = useWishlist()
  const wishes = useMemo(() => wishMap(list.entries), [list])
  useWishDrops(wishes)
  useWishZones(wishes)
}
