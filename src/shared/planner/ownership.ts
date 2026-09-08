// ============================================================================
// planner/ownership.ts — DO I OWN THIS, WHERE IS IT, AND AT WHAT +N (JOS-282,
// Gear Planner phase 1).
// ============================================================================
//
// A PURE FOLD over the deep inventory model (`shared/outputs/inventory.ts`) into the one
// question a gear planner asks about every candidate item: does the player already have it,
// in which of the six places the dump can name, and at which upgrade level. No fs, no
// Electron, no renderer deps — both tsconfigs see it and the node runner imports it directly
// (`tests/plannerOwnership.test.mts`).
//
// It lives beside `inventorySlots.ts` rather than in `outputs/` for one stated reason: it
// JOINS the client's Location tokens to the planner's `EquipSlot` vocabulary, and the outputs
// model declines to do that on purpose ("deliberately NOT reconciled … a future character
// sheet that needs the join gets a hand-authored, evidence-verified table", law 12). That
// table is `SLOT_OF_LOCATION`, right next door, and this module READS it — it never
// re-derives a second opinion about which client token is which wiki slot.
//
// ---------------------------------------------------------------------------
// THE KEY, AND WHY LOOT HISTORY CAN JOIN ON IT
// ---------------------------------------------------------------------------
// One key rule, spelled by ONE function the whole tree already agrees on: strip the ` +N`
// suffix, fold case (law 2 — canonicalize at COUNTING boundaries, display raw). It has three
// homes because three layers cannot import each other, and they are pinned to agree:
//
//   * `shared/itemStats.ts itemTierKey`   — the shared spelling. THIS module calls it.
//   * `main/itemsDb.ts itemKey`           — `itemBaseName(name).toLowerCase()`, i.e. the same
//                                           two calls; the committed item corpus is filed
//                                           under it, so an ownership row joins a candidate
//                                           row by key with no translation.
//   * `renderer/lib/itemName.ts itemCountKey` — the loot/quest counting key.
//
// `tests/itemTierWindows.test.mts` already asserts `itemTierKey === itemCountKey` on every
// distinct `+N` name in the real log; `tests/plannerOwnership.test.mts` re-states it for this
// index and for `itemVariantLevel` vs the tier this module records, so the loot-history join
// cannot drift.
//
// A DUMP NAME CARRIES DECORATIONS THE LOOT LINE NEVER DOES — a trailing `*` and the client's
// own ` (Exaltation)` marker. Those are split off by the dump's own parser
// (`parseItemName`), and the shared key function is applied to what is LEFT. So the key is
// still spelled by `itemTierKey` and nothing here invents a second strip rule.
//
// ---------------------------------------------------------------------------
// +N IS A ROW, NOT A KEY (the design decision this module is built on)
// ---------------------------------------------------------------------------
// A `+2` in the bank and a `+0` on your head are TWO ownership rows under ONE key. Folding
// them would answer "do you own a Cloak of Flames" and destroy "at what +N", which is half
// the question — and with phase 0 (`shared/itemUpgrade.ts`) every stat depends on the plus
// state, so a planner that loses the tier cannot compute anything. `tier` is therefore
// per-row and OPTIONAL: absent means the name carried no suffix, NOT `+0` (the same rule
// `InventoryHost.tier` and `itemTierFromName` already state).
//
// ---------------------------------------------------------------------------
// BAG CONTENTS vs EXALTATION SOCKETS (both are `-Slot<n>`; keep them apart)
// ---------------------------------------------------------------------------
// The outputs header is explicit that the file does NOT say which a child row is: a bag's
// contents and an item's exaltation sockets are both spelled `<parent>-Slot<n>`, and `Slots`
// is only "how many child slots this row provides". Two signals exist, and `containment`
// uses them in this order:
//
//   1. The CHILD'S OWN NAME. `<Item> (Exaltation)` is the client stating it, and it is the
//      only certain signal the file gives. It wins outright.
//   2. THE PLACE KIND of the row's base token. A `-Slot<n>` hanging one level off a NUMBERED
//      CONTAINER (`General 3`, `Bank7`, `SharedBank2`, `Personal-Depot1`) is that container's
//      contents; anything else nested is a socket. An equipment slot holds gear, not a bag.
//
// HONEST LIMIT: rule 2 is the dump's naming convention doing the work, not a column. A
// socketed exaltation whose name did NOT carry the marker, sitting one level under a General
// slot, would read as bag contents. No dump in this repo contains such a row — every socket
// row in the committed 295-line dump spells `(Exaltation)` — and `looksLikeContainer()` is
// the outputs model's opt-in structural guess for a caller that wants a second opinion. This
// module does not bake that guess in; it reports what the file states.
//
// ---------------------------------------------------------------------------
// THE KEYRING, AND THE `Activated` EXCLUSION THIS MODULE INHERITS
// ---------------------------------------------------------------------------
// Keyring rows are ownership — a reporter's Plane of Sky quest items lived on his `Equipment`
// keyring and NOWHERE else — so they are indexed, with `where: 'keyring'` and a count of 1
// per row (the table has no Count column; a copy is a row).
//
// WHICH categories count is NOT this module's decision. It reads `HELD_KEYRING_CATEGORIES`
// (shared/outputs/inventory.ts), today a set of one, and inherits the exclusion documented at
// inventory.ts:337-351 VERBATIM in its reasoning: `Activated` stays OUT under the
// awaiting-sample law. Its single observed member whole-corpus is `Guise of the Deceiver`, an
// illusion clicky, and one row is no evidence about whether that category holds a COPY or a
// RECEIPT for a consumed item. JOS-185 recorded wiki evidence pointing the other way (the
// live client's Activated Items Key Ring is described as a bin you PLACE NONEXPENDABLE items
// in) and deliberately did not act on it, because the bar is a dump and a wiki sentence is
// not one. THE DAY THAT CATEGORY GRADUATES, IT GRADUATES THERE AND THIS INDEX FOLLOWS FOR
// FREE — do not add a second roster here, and do not guess.
//
// `Empty`/blank rows never become ownership: an `Empty` row is the client stating that a slot
// was ENUMERATED, never that anything is in it.

