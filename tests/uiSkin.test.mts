// THE IN-GAME UI SKIN GENERATOR (src/main/uiSkin/, docs/plans/eql-ui-skin.md).
//
// Every input here is SYNTHETIC (tests/uiSkinSynthetic.mts): the real default skin is Daybreak's
// and never enters the repo. What is pinned:
//   1. the TGA codec round-trips both encodings the default skin uses (type 2 and type 10 RLE,
//      24 and 32 bit, either origin), and decodes a hand-written RLE stream byte for byte;
//   2. the recolour keeps alpha exactly, leaves masked-out pixels alone, and lands known colours
//      on the palette (gauges HP red / mana cyan / endurance amber; gold text -> accentHi);
//   3. the XML rewrite changes the three numbers of a colour and not one other byte;
//   4. the builder writes only allowed files, only under the output folder, never touches the
//      source, keeps art regions byte-identical, reports staleness, and refuses folders it did not
//      write.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeTga, encodeTga, type TgaImage } from '../src/main/uiSkin/tga'
import { mapXmlColor, recolorPixel, recolorRgba } from '../src/main/uiSkin/recolor'
import { hexToRgb, luma, rgbToHsl, type Rgb } from '../src/main/uiSkin/color'
import { rewriteXmlColors } from '../src/main/uiSkin/xmlColors'
import { buildSkin, removeSkin, skinStatus, SkinBuildError } from '../src/main/uiSkin/build'
import { MANIFEST_FILE, isAllowedOutput } from '../src/main/uiSkin/rules'
import { PALETTE } from '../src/shared/palette'
import { UI_SKIN_DISCLAIMER } from '../src/shared/uiSkinDisclaimer'
import { COIN, GOLD, TEST_WND_XML, syntheticAtlas, writeSyntheticDefaultSkin } from './uiSkinSynthetic.mjs'

function sample(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    // Runs of 5 identical pixels, then noise: both packet kinds appear.
    const v = i % 10 < 5 ? 77 : (i * 37) & 255
    px.set([v, (v * 3) & 255, 255 - v, i % 7 === 0 ? 0 : (i * 11) & 255], i * 4)
  }
  return px
}

function img(imageType: 2 | 10, bpp: 24 | 32, descriptor: number): TgaImage {
  const rgba = sample(13, 9)
  if (bpp === 24) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  return { width: 13, height: 9, rgba, format: { imageType, bitsPerPixel: bpp, descriptor, id: new Uint8Array([1, 2, 3]) } }
}

test('TGA round-trips every encoding the default skin uses', () => {
  for (const [type, bpp, desc] of [
    [2, 24, 0x00],
    [2, 32, 0x08],
    [2, 32, 0x28],
    [10, 32, 0x08],
    [10, 24, 0x20],
    [10, 32, 0x18]
  ] as const) {
    const a = img(type, bpp, desc)
    const bytes = encodeTga(a)
    assert.equal(bytes[2], type)
    assert.equal(bytes[16], bpp)
    assert.equal(bytes[17], desc)
    const b = decodeTga(bytes)
    assert.equal(b.width, a.width)
    assert.equal(b.height, a.height)
    assert.deepEqual(Buffer.from(b.rgba), Buffer.from(a.rgba), `type ${String(type)} ${String(bpp)}bpp desc ${String(desc)}`)
    assert.deepEqual(b.format, a.format)
  }
})

test('RLE is really compressed, and a hand-written RLE stream decodes to the stated pixels', () => {
  const flat: TgaImage = {
    width: 200,
    height: 2,
    rgba: new Uint8Array(200 * 2 * 4).fill(9),
    format: { imageType: 10, bitsPerPixel: 32, descriptor: 0x28, id: new Uint8Array(0) }
  }
  // 200 identical pixels a row = a 128 run + a 72 run: 2 packets x 5 bytes x 2 rows.
  assert.equal(encodeTga(flat).length, 18 + 20)
  // Top-left origin, 3x1, 24-bit: a run of 2 (BGR 1,2,3) then a raw packet of 1 (BGR 4,5,6).
  const hdr = new Uint8Array(18)
  hdr[2] = 10
  hdr[12] = 3
  hdr[14] = 1
  hdr[16] = 24
  hdr[17] = 0x20
  const body = [0x81, 1, 2, 3, 0x00, 4, 5, 6]
  const d = decodeTga(new Uint8Array([...hdr, ...body]))
  assert.deepEqual([...d.rgba], [3, 2, 1, 255, 3, 2, 1, 255, 6, 5, 4, 255])
})

test('the codec refuses what it does not read rather than guessing', () => {
  const hdr = new Uint8Array(18)
  hdr[2] = 1
  hdr[12] = 1
  hdr[14] = 1
  hdr[16] = 8
  assert.throws(() => decodeTga(hdr))
  assert.throws(() => decodeTga(new Uint8Array(5)))
})

