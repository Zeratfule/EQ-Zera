// PLANNER ERA TESTS — the layer that stops the planner recommending Velious loot (era.ts).
//
// THE BUG, RESTATED SO THE PIN CANNOT DRIFT FROM IT: the effect browser offered Primal Velium
// weapons for the Avatar proc. All of them drop off Sleeper's Tomb warders — Velious content EQ
// Legends has not opened. Nothing on an item says so; the only evidence is the drop zone. So this
// suite proves two things and nothing else:
//
//   1. THE VERDICT IS RIGHT ON REAL DATA. Sleeper's Tomb reads out-of-era; Upper Guk reads
//      in-era; junk reads unknown; and the whole assertion runs against the REAL committed
//      catalog, not a fixture (the plannerSourceIndex precedent).
//   2. THE ORDERING IS THE SEMANTIC, not today's constant. `CURRENT_ERA` is one line that flips
//      when Kunark launches, so the tests exercise `eraVerdictAt` at each era instead of hard-
//      coding "kunark is out" — the day the flip happens this file must stay green unchanged.
//   3. THE LAYERING (added 2026-08-04 with the page-top `{{X Era}}` banner). The banner is
//      consulted where nothing resolved, and — since JOS-298 — its OUT claim overrules a zone
//      outright. The mapping from a banner token to an expansion is a hand-authored table and is
//      pinned here token for token; the in/out claim is a MIRROR of `Template:PageEra` and is
//      pinned key for key against the switch this file quotes.
//
// WHAT THE OVERRIDE DOES TO THE 11,375 COMMITTED ITEM KEYS is the sibling file's job:
// `tests/plannerEraCorpus.test.mts` sweeps the corpus, enumerates every verdict this rule changed,
// and proves the change is one-directional. This file stays on the rules themselves.
//
// COVERAGE IS A FLOOR, NEVER AN EXACT COUNT (AGENTS.md: frozen numbers rot). Measured 2026-08-04
// over the 192 distinct catalog zone strings / 8,214 mob-zone links: 159 names resolve, carrying
// 8,128 links (99.0%). The floors below sit meaningfully under that, so a rescrape that adds
// zones cannot turn this red — but a fold that quietly stops resolving `Kael Drakkel` will.
//
// No Electron, no fixtures, no game directory ⇒ this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENT_ERA,
  ERA_ORDER,
  eraBadge,
  eraBadgeOverrides,
  eraFromTag,
  eraRank,
  eraVerdict,
  eraVerdictAt,
  layeredVerdict,
  layeredVerdictAt,
  zoneEra,
  type Era
} from '../src/shared/planner/era'
import { ZONES, zoneKey } from '../src/shared/zones'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import type { MobData } from '../src/shared/types'

const catalog = mobsJson as unknown as MobData

/** Every distinct zone string the catalog states, with how many mob pages state it. */
const CATALOG_ZONES = ((): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const mob of catalog.mobs) {
    for (const zone of mob.zones ?? []) counts.set(zone, (counts.get(zone) ?? 0) + 1)
  }
  return counts
})()

// ---- the Avatar case (the reason this module exists) ----------------------------------------

test("the Avatar donors' zone reads out-of-era: Primal Velium is Sleeper's Tomb, and that is Velious", () => {
  // Found by the catalog, not by hand: every mob whose loot list names a Primal Velium item.
  // Measured 2026-08-04: 7 mobs (the four warders, the Master of the Guard, the Final Arbiter,
  // the Progenitor), 8 distinct weapons, ONE zone between them.
  const droppers = catalog.mobs.filter((m) => (m.drops ?? []).some((d) => /^Primal Velium /i.test(d)))
  assert.ok(droppers.length >= 5, `only ${String(droppers.length)} Primal Velium droppers found`)
  for (const mob of droppers) {
    const zones = mob.zones ?? []
    assert.ok(zones.length > 0, `${mob.name} states no zone`)
    assert.equal(eraVerdict(zones), 'out-of-era', `${mob.name} ${JSON.stringify(zones)}`)
  }

  // And the zone itself, stated directly so the pin survives a rescrape that renames the mobs.
  assert.equal(zoneEra("Sleeper's Tomb"), 'velious')
  assert.equal(eraVerdict(["Sleeper's Tomb"]), 'out-of-era')
})

