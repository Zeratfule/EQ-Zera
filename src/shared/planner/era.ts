// planner/era.ts — "is this loot even in the game yet?", answered from ZONE PROVENANCE.
//
// THE BUG THIS EXISTS FOR: the first cut of the exaltation planner offered ten Primal Velium
// weapons for the Avatar proc. Every one of them drops off a warder in Sleeper's Tomb — Velious
// content EQ Legends has not opened. The item corpus cannot catch that: it is scraped from a wiki
// that documents Kunark and Velious wholesale (Kael Drakkel alone is 343 catalog mobs), and NO
// FIELD ON AN ITEM CARRIES AN ERA. The only evidence in the data is where the thing drops, so the
// era question is really a zone question, and the zone answers live in the one hand-authored
// zone-knowledge table (`src/shared/zones.ts`, world-model law 12).
//
// This module is the thin, pure layer over that table:
//   * `zoneEra` resolves a DIRTY catalog zone string to an expansion, or to `null`.
//   * `eraVerdict` folds a donor's whole zone list into one of three answers a UI can render.
//
// SINCE 2026-08-04 THERE IS A SECOND WITNESS, and the model is LAYERED EVIDENCE. It turns out the
// wiki does state an era after all — not on the item, but as a coloured banner template at the top
// of 7,315 of the 11,247 item pages (`{{Velious Era}}`, read by `main/itemLookupParse.ts`). It is
// weaker evidence than a zone (it is a section heading, and its tokens name places as often as
// expansions), so for a year it never overruled one: `layeredVerdict` asked the zones first and
// consulted `eraFromTag` ONLY when they came back `unknown`. That is what answers for the quest
// rewards, the crafted goods and the 126 catalog-orphan donors no zone ever placed.
//
// LAYER 2b, ADDED 2026-08-13 (JOS-328): 52 pages state an era through their `[[Category:X Era]]`
// while carrying no banner at all, and `main/itemLookupParse.ts parseEraCategory` now folds those
// into the same `eraTag`. Nothing in THIS file changes for them — a token is a token — except the
// `namesEra` guard below, which exists so a category the register has never heard of stays silent
// instead of reaching `#default`. The census, and the owner report that produced it, are recorded
// in the parser beside the reader.
//
// AND SINCE 2026-08-13 (JOS-298) THAT BANNER OVERRULES THE ZONES IN ONE DIRECTION. The banner is
// not only a section heading: `Template:PageEra` carries a machine-readable IN/OUT register, and
// when it answers `out` the wiki draws a red `Out of Era` box on the page. A zone cannot refute
// that — a revamp replaces a classic zone's contents without adding a zone — so a positive OUT
// badge now wins outright, while an IN badge still never overrules a zone. Measured over the
// committed corpus the day it landed: 151 item keys claimed to be farmable while their own page
// said otherwise, 113 of them slotted, 80 AC-bearing armour, and the top of the Gear tab's
// CHEST-by-AC list. The register is mirrored below `eraFromTag`, cited to the template it copies.
//
// LAYER 3, ADDED 2026-08-13 (JOS-333): AN ERA READ OFF THE ACQUISITION PATH. Everything above asks
// what THIS page says. The wiki also says something none of it can see — it renders an `OUT OF ERA`
// pill on every LINK whose TARGET page is out of era — so a page that states no era of its own can
// still be covered in out-of-era markers, which is exactly what the owner photographed. The rules,
// the census and the measured refusals are in `src/main/planner/eraDerive.ts` (that is where the
// corpus is); this file owns only the `EraDerivation` type below and the register the derivation
// asks. Nothing in the strength order changed: layer 3 speaks ONLY into `unknown`.
//
// AND SINCE JOS-341 THAT LAST SENTENCE HAS TWO EXCEPTIONS, both of them the same wiki predicate
// reaching a page our item corpus does not hold (`src/main/data/pageEra.json`, fetched at data-build
// time and committed — no runtime wiki calls):
//   * The `page` edge reads the era of a link target that is not an item at all — an armour-SET
//     hub, a quest index — and it points BOTH ways. Out is the pill verbatim; IN is a positive
//     classification (`Category:Classic Era` on the set page), and under the era?-hides rule of
//     73ad7ec9 declining to read it would hide gear the wiki says is here.
//   * The `drop-mob` edge is DEFINITIVE and can overrule a drop zone. See `EraDerivation.definitive`
//     below; the short version is that a revamped zone keeps its name while its contents change,
//     so the mob is the witness and the zone is not.
//
// WHAT MAKES THAT MIRRORING RATHER THAN GUESSING, measured live 2026-08-13: the pill is drawn by
// eqlwiki's own skin module `skins.EQLImmersive.eraFilter`, which asks a custom `action=eqlmetadata`
// for each link target's `outOfEra`, and whose documented fallback computes it from the target's
// CATEGORIES against `mw.config.wgEQLEraOutKeys`. That config, read off a live page the same day,
// is `[kunark, velious, luclin, chardok, chardokrevamp, holevp, warrensfearhaterevamp,
// fearhaterevamp, epics, epicquests, unknown]` at `wgEQLEraConfigRevision` 156232 — the SAME eleven
// keys, the same fold and the same revid as `PAGE_ERA`'s `out` rows below. So `eraBadge(tag) ==
// 'out'` is not our opinion about a page; it is the wiki's own predicate, and the pill on a link is
// that predicate applied to the link's target.
//
// WHAT IT REFUSES TO DO. The catalog's zone strings include real dirt: initialisms (`BBM`, `WFP`),
// prose (`Most starting zones`, `Various`), concatenations where a wiki table cell ran two links
// together (`Everfrost PeaksLake Rathetear`, `DreadlandsEmerald JungleCity of Mist`), hedges
// (`West Cabilis?`, `also in Chardok?`) and genuinely ambiguous city names (`Freeport` is three
// map files). Every one of those resolves to `null`. Splitting a concatenation on capital letters
// or fuzzy-matching a hedge would manufacture knowledge the source never stated — law 12 again —
// and the cost of being wrong here is telling the owner a farmable item is unreachable (or the
// reverse). A name that isn't knowledge stays unknown, and `unknown` is a first-class verdict.
//
// MEASURED over the committed catalog (2026-08-04, `src/renderer/src/data/eqlegends/mobs.json`):
// 192 distinct zone strings across 8,214 (mob, zone) links. 159 of the 192 resolve to an era —
// 109 classic (4,985 links), 29 kunark (1,464), 21 velious (1,679) — and because what is left is
// overwhelmingly one-mob junk, that is 8,128 of the 8,214 links, 99.0% BY WEIGHT. The 33
// unresolved names carry 86 links between them, and 54 of those 86 are two honest non-zones:
// `Various` (22) and the EQL-new `New Sebilis Expedition` (32, a real place with no historic
// expansion to name). `tests/plannerEra.test.mts` pins floors under all of it.
//
// PURE: no Node, no Electron, no renderer. Relative imports so the node test runner loads it
// directly (the shared/planner house style).

