// PLANNER ERA — THE OUT-OF-ERA OVERRIDE, SWEPT OVER THE REAL CORPUS (JOS-298).
//
// `tests/plannerEra.test.mts` proves what the rules SAY (zone folds, the tag table, the register
// mirrored key for key). This file proves what they DO to 11,375 committed item keys, because the
// rule the owner's report produced is a blunt one — an out-of-era badge overrules the drop zone —
// and a blunt rule is only safe if the set it hides is a list somebody read.
//
// THE REPORT, verbatim from the ticket: Breastplate of the Righteous "tops the breastplate AC list
// as in-era while its wiki page carries out-of-era markers all over". That page is here, decided
// from its own committed record, red-before / green-after.
//
// THE PROPERTY is one-directionality: every verdict this wave changed went in-era -> out-of-era,
// and every one of them is backed by the banner the WIKI put on the page rather than by our
// reasoning about it. Measuring a difference needs both sides, so the pre-JOS-298 rule is
// transcribed below as a dated baseline. It is not a second implementation and nothing outside
// these tests may call it.
//
// The join is the app's own (`plannerData.eraZones`): the mob catalog's zones for this item key,
// UNION the zones the item page itself named. It is rebuilt here rather than imported so this
// suite stays Electron-free and React-free; `tests/gearIndex.test.mts` asks the same question
// through the shipped renderer path, which is where a drift between the two would show.
//
// SINCE JOS-333 it also sweeps LAYER 3 — the era read off the acquisition path — for the same
// reason and with the same shape: another blunt rule (one out-of-era edge is enough, by owner
// ruling) and another shelf of rows leaving the default view. JOS-341 then gave layer 3 the two
// targets the item corpus cannot hold (a fetched, committed verdict for the non-item pages the
// era? rows link, and for every dropper mob), which cost that section its two simplest sentences:
// a derivation may now point IN as well as out, and exactly one edge may overrule a drop zone.
// Both replacements are asserted as properties below. The rules themselves are unit-tested in
// `tests/eraDerive.test.mts`; here it is the committed bytes, and the four rows the owner named
// are asserted by name.
//
// No Electron, no fixtures, no game directory ⇒ this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_ERA,
  eraBadge,
  eraRank,
  eraVerdict,
  layeredVerdict,
  type Era,
  type EraDerivation,
  type EraVerdict
} from '../src/shared/planner/era'
import { buildEraDerivations } from '../src/main/planner/eraDerive'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import itemsJson from '../src/main/data/items.json'
import pageEraJson from '../src/main/data/pageEra.json'
import { itemKey, type ItemDbFile } from '../src/main/itemsDb'
import { pageEraKey, type PageEraFile } from '../src/main/pageEraDb'
import type { MobData } from '../src/shared/types'

const catalog = mobsJson as unknown as MobData
const corpus = itemsJson as unknown as ItemDbFile

/** itemKey → every zone the mob catalog places a dropper of it in. */
const CATALOG_ZONES_BY_ITEM = ((): Map<string, Set<string>> => {
  const m = new Map<string, Set<string>>()
  for (const mob of catalog.mobs) {
    for (const drop of mob.drops ?? []) {
      const key = itemKey(drop)
      if (key === '') continue
      let zones = m.get(key)
      if (!zones) m.set(key, (zones = new Set()))
      for (const zone of mob.zones ?? []) zones.add(zone)
    }
  }
  return m
})()

/** itemKey → every mob the catalog says drops it, by name (JOS-341's dropper edge, rebuilt here
 *  the way this suite rebuilds every join: from the committed bytes, never imported from the
 *  module under test, so a drift between the two shows up as a red test rather than as agreement
 *  with itself). */
const CATALOG_DROPPERS = ((): Map<string, string[]> => {
  const m = new Map<string, string[]>()
  for (const mob of catalog.mobs) {
    for (const drop of mob.drops ?? []) {
      const key = itemKey(drop)
      if (key === '') continue
      let names = m.get(key)
      if (!names) m.set(key, (names = []))
      if (!names.includes(mob.name)) names.push(mob.name)
    }
  }
  return m
})()

/** The committed answers the fetch brought back (`scripts/scrape-page-era.ts`). */
const SIDECAR = pageEraJson as PageEraFile

interface CorpusRow {
  key: string
  page: string
  tag?: string
  zones: string[]
  ac: number
}

