// THE IN-GAME UI SKIN GENERATOR (src/main/uiSkin/, docs/plans/eql-ui-skin.md).
//
// Every input here is SYNTHETIC (tests/uiSkinSynthetic.mts): the real skins are Daybreak's and
// never enter the repo. What is pinned:
//   1. the TGA and DDS codecs round-trip what the skins use, and refuse what they do not read;
//   2. the piece classifier names the chrome, and the painter draws each piece at exactly the
//      size the XML cuts, in the app's colours, from nothing (no source pixels);
//   3. an atlas keeps art and unreferenced pixels byte-identical and redraws only chrome;
//   4. the XML rewrite changes colour numbers and not one other byte, onto the palette;
//   5. the builder layers default_modern over default, writes only source names under the out
//      folder, inherits only files the base changes, never touches a source, reports staleness,
//      and refuses folders it did not write.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeTga, encodeTga, type TgaImage } from '../src/main/uiSkin/tga'
import { decodeDds } from '../src/main/uiSkin/dds'
import { EMPTY_ALPHA, drawAtlas, drawBackground, meanAlpha, readImage } from '../src/main/uiSkin/atlas'
import { SKIN_STYLES, lookFor } from '../src/main/uiSkin/look'
import { parseAnimationFrames } from '../src/main/uiSkin/animations'
import { classifyPiece } from '../src/main/uiSkin/pieceKinds'
import { paintPiece } from '../src/main/uiSkin/paint'
import { GAUGE_DEEP, mapXmlColor } from '../src/main/uiSkin/recolor'
import { hexToRgb, luma, type Rgb } from '../src/main/uiSkin/color'
import { rewriteXmlColors } from '../src/main/uiSkin/xmlColors'
import { rewriteKeepingGauges } from '../src/main/uiSkin/keepBase'
import { buildSkin, removeSkin, skinStatus, SkinBuildError } from '../src/main/uiSkin/build'
import { MANIFEST_FILE } from '../src/main/uiSkin/rules'
import { PALETTE } from '../src/shared/palette'
import { UI_SKIN_DISCLAIMER } from '../src/shared/uiSkinDisclaimer'
import { COIN, EXPECTED_OUTPUTS, TEST_WND_XML, syntheticAtlas, syntheticDds, writeSyntheticSkins } from './uiSkinSynthetic.mjs'

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

test('TGA round-trips every encoding the skins use', () => {
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
    assert.deepEqual([bytes[2], bytes[16], bytes[17]], [type, bpp, desc])
    const b = decodeTga(bytes)
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
  assert.equal(encodeTga(flat).length, 18 + 20)
  const hdr = new Uint8Array(18)
  hdr[2] = 10
  hdr[12] = 3
  hdr[14] = 1
  hdr[16] = 24
  hdr[17] = 0x20
  const d = decodeTga(new Uint8Array([...hdr, 0x81, 1, 2, 3, 0x00, 4, 5, 6]))
  assert.deepEqual([...d.rgba], [3, 2, 1, 255, 3, 2, 1, 255, 6, 5, 4, 255])
})

test('the uncompressed DDS codec round-trips and refuses compressed files', () => {
  const rgba = sample(5, 3)
  const bytes = syntheticDds(5, 3, rgba)
  assert.equal(bytes.length, 128 + 5 * 3 * 4)
  const back = decodeDds(bytes)
  assert.deepEqual(Buffer.from(back.rgba), Buffer.from(rgba))
  const dxt = new Uint8Array(bytes)
  new DataView(dxt.buffer).setUint32(80, 0x4, true)
  assert.throws(() => decodeDds(dxt))
  assert.equal(readImage('x.dds', dxt), null)
  assert.throws(() => decodeTga(new Uint8Array(5)))
})

