// A tiny SYNTHETIC stand-in for the game's `uifiles/default` and `uifiles/default_modern`, for the
// in-game UI skin suites (tests/uiSkin.test.mts, tests/e2e/ui-skin.e2e.mts). Generated at test
// time: no byte of Daybreak's skins is committed, and none is needed to exercise the builder.
//
// default/ (the client's fallback)
//   wnd_bg_light_rock.tga  a whole-texture rule; 8x8 uncompressed 24-bit "rock"
//   Spells01.tga           in no rule and identical in both skins; never copied
//   EQUI_TestWnd.xml       a window only default carries (CRLF, a comment inside a colour, a
//                          TextColor, an HP FillTint, dark text, an unknown <Foo> colour)
//   EQUI_ColorPickerWnd.xml colours that ARE content; never rewritten
//   EQLSUI_Templates.xml   login screen; out of scope
// default_modern/ (the base the skin inherits)
//   window_pieces01.tga    a chrome atlas, 16x16 RLE 32-bit bottom-left origin: left half is
//                          A_BtnNormal (drawn), right half A_GoldCoin (art, kept), plus a stray
//                          unreferenced pixel block (kept)
//   window_pieces11a.dds   a chrome atlas in uncompressed DDS: A_CheckBoxNormal over 16x16
//   EQUI_Animations.xml    the pieces above
//   Spells01.tga           identical to default's
//   modern_only.tga        only the base carries it; inherited as is
//   arrow.cur              differs from default's; inherited as is
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeDds } from '../src/main/uiSkin/dds'
import { encodeTga } from '../src/main/uiSkin/tga'

function image(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(px(x, y), (y * w + x) * 4)
  return out
}

export const GOLD: [number, number, number] = [200, 160, 40]
export const COIN: [number, number, number] = [230, 190, 60]

/** The modern atlas: a gold-trimmed grey button on the left, a coin on the right. */
export function syntheticAtlas(): Uint8Array {
  return image(16, 16, (x, y) => {
    if (x >= 8) return [...COIN, 255]
    if (y < 4) return [...GOLD, 200]
    return [40 + y * 8, 40 + y * 8, 40 + y * 8, y === 15 ? 0 : 255]
  })
}

const CRLF = (lines: string[]): string => lines.join('\r\n') + '\r\n'

export const TEST_WND_XML = CRLF([
  '<?xml version="1.0" encoding="us-ascii"?>',
  '<XML ID="EQInterfaceDefinitionLanguage">',
  '\t<Gauge item="Player_HP">',
  '\t\t<Text>Hit points</Text>',
  '\t\t<TextColor>',
  '\t\t\t<!-- c_crWhite -->',
  '\t\t\t<R>240</R>',
  '\t\t\t<G>240</G>',
  '\t\t\t<B>240</B>',
  '\t\t</TextColor>',
  '\t\t<FillTint>',
  '\t\t\t<R>150</R>',
  '\t\t\t<G>0</G>',
  '\t\t\t<B>0</B>',
  '\t\t</FillTint>',
  '\t</Gauge>',
  '\t<Label item="Dark">',
  '\t\t<TextColor><R>16</R><G>16</G><B>16</B></TextColor>',
  '\t\t<Foo><R>214</R><G>178</G><B>40</B></Foo>',
  '\t</Label>',
  '</XML>'
])

const frame = (name: string, tex: string, r: [number, number, number, number]): string =>
  `\t<Ui2DAnimation item = "${name}">\r\n\t\t<Frames><Texture>${tex}</Texture><Location><X>${String(r[0])}</X><Y>${String(r[1])}</Y></Location>` +
  `<Size><CX>${String(r[2])}</CX><CY>${String(r[3])}</CY></Size></Frames>\r\n\t</Ui2DAnimation>`