import {
  HELD_KEYRING_CATEGORIES,
  walkEntries,
  type ContainerKind,
  type InventoryDump,
  type InventoryEntry,
  type InventoryPlace,
  type KeyRingEntry
} from '../outputs/inventory'
import { itemTierFromName, itemTierKey } from '../itemStats'
import { SLOT_OF_LOCATION } from './inventorySlots'
import type { EquipSlot } from './types'

/**
 * WHERE a thing you own is — the six places a dump can name, plus the honest seventh.
 * `inventory` is the character's own bags and loose slots (`General N`); `keyring` is a held
 * keyring category; `unknown` is a base token the outputs model could not classify, kept
 * rather than coerced into the nearest member.
 */
export type OwnershipPlace =
  | 'equipped'
  | 'inventory'
  | 'bank'
  | 'sharedBank'
  | 'personalDepot'
  | 'keyring'
  | 'unknown'

/** How a row hangs off the row above it — see "BAG CONTENTS vs EXALTATION SOCKETS". */
export type OwnershipContainment = 'top' | 'bag' | 'socket'

/**
 * `ContainerKind` → the place it is. A `Record` over the union rather than a switch, so a
 * container kind added to the outputs model turns this file red instead of silently filing
 * a new storage area under `unknown`.
 */
const PLACE_OF_CONTAINER: Record<ContainerKind, OwnershipPlace> = {
  general: 'inventory',
  bank: 'bank',
  sharedBank: 'sharedBank',
  personalDepot: 'personalDepot'
}

const HELD_KEYRING_SET: ReadonlySet<string> = new Set(HELD_KEYRING_CATEGORIES)