test('the recolour keeps alpha exactly and leaves masked-out pixels alone', () => {
  const rgba = syntheticAtlas()
  const before = new Uint8Array(rgba)
  const mask = new Uint8Array(16 * 16)
  for (let y = 0; y < 16; y++) mask.fill(1, y * 16, y * 16 + 8)
  const changed = recolorRgba(rgba, mask)
  assert.ok(changed > 0)
  for (let i = 0; i < 256; i++) {
    assert.equal(rgba[i * 4 + 3], before[i * 4 + 3], `alpha at ${String(i)}`)
    if (mask[i] === 0 || before[i * 4 + 3] === 0) {
      assert.deepEqual([...rgba.subarray(i * 4, i * 4 + 4)], [...before.subarray(i * 4, i * 4 + 4)])
    }
  }
})

function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

test('chrome pixels move hue and keep their luminance: gold -> violet, grey -> navy, red gems stay', () => {
  const violet = rgbToHsl(hexToRgb(PALETTE.accent)).h
  const navy = rgbToHsl(hexToRgb(PALETTE.paper)).h
  const cyan = rgbToHsl(hexToRgb(PALETTE.cyan)).h
  const gold = recolorPixel(GOLD)
  assert.ok(hueDist(rgbToHsl(gold).h, violet) < 8, `gold went to hue ${String(rgbToHsl(gold).h)}`)
  assert.ok(Math.abs(luma(gold) - luma(GOLD)) < 2.5)
  const grey: Rgb = [60, 60, 60]
  const g2 = recolorPixel(grey)
  assert.ok(hueDist(rgbToHsl(g2).h, navy) < 10)
  assert.ok(Math.abs(luma(g2) - luma(grey)) < 2.5)
  const blue: Rgb = [40, 80, 200]
  assert.ok(hueDist(rgbToHsl(recolorPixel(blue)).h, cyan) < 8)
  assert.deepEqual(recolorPixel([200, 20, 20]), [200, 20, 20])
})

test('XML colours land on the palette by role', () => {
  const t = (hex: string): Rgb => hexToRgb(hex)
  assert.deepEqual(mapXmlColor([150, 0, 0], 'gauge'), t(PALETTE.red), 'HP')
  assert.deepEqual(mapXmlColor([220, 0, 0], 'gauge'), t(PALETTE.red), 'group HP')
  assert.deepEqual(mapXmlColor([0, 100, 200], 'gauge'), t(PALETTE.cyan), 'mana')
  assert.deepEqual(mapXmlColor([100, 100, 0], 'gauge'), t(PALETTE.amber), 'endurance')
  assert.deepEqual(mapXmlColor([240, 240, 0], 'gauge'), t(PALETTE.amber), 'group endurance')
  assert.deepEqual(mapXmlColor([170, 0, 170], 'gauge'), t(PALETTE.accent), 'casting')
  assert.deepEqual(mapXmlColor([214, 178, 40], 'text'), t(PALETTE.accentHi), 'gold title text')
  assert.deepEqual(mapXmlColor([255, 255, 0], 'text'), t(PALETTE.accentHi), 'active tab text')
  assert.deepEqual(mapXmlColor([16, 16, 16], 'text'), [16, 16, 16], 'dark text on light buttons stays')
  assert.deepEqual(mapXmlColor([128, 128, 128], 'tint'), [128, 128, 128], 'a neutral tint stays')
  const white = mapXmlColor([240, 240, 240], 'text')
  assert.ok(Math.abs(luma(white) - 240) < 2.5 && white[2] > white[0], 'light text cools toward the app text colour')
})

test('the XML rewrite changes colour numbers and not one other byte', () => {
  const { text, changed } = rewriteXmlColors(TEST_WND_XML)
  assert.equal(changed, 2, 'the white TextColor and the HP FillTint; the dark text and <Foo> stay')
  const strip = (s: string): string =>
    s.replace(/(<[RGB]>)\s*\d+\s*(<\/[RGB]>)/g, '$1#$2')
  assert.equal(strip(text), strip(TEST_WND_XML))
  assert.equal(text.split('\r\n').length, TEST_WND_XML.split('\r\n').length, 'CRLF kept')
  assert.ok(text.includes('<Foo><R>214</R><G>178</G><B>40</B></Foo>'))
  assert.ok(text.includes('<TextColor><R>16</R><G>16</G><B>16</B></TextColor>'))
  const [r, g, b] = hexToRgb(PALETTE.red)
  assert.ok(text.includes(`<R>${String(r)}</R>\r\n\t\t\t<G>${String(g)}</G>\r\n\t\t\t<B>${String(b)}</B>`))
  assert.ok(text.includes('<!-- c_crWhite -->'))
  assert.equal(rewriteXmlColors('<X><Text>no colours</Text></X>').text, '<X><Text>no colours</Text></X>')
})

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of readdirSync(dir)) out[f] = createHash('sha1').update(readFileSync(join(dir, f))).digest('hex')
  return out
}

function scratch(): { root: string; source: string; out: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'eqzera-skin-test-'))
  const source = writeSyntheticDefaultSkin(join(root, 'uifiles', 'default'))
  return { root, source, out: join(root, 'uifiles', 'EQZera'), done: () => rmSync(root, { recursive: true, force: true }) }
}

