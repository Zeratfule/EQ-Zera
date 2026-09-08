// THE CRAFTING TAB — the recipe index and the plan built on it, asserted against the REAL committed
// corpus (`src/main/data/items.json`, the 2026-08-22 scrape).
//
// Nothing skips, nothing is mocked, no Electron: `src/main/craftIndex.ts` is Electron-free on
// purpose (the `planner/gearIndex.ts` precedent) and this runs the SHIPPED builder over the SHIPPED
// bytes, because "the Crafting tab is empty", "every recipe lost its container" and "the app says
// you can make 342 things you have never heard of" are failures of these two functions that no
// hand-written fixture could see.
//
// WHAT THE 2026-08-22 SCRAPE MEASURES (printed on every run):
//
//     2,451 recipes over 2,419 item pages · 1,213 distinct ingredients
//     342 recipes state NO ingredient list at all — never makeable, by construction
//     130 recipes land under `Other`, and their labels are the census below
//     87 recipes consume exactly ONE ingredient kind — and none of them is ever "one away"
//
// THE COUNTS ARE FLOORS (AGENTS.md, "frozen numbers rot": the wiki gains pages and a rescrape must
// be able to grow this file without turning it red). THE CENSUSES ARE EQUALITIES on purpose — the
// set of labels reaching `Other` is exactly the set of tradeskill spellings this app does not
// recognise, so a rescrape that invents a new one should stop the suite rather than quietly drop a
// hundred recipes into a bucket nobody reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCraftIndex, craftIndex } from '../src/main/craftIndex'
import type { ItemDbFile } from '../src/main/itemsDb'
import { TRADESKILLS, craftIngredientCount, type CraftRecipe } from '../src/shared/craft'
import { craftPlan, craftVerdict, isOneAway } from '../src/renderer/src/features/crafting/craftPlan'

const INDEX = craftIndex()

/** What the reference character carries: exactly one thing that is an ingredient of anything. */
const HOLDING_GRIFFENNE = (key: string): number => (key === 'griffenne blood' ? 1 : 0)
const HOLDING_NOTHING = (): number => 0

function recipesFor(product: string): CraftRecipe[] {
  const out: CraftRecipe[] = []
  for (const recipe of INDEX.recipes) if (recipe.product === product) out.push(recipe)
  return out
}

test('the real corpus builds a recipe index of the expected size', () => {
  console.log(
    `    ${String(INDEX.recipes.length)} recipes · ${String(craftIngredientCount(INDEX))} distinct ingredients · scraped ${INDEX.scrapedAt.slice(0, 10)}`
  )
  assert.ok(INDEX.recipes.length >= 2_000, `only ${String(INDEX.recipes.length)} recipes`)
  assert.ok(craftIngredientCount(INDEX) >= 1_000, 'the ingredient census collapsed')
  assert.match(INDEX.scrapedAt, /^\d{4}-\d{2}-\d{2}T/, 'the index carries the corpus’s own scrape stamp')
})

test('the build is MEMOIZED — the second call is the same object, not a second walk of 8.6 MB', () => {
  assert.equal(craftIndex(), INDEX)
})

test('a page contributing TWO keys contributes ONE set of recipes, and every id is unique', () => {
  // The corpus files an item under its page title and, when `|itemname` differs, under that name
  // too. Walking `Object.entries` blind would file 56 duplicated recipe sets and the tab would
  // draw every one of them twice.
  const ids = new Set<string>()
  for (const recipe of INDEX.recipes) ids.add(recipe.id)
  assert.equal(ids.size, INDEX.recipes.length, 'a recipe id appears twice')
})

test('one item made by several PAGES keeps every one of those recipes', () => {
  // Not a duplicate: these are four genuinely different combines that all yield the same bow, and
  // one of them is the one whose cloth you actually have. Keying the row id on the product name
  // would have collapsed 58 recipes like these across the corpus.
  const bows = recipesFor('Carved Elm Recurve Bow')
  assert.ok(bows.length >= 3, `${String(bows.length)} ways to make one bow`)
  const ids = new Set(bows.map((b) => b.id))
  assert.equal(ids.size, bows.length)
  const cloths = new Set<string>()
  for (const bow of bows) for (const i of bow.ingredients) cloths.add(i.name)
  assert.ok(cloths.has('Silk String') && cloths.has('Hemp Twine'), [...cloths].join(' · '))
})

