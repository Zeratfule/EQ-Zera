// ============================================================================
// shared/craft.ts — THE TRADESKILL RECIPE MODEL (the Crafting tab).
// ============================================================================
//
// The committed item corpus answers "how is this item made" per ITEM (`ItemKnowledge.craftedBy`,
// one `ItemCraftRecipe` per way the wiki states). This module turns that per-item field into a
// flat, self-describing RECIPE row — product, tradeskill, container, trivial, yield and the
// ingredient list with a key you can join ownership on — because "what can I make right now" is a
// question about every recipe at once, not about one item page.
//
// PURE AND DOM-FREE, and both processes read it: main BUILDS the index (src/main/craftIndex.ts,
// where the 8.6 MB corpus lives and stays), the renderer PLANS against it
// (features/crafting/craftPlan.ts). Value imports are RELATIVE — the node-tested-module house law.
//
// ---------------------------------------------------------------------------
// WHAT THE CORPUS ACTUALLY SAYS, AND THE FOUR THINGS THIS FILE DOES ABOUT IT
// ---------------------------------------------------------------------------
// Measured over the 2026-08-22 scrape: 2,475 items carry `craftedBy`, 2,507 recipes in all.
//
//  1. THE TRADESKILL NAMES ARE DIRTY. Twenty distinct spellings for eleven skills: `:Tailoring`
//     (a stray wiki-link colon), `Jewelcrafting` beside `Jewelry Making`, `Make Poison`,
//     `Skill Fletching`, `Spell Research` beside `Research`, `Non-Tradeskill` (123 recipes), and
//     one-off garbage a page put in the field by mistake (`Cobalt drake armor`, `Wooly Fungus
//     Quest`). `normalizeTradeskill` folds the KNOWN misspellings onto the eleven and files
//     everything else under `Other` WITH ITS RAW LABEL KEPT (law 1 — never invent; a filter that
//     silently renamed `Fishing` to something it recognised would be inventing a fact).
//
//  2. INGREDIENT ROWS ARE NOT DEDUPED AND `qty` IS OPTIONAL. `water flask` lists `Bottle` twice —
//     once with `qty: 1` and `sources: ['Bought']`, once bare. Fifteen recipes do this. Two rows
//     for one ingredient would make a plan count the same shortfall twice, so `craftRecipesOf`
//     folds them by key: qty is the MAXIMUM stated (a bare row states nothing, and "nothing" must
//     never lower a number the page actually printed), sources are UNIONED, and the first
//     spelling of the name is the one displayed.
//
//  3. `Returned on Success` MEANS THE INGREDIENT IS NOT CONSUMED. It is a source token like any
//     other in the verbatim list — `Skewers` in `gnome kabobs` reads
//     `['Crafted', 'Returned on Failure', 'Returned on Success']` — and it is the difference
//     between a tool you own once and a component you burn. `consumed` carries it so a plan can
//     stop asking you to stock four ovens' worth of skewers.
//
//  4. 357 RECIPES STATE NO INGREDIENTS AT ALL. The wiki page has a `|playercrafted` block with an
//     empty list, which is the page saying "this is player-crafted" and nothing more. Those are
//     `unstated: true` and MUST NEVER READ AS MAKEABLE: an empty requirement list is trivially
//     satisfied by an empty inventory, which would be the app inventing a fact out of a silence.
//
// WHAT THIS FILE DELIBERATELY DOES NOT MODEL: a SKILL REQUIREMENT. No recipe in the corpus states
// one — only `trivial`, which is where the skill stops rising, not where it starts — and the app
// knows no character's tradeskill values at all. So "can make" here means, and is only ever
// labelled as, HOLDS THE INGREDIENTS.

import { itemTierKey } from './itemStats'
import type { ItemCraftIngredient, ItemCraftRecipe } from './types'

/**
 * The IPC channel the Crafting tab reads its index over.
 *
 * SPELLED HERE rather than in `shared/ipc.ts` because this feature landed while that file was held
 * by another change; the constant is imported by BOTH ends (the handler and the preload method), so
 * there is still exactly one spelling of the string. Folding it into `IPC` is a one-line follow-up
 * that changes no behaviour.
 */
