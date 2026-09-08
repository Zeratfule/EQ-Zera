// shared/craft.ts — the recipe model, unit-tested against the dirt the corpus actually contains.
//
// Every input below was READ OFF `src/main/data/items.json` (the 2026-08-22 scrape), which is why
// this file is short and specific rather than a table of imagined spellings: the interesting
// behaviour of `normalizeTradeskill` is what it does with the twenty distinct tradeskill strings
// that are really in there, and the interesting behaviour of `craftRecipesOf` is what it does with
// `water flask`'s duplicated `Bottle` row and `gnome kabobs`'s returned Skewers.
//
// No Electron, no fixtures, no network: this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CRAFT_INDEX_CHANNEL,
  TRADESKILLS,
  craftIngredientCount,
  craftRecipesOf,
  normalizeTradeskill
} from '../src/shared/craft'
import type { ItemCraftRecipe } from '../src/shared/types'

// ---- the tradeskill names ------------------------------------------------------------

test('the channel string is one constant, spelled once', () => {
  assert.equal(CRAFT_INDEX_CHANNEL, 'craft:index')
})

test('every canonical tradeskill normalizes to itself, label and all', () => {
  for (const skill of TRADESKILLS) {
    assert.deepEqual(normalizeTradeskill(skill), { skill, label: skill })
  }
})

test('the dirty spellings the corpus really contains fold onto the eleven', () => {
  // Each of these is a real `tradeskill` value in the committed corpus.
  const table: [string, string][] = [
    [':Tailoring', 'Tailoring'],
    ['Jewelcrafting', 'Jewelry Making'],
    ['Jewelry Making', 'Jewelry Making'],
    ['Make Poison', 'Poison Making'],
    ['Poison Making', 'Poison Making'],
    ['Skill Fletching', 'Fletching'],
    ['Fletching', 'Fletching'],
    ['Spell Research', 'Research'],
    ['Research', 'Research']
  ]
  for (const [raw, want] of table) {
    assert.deepEqual(normalizeTradeskill(raw), { skill: want, label: want }, raw)
  }
})

test('`Non-Tradeskill` is Other, and says so in plain words rather than repeating the wiki', () => {
  assert.deepEqual(normalizeTradeskill('Non-Tradeskill'), { skill: 'Other', label: 'Not a tradeskill' })
})

test('a name nobody has verified is Other WITH ITS OWN TEXT KEPT (law 1, never invent)', () => {
  // All three are real corpus values. `Fishing` is a genuine EQ skill this app does not model, and
  // the other two are a page putting the wrong thing in the field. None of them may be guessed at.
  for (const raw of ['Fishing', 'Cobalt drake armor', 'Wooly Fungus Quest']) {
    assert.deepEqual(normalizeTradeskill(raw), { skill: 'Other', label: raw }, raw)
  }
})

test('a missing tradeskill is a silence, and reads as one', () => {
  assert.deepEqual(normalizeTradeskill(undefined), { skill: 'Other', label: 'Not stated' })
  assert.deepEqual(normalizeTradeskill('   '), { skill: 'Other', label: 'Not stated' })
})

// ---- the ingredient fold -------------------------------------------------------------

/** `water flask`'s recipe, verbatim from the corpus - note `Bottle` twice, once of them bare. */
const WATER_FLASK: ItemCraftRecipe[] = [
  {
    tradeskill: 'Brewing',
    ingredients: [
      { name: 'Pod of Water', qty: 4, sources: ['Foraged'] },
      { name: 'Bottle', qty: 1, sources: ['Bought'] },
      { name: 'Bottle' }
    ],
    trivial: 21,
    yieldItem: 'Water Flask',
    yieldQty: 1,
    container: 'Brew Barrel'
  }
]

/** `gnome kabobs`, verbatim - Skewers come back from the combine. */
const GNOME_KABOBS: ItemCraftRecipe[] = [
  {
    tradeskill: 'Baking',
    ingredients: [
      { name: 'Gnome Meat', qty: 1, sources: ['Dropped'] },
      { name: 'Jug of Sauces', qty: 1, sources: ['Bought'] },
      { name: 'Skewers', qty: 1, sources: ['Crafted', 'Returned on Failure', 'Returned on Success'] },
      { name: 'Spices', qty: 1, sources: ['Bought'] }
    ],
    trivial: 56,
    yieldItem: 'Gnome Kabobs',
    yieldQty: 2,
    container: 'Oven'
  }
]