test('every recipe carries a skill from the closed set, and a label to print', () => {
  const allowed = new Set<string>([...TRADESKILLS, 'Other'])
  for (const recipe of INDEX.recipes) {
    assert.ok(allowed.has(recipe.skill), `${recipe.product}: ${recipe.skill}`)
    assert.notEqual(recipe.skillLabel, '', `${recipe.product} has no printable skill label`)
  }
})

test('the `Other` bucket keeps the wiki’s own words — the census, as an equality', () => {
  const labels = new Map<string, number>()
  for (const recipe of INDEX.recipes) {
    if (recipe.skill !== 'Other') continue
    labels.set(recipe.skillLabel, (labels.get(recipe.skillLabel) ?? 0) + 1)
  }
  assert.deepEqual(
    Object.fromEntries([...labels].sort((a, b) => b[1] - a[1])),
    { 'Not a tradeskill': 123, Fishing: 5, 'Cobalt drake armor': 1, 'Wooly Fungus Quest': 1 }
  )
})

// ---- the two recipes this feature was designed against -------------------------------

test('Gnome Kabobs reads exactly as the wiki states it', () => {
  const [kabobs, ...rest] = recipesFor('Gnome Kabobs')
  assert.equal(rest.length, 0, 'one recipe, one way to make it')
  assert.equal(kabobs.skill, 'Baking')
  assert.equal(kabobs.trivial, 56)
  assert.equal(kabobs.container, 'Oven')
  assert.equal(kabobs.yieldQty, 2)
  assert.equal(kabobs.unstated, false)
  assert.deepEqual(
    kabobs.ingredients.map((i) => i.name),
    ['Gnome Meat', 'Jug of Sauces', 'Skewers', 'Spices']
  )
  const skewers = kabobs.ingredients[2]
  assert.equal(skewers.consumed, false, 'Skewers are Returned on Success — a tool, not a component')
  assert.deepEqual(
    kabobs.ingredients.filter((i) => !i.consumed).map((i) => i.name),
    ['Skewers'],
    'and nothing else in this recipe comes back'
  )
})

test('Royal Temper lists Griffenne Blood, which is the one ingredient the reference dump holds', () => {
  const [temper, ...rest] = recipesFor('Royal Temper')
  assert.equal(rest.length, 0)
  assert.equal(temper.skill, 'Brewing')
  assert.deepEqual(
    temper.ingredients.map((i) => `${i.name} x${String(i.qty)}`),
    ['Essence of Sunlight x2', 'Griffenne Blood x1', 'Rain Water x1']
  )
  for (const ingredient of temper.ingredients) assert.equal(ingredient.consumed, true)
})

// ---- the plan ------------------------------------------------------------------------

test('an UNSTATED recipe is never makeable, however empty your bags are', () => {
  // 342 recipes state a `|playercrafted` block with no ingredients. An empty requirement list is
  // satisfied by an empty inventory, and that would be the app inventing a fact out of a silence.
  let unstated = 0
  for (const recipe of INDEX.recipes) {
    if (!recipe.unstated) continue
    unstated++
    const verdict = craftVerdict(recipe, HOLDING_NOTHING)
    assert.equal(verdict.makeable, false, recipe.product)
    assert.deepEqual(verdict.missing, [], 'and it reports no shortfall either — it stated nothing')
  }
  console.log(`    ${String(unstated)} recipes state no ingredient list`)
  assert.ok(unstated >= 300, `only ${String(unstated)} unstated recipes`)
  const plan = craftPlan(INDEX, HOLDING_NOTHING, { skill: '', query: '' })
  for (const verdict of plan.makeable) assert.equal(verdict.unstated, false)
  for (const verdict of plan.oneAway) assert.equal(verdict.unstated, false)
})

/**
 * THE REFERENCE READING, and it is the one the brief guessed wrong.
 *
 * `tests/fixtures/Primitive_freeport-Inventory.txt` names exactly one thing that is an ingredient of
 * anything: `Griffenne Blood`. Royal Temper is the recipe that wants it — and it wants two OTHER
 * things as well, so holding the blood leaves it TWO ingredient kinds short, which puts it in `all`
 * and in neither verdict section. That is the honest answer and it is what this test pins.
 */