import { ZONES, zoneKey, type ZoneEntry, type ZoneEra } from '../zones'

/**
 * An EverQuest expansion the planner can rank.
 *
 * A SUPERSET of `ZoneEra` by exactly one member. `ZoneEra` is what the zone table may claim, and
 * it stops at Velious on purpose: the Luclin-and-later zones in `zones.ts` (Bazaar, Nexus, Plane
 * of Knowledge) are deliberately unannotated, because EQ Legends' versions of them are hubs the
 * player can walk into and calling them out-of-era would be a lie. But 25 item PAGES open with
 * `{{Luclin Era}}`, and `eraFromTag` has to be able to say what that means — so 'luclin' is an era
 * the planner names without being an era a zone claims. The union direction (`ZoneEra | 'luclin'`)
 * is the compile-time proof that every zone era is rankable here; `zones.ts` is untouched.
 */
export type Era = ZoneEra | 'luclin'

/**
 * The eras in RELEASE ORDER. This ordering is the whole semantic of "in era": classic (1999) ⊂
 * Kunark (April 2000) ⊂ Velious (December 2000) ⊂ Luclin (December 2001), because an expansion
 * never retires the content before it. Index = rank.
 */
export const ERA_ORDER: readonly Era[] = ['classic', 'kunark', 'velious', 'luclin']

