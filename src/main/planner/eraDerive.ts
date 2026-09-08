// planner/eraDerive.ts — LAYER 3 OF THE ERA JOIN: the era an item never states, read off the way
// the corpus says you would GET it (JOS-333, then JOS-341).
//
// ---------------------------------------------------------------------------------------------
// WHAT JOS-341 CHANGED, UP FRONT, because it invalidated two sentences this header used to open
// with ("layer 3 can only ever hide" and "no new scraping")
// ---------------------------------------------------------------------------------------------
//
// JOS-333 walked the ITEM corpus and nothing else, and it ended with a measured refusal: 824 era?
// rows point at 151 pages that are not items — armour-set hubs, quest indexes — and the corpus
// physically cannot hold them (it enumerates `embeddedin Template:Itempage`). The owner ruled that
// remainder unacceptable to show, `era?` was made to hide (73ad7ec9), and JOS-341 went and ASKED
// the wiki. `scripts/scrape-page-era.ts` puts those titles, plus every dropper mob the corpus and
// the mob catalog name, through eqlwiki's own `action=eqlmetadata` at DATA-BUILD time and commits
// the answer as `src/main/data/pageEra.json` (shape: `main/pageEraDb.ts`). Twenty-two live
// requests, warm cache zero, and nothing at runtime ever calls the wiki.
//
// That bought two edges and cost two simplifications:
//   * `page` POINTS BOTH WAYS. An armour-set page the wiki files under `Classic Era` is a positive
//     claim about its members, and while `era?` hides, refusing to read it is a decision to hide
//     gear the wiki says is right here. So a derivation now carries a `verdict`.
//   * `drop-mob` IS DEFINITIVE — the one edge in this file allowed to overrule a drop zone. See
//     its own block below for the argument and for the correction to the example that produced it.
//
// THE REPORT THIS EXISTS FOR. The owner photographed three gear rows the app chips `era?` whose
// wiki pages are visibly covered in red `OUT OF ERA` pills: Dwarven Breastplate (Enchanted Imbued),
// Silver Full Breastplate, Scaled Mystic Breastplate. JOS-328 had already swept the corpus for
// out-of-era markers on those pages and found none, and that sweep was CORRECT — the pills are not
// on the page, they are on its LINKS.
//
// THE MECHANISM, characterized live 2026-08-13 before a line of this was written (seven requests,
// each announced on the ticket first). The pill is not parser output, not a template and not a
// gadget: eqlwiki runs a custom skin whose ResourceLoader module `skins.EQLImmersive.eraFilter`
// walks every internal `a[href]` on a rendered page, maps each href to its target title, and asks a
// custom `action=eqlmetadata` endpoint for that target's `outOfEra`. Targets that come back true get
// `class="eql-era-out-link"`, and the pill is CSS on that class. Four modes cycle off the header
// clock button — Off, On (pill), Outline, and Hide, which removes whole table ROWS owning an
// out-of-era link. The module's documented fallback, for when the custom endpoint fails, is the
// specification in the open: `action=query&prop=categories` on the TARGET, matched against
// `mw.config.wgEQLEraOutKeys`. That config on a live page read
// `[kunark, velious, luclin, chardok, chardokrevamp, holevp, warrensfearhaterevamp, fearhaterevamp,
// epics, epicquests, unknown]` at `wgEQLEraConfigRevision` 156232 — the exact `out` set of
// `PAGE_ERA` in `shared/planner/era.ts`, at the exact `Template:PageEra` revid that file already
// cites. `eraBadge(tag) == 'out'` IS the wiki's predicate. We hold it for 7,560 committed pages,
// so the derivation is a graph walk over bytes we already ship and needed no new scraping.
//
// GROUND TRUTH, taken from that same endpoint the same day and quoted here because the three rows
// below are what anyone will check first:
//   Small Breastplate Mold          outOfEra TRUE   (our eraTag `Epics`)
//   Scaled Mystic Armor Quests      outOfEra TRUE   (a quest page, start zone East Cabilis)
//   Cultural Tradeskills: Human     outOfEra TRUE   (an armour-SET page, and see the refusal below)
//   Full Breastplate Mold           outOfEra false
//   Silver Full Breastplate         outOfEra false  (the ITEM is in era; its LINK is not)
//
// ---------------------------------------------------------------------------------------------
// THE RULE (owner rulings, 2026-08-13, twice, and the second one widened the first)
// ---------------------------------------------------------------------------------------------
//
// ONE out-of-era edge is enough. The first cut of this ticket asked for the opposite — mark it out
// only when EVERY stated path is out — and the owner overturned it mid-build, verbatim: treat any
// reference to out-of-era as fairly definitive, because *these datasources lean the other way, they
// would carry out-of-era gear by accident, not mark in-era gear out*. The second note widened it to
// any piece: the awarding quest, the tradeskill parts, zone reworks, other classes' versions.
//
// IT SPEAKS ONLY INTO SILENCE — EXCEPT FOR ONE EDGE. A row whose own page states an era, or whose
// drop zones place it, keeps the layer 1-2 verdict it already had, and five of the six edges here
// are consulted only where that answer was `unknown`. The sixth, `drop-mob`, is marked
// `definitive` and outranks a zone, for the reason JOS-298 gave when the page's OWN out-of-era
// banner earned the same right: a revamp replaces a zone's contents without adding a zone, so the
// zone name is not evidence about this drop table and the wiki's per-mob verdict is.
//
// AND IT NO LONGER ONLY HIDES. The `page` edge can say IN as well as OUT, because a set page filed
// under `Classic Era` is a claim rather than an absence. Measured: 40 gear rows are visible today
// BECAUSE a page vouches for them, against 2,474 hidden by an out edge.
//
// THE OTHER HALF OF THE SECOND RULING IS NOT IMPLEMENTED, ON PURPOSE, and this is the record of
// why. The owner also leaned the opposite way: an item eqlwiki carries that does NOT exist in other
// versions of the game is probably definitively IN era, because EQL ships original items. That is a
// claim about CROSS-VERSION EXISTENCE, and this repo holds exactly one wiki. There is no in-corpus
// signal that separates "EQL invented this" from "nobody has written the P99 page yet" — the P99
// date filings JOS-328 refused are the standing proof that absence on one wiki means nothing — so
// implementing it would be guessing in the one direction that SHOWS a player content that is not
// there. Recorded as the owner's lean for a future heuristic with a real second source, not acted
// on now (law 1).
//
// ABSENCE IS STILL NOT EVIDENCE (law 1). An item with no recipe, no quest and no drop list gets no
// derivation — it stays `era?`. An edge whose target is not in the corpus gets no derivation. A
// quest we cannot find in the quest catalog gets none. The rule is "one edge we can READ says out",
// never "we could not find an in-era path".
//
// ---------------------------------------------------------------------------------------------
// THE SIX EDGES, strongest first, and what each one is worth
// ---------------------------------------------------------------------------------------------
//
// Edges 5 (`page`) and 6 (`drop-mob`) are documented at their own functions below, because each
// carries an argument longer than a bullet: the in-era direction's refusal for one, and the right
// to overrule a zone for the other. The four JOS-333 shipped:
//
//  1. `component` — a `|playercrafted` INGREDIENT whose own page the wiki badges out of era. This
//     is the pill itself, on the exact link the owner's Dwarven Breastplate screenshot shows: the
//     recipe needs a Small Breastplate Mold, and that mold's page carries `{{Epics Era}}`, which the
//     register calls out. Bought components count — a mold you cannot buy on this server is a wall
//     whatever else the recipe asks for. 308 pages.
//  2. `yield` — the recipe's `|yieldItem` when it is a DIFFERENT page from this one and that page is
//     badged out. Rare, and kept because a combine whose product is out-of-era content is not a
//     combine this server runs. 0 pages in today's corpus; it costs nothing and it is the shape a
//     rescrape could produce.
//  3. `quest` — a related quest whose START ZONE is an expansion later than `CURRENT_ERA`. This is
//     the Scaled Mystic Breastplate case, and it is the one edge that is NOT the wiki's own pill: we
//     read `startZone` out of the committed quest catalog and put it through the same `zones.ts`
//     table layer 1 uses. It agrees with the wiki where we can check it (Scaled Mystic Armor Quests
//     starts in East Cabilis and `eqlmetadata` calls the page out of era), and the tooltip says
//     "starts in" rather than claiming a badge. 106 pages.
//     EVERY related quest counts, not only the ones that hand the item out. `role` is present only
//     on the quest-catalog uses, so filtering on it would silently drop the whole `|relatedquests`
//     family — which is precisely the family the owner's screenshot shows badged — and the widened
//     ruling makes any out-of-era reference sufficient anyway.
//     WHERE IT IS MORE AGGRESSIVE THAN THE WIKI, measured against `eqlmetadata` on four of the quest
//     pages this edge fires for: Scaled Mystic Armor Quests, Shaman Skull Quests and Warrior Pike
//     Quests all come back `outOfEra: true`, and Necromancer Skullcap Quests comes back FALSE while
//     we call it out (it starts in West Cabilis, a Kunark city). That is the honest cost of a zone
//     inference and it is worth paying in this direction: you cannot walk to West Cabilis on a
//     classic server, and the chip says "starts in West Cabilis" rather than claiming a badge. Six
//     gear rows ride on that one disagreement.
//  4. `component-zone` — an ingredient the wiki does NOT badge, which the recipe says you can ONLY
//     get by killing for it, and which drops in resolvable zones that are every one a later
//     expansion. High Quality Brute Hide (Dreadlands / Frontier Mountains / Warsliks Woods only),
//     Excellent Sabertooth Tiger Hide (Kunark plus Tower of Frozen Shadow). This is our zone table
//     rather than the wiki's badge, so it sorts LAST and its sentence says so. It reads the same
//     three witnesses the app uses for the item itself — the catalog's zones for that ingredient
//     UNION the ones its page names — because reading fewer witnesses could call an ingredient
//     unreachable that the catalog knows drops in Lower Guk. 49 pages, and see `droppedOnly` below
//     for the 27 it stopped claiming once the recipe's own `sources` were consulted.
//
// NOT AN EDGE, deliberately:
//   * `|recipes` (recipes this item is an INGREDIENT of) — that is what the item is FOR, not how you
//     get it. Walking it would mark a classic bone chip out of era for being usable in a Velious
//     combine, which is the opposite of the question.
//   * DROP ZONES. They are layer 1 and they already spoke: a row only reaches this file when NO zone
//     resolved, so there is nothing here for a drop zone to add.
//   * TRANSITIVE CLOSURE. The walk is ONE hop. An ingredient that is itself crafted is resolved by
//     its own page and its own zones, not by re-walking its recipe — the corpus's `Crafted` chains
//     run four deep in places, and a rule whose answer depends on how far you chose to walk is not a
//     rule anyone can check against a screenshot.
//
// ---------------------------------------------------------------------------------------------
// THE OWNER EXAMPLES, all four, and what each one cost to answer
// ---------------------------------------------------------------------------------------------
//
//   Dwarven Breastplate (Enchanted Imbued) — `component`. Its recipe needs a Small Breastplate
//     Mold, whose page carries `{{Epics Era}}`. Answered by JOS-333 off committed bytes.
//   Scaled Mystic Breastplate — `quest`. `|relatedquests` names Scaled Mystic Armor Quests, which
//     the committed quest catalog starts in East Cabilis. Also JOS-333.
//   Silver Full Breastplate — `page`, and the reason JOS-341 exists. Its rendered page carries
//     exactly one pill and the link under it is `[[Cultural Tradeskills: Human]]`, an armour-SET
//     page: not an `{{Itempage}}`, so not in the item corpus, and `|notes` is stored markup-
//     STRIPPED so the row did not even carry the title. All seven of its recipe components are in
//     era and it has no quests, so no walk over items could have reached it. The fetch reached it.
//   Life's Guard — `drop-mob`, and the report needed correcting before it could be answered. It
//     was reported as an era? row whose dropper is badged; the committed record says its page
//     opens `{{Classic Era}}` and its one dropper sits under a `Plane of Hate` heading, so layers
//     1-2 called it IN ERA and the planner offered it as farmable AC 30 loot. The rest of the
//     report is exactly right, and that is the whole argument for `definitive`.
//
// ---------------------------------------------------------------------------------------------
// THE CENSUS, re-measured 2026-08-13 after JOS-341, over the committed corpus (11,213 pages /
// 11,375 keys, the JOS-328 rebuild). A COUNT OF WHAT IS THERE, not a threshold — the sweeps assert
// floors (`tests/plannerEraCorpus.test.mts`, `tests/gearIndexEra.test.mts`).
// ---------------------------------------------------------------------------------------------
//
//   CORPUS PAGES with a derivation: 463 -> 3,221
//                                   drop-mob 2,365 · page 442 · component 308 · quest 102 ·
//                                   component-zone 4 · yield 0
//                                   (out-of-era 3,143 · in-era 78)
//   GEAR ROWS carrying one:         361 -> 2,532 — drop-mob 1,820 · page 378 · component 284 ·
//                                   quest 32; 2,474 out and 40 in.
//   GEAR ROWS, 6,814 both sides:    in-era 2,319 -> 2,343 · out-of-era 3,725 -> 4,034 ·
//                                   era? 770 -> 437.
//   Default era-filtered table:     3,089 -> 2,343 visible of 6,814; 437 rows are still hidden for
//                                   having no verdict at all, down from 770.
//
// TWO NUMBERS IN THAT TABLE NEED THEIR OWN SENTENCE, because they LOOK like regressions:
//   * `component-zone` fell 49 -> 4 and `quest` 106 -> 102. Not one verdict changed. Those pages
//     also satisfy the DEFINITIVE dropper edge, which outranks them in `BASIS_ORDER`, so the row
//     reports a different (stronger) reason for the same answer.
//   * The before column is this repo's own measurement of the JOS-333 tip and is two gear rows off
//     the figures recorded on that ticket (3,727 / 768). The derivation set reproduces exactly
//     (463: component 308 · quest 106 · component-zone 49), so the difference is in how the
//     gear-row verdicts were counted there, not in any rule.
//
// THE SHELF JOS-333 NAMED IS STILL THERE and still recognizable — racial CULTURAL SMITHING armour
// whose recipes call for a hammer, mold or gem the wiki badges out (Elven Smithy Hammer 77 rows,
// Teir`dal Smithy Hammer 44, Imbued Emerald 28, Brute Hide 24). What JOS-341 added on top is a
// second, larger shelf: the 622 rows whose `|notes` name one of the nine `Cultural Tradeskills:
// <Race>` set hubs, eight of which the endpoint badges out. The ninth, ERUDITE, comes back
// `outOfEra: false` with no era token at all, so its 14 rows move in NEITHER direction — pinned as
// a refusal in the sweep rather than smoothed toward the other eight.
//
// PURE and ELECTRON-FREE, the `effectIndex.ts` posture: value imports are RELATIVE, nothing reads a
// file, the ITEM corpus is handed in (main already inlines it once for itemLookup) and the three
// small committed tables this needs are imported here because they have no other caller to pass
// them in. `tests/eraDerive.test.mts` drives the rules on hand-written records,
// `tests/plannerEraCorpus.test.mts` sweeps the real committed bytes, and
// `tests/gearIndexEra.test.mts` asks the four owner examples through the shipped renderer path.