test('every mob the catalog places in a Velious zone reads out-of-era under a classic server', () => {
  // The generalisation of the Avatar case. Kael Drakkel alone is 343 mob pages — this is the bulk
  // of what the planner was mis-recommending, and none of it may read as farmable today.
  let checked = 0
  for (const mob of catalog.mobs) {
    const zones = mob.zones ?? []
    if (zones.length !== 1 || zoneEra(zones[0]) !== 'velious') continue
    checked++
    assert.equal(eraVerdictAt(zones, 'classic'), 'out-of-era', `${mob.name} in ${zones[0]}`)
    // ...and in-era the moment the server ships Velious. The verdict is a comparison, not a list.
    assert.equal(eraVerdictAt(zones, 'velious'), 'in-era', `${mob.name} in ${zones[0]}`)
  }
  assert.ok(checked >= 1_400, `only ${String(checked)} single-zone Velious mobs checked`)
})

// ---- the three verdicts ----------------------------------------------------------------------

test('a classic zone is in-era, at every era the game will ever be on', () => {
  assert.equal(zoneEra('Upper Guk'), 'classic')
  assert.equal(eraVerdict(['Upper Guk']), 'in-era')
  for (const era of ERA_ORDER) assert.equal(eraVerdictAt(['Upper Guk'], era), 'in-era', era)
  // The log's own spelling of the same place, and the alias, agree — one zone, one era.
  assert.equal(zoneEra('The City of Guk'), 'classic')
  assert.equal(zoneEra('Lower Guk'), 'classic')
})

test('junk, prose and ambiguity read UNKNOWN — never a nearest guess (law 12)', () => {
  // Real catalog strings, every one of them. A matcher that split concatenations on capitals or
  // stripped the `?` would be inventing a fact the wiki never stated.
  for (const junk of [
    'Everfrost PeaksLake Rathetear',
    'DreadlandsEmerald JungleCity of Mist',
    'Western Plains of KaranaNorthern Plains of Karana',
    'Kithicor Forest Misty Thicket',
    'Most starting zones',
    'Various',
    'Various Zones',
    'also in Chardok?',
    'West Cabilis?',
    'Field of Bone?',
    'Kelethin (Greater Faydark)',
    'Lake of Ill Omen.',
    'West Freeport OR East Freeport'
  ]) {
    assert.equal(zoneEra(junk), null, `"${junk}" must not resolve`)
    assert.equal(eraVerdict([junk]), 'unknown', `"${junk}" must read unknown`)
  }
  // The AMBIGUOUS city names zones.ts deliberately refuses (each is 2-3 different map files).
  for (const ambiguous of ['Freeport', 'Kaladim', 'Neriak', 'Qeynos', 'Felwithe', 'Guk', 'Karana']) {
    assert.equal(zoneEra(ambiguous), null, `"${ambiguous}" is ambiguous and must not resolve`)
  }
  // Degenerate input never throws and never resolves.
  for (const blank of ['', '   ', 'xyzzy']) assert.equal(zoneEra(blank), null)
  // No zones at all — a quest reward or a crafted item. Silence, not a warning (law 1).
  assert.equal(eraVerdict([]), 'unknown')
})

test('a KNOWN zone with no era claim reads unknown, not out-of-era', () => {
  // New Sebilis Expedition is EQL-new content the player has actually walked; it belongs to no
  // 1999-2000 expansion, so the table makes no era claim. Calling that "out-of-era" would be a
  // lie about a place you can zone into right now.
  assert.equal(zoneEra('New Sebilis Expedition'), null)
  assert.equal(eraVerdict(['New Sebilis Expedition']), 'unknown')
  // Same for the Live-EQ hub zones the map table carries but EQL cannot reach.
  for (const later of ['The Bazaar', 'The Nexus', 'Plane of Knowledge', 'The Guild Lobby']) {
    assert.equal(zoneEra(later), null, later)
  }
})

