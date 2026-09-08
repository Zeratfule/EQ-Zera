// ============================================================================
// shared/carryAll.ts — EVERYTHING YOU CARRY (JOS-327): every dump row, flattened once.
// ============================================================================
//
// The character sheet answers "what am I wearing". This answers the other half of the same
// file: "where is everything else". `/outputfile inventory` enumerates the whole of a
// character's possessions — worn slots and their sockets, every bag slot, the bank, the
// tradeskill depot, the key rings — and until this module the app read all of it and DREW
// twenty-four cells of it. The rest was parsed, counted into `heldCounts`, and never shown to
// the person who typed the command.
//
// So this is a FLATTENING, not a new source of knowledge. Types + pure derivations only — no
// fs, no Electron, no React — so both tsconfigs see it and the node runner drives it against
// the committed dump (`tests/carryAll.test.mts`). Everything it produces is either a verbatim
// column of the file or a classification whose evidence is written down beside it.
//
// ---------------------------------------------------------------------------
// THE ROWS SAY WHAT THE FILE SAYS, INCLUDING THE ` +N`
// ---------------------------------------------------------------------------
// `name` is the Name column verbatim: it keeps the ` +N` upgrade suffix, the trailing `*` whose
// meaning the file never states, and the client's own ` (Exaltation)` marker on a socket row.
// Law 2 strips those at COUNTING boundaries; this is not one. A player reading this table is
// looking for the thing they own, and the thing they own is `Drop of Crystallized Flame +7` —
// a table that quietly showed them `Drop of Crystallized Flame` would be answering a question
// about item identity that they did not ask.
//
// `location` is the Location column verbatim too (`Ear-Slot7`, `General 1-Slot9-Slot7`,
// `Personal-Depot1`), section-qualified when the row did not come from the primary table. It is
// deliberately NOT prettified into `General 1 / Slot 9`: the dump's spelling is the spelling the
// player can search for, and it is the string they will see again the next time they open the
// file themselves.
//
// EMPTY ROWS ARE NOT CARRIED. An `Empty` row is evidence that the client ENUMERATED that slot
// and nothing more (shared/outputs/inventory.ts spells out why — the owner's dump lists six
// `SharedBank` slots on a game whose wiki says there is no shared bank). A ledger of what you
// carry is a ledger of things; a slot is not a thing.
//
// ---------------------------------------------------------------------------
// THE LANES ARE THE FILTER CHIPS, AND FOUR OF THE SIX ARE MEASURED
// ---------------------------------------------------------------------------
// `worn` / `bags` / `bank` / `depot` are read straight off `InventoryPlace`, which is itself a
// closed, measured classification of the client's own base tokens. `keyring` is every row of
// every keyring-shaped section — ALL categories, not just the held ones: `HELD_KEYRING_CATEGORIES`
// answers "does this add to a count", and this table answers "what does the file list", which is
// a different and weaker question. `Activated` therefore appears here while it stays out of
// `heldCountsFromDump`, and that is not a contradiction.
//
// THE DRAGON'S HOARD, AND WHY THERE IS NO CHIP NAMED AFTER IT. `/outputfile inventory` is
// documented to export "Dragon's Hoard items if the Dragon's Hoard window is open"
// (eqlwiki.com/Commands, quoted in shared/outputs/inventory.ts) — but NO dump in this repo or
// anywhere on the internet contains one, so nobody knows what the hoard's rows look like: a
// section of their own, or base tokens inside the `Location` table. Hard-coding a `Dragon Hoard`
// chip would be a claim about a table nobody has seen, which is exactly the awaiting-sample law's
// subject. Both shapes are handled instead, and both SAY WHAT THE FILE SAID:
//
//   * a second item-shaped section becomes a lane of its OWN, labelled with the section's name
//     verbatim — so the day a hoard dump arrives, the chip reads whatever the client called it;
//   * a base token in the `Location` table that `parsePlace` cannot classify lands in
//     `elsewhere`, visible and searchable rather than dropped.
//
// Neither lane exists in the owner's dump today, so neither chip is drawn — a chip for an empty
// lane is a dead control. When the evidence arrives the surface grows a chip with no code change,
// and if the hoard turns out to want a name of its own, THAT is the edit a real dump earns.