test('holding only Griffenne Blood leaves Royal Temper TWO ingredients short, not one', () => {
  const [temper] = recipesFor('Royal Temper')
  assert.equal(temper.ingredients.length, 3, 'three ingredients: 2 Essence of Sunlight, 1 blood, 1 rain water')
  const verdict = craftVerdict(temper, HOLDING_GRIFFENNE)
  assert.equal(verdict.makeable, false)
  assert.deepEqual(
    verdict.missing.map((m) => `${m.name} need ${String(m.need)} have ${String(m.have)}`),
    ['Essence of Sunlight need 2 have 0', 'Rain Water need 1 have 0'],
    'worst shortfall first'
  )

  const plan = craftPlan(INDEX, HOLDING_GRIFFENNE, { skill: '', query: '' })
  const inAll = plan.all.some((v) => v.recipe.id === temper.id)
  const inOneAway = plan.oneAway.some((v) => v.recipe.id === temper.id)
  const inMakeable = plan.makeable.some((v) => v.recipe.id === temper.id)
  assert.equal(inAll, true, 'it is findable')
  assert.equal(inOneAway, false, 'two kinds short is not one away')
  assert.equal(inMakeable, false)
  console.log(
    `    with the reference dump: ${String(plan.makeable.length)} makeable · ${String(plan.oneAway.length)} one away · ${String(plan.all.length)} in all`
  )
  // The reference character can complete nothing AND has started nothing, which is exactly why
  // both empty states matter and why the tab has to draw them rather than showing two blank gaps.
  assert.equal(plan.makeable.length, 0)
  assert.equal(plan.oneAway.length, 0, 'one held blood is not one away from a three-ingredient brew')
})

// ---- "one away" means you have STARTED it (the owner's refinement) --------------------

/**
 * BOTH SIDES OF THE RULE, over real corpus recipes.
 *
 * `Acorn Oil` wants Misty Acorn and Water Flask, both consumed. Hold one and you are genuinely one
 * thing from a brew; hold neither and you are two things away, which is not the same claim.
 * `10 Dose Potion of Antiweight` wants one thing and one thing only, so it can never be "one away"
 * under the refined rule: an empty-handed character is one ingredient from EVERY such recipe, and
 * a section that said so would have been listing the game rather than the player.
 */
test('ONE AWAY requires progress: one kind missing AND one kind already held', () => {
  const [acorn] = recipesFor('Acorn Oil')
  assert.deepEqual(
    acorn.ingredients.map((i) => i.name),
    ['Misty Acorn', 'Water Flask'],
    'two consumed ingredients, which is the shortest recipe that can qualify'
  )

  // SIDE ONE: hold one of the two.
  const started = craftVerdict(acorn, (key) => (key === 'misty acorn' ? 1 : 0))
  assert.equal(started.heldKinds, 1)
  assert.deepEqual(
    started.missing.map((m) => m.name),
    ['Water Flask']
  )
  assert.equal(isOneAway(started), true)

  // SIDE TWO: hold neither. One missing kind short of TWO is not one away from anything.
  const untouched = craftVerdict(acorn, HOLDING_NOTHING)
  assert.equal(untouched.heldKinds, 0)
  assert.equal(untouched.missing.length, 2)
  assert.equal(isOneAway(untouched), false)
})

test('a SINGLE-ingredient recipe is never one away — it is makeable, or it is nothing yet', () => {
  const [dose] = recipesFor('10 Dose Potion of Antiweight')
  const consumed = dose.ingredients.filter((i) => i.consumed)
  assert.equal(consumed.length, 1, 'one ingredient, ten of it')

  const empty = craftVerdict(dose, HOLDING_NOTHING)
  assert.equal(empty.heldKinds, 0)
  assert.equal(empty.missing.length, 1)
  assert.equal(isOneAway(empty), false, 'holding nothing is not being close to something')

  const stocked = craftVerdict(dose, (key) => (key === consumed[0].key ? consumed[0].qty : 0))
  assert.equal(stocked.makeable, true)
  assert.equal(isOneAway(stocked), false, 'and once you have it, it belongs in "you can make now"')
})

