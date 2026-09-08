// zoneLoot.ts — the ZONE LOOT joins, as pure functions (ROADMAP §2).
//
// The Zone Loot tab answers one question: "I am going to <zone> - who lives there, what do they
// drop, and have I ever had any of it?" That is three joins over corpora this app already holds,
// and this file is all three of them and nothing else. No React, no Electron, no IPC:
// `tests/zoneLoot.test.mts` drives it over the committed catalog under the node test runner, which
// is why every VALUE import below is spelled RELATIVE (the mobSearch.ts house law - the `@shared`
// alias exists only inside the vite build).
//
// THERE IS NO RARITY COLUMN, AND THAT IS THE DATA'S ANSWER RATHER THAN A V1 CUT. The committed mob
// catalog (`data/eqlegends/mobs.json`) states `known_loot` as a list of item NAMES and nothing
// else - no per-drop rarity, no drop rate (see mobTypes.ts, "Deliberately COMPACT"). The rarity the
// ROADMAP note imagines lives on the LIVE wiki lookup, which is one IPC round trip PER MOB, and a
// zone is up to 343 of them. So a rarity column here would either be blank or invented, and law 1
// says neither. What the surface CAN say honestly is what YOU have observed, which is the column
// that is here instead.
//
// THE ERA VERDICT IS THE APP'S ONE VERDICT, ASKED THE WAY A RENDERER CAN ASK IT. `dropEraSubject`
// (features/mobs/dropEra.ts) builds the subject from the item KEY alone - `donorEra` inverts the
// mob catalog, so a zone row gets a real answer with zero IPC. What it cannot see is the item
// page's own era BANNER (`MobDrop.eraTag`), which main attaches and which is the witness that
// catches a REVAMP: the Fear revamp's seven Cazic Thule drops read `in-era` from here, because the
// zone is classic and only the banner says the contents were replaced. That is a KNOWN and stated
// limit of this surface, not a disagreement with the mob page - the mob page prefers main's
// annotated list when it has one, and this tab has no per-mob lookup to prefer.
//
// THE UPGRADE VERDICT IS INJECTED, NEVER IMPORTED (`ZoneLootArgs.verdict`). "Does this beat what I
// wear" needs the gear index and the player's inventory dump, both of which arrive over IPC into
// React hooks; this file stays a pure fold over the catalog and takes the answer as a function, so
// the node test can drive the join with three items and no browser. Absent is the honest default: a
// table built with no verdict function carries no verdicts, which is a different thing from a table
// of items that are not upgrades.
//
// THE FOLD RULE IS THE MOB PAGE'S, verbatim (dropEra.ts, "THE FOLD RULE"): out-of-era rows are
// HIDDEN behind one "+N out of era" disclosure; in-era AND unknown rows are shown plainly. A row
// nothing has a verdict about is the wiki's own claim and stays sayable.

import type { MobEntry } from '@shared/types'
import type { PlanSlotId } from '@shared/planner/types'
// RELATIVE value imports, per the header.
import { dropEraSubject, dropIsOutOfEra } from '../mobs/dropEra'
import { mobsInZone, zoneKey } from '../mobs/mobZone'
import type { EraSubject } from '../planner/plannerData'

/**
 * The composite row key's separator, spelled as an ESCAPE and never as a raw byte (AGENTS.md,
 * "Toolchain gotchas" - a literal control byte makes git classify the file as binary and takes
 * diffs, blame and grep with it). U+0001 cannot occur in a wiki page title or an item name, so
 * `page + SEP + itemKey` is collision-proof without any quoting.
 */
const KEY_SEP = '\u0001'

/**
 * THE JOIN KEY ONTO YOUR OWN LOOT, and it is deliberately the same function `windowItemRows`
 * groups by (`shared/lootRates.ts`: `const key = e.item.toLowerCase()`, which is `lootGrouping.ts`'s
 * `itemKey`). Spelled here as one named function so the two sides of the join cannot drift into
 * two slightly different normalizations - the failure mode of that drift is a silent zero in the
 * "Yours" column, which reads as "you have never had one" rather than as a bug.
 *
 * NOT the `+N`-folding `countKey`: a `Sphinx Claw +1` is its own row in the ledger and its own row
 * here, because the wiki lists the base item and the upgrade as separate drops too.
 */
export function lootItemKey(item: string): string {
  return item.toLowerCase()
}

/** One pickable zone: the fold key, a display spelling, and how many catalog mobs live there. */
export interface ZoneOption {
  /** `mobZone.zoneKey` fold - the identity two catalog spellings merge on. */
  key: string
  /** The FIRST-SEEN catalog spelling for that key. What the picker shows and the reader types. */
  zone: string
  /** Distinct catalog mobs whose `zones` reach this key. */
  mobs: number
}