/**
 * What EQ Legends currently ships. TODAY IT IS CLASSIC — level 50, Fear/Hate/Sky, no Kunark
 * landmass (docs/plans/exaltation-planner.md R6).
 *
 * WHEN KUNARK LAUNCHES, FLIP THIS ONE LINE. Everything downstream — the out-of-era chips, the
 * farm rollup's filtering, the browser's default hide — is derived from the comparison against
 * this constant, so there is exactly one edit and no second opinion to forget. The tests pin the
 * ordering semantics against `eraVerdictAt` rather than against today's value, so flipping it
 * does not require rewriting them.
 */
export const CURRENT_ERA: Era = 'classic'

/**
 * The ONE display spelling of each era. Lives beside the ordering rather than in whichever UI file
 * needed it first: the era chip, the era filter's tooltip and the browser's era grouping all say
 * "Velious" the same way, and none of them owns the word.
 */
export const ERA_LABEL: Record<Era, string> = {
  classic: 'Classic',
  kunark: 'Kunark',
  velious: 'Velious',
  luclin: 'Luclin'
}

/** Release rank of an era; lower ships earlier. `ERA_ORDER.indexOf` with a name. */
export function eraRank(era: Era): number {
  return ERA_ORDER.indexOf(era)
}

// ---- the reverse index --------------------------------------------------------------------
//
// `zones.ts` indexes FORWARD (a log's long name -> its row) and exposes the catalog's spellings
// per row via `catalogZonesFor`. The planner needs the other direction: it holds a catalog string
// and wants the row. So this builds one map over all three of a row's naming surfaces — its own
// name, its aliases, and the `mobCatalogNames` the fold cannot reach — keyed by the SAME
// `zoneKey` fold, which is what makes `Chardok (Pre-Revamp)`, `Northern Karana (35)` and
// `THE PLANE OF SKY` land on their rows for free.
//
// LAZY, never at module load (the zones.ts / mobSearch posture): a session that never opens the
// Planner pays nothing, and the table is immutable so one build lasts the process.

let INDEX: Map<string, ZoneEntry> | null = null

function index(): Map<string, ZoneEntry> {
  if (INDEX) return INDEX
  const m = new Map<string, ZoneEntry>()
  for (const entry of ZONES) {
    for (const spelling of [entry.name, ...(entry.aliases ?? []), ...(entry.mobCatalogNames ?? [])]) {
      const key = zoneKey(spelling)
      // First writer wins, matching zones.ts's own index. `tests/plannerEra.test.mts` proves the
      // three surfaces never collide across rows, so this guard never actually fires.
      if (key !== '' && !m.has(key)) m.set(key, entry)
    }
  }
  INDEX = m
  return m
}

/**
 * The expansion a CATALOG zone string belongs to, or `null`.
 *
 * `null` means one of two honest things and the caller cannot tell them apart (nor should it):
 * the string is not a zone this app knows (junk, prose, a concatenation, an ambiguous city), or
 * it is a known zone that deliberately carries no era claim (the Luclin/PoP hub zones in the map
 * table, EQL-new content like New Sebilis Expedition). Either way the answer is "we don't know",
 * never a guess.
 */
export function zoneEra(zoneName: string): Era | null {
  const key = zoneKey(zoneName)
  if (key === '') return null
  return index().get(key)?.era ?? null
}

/** How a donor's drop zones read against the era the server is on. */
export type EraVerdict = 'in-era' | 'out-of-era' | 'unknown'

// ---- layer 3's vocabulary: an era read off the ACQUISITION PATH ------------------------------
//
// The rules and the census live in `src/main/planner/eraDerive.ts`, which is where the corpus is.
// Only the TYPE is here, because three files have to name it — the corpus row that carries it
// (`shared/planner/gear.ts`), the verdict that reads it (`features/planner/plannerData.ts`) and
// the builder that writes it — and `era.ts` is already the file all three import for era words.

/** Which stated edge decided an item's era. See the module header in `main/planner/eraDerive.ts`. */
export type EraDerivationBasis = 'drop-mob' | 'component' | 'yield' | 'page' | 'quest' | 'component-zone'

/**
 * ONE named reason an item with no era claim of its own nevertheless has one: the stated way you
 * would GET it points at something the wiki HAS classified.
 *
 * It is deliberately a single edge rather than a list. The chip has one sentence to spend, the
 * owner's ruling makes ONE out-of-era reference sufficient, and a row that lists four of them is
 * telling the player about our data rather than about the item. The strongest edge is the one kept
 * (`BASIS_ORDER` in the builder), so which one is reported is deterministic and not a coin toss.
 */
