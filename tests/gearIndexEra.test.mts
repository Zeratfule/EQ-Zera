// LAYER 3 OF THE ERA JOIN, THROUGH THE SHIPPED RENDERER PATH (JOS-333, JOS-341).
//
// `tests/eraDerive.test.mts` proves the rules on hand-written records and
// `tests/plannerEraCorpus.test.mts` sweeps the committed corpus. What neither can see is the
// WIRING: that `buildGearIndex` actually attaches the field to the row, that the renderer's own
// verdict reads it, and that the chip says WHY. This is that seam, asked through `eraChip` and
// `eraHides` — the two functions `gearData` itself calls — over the real 6,814-row index.
//
// SPLIT OUT OF `tests/gearIndex.test.mts` by JOS-341, which pushed that file past the 400-line
// ceiling. Nothing here changed in the move except its home: the setup is four lines, and a
// topic-scoped sweep file is cheaper to read than a 460-line one anyway.
//
// The four rows the owner named are asserted BY NAME, because a census can go green while the one
// item somebody photographed is still wrong.
//
// No Electron, no fixtures, no game directory ⇒ this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import itemsJson from '../src/main/data/items.json'
import type { ItemDbFile } from '../src/main/itemsDb'
import { buildGearIndex } from '../src/main/planner/gearIndex'
// The SHIPPED era join, reached the way the Gear tab reaches it.
import { eraChip, eraHides } from '../src/renderer/src/features/planner/plannerData'

const file = itemsJson as unknown as ItemDbFile
const index = buildGearIndex(file)
const rows = index.rows
const byKey = new Map(rows.map((r) => [r.key, r]))

test('a derived out-of-era row is hidden by the filter and its chip names the edge', () => {
  const bp = byKey.get('dwarven breastplate (enchanted imbued)')
  assert.ok(bp, 'the owner example left the gear index')
  assert.equal(bp.eraTag, undefined, 'its own page states no era — that is what makes it layer 3')
  assert.deepEqual(bp.eraDerived, {
    basis: 'component',
    verdict: 'out-of-era',
    target: 'Small Breastplate Mold',
    detail: 'Epics'
  })

  const chip = eraChip(bp)
  assert.ok(chip, 'a derived out-of-era row must carry a chip')
  assert.equal(chip.unknown, false, 'it is no longer an era? row')
  assert.equal(chip.label, 'out of era', 'the derivation names no expansion, so neither may the chip')
  assert.match(chip.tooltip, /Small Breastplate Mold/, 'the tooltip must name the edge that decided')
  assert.match(chip.tooltip, /out of era \(Epics\)/, 'and say what made that target out of era')
  assert.equal(eraHides(bp, true), true, 'the default era filter must hide it')
  assert.equal(eraHides(bp, false), false, 'and it must still be there with the filter off')

  // THE QUEST EDGE says something different, because it is a different kind of claim: our zone
  // table applied to the quest's start zone, never "the wiki badged it".
  const smb = byKey.get('scaled mystic breastplate')
  assert.ok(smb, 'the second owner example left the gear index')
  assert.equal(smb.eraDerived?.basis, 'quest')
  assert.match(eraChip(smb)?.tooltip ?? '', /Scaled Mystic Armor Quests, a quest that starts in East Cabilis/)
})

test('SILVER FULL BREASTPLATE: the set page the item corpus could not hold now decides it', () => {
  // THE ROW JOS-333 PINNED AS A NAMED REFUSAL, and the reason this ticket exists. Its only
  // out-of-era reference is a link to an armour-SET page, which is not an `{{Itempage}}` and so is
  // nowhere in the item corpus; `scripts/scrape-page-era.ts` asked the wiki's own `eqlmetadata`
  // about it and committed the answer, so the row has a REASON now instead of a shrug. It was
  // already hidden (the era? escalation of 73ad7ec9 hides uncertainty too), and the difference is
  // the whole point: it is hidden for a stated reason the player can go and check.
  const sfb = byKey.get('silver full breastplate')
  assert.ok(sfb, 'the third owner example left the gear index')
  assert.equal(sfb.eraTag, undefined, 'its own page still states no era')
  assert.equal(sfb.eraDerived?.basis, 'page')
  assert.equal(sfb.eraDerived?.target, 'Cultural Tradeskills: Human')
  const chip = eraChip(sfb)
  assert.equal(chip?.unknown, false, 'it is no longer an era? row')
  assert.match(chip?.tooltip ?? '', /Cultural Tradeskills: Human/, 'the tooltip must name the page that decided')
  assert.equal(eraHides(sfb, true), true, 'and the era filter still hides it')
  assert.equal(eraHides(sfb, false), false, 'the filter OFF still shows it, chip and all')
})