/**
 * Every zone the committed catalog knows, A-Z, with a mob count.
 *
 * DERIVED FROM THE CATALOG, exactly the way `questSearch.QUEST_ZONES` derives its own list - and
 * emphatically NOT from `features/maps/MapZoneSelect`, which picks map-file STEMS from the packs
 * installed on this machine. A zone with no map file still has a bestiary, and a map file for a
 * zone the catalog has never heard of is not a pickable answer.
 *
 * The fold is `zoneKey`, so the catalog's own inconsistencies merge: `Cazic Thule` and
 * `Cazic-Thule` are one option of 30 mobs, not two options of 28 and 2. A mob spelling both
 * spellings counts ONCE (the inner `seen` set), so the count is mobs and never mentions.
 *
 * ORDER is by display name, because the reader is scanning for a place they can already name. The
 * `.sort` is over `ZoneOption[]` - this file's own type, declared here - so ruling 4's no-munging
 * rule does not reach it; nothing below ever sorts or filters an array of `MobEntry`.
 */
export function zoneOptions(catalog: readonly MobEntry[]): ZoneOption[] {
  const byKey = new Map<string, ZoneOption>()
  for (const mob of catalog) {
    const counted = new Set<string>()
    for (const raw of mob.zones ?? []) {
      const key = zoneKey(raw)
      if (key === '' || counted.has(key)) continue
      counted.add(key)
      const opt = byKey.get(key)
      if (opt) opt.mobs += 1
      else byKey.set(key, { key, zone: raw, mobs: 1 })
    }
  }
  const out = [...byKey.values()]
  out.sort((a, b) => a.zone.localeCompare(b.zone))
  return out
}

/** ONE (mob, drop) pair: what the wiki says drops here, and what your own log says about it. */
export interface ZoneLootRow {
  /** `mobPage + '\u0001' + itemKey` - unique across the zone, stable across renders. */
  key: string
  /** The mob's in-game name, as the wiki page writes it. */
  mob: string
  /** The wiki page title - the mob's identity, since a name can name several pages. */
  mobPage: string
  /** Level EXACTLY as the page states it ("36-40", "~53"); absent when the page states none. */
  level?: string
  /** The item name, as the catalog lists it. What the drill-down is opened on. */
  item: string
  /** `lootItemKey(item)` - the join onto your loot history. */
  itemKey: string
  /** The era question, never a verdict: the chip asks `eraChip` the same way every other row does. */
  era: EraSubject
  /** Positively out of era ⇒ folded behind the disclosure. In-era and unknown are both `false`. */
  outOfEra: boolean
  /** Σ stack sizes YOU have looted of this item in this zone. 0 means never, not unknown. */
  seen: number
  /** Drops per hour of active time in this zone, or null when there is no time to divide by. */
  perHour: number | null
  /**
   * This drop beats what you wear, under the Build tab's profile - the cell it would take and the
   * gain. Absent is the ordinary answer, and it covers four different silences on purpose: no
   * inventory dump, no gear-index row for this name, nothing this loadout can wear, or simply an
   * item that is not better. None of them is a claim, so none of them draws a chip.
   */
  upgrade?: ZoneUpgrade
}

/** The verdict a row carries, flattened to what the chip draws. */
export interface ZoneUpgrade {
  cell: PlanSlotId
  delta: number
  /** the cell is empty - the whole score is the gain */
  againstNothing: boolean
}

/** What the whole zone, or a filtered slice of it, adds up to. */
export interface ZoneLootSummary {
  /** Distinct mobs that drop SOMETHING among these rows (a mob with no loot has no row). */
  mobs: number
  drops: number
  outOfEra: number
  /** Σ of `seen` - how much of this table you have actually had. */
  seen: number
  /** Rows carrying an upgrade verdict. Rows, not distinct items: a drop is a row per mob. */
  upgrades: number
}

/** What your own history says about one item key. Absent from the map ⇒ you have never had one. */
export interface SeenRate {
  drops: number
  perHour: number | null
}

export interface ZoneLootArgs {
  /** A zone as the picker spells it - a catalog spelling. `mobsInZone` does the folding. */
  zone: string
  catalog: readonly MobEntry[]
  /** `lootItemKey` -> your counts. Built by `useZoneLoot`; empty is a perfectly good answer. */
  seenByItem: ReadonlyMap<string, SeenRate>
  /**
   * "Does this drop beat what I wear?", INJECTED rather than imported - `useUpgradeFinder` needs
   * the gear index, the inventory dump and three React hooks, none of which a node test can hold.
   * Absent is the honest default: a table with no verdict function simply carries no verdicts.
   * It takes the display NAME because the fold onto `GearRow.key` is the finder's business and
   * this file's `itemKey` deliberately keeps a ` +N` suffix (see `lootItemKey`).
   */
  verdict?: (item: string) => ZoneUpgrade | null
}