export interface EraDerivation {
  basis: EraDerivationBasis
  /**
   * WHICH WAY THE EDGE POINTS (JOS-341). Layer 3 shipped as an out-of-era-only rule, and the
   * `page` edge is what made that untenable: an armour-set page the wiki files under `Classic Era`
   * is a POSITIVE claim about its members, not an absence, and under the era?-hides rule of
   * 73ad7ec9 a row with no verdict is hidden — so refusing to read an in-era classification is not
   * neutrality, it is a decision to hide gear the wiki says you can go and get.
   *
   * `unknown` is not a member on purpose: a derivation that resolved nothing is `null`, not a
   * third verdict, so a caller cannot accidentally overwrite a real answer with a shrug.
   */
  verdict: Exclude<EraVerdict, 'unknown'>
  /** the item, quest, page or mob the edge points at, spelled the way the corpus spells it */
  target: string
  /** WHY that target decides: its banner token, the zone that placed it, or the droppers named */
  detail: string
  /**
   * TRUE when this edge OUTRANKS layers 1-2 instead of speaking only into their silence.
   *
   * Exactly one basis sets it — `drop-mob` — and the argument is JOS-298's, one link further out:
   * a revamp replaces a classic zone's CONTENTS without adding a zone, so `Plane of Hate` says
   * nothing about whether this drop table is the one running on this server, while the wiki's
   * per-MOB verdict is a positive claim about exactly that. Every other edge stays weaker than a
   * drop zone, which is what keeps the rest of layer 3 unable to hide a row somebody can walk to.
   */
  definitive?: boolean
}

/**
 * Fold a donor's whole zone list into one verdict, against an ARBITRARY era — the testable core,
 * and the function to call when showing "what this would look like after Kunark".
 *
 * - `in-era`     — at least one zone resolved to an era at or before `era`. ANY reachable source
 *                  makes the item farmable, so this wins over an out-of-era sibling zone: a mob
 *                  that spawns in both Lower Guk and Kael Drakkel is still a Lower Guk camp.
 * - `out-of-era` — zones resolved, and every one of them is a later expansion. This is the
 *                  Sleeper's Tomb case the module exists for.
 * - `unknown`    — NOTHING resolved. An empty list lands here too, which is the honest reading:
 *                  a quest reward or a crafted item drops from nobody, and "no drop zones" is not
 *                  evidence of anything (law 1). Callers render it as silence, not as a warning.
 */
export function eraVerdictAt(zoneNames: readonly string[], era: Era): EraVerdict {
  const ceiling = eraRank(era)
  let resolvedAny = false
  for (const name of zoneNames) {
    const found = zoneEra(name)
    if (found === null) continue
    resolvedAny = true
    if (eraRank(found) <= ceiling) return 'in-era'
  }
  return resolvedAny ? 'out-of-era' : 'unknown'
}

/** `eraVerdictAt` against what the server actually ships today. The call sites use this one. */
export function eraVerdict(zoneNames: readonly string[]): EraVerdict {
  return eraVerdictAt(zoneNames, CURRENT_ERA)
}