test('one reachable zone wins: a mixed drop list is in-era, not out', () => {
  // A mob that spawns in both Lower Guk and Kael Drakkel is still a Lower Guk camp. The verdict
  // asks "can I farm this", not "is every source reachable".
  assert.equal(eraVerdict(['Kael Drakkel', 'Lower Guk']), 'in-era')
  assert.equal(eraVerdict(['Lower Guk', 'Kael Drakkel']), 'in-era')
  // Unresolvable dirt beside a real zone neither helps nor hurts.
  assert.equal(eraVerdict(['Various', "Sleeper's Tomb"]), 'out-of-era')
  assert.equal(eraVerdict(['Various', 'Lower Guk']), 'in-era')
})

// ---- the ordering, which is what CURRENT_ERA means -------------------------------------------

test('ERA_ORDER is release order, and eraRank agrees with it', () => {
  // 'luclin' is here because 25 item PAGES are banner-tagged `{{Luclin Era}}` and `eraFromTag`
  // has to be able to rank what it reads. No ZONE claims it (ZoneEra deliberately stops at
  // Velious), so this list is one longer than the zone table's vocabulary — by design.
  assert.deepEqual([...ERA_ORDER], ['classic', 'kunark', 'velious', 'luclin'])
  assert.equal(eraRank('classic'), 0)
  assert.ok(eraRank('classic') < eraRank('kunark'))
  assert.ok(eraRank('kunark') < eraRank('velious'))
  assert.ok(eraRank('velious') < eraRank('luclin'))
  assert.ok(ERA_ORDER.includes(CURRENT_ERA), 'CURRENT_ERA must be one of the ranked eras')
})

test('the verdict is a comparison against CURRENT_ERA, not a hardcoded era list', () => {
  const chardok = ['Chardok'] // Kunark
  const guk = ['Lower Guk'] // classic
  const sleeper = ["Sleeper's Tomb"] // Velious

  // TODAY the server is classic, so Kunark loot is out of reach...
  assert.equal(CURRENT_ERA, 'classic', 'EQL ships classic today (R6); flip this line WITH era.ts')
  assert.equal(eraVerdict(chardok), 'out-of-era')

  // ...and the day Kunark launches, flipping CURRENT_ERA is the whole change: classic AND kunark
  // become in-era together, Velious stays out. Asserted through eraVerdictAt so this test does
  // not have to be rewritten on that day.
  const expected: Record<Era, [string, string, string]> = {
    classic: ['in-era', 'out-of-era', 'out-of-era'],
    kunark: ['in-era', 'in-era', 'out-of-era'],
    velious: ['in-era', 'in-era', 'in-era'],
    luclin: ['in-era', 'in-era', 'in-era']
  }
  for (const era of ERA_ORDER) {
    const [g, c, s] = expected[era]
    assert.equal(eraVerdictAt(guk, era), g, `Lower Guk @ ${era}`)
    assert.equal(eraVerdictAt(chardok, era), c, `Chardok @ ${era}`)
    assert.equal(eraVerdictAt(sleeper, era), s, `Sleeper's Tomb @ ${era}`)
  }

  // eraVerdict is exactly eraVerdictAt(CURRENT_ERA) — no second opinion.
  for (const zones of [guk, chardok, sleeper, ['Various'], []]) {
    assert.equal(eraVerdict(zones), eraVerdictAt(zones, CURRENT_ERA))
  }
})

// ---- layer 2: the item page's era banner -------------------------------------------------------