test('the refinement is what emptied the section: 87 single-ingredient recipes used to fill it', () => {
  // The count is the measurement the ruling was made on. It is a FLOOR: a rescrape may add more
  // one-ingredient bottling recipes, and none of them belong in "one ingredient away" either.
  let singles = 0
  for (const recipe of INDEX.recipes) {
    let consumed = 0
    for (const ingredient of recipe.ingredients) if (ingredient.consumed) consumed++
    if (consumed === 1) singles++
  }
  console.log(`    ${String(singles)} recipes consume exactly one ingredient kind`)
  assert.ok(singles >= 80, `${String(singles)} single-ingredient recipes`)

  // With empty bags, every one of them is one MISSING kind — and none of them is one away.
  const plan = craftPlan(INDEX, HOLDING_NOTHING, { skill: '', query: '' })
  assert.equal(plan.oneAway.length, 0, 'an empty-handed character has started nothing')
  let oneMissing = 0
  for (const verdict of plan.all) if (!verdict.unstated && verdict.missing.length === 1) oneMissing++
  assert.equal(oneMissing, singles, 'and those are exactly the single-ingredient recipes')
})

test('the section fills for a character who has actually started something', () => {
  // Hold Misty Acorn: Acorn Oil is now one Water Flask away, and it says so through craftPlan.
  const plan = craftPlan(INDEX, (key) => (key === 'misty acorn' ? 1 : 0), { skill: '', query: 'acorn oil' })
  assert.ok(
    plan.oneAway.some((v) => v.recipe.product === 'Acorn Oil'),
    plan.oneAway.map((v) => v.recipe.product).join(' · ')
  )
  for (const verdict of plan.oneAway) {
    assert.equal(verdict.missing.length, 1)
    assert.ok(verdict.heldKinds >= 1, verdict.recipe.product)
  }
})

test('the search reaches INGREDIENT names, not just product names', () => {
  const byIngredient = craftPlan(INDEX, HOLDING_GRIFFENNE, { skill: '', query: 'griffenne blood' })
  assert.deepEqual(
    byIngredient.all.map((v) => v.recipe.product),
    ['Royal Temper'],
    'the one recipe that wants the one thing the reference dump holds'
  )
  // And Royal Temper is itself an ingredient of the plate armour lines, so its own name reaches
  // far more rows than its own recipe — which is the whole point of searching both ends.
  const byName = craftPlan(INDEX, HOLDING_GRIFFENNE, { skill: '', query: 'royal temper' })
  assert.ok(byName.all.length > 50, `${String(byName.all.length)} recipes name Royal Temper`)
  assert.ok(byName.all.some((v) => v.recipe.product === 'Royal Temper'))
})

test('the tradeskill filter narrows the list, and Any is every recipe', () => {
  const any = craftPlan(INDEX, HOLDING_NOTHING, { skill: '', query: '' })
  assert.equal(any.all.length, INDEX.recipes.length)
  const baking = craftPlan(INDEX, HOLDING_NOTHING, { skill: 'Baking', query: '' })
  assert.ok(baking.all.length > 0 && baking.all.length < any.all.length)
  for (const verdict of baking.all) assert.equal(verdict.recipe.skill, 'Baking')
  const other = craftPlan(INDEX, HOLDING_NOTHING, { skill: 'Other', query: '' })
  for (const verdict of other.all) assert.equal(verdict.recipe.skill, 'Other')
})

test('a non-consumed ingredient never gates a verdict', () => {
  // Skewers come back from the combine, so a baker who holds meat, sauce and spices can make
  // kabobs whether or not the dump names a skewer.
  const [kabobs] = recipesFor('Gnome Kabobs')
  const pantry = (key: string): number =>
    key === 'gnome meat' || key === 'jug of sauces' || key === 'spices' ? 1 : 0
  const verdict = craftVerdict(kabobs, pantry)
  assert.equal(verdict.makeable, true)
  assert.deepEqual(verdict.missing, [])
})

test('the builder is PURE — a hand-made corpus goes in, its recipes come out', () => {
  const file = {
    scrapedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    count: 1,
    items: {
      widget: { page: 'Widget', craftedBy: [{ tradeskill: ':Tailoring', ingredients: [{ name: 'Silk', qty: 3 }] }] }
    }
  } as unknown as ItemDbFile
  const built = buildCraftIndex(file)
  assert.equal(built.scrapedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(built.recipes.length, 1)
  assert.equal(built.recipes[0].skill, 'Tailoring')
  assert.equal(built.recipes[0].productKey, 'widget')
  assert.equal(built.recipes[0].ingredients[0].key, 'silk')
})