// ---- layer 2: the page's own era banner -------------------------------------------------------
//
// Zones answer "where do I go", which is why they win. But 3,932 item pages state no zone anyone
// can resolve — quest rewards, crafted goods, and the 126 effect donors the mob catalog simply
// never links — and for most of those the wiki DOES make an era claim, in a place that is not an
// item field at all: the coloured banner template at the top of the page (`{{Velious Era}}`).
// `main/itemLookupParse.ts parseEraTag` reads the token; this table is the ONLY place a token
// becomes an expansion, and it is hand-authored (law 12) because the tokens are not expansion
// names — they are the wiki's own section headings, and half of them name a PLACE.
//
// THE MAPPING, token by token, with the reasoning that is not obvious:
//   Sky / Fear / Hate / Temple / Paineel → CLASSIC. These are 1999-2000 classic zones the EQL
//     server ships today; the wiki banners them separately because they are raid/patch content,
//     not because they are a later expansion. `zones.ts` already calls all five classic.
//   Epics / EpicQuests → KUNARK. The epic 1.0 chain is a KUNARK system: it shipped with Kunark
//     (April 2000) and every chain ends at a Kunark turn-in, so a classic-era server has no epic
//     in it whatever zones the intermediate pieces come from. This row READ `classic` until
//     2026-08-05 and the justification for it — "any piece a Kunark zone gates is caught by
//     layer 1" — is FALSE for the thing that matters: the epic WEAPON is a quest reward, it drops
//     off nobody, so layer 1 resolves nothing and layer 2 is the only witness there is.
//     Ragebringer and Spear of Fate rendered as farmable classic loot for exactly that reason
//     (owner, 2026-08-05). 188 pages carry the two tags.
//   Chardok Revamp / Chardok → KUNARK. Chardok is a Kunark zone whatever the revamp did to it.
//   FearHateRevamp → NOTHING (removed 2026-08-13, JOS-298). It read `classic`, and the
//     justification was measured but the measurement answered the wrong question: 26 of the 53
//     tagged pages appear in the EQL mob catalog's loot lists and all 26 drop off a Plane of Fear
//     or Plane of Hate mob, which was read as "the revamp loot is live here". CATALOG PRESENCE IS
//     NOT LIVENESS — `mobs.json` is a scrape of the same wiki, documenting the same revamp, and
//     the droppers are themselves banner-tagged (a hatebone drake carries `{{FearHateRevamp Era}}`
//     on its own page). The revamp REPLACED a classic zone's contents rather than adding a zone,
//     so the zone carries no era information at all here. The token names a PATCH, not an
//     expansion, so it names no era; what it does claim is in/out, and that is the register below.
//   Unknown → null, stated in the table rather than left to fall through: "Unknown" is a claim
//     that the wiki does not know, and it must not become a guess about WHICH EXPANSION.
//     (The register below is a different question, and there the wiki does answer — see it.)
//
// A token missing from this table is `null` — undefined, never approximate. That is the whole
// reason it is a table and not a regex over the token text. `Hole`, `Stonebrunt`, `Warrens`,
// `HoleVP` and `WarrensFearHateRevamp` are deliberately ABSENT: they are register keys (below)
// that no item page in the corpus carries, they name places and patches rather than expansions,
// and for two of them the register and `zones.ts` openly disagree (the wiki calls Stonebrunt and
// The Warrens in-era; the owner watched Stonebrunt loot surface in the planner and reported it as
// unreachable, so the zone table calls both Velious). A row here would have to pick a side of a
// disagreement neither the wiki nor the owner asked us to settle.
const TAG_ERA: Readonly<Record<string, Era | null>> = {
  classic: 'classic',
  sky: 'classic',
  fear: 'classic',
  hate: 'classic',
  temple: 'classic',
  paineel: 'classic',
  epics: 'kunark',
  epicquests: 'kunark',
  kunark: 'kunark',
  chardok: 'kunark',
  'chardok revamp': 'kunark',
  velious: 'velious',
  luclin: 'luclin',
  unknown: null
}

/**
 * The expansion an ITEM PAGE's era banner claims, or `null` when the token names none.
 *
 * Case-folded on lookup, which is what absorbs the corpus's one `{{kunark Era}}` typo without a
 * second table row. Whitespace is already normalized by `parseEraTag`, so "Chardok  Revamp" and
 * "Chardok_Revamp" arrive here spelled one way.
 */
export function eraFromTag(tag: string): Era | null {
  return TAG_ERA[tag.trim().toLowerCase()] ?? null
}

