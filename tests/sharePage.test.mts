// sharePage.test.mts — the share PAGE's v2 surface: rank badges, the openable stat block under
// each item, the character panel, and the v1 body that must keep rendering as it always did.
//
// `renderPage` is a pure function of a sanitized profile, so these tests call it directly and
// never touch the handler; the handler's own suite (shareServer.test.mts) already proves the page
// comes back from GET /s/:id with the right headers, the Open Graph tags and one nonce'd script.
//
// THE PROFILE IS SANITIZED FIRST. The handler renders what it READ BACK from KV, and what it
// stored is the sanitizer's rebuild — which stamps `known: true` onto every cell, a v1 cell
// included. The page must be judged on that shape, not on the builder's; the v1 test below is
// exactly the case that distinction protects.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { sheetCells, sumGear, type SheetCellView, type WornItemBlock } from '../src/shared/characterSheet'
import { buildItemDbIndex, itemKey, type ItemDbFile } from '../src/main/itemsDb'
import {
  buildCharacterShare,
  characterBlock,
  sanitizeCharacterShare,
  type CharacterProfileShare,
  type ShareCell
} from '../src/shared/characterShare'
import { esc, renderPage, splitRank } from '../share-server/src/page'

const CAPTURED = 1_757_000_000_000

// ---- the real character, WITH each item's stat block joined in --------------------------------

const dump = parseInventoryDump(
  readFileSync(join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'), 'utf8')
)
const dbIndex = buildItemDbIndex(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'data', 'items.json'), 'utf8')
  ) as ItemDbFile
)
const cells: SheetCellView[] = sheetCells(dump).cells.map((cell) => {
  if (!cell.item) return { ...cell, item: null }
  const record = dbIndex.get(itemKey(cell.item.baseName))
  return {
    ...cell,
    item: {
      ...cell.item,
      known: record !== undefined,
      ...(record?.iconId === undefined ? {} : { iconId: record.iconId }),
      ...(record?.stats === undefined ? {} : { block: record.stats })
    }
  }
})
const worn: WornItemBlock[] = []
for (const cell of cells) {
  if (cell.item) worn.push({ tier: cell.item.tier, block: dbIndex.get(itemKey(cell.item.baseName))?.stats })
}
const totals = sumGear(worn)

function v2Profile(): CharacterProfileShare {
  return buildCharacterShare({
    cells,
    totals,
    look: { race: 'DW', sex: 'F', face: 2 },
    classes: ['WAR', 'CLR', 'SHM'],
    name: 'Primitive',
    level: 60,
    scores: { tank: 74, dps: 61, heal: 38, solo: 55 },
    capturedAt: CAPTURED
  })
}

const FACTS = ['known', 'base', 'ac', 'hp', 'mana', 'endurance', 'stats', 'effects', 'flags', 'weapon']

/** What every link made before 1.22.0 carries: the same cells minus the item facts, `v: 1`. */
function v1Profile(): CharacterProfileShare {
  const v2 = v2Profile()
  const stripped = v2.cells.map((cell) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(cell)) if (!FACTS.includes(k)) out[k] = v
    return out as unknown as ShareCell
  })
  return { ...v2, v: 1, cells: stripped }
}

/** Through the sanitizer, exactly as the handler would read it back, then onto the page. */
function render(profile: CharacterProfileShare): string {
  const stored = sanitizeCharacterShare(profile)
  assert.ok(stored, 'the fixture sanitizes')
  return renderPage({
    id: 'AbCdEfGhIj',
    profile: stored,
    origin: 'https://share.eqzera.com',
    shareString: 'EQC1-not-a-real-string',
    hasCard: false,
    updatedAt: CAPTURED,
    nonce: 'nonce123'
  })
}

// ---- the rank badge ------------------------------------------------------------------------

test('splitRank: base when sent, the " +N" stripped only when the name really ends in it', () => {
  const cell = (over: Partial<ShareCell>): ShareCell => ({
    slot: 'chest',
    label: 'Chest',
    item: 'Breastplate +3',
    exaltations: [],
    known: true,
    ...over
  })
  assert.deepEqual(splitRank(cell({ base: 'Breastplate', tier: 3 })), { name: 'Breastplate', rank: 3 })
  assert.deepEqual(splitRank(cell({ tier: 3 })), { name: 'Breastplate', rank: 3 }, 'v1: derived from the suffix')
  assert.deepEqual(
    splitRank(cell({ item: 'Breastplate of a Very Long Na', tier: 3 })),
    { name: 'Breastplate of a Very Long Na', rank: 3 },
    'a clamped name that no longer ends in " +3" is shown whole, never cut on a guess'
  )
  assert.deepEqual(splitRank(cell({ item: 'Plain Tunic' })), { name: 'Plain Tunic', rank: undefined })
  assert.deepEqual(splitRank(cell({ item: ' +3', tier: 3 })), { name: ' +3', rank: 3 }, 'never an empty name')
})