test('eraFromTag is the hand-authored table, token for token (law 12)', () => {
  // EVERY token the corpus actually carries, measured 2026-08-04 over the scrape cache: Velious
  // 2,761 · Classic 2,422 · Kunark 1,224 · Sky 349 · Chardok Revamp 136 · Epics 113 · Temple 98 ·
  // EpicQuests 76 · FearHateRevamp 53 · Fear 27 · Luclin 25 · Paineel 22 · Hate 5 · Unknown 2 ·
  // `kunark` 1 · `Chardok` 1. Pinned as a table, not a rule, because these are the wiki's SECTION
  // HEADINGS — half of them name a place, and no amount of string logic turns "Temple" into an
  // expansion.
  const TABLE: readonly (readonly [string, Era | null])[] = [
    ['Classic', 'classic'],
    ['Sky', 'classic'], // Plane of Sky is 1999 raid content, not a later expansion
    ['Fear', 'classic'],
    ['Hate', 'classic'],
    ['Temple', 'classic'], // Temple of Solusek Ro
    ['Paineel', 'classic'], // the late-1999 heretic patch
    ['Epics', 'kunark'], // the 1.0 chain is a Kunark system — see the Ragebringer pin below
    ['EpicQuests', 'kunark'],
    ['Kunark', 'kunark'],
    ['Chardok Revamp', 'kunark'], // Chardok is a Kunark zone whatever the revamp did to it
    ['Chardok', 'kunark'],
    ['Velious', 'velious'],
    ['Luclin', 'luclin'],
    ['Unknown', null] // the wiki saying it does not know must not become our guess
  ]
  for (const [tag, era] of TABLE) assert.equal(eraFromTag(tag), era, tag)

  // FEARHATEREVAMP NAMES NO EXPANSION (JOS-298). It read `classic` for a week on a MEASURED but
  // mis-aimed argument: 26 of the 53 tagged pages appear in the mob catalog's loot lists and all
  // 26 drop off a Plane of Fear or Plane of Hate mob, which was read as "this loot is live here".
  // The catalog is a scrape of the same WIKI, not an observation of the server, and it documents
  // the revamp on both sides — the droppers carry the banner on their own pages. So the zone says
  // nothing, and the token names a PATCH, not an expansion. What it does claim is in/out, and
  // that lives in the register (pinned below), which reads `out`.
  assert.equal(eraFromTag('FearHateRevamp'), null)
  assert.equal(eraBadge('FearHateRevamp'), 'out')

  // The evidence that used to justify `classic` is re-derived here anyway, because it is still
  // TRUE and still not enough: the Greenmist droppers really do live in a zone this server ships,
  // and the armour is still out-of-era, because the zone cannot speak for a revamped drop table.
  const greenmist = catalog.mobs.filter((m) => (m.drops ?? []).some((d) => /^Greenmist /i.test(d)))
  assert.ok(greenmist.length > 0, 'the catalog no longer lists Greenmist armour at all')
  for (const mob of greenmist) {
    assert.equal(eraVerdict(mob.zones ?? []), 'in-era', `${mob.name} ${JSON.stringify(mob.zones)}`)
    assert.equal(layeredVerdict(mob.zones ?? [], 'FearHateRevamp'), 'out-of-era', mob.name)
  }

  // CASE is folded (the corpus's one `{{kunark Era}}` typo), whitespace is already normalized by
  // the parser, and anything the table does not name is null — never a nearest match.
  assert.equal(eraFromTag('kunark'), 'kunark')
  assert.equal(eraFromTag('  VELIOUS  '), 'velious')
  for (const junk of ['', 'Planes of Power', 'Hole', 'P99 Era Header', 'xyzzy']) {
    assert.equal(eraFromTag(junk), null, junk)
  }
})

// ---- the wiki's own in/out register, mirrored ---------------------------------------------------

