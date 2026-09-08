// ============================================================================
// refreshDiff.test.mts — the pure diff behind `npm run refresh:data`.
// ============================================================================
//
// WHY THIS SUITE EXISTS. `refresh:data` (ROADMAP §2 step 3) is a release-time
// chore whose real run costs ~527 wiki requests and 10-15 minutes, so its
// interesting logic lives in a pure module (scripts/refreshDiff.mts) that can
// be exercised in milliseconds with hand-made snapshots. Everything below is
// what the runner decides on: which entries moved, and — the load-bearing one
// — whether a re-scrape learned ANYTHING, because when it did not, the runner
// restores the previous `scrapedAt` so the tree stays clean. A false
// `stampOnly` would silently discard a real wiki update.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diffByPage,
  diffKeyed,
  dropEdgeDelta,
  formatDiff,
  stripStamp,
  type DropSource
} from '../scripts/refreshDiff.mjs'

/** An items.json-shaped map: `itemKey(name)` → record. */
const items = (rec: Record<string, unknown>): Record<string, unknown> => rec

test('diffKeyed buckets added, removed, changed and unchanged keys', () => {
  const prev = items({
    'cloak of flames': { page: 'Cloak of Flames', ac: 10 },
    'rusty dagger': { page: 'Rusty Dagger' },
    'gone item': { page: 'Gone Item' }
  })
  const next = items({
    'cloak of flames': { page: 'Cloak of Flames', ac: 12 },
    'rusty dagger': { page: 'Rusty Dagger' },
    'new item': { page: 'New Item' }
  })
  const d = diffKeyed(prev, next, { ignoreKeys: [] })
  assert.deepEqual(d.added, ['new item'])
  assert.deepEqual(d.removed, ['gone item'])
  assert.deepEqual(d.changed, ['cloak of flames'])
  assert.equal(d.unchanged, 1)
  assert.equal(d.stampOnly, false)
})

test('diffKeyed ignores scrapedAt by default, so a whole file object can be passed', () => {
  const prev = { scrapedAt: '2026-08-22T00:00:00.000Z', source: 'eqlwiki.com', count: 2 }
  const next = { scrapedAt: '2026-09-07T00:00:00.000Z', source: 'eqlwiki.com', count: 2 }
  const d = diffKeyed(prev, next)
  assert.deepEqual([d.added, d.removed, d.changed], [[], [], []])
  assert.equal(d.unchanged, 2)
  assert.equal(d.stampOnly, true, 'only the stamp differs')
})

test('stampOnly is false as soon as one entry actually changed', () => {
  const prev = { scrapedAt: 'a', items: { x: 1 } }
  const next = { scrapedAt: 'b', items: { x: 2 } }
  assert.equal(diffKeyed(prev, next).stampOnly, false)
})

test('a null previous snapshot makes everything added and is never stamp-only', () => {
  const d = diffKeyed(null, items({ b: { page: 'B' }, a: { page: 'A' } }), { ignoreKeys: [] })
  assert.deepEqual(d.added, ['a', 'b'], 'sorted, so the report reads the same every run')
  assert.deepEqual(d.removed, [])
  assert.deepEqual(d.changed, [])
  assert.equal(d.unchanged, 0)
  assert.equal(d.stampOnly, false)
})

test('diffByPage keys mobs/quests arrays by their wiki page title', () => {
  const prev = [
    { page: 'Aqua Goblin', drops: ['Fish Scales'] },
    { page: 'Befallen Guard', drops: ['Rusty Sword'] },
    { page: 'Deleted Mob' }
  ]
  const next = [
    { page: 'Aqua Goblin', drops: ['Fish Scales'] },
    { page: 'Befallen Guard', drops: ['Rusty Sword', 'Bone Chips'] },
    { page: 'New Mob', drops: [] }
  ]
  const d = diffByPage(prev, next)
  assert.deepEqual(d.added, ['New Mob'])
  assert.deepEqual(d.removed, ['Deleted Mob'])
  assert.deepEqual(d.changed, ['Befallen Guard'])
  assert.equal(d.unchanged, 1)
  assert.equal(d.stampOnly, false)
})