import {
  PRIMARY_ITEM_SECTION,
  walkEntries,
  type ContainerKind,
  type InventoryDump,
  type InventoryEntry,
  type InventoryPlace,
  type KeyRingEntry
} from './outputs/inventory'

// ---- the lanes -------------------------------------------------------------------------

/** Rows from an item-shaped section that is not the primary one get `section:<name>`. */
export const SECTION_LANE_PREFIX = 'section:'

/**
 * The lanes that exist whatever the dump holds, in chip order. Storage first, in roughly the
 * order a player would reach for it, then the key rings (a registry rather than a container),
 * then the honest catch-all.
 */
export const FIXED_LANES = ['worn', 'bags', 'bank', 'depot', 'keyring', 'elsewhere'] as const

export type FixedLaneId = (typeof FIXED_LANES)[number]

/**
 * What each fixed lane is CALLED on screen. `Depot` is the client's own word (`Personal-Depot1`);
 * `Key rings` is plural because the file's category column says there is more than one.
 */
export const LANE_LABELS: Record<FixedLaneId, string> = {
  worn: 'Worn',
  bags: 'Bags',
  bank: 'Bank',
  depot: 'Depot',
  keyring: 'Key rings',
  elsewhere: 'Elsewhere'
}

/**
 * Which chip each numbered container answers to. A `Record` over the closed `ContainerKind`
 * rather than a switch, so a container kind added to the model without a chip is a TYPE ERROR
 * here — which is the only moment anyone would remember to name it.
 *
 * The two banks are deliberately ONE chip: they are the same answer to "did I leave it at a
 * banker", and the location column still says which of them the file named.
 */
const CONTAINER_LANES: Record<ContainerKind, FixedLaneId> = {
  general: 'bags',
  bank: 'bank',
  sharedBank: 'bank',
  personalDepot: 'depot'
}

/** Which lane a classified place belongs to. Total over `InventoryPlace`, by construction. */
function laneOfPlace(place: InventoryPlace): FixedLaneId {
  if (place.kind === 'equip') return 'worn'
  if (place.kind === 'container') return CONTAINER_LANES[place.container]
  return 'elsewhere'
}

/** Which lane an item row belongs to — its section first, then its place. */
export function laneOfEntry(entry: InventoryEntry): string {
  if (entry.section !== PRIMARY_ITEM_SECTION) return `${SECTION_LANE_PREFIX}${entry.section}`
  return laneOfPlace(entry.place)
}

/** A lane's on-screen name: the table above, or the section's own name for a `section:` lane. */
export function laneLabel(id: string): string {
  if (id.startsWith(SECTION_LANE_PREFIX)) return id.slice(SECTION_LANE_PREFIX.length)
  return LANE_LABELS[id as FixedLaneId] ?? id
}

// ---- the rows --------------------------------------------------------------------------

/** One thing the dump says this character has, and where the dump says it is. */
export interface CarryRow {
  /** the Name column verbatim - keeps ` +N`, `*` and ` (Exaltation)` (see the header) */
  name: string
  /**
   * `name`, lowercased ONCE here rather than per keystroke — the house search pattern
   * (lib/search.ts).
   *
   * THE NAME ONLY, AND THAT IS A DIVISION OF LABOUR RATHER THAN AN OVERSIGHT. This surface has
   * two controls and each owns one axis: the box asks WHAT, the chips ask WHERE. Folding the
   * location into the haystack was tried and MEASURED against the owner's dump — the word `ring`
   * went from 11 rows to 48, because `KeyRing` is spelled into all 37 keyring locations, and a
   * player typing `ring` is unambiguously looking for jewellery.
   */
  searchKey: string
  /** the Location column verbatim, section-qualified off the primary table (see the header) */
  location: string
  /**
   * How many. The Count column, except that a 0 or nonsense count reads as 1 — the same rule
   * `heldCountsFromDump` has always used, kept identical here so the ledger and the counts
   * cannot disagree about a row in front of the player's eyes.
   */
  count: number
  /** which filter chip owns this row */
  lane: string
  /** 1-based line number in the dump: a stable key, and the first thing to look at when a row surprises */
  line: number
}

