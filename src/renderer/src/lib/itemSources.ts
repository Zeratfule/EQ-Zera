// lib/itemSources.ts — "where does this item come from?", answered locally from the committed
// mob catalog, for EVERY surface that asks.
//
// It began life as the planner's own `features/planner/sourceIndex.ts` and was promoted here the
// moment a SECOND consumer appeared (the Loot tab's item drill-down, 2026-08-04). The reason is
// not tidiness: the index is a ~33k-link inversion of `data/eqlegends/mobs.json`, and two feature
// modules each building their own would pay for it twice and answer the same question from two
// tables. There is ONE lazy singleton, in lib/, and both features read it.
//
// The planner keeps `features/planner/sourceIndex.ts` as a re-export so its own vocabulary
// (`PlannerSource`) and its node test's import path both still resolve to this file.
//
// WHY THIS DATA IS ALREADY HERE. `data/eqlegends/mobs.json` is bundled into the renderer for the
// Mobs tab (mobSearch.ts), and every mob page states its `|known_loot`. Inverting that list gives
// an item → mobs index for free — no IPC, no network, works offline.
//
// LAZY, NEVER AT MODULE LOAD — the mobSearch precedent. Neither the Planner nor an item
// drill-down may ever be opened this session, and the catalog is immutable, so the index is built
// on first use and lives for the window's lifetime. MEASURED over the committed catalog
// (2026-08-04, node, warm): 7,872 pages, 4,410 of them with a loot list, 32,822 item→mob links
// folding onto 5,357 distinct item keys.
//
// THE KEY IS THE ITEM'S CANONICAL KEY. Main serves `PlannerDonor.key = itemKey(name)`
// (src/main/itemsDb.ts) — `+N` stripped, case folded — and a join that used any other spelling
// would silently find nothing for the ~1,900 catalog drop names that carry an upgrade suffix.
// The renderer cannot import main, so the rule is re-applied here from its SHARED half
// (`itemBaseName`), which is the same function main's `itemKey` calls. A caller holding a display
// NAME (the loot drill-down holds the name off a loot line) goes through `sourceItemKey`.
//
// It says only what the catalog says (law 1): a mob, its page, the level text VERBATIM (a range
// as often as a number) and its zones. No rarity — the compact catalog carries item names only —
// and no invented drop rate.

import type { ItemDropSource, MobEntry } from '@shared/types'
// RELATIVE value import (house law, the mobSearch.ts precedent): the `@shared` alias exists only
// inside the vite build, and `tests/plannerSourceIndex.test.mts` reaches this module under the
// node runner. Type-only imports are erased, so they keep the alias.
import { itemBaseName } from '../../../shared/itemStats'
import mobsJson from '../data/eqlegends/mobs.json'

/** One place an item is known to come from. Exactly what the mob page stated, nothing more. */
export interface ItemSource {
  /** the mob's in-game name, as the page writes it ("the froglok shin lord") */
  mob: string
  /** wiki page title — present whenever the catalog row has one (it always does today) */
  mobPage?: string
  /** level EXACTLY as stated: a RANGE ("36-40") as often as a number ("30") */
  levelText?: string
  /** home zone(s) from the page; `[]` when it stated none ("Various" is a real value, not a gap) */
  zones: string[]
}

export type SourceIndex = ReadonlyMap<string, ItemSource[]>

interface MobCatalog {
  scrapedAt: string
  source: string
  mobs: MobEntry[]
}

const catalog = mobsJson as unknown as MobCatalog

/**
 * The index key for an item NAME — main's `itemsDb.ts itemKey`, re-applied renderer-side.
 * Kept as one exported function so the join has exactly one spelling to be wrong about.
 */
export function sourceItemKey(name: string): string {
  return itemBaseName(name).toLowerCase()
}

/**
 * The PURE builder: catalog rows → `itemKey → sources`. Exported separately from the lazy
 * singleton below so the node test can hand it the real catalog and assert the floors.
 *
 * Sources keep the CATALOG'S OWN ORDER (the wiki's enumeration) rather than being sorted: there
 * is no rarity or drop-rate signal here to rank by, and inventing one (alphabetical, level) would
 * dress an arbitrary pick up as "the best camp". A mob is listed ONCE per key even when its page
 * lists both "Ghoulbane" and "Ghoulbane +1" — those are one item (law 2).
 */
export function buildSourceIndex(mobs: readonly MobEntry[]): Map<string, ItemSource[]> {
  const index = new Map<string, ItemSource[]>()
  for (const mob of mobs) {
    if (!mob.drops?.length) continue
    const source: ItemSource = { mob: mob.name, zones: mob.zones ?? [] }
    if (mob.page) source.mobPage = mob.page
    if (mob.level) source.levelText = mob.level
    for (const drop of mob.drops) {
      const key = sourceItemKey(drop)
      if (key === '') continue
      const list = index.get(key)
      if (!list) index.set(key, [source])
      else if (!list.some((s) => s.mobPage === source.mobPage && s.mob === source.mob)) list.push(source)
    }
  }
  return index
}

/** Built on first use, never at module load. The catalog is immutable, so one build is enough. */
let INDEX: Map<string, ItemSource[]> | null = null

export function sourceIndex(): SourceIndex {
  INDEX ??= buildSourceIndex(catalog.mobs ?? [])
  return INDEX
}

/**
 * Every known drop source for an item key, or `[]` — which is an HONEST answer, not a gap: quest
 * rewards and player-crafted items legitimately drop from nobody, and the caller carries those
 * flags itself. A surface says "no known source" only when the flags are absent too.
 */
export function sourcesFor(key: string): readonly ItemSource[] {
  return sourceIndex().get(key) ?? []
}

/**
 * BOTH WITNESSES TO "WHO DROPS THIS", AS ONE LIST.
 *
 * The mob catalog (`|known_loot`, inverted above) and the item page (`|dropsfrom`, which arrives
 * on a `PlannerDonor` row or an `ItemKnowledge` record) are the two halves of the same wiki, and
 * they omit different things — measured 2026-08-04, 126 effect-bearing donors have NO catalog
 * source at all while their own page names a mob for a third of them. A surface that read only
 * the catalog answered those with "No known source" while the page it was scraped from said
 * otherwise.
 *
 * WHEN BOTH NAME THE SAME MOB THE CATALOG ROW WINS WHOLE (matched case-folded — the two sides of
 * the wiki disagree about capitalisation constantly). It is the EQL-specific witness and the only
 * one carrying level text; folding the page's zone into it as well would split one camp across two
 * spellings of one place ("Lower Guk" and "The City of Guk" as separate headings) to learn
 * nothing. A page-only mob contributes a row with no level text, which renders as a bare name.
 */
export function mergeItemSources(
  catalogSources: readonly ItemSource[],
  wiki: readonly ItemDropSource[] | undefined
): ItemSource[] {
  const out = [...catalogSources]
  const seen = new Set(catalogSources.map((s) => s.mob.trim().toLowerCase()))
  for (const w of wiki ?? []) {
    const id = w.mob.trim().toLowerCase()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    out.push({ mob: w.mob, zones: w.zone === undefined ? [] : [w.zone] })
  }
  return out
}