test('the classifier names chrome and leaves art and unknown pieces alone', () => {
  assert.deepEqual(classifyPiece('A_BorderFrameTopLeft'), { kind: 'frame', dir: 'TopLeft', variant: 'solid' })
  assert.deepEqual(classifyPiece('A_RoundedFrameLeftTrans'), { kind: 'frame', dir: 'Left', variant: 'trans' })
  assert.deepEqual(classifyPiece('A_InnerFrameTopBlack'), { kind: 'frame', dir: 'Top', variant: 'black' })
  assert.deepEqual(classifyPiece('A_WindowTitleMiddle'), { kind: 'title', dir: 'Middle' })
  assert.deepEqual(classifyPiece('A_BtnPressedFlyby'), { kind: 'button', state: 'pressedFlyby' })
  assert.deepEqual(classifyPiece('A_CloseBtnFlyby'), { kind: 'glyphButton', state: 'flyby', glyph: 'x' })
  assert.deepEqual(classifyPiece('A_ChatCloseH'), { kind: 'glyphButton', state: 'flyby', glyph: 'x' })
  assert.deepEqual(classifyPiece('A_VSBUpNormal'), { kind: 'glyphButton', state: 'normal', glyph: 'up' })
  assert.deepEqual(classifyPiece('A_CheckBoxPressedDisabled_Double'), { kind: 'check', state: 'pressedDisabled' })
  assert.deepEqual(classifyPiece('A_GaugeFill_transparent'), { kind: 'gaugeFill' })
  assert.deepEqual(classifyPiece('A_InvShoulders'), { kind: 'slot', label: 'SHLDR' })
  assert.deepEqual(classifyPiece('A_HotButton7Disabled'), { kind: 'hotslot', state: 'disabled' })
  for (const art of ['A_InventoryBtnNormal', 'A_GoldCoin', 'A_DragItem', 'A_GrabNormal', 'A_EQBtnNormal']) {
    assert.equal(classifyPiece(art), null, art)
  }
})

test('a painted piece is exactly the cut size, drawn in the palette from nothing', () => {
  const accent = hexToRgb(PALETTE.accent)
  const paper = hexToRgb(PALETTE.paper)
  const c = paintPiece({ kind: 'button', state: 'normal' }, { w: 30, h: 14 })
  assert.deepEqual([c.w, c.h], [30, 14])
  const at = (x: number, y: number): number[] => [...c.px.subarray((y * 30 + x) * 4, (y * 30 + x) * 4 + 4)]
  assert.deepEqual(at(15, 7).slice(0, 3), [...paper], 'the face is the app paper')
  assert.ok(at(15, 1)[2]! > paper[2] && at(15, 1)[3]! > 0, 'the edge carries the accent')
  assert.equal(at(0, 0)[3], 0, 'outside the rounded corner is transparent')
  const frame = paintPiece({ kind: 'frame', dir: 'Top', variant: 'solid' }, { w: 4, h: 7 })
  const edge = [...frame.px.subarray((2 * 4 + 1) * 4, (2 * 4 + 1) * 4 + 3)]
  assert.ok(Math.abs(edge[0]! - accent[0]) < 90 && edge[2]! > 150, `a window top edge is accent violet: ${edge.join(',')}`)
})

test('an atlas redraws only its chrome; art and unreferenced pixels stay byte-identical', () => {
  const src = syntheticAtlas()
  src.set([1, 2, 3, 4], (15 * 16 + 0) * 4)
  const image = { width: 16, height: 16, rgba: src, encode: (p: Uint8Array) => p }
  const frames = parseAnimationFrames(
    '<Ui2DAnimation item="A_BtnNormal"><Frames><Texture>a.tga</Texture><Location><X>0</X><Y>0</Y></Location><Size><CX>8</CX><CY>12</CY></Size></Frames></Ui2DAnimation>' +
      '<Ui2DAnimation item="A_GoldCoin"><Frames><Texture>a.tga</Texture><Location><X>8</X><Y>0</Y></Location><Size><CX>8</CX><CY>16</CY></Size></Frames></Ui2DAnimation>'
  )
  const { rgba, drawn } = drawAtlas(image, frames, 'a.tga')
  assert.deepEqual(drawn, ['A_BtnNormal'])
  let moved = 0
  for (let i = 0; i < 256; i++) {
    const x = i % 16
    const y = Math.floor(i / 16)
    const same = Buffer.compare(Buffer.from(rgba.subarray(i * 4, i * 4 + 4)), Buffer.from(src.subarray(i * 4, i * 4 + 4))) === 0
    if (x >= 8 || y >= 12) assert.ok(same, `pixel ${String(x)},${String(y)} outside the button must be untouched`)
    else if (!same) moved++
  }
  assert.ok(moved > 80, `button pixels redrawn: ${String(moved)}`)
  assert.deepEqual([...rgba.subarray((0 * 16 + 12) * 4, (0 * 16 + 12) * 4 + 3)], COIN)
})