/** One thing you own, in one place, at one plus level. */
export interface OwnershipRow {
  /** the index key — `ownershipKey` of the item's base name */
  key: string
  /** the item's name with the dump's own decorations split off (no ` +N`, `*`, `(Exaltation)`) */
  name: string
  /** the Name column verbatim, for display and for diagnosing a key */
  rawName: string
  /** which of the six places this is */
  place: OwnershipPlace
  /** the outputs model's classified base token; absent for a keyring row, which has no Location */
  basePlace?: InventoryPlace
  /** the Location column verbatim; `''` for a keyring row */
  location: string
  /**
   * the planner CELL-less slot an EQUIPPED row fills, straight from `SLOT_OF_LOCATION`.
   * `null` is a client token that names no wiki slot on purpose (`Any Slot`, `Held`);
   * absent means the row is not equipped. Cell assignment (which ear, which ring) is
   * `equippedHosts`' job and is deliberately not repeated here.
   */
  slot?: EquipSlot | null
  /** the ` +N` the name stated. ABSENT means the name carried none — NOT `+0`. */
  tier?: number
  /** how many copies this row states (a Count of 0 or nonsense is 1; a keyring row is 1) */
  count: number
  /** the section the row was read under (`Location` for the primary item table) */
  section: string
  /** the client spelled `<Item> (Exaltation)` — this row is a socketed exaltation */
  exaltation: boolean
  /** how this row hangs off the row above it */
  containment: OwnershipContainment
  /** the name of the row this one is nested in — the bag it is in, or the item it is socketed
   *  into. Absent at top level (and for an orphan, whose parent the file never printed). */
  parentName?: string
  /** the KeyRing category, for keyring rows only */
  keyRingCategory?: string
  /** the ID column; 0 when absent or non-numeric */
  itemId: number
  /** 1-based line number in the source dump */
  line: number
}

/** itemKey → every row that names it, in file order. */
export type OwnershipIndex = ReadonlyMap<string, readonly OwnershipRow[]>

/**
 * THE INDEX'S KEY, for any spelling of an item name — a dump row, a loot line, a wiki title.
 *
 * It is `itemTierKey` verbatim and nothing else: one statement in the tree about what a `+N`
 * suffix is. `main/itemsDb.ts itemKey` and `renderer/lib/itemName.ts itemCountKey` are the
 * same rule in the two layers that cannot import this one, and the tests pin all three
 * together.
 */
export function ownershipKey(name: string): string {
  return itemTierKey(name)
}

/** A dump row's base token → the place it is. */
export function placeOfLocation(place: InventoryPlace): OwnershipPlace {
  if (place.kind === 'equip') return 'equipped'
  if (place.kind === 'container') return PLACE_OF_CONTAINER[place.container]
  return 'unknown'
}

/** See "BAG CONTENTS vs EXALTATION SOCKETS" — the child's own name first, the place kind after. */
function containmentOf(entry: InventoryEntry): OwnershipContainment {
  if (entry.path.length === 0) return 'top'
  if (entry.parsedName.exaltation) return 'socket'
  if (entry.place.kind === 'container' && entry.path.length === 1) return 'bag'
  return 'socket'
}

function rowFromEntry(entry: InventoryEntry, parent: InventoryEntry | undefined): OwnershipRow {
  const parsed = entry.parsedName
  const row: OwnershipRow = {
    key: ownershipKey(parsed.base),
    name: parsed.base,
    rawName: entry.name,
    place: placeOfLocation(entry.place),
    basePlace: entry.place,
    location: entry.location,
    // the same rule `heldCountsFromDump` counts by: a Count of 0 or nonsense is one copy.
    count: entry.count > 0 ? entry.count : 1,
    section: entry.section,
    exaltation: parsed.exaltation,
    containment: containmentOf(entry),
    itemId: entry.itemId,
    line: entry.line
  }
  if (parsed.tier !== undefined) row.tier = parsed.tier
  if (entry.place.kind === 'equip') row.slot = SLOT_OF_LOCATION[entry.place.token]
  if (parent) row.parentName = parent.parsedName.base
  return row
}