test('eraBadge IS Template:PageEra’s switch, key for key (a mirror, not a judgement)', () => {
  // QUOTED FROM THE SOURCE: the `{{#switch:{{{1}}}}}` inside `Template:PageEra`'s `<includeonly>`,
  // read at revid 156232 (2026-07-12T16:02:29Z). Every row of the live template is here, in its
  // own order, so a diff against the wiki is a diff against this literal.
  const SWITCH: readonly (readonly [string, 'in' | 'out'])[] = [
    ['classic', 'in'],
    ['kunark', 'out'],
    ['velious', 'out'],
    ['luclin', 'out'],
    ['chardok', 'out'],
    ['chardokrevamp', 'out'],
    ['fear', 'in'],
    ['hate', 'in'],
    ['hole', 'in'],
    ['holevp', 'out'],
    ['sky', 'in'],
    ['stonebrunt', 'in'],
    ['temple', 'in'],
    // The template's own DOCUMENTATION block says `warrens = out` while the switch it documents
    // says `in`. The switch is what renders the badge, so the switch is the record. Inert today:
    // no item page carries a `{{Warrens Era}}` banner (asserted by the census test below).
    ['warrens', 'in'],
    ['warrensfearhaterevamp', 'out'],
    ['fearhaterevamp', 'out'],
    ['paineel', 'in'],
    ['epics', 'out'],
    ['epicquests', 'out'],
    ['unknown', 'out']
  ]
  assert.equal(SWITCH.length, 20, 'the quoted switch has 20 rows')
  for (const [key, answer] of SWITCH) assert.equal(eraBadge(key), answer, key)

  // THE FOLD, which is what lets a BANNER TOKEN reach a SWITCH KEY. `{{Chardok Revamp Era}}`
  // actually passes `chardok` and `{{FearHateRevamp Era}}` passes `FH Revamp` (which is in no row
  // and lands on `#default`); both compose to `out` either way, so folding the token directly
  // reproduces the wiki's rendered answer without a second table of wrapper templates.
  assert.equal(eraBadge('Chardok Revamp'), 'out')
  assert.equal(eraBadge('FH Revamp'), 'out')
  assert.equal(eraBadge('EpicQuests'), 'out')
  assert.equal(eraBadge('  VELIOUS  '), 'out')
  assert.equal(eraBadge('kunark'), 'out') // the corpus's one lowercase typo
  assert.equal(eraBadge('Chardok_Revamp'), 'out')
  assert.equal(eraBadge('CLASSIC'), 'in')

  // `#default = out` IS THE WIKI'S ANSWER, mirrored: a banner whose key the switch does not know
  // renders the red box on the live page, so an unknown token here is `out`, not silence.
  for (const unknown of ['Planes of Power', 'Ykesha', 'xyzzy', '']) {
    assert.equal(eraBadge(unknown), 'out', unknown)
  }
})

test('the OUT badge overrules zones; the IN badge never does; and the flip still moves it', () => {
  // The predicate, stated on its own so the verdict below reads as one rule and not three.
  // OUT + names no expansion → overrules at every era we will ever be on.
  for (const era of ERA_ORDER) {
    assert.equal(eraBadgeOverrides('FearHateRevamp', era), true, `FearHateRevamp @ ${era}`)
    assert.equal(eraBadgeOverrides('Unknown', era), true, `Unknown @ ${era}`)
  }
  // OUT + names an expansion → overrules only until that expansion ships. This is the clause that
  // keeps CURRENT_ERA the single line that moves.
  assert.equal(eraBadgeOverrides('Kunark', 'classic'), true)
  assert.equal(eraBadgeOverrides('Kunark', 'kunark'), false)
  assert.equal(eraBadgeOverrides('Epics', 'classic'), true)
  assert.equal(eraBadgeOverrides('Epics', 'kunark'), false)
  assert.equal(eraBadgeOverrides('Velious', 'kunark'), true)
  assert.equal(eraBadgeOverrides('Velious', 'velious'), false)
  // IN never overrules anything, at any era — this is the one-directionality, at the source.
  for (const era of ERA_ORDER) {
    for (const tag of ['Classic', 'Sky', 'Fear', 'Hate', 'Temple', 'Paineel', 'Hole', 'Stonebrunt']) {
      assert.equal(eraBadgeOverrides(tag, era), false, `${tag} @ ${era}`)
    }
  }
  // No banner at all is not a claim (law 1).
  for (const era of ERA_ORDER) {
    assert.equal(eraBadgeOverrides(undefined, era), false)
    assert.equal(eraBadgeOverrides('', era), false)
  }
})

