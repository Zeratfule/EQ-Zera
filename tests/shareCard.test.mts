// shareCard.test.mts — the card's three formats. PNG was the only one until 2026-09-09; JPEG and
// WebP were admitted so a full-resolution card fits under the 1 MB cap (share-server/src/env.ts).
// The URL stays `/c/:id.png` for every format: links and unfurls already out there point at it,
// and readers go by Content-Type. shareServer.test.mts owns the rest of the API and is at its line
// cap, so the format matrix lives here with a KV fake of its own (no TTL model needed: nothing
// here reads the clock).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { sheetCells, sumGear, type SheetCellView, type WornItemBlock } from '../src/shared/characterSheet'
import { buildItemDbIndex, itemKey, type ItemDbFile } from '../src/main/itemsDb'
import { buildCharacterShare } from '../src/shared/characterShare'
import { makeEnvelope } from '../src/shared/shareSchema'
import { cardKind, handleRequest } from '../share-server/src/handler'
import { MAX_CARD_BYTES, type Env, type KvLike, type KvPutOptions } from '../share-server/src/env'

const ORIGIN = 'https://share.eqzera.com'

// ---- a small envelope (the fixture the other suites use, without the item blocks) --------------

const dump = parseInventoryDump(
  readFileSync(join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'), 'utf8')
)
const dbIndex = buildItemDbIndex(
  JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'data', 'items.json'), 'utf8')
  ) as ItemDbFile
)
const cells: SheetCellView[] = sheetCells(dump).cells.map((cell) =>
  cell.item ? { ...cell, item: { ...cell.item, known: dbIndex.has(itemKey(cell.item.baseName)) } } : { ...cell, item: null }
)
const worn: WornItemBlock[] = []
for (const cell of cells) {
  if (cell.item) worn.push({ tier: cell.item.tier, block: dbIndex.get(itemKey(cell.item.baseName))?.stats })
}
const envelope = makeEnvelope(
  'character',
  buildCharacterShare({
    cells,
    totals: sumGear(worn),
    look: { race: 'DW', sex: 'F', face: 2 },
    classes: ['WAR'],
    name: 'Primitive',
    level: 60,
    capturedAt: 1_757_000_000_000
  }),
  '1.22.1',
  new Date(1_757_000_000_000)
)

// ---- the bytes ---------------------------------------------------------------------------------

