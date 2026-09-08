// ipc/itemLookIndex.ts - THE GAME'S ITEM TABLE, RE-KEYED BY NAME (EQ Zera, "preview this item on
// my character").
//
// WHY A SECOND KEY OVER THE SAME TABLE. `src/main/data/itemModels.json` is keyed by the GAME's own
// item id, because that is what `/outputfile inventory` writes: the character sheet's join
// (ipc/characterSheet.ts) is exact, never a name match, and that is the whole reason the table was
// fetched by id in the first place. An item PAGE has no id. The renderer asking "what would this
// look like on me?" knows one thing about the item, the name the wiki spells, so this module
// re-keys the same committed table by name - and every ambiguity the id join never had shows up
// here, where it is REPORTED rather than hidden.
//
// THE NORMALISATION IS OURS, NOT THE GENERATOR'S. `scripts/fetch-item-models.mts` decided which
// dump rows to keep by matching the catalog with a bare `toLowerCase()`, so the committed `name`
// fields are the dump's own spelling and nothing about the file's keys is a fold we control. The
// index therefore re-keys every row through `itemKey` - `itemBaseName` (world-model law 2: the
// ` +N` item level comes off at counting boundaries) plus lower case - so "Cloak of Flames +4",
// "cloak of flames" and the table's "Cloak of Flames" all land on the one record. The rename
// overlay (shared/itemRenames.ts) is folded in the same pass: a row whose name the overlay renames
// is keyed under BOTH spellings, because a rename changes what we display and cannot change what a
// player's log or a stale share bundle already says.
//
// THE AMBIGUITY RULE, STATED RATHER THAN GUESSED. The table holds 11,938 rows under 10,496
// distinct names: 1,018 names carry more than one item id and 293 of those DISAGREE about model,
// material or dye (the game re-used a name across eras and servers). Law 12 forbids resolving that
// by closest match and law 1 forbids inventing a winner, so the index does two honest things:
//
//   * the look served is the record with the LOWEST numeric item id. Not "the best" and not "the
//     newest" - just a rule that is deterministic, cheap and stated, so the same name answers the
//     same way on every machine and every run.
//   * `looks` is the number of DISTINCT (model, material, color) triples under that name, so the
//     surface above can say "one of 4" instead of pretending the answer is the only one. A count
//     of 1 means the ids agree and there is nothing to say.
//
// Pure and electron-free ON PURPOSE: `ipc/itemLook.ts` is the door and imports `ipcMain`, which
// keeps it out of the node tests, so the part with the rules in it lives here and
// `tests/itemLook.test.mts` runs the real committed table through it.
//
// NOTHING LEAVES THE MACHINE. A committed JSON, read in this process, answering a question the
// user's own window asked.

import { itemKey } from '../itemsDb'
import { renameItemName } from '../../shared/itemRenames'
import type { ItemLook } from '../../shared/eqModel'
// The committed game item table - the same module ipc/characterSheet.ts imports, so the JSON is
// inlined into the main bundle exactly once.
import itemModelsJson from '../data/itemModels.json'

interface ItemModelRecord {
  name: string
  model: string
  material: number
  color: number
  itemtype: number
}
interface ItemModelsFile {
  byId: Record<string, ItemModelRecord>
}
function itemModels(): ItemModelsFile {
  return itemModelsJson
}

/** One table row with the id it was keyed by, so the lowest-id rule has something to compare. */
interface Row {
  id: number
  record: ItemModelRecord
}

/** The longest item name we will look up. The longest the committed catalog carries is well under it. */
const MAX_NAME = 120

/** Every key a row answers under: its own fold, plus the renamed spelling when the overlay has one. */
function keysFor(name: string): string[] {
  const own = itemKey(name)
  const renamed = itemKey(renameItemName(name))
  return renamed === own ? [own] : [own, renamed]
}

/** The look one name serves: the lowest id's three facts, and how many distinct looks hide behind it. */
function lookOf(rows: readonly Row[]): ItemLook {
  const lowest = rows.reduce((lo, r) => (r.id < lo.id ? r : lo))
  const distinct = new Set(
    rows.map((r) => `${r.record.model}/${String(r.record.material)}/${String(r.record.color)}`)
  )
  return {
    model: lowest.record.model,
    material: lowest.record.material,
    color: lowest.record.color,
    looks: distinct.size
  }
}

function buildIndex(): Map<string, ItemLook> {
  const rows = new Map<string, Row[]>()
  for (const [id, record] of Object.entries(itemModels().byId)) {
    const row: Row = { id: Number(id), record }
    for (const key of keysFor(record.name)) {
      const list = rows.get(key)
      if (list) list.push(row)
      else rows.set(key, [row])
    }
  }
  const out = new Map<string, ItemLook>()
  for (const [key, list] of rows) out.set(key, lookOf(list))
  return out
}

let index: Map<string, ItemLook> | null = null

/** The name -> look index, built on first use and kept for the process's life (the sheet's precedent). */
function nameIndex(): Map<string, ItemLook> {
  index ??= buildIndex()
  return index
}

/**
 * The look the committed table holds for an item NAME, or null for anything it does not know.
 *
 * The name comes from a renderer, so it is checked before it is used: a non-string, a blank one
 * and an implausibly long one are all answered null rather than turned into a lookup.
 */
export function lookupItemLook(name: unknown): ItemLook | null {
  if (typeof name !== 'string' || name.length > MAX_NAME) return null
  const trimmed = name.trim()
  if (trimmed.length === 0) return null
  return nameIndex().get(itemKey(trimmed)) ?? null
}