test('THE RAGEBRINGER PIN: an epic weapon nobody drops must read out-of-era on a classic server', () => {
  // THE BUG (owner, 2026-08-05): Ragebringer and Spear of Fate rendered CLEAN — no era chip —
  // with the era filter ON, on a server whose epic chains do not exist yet. The tag row said
  // `Epics → classic`, and its stated defence was that layer 1 catches any piece a Kunark zone
  // gates. That defence never applies to the reward itself: the epic WEAPON is a quest turn-in
  // that drops off nobody, so there is no zone to catch it with and the tag is the only witness.
  //
  // Asserted from the mob catalog rather than by hand: no mob in the catalog drops Ragebringer,
  // so its zone list really is empty and layer 2 really is the whole verdict.
  const droppers = catalog.mobs.filter((m) =>
    (m.drops ?? []).some((d) => d.trim().toLowerCase() === 'ragebringer')
  )
  assert.deepEqual(
    droppers.map((m) => m.name),
    [],
    'the catalog now names a Ragebringer dropper — the pin needs a dropperless epic'
  )

  // Its page's own banner (`{{Epics Era}}`, pinned against the corpus in
  // tests/plannerEffectIndex.test.mts) is therefore the entire evidence, and it says Kunark.
  assert.equal(eraFromTag('Epics'), 'kunark')
  assert.equal(eraFromTag('EpicQuests'), 'kunark')
  assert.equal(layeredVerdict([], 'Epics'), 'out-of-era')
  assert.equal(layeredVerdict([], 'EpicQuests'), 'out-of-era')

  // AND THE RULING NOW REACHES THE WHOLE CHAIN, not only its dropperless end (JOS-298). Layer 1
  // silently re-broke this the same week it was made: a chain piece a CLASSIC zone drops answered
  // on its zone and the banner was never reached, so Cazic Quill (Kithicor Forest) and the four
  // Torn Pages of Mastery (Najena, Cazic Thule) read as farmable again. They are not: what makes
  // an epic 1.0 piece worth carrying is a KUNARK turn-in, and the wiki badges every one of them
  // Out of Era. The zone-wins doctrine inverts here, which is exactly rule 0 in `layeredVerdictAt`.
  assert.equal(layeredVerdict(['Najena'], 'Epics'), 'out-of-era')
  assert.equal(layeredVerdict(['Kithicor Forest'], 'EpicQuests'), 'out-of-era')
  assert.equal(layeredVerdict(["Sleeper's Tomb"], 'Epics'), 'out-of-era')

  // …and it is still the ordinary rank comparison, not a special case: the day Kunark ships, the
  // whole chain becomes farmable by flipping CURRENT_ERA — the badge stops overruling the zone
  // the moment the expansion it names is open.
  assert.equal(layeredVerdictAt([], 'Epics', 'kunark'), 'in-era')
  assert.equal(layeredVerdictAt(['Najena'], 'Epics', 'kunark'), 'in-era')
  assert.equal(layeredVerdictAt(["Sleeper's Tomb"], 'Epics', 'kunark'), 'out-of-era')
})

test('layeredVerdict: an OUT badge beats the zone, an IN badge never does, silence takes either', () => {
  const guk = ['Lower Guk'] // classic
  const sleeper = ["Sleeper's Tomb"] // velious
  const junk = ['Various'] // resolves to nothing

  // 1. TAG OUT BEATS ZONE IN — inverted 2026-08-13 (JOS-298), and this is the assertion that
  //    changed. It used to read `in-era`, on the argument that a Velious-bannered item a Lower Guk
  //    mob drops is farmable tonight. The wiki disagrees in writing: `{{Velious Era}}` renders a
  //    red `Out of Era` box, and a zone cannot refute that, because a revamp replaces a classic
  //    zone's CONTENTS without adding a zone. Blazing Gauntlets of Fennin Ro (tagged Kunark,
  //    dropping in Nagafen's Lair) is the shape this line used to defend; it is out of era.
  assert.equal(layeredVerdict(guk, 'Velious'), 'out-of-era')
  assert.equal(layeredVerdict(guk, 'Kunark'), 'out-of-era')
  //    An IN badge over an in-era zone is of course still in-era — the two witnesses agree.
  assert.equal(layeredVerdict(guk, 'Classic'), 'in-era')
  assert.equal(layeredVerdict(['Plane of Hate'], 'Hate'), 'in-era')

  // 2. Zone OUT beats tag IN. Stonebrunt Mountains is a Jan-2001 patch zone the owner observed as
  //    unreachable, and its pages are bannered `{{Classic Era}}`; where you have to go wins.
  assert.equal(layeredVerdict(sleeper, 'Classic'), 'out-of-era')
  assert.equal(layeredVerdict(['Stonebrunt Mountains'], 'Classic'), 'out-of-era')

  // 3. Into silence, the tag decides — BOTH directions.
  assert.equal(layeredVerdict([], 'Classic'), 'in-era')
  assert.equal(layeredVerdict([], 'Velious'), 'out-of-era')
  assert.equal(layeredVerdict(junk, 'Sky'), 'in-era')
  assert.equal(layeredVerdict(junk, 'Luclin'), 'out-of-era')

  // 4. NO TAG leaves silence as silence (law 1) — an absent banner is not a claim.
  for (const tag of [undefined, '']) {
    assert.equal(layeredVerdict([], tag), 'unknown', String(tag))
    assert.equal(layeredVerdict(junk, tag), 'unknown', String(tag))
    assert.equal(layeredVerdict(guk, tag), 'in-era', String(tag))
  }

  // 5. A TAG THE REGISTER DOES NOT NAME reads `out`, because that is what the live page renders:
  //    `#default = out` draws the red box. `Unknown` is the same answer stated explicitly — the
  //    wiki not knowing WHICH era is still the wiki badging the page out of era, and it is only
  //    two pages of the whole corpus. `eraFromTag` keeps its own `null` for these (the expansion
  //    question genuinely has no answer); the register is the one that speaks here.
  for (const tag of ['Unknown', 'Planes of Power']) {
    assert.equal(eraFromTag(tag), null, tag)
    assert.equal(layeredVerdict([], tag), 'out-of-era', tag)
    assert.equal(layeredVerdict(junk, tag), 'out-of-era', tag)
    assert.equal(layeredVerdict(guk, tag), 'out-of-era', tag)
  }

  // 6. With no tag at all, layeredVerdict IS eraVerdict — the layer adds, never alters.
  for (const zones of [guk, sleeper, junk, [], ['Kael Drakkel', 'Lower Guk']]) {
    assert.equal(layeredVerdict(zones, undefined), eraVerdict(zones), JSON.stringify(zones))
  }
})