import { itemKey, type ItemDbEntry, type ItemDbFile } from '../itemsDb'
import { pageEraKey, type PageEraFile } from '../pageEraDb'
import { itemBaseName } from '../../shared/itemStats'
import {
  CURRENT_ERA,
  eraBadge,
  eraRank,
  layeredVerdict,
  zoneEra,
  type Era,
  type EraDerivation,
  type EraDerivationBasis
} from '../../shared/planner/era'
import questsJson from '../../renderer/src/data/eqlegends/quests.json'
import mobsJson from '../../renderer/src/data/eqlegends/mobs.json'
import pageEraJson from '../data/pageEra.json'
import type { ItemCraftIngredient, MobData, QuestData, QuestEntry } from '../../shared/types'

/**
 * WHICH EDGE WINS when an item has several. Strongest first, and "strongest" means closest to the
 * wiki's own rendered answer: `drop-mob` is the only DEFINITIVE one (it is the pill on the link
 * that decides whether the drop table is even running), the three badge edges after it are the
 * pill verbatim, the quest edge is our zone table applied to a page the wiki also calls out, and
 * the zone edge is our zone table alone.
 *
 * ONE ORDER FOR BOTH DIRECTIONS. Out-of-era edges are consulted first as a group (the owner's
 * any-edge ruling makes one of them sufficient), and only when there are none does an in-era edge
 * get to speak — so this list decides which edge is REPORTED, never which way the verdict goes.
 */
