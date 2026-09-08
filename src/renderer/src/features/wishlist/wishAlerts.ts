// wishAlerts.ts — WHICH WISH-LIST NEWS DESERVES A CARD, as two pure functions.
//
// The hook beside this file (`useWishAlerts.ts`) owns the live-only baselines, the refs and the
// sending; everything that DECIDES lives here, with no DOM, no React and no `window`, so
// `tests/wishAlerts.test.mts` can pin every rule under plain node — the `questItemToast.ts`
// shape, which this file is deliberately a sibling of.
//
// ── THE TWO THINGS A WISH LIST CAN TELL YOU ───────────────────────────────────────────────────
//
//   1. IT DROPPED. A loot line naming an item on the list. That is the whole rule: the wish is
//      keyed on `itemKey(name)` (shared/planner/wishlist.ts) and so is the join, so a `+2` suffix
//      or a capitalisation difference cannot make the app miss a thing the user asked to be told
//      about. The card prints the LOG'S OWN spelling (world-model law 2) and carries the mob and
//      the zone the line stated, because "where did that come from" is the next question.
//
//   2. IT DROPS HERE. You walked into a zone the catalog says a wished item comes from. The card
//      counts them and names the first few; the list itself is one click away.
//
// ── V1 IS YOUR OWN LOOT, DELIBERATELY ─────────────────────────────────────────────────────────
//
// EverQuest prints a line when somebody ELSE loots off a corpse you can see, and this feature
// does not react to it — because the log corpus this app is built against does not contain one:
// ZERO "someone else looted" lines across 138 committed fixtures. A detector written against a
// line shape nobody has ever seen is a guess, and a guess that fires is worse than silence
// (world-model law 1). `LootEvent` is the self-loot lane and that is the lane this reads.
//
// ── A DESTROY IS NOT A DROP ───────────────────────────────────────────────────────────────────
//
// `You successfully destroyed 38 Bone Chips.` rides the same lane as an acquisition (JOS-401,
// lootDisposition.isDestroyed). Congratulating someone for throwing away the thing they wrote
// down that they wanted is the one card this feature must never draw.
//
// ── THE ZONE JOIN IS THE `mobsInZone` RULE, NOT A NEW ONE ─────────────────────────────────────
//
// Two naming authorities, folded by `zoneKey` on BOTH sides, UNIONED with the verified rename
// table (`catalogZonesFor`) — log "The Ruins of Old Paineel" is catalog "The Hole". Both halves
// arrive as ARGUMENTS rather than imports so this module stays pure and the node test can drive
// the real ones. There is no fuzzy matching here and there must never be one: the catalog carries
// a genuinely distinct "Paineel" AND "The Hole".
//
// No `.filter`/`.sort`/`.reduce`/`.flatMap` anywhere below: `LootEvent` and `WishEntry` are both
// declared under `src/shared/`, which makes them domain rows to eslint.domainMunging.mjs. Loops.

import type { LootEvent } from '@shared/types'
// RELATIVE value imports (the mobSearch.ts house law): the `@shared` alias exists only inside the
// vite build, and `tests/wishAlerts.test.mts` drives this module under the node runner.
import { isDestroyed } from '../../../../shared/lootDisposition'
import type { WishEntry } from '../../../../shared/planner/wishlist'
import type { ToastRequest } from '../../../../shared/toast'

/** How many wished items a zone card NAMES before it starts counting instead. */
export const WISH_ZONE_NAMED = 3

/** Everything the zone question needs, as one argument (the four-parameter ceiling). */
export interface WishZoneArgs {
  /** the character's RAW zone, as the log spelled it — instance suffixes, articles and all */
  zone: string
  wishes: readonly WishEntry[]
  /** `lib/itemSources.sourcesFor`, injected so this module stays pure */
  sourcesFor: (key: string) => readonly { zones: readonly string[] }[]
  /** `features/mobs/mobZone.zoneKey`, applied to BOTH sides of every comparison */
  zoneKey: (z: string) => string
  /** `shared/zones.catalogZonesFor(zone)` — the verified renames, or `[]` for most zones */
  aliases: readonly string[]
  now: number
}

// ---- 1. it dropped ---------------------------------------------------------------------------

/**
 * The supporting line: where the log said the item came from.
 *
 * Both halves are OPTIONAL on a `LootEvent` and each is printed only when the line stated it —
 * a card that said "from a corpse" about a line naming no mob would be inventing the corpse.
 */
