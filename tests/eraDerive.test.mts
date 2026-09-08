// LAYER 3 OF THE ERA JOIN — the rules, on records small enough to read (JOS-333, JOS-341).
//
// `src/main/planner/eraDerive.ts` decides the era of an item nothing states one for, because the
// way the corpus says you would GET it points at content the wiki HAS classified. The rule is blunt
// by owner ruling — ONE out-of-era edge is enough — so what matters is exactly where it REFUSES,
// and every refusal below is a case the corpus actually contains.
//
// JOS-341 added the two edges that reach OFF the item corpus, and both of them broke a sentence
// this file used to be able to write:
//   `page`     — an armour-set hub or quest index, whose verdict is fetched at data-build time and
//                committed (`src/main/data/pageEra.json`). It points BOTH ways, so "layer 3 can
//                only hide" is no longer true, and the in-era direction has its own refusal: a
//                page that came back `outOfEra: false` while stating no era of its own is SILENT,
//                not in era.
//   `drop-mob` — every mob that drops it is badged out. DEFINITIVE: it is the one edge here that
//                may overrule a drop zone, because a revamped zone keeps its name while its
//                contents change.
//
// The corpus sweep lives in `tests/plannerEraCorpus.test.mts` and asserts what these rules do to
// 11,213 committed pages, including the four rows the owner named. This file is the vocabulary:
// hand-written records, no committed bytes, so a failure here names a RULE.
//
// No Electron, no fixtures, no game directory ⇒ this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCatalogDroppers,
  buildCatalogZones,
  buildEraDerivations,
  buildQuestIndex,
  deriveEra,
  eraEdges,
  type EraDeriveCatalogs
} from '../src/main/planner/eraDerive'
import { itemKey, type ItemDbEntry, type ItemDbFile } from '../src/main/itemsDb'
import type { PageEraFile } from '../src/main/pageEraDb'
import type { ItemCraftIngredient, MobData, QuestData } from '../src/shared/types'

// ---- the smallest world the rules can be asked about ------------------------------------------

function item(page: string, extra: Partial<ItemDbEntry> = {}): ItemDbEntry {
  return { page, ...extra }
}

function corpusOf(...entries: ItemDbEntry[]): Map<string, ItemDbEntry> {
  return new Map(entries.map((e) => [itemKey(e.page), e]))
}

function recipe(ingredients: ItemCraftIngredient[], yieldItem?: string): ItemDbEntry['craftedBy'] {
  return [{ tradeskill: 'Blacksmithing', ingredients, ...(yieldItem === undefined ? {} : { yieldItem }) }]
}