const BASIS_ORDER: readonly EraDerivationBasis[] = [
  'drop-mob',
  'component',
  'yield',
  'page',
  'quest',
  'component-zone'
]

/** What one derivation pass needs beside the corpus. Injectable so a test can drive small ones. */
export interface EraDeriveCatalogs {
  /** quest name AND page title → the catalog row (the item states either spelling) */
  questByName: ReadonlyMap<string, QuestEntry>
  /** itemKey → every zone the mob catalog places a dropper of it in */
  catalogZones: ReadonlyMap<string, readonly string[]>
  /** itemKey → every mob the catalog says drops it, by name (JOS-341's dropper edge) */
  catalogDroppers: ReadonlyMap<string, readonly string[]>
  /** the committed verdicts for the pages and mobs the item corpus cannot hold (`pageEraDb.ts`) */
  pageEra: PageEraFile
}

// ---- the two committed catalogs ---------------------------------------------------------------

/**
 * The quest catalog keyed by BOTH spellings an `ItemQuestUse` can carry. `quest` is the display
 * name and `page` the wiki title; they are usually equal and sometimes are not (Scaled Mystic
 * Breastplate's use names the ITEM as the quest and `Scaled Mystic Armor Quests` as the page), so
 * a lookup that knew only one of them would miss exactly the family this ticket is about.
 *
 * FIRST WRITER WINS, matching every other index in the repo. The catalog is keyed by page title
 * upstream, so a collision here would mean two quests share a display name; the corpus sweep would
 * see it as an unresolved edge rather than a wrong one.
 */
