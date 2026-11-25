// itemsDb.ts — the COMMITTED wiki item database: its record shape, its ONE key function,
// and the pure index builder. Electron-free on purpose, so both `scripts/scrape-items.ts`
// (which WRITES the file) and `tests/itemsDb.test.mts` (which asserts on the committed
// bytes) can import the exact same definitions the app reads it with. Nothing here loads
// the JSON — `itemLookup.ts` owns that import, so a script or a test pays for the 8 MB
// only when it actually wants it.
//
// WHY A COMMITTED DATABASE AT ALL (owner decision, 2026-08-03: "we should be shipping the
// database with the bundle and committing it"). Item pages are static wiki content, and
// `itemLookup` was answering every unknown item with a two-request network round trip
// (search → parse) whose result then lived only in that one user's `userData` cache. So a
// fresh install answered nothing offline, every user re-scraped the same 11k items one at a
// time, and the wiki paid for all of it. Scraping the corpus ONCE and committing it is the
// precedent posky.json / quests.json / mobs.json already set, for the same reasons: instant,
// offline, identical for every user, and diffable against the wiki.
//
// SHAPE. A record is *literally* the `ItemKnowledge` fields `parseItemWikitext` produces —
// no projection, no renaming, so the lookup path needs no translation layer. Two
// concessions to bundle size (the JSON is ES-imported, so electron-vite INLINES it into
// every user's main bundle):
//   * false / empty fields are OMITTED rather than stored (`lore: false`, `questUses: []`
//     for ~11k records is pure weight). `knowledgeFromDb` restores the defaults.
//   * `name` is stored only when the page's `|itemname` DIFFERS from its title, which is
//     rare; otherwise the title IS the name.
// Both are restored in ONE place, `knowledgeFromDb`, so no caller ever sees the compact form.

import { itemBaseName, withQualifiedDamage } from '../shared/itemStats'
// The rename overlay (JOS-415) — items.json is a scrape rewritten wholesale, so a name the wiki
// has since changed is corrected at LOAD, never in the file. Read its header before adding a row.
import { renamedItems } from '../shared/itemRenames'
import type { ItemKnowledge } from '../shared/types'

/**
 * The canonical item key — ONE definition for the committed DB, the userData cache, and the
 * scraper. Law 2 (canonicalize at boundaries): strip the ` +N` item-level suffix so
 * "Cloak of Flames +4" and "Cloak of Flames" are the same item, and fold case because loot
 * lines and wiki titles disagree about it constantly.
 */
export function itemKey(name: string): string {
  return itemBaseName(name).toLowerCase()
}

/**
 * One committed item record. `Partial<Omit<ItemKnowledge, …>>` is deliberate rather than a
 * hand-written field list: it makes the record shape an IDENTITY with the knowledge type the
 * app serves, so a field added to `ItemKnowledge` can't silently stop being scraped, and a
 * field renamed there breaks this file instead of quietly producing empty cards.
 *
 * `page` (the wiki page title) is the only required field; it is the record's provenance and
 * the link target. `cached` is a per-answer runtime flag and is never stored.
 */
export interface ItemDbEntry extends Partial<Omit<ItemKnowledge, 'cached' | 'page'>> {
  page: string
}

/** The committed file: `src/main/data/items.json`. */
export interface ItemDbFile {
  /** ISO stamp of the scrape that produced this file. */
  scrapedAt: string
  /** human-readable provenance (which enumeration produced this) */
  source: string
  /** number of DISTINCT item pages (not keys — an item can carry two keys, see below) */
  count: number
  /**
   * `itemKey(name)` → record. A page contributes up to TWO keys: its title and, when the
   * `|itemname` field differs, that name too — a loot line spells the in-game name, which is
   * not always what someone titled the page.
   */
  items: Record<string, ItemDbEntry>
}

/**
 * A stored record → the knowledge record the app serves, with the omitted defaults restored.
 * `name` defaults to the page title (see the shape note in the header).
 */
export function knowledgeFromDb(entry: ItemDbEntry): Omit<ItemKnowledge, 'cached'> {
  return {
    ...entry,
    // The scrape-time parse let `Fire DMG: 4` overwrite the base `DMG:` (15 pages); the fixed
    // parser's answer is laid on at LOAD, never in the file (`withQualifiedDamage` says why).
    ...(entry.stats === undefined ? {} : { stats: withQualifiedDamage(entry.stats, entry.statsBlock) }),
    name: entry.name ?? entry.page,
    lore: entry.lore ?? false,
    quest: entry.quest ?? false,
    questUses: entry.questUses ?? []
  }
}

/** A wiki page title in MediaWiki's canonical form: `_` is a space, runs of space collapse, and
 *  the FIRST letter is case-insensitive (so it is upper-cased); every other letter is significant. */
export function canonicalTitle(title: string): string {
  const t = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/**
 * PURE: the corpus's `items` record → "is this wiki page title an ITEM PAGE?". The test a mob
 * page's `[[Item]]` loot link must pass to count as a drop (`parseMobLoot`).
 *
 * BY PAGE TITLE, NOT BY `itemKey`. A record is filed under its `|itemname` too, and that alias is
 * not a page: `quiver of marr` keys the record whose page is `Quiver of Marr (Item)`, while the
 * link `[[Quiver of Marr|Spell: Quiver of Marr]]` on a mob's loot list points at the SPELL page.
 * Matching the key read 15 such spell links as the summoned quiver (measured on the 2026-10-18
 * cache). A link resolves to the page its target names, so the membership test is the record's
 * own `page`, compared under the MediaWiki title rules above.
 */
export function corpusItemTest(items: Readonly<Record<string, ItemDbEntry>>): (title: string) => boolean {
  const pages = new Set(Object.values(items).map((e) => canonicalTitle(e.page)))
  return (title) => pages.has(canonicalTitle(title))
}

/**
 * PURE: "is this wiki page title a SPELL SCROLL item page?" A scroll's statsblock is the only one
 * that states `Mana Cost:` (measured 2026-11-25: 30 corpus pages, all scrolls). Three of them are
 * titled without the `Spell: ` prefix (`Improved Invis vs Undead`), and a loot link labelled
 * `Spell: Improved Invis vs Undead` reaches only that page; `Tears of Prexus`, reached the same
 * way, is a research component and is NOT the scroll.
 */
export function corpusScrollTest(items: Readonly<Record<string, ItemDbEntry>>): (title: string) => boolean {
  const pages = new Set(
    Object.values(items)
      .filter((e) => e.stats?.flags.some((f) => f.startsWith('Mana Cost:')) === true)
      .map((e) => canonicalTitle(e.page))
  )
  return (title) => pages.has(canonicalTitle(title))
}

/**
 * PURE: the committed file → a lookup index. Kept as a function (rather than a bare
 * `Object.entries` at the use site) so the test can build the index from the COMMITTED bytes
 * exactly the way the shipped code does.
 */
export function buildItemDbIndex(file: ItemDbFile): Map<string, ItemDbEntry> {
  // Through the rename overlay, which keeps the OLD key as an alias onto the renamed record — a
  // loot line or a share bundle spelling the old name still resolves, and resolves to the current
  // name (shared/itemRenames.ts states why).
  return new Map(Object.entries(renamedItems(file.items ?? {})))
}