// ---- the wiki's OWN in/out register (`Template:PageEra`) ---------------------------------------
//
// SOURCE, cited because this table is a MIRROR and not a judgement (law 1):
//   https://eqlwiki.com/Template:PageEra — the `{{#switch:{{{1}}}}}` inside its `<includeonly>`,
//   read at revid 156232 (2026-07-12T16:02:29Z). Every `{{X Era}}` banner is a two-line wrapper
//   that calls `{{PageEra|<key>|<Category>|<dates>}}`; PageEra compares the switch's answer to
//   `in` and, when it is anything else, renders the red `Out of Era` badge the owner was looking
//   at when JOS-298 was filed. The keys and values below are that switch, verbatim.
//
// THIS ANSWERS A DIFFERENT QUESTION FROM `TAG_ERA`. The table above asks "which expansion does
// this token name", which most of these tokens cannot answer (`fearhaterevamp`, `holevp`,
// `warrensfearhaterevamp` and `unknown` name no expansion at all). The register asks "is this
// content open on the server", which is the question the Gear tab's era filter is actually asking,
// and it is the ONLY place either wiki states that directly. Nothing in this repo read it until
// JOS-298; the corpus-wide cost of not reading it was 151 items claiming to be farmable.
//
// TWO DISAGREEMENTS INSIDE THE SOURCE ITSELF, resolved toward what the wiki EXECUTES:
//   * `Template:PageEra`'s own documentation block lists `warrens = out` while the switch it
//     documents says `warrens = in`. The switch is what renders the badge, so the switch is the
//     record. (Inert either way today: no item page carries a `{{Warrens Era}}` banner.)
//   * The wrapper templates do not all pass the key you would guess. `{{Chardok Revamp Era}}`
//     passes `chardok`, and `{{FearHateRevamp Era}}` passes `FH Revamp`, which is in NO switch
//     row and so lands on `#default`. Both compose to `out` either way, which is why the fold
//     below (case + whitespace, the same shape `eraFromTag` uses) reproduces the wiki's rendered
//     answer for every token the corpus carries — verified template by template, 2026-08-13.
//
// `#default = out` IS MIRRORED, NOT INVENTED: a banner whose key the switch does not know renders
// the red badge on the live wiki. `tests/plannerEra.test.mts` pins that no token the committed
// corpus actually carries reaches the default, so a NEW era template turns that test red instead
// of silently hiding a shelf of items.
const PAGE_ERA: Readonly<Record<string, 'in' | 'out'>> = {
  classic: 'in',
  kunark: 'out',
  velious: 'out',
  luclin: 'out',
  chardok: 'out',
  chardokrevamp: 'out',
  fear: 'in',
  hate: 'in',
  hole: 'in',
  holevp: 'out',
  sky: 'in',
  stonebrunt: 'in',
  temple: 'in',
  warrens: 'in',
  warrensfearhaterevamp: 'out',
  fearhaterevamp: 'out',
  paineel: 'in',
  epics: 'out',
  epicquests: 'out',
  unknown: 'out'
}

/** The register's two answers: whether the wiki draws the red `Out of Era` badge on the page. */
export type EraBadge = 'in' | 'out'

/** The register's key fold: lowercased, spaces and underscores removed. One definition, because
 *  `eraBadge` and `namesEra` must agree on what "the same token" means. */
function registerKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s_]+/g, '')
}

/**
 * IS THIS A TOKEN THE ERA TABLES ACTUALLY NAME? — the guard the CATEGORY reader needs (JOS-328),
 * and the one place outside this file that is allowed to ask.
 *
 * `eraBadge` below answers `out` for a token it has never heard of, and that is CORRECT for a
 * BANNER: `Template:PageEra`'s `#default` is `out`, so the live page really does draw the red box
 * for a key the switch does not know, and mirroring that is reporting, not guessing. A CATEGORY is
 * the opposite case. `[[Category:Nov 2000 Era]]` renders nothing at all — it is the filing left
 * behind by a `{{P99 Era Header|Nov|2000}}` DATE banner, 8 pages of it in the corpus — so reading
 * `out` off it would be inventing a claim the wiki never made. So the category reader admits a
 * token only when this says yes, and law 1 keeps the date filings undefined.
 */
export function namesEra(tag: string): boolean {
  return registerKey(tag) in PAGE_ERA
}

/**
 * WHAT THE WIKI'S OWN BADGE SAYS about a page carrying this banner token.
 *
 * Folded to the switch's key spelling: lowercased, and spaces/underscores removed — `Chardok
 * Revamp` → `chardokrevamp`, `EpicQuests` → `epicquests`, the corpus's one `{{kunark Era}}` typo
 * → `kunark`. A token the register does not name is `out`, because that is what `#default` makes
 * the live page render.
 */
export function eraBadge(tag: string): EraBadge {
  return PAGE_ERA[registerKey(tag)] ?? 'out'
}