export function buildQuestIndex(catalog: QuestData): Map<string, QuestEntry> {
  const m = new Map<string, QuestEntry>()
  for (const quest of catalog.quests) {
    for (const spelling of [quest.name, quest.page]) {
      const key = spelling.trim().toLowerCase()
      if (key !== '' && !m.has(key)) m.set(key, quest)
    }
  }
  return m
}

/**
 * itemKey → the zones the mob catalog places its droppers in. The renderer builds this same
 * inversion for its own era join (`lib/itemSources.ts`); this is the main-side copy, and it exists
 * because edge 4 has to judge an INGREDIENT the way the app would judge the item — an ingredient
 * whose page names no zone is routinely placed by the catalog, and reading only the page would
 * call it unreachable on no evidence.
 */
function addDropZones(m: Map<string, string[]>, drop: string, zones: readonly string[]): void {
  const key = itemBaseName(drop).toLowerCase()
  if (key === '') return
  let seen = m.get(key)
  if (seen === undefined) m.set(key, (seen = []))
  for (const zone of zones) if (!seen.includes(zone)) seen.push(zone)
}

export function buildCatalogZones(catalog: MobData): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const mob of catalog.mobs) {
    const zones = mob.zones ?? []
    if (zones.length === 0) continue
    for (const drop of mob.drops ?? []) addDropZones(m, drop, zones)
  }
  return m
}