test('XML colours land on the palette by role', () => {
  const t = (hex: string): Rgb => hexToRgb(hex)
  assert.deepEqual(mapXmlColor([150, 0, 0], 'gauge'), GAUGE_DEEP.red, 'HP: the deep red, never the pastel token')
  assert.deepEqual(mapXmlColor([0, 100, 200], 'gauge'), GAUGE_DEEP.cyan, 'mana')
  assert.deepEqual(mapXmlColor([100, 100, 0], 'gauge'), GAUGE_DEEP.amber, 'endurance')
  // The client prints white and green numbers over the fill: both must stay readable on it.
  for (const fill of [GAUGE_DEEP.red, GAUGE_DEEP.cyan, GAUGE_DEEP.amber]) assert.ok(contrast([255, 255, 255], fill) >= 3, 'white numbers on the fill')
  assert.deepEqual(mapXmlColor([170, 0, 170], 'gauge'), GAUGE_DEEP.violet, 'casting')
  assert.deepEqual(mapXmlColor([240, 240, 240], 'text'), t(PALETTE.text), 'body text is the app text colour')
  assert.deepEqual(mapXmlColor([214, 178, 40], 'text'), t(PALETTE.accentHi), 'gold headings')
  assert.deepEqual(mapXmlColor([107, 215, 255], 'text'), t(PALETTE.cyan), 'blue links')
  assert.deepEqual(mapXmlColor([16, 16, 16], 'text'), [16, 16, 16], 'dark text stays')
  assert.deepEqual(mapXmlColor([128, 128, 128], 'tint'), [128, 128, 128], 'a neutral tint stays')
  assert.ok(Math.abs(luma(mapXmlColor([120, 120, 120], 'text')) - 120) < 2.5, 'disabled grey keeps its brightness')
})

test('the XML rewrite changes colour numbers and not one other byte', () => {
  const { text, changed } = rewriteXmlColors(TEST_WND_XML)
  assert.equal(changed, 2, 'the white TextColor and the HP FillTint; the dark text and <Foo> stay')
  const strip = (s: string): string => s.replace(/(<[RGB]>)\s*\d+\s*(<\/[RGB]>)/g, '$1#$2')
  assert.equal(strip(text), strip(TEST_WND_XML))
  assert.equal(text.split('\r\n').length, TEST_WND_XML.split('\r\n').length, 'CRLF kept')
  assert.ok(text.includes('<Foo><R>214</R><G>178</G><B>40</B></Foo>'))
  const [r, g, b] = GAUGE_DEEP.red
  assert.ok(text.includes(`<R>${String(r)}</R>\r\n\t\t\t<G>${String(g)}</G>\r\n\t\t\t<B>${String(b)}</B>`))
  assert.ok(text.includes('<!-- c_crWhite -->'))
})

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of readdirSync(dir)) out[f] = createHash('sha1').update(readFileSync(join(dir, f))).digest('hex')
  return out
}

function scratch(): { root: string; src: { base: string; fallback: string }; out: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'eqzera-skin-test-'))
  const src = writeSyntheticSkins(join(root, 'uifiles'))
  return { root, src, out: join(root, 'uifiles', 'EQZera'), done: () => rmSync(root, { recursive: true, force: true }) }
}