test('two rows for one ingredient are ONE ingredient - qty is the max stated, sources are unioned', () => {
  const [recipe] = craftRecipesOf('Water Flask', 'water flask', WATER_FLASK)
  assert.equal(recipe.ingredients.length, 2, 'the duplicated Bottle row must not become a second requirement')
  const bottle = recipe.ingredients[1]
  assert.equal(bottle.key, 'bottle')
  assert.equal(bottle.name, 'Bottle')
  // The bare row states NO qty, and "nothing" must never lower a number the page printed.
  assert.equal(bottle.qty, 1)
  assert.deepEqual(bottle.sources, ['Bought'])
  assert.equal(bottle.consumed, true)
  // Order is the page's own, and the first row's spelling is the one displayed.
  assert.equal(recipe.ingredients[0].name, 'Pod of Water')
  assert.equal(recipe.ingredients[0].qty, 4)
})

test('a `Returned on Success` ingredient is NOT consumed, and everything beside it still is', () => {
  const [recipe] = craftRecipesOf('Gnome Kabobs', 'gnome kabobs', GNOME_KABOBS)
  assert.equal(recipe.ingredients.length, 4)
  const skewers = recipe.ingredients[2]
  assert.equal(skewers.name, 'Skewers')
  assert.equal(skewers.consumed, false)
  assert.deepEqual(
    recipe.ingredients.filter((i) => i.consumed).map((i) => i.name),
    ['Gnome Meat', 'Jug of Sauces', 'Spices']
  )
})

test('the combine facts ride the row: skill, trivial, container, yield, and a stable id', () => {
  const [recipe] = craftRecipesOf('Gnome Kabobs', 'gnome kabobs', GNOME_KABOBS)
  assert.equal(recipe.id, 'gnome kabobs#0')
  assert.equal(recipe.product, 'Gnome Kabobs')
  assert.equal(recipe.productKey, 'gnome kabobs')
  assert.equal(recipe.skill, 'Baking')
  assert.equal(recipe.skillLabel, 'Baking')
  assert.equal(recipe.trivial, 56)
  assert.equal(recipe.container, 'Oven')
  assert.equal(recipe.yieldQty, 2)
  assert.equal(recipe.unstated, false)
})

test('an absent fact is ABSENT, never an explicit undefined (one shape on both sides of the wire)', () => {
  const [recipe] = craftRecipesOf('Thing', 'thing', [{ tradeskill: 'Pottery', ingredients: [{ name: 'Clay' }] }])
  assert.equal('trivial' in recipe, false)
  assert.equal('container' in recipe, false)
  assert.equal('yieldQty' in recipe, false)
  assert.equal(recipe.ingredients[0].qty, 1, 'an omitted qty is one, not zero')
})

test('an EMPTY ingredient list is flagged UNSTATED - a silence is not an empty requirement', () => {
  const [recipe] = craftRecipesOf('Mystery', 'mystery', [{ tradeskill: 'Blacksmithing', ingredients: [] }])
  assert.equal(recipe.unstated, true)
  assert.deepEqual(recipe.ingredients, [])
})

test('two ways to make one item are two rows, ids numbered by the order the page listed them', () => {
  const recipes = craftRecipesOf('Thing', 'thing', [
    { tradeskill: 'Pottery', ingredients: [{ name: 'Clay' }] },
    { tradeskill: 'Baking', ingredients: [{ name: 'Flour' }] }
  ])
  assert.deepEqual(
    recipes.map((r) => r.id),
    ['thing#0', 'thing#1']
  )
})

test('the ingredient census counts DISTINCT keys across the whole index', () => {
  const recipes = [
    ...craftRecipesOf('Water Flask', 'water flask', WATER_FLASK),
    ...craftRecipesOf('Gnome Kabobs', 'gnome kabobs', GNOME_KABOBS)
  ]
  // Pod of Water, Bottle, Gnome Meat, Jug of Sauces, Skewers, Spices.
  assert.equal(craftIngredientCount({ scrapedAt: '', recipes }), 6)
})