/**
 * The zone's whole table: one row per (mob, drop), mobs LOWEST LEVEL FIRST and drops in the
 * page's own order.
 *
 * The mob order is `mobsInZone`'s and is not re-decided here - "what can I fight" is the same
 * question on this tab as on the Mobs tab, so it had better be the same answer. Within a mob the
 * catalog's order is the wiki page's order, which is the closest thing the corpus has to an
 * opinion about which drop matters.
 *
 * A DROP LISTED TWICE ON ONE PAGE YIELDS ONE ROW. Duplicate spellings do occur in the corpus, and
 * two rows keyed identically is a React key collision rather than an extra fact.
 */
export function zoneLootRows(args: ZoneLootArgs): ZoneLootRow[] {
  const { zone, catalog, seenByItem, verdict } = args
  const rows: ZoneLootRow[] = []
  // The verdict is asked ONCE per distinct item in the zone, not once per (mob, drop): one item off
  // eleven mobs is one comparison, and the answer cannot differ between them.
  const verdicts = new Map<string, ZoneUpgrade | null>()
  // `mobsInZone` predates readonly parameters; the assertion widens variance and never writes.
  for (const mob of mobsInZone(zone, catalog as MobEntry[])) {
    const emitted = new Set<string>()
    for (const item of mob.drops ?? []) {
      const itemKey = lootItemKey(item)
      if (itemKey === '' || emitted.has(itemKey)) continue
      emitted.add(itemKey)
      if (verdict && !verdicts.has(itemKey)) verdicts.set(itemKey, verdict(item))
      rows.push(oneRow({ mob, item, itemKey, seen: seenByItem.get(itemKey), upgrade: verdicts.get(itemKey) ?? null }))
    }
  }
  return rows
}

/** Everything one row is assembled from. An object because `max-params` is 4 and this is five. */
interface RowInput {
  mob: MobEntry
  item: string
  itemKey: string
  seen: SeenRate | undefined
  upgrade: ZoneUpgrade | null
}

/** One row, assembled. Split out so `zoneLootRows` keeps its two loops readable at depth 3. */
function oneRow(input: RowInput): ZoneLootRow {
  const { mob, item, itemKey, seen, upgrade } = input
  const row: ZoneLootRow = {
    key: `${mob.page}${KEY_SEP}${itemKey}`,
    mob: mob.name,
    mobPage: mob.page,
    item,
    itemKey,
    era: dropEraSubject({ item }),
    outOfEra: dropIsOutOfEra({ item }),
    seen: seen?.drops ?? 0,
    perHour: seen?.perHour ?? null
  }
  // Assigned rather than spread (the wishSearch idiom): an absent level stays ABSENT instead of
  // becoming an explicit `undefined`, which reads as a claim that the page stated nothing.
  if (mob.level !== undefined) row.level = mob.level
  if (upgrade !== null) row.upgrade = upgrade
  return row
}

/**
 * The search box and the era disclosure, as one pass.
 *
 * A PURE FUNCTION OVER THIS FILE'S OWN ROW TYPE, which is what makes the `.filter`-shaped work
 * legal under ruling 4: the no-munging rule tests the ELEMENT TYPE'S declaration site, and
 * `ZoneLootRow` is declared right here rather than under `src/shared/`. It is also a loop rather
 * than two chained `.filter`s because one pass over 6,896 rows (Kael Drakkel) is what a keystroke
 * can afford.
 *
 * The query matches MOB or ITEM, lower-cased on both sides - the two things a reader types into a
 * box on this tab. `showOutOfEra` false hides only the POSITIVE out-of-era rows; unknown stays.
 * `upgradesOnly` keeps the rows carrying a verdict, which with no verdict function is none of them.
 */
export function filterRows(rows: readonly ZoneLootRow[], query: string, showOutOfEra: boolean, upgradesOnly = false): ZoneLootRow[] {
  const q = query.trim().toLowerCase()
  const out: ZoneLootRow[] = []
  for (const row of rows) {
    if (!showOutOfEra && row.outOfEra) continue
    if (upgradesOnly && row.upgrade === undefined) continue
    if (q !== '' && !row.itemKey.includes(q) && !row.mob.toLowerCase().includes(q)) continue
    out.push(row)
  }
  return out
}

/** What a set of rows adds up to - the footer's line, and the disclosure's count. */
export function zoneLootSummary(rows: readonly ZoneLootRow[]): ZoneLootSummary {
  const mobs = new Set<string>()
  let outOfEra = 0
  let seen = 0
  let upgrades = 0
  for (const row of rows) {
    mobs.add(row.mobPage)
    if (row.outOfEra) outOfEra += 1
    if (row.upgrade !== undefined) upgrades += 1
    seen += row.seen
  }
  return { mobs: mobs.size, drops: rows.length, outOfEra, seen, upgrades }
}