/**
 * itemKey → the mob catalog's droppers of it, BY NAME. The dropper edge's other half.
 *
 * It is a separate inversion from `buildCatalogZones` and not a widening of it, because the two
 * ask different questions of the same rows: that one wants where a dropper stands (and skips a mob
 * with no zones, which is exactly the mob this one most wants to hear about — a zoneless mob is a
 * mob the zone table cannot judge, and the wiki's per-mob badge is then the only witness there is).
 */
export function buildCatalogDroppers(catalog: MobData): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const mob of catalog.mobs) {
    for (const drop of mob.drops ?? []) {
      const key = itemBaseName(drop).toLowerCase()
      if (key === '') continue
      let names = m.get(key)
      if (names === undefined) m.set(key, (names = []))
      if (!names.includes(mob.name)) names.push(mob.name)
    }
  }
  return m
}

/** The catalogs as they SHIP. Built once per process, lazily — a session that never opens the Gear
 *  tab pays for neither (the `zones.ts` / mobSearch posture). */
let COMMITTED: EraDeriveCatalogs | null = null

export function committedCatalogs(): EraDeriveCatalogs {
  COMMITTED ??= {
    questByName: buildQuestIndex(questsJson),
    catalogZones: buildCatalogZones(mobsJson),
    catalogDroppers: buildCatalogDroppers(mobsJson),
    pageEra: pageEraJson as PageEraFile
  }
  return COMMITTED
}

// ---- resolving ONE edge target ----------------------------------------------------------------

