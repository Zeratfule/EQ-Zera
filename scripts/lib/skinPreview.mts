/**
 * A before/after contact sheet for the generated in-game skin: each row is a default-skin texture
 * (left) beside the EQ Zera version (right), drawn over a dark checkerboard so alpha is visible,
 * then a strip of XML colour swatches (gauges and text) before and after. Written to a local PNG
 * for the owner to look at; never committed (it is made of Daybreak's art).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeTga, type TgaImage } from '../../src/main/uiSkin/tga'
import { mapXmlColor, type XmlColorRole } from '../../src/main/uiSkin/recolor'
import type { Rgb } from '../../src/main/uiSkin/color'
import { encodePng } from './png.mjs'

const ROWS = ['window_pieces01.tga', 'window_pieces03.tga', 'window_pieces05.tga', 'stoneui_pieces03.tga', 'wnd_bg_dark_rock.tga']
const SWATCHES: [Rgb, XmlColorRole][] = [
  [[150, 0, 0], 'gauge'],
  [[0, 100, 200], 'gauge'],
  [[100, 100, 0], 'gauge'],
  [[220, 150, 0], 'gauge'],
  [[170, 0, 170], 'gauge'],
  [[240, 240, 240], 'text'],
  [[214, 178, 40], 'text'],
  [[255, 255, 0], 'text'],
  [[138, 163, 255], 'text'],
  [[120, 120, 120], 'text']
]
const GAP = 12
const SW = 40

/** A swatch-and-blit canvas; `fill` paints one SW-square swatch. */
class Canvas {
  readonly px: Uint8Array
  constructor(readonly w: number, readonly h: number) {
    this.px = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) this.px.set([11, 15, 26, 255], i * 4)
  }
  fill(x: number, y: number, c: Rgb): void {
    for (let j = y; j < y + SW; j++) for (let i = x; i < x + SW; i++) this.px.set([c[0], c[1], c[2], 255], (j * this.w + i) * 4)
  }
  blit(img: TgaImage, x: number, y: number): void {
    for (let j = 0; j < img.height; j++) {
      for (let i = 0; i < img.width; i++) {
        const s = (j * img.width + i) * 4
        const a = (img.rgba[s + 3] ?? 0) / 255
        const bg = ((i >> 3) + (j >> 3)) % 2 ? 40 : 24
        const d = ((y + j) * this.w + x + i) * 4
        for (let c = 0; c < 3; c++) this.px[d + c] = Math.round((img.rgba[s + c] ?? 0) * a + bg * (1 - a))
      }
    }
  }
}

async function load(dir: string, name: string): Promise<TgaImage | null> {
  try {
    return decodeTga(await readFile(join(dir, name)))
  } catch {
    return null
  }
}

export async function renderSkinPreview(sourceDir: string, skinDir: string, outPng: string): Promise<string> {
  const pairs: [TgaImage, TgaImage][] = []
  for (const r of ROWS) {
    const a = await load(sourceDir, r)
    const b = await load(skinDir, r)
    if (a && b) pairs.push([a, b])
  }
  const width = Math.max(...pairs.map(([a]) => a.width * 2 + GAP * 3), SWATCHES.length * (SW + 4) + GAP * 2)
  const height = pairs.reduce((h, [a]) => h + a.height + GAP, GAP) + SW * 2 + GAP * 2
  const cv = new Canvas(width, height)
  let y = GAP
  for (const [a, b] of pairs) {
    cv.blit(a, GAP, y)
    cv.blit(b, GAP * 2 + a.width, y)
    y += a.height + GAP
  }
  SWATCHES.forEach(([c, role], i) => {
    const x = GAP + i * (SW + 4)
    cv.fill(x, y, c)
    cv.fill(x, y + SW + 2, mapXmlColor(c, role))
  })
  await writeFile(outPng, encodePng(cv.w, cv.h, cv.px))
  return outPng
}