/** One filter chip: what it is called, and how many rows it holds. */
export interface CarryLane {
  id: string
  label: string
  count: number
}

/** The whole flattened ledger, plus the chips that partition it. */
export interface CarryAll {
  rows: CarryRow[]
  /** in chip order; a lane with no rows is never emitted, because a chip that filters to nothing
   *  is a control that can only disappoint */
  lanes: CarryLane[]
}

/** The section-qualified location text — bare for the primary table, prefixed everywhere else. */
function locationText(section: string, within: string): string {
  return section === PRIMARY_ITEM_SECTION ? within : `${section} / ${within}`
}

function rowOfEntry(entry: InventoryEntry): CarryRow {
  return {
    name: entry.name,
    searchKey: entry.name.toLowerCase(),
    location: locationText(entry.section, entry.location),
    count: entry.count > 0 ? entry.count : 1,
    lane: laneOfEntry(entry),
    line: entry.line
  }
}

/**
 * A keyring row. The table has no Count column at all and a copy is one row — the same reading
 * `heldCountsFromDump` takes, and the reason the owner's dump can list `Boots of the Long Road +1`
 * twice without either row claiming a count of two.
 */
function rowOfKeyRing(entry: KeyRingEntry): CarryRow {
  return {
    name: entry.name,
    searchKey: entry.name.toLowerCase(),
    // The category is the only "where" a keyring row has, so it IS the location path here.
    location: `${entry.section} / ${entry.category}`,
    count: 1,
    lane: 'keyring',
    line: entry.line
  }
}

/** Does this row name a thing, or merely a slot the client enumerated? (See the header.) */
function namesAThing(name: string): boolean {
  return name !== '' && name !== 'Empty'
}

/**
 * The lanes present in a row set, in chip order: the fixed lanes in `FIXED_LANES` order, then any
 * `section:` lane in the order the file wrote its sections. Counts come from the rows themselves,
 * so a chip can never print a number the table cannot produce.
 */
function lanesOf(rows: readonly CarryRow[], sections: readonly string[]): CarryLane[] {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.lane, (counts.get(row.lane) ?? 0) + 1)

  const order: string[] = [
    ...FIXED_LANES,
    ...sections.filter((s) => s !== PRIMARY_ITEM_SECTION).map((s) => `${SECTION_LANE_PREFIX}${s}`)
  ]
  // Any lane the order missed still gets a chip, at the end: a row the UI cannot filter to is a
  // row the UI is hiding, and this file would rather grow an odd-looking chip than do that.
  for (const id of counts.keys()) {
    if (!order.includes(id)) order.push(id)
  }

  const lanes: CarryLane[] = []
  for (const id of order) {
    const count = counts.get(id)
    if (count !== undefined) lanes.push({ id, label: laneLabel(id), count })
  }
  return lanes
}

/**
 * The dump → one flat ledger, in FILE ORDER.
 *
 * Sorted by line rather than by walk order so the table reads exactly like the file the player can
 * open in Notepad — including an orphan row, which the parser keeps at top level and which would
 * otherwise be lifted out of its neighbourhood by the depth-first walk.
 */
export function carryAll(dump: InventoryDump): CarryAll {
  const rows: CarryRow[] = []
  for (const entry of walkEntries(dump.items)) {
    if (entry.empty || !namesAThing(entry.name)) continue
    rows.push(rowOfEntry(entry))
  }
  for (const entry of dump.keyRing) {
    if (!namesAThing(entry.name)) continue
    rows.push(rowOfKeyRing(entry))
  }
  rows.sort((a, b) => a.line - b.line)
  return { rows, lanes: lanesOf(rows, dump.sections) }
}
