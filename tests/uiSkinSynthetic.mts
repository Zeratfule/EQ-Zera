// A tiny SYNTHETIC stand-in for the game's `uifiles/default`, for the in-game UI skin suites
// (tests/uiSkin.test.mts, tests/e2e/ui-skin.e2e.mts). Generated at test time: no byte of
// Daybreak's skin is committed, and none is needed to exercise the builder's rules.
//
// What it holds, and what each file is for:
//   wnd_bg_dark_rock.tga   whole-texture rule; 8x8 uncompressed 24-bit grey gradient
//   window_pieces01.tga    region rule; 16x16 RLE 32-bit, bottom-left origin. Left half is chrome
//                          (A_CloseBtnNormal: grey + gold, varied alpha), right half is a coin
//                          (A_GoldCoin: art, must stay byte-identical)
//   Spells01.tga           not in any rule; must never be copied
//   EQUI_Animations.xml    the two animations above
//   EQUI_TestWnd.xml       CRLF, a comment inside a colour, a TextColor, an HP FillTint, a dark
//                          TextColor that must stay, and an unknown <Foo> colour that must stay
//   EQUI_ColorPickerWnd.xml colours that ARE content; never copied
//   EQLSUI_Templates.xml   login screen; out of scope, never copied
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodeTga } from '../src/main/uiSkin/tga'

function image(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(px(x, y), (y * w + x) * 4)
  return out
}

export const GOLD: [number, number, number] = [200, 160, 40]
export const COIN: [number, number, number] = [230, 190, 60]

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

const ANIMATIONS_XML = CRLF([
  '<XML ID="EQInterfaceDefinitionLanguage">',
  '\t<Ui2DAnimation item="A_CloseBtnNormal">',
  '\t\t<Frames><Texture>window_pieces01.tga</Texture><Location><X>0</X><Y>0</Y></Location><Size><CX>8</CX><CY>16</CY></Size></Frames>',
  '\t</Ui2DAnimation>',
  '\t<Ui2DAnimation item="A_GoldCoin">',
  '\t\t<Frames><Texture>window_pieces01.tga</Texture><Location><X>8</X><Y>0</Y></Location><Size><CX>8</CX><CY>16</CY></Size></Frames>',
  '\t</Ui2DAnimation>',
  '</XML>'
])

/** Writes the synthetic default skin into `dir` (created if needed); returns `dir`. */
export function writeSyntheticDefaultSkin(dir: string): string {
  mkdirSync(dir, { recursive: true })
  const id = new Uint8Array(0)
  writeFileSync(
    join(dir, 'wnd_bg_dark_rock.tga'),
    encodeTga({
      width: 8,
      height: 8,
      rgba: image(8, 8, (x, y) => [20 + x * 4, 20 + x * 4, 22 + y * 3, 255]),
      format: { imageType: 2, bitsPerPixel: 24, descriptor: 0, id }
    })
  )
  writeFileSync(
    join(dir, 'window_pieces01.tga'),
    encodeTga({ width: 16, height: 16, rgba: syntheticAtlas(), format: { imageType: 10, bitsPerPixel: 32, descriptor: 8, id } })
  )
  writeFileSync(
    join(dir, 'Spells01.tga'),
    encodeTga({ width: 2, height: 2, rgba: image(2, 2, () => [...GOLD, 255]), format: { imageType: 2, bitsPerPixel: 32, descriptor: 8, id } })
  )
  writeFileSync(join(dir, 'EQUI_Animations.xml'), ANIMATIONS_XML, 'latin1')
  writeFileSync(join(dir, 'EQUI_TestWnd.xml'), TEST_WND_XML, 'latin1')
  writeFileSync(join(dir, 'EQUI_ColorPickerWnd.xml'), TEST_WND_XML, 'latin1')
  writeFileSync(join(dir, 'EQLSUI_Templates.xml'), TEST_WND_XML, 'latin1')
  return dir
}