function dropSubtitle(e: LootEvent): string | undefined {
  const parts: string[] = []
  if (e.source) parts.push(`from ${e.source}`)
  if (e.zone) parts.push(e.zone)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** One loot line's card, or null when it earns none. */
function dropRequestFor(
  e: LootEvent,
  wished: ReadonlyMap<string, WishEntry>,
  itemKeyOf: (name: string) => string
): ToastRequest | null {
  if (isDestroyed(e)) return null
  const key = itemKeyOf(e.item)
  if (key === '' || !wished.has(key)) return null
  const req: ToastRequest = {
    // The item key plus the line's own timestamp: two loots of one item are two cards, and the
    // same push seen twice refreshes one.
    id: `wishDrop:${key}:${String(e.ts)}`,
    kind: 'wishDrop',
    // The log's own spelling, ` +2` and all (world-model law 2).
    title: `${e.item} dropped`,
    itemName: e.item,
    focus: { view: 'wishlist' }
  }
  const subtitle = dropSubtitle(e)
  if (subtitle !== undefined) req.subtitle = subtitle
  return req
}

/**
 * Every card a batch of new live loot lines earns, in the order the lines arrived.
 *
 * `wished` is keyed on `WishEntry.itemKey` and `itemKeyOf` is the renderer's spelling of the same
 * rule (`lib/itemSources.sourceItemKey`) — one join key, injected, so the test drives the real one.
 */
export function wishDropRequests(
  events: readonly LootEvent[],
  wished: ReadonlyMap<string, WishEntry>,
  itemKeyOf: (name: string) => string
): ToastRequest[] {
  const out: ToastRequest[] = []
  for (const e of events) {
    const req = dropRequestFor(e, wished, itemKeyOf)
    if (req) out.push(req)
  }
  return out
}

// ---- 2. it drops here ------------------------------------------------------------------------

/** The folded keys this zone answers to: its own, plus every verified catalog rename. */
function zoneKeys(args: WishZoneArgs): Set<string> {
  const keys = new Set<string>()
  const own = args.zoneKey(args.zone)
  if (own !== '') keys.add(own)
  for (const alias of args.aliases) {
    const k = args.zoneKey(alias)
    if (k !== '') keys.add(k)
  }
  return keys
}

/** Does the catalog name ANY mob in one of these folded zones that drops this item? */
function dropsHere(args: WishZoneArgs, itemKey: string, keys: ReadonlySet<string>): boolean {
  for (const source of args.sourcesFor(itemKey)) {
    for (const z of source.zones) if (keys.has(args.zoneKey(z))) return true
  }
  return false
}

/**
 * The wished items the catalog says drop in this zone, in list order.
 *
 * Exported so the test can pin the JOIN separately from the prose the card wraps it in — the
 * grammar and the "and N more" tail are one claim, "this alias reaches these items" is another.
 * An unknown or blank zone matches nothing rather than everything.
 */
export function wishZoneItems(args: WishZoneArgs): string[] {
  const keys = zoneKeys(args)
  const names: string[] = []
  if (keys.size === 0) return names
  for (const wish of args.wishes) {
    if (dropsHere(args, wish.itemKey, keys)) names.push(wish.name)
  }
  return names
}

/**
 * The headline. ONE ITEM IS SINGULAR, because a card that says "1 wished items drop here" reads
 * as a bug to the person holding it, and this app writes sentences rather than templates.
 */
function zoneTitle(count: number): string {
  return count === 1 ? '1 wished item drops here' : `${String(count)} wished items drop here`
}

/** The names, capped, with the remainder counted rather than listed. */
function zoneSubtitle(names: readonly string[]): string {
  const shown: string[] = []
  for (const name of names) {
    if (shown.length >= WISH_ZONE_NAMED) break
    shown.push(name)
  }
  const rest = names.length - shown.length
  const listed = shown.join(' · ')
  return rest > 0 ? `${listed} and ${String(rest)} more` : listed
}

/**
 * The card for "you just walked into a place your list cares about", or null when nothing here is
 * wished for. The REPEAT WINDOW is the caller's (the hook keeps a per-zone map): this decides
 * whether there is news, not how often to say it.
 */
export function wishZoneRequest(args: WishZoneArgs): ToastRequest | null {
  const names = wishZoneItems(args)
  if (names.length === 0) return null
  return {
    // The folded zone plus the instant: re-entering a zone an hour later is a second card.
    id: `wishZone:${args.zoneKey(args.zone)}:${String(args.now)}`,
    kind: 'wishZone',
    title: zoneTitle(names.length),
    subtitle: zoneSubtitle(names),
    focus: { view: 'wishlist' }
  }
}