test('the tag layer moves with CURRENT_ERA too — it is the same rank comparison', () => {
  // Asserted through the `At` form so the day Kunark launches this file stays green unchanged.
  const expected: Record<Era, [string, string]> = {
    classic: ['in-era', 'out-of-era'],
    kunark: ['in-era', 'in-era'],
    velious: ['in-era', 'in-era'],
    luclin: ['in-era', 'in-era']
  }
  for (const era of ERA_ORDER) {
    const [classicTag, kunarkTag] = expected[era]
    assert.equal(layeredVerdictAt([], 'Classic', era), classicTag, `Classic tag @ ${era}`)
    assert.equal(layeredVerdictAt([], 'Kunark', era), kunarkTag, `Kunark tag @ ${era}`)
    // A zone still overrules an IN tag at every ceiling — the classic-bannered Guk item is
    // farmable whatever ceiling we are on.
    assert.equal(layeredVerdictAt(['Lower Guk'], 'Classic', era), 'in-era', `Guk @ ${era}`)
    // But an OUT tag overrules the zone until its own expansion opens. Luclin is the last era
    // this app ranks, so the Guk drop of a Luclin-bannered item is hidden everywhere but there.
    const luclin = era === 'luclin' ? 'in-era' : 'out-of-era'
    assert.equal(layeredVerdictAt(['Lower Guk'], 'Luclin', era), luclin, `Guk/Luclin @ ${era}`)
  }
  // And the shipped wrapper is exactly the CURRENT_ERA case — no second opinion.
  for (const tag of ['Classic', 'Velious', 'Unknown', undefined]) {
    assert.equal(layeredVerdict([], tag), layeredVerdictAt([], tag, CURRENT_ERA), String(tag))
  }
})

// ---- coverage over the real catalog -----------------------------------------------------------

test('the era layer resolves the catalog, by name count AND by mob weight', () => {
  // 192 distinct names / 8,214 links measured 2026-08-04; both floors sit under the measurement
  // with room for a rescrape to add dirt without going red.
  assert.ok(CATALOG_ZONES.size >= 180, `only ${String(CATALOG_ZONES.size)} distinct catalog zones`)

  let names = 0
  let links = 0
  let total = 0
  for (const [zone, count] of CATALOG_ZONES) {
    total += count
    if (zoneEra(zone) === null) continue
    names++
    links += count
  }

  // Measured: 159 of 192 names resolve.
  assert.ok(names >= 140, `only ${String(names)} of ${String(CATALOG_ZONES.size)} catalog zones resolve`)
  // Measured: 8,128 of 8,214 links, 99.0%. The unresolved tail is one-mob junk, so the weighted
  // floor is the number that actually matters to a user staring at the farm rollup.
  assert.ok(total >= 8_000, `only ${String(total)} mob-zone links`)
  const pct = (100 * links) / total
  assert.ok(pct >= 95, `mob-weighted coverage fell to ${pct.toFixed(1)}%`)
})