/**
 * Does this banner's OUT claim outrank the zones? — the predicate behind FIX 1 (see
 * `layeredVerdictAt`), exported because the chip has to name the same witness the verdict used.
 *
 * `true` only for an `out` badge, and then only while the expansion the token names (if it names
 * one at all) has not shipped. That second clause is what keeps `CURRENT_ERA` the single line that
 * moves: a `{{Kunark Era}}` page stops being overridden the day the server opens Kunark, exactly
 * as the rank comparison always handled it, while the tokens that name no expansion —
 * `FearHateRevamp`, `HoleVP`, `WarrensFearHateRevamp`, `Unknown` — have only the register to speak
 * for them and it keeps speaking.
 */
export function eraBadgeOverrides(tag: string | undefined, era: Era): boolean {
  if (tag === undefined || tag === '' || eraBadge(tag) !== 'out') return false
  const named = eraFromTag(tag)
  return named === null || eraRank(named) > eraRank(era)
}

/**
 * THE VERDICT THE UI ASKS FOR — three rules, in this order.
 *
 * 0. AN EXPLICIT OUT-OF-ERA BADGE OVERRULES THE ZONES (JOS-298, 2026-08-13). The wiki has drawn a
 *    red `Out of Era` box on the page; if we then rank the item in-era off its drop zone we are
 *    contradicting the source we scraped, in the one direction that costs the player real time.
 *    THE ZONE-WINS DOCTRINE INVERTS FOR REVAMPS AND FOR CHAINS, and both were measured, not
 *    argued:
 *      * REVAMPS. The Fear/Hate revamp replaced a classic zone's CONTENTS and added no zone, so
 *        "Plane of Hate" says nothing whatever about whether this drop table is the one running on
 *        this server. 53 pages carry `{{FearHateRevamp Era}}` and every one of them short-circuited
 *        on its zone before the banner was ever consulted — Breastplate of the Righteous (AC 42,
 *        Plane of Hate) topped the Gear tab's CHEST-by-AC list as farmable, which is the owner
 *        report this rule exists for.
 *      * CHAINS. An epic 1.0 piece dropping in Najena is not farmable on a classic server, because
 *        what makes it worth having is a KUNARK turn-in. That was already ruled once (the
 *        Ragebringer fix, 2026-08-05, and the reasoning is still in the `Epics` row of `TAG_ERA`)
 *        — and layer 1 silently re-broke it the same week for every chain piece a classic zone
 *        does drop, because the zone answered first and the banner was never reached. This rule
 *        restores that ruling instead of restating it.
 *    ONE DIRECTION ONLY. An `in` badge never overrules a zone: Stonebrunt Mountains pages are
 *    bannered `{{Classic Era}}` and the register calls `stonebrunt` in-era, but the owner watched
 *    that loot surface in the planner and reported it unreachable, so the zone table's `velious`
 *    still decides. Where you physically go still beats a page header — the asymmetry is that a
 *    header claiming you CANNOT go is a fact about the server, while a header claiming you can is
 *    a fact about a zone we may already know better.
 * 1. Otherwise LAYER 1 WINS OUTRIGHT. If any source zone resolves, that answer is final in both
 *    directions — a Velious-banner item a Lower Guk mob drops is farmable tonight (its banner
 *    having said `in`, or the rule above would have caught it), and a Classic-banner item whose
 *    only dropper lives in Kael Drakkel is not.
 * 2. LAYER 2 SPEAKS INTO SILENCE. When nothing resolved — no drop zone, or only dirt — the banner
 *    turns `unknown` into a real answer by the same rank comparison every other verdict uses. No
 *    banner, or one this app cannot read, and the answer stays `unknown` (law 1).
 */
export function layeredVerdictAt(
  zoneNames: readonly string[],
  tag: string | undefined,
  era: Era
): EraVerdict {
  if (eraBadgeOverrides(tag, era)) return 'out-of-era'
  const byZone = eraVerdictAt(zoneNames, era)
  if (byZone !== 'unknown') return byZone
  const tagged = tag === undefined || tag === '' ? null : eraFromTag(tag)
  if (tagged === null) return 'unknown'
  return eraRank(tagged) <= eraRank(era) ? 'in-era' : 'out-of-era'
}

/** `layeredVerdictAt` against what the server actually ships today. The call sites use this one. */
export function layeredVerdict(zoneNames: readonly string[], tag: string | undefined): EraVerdict {
  return layeredVerdictAt(zoneNames, tag, CURRENT_ERA)
}