// ---- v2 --------------------------------------------------------------------------------------

test('a v2 share renders rank badges, an openable stat block per item, and the character panel', () => {
  const body = v2Profile()
  const html = render(body)

  const first = body.cells[0]!
  assert.equal(first.item, 'Drop of Crystallized Flame +7', 'the fixture is what this test thinks it is')
  assert.ok(html.includes('<span class="item">Drop of Crystallized Flame</span><span class="rank">+7</span>'))
  assert.ok(!html.includes('Drop of Crystallized Flame +7'), 'the verbatim name with its rank is not repeated')

  // Every item opens: the known ones onto their facts, the unknown one onto the honest sentence.
  const unknown = body.cells.filter((c) => !c.known).length
  assert.ok(unknown > 0 && unknown < body.cells.length, 'the fixture has both known and unknown items')
  assert.equal((html.match(/<details class="gear">/g) ?? []).length, body.cells.length)
  assert.equal((html.match(/Not in the item database, so its stats are not counted/g) ?? []).length, unknown)
  assert.ok(html.includes('<ul class="flags"><li>Lore Equipped</li>'), 'flags render as a row')
  assert.ok(html.includes('<span class="k">Intelligence</span><span class="v">+8</span>'), 'a stat line: label, verbatim value')
  assert.ok(html.includes('<span class="k">AC</span><span class="v">8</span>'), 'the core numbers render')
  assert.ok(html.includes('<span class="k">Focus</span>Improved Damage II'), 'an effect renders with its kind')
  assert.ok(html.includes('Open an item to see its stats.'))

  // The character panel says what the gear adds, from characterBlock, with level and classes.
  const block = characterBlock(body)
  assert.ok(html.includes('<h2>Character</h2>'))
  assert.ok(html.includes('<p class="who">Level 60 · WAR / CLR / SHM</p>'))
  assert.ok(html.includes(`AC <strong>${String(block.ac)}</strong>`))
  assert.ok(html.includes(`<span class="k">HP</span><span class="v">+${String(block.hp)}</span>`))
  assert.ok(html.includes('gear totals, not the full sheet'), 'the panel says these are gear totals')
  assert.ok(!html.includes('<h2>Totals</h2>'), 'the old Totals panel is folded into Character')
  assert.ok(html.includes('<h3>Attributes</h3>') && html.includes('<h3>Saves</h3>'))
  assert.ok(html.includes('<h3>Stated</h3>') === body.totals.unsummed.length > 0)
})

test('every v2 string a stranger can write reaches the page escaped, and is still shown', () => {
  const hostile = v2Profile()
  hostile.cells[0] = {
    ...hostile.cells[0]!,
    item: `<img src=x onerror="alert(1)"> +7`,
    base: `<img src=x onerror="alert(1)">`,
    label: '</h1><script>',
    stats: [{ key: 'STR', label: '<b>Strength', value: '<i>+9' }],
    flags: ['<u>Lore'],
    effects: [{ kind: 'focus', name: '<s>Focus', detail: '<em>detail' }],
    weapon: { dmg: 9, delay: 20, skill: '<q>1H Slashing' }
  }
  const html = render(hostile)
  for (const raw of ['<img src=x', '</h1><script>', '<b>Strength', '<i>+9', '<u>Lore', '<s>Focus', '<em>detail', '<q>1H']) {
    assert.ok(!html.includes(raw), `${raw} is escaped`)
    assert.ok(html.includes(esc(raw)), `${raw} is still shown`)
  }
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'the only <script> is ours')
})

// ---- v1 --------------------------------------------------------------------------------------

test('a v1 share still renders: badges from the tier, nothing to open, the character panel from totals', () => {
  const v1 = v1Profile()
  const html = render(v1)
  assert.ok(html.includes('<span class="item">Drop of Crystallized Flame</span><span class="rank">+7</span>'), 'the rank still becomes a badge')
  assert.ok(!html.includes('<details'), 'nothing to open: a v1 cell has no facts')
  assert.ok(!html.includes('Not in the item database, so its stats'), 'and no cell is called unknown')
  assert.ok(!html.includes('Open an item to see its stats.'))
  assert.ok(html.includes('<h2>Character</h2>'), 'the character panel needs only the totals')
  assert.ok(html.includes(`AC <strong>${String(characterBlock(v1).ac)}</strong>`))
  assert.ok(html.includes('<h3>Saves</h3>'))
})