test('the builder layers modern over default, writes only what it must, and never touches a source', async () => {
  const s = scratch()
  try {
    const before = [hashTree(s.src.base), hashTree(s.src.fallback)]
    const progress: string[] = []
    const r = await buildSkin(s.src, s.out, { onProgress: (p) => progress.push(p.phase) })
    assert.deepEqual([hashTree(s.src.base), hashTree(s.src.fallback)], before, 'sources unchanged')
    assert.deepEqual(readdirSync(s.out).sort(), [...EXPECTED_OUTPUTS, MANIFEST_FILE].sort())
    assert.deepEqual(readdirSync(join(s.root, 'uifiles')).sort(), ['EQZera', 'default', 'default_modern'])
    assert.deepEqual({ drawn: r.drawn, xml: r.xml, inherited: r.inherited }, { drawn: 3, xml: 1, inherited: 3 })
    assert.ok(progress.includes('done'))
    assert.equal(readFileSync(join(s.out, 'arrow.cur'), 'utf8'), 'modern cursor', 'the base version is inherited')
    const atlas = decodeTga(readFileSync(join(s.out, 'window_pieces01.tga')))
    assert.deepEqual(atlas.format, decodeTga(readFileSync(join(s.src.base, 'window_pieces01.tga'))).format, 'same encoding')
    assert.deepEqual([...atlas.rgba.subarray((5 * 16 + 12) * 4, (5 * 16 + 12) * 4 + 3)], COIN, 'the coin is untouched')
    const bg = decodeTga(readFileSync(join(s.out, 'wnd_bg_light_rock.tga')))
    assert.deepEqual([...bg.rgba.subarray(0, 3)], [0, 0, 0], 'the window background is black')
    const box = decodeDds(readFileSync(join(s.out, 'window_pieces11a.dds'))).rgba
    assert.deepEqual([...box.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 3)], [...hexToRgb(PALETTE.bg)], 'the DDS checkbox face is drawn')
    assert.equal((await skinStatus(s.src, s.out)).state, 'current')
  } finally {
    s.done()
  }
})

test('a game patch to either skin makes the skin stale, and a rebuild makes it current', async () => {
  const s = scratch()
  try {
    await buildSkin(s.src, s.out)
    const later = new Date(Date.now() + 60_000)
    utimesSync(join(s.src.fallback, 'EQUI_TestWnd.xml'), later, later)
    assert.equal((await skinStatus(s.src, s.out)).state, 'stale')
    await buildSkin(s.src, s.out)
    assert.equal((await skinStatus(s.src, s.out)).state, 'current')
    writeFileSync(join(s.src.base, 'EQUI_NewWnd.xml'), '<XML></XML>')
    assert.equal((await skinStatus(s.src, s.out)).state, 'stale', 'a new window file is a patch too')
  } finally {
    s.done()
  }
})

test('the builder and the remover refuse folders EQ Zera did not write', async () => {
  const s = scratch()
  try {
    const shipped = join(s.root, 'uifiles', 'default_light')
    mkdirSync(shipped)
    writeFileSync(join(shipped, 'EQUI.xml'), 'theirs')
    await assert.rejects(buildSkin(s.src, shipped), SkinBuildError)
    assert.equal(readFileSync(join(shipped, 'EQUI.xml'), 'utf8'), 'theirs')
    assert.equal((await skinStatus(s.src, shipped)).state, 'foreign')
    assert.equal(await removeSkin(shipped), false)
    await assert.rejects(buildSkin(s.src, s.src.base), SkinBuildError)
    await assert.rejects(buildSkin(s.src, join(s.src.fallback, 'EQZera')), SkinBuildError)
    await buildSkin(s.src, s.out)
    assert.equal(await removeSkin(s.out), true)
    assert.ok(!existsSync(s.out))
    assert.ok(existsSync(join(s.src.base, 'window_pieces01.tga')))
    assert.equal((await skinStatus(s.src, s.out)).state, 'missing')
    assert.equal((await skinStatus({ base: join(s.root, 'a'), fallback: join(s.root, 'b') }, s.out)).state, 'noSource')
  } finally {
    s.done()
  }
})

test('without default_modern the skin still builds over default alone', async () => {
  const s = scratch()
  try {
    rmSync(s.src.base, { recursive: true })
    const r = await buildSkin(s.src, s.out)
    assert.equal(r.inherited, 0)
    assert.deepEqual(readdirSync(s.out).sort(), ['EQUI_TestWnd.xml', MANIFEST_FILE, 'wnd_bg_light_rock.tga'].sort())
  } finally {
    s.done()
  }
})

/** WCAG relative luminance and contrast ratio. */
function relLum(c: readonly number[]): number {
  const ch = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(c[0]!) + 0.7152 * ch(c[1]!) + 0.0722 * ch(c[2]!)
}
const contrast = (a: readonly number[], b: readonly number[]): number => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

