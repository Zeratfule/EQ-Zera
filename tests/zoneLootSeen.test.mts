// zoneLootSeen.test.mts — the Zone Loot "Yours" join (src/renderer/src/features/zoneloot/zoneLootSeen.ts)
// admits a loot line stamped with ANY spelling the zone table knows for the picked option.
//
// THE REGRESSION IT PINS (review of the 2026-11-25 zone audit): the picker started naming a zone
// the table carries by the TABLE's name (`North Felwithe`) while the join still compared the log's
// fold to the option's, so a log reading `Northern Felwithe` showed an empty Yours column. Both
// halves run here — the no-progression count path and the `rangeStats` / `windowItemRows` rate path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LootEvent, MobEntry, ProgressionSnap } from '../src/shared/types'
import { zoneOptions } from '../src/renderer/src/features/zoneloot/zoneLoot'
import { zoneLootSeen } from '../src/renderer/src/features/zoneloot/zoneLootSeen'
import { EMPTY_PROGRESSION } from '../src/renderer/src/features/leveling/progressionDelta'
import { zoneEntryFromAnySpelling, zoneKey, zoneSpellingsFor } from '../src/shared/zones'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json' with { type: 'json' }

const REAL: MobEntry[] = (mobsJson as unknown as { mobs: MobEntry[] }).mobs
const OPTIONS = zoneOptions(REAL)

function loot(zone: string): LootEvent[] {
  return [{ ts: 2_000, item: 'Rusty Spear', zone, source: 'a goblin', sourceKind: 'corpse' }]
}

/** One open zone visit named `zone`, so `rangeStats` has that zone's time to divide by. */
function snapIn(zone: string): ProgressionSnap {
  return { ...EMPTY_PROGRESSION, zoneStart: [1_000], zoneEnd: [0], zoneName: [zone], lastTs: 5_000 }
}

function yours(logZone: string, option: string, withProg: boolean): number {
  return zoneLootSeen(loot(logZone), withProg ? snapIn(logZone) : null, option).map.get('rusty spear')?.drops ?? 0
}

test('Northern Felwithe in the log is yours under the North Felwithe option (both paths)', () => {
  assert.equal(yours('Northern Felwithe', 'North Felwithe', false), 1)
  assert.equal(yours('Northern Felwithe', 'North Felwithe', true), 1)
  assert.equal(yours('Temple of Cazic-Thule 4 (Refined)', 'Temple of Cazic-Thule', true), 1)
  assert.equal(yours('The Permafrost Caverns - Solo 3', 'Permafrost Keep', true), 1)
})

test('EVERY option: every spelling the table knows for it counts a loot line as yours', () => {
  let checked = 0
  for (const o of OPTIONS) {
    for (const spelling of [o.zone, ...zoneSpellingsFor(o.zone)]) {
      for (const withProg of [false, true]) {
        assert.equal(yours(spelling, o.zone, withProg), 1, `"${spelling}" under option "${o.zone}" (prog=${String(withProg)})`)
        checked++
      }
    }
  }
  assert.ok(checked >= OPTIONS.length * 2)
})

test('EVERY catalog spelling (the pre-change option labels included) is yours under the option it became', () => {
  const seen = new Set<string>()
  for (const m of REAL) {
    for (const raw of m.zones ?? []) {
      if (raw.trim() === '' || seen.has(raw)) continue
      seen.add(raw)
      const key = zoneKey(zoneEntryFromAnySpelling(raw)?.name ?? raw)
      const opt = OPTIONS.find((o) => o.key === key)
      assert.ok(opt, `no option for "${raw}"`)
      assert.equal(yours(raw, opt.zone, true), 1, `"${raw}" under "${opt.zone}"`)
    }
  }
})

test('a different zone is never yours, and no zone picked counts everything', () => {
  assert.equal(yours('South Felwithe', 'North Felwithe', true), 0)
  assert.equal(yours('Paineel', 'The Ruins of Old Paineel', false), 0)
  assert.equal(yours('Anywhere', '', false), 1)
})