/** The zones an item states on its OWN page (`|dropsfrom`), zone headings only. */
function pageZones(entry: ItemDbEntry): string[] {
  return (entry.dropsFrom ?? []).flatMap((s) => (s.zone === undefined ? [] : [s.zone]))
}

/** Would the wiki draw the pill on a link to this page? The register, and nothing else. */
function badgedOut(entry: ItemDbEntry | undefined): entry is ItemDbEntry & { eraTag: string } {
  return entry?.eraTag !== undefined && entry.eraTag !== '' && eraBadge(entry.eraTag) === 'out'
}

/** Is this expansion one the server has not opened? `null` (nothing resolved) is never a yes. */
function unopened(era: Era | null): boolean {
  return era !== null && eraRank(era) > eraRank(CURRENT_ERA)
}

/**
 * MAY THIS COMPONENT BE JUDGED BY WHERE IT DROPS? — only when the recipe says a drop is the ONLY
 * way to get it.
 *
 * This guard is the difference between a rule and a bug, and the bug was measured before the guard
 * existed. Gold Bar's catalog droppers all live in Plane of Mischief, so the zone read called it
 * unreachable and hid the whole Gold cultural plate family; the recipe states the ingredient's
 * source as **Bought**, its own page opens `{{Classic Era}}`, and the wiki's `eqlmetadata` says it
 * is in era. A vendor bar is not gated by where a mob happens to also drop one. Twelve Platinum
 * rows had the same shape.
 *
 * SO: every source the line states must be `Dropped`. An UNSTATED source list says nothing and is
 * refused too (law 1) — "the page did not say how you get this" is not "you can only kill for it".
 * The BADGE edges take no such guard on purpose: a badge is a claim about the CONTENT, and the
 * owner's own example is a bought mold that the wiki nevertheless pills as out of era.
 */
function droppedOnly(sources: readonly string[] | undefined): boolean {
  return sources !== undefined && sources.length > 0 && sources.every((s) => s.trim().toLowerCase() === 'dropped')
}

// ---- the walk ---------------------------------------------------------------------------------

/** ONE ingredient line → its edge, or null. Edges 1 and 4, which share a target lookup. */
function componentEdge(
  ingredient: ItemCraftIngredient,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs
): EraDerivation | null {
  const target = corpus.get(itemKey(ingredient.name))
  if (badgedOut(target)) {
    return { basis: 'component', verdict: 'out-of-era', target: ingredient.name, detail: target.eraTag }
  }
  if (target === undefined || !droppedOnly(ingredient.sources)) return null
  // The same three witnesses the app uses for the item itself: the catalog's zones for this
  // ingredient UNION the ones its own page names.
  const zones = [...new Set([...pageZones(target), ...(catalogs.catalogZones.get(itemKey(target.page)) ?? [])])]
  if (layeredVerdict(zones, target.eraTag) !== 'out-of-era') return null
  return { basis: 'component-zone', verdict: 'out-of-era', target: ingredient.name, detail: zones.join(', ') }
}

/** Every edge the `|playercrafted` block states — its ingredients, and a yield that is elsewhere. */
function recipeEdges(
  entry: ItemDbEntry,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs
): EraDerivation[] {
  const edges: EraDerivation[] = []
  const selfKey = itemKey(entry.page)
  for (const recipe of entry.craftedBy ?? []) {
    for (const ingredient of recipe.ingredients) {
      const edge = componentEdge(ingredient, corpus, catalogs)
      if (edge !== null) edges.push(edge)
    }
    if (recipe.yieldItem === undefined || itemKey(recipe.yieldItem) === selfKey) continue
    const yielded = corpus.get(itemKey(recipe.yieldItem))
    if (badgedOut(yielded)) {
      edges.push({ basis: 'yield', verdict: 'out-of-era', target: recipe.yieldItem, detail: yielded.eraTag })
    }
  }
  return edges
}

/** Every edge `|relatedquests` and the quest catalog state between them. */
function questEdges(entry: ItemDbEntry, catalogs: EraDeriveCatalogs): EraDerivation[] {
  const edges: EraDerivation[] = []
  for (const use of entry.questUses ?? []) {
    const quest = catalogs.questByName.get((use.page ?? use.quest).trim().toLowerCase())
    if (quest?.startZone === undefined) continue
    if (unopened(zoneEra(quest.startZone))) {
      edges.push({ basis: 'quest', verdict: 'out-of-era', target: quest.name, detail: quest.startZone })
    }
  }
  return edges
}