test('window content is black with its alpha kept, so every chat colour reads on it', () => {
  const rgba = new Uint8Array(16 * 4)
  for (let i = 0; i < 16; i++) rgba.set([40 + i, 50, 70, i * 16], i * 4)
  const px = drawBackground({ width: 4, height: 4, rgba, encode: (p: Uint8Array) => p })
  for (let i = 0; i < 16; i++) assert.deepEqual([...px.subarray(i * 4, i * 4 + 4)], [0, 0, 0, i * 16])
  // EQ's chat colours are the player's to choose; the dimmest stock ones still clear 4.5:1 on black.
  for (const c of [hexToRgb(PALETTE.text), [255, 0, 255], [0, 128, 255], [0, 200, 0], [160, 80, 255]]) {
    assert.ok(contrast(c, [0, 0, 0]) >= 4.5, `${c.join(',')} on black`)
  }
})

test('a piece the base skin leaves (almost) empty stays empty: no stray frames on borderless windows', () => {
  const rgba = new Uint8Array(16 * 16 * 4)
  // Left half: an opaque base piece (drawn over). Right half: a transparent frame piece with a
  // faint 1px trace, the way a borderless template's pieces look in default_modern.
  for (let i = 0; i < 256; i++) rgba.set(i % 16 < 8 ? [60, 60, 60, 255] : [200, 200, 200, i % 16 === 15 ? 12 : 0], i * 4)
  const image = { width: 16, height: 16, rgba, encode: (p: Uint8Array) => p }
  const frames = parseAnimationFrames(
    '<Ui2DAnimation item="A_BorderFrameTopLeft"><Frames><Texture>a.tga</Texture><Location><X>0</X><Y>0</Y></Location><Size><CX>8</CX><CY>16</CY></Size></Frames></Ui2DAnimation>' +
      '<Ui2DAnimation item="A_RoundedFrameTopLeftTrans"><Frames><Texture>a.tga</Texture><Location><X>8</X><Y>0</Y></Location><Size><CX>8</CX><CY>16</CY></Size></Frames></Ui2DAnimation>'
  )
  assert.ok(meanAlpha(image, frames[1]!) < EMPTY_ALPHA)
  const { rgba: out, drawn } = drawAtlas(image, frames, 'a.tga', lookFor('ornamental'))
  assert.deepEqual(drawn, ['A_BorderFrameTopLeft'])
  for (let i = 0; i < 256; i++) {
    if (i % 16 >= 8) assert.deepEqual([...out.subarray(i * 4, i * 4 + 4)], [...rgba.subarray(i * 4, i * 4 + 4)], `pixel ${String(i)} untouched`)
  }
})

test('the ornament steps are distinct drawings of the same pieces, at the same sizes', () => {
  const pieces = [
    classifyPiece('A_WindowTitleLeft')!,
    classifyPiece('A_BtnPressed')!,
    classifyPiece('A_HotButton1Normal')!,
    classifyPiece('A_RoundedFrameTopLeft')!
  ]
  for (const p of pieces) {
    const drawn = SKIN_STYLES.map((s) => paintPiece(p, { w: 14, h: 16 }, lookFor(s)))
    for (const c of drawn) assert.deepEqual([c.w, c.h], [14, 16])
    const clean = Buffer.from(drawn[0]!.px)
    const synth = Buffer.from(drawn[3]!.px)
    assert.notDeepEqual(clean, synth, `${p.kind} looks different at the synthwave step`)
  }
})

test('the build records its style, and a different style reads as out of date', async () => {
  const s = scratch()
  try {
    await buildSkin(s.src, s.out, { style: 'subtle' })
    const manifest = JSON.parse(readFileSync(join(s.out, MANIFEST_FILE), 'utf8')) as { style: string }
    assert.equal(manifest.style, 'subtle')
    assert.equal((await skinStatus(s.src, s.out, 'subtle')).state, 'current')
    assert.equal((await skinStatus(s.src, s.out, 'synthwave')).state, 'stale')
  } finally {
    s.done()
  }
})