test("LIFE'S GUARD: the dropper edge overrules the zone, and the chip names the mob", () => {
  // The owner's fourth example, and the one that made layer 3 able to overrule anything. This row
  // is NOT era?: its page opens `{{Classic Era}}`, its dropper sits under a `Plane of Hate` heading,
  // and the planner offered it as farmable AC 30 loot. The wiki badges the dropper itself out —
  // Agent of Innoruuk is revamp content — and a revamp changes a zone's contents without changing
  // its name, so the mob is the witness (`definitive`, the JOS-298 argument one link further out).
  const guard = byKey.get("life's guard")
  assert.ok(guard, 'the fourth owner example left the gear index')
  assert.equal(guard.eraTag, 'Classic', 'its own page claims Classic — which is what gets overruled')
  assert.deepEqual(guard.eraDerived, {
    basis: 'drop-mob',
    verdict: 'out-of-era',
    definitive: true,
    target: 'Agent of Innoruuk',
    detail: 'Agent of Innoruuk'
  })
  const chip = eraChip(guard)
  assert.equal(chip?.unknown, false)
  assert.match(chip?.tooltip ?? '', /Agent of Innoruuk/, 'the tooltip must name the mob that decided')
  assert.equal(eraHides(guard, true), true, 'the default era filter must hide it now')
  assert.equal(eraHides(guard, false), false, 'and it must still be there with the filter off')
})

test('layer 3 is counted in the build census, and only its ONE definitive edge overrules a row', () => {
  // Re-measured 2026-08-13 after JOS-341: 2,532 rows carry a derivation (was 361). FLOORS.
  assert.ok(index.stats.eraDerivedRows >= 2000, `only ${String(index.stats.eraDerivedRows)} derived rows`)
  assert.equal(index.stats.eraDerivedRows, rows.filter((r) => r.eraDerived !== undefined).length)

  // THE PROPERTY, restated for the two directions layer 3 now has. A row that already had an era
  // claim of its own may carry a derivation ONLY when that derivation is the definitive dropper
  // edge; everything else still speaks into silence alone. And no row may carry a derivation and
  // still read `era?` — a derivation that resolved nothing is `null`, never a third verdict.
  let definitive = 0
  for (const row of rows) {
    const derived = row.eraDerived
    if (derived === undefined) continue
    if (derived.definitive ?? false) {
      definitive++
      assert.equal(derived.basis, 'drop-mob', `${row.name} claims a definitive ${derived.basis} edge`)
    } else {
      assert.equal(row.eraTag, undefined, `${row.name} carries BOTH a banner and a non-definitive derivation`)
    }
    assert.notEqual(eraChip(row)?.unknown, true, `${row.name} derived an edge and still reads era?`)
  }
  assert.ok(definitive >= 1500, `only ${String(definitive)} definitive edges reached the rows`)

  // AND THE IN-ERA DIRECTION IS REAL AND SMALL: 40 rows are shown BECAUSE a page the wiki files as
  // classic content vouches for them. Each one carries no chip at all, which is what in-era means.
  const shown = rows.filter((r) => r.eraDerived?.verdict === 'in-era')
  assert.ok(shown.length >= 30, `only ${String(shown.length)} rows are derived in-era`)
  for (const row of shown) {
    assert.equal(row.eraDerived?.basis, 'page', `${row.name} was derived in-era by a ${String(row.eraDerived?.basis)} edge`)
    assert.equal(eraChip(row), null, `${row.name} is in-era and still wears a chip`)
    assert.equal(eraHides(row, true), false, `${row.name} is in-era and the filter still hides it`)
  }
})