function rowFromKeyRing(entry: KeyRingEntry): OwnershipRow {
  const parsed = entry.parsedName
  const row: OwnershipRow = {
    key: ownershipKey(parsed.base),
    name: parsed.base,
    rawName: entry.name,
    place: 'keyring',
    location: '',
    // the keyring table has no Count column at all: a copy is a row (the duplicate
    // `Boots of the Long Road +1` rows are two boots, not a count of two).
    count: 1,
    section: entry.section,
    exaltation: parsed.exaltation,
    containment: 'top',
    keyRingCategory: entry.category,
    itemId: entry.itemId,
    line: entry.line
  }
  if (parsed.tier !== undefined) row.tier = parsed.tier
  return row
}

/**
 * Is `entry` the row `candidate` is nested inside?
 *
 * The tree is walked depth-first, parents before children, so the nearest ancestor still on
 * the stack whose Location is a `-Slot` prefix of this row's IS its parent. Prefix rather
 * than an exact one-level compare because the stack is popped from the top down; and prefix
 * on `<location>-Slot` specifically, so `Personal-Depot11` is never read as a child of
 * `Personal-Depot1` (the compound base token the outputs model warns about).
 */
function isAncestorOf(entry: InventoryEntry, candidate: InventoryEntry): boolean {
  return candidate.location.startsWith(`${entry.location}-Slot`)
}

/**
 * THE FOLD: a parsed dump → every thing you own, filed by item key.
 *
 * Rows are in file order within a key, so the first row of a key is the first the client
 * wrote. Every item-shaped section counts (JOS-185: an item is yours wherever the client
 * filed it) — `section` rides along so a positional reader can still ask the `Location`
 * table alone.
 */
export function ownershipIndex(dump: InventoryDump): OwnershipIndex {
  const out = new Map<string, OwnershipRow[]>()
  const add = (row: OwnershipRow): void => {
    const rows = out.get(row.key)
    if (rows) rows.push(row)
    else out.set(row.key, [row])
  }

  const ancestors: InventoryEntry[] = []
  for (const entry of walkEntries(dump.items)) {
    while (ancestors.length > 0 && !isAncestorOf(ancestors[ancestors.length - 1], entry)) {
      ancestors.pop()
    }
    const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined
    ancestors.push(entry)
    if (entry.empty) continue
    add(rowFromEntry(entry, parent))
  }

  for (const entry of dump.keyRing) {
    if (!HELD_KEYRING_SET.has(entry.category)) continue
    if (entry.name === '' || entry.name === 'Empty') continue
    add(rowFromKeyRing(entry))
  }

  return out
}

/** Every row for a name, in any spelling. Empty when the dump never named it. */
export function ownershipRowsFor(index: OwnershipIndex, name: string): readonly OwnershipRow[] {
  return index.get(ownershipKey(name)) ?? []
}

// ---------------------------------------------------------------------------
// THE TRANSPORT (JOS-285, phase 4) — the index as one IPC payload.
// ---------------------------------------------------------------------------
//
// A `Map` is not what an IPC payload is, so the index crosses as its ENTRIES and is rebuilt on
// the other side by `ownershipIndexFrom`. The two functions sit here, beside the fold, so the
// shape has one definition rather than a main-side writer and a renderer-side reader that agree
// by inspection.
//
// NO VERSION FIELD, unlike `GearIndexPayload` — and that is a difference in KIND, not an
// oversight. The gear index's version guards a stat VECTOR whose keys and units are a contract;
// this payload is `OwnershipRow` verbatim, derived at runtime from a file on the player's disk by
// the same build that reads it. There is no bytes-from-another-version case to refuse.

/** One key's rows, in the shape a structured clone actually carries. */
export type OwnershipEntry = readonly [key: string, rows: readonly OwnershipRow[]]

/**
 * A keyring category the player's dump NAMES and this index does not count.
 *
 * It exists so the surface joining on this index can state the exclusion over the player's OWN
 * file rather than as a sentence about EverQuest in general: "your dump has 1 row on an Activated
 * key ring, which this app does not count". "Not counted" is not "not owned" — see the KEYRING
 * section above — and the roster is `HELD_KEYRING_CATEGORIES`', never a second one written here.
 */
export interface UncountedKeyRing {
  category: string
  /** how many non-empty rows the dump filed under it */
  rows: number
}