test('diffByPage reports stampOnly when the entry arrays are identical', () => {
  const rows = [{ page: 'A' }, { page: 'B' }]
  const d = diffByPage(rows, [{ page: 'A' }, { page: 'B' }])
  assert.equal(d.stampOnly, true)
  assert.equal(d.unchanged, 2)
})

test('diffByPage with no previous file makes every page added', () => {
  const d = diffByPage(null, [{ page: 'B' }, { page: 'A' }])
  assert.deepEqual(d.added, ['A', 'B'])
  assert.equal(d.stampOnly, false)
})

test('stripStamp returns the payload without scrapedAt and leaves the input alone', () => {
  const file = { scrapedAt: '2026-08-22T00:00:00.000Z', source: 'eqlwiki.com', quests: [] }
  const bare = stripStamp(file)
  assert.equal('scrapedAt' in bare, false)
  assert.deepEqual(bare, { source: 'eqlwiki.com', quests: [] })
  assert.equal(file.scrapedAt, '2026-08-22T00:00:00.000Z', 'not mutated')
})

test('dropEdgeDelta counts mob-to-item edges, not mobs', () => {
  const prev: DropSource[] = [
    { page: 'Aqua Goblin', drops: ['Fish Scales', 'Water Flask'] },
    { page: 'Befallen Guard', drops: ['Rusty Sword'] },
    { page: 'No Loot Mob' }
  ]
  const next: DropSource[] = [
    { page: 'Aqua Goblin', drops: ['Fish Scales'] },
    { page: 'Befallen Guard', drops: ['Rusty Sword', 'Bone Chips'] },
    { page: 'New Mob', drops: ['Gold Ring'] }
  ]
  // gained: Befallen Guard→Bone Chips, New Mob→Gold Ring. lost: Aqua Goblin→Water Flask.
  assert.deepEqual(dropEdgeDelta(prev, next), { added: 2, removed: 1 })
})

test('dropEdgeDelta with no previous catalog counts every edge as added', () => {
  const next: DropSource[] = [{ page: 'A', drops: ['x', 'y'] }, { page: 'B', drops: ['z'] }]
  assert.deepEqual(dropEdgeDelta(null, next), { added: 3, removed: 0 })
})

test('dropEdgeDelta is 0/0 when only a level or zone moved', () => {
  const prev: DropSource[] = [{ page: 'A', drops: ['x'] }]
  const next: DropSource[] = [{ page: 'A', drops: ['x'] }]
  assert.deepEqual(dropEdgeDelta(prev, next), { added: 0, removed: 0 })
})

test('formatDiff caps each bucket and says how many it elided', () => {
  const names = Array.from({ length: 14 }, (_, i) => `item-${String(i).padStart(2, '0')}`)
  const text = formatDiff('items', {
    added: names,
    removed: [],
    changed: ['changed-one'],
    unchanged: 11_000,
    stampOnly: false
  })
  const lines = text.split('\n')
  assert.match(lines[0], /^items: 14 added, 0 removed, 1 changed, 11000 unchanged$/)
  assert.equal(lines.filter((l) => l.startsWith('  + ')).length, 10, 'default cap is 10')
  assert.ok(lines.includes('    +4 more'), text)
  assert.ok(lines.includes('  ~ changed-one'), text)
})

test('formatDiff honours an explicit cap', () => {
  const text = formatDiff(
    'mobs',
    { added: ['a', 'b', 'c'], removed: [], changed: [], unchanged: 0, stampOnly: false },
    2
  )
  assert.equal(text.split('\n').filter((l) => l.startsWith('  + ')).length, 2)
  assert.ok(text.includes('    +1 more'), text)
})

test('a stamp-only diff prints exactly one unchanged line', () => {
  const text = formatDiff('quests', {
    added: [],
    removed: [],
    changed: [],
    unchanged: 1_234,
    stampOnly: true
  })
  assert.equal(text.split('\n').length, 1)
  assert.equal(text, 'quests: unchanged (1234 entries, payload identical)')
})
