// main/craftIndex.ts — the committed item corpus → THE RECIPE INDEX the Crafting tab reads.
//
// THE 8.6 MB NEVER CROSSES. `src/main/data/items.json` is ES-imported (electron-vite inlines it
// into the main bundle, where `itemLookup.ts` already pays for it), the walk happens here, and what
// travels to the renderer is ~2,450 recipe rows — the `planner/gearIndex.ts` bargain exactly, for
// the same reason: shipping the corpus to the renderer would double it in every install.
//
// LAZY AND MEMOIZED FOR THE LIFE OF THE PROCESS. The input is committed bytes, so the answer cannot
// change while the app runs. An install that never opens the Crafting tab never walks the corpus;
// one that opens it twenty times walks it once.
//
// TWO FUNCTIONS ON PURPOSE. `buildCraftIndex(file)` is PURE and takes the corpus as an argument, so
// `tests/craftIndex.test.mts` runs the SHIPPED builder over the SHIPPED bytes with no Electron
// anywhere; `craftIndex()` is the memoized reader the IPC handler calls. Nothing in this file
// imports `electron` — the handler next door (`ipc/craft.ts`) is where that line lives.
//
// THE PAGE DEDUPE IS THE DONOR/GEAR INDEX'S. A page contributes up to TWO keys to `items` (its
// title, and its `|itemname` when that differs), so a walk over `Object.entries` would file 56
// duplicated recipe sets and the tab would show the same recipe twice. Pages are walked once, by
// `entry.page` identity, exactly as `gearIndex.addPage` does it.
//
// AND IT GOES THROUGH THE RENAME OVERLAY (JOS-415, `shared/itemRenames.ts`) for the same reason
// every other reader of this corpus does: a name the wiki has since changed is corrected at LOAD,
// so a recipe's product reads as the item the player will actually see in their bags.

import { itemKey, knowledgeFromDb, type ItemDbFile } from './itemsDb'
import { renamedItems } from '../shared/itemRenames'
import { craftRecipesOf, type CraftIndex } from '../shared/craft'
// The COMMITTED wiki item database — the same module `itemLookup.ts` imports, so the JSON is
// inlined into the main bundle exactly once.
import itemsJson from './data/items.json'

/**
 * PURE: the committed file → every recipe it states.
 *
 * The product NAME is `knowledgeFromDb`'s (`name ?? page` — the compact record omits a name equal
 * to its page title), and the product KEY is `itemKey` of that name, which is the key the ownership
 * index and the loot history already use. So a recipe row joins what the player holds with no
 * translation layer anywhere (law 12: the join is an identity, never a match).
 */
export function buildCraftIndex(file: ItemDbFile): CraftIndex {
  const seen = new Set<string>()
  const recipes: CraftIndex['recipes'] = []
  for (const entry of Object.values(renamedItems(file.items ?? {}))) {
    if (entry.craftedBy === undefined || entry.craftedBy.length === 0) continue
    // One page, one set of recipes — the alias key is the same page said twice.
    if (seen.has(entry.page)) continue
    seen.add(entry.page)
    const name = knowledgeFromDb(entry).name
    // THE ID BASE IS THE PAGE, THE PRODUCT KEY IS THE ITEM, and they differ for 35 product names.
    // `Carved Elm Recurve Bow` is made by four pages (Linen, Hemp, Silk, and a fourth spelling) and
    // `Imbued Dwarven Chain Boots` by one page per deity: DIFFERENT RECIPES for one item, all real.
    // Keying the id on the product would have collided 58 of them, and a collision must never be
    // resolved by dropping a way to make something.
    for (const recipe of craftRecipesOf(name, itemKey(name), entry.craftedBy, itemKey(entry.page))) {
      recipes.push(recipe)
    }
  }
  return { scrapedAt: file.scrapedAt, recipes }
}

let cached: CraftIndex | null = null

/** The recipe index, built on first use and kept for the life of the process. */
export function craftIndex(): CraftIndex {
  cached ??= buildCraftIndex(itemsJson as unknown as ItemDbFile)
  return cached
}