/**
 * EDGE 5 — `page`: the era of a link target the item corpus does not hold, BOTH WAYS (JOS-341).
 *
 * This is the edge JOS-333 measured and refused to build without the fetch. `|notes` prose links
 * armour-SET hubs and quest indexes — `[[Cultural Tradeskills: Human]]` is the whole of Silver Full
 * Breastplate's evidence — and those are not `{{Itempage}}` pages, so no amount of walking the item
 * corpus reaches them. `scripts/scrape-page-era.ts` asks the wiki's own `action=eqlmetadata` about
 * each one and commits the answer; this reads it.
 *
 * IT POINTS BOTH WAYS, and the asymmetry between the two directions is the whole care here:
 *   OUT needs only the endpoint's boolean. `outOfEra: true` is a positive claim — it is the pill,
 *   drawn on the exact link the owner photographed — and the owner's any-edge ruling makes one
 *   sufficient.
 *   IN needs the page's OWN era token as well, because `outOfEra: false` is returned both for a
 *   page the wiki files under `Classic Era` and for a page nobody has ever classified. Reading the
 *   second as evidence would let a link to `[[Blacksmithing]]` argue a breastplate into the
 *   current-era view, which is guessing in the direction that shows a player content that is not
 *   there. So an in-era edge requires `eraBadge(token) === 'in'`: a page that made the claim.
 */
function pageEdges(entry: ItemDbEntry, catalogs: EraDeriveCatalogs): EraDerivation[] {
  const edges: EraDerivation[] = []
  for (const title of catalogs.pageEra.refs[itemKey(entry.page)] ?? []) {
    const target = catalogs.pageEra.pages[pageEraKey(title)]
    if (target === undefined) continue
    if (target.outOfEra) {
      edges.push({ basis: 'page', verdict: 'out-of-era', target: title, detail: target.eraTag ?? 'out of era' })
    } else if (target.eraTag !== undefined && eraBadge(target.eraTag) === 'in') {
      edges.push({ basis: 'page', verdict: 'in-era', target: title, detail: target.eraTag })
    }
  }
  return edges
}

