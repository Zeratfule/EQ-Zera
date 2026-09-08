// crafting/craftPlan.ts — WHAT YOU CAN MAKE, WHAT YOU ARE ONE INGREDIENT FROM, AND WHY NOT.
//
// PURE and React-free, the `gearFilter.ts` / `areaMemory.ts` precedent: value imports are RELATIVE
// (the node-tested-module house law), nothing here touches `window`, storage or IPC, and
// `tests/craftIndex.test.mts` drives it against the REAL index with no DOM.
//
// ---------------------------------------------------------------------------
// WHAT "MAKEABLE" MEANS HERE, AND WHAT IT DELIBERATELY DOES NOT
// ---------------------------------------------------------------------------
// It means YOU HOLD THE INGREDIENTS. Not "your skill is high enough" — no recipe in the corpus
// states a skill requirement (only `trivial`, which is where a skill stops rising), and this app
// knows no character's tradeskill values at all. Claiming otherwise would be inventing a fact the
// data cannot support (law 1), so the UI's own words are "You can make now" and never "You can
// craft this".
//
// THREE RULES DECIDE A VERDICT, and each one is a fact the corpus states:
//
//   * AN UNSTATED RECIPE IS NEVER MAKEABLE. 357 recipes carry an empty ingredient list, which is
//     the wiki saying "player-crafted" and nothing more. An empty requirement list is trivially
//     satisfied by an empty inventory, so treating silence as "you have everything" would put 357
//     lies at the top of the tab. They are reported as unstated and left out of both verdict
//     sections.
//   * A NON-CONSUMED INGREDIENT IS STILL AN INGREDIENT, but not a shortfall you can be short of in
//     the sense the plan means. `Returned on Success` items come back from the combine, so they do
//     not gate the count (shared/craft.ts note 3). They are still DRAWN on the row, tagged.
//   * SHORTFALL IS PER INGREDIENT KIND, NOT PER UNIT. "One ingredient away" counts KINDS you are
//     missing, so needing two more Rain Water is one thing to go and get, not two.
//
// ---------------------------------------------------------------------------
// AND "ONE AWAY" REQUIRES THAT YOU BE PART OF THE WAY THERE (owner ruling)
// ---------------------------------------------------------------------------
// The first cut said one away meant "exactly one missing kind", full stop — and MEASURED against
// the reference dump that put 87 recipes in the section, almost all of them SINGLE-INGREDIENT
// combines (the twelve "10 Dose <potion>" bottlings and their kin). A character holding nothing at
// all is one ingredient away from every one-ingredient recipe in the game, which is true and
// useless: the section is supposed to say "go and get this ONE thing and you are done", and it was
// saying "go and get the entire recipe".
//
// SO THE RULE HAS A SECOND HALF: exactly one consumed kind missing, AND at least one consumed kind
// already HELD. A single-ingredient recipe can therefore never appear here — it is either makeable
// or it is nothing to you yet — and every row in the section is a recipe you have genuinely started.
// Both halves are about CONSUMED kinds only; a returned-on-success tool is neither progress nor a
// shortfall (it is not spent, so holding one says nothing about being close).
//
// ---------------------------------------------------------------------------
// NO DOMAIN MUNGING (ruling 4, eslint.domainMunging.mjs)
// ---------------------------------------------------------------------------
// `CraftRecipe` and `CraftIngredient` are declared in `src/shared/`, so `.filter`/`.sort`/`.reduce`
// over them in renderer code is a lint error — this file lives under `src/renderer/`, so the rule
// applies to it too. Every pass over the served rows below is therefore a `for` loop. The verdict
// types are this module's OWN, so sorting a `CraftVerdict[]` is ordinary renderer work and is
// spelled as such.

import type { CraftIndex, CraftRecipe, CraftSkill } from '../../../../shared/craft'

/** One ingredient you are short of, and by how much. */
export interface CraftNeed {
  key: string
  name: string
  /** how many the recipe consumes */
  need: number
  /** how many you hold, all places and plus levels together */
  have: number
}

/** One recipe, read against what you hold. */
export interface CraftVerdict {
  recipe: CraftRecipe
  /** you hold every consumed ingredient. False for every unstated recipe, always */
  makeable: boolean
  /** the CONSUMED ingredients you lack, worst shortfall first */
  missing: CraftNeed[]
  /**
   * how many CONSUMED ingredient kinds you already hold enough of — how far in you are.
   *
   * It exists because "one away" needs it (see the header's second half): a count of zero means
   * you have not started this recipe, whatever its length, and the section says so by leaving you
   * out of it. Non-consumed tools are excluded on purpose — holding an oven's worth of skewers is
   * not progress towards kabobs.
   */
  heldKinds: number
  /** the wiki stated no ingredient list — see the header */
  unstated: boolean
}