test('the builder writes only allowed files under the out dir and never touches the source', async () => {
  const s = scratch()
  try {
    const before = hashTree(s.source)
    const progress: number[] = []
    const r = await buildSkin(s.source, s.out, (p) => progress.push(p.done))
    assert.deepEqual(hashTree(s.source), before, 'source unchanged')
    const written = readdirSync(s.out).sort()
    assert.deepEqual(written, ['EQUI_TestWnd.xml', MANIFEST_FILE, 'window_pieces01.tga', 'wnd_bg_dark_rock.tga'].sort())
    for (const f of written) assert.ok(isAllowedOutput(f), f)
    assert.deepEqual(readdirSync(join(s.root, 'uifiles')).sort(), ['EQZera', 'default'], 'nothing written beside it')
    assert.equal(r.textures, 2)
    assert.equal(r.xml, 1)
    assert.ok(progress.length > 0)

    // The coin half of the atlas is art: byte-identical pixels. The chrome half moved, alpha kept.
    const src = decodeTga(readFileSync(join(s.source, 'window_pieces01.tga')))
    const out = decodeTga(readFileSync(join(s.out, 'window_pieces01.tga')))
    assert.deepEqual(out.format, src.format, 'same encoding as the source')
    let chromeMoved = 0
    for (let i = 0; i < 256; i++) {
      const o = i * 4
      assert.equal(out.rgba[o + 3], src.rgba[o + 3])
      if (i % 16 >= 8) assert.deepEqual([...out.rgba.subarray(o, o + 3)], COIN)
      else if (out.rgba[o] !== src.rgba[o] || out.rgba[o + 2] !== src.rgba[o + 2]) chromeMoved++
    }
    assert.ok(chromeMoved > 64, `chrome pixels recoloured: ${String(chromeMoved)}`)
    assert.equal((await skinStatus(s.source, s.out)).state, 'current')
  } finally {
    s.done()
  }
})

test('a game patch to the default skin makes the skin stale, and a rebuild makes it current', async () => {
  const s = scratch()
  try {
    await buildSkin(s.source, s.out)
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(s.source, 'EQUI_TestWnd.xml'), later, later)
    assert.equal((await skinStatus(s.source, s.out)).state, 'stale')
    await buildSkin(s.source, s.out)
    assert.equal((await skinStatus(s.source, s.out)).state, 'current')
    writeFileSync(join(s.source, 'EQUI_NewWnd.xml'), '<XML></XML>')
    assert.equal((await skinStatus(s.source, s.out)).state, 'stale', 'a new window file is a patch too')
  } finally {
    s.done()
  }
})

test('the builder and the remover refuse folders EQ Zera did not write', async () => {
  const s = scratch()
  try {
    // A shipped skin next door: files, no manifest.
    const shipped = join(s.root, 'uifiles', 'default_light')
    mkdirSync(shipped)
    writeFileSync(join(shipped, 'EQUI.xml'), 'theirs')
    await assert.rejects(buildSkin(s.source, shipped), SkinBuildError)
    assert.equal(readFileSync(join(shipped, 'EQUI.xml'), 'utf8'), 'theirs')
    assert.equal((await skinStatus(s.source, shipped)).state, 'foreign')
    assert.equal(await removeSkin(shipped), false)
    assert.ok(existsSync(join(shipped, 'EQUI.xml')))
    // The source itself, or a folder inside it.
    await assert.rejects(buildSkin(s.source, s.source), SkinBuildError)
    await assert.rejects(buildSkin(s.source, join(s.source, 'EQZera')), SkinBuildError)
    // Our own folder: removed whole.
    await buildSkin(s.source, s.out)
    assert.equal(await removeSkin(s.out), true)
    assert.ok(!existsSync(s.out))
    assert.ok(existsSync(join(s.source, 'window_pieces01.tga')))
    assert.equal((await skinStatus(s.source, s.out)).state, 'missing')
    assert.equal((await skinStatus(join(s.root, 'nope'), s.out)).state, 'noSource')
  } finally {
    s.done()
  }
})

test("the owner's notice is verbatim and the card renders it twice (always, and in the first-build confirm)", () => {
  assert.equal(
    UI_SKIN_DISCLAIMER,
    'Use at your own risk. This adds a custom UI skin to your game folder, which Daybreak does not officially support. EQ Zera and its developer are not responsible for any bans, account actions, corrective actions or other consequences that may result.'
  )
  const card = readFileSync(new URL('../src/renderer/src/features/preferences/UiSkinSetting.tsx', import.meta.url), 'utf8')
  assert.equal(card.match(/\{UI_SKIN_DISCLAIMER\}/g)?.length, 2)
  // Main refuses a build before acceptance, so the confirm is not the only gate.
  const ipc = readFileSync(new URL('../src/main/ipc/uiSkin.ts', import.meta.url), 'utf8')
  assert.match(ipc, /if \(!getUiSkinAccepted\(\)\) return \{ ok: false/)
})
