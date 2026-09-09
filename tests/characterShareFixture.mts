// characterShareFixture.mts — THE REAL CHARACTER, joined the way the handler joins it.
//
// `Primitive_freeport-Inventory.txt` is the committed 295-line `/outputfile inventory` every
// character-sheet test is pinned against (24 cells, 22 worn, one item the wiki titles differently),
// joined here to the committed item DB exactly as `src/main/ipc/characterSheet.ts` joins it — icon,
// `known`, and the base stat block. So a profile built from this is the shape the app actually
// produces, and the string lengths the tests print are real ones rather than a toy's.
//
// It is a MODULE rather than a copy in each spec (the `comboFixtures.mts` precedent) because two
// specs now read it — `characterShare.test.mts` (the envelope) and `characterShareItem.test.mts`
// (what each worn item says) — and a second copy of the join would be a second chance for the two
// halves of one feature to be tested against different characters.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { sheetCells, sumGear, type SheetCellView, type WornItemBlock } from '../src/shared/characterSheet'
import { buildItemDbIndex, itemKey, type ItemDbFile } from '../src/main/itemsDb'
import { buildCharacterShare, type CharacterProfileShare, type ShareScores } from '../src/shared/characterShare'

/** The app version the envelopes under test are stamped with. */
export const APP = '1.5.0'

/** The capture stamp, fixed so every encode in the suite is byte-comparable. */
export const CAPTURED = 1_757_000_000_000

/** A Build-tab reading. All four or none - see characterShare.ts. */
export const SCORES: ShareScores = { tank: 74, dps: 61, heal: 38, solo: 55 }

const dump = parseInventoryDump(
  readFileSync(join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'), 'utf8')
)
const dbIndex = buildItemDbIndex(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'data', 'items.json'), 'utf8')
  ) as ItemDbFile
)

/** `joinCell`'s three contributions, re-done here so these stay Electron-free node tests. */
export const cells: SheetCellView[] = sheetCells(dump).cells.map((cell) => {
  if (!cell.item) return { ...cell, item: null }
  const record = dbIndex.get(itemKey(cell.item.baseName))
  return {
    ...cell,
    item: {
      ...cell.item,
      known: record !== undefined,
      ...(record?.iconId === undefined ? {} : { iconId: record.iconId }),
      // THE BLOCK, BASE - what the v2 body's per-item stats are projected from, and what the
      // totals are summed from. One field, both readings (src/main/ipc/characterSheet.ts).
      ...(record?.stats === undefined ? {} : { block: record.stats })
    }
  }
})

const worn: WornItemBlock[] = []
for (const cell of cells) {
  if (cell.item) worn.push({ tier: cell.item.tier, block: cell.item.block })
}

/** What that gear adds up to, through the same fold the Character tab prints. */
export const totals = sumGear(worn)

/** `null` means "the Build tab had no reading", which is not the same as `undefined` defaulting. */
export function profileOf(scores: ShareScores | null = SCORES): CharacterProfileShare {
  return buildCharacterShare({
    cells,
    totals,
    look: { race: 'DW', sex: 'F', face: 2 },
    classes: ['WAR', 'CLR', 'SHM'],
    name: 'Primitive',
    level: 60,
    scores: scores ?? undefined,
    capturedAt: CAPTURED
  })
}