export const CRAFT_INDEX_CHANNEL = 'craft:index'

/**
 * The eleven tradeskills this app recognises, in the order the filter menu lists them.
 *
 * A CLOSED SET on purpose: it is the vocabulary the tradeskill filter offers, so a value that is
 * not in it has to be visibly `Other` rather than a twelfth menu row nobody can reason about.
 */
export const TRADESKILLS = [
  'Alchemy',
  'Baking',
  'Blacksmithing',
  'Brewing',
  'Fletching',
  'Jewelry Making',
  'Poison Making',
  'Pottery',
  'Research',
  'Tailoring',
  'Tinkering'
] as const

export type Tradeskill = (typeof TRADESKILLS)[number]

/** What the filter and every row's chip can be: one of the eleven, or the honest bucket. */
export type CraftSkill = Tradeskill | 'Other'

const CANONICAL = new Map<string, Tradeskill>(TRADESKILLS.map((s) => [s.toLowerCase(), s]))

/**
 * The KNOWN misspellings, and only those.
 *
 * Every row here was read off the corpus and is a spelling of a skill this app already names.
 * A name nobody has verified does NOT go in this table — it goes to `Other` with its own words
 * intact, which is the anti-fuzzy rule (law 12) applied to a field instead of a zone.
 */
const ALIASES: Record<string, Tradeskill> = {
  jewelcrafting: 'Jewelry Making',
  'make poison': 'Poison Making',
  'skill fletching': 'Fletching',
  'spell research': 'Research'
}

/** What `Non-Tradeskill` is called on screen. 123 recipes say it, and it is not a skill. */
const NOT_A_TRADESKILL = 'Not a tradeskill'

/** What a recipe with no `tradeskill` field at all is called. None exist today; silence is not a skill. */
const NO_SKILL_STATED = 'Not stated'

/**
 * A corpus `tradeskill` string → the skill it means and the words to print.
 *
 * The label is what the UI SHOWS and the skill is what the filter GROUPS BY, and they differ for
 * exactly the two honest cases: `Non-Tradeskill` (grouped Other, labelled in plain words) and an
 * unrecognised name (grouped Other, labelled with the wiki's own text so the reader can see what
 * the page actually said).
 */
export function normalizeTradeskill(raw: string | undefined): { skill: CraftSkill; label: string } {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '') return { skill: 'Other', label: NO_SKILL_STATED }
  // The stray leading colon is a wiki link that lost its target (`:Tailoring`, 5 recipes).
  const cleaned = trimmed.replace(/^:+/, '').trim().toLowerCase()
  const exact = CANONICAL.get(cleaned)
  if (exact !== undefined) return { skill: exact, label: exact }
  const alias = ALIASES[cleaned]
  if (alias !== undefined) return { skill: alias, label: alias }
  if (cleaned === 'non-tradeskill') return { skill: 'Other', label: NOT_A_TRADESKILL }
  // VERBATIM (law 1). Whatever the page put in the field is what the row says it put there.
  return { skill: 'Other', label: trimmed }
}

/** One ingredient a recipe wants, folded and keyed for the ownership join. */
export interface CraftIngredient {
  /** `itemTierKey` of the name — the SAME key the ownership index and the item corpus use */
  key: string
  /** the first spelling the recipe used, for display */
  name: string
  /** how many the combine wants. The corpus omits it more often than not; an omitted qty is 1 */
  qty: number
  /** false when a source token says `Returned on Success` — a tool, not a component */
  consumed: boolean
  /** the source tokens verbatim, unioned across the rows that were folded together */
  sources: string[]
}

/** One way to make one item. */
export interface CraftRecipe {
  /**
   * `<idBase>#<index within that page's craftedBy>` — UNIQUE across the index, and stable.
   *
   * The base is the SOURCE PAGE's key rather than the product's, and that is not a detail: 35
   * product names are made by more than one wiki page, and those pages are DIFFERENT RECIPES for
   * the same item. `Carved Elm Recurve Bow` has four (Linen, Hemp, Silk, and one more), and
   * `Imbued Dwarven Chain Boots` has one per deity. Keying on the product would have collapsed 58
   * real recipes into ids that collide, and the fix for a collision is never to drop one of them.
   */
  id: string
  /** the item's display name */
  product: string
  /** `itemKey(product)` — joins the corpus, the ownership index and the loot history */
  productKey: string
  skill: CraftSkill
  /** what to print for the skill; differs from `skill` only for the two `Other` cases */
  skillLabel: string
  trivial?: number
  container?: string
  yieldQty?: number
  ingredients: CraftIngredient[]
  /** the wiki stated NO ingredient list. Never makeable — a silence is not an empty requirement */
  unstated: boolean
}