const QUESTS: QuestData = {
  scrapedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  quests: [
    { name: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', startZone: 'East Cabilis' },
    { name: 'A Classic Errand', page: 'A Classic Errand', startZone: 'Plane of Hate' },
    { name: 'A Quest With No Zone', page: 'A Quest With No Zone' }
  ]
}

const NO_MOBS: MobData = { scrapedAt: '2026-01-01T00:00:00.000Z', source: 'test', mobs: [] }

/** Two droppers, so the zone edge has something real to fold: one Kunark-only, one that also drops
 *  in a zone this server ships. */
const MOBS: MobData = {
  scrapedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  mobs: [
    { page: 'a brute', name: 'a brute', zones: ['Warsliks Woods', 'Dreadlands'], drops: ['Brute Hide'] },
    { page: 'a bat', name: 'a bat', zones: ['Plane of Hate'], drops: ['Common Hide'] },
    { page: 'a tiger', name: 'a tiger', zones: ['Lake of Ill Omen'], drops: ['Common Hide'] }
  ]
}

/** An EMPTY sidecar: no page verdicts, no mob verdicts. The JOS-333 world, so the four original
 *  edges are tested exactly as they were and neither new edge can fire by accident. */
const NO_PAGES: PageEraFile = { scrapedAt: '', source: 'test', count: 0, pages: {}, refs: {}, mobs: {} }

function catalogs(mobs: MobData = MOBS, pageEra: PageEraFile = NO_PAGES): EraDeriveCatalogs {
  return {
    questByName: buildQuestIndex(QUESTS),
    catalogZones: buildCatalogZones(mobs),
    catalogDroppers: buildCatalogDroppers(mobs),
    pageEra
  }
}

const dropped = (name: string): ItemCraftIngredient => ({ name, qty: 1, sources: ['Dropped'] })
const bought = (name: string): ItemCraftIngredient => ({ name, qty: 1, sources: ['Bought'] })

// ---- edge 1: the wiki's own badge on a component ----------------------------------------------

test('a recipe component the wiki badges out of era marks the product out, bought or not', () => {
  // THE OWNER'S EXAMPLE, in miniature. The mold is BOUGHT, and it is still the wall: `{{Epics Era}}`
  // is a claim about the content, not about the shopkeeper, and it is what the wiki draws the pill
  // on. So the badge edge takes no notice of `sources` — which is the opposite of edge 4 below, and
  // the asymmetry is the whole design.
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const product = item('Dwarven Plate Breastplate', { craftedBy: recipe([bought('Small Breastplate Mold')]) })
  const derived = deriveEra(product, corpusOf(mold, product), catalogs())
  assert.deepEqual(derived, {
    basis: 'component',
    verdict: 'out-of-era',
    target: 'Small Breastplate Mold',
    detail: 'Epics'
  })
})

test('an IN-era component states nothing, and an unknown component states nothing either', () => {
  const inEra = item('Ordinary Mold', { eraTag: 'Classic' })
  const silent = item('Silent Mold')
  const product = item('A Breastplate', {
    craftedBy: recipe([bought('Ordinary Mold'), bought('Silent Mold'), bought('A Mold Nobody Wrote Up')])
  })
  assert.equal(deriveEra(product, corpusOf(inEra, silent, product), catalogs()), null)
})

test('ONE out-of-era component is enough, even beside components that are fine', () => {
  // The owner's ruling, verbatim in the module header: treat any reference to out-of-era as fairly
  // definitive. The first cut of this ticket asked for every-path-must-be-out; this test is the
  // difference between the two rules.
  const product = item('A Breastplate', {
    craftedBy: recipe([bought('Ordinary Mold'), bought('Small Breastplate Mold')])
  })
  const corpus = corpusOf(item('Ordinary Mold', { eraTag: 'Classic' }), item('Small Breastplate Mold', { eraTag: 'Epics' }), product)
  assert.equal(deriveEra(product, corpus, catalogs())?.basis, 'component')
})

// ---- edge 2: the recipe's yield -----------------------------------------------------------------

test('a recipe whose YIELD is a different, badged page counts; yielding ITSELF does not', () => {
  const other = item('Velium Thing', { eraTag: 'Velious' })
  const product = item('A Combine', { craftedBy: recipe([bought('Ordinary Mold')], 'Velium Thing') })
  assert.deepEqual(deriveEra(product, corpusOf(other, product), catalogs()), {
    basis: 'yield',
    verdict: 'out-of-era',
    target: 'Velium Thing',
    detail: 'Velious'
  })

  // The normal case: `|yieldItem` names the page it is on. That is not an edge to anywhere.
  const selfYield = item('Velium Thing', { eraTag: 'Velious', craftedBy: recipe([bought('Ordinary Mold')], 'Velium Thing') })
  assert.deepEqual(eraEdges(selfYield, corpusOf(selfYield), catalogs()), [])
})

// ---- edge 3: the awarding / related quest -------------------------------------------------------

test('a related quest that starts in an unopened expansion marks the item out', () => {
  // Scaled Mystic Breastplate's own shape: the use names the ITEM as the quest and the ARMOUR-SET
  // page as the page, so the quest index has to answer to both spellings or this family is missed.
  const bp = item('Scaled Mystic Breastplate', {
    questUses: [{ quest: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', source: 'wiki' }]
  })
  assert.deepEqual(deriveEra(bp, corpusOf(bp), catalogs()), {
    basis: 'quest',
    verdict: 'out-of-era',
    target: 'Scaled Mystic Breastplate',
    detail: 'East Cabilis'
  })
})

test('a quest we cannot resolve, or that states no start zone, states NOTHING (law 1)', () => {
  const unlisted = item('A Reward', { questUses: [{ quest: 'A Quest Nobody Scraped', source: 'wiki' }] })
  assert.equal(deriveEra(unlisted, corpusOf(unlisted), catalogs()), null)

  const zoneless = item('Another Reward', { questUses: [{ quest: 'A Quest With No Zone', source: 'wiki' }] })
  assert.equal(deriveEra(zoneless, corpusOf(zoneless), catalogs()), null)

  const classic = item('A Third Reward', { questUses: [{ quest: 'A Classic Errand', source: 'wiki' }] })
  assert.equal(deriveEra(classic, corpusOf(classic), catalogs()), null)
})

test('every related quest counts, not only the ones the catalog calls a reward', () => {
  // `role` is present ONLY on quest-catalog uses, so a rule that read it would silently drop the
  // whole `|relatedquests` family — the exact family the owner's screenshot shows badged.
  const turnIn = item('A Turn-in', {
    questUses: [{ quest: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', source: 'quests', role: 'required' }]
  })
  assert.equal(deriveEra(turnIn, corpusOf(turnIn), catalogs())?.basis, 'quest')
})

// ---- edge 4: a component you can only kill for --------------------------------------------------

test('a DROPPED-only component whose every zone is a later expansion marks the item out', () => {
  const hide = item('Brute Hide')
  const product = item('Vale Tunic', { craftedBy: recipe([dropped('Brute Hide')]) })
  assert.deepEqual(deriveEra(product, corpusOf(hide, product), catalogs()), {
    basis: 'component-zone',
    verdict: 'out-of-era',
    target: 'Brute Hide',
    detail: 'Warsliks Woods, Dreadlands'
  })
})

test('THE GOLD BAR REFUSAL: a component you can BUY is not judged by where it also drops', () => {
  // Measured, not imagined. Gold Bar's catalog droppers all live in Plane of Mischief, so before
  // this guard the zone read hid the whole Gold cultural plate family — while the recipe says the
  // ingredient is Bought, its own page opens `{{Classic Era}}`, and the wiki's own `eqlmetadata`
  // calls it in era. Twelve Platinum rows had the same shape.
  const bar = item('Brute Hide')
  const product = item('Gold Tunic', { craftedBy: recipe([bought('Brute Hide')]) })
  assert.equal(deriveEra(product, corpusOf(bar, product), catalogs()), null)

  // An UNSTATED source list is refused for the same reason: "the page did not say how you get this"
  // is not "you can only kill for it".
  const unstated = item('Quiet Tunic', { craftedBy: recipe([{ name: 'Brute Hide', qty: 1 }]) })
  assert.equal(deriveEra(unstated, corpusOf(bar, unstated), catalogs()), null)
})

test('a dropped component the catalog ALSO places in a reachable zone states nothing', () => {
  // `Common Hide` drops off a Plane of Hate bat and a Lake of Ill Omen tiger. Any reachable source
  // makes it farmable, exactly as layer 1 has always folded a zone list.
  const hide = item('Common Hide')
  const product = item('Common Tunic', { craftedBy: recipe([dropped('Common Hide')]) })
  assert.equal(deriveEra(product, corpusOf(hide, product), catalogs()), null)

  // And with no catalog at all it still says nothing: an empty zone list resolves to `unknown`, and
  // unknown is never an accusation.
  assert.equal(deriveEra(product, corpusOf(hide, product), catalogs(NO_MOBS)), null)
})

// ---- edge 5: a link target the item corpus does not hold (JOS-341) --------------------------------

/** A sidecar naming three pages and two mobs — the shapes the real fetch produces. */
const SIDECAR: PageEraFile = {
  scrapedAt: '2026-08-13T00:00:00.000Z',
  source: 'test',
  count: 3,
  pages: {
    // the owner's case: an armour-SET hub the endpoint badges out
    'cultural tradeskills: human': {
      title: 'Cultural Tradeskills: Human',
      outOfEra: true,
      eraTag: 'Epics',
      by: 'eqlmetadata'
    },
    // a set page the wiki files as classic content — a CLAIM, and the in-era direction
    'large banded armor set': { title: 'Large Banded Armor Set', outOfEra: false, eraTag: 'Classic', by: 'eqlmetadata' },
    // asked, answered "not out", and states no era at all: SILENCE, not evidence
    blacksmithing: { title: 'Blacksmithing', outOfEra: false, by: 'eqlmetadata' }
  },
  refs: {
    'silver full plate': ['Cultural Tradeskills: Human'],
    'banded belt': ['Large Banded Armor Set'],
    'plain hammer': ['Blacksmithing'],
    'unfetched thing': ['A Page Nobody Asked About'],
    'both ways': ['Large Banded Armor Set', 'Cultural Tradeskills: Human']
  },
  mobs: { 'agent of innoruuk': true, 'a froglok gaz squire': false }
}

test('a |notes link target the wiki badges out marks the item out, naming the page', () => {
  // SILVER FULL BREASTPLATE, the row JOS-333 pinned as a named refusal. Its only out-of-era
  // reference is a link to an armour-SET page, which is not an `{{Itempage}}` and so is not in the
  // item corpus at all. The fetched sidecar is the reach.
  const plate = item('Silver Full Plate')
  assert.deepEqual(deriveEra(plate, corpusOf(plate), catalogs(MOBS, SIDECAR)), {
    basis: 'page',
    verdict: 'out-of-era',
    target: 'Cultural Tradeskills: Human',
    detail: 'Epics'
  })
})

test('a link target the wiki files as IN-era is evidence FOR the item, and says so', () => {
  // The direction JOS-333 could not have: under the era?-hides rule a row with no verdict is
  // hidden, so declining to read a positive classification is a decision to hide gear the wiki
  // says is here.
  const belt = item('Banded Belt')
  assert.deepEqual(deriveEra(belt, corpusOf(belt), catalogs(MOBS, SIDECAR)), {
    basis: 'page',
    verdict: 'in-era',
    target: 'Large Banded Armor Set',
    detail: 'Classic'
  })
})

test('OUT beats IN: one badged reference decides, whatever else the notes name', () => {
  const both = item('Both Ways')
  assert.equal(deriveEra(both, corpusOf(both), catalogs(MOBS, SIDECAR))?.verdict, 'out-of-era')
})

test('THE SILENCE REFUSAL: `outOfEra: false` with no era token states NOTHING', () => {
  // The whole reason the fetch keeps each page's own era token. The endpoint answers `false` both
  // for a page filed under `Classic Era` and for a page nobody ever classified; reading the second
  // as evidence would let a link to [[Blacksmithing]] argue a hammer into the current-era view.
  const hammer = item('Plain Hammer')
  assert.equal(deriveEra(hammer, corpusOf(hammer), catalogs(MOBS, SIDECAR)), null)

  // And a target the fetch never asked about is absent, which is silence too (law 1).
  const unfetched = item('Unfetched Thing')
  assert.equal(deriveEra(unfetched, corpusOf(unfetched), catalogs(MOBS, SIDECAR)), null)
})

// ---- edge 6: the droppers, and the one edge that may overrule a zone ------------------------------

test("LIFE'S GUARD: every dropper badged out beats the zone that names the revamped plane", () => {
  // The owner's addition, in miniature — and the correction with it. This row is not era?: its page
  // states `{{Classic Era}}` and its dropper sits under a `Plane of Hate` heading, so layers 1-2
  // call it IN ERA. The pill on the real page is on `[[Agent of Innoruuk]]`, a revamp mob. A revamp
  // replaces a zone's CONTENTS without adding a zone, so the mob is the witness and the zone is not.
  const guard = item("Life's Guard", {
    eraTag: 'Classic',
    dropsFrom: [{ mob: 'Agent of Innoruuk', zone: 'Plane of Hate' }]
  })
  assert.deepEqual(deriveEra(guard, corpusOf(guard), catalogs(NO_MOBS, SIDECAR)), {
    basis: 'drop-mob',
    verdict: 'out-of-era',
    definitive: true,
    target: 'Agent of Innoruuk',
    detail: 'Agent of Innoruuk'
  })

  // DEFINITIVE is what lets the build keep it on a row layers 1-2 already decided. Every other edge
  // is dropped for such a row, which is what "layer 3 speaks into silence" still means for them.
  const file: ItemDbFile = {
    scrapedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    count: 1,
    items: { [itemKey(guard.page)]: guard }
  }
  assert.equal(buildEraDerivations(file, catalogs(NO_MOBS, SIDECAR)).get("life's guard")?.basis, 'drop-mob')
})

test('EVERY dropper, not any: one reachable dropper keeps the item farmable', () => {
  // This repo's own doctrine for this evidence class, already written into `eraVerdictAt`: a mob
  // that spawns in both Lower Guk and Kael Drakkel is still a Lower Guk camp. Measured over the
  // corpus, any-dropper would flip 518 in-era rows and every-dropper flips 33.
  const mixed = item('Mixed Drop', {
    dropsFrom: [{ mob: 'Agent of Innoruuk' }, { mob: 'a froglok gaz squire' }]
  })
  assert.equal(deriveEra(mixed, corpusOf(mixed), catalogs(NO_MOBS, SIDECAR)), null)

  // A dropper the fetch never asked about blocks it too — silence is not `false`.
  const unasked = item('Unasked Drop', { dropsFrom: [{ mob: 'Agent of Innoruuk' }, { mob: 'a mob nobody fetched' }] })
  assert.equal(deriveEra(unasked, corpusOf(unasked), catalogs(NO_MOBS, SIDECAR)), null)

  // And an item nobody drops has no dropper edge at all, however badged the world is.
  const crafted = item('Crafted Thing', { craftedBy: recipe([bought('Ordinary Mold')]) })
  assert.equal(deriveEra(crafted, corpusOf(crafted), catalogs(NO_MOBS, SIDECAR)), null)
})

test('the CATALOG counts as a dropper witness beside the page (both, or neither is safe)', () => {
  // The renderer folds the mob catalog's zones in beside the page's own `|dropsfrom`, so an edge
  // that read only the page could call an item unreachable that the catalog knows a reachable mob
  // drops. `a froglok gaz squire` is badged IN, and here only the catalog knows it drops this.
  const catalog: MobData = {
    scrapedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    mobs: [{ page: 'a froglok gaz squire', name: 'a froglok gaz squire', zones: ['Lower Guk'], drops: ['Contested Loot'] }]
  }
  const loot = item('Contested Loot', { dropsFrom: [{ mob: 'Agent of Innoruuk' }] })
  assert.equal(deriveEra(loot, corpusOf(loot), catalogs(catalog, SIDECAR)), null)
})

// ---- which edge gets reported -------------------------------------------------------------------

test('the strongest edge is reported, and it is the wiki badge over our zone reading', () => {
  const product = item('A Mixed Thing', {
    craftedBy: recipe([dropped('Brute Hide'), bought('Small Breastplate Mold')]),
    questUses: [{ quest: 'Scaled Mystic Breastplate', page: 'Scaled Mystic Armor Quests', source: 'wiki' }]
  })
  const corpus = corpusOf(item('Brute Hide'), item('Small Breastplate Mold', { eraTag: 'Epics' }), product)
  const edges = eraEdges(product, corpus, catalogs()).map((e) => e.basis).sort()
  assert.deepEqual(edges, ['component', 'component-zone', 'quest'])
  assert.equal(deriveEra(product, corpus, catalogs())?.basis, 'component')
})

// ---- what the walk deliberately does NOT do -----------------------------------------------------

test('`recipes` (what this item is FOR) is never walked, and neither is a second hop', () => {
  // A bone chip usable in a Velious combine is still a bone chip. Walking `|recipes` would invert
  // the question the derivation is asking.
  const usedIn = item('Bone Chip', { recipes: [{ recipe: 'Velium Thing', tradeskill: 'Blacksmithing' }] })
  assert.deepEqual(eraEdges(usedIn, corpusOf(usedIn, item('Velium Thing', { eraTag: 'Velious' })), catalogs()), [])

  // ONE HOP. `Middle` is crafted from a badged mold, so `Middle` itself derives out — but `Outer`,
  // which is crafted from `Middle`, does not inherit that. `Middle` states no era of its OWN, and a
  // rule whose answer depends on how far you chose to walk cannot be checked against a screenshot.
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const middle = item('Middle', { craftedBy: recipe([bought('Small Breastplate Mold')]) })
  const outer = item('Outer', { craftedBy: recipe([bought('Middle')]) })
  const corpus = corpusOf(mold, middle, outer)
  assert.equal(deriveEra(middle, corpus, catalogs())?.basis, 'component')
  assert.equal(deriveEra(outer, corpus, catalogs()), null)
})

// ---- the file-level build ------------------------------------------------------------------------

test('the build skips any page whose OWN page or drop zones already answered', () => {
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const file: ItemDbFile = {
    scrapedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    count: 4,
    items: {
      [itemKey(mold.page)]: mold,
      // states no era, nothing places it: layer 3's business
      silent: item('Silent Plate', { craftedBy: recipe([bought('Small Breastplate Mold')]) }),
      // its own page states an era: layers 1-2 already spoke, layer 3 stays out of it
      tagged: item('Tagged Plate', { eraTag: 'Classic', craftedBy: recipe([bought('Small Breastplate Mold')]) }),
      // a drop zone places it: same
      placed: item('Placed Plate', {
        dropsFrom: [{ mob: 'a bat', zone: 'Plane of Hate' }],
        craftedBy: recipe([bought('Small Breastplate Mold')])
      })
    }
  }
  const built = buildEraDerivations(file, catalogs())
  assert.deepEqual([...built.keys()], ['silent plate'])
  assert.equal(built.get('silent plate')?.target, 'Small Breastplate Mold')
})

test('the build walks PAGES, so an |itemname alias key cannot produce a second answer', () => {
  const mold = item('Small Breastplate Mold', { eraTag: 'Epics' })
  const plate = item('Silent Plate', { name: 'Silent Plate (in game)', craftedBy: recipe([bought('Small Breastplate Mold')]) })
  const file: ItemDbFile = {
    scrapedAt: '2026-01-01T00:00:00.000Z',
    source: 'test',
    count: 3,
    items: {
      [itemKey(mold.page)]: mold,
      'silent plate': plate,
      // the alias key: the SAME record, filed under the in-game name
      'silent plate (in game)': plate
    }
  }
  const built = buildEraDerivations(file, catalogs())
  assert.deepEqual([...built.keys()], ['silent plate'], 'the alias key produced its own entry')
})