const ANIMATIONS_XML = CRLF([
  '<XML ID="EQInterfaceDefinitionLanguage">',
  frame('A_BtnNormal', 'window_pieces01.tga', [0, 0, 8, 12]),
  frame('A_GoldCoin', 'window_pieces01.tga', [8, 0, 8, 16]),
  frame('A_CheckBoxNormal', 'window_pieces11a.dds', [0, 0, 16, 16]),
  '</XML>'
])

/** A 128-byte A8R8G8B8 DDS header for a w x h image, one mip. */
function ddsHeader(w: number, h: number): Uint8Array {
  const hdr = new Uint8Array(128)
  const dv = new DataView(hdr.buffer)
  dv.setUint32(0, 0x20534444, true)
  dv.setUint32(4, 124, true)
  dv.setUint32(8, 0x100f, true)
  dv.setUint32(12, h, true)
  dv.setUint32(16, w, true)
  dv.setUint32(76, 32, true)
  dv.setUint32(80, 0x41, true)
  dv.setUint32(88, 32, true)
  dv.setUint32(92, 0x00ff0000, true)
  dv.setUint32(96, 0x0000ff00, true)
  dv.setUint32(100, 0x000000ff, true)
  dv.setUint32(104, 0xff000000, true)
  dv.setUint32(108, 0x1000, true)
  return hdr
}

export function syntheticDds(w: number, h: number, rgba: Uint8Array): Uint8Array {
  return encodeDds({ width: w, height: h, rgba, header: ddsHeader(w, h) })
}

const id = new Uint8Array(0)
const spells = (): Uint8Array =>
  encodeTga({ width: 2, height: 2, rgba: image(2, 2, () => [...GOLD, 255]), format: { imageType: 2, bitsPerPixel: 32, descriptor: 8, id } })

function writeDefault(dir: string): void {
  mkdirSync(dir, { recursive: true })
  const rock = image(8, 8, (x, y) => [20 + x * 4, 20 + x * 4, 22 + y * 3, 255])
  writeFileSync(join(dir, 'wnd_bg_light_rock.tga'), encodeTga({ width: 8, height: 8, rgba: rock, format: { imageType: 2, bitsPerPixel: 24, descriptor: 0, id } }))
  writeFileSync(join(dir, 'Spells01.tga'), spells())
  writeFileSync(join(dir, 'arrow.cur'), 'default cursor')
  writeFileSync(join(dir, 'EQUI_TestWnd.xml'), TEST_WND_XML, 'latin1')
  writeFileSync(join(dir, 'EQUI_ColorPickerWnd.xml'), TEST_WND_XML, 'latin1')
  writeFileSync(join(dir, 'EQLSUI_Templates.xml'), TEST_WND_XML, 'latin1')
}

function writeModern(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'window_pieces01.tga'),
    encodeTga({ width: 16, height: 16, rgba: syntheticAtlas(), format: { imageType: 10, bitsPerPixel: 32, descriptor: 8, id } })
  )
  writeFileSync(join(dir, 'window_pieces11a.dds'), syntheticDds(16, 16, image(16, 16, () => [90, 90, 90, 255])))
  writeFileSync(join(dir, 'EQUI_Animations.xml'), ANIMATIONS_XML, 'latin1')
  writeFileSync(join(dir, 'Spells01.tga'), spells())
  writeFileSync(join(dir, 'modern_only.tga'), spells())
  writeFileSync(join(dir, 'arrow.cur'), 'modern cursor')
}

/** Writes `<uifiles>/default` and `<uifiles>/default_modern`; returns the two folders. */
export function writeSyntheticSkins(uifiles: string): { base: string; fallback: string } {
  const fallback = join(uifiles, 'default')
  const base = join(uifiles, 'default_modern')
  writeDefault(fallback)
  writeModern(base)
  return { base, fallback }
}

/** What a build of the synthetic skins writes (manifest excluded), sorted. */
export const EXPECTED_OUTPUTS = [
  'EQUI_Animations.xml',
  'EQUI_TestWnd.xml',
  'arrow.cur',
  'modern_only.tga',
  'window_pieces01.tga',
  'window_pieces11a.dds',
  'wnd_bg_light_rock.tga'
]