/** The whole corpus's recipes, as one payload. */
export interface CraftIndex {
  /** the corpus's own scrape stamp — WHEN this data is from */
  scrapedAt: string
  recipes: CraftRecipe[]
}

/** Does this source list say the ingredient survives a successful combine? */
function returnedOnSuccess(sources: readonly string[]): boolean {
  return sources.some((s) => /returned on success/i.test(s))
}

/** Fold one corpus ingredient row into the accumulating map (see note 2 in the header). */
function foldIngredient(into: Map<string, CraftIngredient>, row: ItemCraftIngredient): void {
  const key = itemTierKey(row.name)
  const qty = row.qty !== undefined && row.qty > 0 ? row.qty : 1
  const sources = row.sources ?? []
  const held = into.get(key)
  if (held === undefined) {
    into.set(key, { key, name: row.name, qty, consumed: !returnedOnSuccess(sources), sources: [...sources] })
    return
  }
  // MAX, never sum: two rows for one ingredient are the page listing it twice, not wanting twice
  // as much of it. `water flask` wants one Bottle and says so on two lines.
  if (qty > held.qty) held.qty = qty
  for (const source of sources) {
    if (!held.sources.includes(source)) held.sources.push(source)
  }
  // One row saying it comes back is the page stating it for the ingredient, not for that line.
  if (returnedOnSuccess(sources)) held.consumed = false
}

/** The ingredient rows of one recipe, deduped by key, in the order the page listed them. */
function foldIngredients(rows: readonly ItemCraftIngredient[]): CraftIngredient[] {
  const into = new Map<string, CraftIngredient>()
  for (const row of rows) foldIngredient(into, row)
  return [...into.values()]
}

/**
 * One item's `craftedBy` → its recipe rows.
 *
 * `productKey` is passed in rather than derived so the caller (main's index build) files a recipe
 * under the SAME key it filed the item under, with no second opinion about what an item key is.
 *
 * `idBase` defaults to the product key and the index build passes the SOURCE PAGE's key instead —
 * see `CraftRecipe.id` for the 58 recipes that difference keeps.
 */
export function craftRecipesOf(
  productName: string,
  productKey: string,
  crafted: readonly ItemCraftRecipe[],
  idBase: string = productKey
): CraftRecipe[] {
  const out: CraftRecipe[] = []
  for (let i = 0; i < crafted.length; i++) {
    const raw = crafted[i]
    const skill = normalizeTradeskill(raw.tradeskill)
    const ingredients = foldIngredients(raw.ingredients)
    out.push({
      id: `${idBase}#${String(i)}`,
      product: productName,
      productKey,
      skill: skill.skill,
      skillLabel: skill.label,
      // Absent stays the only spelling of unknown, on both sides of the wire (the `GearEffect`
      // rule): a structured clone would carry an explicit `undefined` and a JSON round trip
      // would not, so nothing here writes one.
      ...(raw.trivial === undefined ? {} : { trivial: raw.trivial }),
      ...(raw.container === undefined ? {} : { container: raw.container }),
      ...(raw.yieldQty === undefined ? {} : { yieldQty: raw.yieldQty }),
      ingredients,
      unstated: ingredients.length === 0
    })
  }
  return out
}

/**
 * How many DISTINCT ingredients the whole index names — the footer's second number.
 *
 * It lives here rather than in the renderer for one reason: it is a fold over `CraftRecipe[]`,
 * which is served domain data, and the renderer does not munge those (ruling 4).
 */
export function craftIngredientCount(index: CraftIndex): number {
  const keys = new Set<string>()
  for (const recipe of index.recipes) {
    for (const ingredient of recipe.ingredients) keys.add(ingredient.key)
  }
  return keys.size
}