/** A signature plus filler: the service checks the magic, never the pixels. */
function fake(magic: number[], size = 64): Uint8Array {
  const out = new Uint8Array(size)
  out.set(magic)
  return out
}
const PNG = fake([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG = fake([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const WEBP = (() => {
  const out = fake([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00])
  out.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8) // 'WEBPVP8 '
  return out
})()
const GIF = fake([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

// ---- the harness -------------------------------------------------------------------------------

class MemKv implements KvLike {
  readonly map = new Map<string, Uint8Array>()
  get(key: string, type: 'json'): Promise<unknown>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  get(key: string, type: 'text'): Promise<string | null>
  get(key: string, type: 'json' | 'arrayBuffer' | 'text'): Promise<unknown> {
    const v = this.map.get(key)
    if (!v) return Promise.resolve(null)
    if (type === 'arrayBuffer') return Promise.resolve(v.slice().buffer)
    const text = new TextDecoder().decode(v)
    return Promise.resolve(type === 'json' ? JSON.parse(text) : text)
  }
  put(key: string, value: string | ArrayBuffer | ArrayBufferView, _options?: KvPutOptions): Promise<void> {
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    this.map.set(key, bytes.slice())
    return Promise.resolve()
  }
  delete(key: string): Promise<void> {
    this.map.delete(key)
    return Promise.resolve()
  }
}

function harness(): { call: (method: string, path: string, body?: unknown) => Promise<Response> } {
  const env: Env = { SHARES: new MemKv(), PUBLIC_ORIGIN: ORIGIN }
  return {
    call: (method, path, body) =>
      handleRequest(
        new Request(`${ORIGIN}${path}`, {
          method,
          ...(body === undefined
            ? {}
            : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        }),
        env,
        () => 1_757_000_000_000
      )
  }
}

// ---- the tests ---------------------------------------------------------------------------------

test('cardKind reads the three signatures and nothing else', () => {
  assert.equal(cardKind(PNG), 'png')
  assert.equal(cardKind(JPEG), 'jpeg')
  assert.equal(cardKind(WEBP), 'webp')
  assert.equal(cardKind(GIF), null)
  assert.equal(cardKind(new Uint8Array(0)), null)
  assert.equal(cardKind(fake([0x52, 0x49, 0x46, 0x46])), null, 'RIFF alone is not WebP (could be WAV, AVI)')
})

for (const [name, bytes, type] of [
  ['PNG', PNG, 'image/png'],
  ['JPEG', JPEG, 'image/jpeg'],
  ['WebP', WEBP, 'image/webp']
] as const) {
  test(`a ${name} card is stored and served as ${type} under /c/:id.png`, async () => {
    const h = harness()
    const made = await h.call('POST', '/api/v1/shares', { envelope, card: b64(bytes) })
    assert.equal(made.status, 201)
    const { id } = (await made.json()) as { id: string }
    const card = await h.call('GET', `/c/${id}.png`)
    assert.equal(card.status, 200)
    assert.equal(card.headers.get('Content-Type'), type)
    assert.deepEqual(new Uint8Array(await card.arrayBuffer()), bytes)
    const html = await (await h.call('GET', `/s/${id}`)).text()
    assert.ok(html.includes(`<meta property="og:image" content="${ORIGIN}/c/${id}.png">`), 'the unfurl URL is unchanged')
  })
}

test('a GIF is refused as bad-card, and the cap is 1 MB decoded', async () => {
  const h = harness()
  const gif = await h.call('POST', '/api/v1/shares', { envelope, card: b64(GIF) })
  assert.equal(gif.status, 400)
  assert.equal(((await gif.json()) as { error: string }).error, 'bad-card')
  const justUnder = fake([0xff, 0xd8, 0xff], MAX_CARD_BYTES)
  assert.equal((await h.call('POST', '/api/v1/shares', { envelope, card: b64(justUnder) })).status, 201)
  const justOver = fake([0xff, 0xd8, 0xff], MAX_CARD_BYTES + 1)
  const over = await h.call('POST', '/api/v1/shares', { envelope, card: b64(justOver) })
  assert.equal(over.status, 413)
  assert.equal(((await over.json()) as { error: string }).error, 'too-large')
})

test('cardMap rides with the card: sanitized on the way in, returned by /p/:id, drawn on the page', async () => {
  const h = harness()
  const slot = (envelope.body as { cells: { slot: string }[] }).cells[0]!.slot
  const cardMap = [
    { slot, x: 0.1, y: 0.2, w: 0.3, h: 0.04 },
    { slot: 'nope', x: 0.1, y: 0.2, w: 0.3, h: 0.04 }, // not a cell of this envelope
    { slot, x: 1.5, y: 0.2, w: 0.3, h: 0.04 }, // out of range
    { slot, x: 0.1, y: 0.2, w: 0, h: 0.04 }, // no width
    'garbage'
  ]
  const made = await h.call('POST', '/api/v1/shares', { envelope, card: b64(JPEG), cardMap })
  assert.equal(made.status, 201)
  const { id } = (await made.json()) as { id: string }
  const read = (await (await h.call('GET', `/p/${id}`)).json()) as { cardMap?: unknown }
  assert.deepEqual(read.cardMap, [{ slot, x: 0.1, y: 0.2, w: 0.3, h: 0.04 }], 'one entry survives')
  const html = await (await h.call('GET', `/s/${id}`)).text()
  assert.equal((html.match(/<div class="hot hot-/g) ?? []).length, 1)
  assert.ok(html.includes('.hot-0{left:10%;top:20%;width:30%;height:4%}'))

  // Without a card the map is meaningless and is dropped; with a card it replaces the old one.
  const bare = await h.call('POST', '/api/v1/shares', { envelope, cardMap })
  const bareId = ((await bare.json()) as { id: string }).id
  const bareRead = (await (await h.call('GET', `/p/${bareId}`)).json()) as { cardMap?: unknown }
  assert.equal(bareRead.cardMap, undefined)
  const bareHtml = await (await h.call('GET', `/s/${bareId}`)).text()
  assert.ok(!bareHtml.includes('class="hot '))
})

test('a stored card that predates the sniff (raw PNG bytes) still serves as image/png', async () => {
  const kv = new MemKv()
  const env: Env = { SHARES: kv, PUBLIC_ORIGIN: ORIGIN }
  await kv.put('card:OldOne12345', PNG)
  const res = await handleRequest(new Request(`${ORIGIN}/c/OldOne12345.png`), env, () => 1_757_000_000_000)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Type'), 'image/png')
})