/** Everything a joining surface needs: the index, where it came from, and what it left out. */
export interface OwnershipPayload {
  /** the dump this was folded from; null when the character has never written one */
  path: string | null
  /** the dump's own mtime — WHEN THE PLAYER wrote it, never when we folded it */
  loadedAt: string | null
  entries: readonly OwnershipEntry[]
  uncounted: readonly UncountedKeyRing[]
}

/** The answer for a character with no dump: not "you own nothing", but "there is nothing to read". */
export const NO_OWNERSHIP: OwnershipPayload = {
  path: null,
  loadedAt: null,
  entries: [],
  uncounted: []
}

/** Every keyring category the dump names that `HELD_KEYRING_CATEGORIES` does not admit. */
export function uncountedKeyRings(dump: InventoryDump): UncountedKeyRing[] {
  const counts = new Map<string, number>()
  for (const entry of dump.keyRing) {
    if (HELD_KEYRING_SET.has(entry.category)) continue
    if (entry.name === '' || entry.name === 'Empty') continue
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
  }
  return [...counts].map(([category, rows]) => ({ category, rows }))
}

/** The fold plus its provenance, as one payload. `null` in ⇒ `NO_OWNERSHIP` out. */
export function ownershipPayload(
  loaded: { path: string; loadedAt: string; dump: InventoryDump } | null
): OwnershipPayload {
  if (!loaded) return NO_OWNERSHIP
  return {
    path: loaded.path,
    loadedAt: loaded.loadedAt,
    entries: [...ownershipIndex(loaded.dump)],
    uncounted: uncountedKeyRings(loaded.dump)
  }
}

/** The transport's inverse: entries back into the index every reader above expects. */
export function ownershipIndexFrom(entries: readonly OwnershipEntry[]): OwnershipIndex {
  return new Map(entries)
}

/** How many copies these rows state, all places and all plus levels together. */
export function ownedCount(rows: readonly OwnershipRow[]): number {
  let total = 0
  for (const row of rows) total += row.count
  return total
}

/**
 * The best plus level among these rows. `undefined` when no row's name stated one — which is
 * NOT `+0`: an un-suffixed name is a name that said nothing, and phase 0's scaler needs to
 * know the difference.
 */
export function highestTier(rows: readonly OwnershipRow[]): number | undefined {
  let best: number | undefined
  for (const row of rows) {
    if (row.tier !== undefined && (best === undefined || row.tier > best)) best = row.tier
  }
  return best
}

/** The answer for a name that came off a LOOT line rather than out of the dump. */
export interface LootOwnership {
  /** `ownershipKey(name)` — the same key the index is filed under */
  key: string
  /** the ` +N` the LOOT line spelled; absent means it carried none, NOT `+0` */
  tier?: number
  /** the rows the dump holds under that key, in file order */
  rows: readonly OwnershipRow[]
  /** the log says this was looted and the dump names no copy of it — the flag later phases
   *  raise ("you had this; it is not in the dump you exported") */
  missingFromDump: boolean
}

/**
 * THE LOOT-HISTORY JOIN SURFACE.
 *
 * Loot history is keyed the `renderer/lib/itemName.ts` way — `itemCountKey` for the key and
 * `itemVariantLevel` for the ` +N` — and this module cannot import the renderer. It uses the
 * SHARED spellings of the same two rules instead (`itemTierKey`, `itemTierFromName`), which
 * is safe because the tests pin them equal on real `+N` names.
 *
 * ONE deliberate difference, and it is the shared side that is right for a planner:
 * `itemVariantLevel` answers `0` for an un-suffixed name while `itemTierFromName` answers
 * `undefined`. "The name said nothing" and "the name said +0" are different facts here, so a
 * caller comparing against `itemVariantLevel` must read `tier ?? 0`.
 */
export function ownershipForLootName(index: OwnershipIndex, name: string): LootOwnership {
  const key = ownershipKey(name)
  const rows = index.get(key) ?? []
  const tier = itemTierFromName(name)
  const out: LootOwnership = { key, rows, missingFromDump: rows.length === 0 }
  if (tier !== undefined) out.tier = tier
  return out
}