const PLAYER_XML = [
  '<XML ID="EQInterfaceDefinitionLanguage">',
  '\t<Gauge item="Player_HP">',
  '\t\t<FillTint><R>150</R><G>0</G><B>0</B></FillTint>',
  '\t\t<EQType>1</EQType>',
  '\t\t<GaugeDrawTemplate><Background>A_GoldCoin</Background><Fill>A_BtnNormal</Fill></GaugeDrawTemplate>',
  '\t</Gauge>',
  '\t<Gauge item="PW_ExpGauge">',
  '\t\t<FillTint><R>220</R><G>150</G><B>0</B></FillTint>',
  '\t\t<EQType>4</EQType>',
  '\t\t<GaugeDrawTemplate>',
  '\t\t\t<Fill>A_BtnNormal</Fill>',
  '\t\t</GaugeDrawTemplate>',
  '\t</Gauge>',
  '\t<Gauge item="PW_AltAdvGauge">',
  '\t\t<FillTint><R>0</R><G>100</G><B>200</B></FillTint>',
  '\t\t<EQType>5</EQType>',
  '\t\t<GaugeDrawTemplate><Fill>A_BtnNormal</Fill></GaugeDrawTemplate>',
  '\t</Gauge>',
  '</XML>'
].join('\r\n')

test('experience and AA gauges keep their base colours and are pointed at base pieces; HP is retuned', () => {
  const r = rewriteKeepingGauges(PLAYER_XML)
  assert.deepEqual([...r.pieces], ['A_BtnNormal'])
  assert.equal(r.changed, 1, 'only the HP FillTint changes')
  assert.ok(r.text.includes('<FillTint><R>220</R><G>150</G><B>0</B></FillTint>'), 'exp tint untouched')
  assert.ok(r.text.includes('<FillTint><R>0</R><G>100</G><B>200</B></FillTint>'), 'AA tint untouched')
  assert.ok(r.text.includes('<Fill>EQZBase_A_BtnNormal</Fill>'))
  assert.ok(r.text.includes('<Background>A_GoldCoin</Background><Fill>A_BtnNormal</Fill>'), 'HP keeps the drawn pieces')
  assert.equal(r.text.replace(/EQZBase_/g, '').replace(/<FillTint>[^]*?<\/FillTint>/g, ''), PLAYER_XML.replace(/<FillTint>[^]*?<\/FillTint>/g, ''))
})

test('the build copies the base texture untouched and adds the kept pieces to the skin animations', async () => {
  const s = scratch()
  try {
    writeFileSync(join(s.src.base, 'EQUI_PlayerWindow.xml'), PLAYER_XML, 'latin1')
    const r = await buildSkin(s.src, s.out)
    assert.ok(r.outputs.includes('EQZBase_window_pieces01.tga'))
    assert.ok(readFileSync(join(s.out, 'EQZBase_window_pieces01.tga')).equals(readFileSync(join(s.src.base, 'window_pieces01.tga'))), 'byte-for-byte base copy')
    const anim = readFileSync(join(s.out, 'EQUI_Animations.xml'), 'latin1')
    const base = readFileSync(join(s.src.base, 'EQUI_Animations.xml'), 'latin1')
    assert.ok(anim.includes('<TextureInfo item="EQZBase_window_pieces01.tga"><Size><CX>16</CX><CY>16</CY></Size></TextureInfo>'))
    assert.ok(anim.includes('<Ui2DAnimation item="EQZBase_A_BtnNormal">'))
    const added = anim.length - base.length
    assert.ok(added > 0 && anim.replace(/\t<!-- EQ Zera:[^]*?(?=\t<Ui2DAnimation item = "A_BtnNormal")/, '') === base, 'everything else is the base file')
    const frames = parseAnimationFrames(anim).filter((f) => f.name === 'EQZBase_A_BtnNormal')
    assert.deepEqual(frames, [{ name: 'EQZBase_A_BtnNormal', texture: 'eqzbase_window_pieces01.tga', x: 0, y: 0, w: 8, h: 12 }])
    assert.ok(readFileSync(join(s.out, 'EQUI_PlayerWindow.xml'), 'latin1').includes('<Fill>EQZBase_A_BtnNormal</Fill>'))
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
  const ipc = readFileSync(new URL('../src/main/ipc/uiSkin.ts', import.meta.url), 'utf8')
  assert.match(ipc, /if \(!getUiSkinAccepted\(\)\) return \{ ok: false/)
})