/** How much of an item you hold. The Crafting tab passes the ownership index's own count. */
export type HaveFn = (key: string) => number

/** Worst shortfall first, then by name so the order is stable between renders. */
function byShortfall(a: CraftNeed, b: CraftNeed): number {
  const gap = b.need - b.have - (a.need - a.have)
  return gap !== 0 ? gap : a.name.localeCompare(b.name)
}

/** One recipe against one inventory. */
export function craftVerdict(recipe: CraftRecipe, have: HaveFn): CraftVerdict {
  const missing: CraftNeed[] = []
  let heldKinds = 0
  for (const ingredient of recipe.ingredients) {
    // A tool that comes back from the combine is neither a shortfall nor progress (header rule 2).
    if (!ingredient.consumed) continue
    const held = have(ingredient.key)
    if (held >= ingredient.qty) {
      heldKinds++
      continue
    }
    missing.push({ key: ingredient.key, name: ingredient.name, need: ingredient.qty, have: held })
  }
  missing.sort(byShortfall)
  return {
    recipe,
    makeable: !recipe.unstated && missing.length === 0,
    missing,
    heldKinds,
    unstated: recipe.unstated
  }
}

/**
 * ONE AWAY: exactly one consumed kind short, and something already in hand.
 *
 * The second clause is the owner's ruling (see the header) and it is what keeps single-ingredient
 * recipes out: `heldKinds >= 1` with `missing.length === 1` means the recipe has at least two
 * consumed ingredients and you have some of them.
 */
export function isOneAway(verdict: CraftVerdict): boolean {
  return !verdict.unstated && verdict.missing.length === 1 && verdict.heldKinds >= 1
}

/** What the filter row asks of the corpus. */
export interface CraftFilter {
  /** '' is Any */
  skill: CraftSkill | ''
  query: string
}

/** The three sections the tab draws. `all` is capped by the CALLER, not here. */
export interface CraftPlan {
  makeable: CraftVerdict[]
  /** exactly one missing consumed KIND, and at least one already held (`isOneAway`) */
  oneAway: CraftVerdict[]
  all: CraftVerdict[]
}

/**
 * Does this recipe answer the typed query?
 *
 * PRODUCT AND INGREDIENT NAMES BOTH, because a player types "gnome meat" as often as they type
 * "gnome kabobs" — the question "what is this stack of meat for" is the same question read from the
 * other end. The haystack is built per call rather than cached on the row: it is ~2,450 rows of two
 * `toLowerCase` calls, which is render-bound work in this app's measured sense, and the tab already
 * filters on a `useDeferredValue` copy of the box.
 */
function matches(recipe: CraftRecipe, needle: string): boolean {
  if (recipe.product.toLowerCase().includes(needle)) return true
  for (const ingredient of recipe.ingredients) {
    if (ingredient.name.toLowerCase().includes(needle)) return true
  }
  return false
}

/** Product name ascending, then recipe id, so two ways to make one item keep the page's order. */
function byProduct(a: CraftVerdict, b: CraftVerdict): number {
  const name = a.recipe.product.localeCompare(b.recipe.product)
  return name !== 0 ? name : a.recipe.id.localeCompare(b.recipe.id)
}

/**
 * The whole index → the three sections, filtered and sorted.
 *
 * ONE PASS over the served rows (a `for` loop — see the header), building each verdict once and
 * filing it into every section it belongs to. `all` holds every match including the makeable and
 * the one-away ones: the sections are three READINGS of the same list, not a partition, so a
 * recipe you can make is still findable where you went looking for it.
 */
export function craftPlan(index: CraftIndex, have: HaveFn, filter: CraftFilter): CraftPlan {
  const needle = filter.query.trim().toLowerCase()
  const plan: CraftPlan = { makeable: [], oneAway: [], all: [] }
  for (const recipe of index.recipes) {
    if (filter.skill !== '' && recipe.skill !== filter.skill) continue
    if (needle !== '' && !matches(recipe, needle)) continue
    const verdict = craftVerdict(recipe, have)
    plan.all.push(verdict)
    if (verdict.makeable) plan.makeable.push(verdict)
    // An unstated recipe is one away from nothing (its silence is not a list of one), and neither
    // is a recipe you have not started — `isOneAway` states both halves.
    else if (isOneAway(verdict)) plan.oneAway.push(verdict)
  }
  plan.makeable.sort(byProduct)
  plan.oneAway.sort(byProduct)
  plan.all.sort(byProduct)
  return plan
}