test('the big rooms resolve, and to the right expansion', () => {
  // The zones that dominate the catalog by mob count — if any of these silently stopped
  // resolving, the coverage floor above would still pass while the feature quietly broke.
  const ANCHORS: readonly (readonly [string, Era])[] = [
    ['Kael Drakkel', 'velious'], // 343 mobs, the largest zone in the catalog
    ['Skyshrine', 'velious'],
    ['Thurgadin', 'velious'],
    ['Temple of Veeshan', 'velious'],
    ['Plane of Mischief', 'velious'], // a VELIOUS plane, not a classic one
    ['Plane of Growth', 'velious'],
    ['Chardok', 'kunark'],
    ['Chardok (Pre-Revamp)', 'kunark'], // the catalog's page-disambiguation suffix folds away
    ['Firiona Vie', 'kunark'],
    ['East Cabilis', 'kunark'],
    ['Lake of Ill Omen', 'kunark'], // 82 mobs; the row this wave added
    ['Old Sebilis', 'kunark'],
    ['South Qeynos', 'classic'],
    ["Ak'Anon", 'classic'],
    ['Greater Faydark', 'classic'],
    ['Plane of Sky', 'classic'], // Fear/Hate/Sky ARE classic
    ['Plane of Fear', 'classic'],
    ['Plane of Hate', 'classic'],
    ['Paineel', 'classic'], // the late-1999 heretic patch, still months before Kunark
    // Jan-2001 patch zones, NOT original 1999 — and owner-observed out-of-era in EQL
    // (Stonebrunt loot surfacing in the planner was the report, 2026-08-04).
    ['Stonebrunt Mountains', 'velious'],
    ['The Warrens', 'velious'],
    ['Qeynos Aqueducts', 'classic'], // alias of Qeynos Catacombs
    ['BBM', 'classic'], // a mobCatalogNames initialism, reached through the reverse index
    ['WFP', 'classic'],
    ['Permafrost', 'classic'],
    ['The Hole', 'classic'],
    ['Runnyeye', 'classic'], // catalog-only short form added with this wave
    ['Dalnir', 'kunark'], // ditto
    ['Northern Karana (35)', 'classic']
  ]
  for (const [zone, era] of ANCHORS) assert.equal(zoneEra(zone), era, zone)
})

// ---- the table's own era invariants -----------------------------------------------------------

test('every era annotation is one of the three, and most of the table carries one', () => {
  let annotated = 0
  for (const entry of ZONES) {
    if (entry.era === undefined) continue
    annotated++
    assert.ok(ERA_ORDER.includes(entry.era), `${entry.short}: bogus era "${entry.era}"`)
  }
  // Measured 2026-08-04: 122 of the table's 128 rows are annotated; the 6 that are not are the
  // EQL-new New Sebilis Expedition plus five Live-EQ hub zones (Bazaar, Nexus, Plane of
  // Knowledge, Guild Lobby, Barter Hall). A floor, so adding rows never breaks this.
  assert.ok(annotated >= 115, `only ${String(annotated)} of ${String(ZONES.length)} rows carry an era`)
})

test('the reverse index has one row per folded spelling — name, alias and catalog name alike', () => {
  // era.ts indexes all THREE naming surfaces (zones.ts itself only indexes name + aliases), so
  // the no-collision guarantee tests/zones.test.mts proves for two surfaces is re-proved here for
  // three. A collision would mean one catalog string silently claiming another zone's era.
  const seen = new Map<string, string>()
  for (const entry of ZONES) {
    for (const spelling of [entry.name, ...(entry.aliases ?? []), ...(entry.mobCatalogNames ?? [])]) {
      const key = zoneKey(spelling)
      assert.notEqual(key, '', `${entry.short}: "${spelling}" folds to nothing`)
      const prior = seen.get(key)
      assert.ok(
        prior === undefined || prior === entry.short,
        `"${spelling}" (${entry.short}) collides with ${String(prior)} on key "${key}"`
      )
      seen.set(key, entry.short)
    }
  }
})