const CORPUS: CorpusRow[] = Object.entries(corpus.items).map(([key, entry]) => {
  const zones = new Set(CATALOG_ZONES_BY_ITEM.get(key) ?? [])
  for (const src of entry.dropsFrom ?? []) if (src.zone !== undefined) zones.add(src.zone)
  return {
    key,
    page: entry.page,
    tag: entry.eraTag,
    zones: [...zones],
    ac: Number(entry.stats?.ac ?? 0)
  }
})

/**
 * THE VERDICT AS IT STOOD BEFORE JOS-298, transcribed on purpose. There is no other way to state
 * "this change only ever hides" as a property: the claim is about a DIFFERENCE, so both sides have
 * to be computable. Zones first and final; `eraFromTag` only into silence; `FearHateRevamp` read
 * `classic`. A dated BASELINE, not a second implementation — nothing outside this file may call
 * it, and nothing asks it for today's answer to anything.
 */
function verdictBeforeJos298(zones: readonly string[], tag: string | undefined): EraVerdict {
  const OLD_TABLE: Record<string, Era | null> = {
    classic: 'classic',
    sky: 'classic',
    fear: 'classic',
    hate: 'classic',
    fearhaterevamp: 'classic',
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
  const byZone = eraVerdict(zones)
  if (byZone !== 'unknown') return byZone
  const named = tag === undefined || tag === '' ? null : (OLD_TABLE[tag.trim().toLowerCase()] ?? null)
  if (named === null) return 'unknown'
  return eraRank(named) <= eraRank(CURRENT_ERA) ? 'in-era' : 'out-of-era'
}

const FLIPPED = CORPUS.filter(
  (r) => verdictBeforeJos298(r.zones, r.tag) !== layeredVerdict(r.zones, r.tag)
)

test('THE BREASTPLATE: the row the owner reported, decided from its own committed record', () => {
  // Not a fixture — the actual entry, joined the way the app joins it. AC 42, one drop zone, and
  // that zone is one this server ships, which is precisely why the zone could not be the witness.
  const bp = CORPUS.find((r) => r.key === 'breastplate of the righteous')
  assert.ok(bp, 'Breastplate of the Righteous left the corpus')
  assert.equal(bp.page, 'Breastplate of the Righteous')
  assert.equal(bp.tag, 'FearHateRevamp')
  assert.deepEqual(bp.zones, ['Plane of Hate'])
  assert.equal(bp.ac, 42)
  assert.equal(eraVerdict(bp.zones), 'in-era', 'Plane of Hate is a zone this server ships')
  assert.equal(eraBadge(bp.tag), 'out', 'and its own page carries the red Out of Era badge')

  // RED BEFORE, GREEN AFTER. This is the whole bug in two lines.
  assert.equal(verdictBeforeJos298(bp.zones, bp.tag), 'in-era')
  assert.equal(layeredVerdict(bp.zones, bp.tag), 'out-of-era')

  // And it is a SET, not one page: the four armour families the sweep named all read out-of-era.
  for (const family of ['of the righteous', 'of the untamed', 'legionnaire scale', 'greenmist']) {
    const rows = CORPUS.filter((r) => r.key.includes(family) && r.tag !== undefined)
    assert.ok(rows.length >= 4, `only ${String(rows.length)} rows match "${family}"`)
    for (const row of rows) {
      assert.equal(layeredVerdict(row.zones, row.tag), 'out-of-era', `${row.page} [${String(row.tag)}]`)
    }
  }
})

test('the override is ONE-DIRECTIONAL over the whole corpus: it hides, it never reveals', () => {
  // THE PROPERTY. Every single verdict this wave changed went in-era -> out-of-era. Nothing that
  // was hidden became visible, and nothing that was silent started making a claim it could not
  // support — which is what makes a rule this blunt safe to ship: the worst case is a row the
  // player can still see by turning the era filter off, with a chip naming the banner responsible.
  for (const row of FLIPPED) {
    assert.equal(verdictBeforeJos298(row.zones, row.tag), 'in-era', `${row.page} was not in-era`)
    assert.equal(layeredVerdict(row.zones, row.tag), 'out-of-era', `${row.page} did not become out`)
  }

  // EVERY ONE OF THEM IS JUSTIFIED BY ITS OWN PAGE. Not by our reasoning about revamps — by the
  // banner the wiki put on the page, which `Template:PageEra` renders as a red `Out of Era` box.
  // If a row is ever hidden without that badge, this assertion names it.
  for (const row of FLIPPED) {
    assert.ok(row.tag !== undefined && row.tag !== '', `${row.page} was hidden with NO banner`)
    assert.equal(eraBadge(row.tag ?? ''), 'out', `${row.page} [${String(row.tag)}] is not badged out`)
  }

  // Measured 2026-08-13 over the refreshed scrape: 151 keys, 113 of them slotted, 80 AC-bearing,
  // spread over 7 banner tokens (FearHateRevamp 53 · Velious 31 · Kunark 27 · EpicQuests 23 ·
  // Epics 10 · Luclin 5 · Unknown 2). It read 156 against the 2026-08-05 corpus; this wave's own
  // `--refresh` corrected 5 stale banners out of the set (Bronze Tanto and the four Torn Pages of
  // Mastery, all re-bannered Classic upstream). A FLOOR, not a count — a later refresh will
  // correct more, and that must not turn this red.
  assert.ok(FLIPPED.length >= 140, `only ${String(FLIPPED.length)} verdicts changed`)
  assert.ok(FLIPPED.filter((r) => r.ac > 0).length >= 70, 'the AC-bearing damage stopped reproducing')
})

test('no banner token in the corpus reaches the register default (the new-template tripwire)', () => {
  // `eraBadge` mirrors `#default = out`, which is right — the live page renders the red box for a
  // key the switch does not know. But it means a NEW era template the wiki adds as `in` would
  // silently hide a shelf of items here. So: every token the corpus actually carries must be a key
  // the register NAMES. A rescrape that introduces one turns this red, by name, on the run that
  // introduces it — which is the moment to go and read `Template:PageEra` again.
  const NAMED = new Set([
    'classic', 'kunark', 'velious', 'luclin', 'chardok', 'chardokrevamp', 'fear', 'hate', 'hole',
    'holevp', 'sky', 'stonebrunt', 'temple', 'warrens', 'warrensfearhaterevamp', 'fearhaterevamp',
    'paineel', 'epics', 'epicquests', 'unknown'
  ])
  const tokens = new Set(CORPUS.flatMap((r) => (r.tag === undefined ? [] : [r.tag])))
  assert.ok(tokens.size >= 14, `only ${String(tokens.size)} distinct banner tokens in the corpus`)
  for (const token of tokens) {
    const folded = token.trim().toLowerCase().replace(/[\s_]+/g, '')
    assert.ok(NAMED.has(folded), `banner token "${token}" folds to "${folded}", unknown to the register`)
  }
})

// =================================================================================
// JOS-328 — THE ERA CLAIMS THAT ARE NOT IN THE PAGE HEAD, and the report that produced them
// =================================================================================
//
// The owner's spot checks said every gear row we chip `era?` carries a red `Out of Era` badge on
// its wiki page. It does not reproduce, and the evidence is written out beside `parseEraBodyTag` in
// `src/main/itemLookupParse.ts`: `Template:Itempage` renders no badge at all, the top era? rows by
// AC and by DMG render none through `action=parse`, and the wiki's OWN era categories intersect our
// 1,166 era? gear rows in 38 pages — 36 of them in-era. What the hunt DID find is 44 pages stating
// an era somewhere other than the head, in two shapes, and this is the corpus-level pin on both of
// them plus on the negative that the report turned into.

test('the two out-of-head era claims are read, by name, off the committed corpus', () => {
  // FAMILY 1 — the banner in the BODY: `{{Classic Era}}` inside `|playercrafted`, 36 crafted-plate
  // pages that the parser header listed as an accepted loss until this wave.
  const FAMILY = /^(small |large )?fine (plate \w|splinted cloak$)|^(small|large) fine steel breastplate$/
  const finePlate = CORPUS.filter((r) => FAMILY.test(r.key))
  assert.ok(finePlate.length >= 36, `only ${String(finePlate.length)} Fine Plate pages in the corpus`)
  for (const row of finePlate) {
    assert.equal(row.tag, 'Classic', `${row.page} lost its body banner`)
    assert.equal(eraBadge(row.tag ?? ''), 'in', `${row.page} is not an in-era claim`)
  }

  // FAMILY 2 — the hand-written CATEGORY, with no banner template anywhere on the page. These eight
  // are the whole family: the other 8 category-only pages are `Nov 2000 Era` date filings left by
  // `{{P99 Era Header}}`, and the reader refuses those on purpose (law 1), so no Illegible Note may
  // ever arrive here carrying a token.
  const byCategory: Record<string, string> = {
    'flowing red silk sash': 'Kunark',
    'leech husk tunic': 'Kunark',
    'mantle of fire': 'Kunark',
    'mucilaginous girdle': 'Kunark',
    'sash of the dragonborn': 'Kunark',
    'scaled prowler belt': 'Kunark',
    'scaled wolf hide belt': 'Kunark',
    'fist of lightning': 'Velious'
  }
  for (const [key, tag] of Object.entries(byCategory)) {
    const row = CORPUS.find((r) => r.key === key)
    assert.ok(row, `${key} left the corpus`)
    assert.equal(row.tag, tag, `${row.page} lost its category claim`)
    assert.equal(layeredVerdict(row.zones, row.tag), 'out-of-era', `${row.page} is not hidden`)
  }
  for (const row of CORPUS) {
    if (!row.page.startsWith('Illegible Note:')) continue
    assert.equal(row.tag, undefined, `${row.page} read a P99 DATE filing as an era claim`)
  }
})

// =================================================================================
// JOS-333 / JOS-341 — LAYER 3: THE ERA THE PAGE NEVER STATES, READ OFF THE ACQUISITION PATH
// =================================================================================
//
// The owner came back with screenshots and the JOS-328 verdict was corrected: the out-of-era pills
// are real, they are just not ON the page. eqlwiki's own skin walks every LINK and pills the ones
// whose TARGET is out of era, so an era? item can be covered in them. `main/planner/eraDerive.ts`
// derives that, and this is what it does to the committed bytes.
//
// JOS-341 GAVE IT THE TWO TARGETS THE ITEM CORPUS CANNOT HOLD, fetched once at data-build time and
// committed as `src/main/data/pageEra.json` (`scripts/scrape-page-era.ts`, 22 live requests):
//   `page`     — the 151 non-item titles the era? rows' `|notes` name, 149 distinct keys. This is
//                what finally answers Silver Full Breastplate, JOS-333's named refusal.
//   `drop-mob` — 4,981 dropper mobs, of which the wiki badges 2,108 out. This is the owner's
//                Life's Guard, and it is the one edge allowed to overrule a drop zone.
// Both are asserted by name below, beside the two rows JOS-333 already flipped.

test('THE FOUR OWNER EXAMPLES, by name, off the committed corpus', () => {
  const derivations = buildEraDerivations(corpus)
  const of = (key: string): EraDerivation | undefined => derivations.get(key)

  // 1. The mold. The recipe needs a Small Breastplate Mold; that page carries `{{Epics Era}}`, the
  //    register calls it out, and the wiki's own `eqlmetadata` endpoint agrees (`outOfEra: true`).
  assert.deepEqual(of('dwarven breastplate (enchanted imbued)'), {
    basis: 'component',
    verdict: 'out-of-era',
    target: 'Small Breastplate Mold',
    detail: 'Epics'
  })

  // 2. The quests. `|relatedquests` names Scaled Mystic Armor Quests, which the committed quest
  //    catalog starts in East Cabilis — a Kunark city. `eqlmetadata` calls that page out of era too.
  //    The target is the QUEST's own name, not the item's: the item's `|relatedquests` use spells
  //    the quest as the item, and the catalog is the thing that knows what the quest is called.
  assert.deepEqual(of('scaled mystic breastplate'), {
    basis: 'quest',
    verdict: 'out-of-era',
    target: 'Scaled Mystic Armor Quests',
    detail: 'East Cabilis'
  })

  // 3. THE ONE JOS-333 COULD NOT ANSWER, and the reason this ticket exists. Silver Full Breastplate's
  //    page carries exactly one pill and it sits on `[[Cultural Tradeskills: Human]]` — an armour-SET
  //    page, which is not an `{{Itempage}}` and so is nowhere in the item corpus. All seven of its
  //    recipe components are in era and it has no quests, so no walk over items could ever reach it.
  //    The fetched sidecar reaches it: `eqlmetadata` says that set page is out of era, and the row
  //    finally has a verdict instead of a shrug. Its own page still states no era — that is what
  //    keeps this a LAYER 3 answer.
  assert.deepEqual(of('silver full breastplate'), {
    basis: 'page',
    verdict: 'out-of-era',
    target: 'Cultural Tradeskills: Human',
    detail: 'Epics'
  })
  const sfb = CORPUS.find((r) => r.key === 'silver full breastplate')
  assert.ok(sfb, 'Silver Full Breastplate left the corpus')
  assert.equal(sfb.tag, undefined, 'its own page states no era')
  assert.equal(layeredVerdict(sfb.zones, sfb.tag), 'unknown', 'layers 1-2 are still silent about it')

  // 4. LIFE'S GUARD — the owner's dropper example, and the correction that came with measuring it.
  //    It is NOT an era? row: its page opens `{{Classic Era}}` and its one dropper sits under a
  //    `Plane of Hate` heading, so layers 1-2 rank it in-era and the planner offered it as farmable
  //    AC 30 loot. The rest of the report is exactly right — the pill on that page is on
  //    `[[Agent of Innoruuk]]`, a Plane of Hate REVAMP mob the wiki badges out of era — and that is
  //    why this edge is DEFINITIVE: a revamp replaces a zone's contents without adding a zone.
  assert.deepEqual(of("life's guard"), {
    basis: 'drop-mob',
    verdict: 'out-of-era',
    definitive: true,
    target: 'Agent of Innoruuk',
    detail: 'Agent of Innoruuk'
  })
  const guard = CORPUS.find((r) => r.key === "life's guard")
  assert.ok(guard, "Life's Guard left the corpus")
  assert.equal(guard.tag, 'Classic', 'its own page claims Classic — which is what the mob overrules')
  assert.equal(layeredVerdict(guard.zones, guard.tag), 'in-era', 'and layers 1-2 really do call it farmable')
})

test('layer 3 speaks into silence — and over it for exactly one edge', () => {
  // THE PROPERTY, over every page the derivation answers for. It used to be one sentence ("layers
  // 1-2 were silent"); JOS-341 split it in two, and the split IS the safety argument:
  //   * a NON-definitive edge may only speak where the page's own layers 1-2 verdict was `unknown`,
  //     exactly as before, so nothing derived from a recipe or a set page can overrule a drop zone
  //     somebody can walk to;
  //   * the ONE definitive edge may speak anywhere, and pays for it by being the wiki's own per-mob
  //     badge on EVERY dropper the corpus and the catalog know of — asserted here against the
  //     committed sidecar, mob by mob, because that is the claim doing the overruling.
  const derivations = buildEraDerivations(corpus)
  assert.ok(derivations.size >= 2500, `only ${String(derivations.size)} pages carry a derivation`)
  let definitive = 0
  for (const [key, derived] of derivations) {
    const row = CORPUS.find((r) => r.key === key)
    assert.ok(row, `${key} carries a derivation but has no corpus row`)
    assert.ok(derived.target.length > 0 && derived.detail.length > 0, `${row.page} derived a nameless edge`)
    // Asked with the page's own zones, which is what the builder saw. The catalog can only make the
    // renderer MORE decided, and `donorEra` applies a non-definitive edge only where it is unknown.
    const pageZones = (corpus.items[key]?.dropsFrom ?? []).flatMap((s) => (s.zone === undefined ? [] : [s.zone]))
    if (derived.definitive !== true) {
      assert.equal(row.tag, undefined, `${row.page} carries BOTH a banner and a non-definitive derivation`)
      assert.equal(layeredVerdict(pageZones, undefined), 'unknown', `${row.page} was already placed by a zone`)
      continue
    }
    definitive++
    assert.equal(derived.basis, 'drop-mob', `${row.page} claims a definitive ${derived.basis} edge`)
    const droppers = new Set([
      ...(corpus.items[key]?.dropsFrom ?? []).map((s) => s.mob),
      ...(CATALOG_DROPPERS.get(key) ?? [])
    ])
    assert.ok(droppers.size > 0, `${row.page} derived a dropper edge with no droppers`)
    for (const mob of droppers) {
      assert.equal(SIDECAR.mobs[pageEraKey(mob)], true, `${row.page}: ${mob} is not badged out`)
    }
  }
  assert.ok(definitive >= 2000, `only ${String(definitive)} definitive edges`)
})

test('THE IN-ERA DIRECTION refuses a page that merely failed to be out', () => {
  // `outOfEra: false` comes back both for a page the wiki files under `Classic Era` and for a page
  // nobody ever classified — a skill page, an NPC stub — and only the first is evidence. Over the
  // committed sidecar: 149 pages asked, 23 out, 54 carrying an in-era token, and the rest silent.
  // Every in-era derivation in the corpus must trace to one of those 54.
  const derivations = buildEraDerivations(corpus)
  const inEra = [...derivations.values()].filter((d) => d.verdict === 'in-era')
  assert.ok(inEra.length >= 50, `only ${String(inEra.length)} in-era derivations`)
  for (const d of inEra) {
    assert.equal(d.basis, 'page', `an in-era verdict came from a ${d.basis} edge, which cannot mean in-era`)
    const target = SIDECAR.pages[pageEraKey(d.target)]
    assert.ok(target, `${d.target} is not in the committed sidecar`)
    assert.equal(target.outOfEra, false, `${d.target} is badged out and still argued IN`)
    assert.ok(target.eraTag !== undefined && eraBadge(target.eraTag) === 'in', `${d.target} states no in-era claim`)
  }

  // THE NAMED REFUSAL, kept from the fetch: eight of the nine Cultural Tradeskills set hubs come
  // back out of era and one — Erudite — comes back FALSE with no era token at all. Its 14 rows do
  // not flip in either direction, and that is the endpoint's answer rather than ours to smooth.
  const erudite = SIDECAR.pages['cultural tradeskills: erudite']
  assert.ok(erudite, 'the Erudite set page left the sidecar')
  assert.equal(erudite.outOfEra, false)
  assert.equal(erudite.eraTag, undefined, 'if the wiki ever classifies it, this assertion is the notice')
  assert.equal(
    [...derivations.values()].filter((d) => d.target === 'Cultural Tradeskills: Erudite').length,
    0,
    'the Erudite set page started deciding rows'
  )
})

test('THE CENSUS: what layer 3 costs the default era-filtered table', () => {
  // Re-measured 2026-08-13 after JOS-341. FLOORS, never equalities — a rescrape moves every one of
  // these, and the number that must not move quietly is the DIRECTION.
  //   corpus pages with a derivation  463 -> 3,221
  //     drop-mob 2,365 · page 442 · component 308 · quest 102 · component-zone 4 · yield 0
  //     (component-zone fell 49 -> 4 and quest 106 -> 102 because the DEFINITIVE dropper edge
  //      outranks them in `BASIS_ORDER`; the verdict on those rows did not change, only which edge
  //      is reported for it)
  //   gear rows in-era                2,319 -> 2,343   (+40 derived in-era, -16 to the dropper edge)
  //   gear rows era?                    770 ->   437
  //   gear rows out-of-era            3,725 -> 4,034
  //   default era-filtered table      3,089 -> 2,343 visible of 6,814
  // The before column is this repo's own measurement of the JOS-333 tip and is two rows off the
  // number recorded on that ticket (3,727 / 768); the derivation set matches it exactly (463:
  // component 308 · quest 106 · component-zone 49), so the difference is in how the gear-row
  // verdicts were counted there, not in the rules.
  const derivations = buildEraDerivations(corpus)
  const byBasis = new Map<string, number>()
  for (const d of derivations.values()) byBasis.set(d.basis, (byBasis.get(d.basis) ?? 0) + 1)
  assert.ok((byBasis.get('drop-mob') ?? 0) >= 2000, `only ${String(byBasis.get('drop-mob'))} dropper edges`)
  assert.ok((byBasis.get('page') ?? 0) >= 380, `only ${String(byBasis.get('page'))} page edges`)
  assert.ok((byBasis.get('component') ?? 0) >= 280, `only ${String(byBasis.get('component'))} component edges`)
  assert.ok((byBasis.get('quest') ?? 0) >= 90, `only ${String(byBasis.get('quest'))} quest edges`)

  // EVERY BASIS THE TYPE NAMES IS ACCOUNTED FOR. `yield` legitimately fires for nothing today; the
  // assertion is that no basis appears here that this file has never heard of, which is what would
  // happen if a seventh edge shipped without a census.
  for (const basis of byBasis.keys()) {
    assert.ok(
      ['drop-mob', 'component', 'yield', 'page', 'quest', 'component-zone'].includes(basis),
      `unknown basis "${basis}"`
    )
  }

  // THE ERA? ROWS THE DERIVATION RESOLVES, counted the way the app counts them (catalog ∪ page
  // zones ∪ banner). The derivations the catalog overrules are the safety valve, not a defect.
  const stillUnknown = CORPUS.filter((r) => layeredVerdict(r.zones, r.tag) === 'unknown')
  const resolved = stillUnknown.filter((r) => derivations.has(r.key))
  assert.ok(resolved.length >= 700, `layer 3 only resolved ${String(resolved.length)} era? rows`)
  assert.ok(
    resolved.length < stillUnknown.length,
    'layer 3 resolved EVERY era? row, which means it stopped refusing anything'
  )

  // THE SHELF IT HIDES IS ONE FAMILY, and naming it is the point: a rule this blunt is only safe if
  // the set it hides is a list somebody read. These five components carry the bulk of it, and each
  // one's page really does open with an out-of-era banner.
  // Compared by KEY, not by spelling (law 2): the recipes write `Teir\`Dal Smithy Hammer` while the
  // page is titled `Teir\`dal Smithy Hammer`, and the edge carries the recipe's spelling verbatim.
  for (const target of ['Elven Smithy Hammer', 'Teir`dal Smithy Hammer', 'Imbued Emerald', 'Brute Hide']) {
    const riders = [...derivations.values()].filter((d) => itemKey(d.target) === itemKey(target))
    assert.ok(riders.length >= 10, `only ${String(riders.length)} pages ride on ${target}`)
    const page = CORPUS.find((r) => r.key === itemKey(target))
    assert.ok(page, `${target} is not in the corpus`)
    assert.equal(eraBadge(page.tag ?? ''), 'out', `${target} [${String(page.tag)}] is not badged out`)
  }
})

test('SHIELD OF HATRED: the corpus never lost its page, so the link has one to point at', () => {
  // The owner reported this row showing NO wiki link in-app while its description mentions GM. The
  // corpus row is intact — page title, stats, icon and all — and the wiki's `eqlmetadata` says the
  // page is live and IN era, so nothing here needed repairing. What was missing was the affordance:
  // `KnowledgeSection` gated the "Source: eqlwiki.com" line behind `hasKnowledge`, and this item has
  // no quest, no lore flag and no recipe, so the card that carries the link never mounted. Fixed in
  // the renderer; pinned here because the DATA half of the claim is what a corpus test can hold.
  const shield = CORPUS.find((r) => r.key === 'shield of hatred')
  assert.ok(shield, 'Shield of Hatred left the corpus')
  assert.equal(shield.page, 'Shield of Hatred')
  assert.equal(shield.ac, 25)
  const entry = corpus.items['shield of hatred']
  assert.equal(entry?.lore, undefined, 'it carries no LORE flag')
  assert.equal(entry?.quest, undefined, 'and no quest flag')
  assert.deepEqual(entry?.questUses, undefined, 'and no quest uses')
  assert.equal(entry?.recipes, undefined, 'and no recipe uses')
  assert.equal(entry?.craftedBy, undefined, 'and no recipe that makes it')
  // Which is exactly the shape `hasKnowledge` returns false for. The page is nonetheless there.
  assert.ok((entry?.summary ?? '').includes('GM'), 'the description the owner quoted moved')
})

test('era? means the page said NOTHING — the state carries no token to have misread', () => {
  // THE NEGATIVE, pinned. `era?` is reached only when no zone resolved AND the page made no era
  // claim of any of the three kinds, so an `era?` row carrying a token would mean the tables had
  // silently dropped a claim on the floor. Zero of them do — which is also the reason no era? row
  // can be carrying a badge this corpus knows about: there is nothing on the page to badge.
  const unknown = CORPUS.filter((r) => layeredVerdict(r.zones, r.tag) === 'unknown')
  assert.ok(unknown.length >= 2000, `only ${String(unknown.length)} era? rows — the state vanished`)
  const withTag = unknown.filter((r) => r.tag !== undefined && r.tag !== '')
  assert.deepEqual(
    withTag.map((r) => `${r.page} [${String(r.tag)}]`).slice(0, 5),
    [],
    `${String(withTag.length)} era? rows carry a banner token`
  )
})