/** At most three names and then a count — a tooltip sentence, not a manifest. */
function nameList(names: readonly string[]): string {
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${String(names.length - 3)} more`
}

/**
 * EDGE 6 — `drop-mob`: EVERY mob that drops this is one the wiki badges out of era. The owner's
 * Life's Guard addition, and the only DEFINITIVE edge (see `EraDerivation.definitive`).
 *
 * THE EXAMPLE, corrected by measuring it. Life's Guard was reported as an era? row whose dropper is
 * badged; its committed record says the page opens `{{Classic Era}}` and its one dropper sits under
 * a `Plane of Hate` heading, so layers 1-2 call it IN ERA and the planner offers it as farmable
 * AC 30 loot. The rest of the report is exactly right, and is the reason this edge outranks a zone:
 * the pill on that page sits on `[[Agent of Innoruuk]]`, a Plane of Hate REVAMP mob the wiki badges
 * out of era. A revamp replaces a zone's CONTENTS without adding a zone, so the zone heading says
 * nothing about whether this drop table runs on this server — which is JOS-298's argument, applied
 * one link further out than JOS-298 could reach.
 *
 * EVERY DROPPER, NOT ANY. This repo's doctrine for this exact evidence class is already written
 * down in `eraVerdictAt`: any reachable source keeps an item farmable, because a mob that spawns in
 * both Lower Guk and Kael Drakkel is still a Lower Guk camp. An any-dropper rule would flip 518
 * currently in-era rows; every-dropper flips 33, and those 33 are named uniques in revamped
 * content. The owner's any-edge ruling governs which KINDS of reference count, not whether one
 * reachable dropper stops being reachable.
 *
 * BOTH WITNESSES, page and catalog, for the same reason `component-zone` reads both: the renderer
 * folds the mob catalog in beside the page's own `|dropsfrom`, so an edge that read only one of
 * them could call an item unreachable that the catalog knows a Lower Guk froglok drops.
 *
 * ABSENCE BLOCKS IT (law 1). A dropper missing from the committed table was never asked about —
 * the fetch enumerates today's corpus, so a rescrape can add a mob before the next fetch runs —
 * and silence is not `false`. A page whose `|dropsfrom` names nobody has no edge at all.
 */
function dropMobEdge(entry: ItemDbEntry, catalogs: EraDeriveCatalogs): EraDerivation | null {
  const names = [
    ...new Set([
      ...(entry.dropsFrom ?? []).map((s) => s.mob),
      ...(catalogs.catalogDroppers.get(itemKey(entry.page)) ?? [])
    ])
  ]
  if (names.length === 0) return null
  // `?? false` and not `=== true`: a mob ABSENT from the table was never asked about, and law 1
  // makes that silence rather than a `false` the edge could read past.
  if (!names.every((n) => catalogs.pageEra.mobs[pageEraKey(n)] ?? false)) return null
  return { basis: 'drop-mob', verdict: 'out-of-era', definitive: true, target: names[0], detail: nameList(names) }
}

/**
 * One item's era edges, in no particular order and in both directions. Exported for the corpus
 * sweep, which reports the census by basis and needs to see all of them rather than just the winner.
 */
export function eraEdges(
  entry: ItemDbEntry,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs
): EraDerivation[] {
  const dropper = dropMobEdge(entry, catalogs)
  return [
    ...(dropper === null ? [] : [dropper]),
    ...recipeEdges(entry, corpus, catalogs),
    ...questEdges(entry, catalogs),
    ...pageEdges(entry, catalogs)
  ]
}

/** The strongest edge of one direction, or null when that direction has none. */
function strongest(edges: readonly EraDerivation[], verdict: EraDerivation['verdict']): EraDerivation | null {
  const of = edges.filter((e) => e.verdict === verdict)
  if (of.length === 0) return null
  for (const basis of BASIS_ORDER) {
    const hit = of.find((e) => e.basis === basis)
    if (hit !== undefined) return hit
  }
  // Unreachable while `BASIS_ORDER` covers the union — kept so a basis added without a row in the
  // order degrades to "report something" rather than to "report nothing".
  return of[0]
}

/**
 * The one edge a row reports, or null when nothing stated points anywhere the wiki has classified.
 *
 * OUT BEFORE IN, always: the owner's ruling is that any out-of-era reference is definitive, so an
 * item whose set page is in era and whose mold is not is out of era, and the in-era edge never gets
 * to speak. That ordering is the rule; `BASIS_ORDER` only picks the spokesman within a direction.
 */
export function deriveEra(
  entry: ItemDbEntry,
  corpus: ReadonlyMap<string, ItemDbEntry>,
  catalogs: EraDeriveCatalogs = committedCatalogs()
): EraDerivation | null {
  const edges = eraEdges(entry, corpus, catalogs)
  return strongest(edges, 'out-of-era') ?? strongest(edges, 'in-era')
}

/**
 * THE WHOLE CORPUS → the derivation for every page that has one. Built once beside the gear index
 * (`gearIndex.ts` hands it the same file it is already walking), so the renderer reads a field.
 *
 * KEYED BY PAGE-CANONICAL ITEM KEY, and every entry is walked including the `|itemname` alias keys:
 * an alias key and its page resolve to the same `itemKey(page)`, so the map holds one answer per
 * page and a second pass over the alias is a no-op rather than a duplicate.
 */
export function buildEraDerivations(
  file: ItemDbFile,
  catalogs: EraDeriveCatalogs = committedCatalogs()
): Map<string, EraDerivation> {
  const corpus = new Map(Object.entries(file.items ?? {}))
  const out = new Map<string, EraDerivation>()
  const seen = new Set<string>()
  for (const entry of corpus.values()) {
    if (seen.has(entry.page)) continue
    seen.add(entry.page)
    // A page that already states an era, or that any zone places, is not layer 3's business —
    // EXCEPT for the one definitive edge, which is the only thing here entitled to overrule a
    // witness. Asked with the page's OWN zones only: the renderer folds the catalog in as well and
    // can therefore only be MORE decided than this, so a non-definitive edge computed here can
    // never overrule a witness it did not see.
    const decided = layeredVerdict(pageZones(entry), entry.eraTag) !== 'unknown'
    const derived = decided ? dropMobEdge(entry, catalogs) : deriveEra(entry, corpus, catalogs)
    if (derived !== null) out.set(itemKey(entry.page), derived)
  }
  return out
}
