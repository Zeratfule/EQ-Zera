/**
 * A side-by-side MOCKUP of the in-game UI: an inventory, a player and a target window with HP /
 * mana / endurance gauges, a hotbar and a chat window, composed from the pieces the skin's XML
 * names (approximate layout), once from the base skin and once from the EQ Zera skin, each looked
 * up the way the client does (the skin's folder, then `default`). Written to local PNGs for the
 * owner's eyes; never committed (half of it is Daybreak's art).
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseAnimationFrames, type AnimFrame } from '../../src/main/uiSkin/animations'
import { readImage, type SkinImage } from '../../src/main/uiSkin/atlas'
import { drawText } from '../../src/main/uiSkin/font5x7'
import { Canvas, type Rgba } from '../../src/main/uiSkin/raster'
import { encodePng } from './png.mjs'

type Rgb3 = readonly [number, number, number]

/** One skin as the client sees it: a list of folders searched in order. */
export class SkinView {
  private files = new Map<string, string>()
  private frames = new Map<string, AnimFrame>()
  private images = new Map<string, SkinImage | null>()
  private xml = new Map<string, string>()

  static async open(dirs: readonly string[]): Promise<SkinView> {
    const v = new SkinView()
    for (const d of [...dirs].reverse()) for (const n of await readdir(d)) v.files.set(n.toLowerCase(), join(d, n))
    for (const [lower, path] of v.files) {
      if (!/^equi.*\.xml$/.test(lower)) continue
      const text = await readFile(path, 'latin1')
      v.xml.set(lower, text)
      for (const f of parseAnimationFrames(text)) if (!v.frames.has(f.name)) v.frames.set(f.name, f)
    }
    for (const f of v.frames.values()) if (!/^(dragitem|spells|gemicons|gdb_)/.test(f.texture)) await v.image(f.texture)
    for (const bg of ['wnd_bg_light_rock.tga', 'scrollbar_gutter.tga']) await v.image(bg)
    return v
  }

  async image(name: string): Promise<SkinImage | null> {
    const lower = name.toLowerCase()
    if (!this.images.has(lower)) {
      const path = this.files.get(lower)
      this.images.set(lower, path ? readImage(lower, await readFile(path)) : null)
    }
    return this.images.get(lower) ?? null
  }

  imageNow(name: string): SkinImage | null {
    return this.images.get(name.toLowerCase()) ?? null
  }

  frame(name: string): AnimFrame | null {
    return this.frames.get(name) ?? null
  }

  /** The RGB a gauge's FillTint names in this skin's XML, by the gauge's item name. */
  fillTint(file: string, item: string): Rgb3 {
    const text = this.xml.get(file.toLowerCase()) ?? ''
    const at = text.indexOf(`"${item}"`)
    const m = /<FillTint>\s*<R>(\d+)<\/R>\s*<G>(\d+)<\/G>\s*<B>(\d+)<\/B>/.exec(text.slice(at))
    return at >= 0 && m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [255, 255, 255]
  }

  /** The first TextColor in a file: what the mockup writes its body text in. */
  textColor(file: string): Rgb3 {
    const m = /<TextColor>\s*<R>(\d+)<\/R>\s*<G>(\d+)<\/G>\s*<B>(\d+)<\/B>/.exec(this.xml.get(file.toLowerCase()) ?? '')
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [240, 240, 240]
  }
}

/** Draws piece `name` stretched (nearest) into the box, optionally multiplied by `tint`. */
function piece(c: Canvas, v: SkinView, name: string, box: { x: number; y: number; w?: number; h?: number; tint?: Rgb3 }): void {
  const f = v.frame(name)
  const img = f ? v.imageNow(f.texture) : null
  if (!f || !img) return
  const w = box.w ?? f.w
  const h = box.h ?? f.h
  const t = box.tint ?? [255, 255, 255]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((f.y + Math.floor((y * f.h) / h)) * img.width + f.x + Math.floor((x * f.w) / w)) * 4
      c.blend(box.x + x, box.y + y, tinted(img.rgba, o, t), 1)
    }
  }
}

function tinted(px: Uint8Array, o: number, t: Rgb3): Rgba {
  return [((px[o] ?? 0) * t[0]) / 255, ((px[o + 1] ?? 0) * t[1]) / 255, ((px[o + 2] ?? 0) * t[2]) / 255, (px[o + 3] ?? 0) / 255]
}

function tile(c: Canvas, img: SkinImage | null, r: { x: number; y: number; w: number; h: number }): void {
  if (!img) return
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const o = (((y % img.height) * img.width) + (x % img.width)) * 4
      c.blend(r.x + x, r.y + y, [img.rgba[o] ?? 0, img.rgba[o + 1] ?? 0, img.rgba[o + 2] ?? 0, (img.rgba[o + 3] ?? 255) / 255], 1)
    }
  }
}

const rgb = (c: Rgb3, a = 1): Rgba => [c[0], c[1], c[2], a]

interface Win {
  x: number
  y: number
  w: number
  h: number
  title: string
}

/** A window drawn from WDT_Def's pieces: background, border, title bar. Returns the client top. */
function windowFrame(c: Canvas, v: SkinView, win: Win, ink: Rgb3): number {
  const { x, y, w, h } = win
  tile(c, v.imageNow('wnd_bg_light_rock.tga'), { x, y, w, h })
  const tl = v.frame('A_BorderFrameTopLeft')
  const lt = v.frame('A_BorderFrameLeftTop')
  const bw = lt?.w ?? 3
  const th = tl?.h ?? 2
  piece(c, v, 'A_WindowTitleLeft', { x: x + bw, y: y + th })
  piece(c, v, 'A_WindowTitleMiddle', { x: x + bw + 13, y: y + th, w: w - bw * 2 - 26 })
  piece(c, v, 'A_WindowTitleRight', { x: x + w - bw - 13, y: y + th })
  drawText(c, win.title, { x: x + bw + 15, y: y + th + 5 }, rgb(ink))
  piece(c, v, 'A_BorderFrameTop', { x, y, w, h: th })
  piece(c, v, 'A_BorderFrameBottom', { x, y: y + h - th, w, h: th })
  piece(c, v, 'A_BorderFrameLeft', { x, y, w: bw, h })
  piece(c, v, 'A_BorderFrameRight', { x: x + w - bw, y, w: bw, h })
  piece(c, v, 'A_BorderFrameTopLeft', { x, y })
  piece(c, v, 'A_BorderFrameLeftTop', { x, y })
  piece(c, v, 'A_CloseBtnNormal', { x: x + w - bw - 15, y: y + th + 2 })
  return y + th + 18
}

function gauge(c: Canvas, v: SkinView, at: { x: number; y: number; w: number; pct: number; tint: Rgb3 }): void {
  piece(c, v, 'A_GaugeBackground', { x: at.x, y: at.y, w: at.w, h: 10 })
  piece(c, v, 'A_GaugeFill', { x: at.x, y: at.y, w: Math.round(at.w * at.pct), h: 10, tint: at.tint })
  piece(c, v, 'A_GaugeLines', { x: at.x, y: at.y, w: at.w, h: 10 })
}

const SLOTS = ['Ear', 'Neck', 'Head', 'Face', 'Chest', 'Arms', 'Wrist', 'Hands', 'Ring', 'Legs', 'Feet', 'Waist', 'Primary', 'Secondary', 'Range', 'Ammo']

function inventory(c: Canvas, v: SkinView, ink: Rgb3): void {
  const top = windowFrame(c, v, { x: 10, y: 10, w: 190, h: 248, title: 'Inventory' }, ink)
  SLOTS.forEach((s, i) => piece(c, v, `A_Inv${s}`, { x: 18 + (i % 4) * 44, y: top + 4 + Math.floor(i / 4) * 44 }))
  piece(c, v, 'A_BtnNormal', { x: 18, y: top + 186, w: 80, h: 22 })
  piece(c, v, 'A_BtnFlyby', { x: 106, y: top + 186, w: 80, h: 22 })
  drawText(c, 'Done', { x: 46, y: top + 194 }, rgb(ink))
  drawText(c, 'Bags', { x: 134, y: top + 194 }, rgb(ink))
}

function player(c: Canvas, v: SkinView, ink: Rgb3): void {
  const top = windowFrame(c, v, { x: 210, y: 10, w: 200, h: 92, title: 'Primitive' }, ink)
  const f = 'EQUI_PlayerWindow.xml'
  const rows: [string, string, number][] = [['HP', 'Player_HP', 0.82], ['MP', 'Player_Mana', 0.56], ['EN', 'Player_Fatigue', 0.34]]
  rows.forEach(([label, item, pct], i) => {
    drawText(c, label, { x: 220, y: top + 4 + i * 18 }, rgb(ink))
    gauge(c, v, { x: 240, y: top + 3 + i * 18, w: 158, pct, tint: v.fillTint(f, item) })
  })
  const tt = windowFrame(c, v, { x: 210, y: 110, w: 200, h: 50, title: 'A gnoll pup' }, ink)
  gauge(c, v, { x: 220, y: tt + 6, w: 178, pct: 0.47, tint: v.fillTint('EQUI_TargetWindow.xml', 'Target_HP') })
}

function hotbar(c: Canvas, v: SkinView, ink: Rgb3): void {
  const top = windowFrame(c, v, { x: 210, y: 168, w: 200, h: 90, title: 'Hotbar' }, ink)
  for (let i = 0; i < 8; i++) {
    const state = i === 2 ? 'Flyby' : i === 5 ? 'Pressed' : 'Normal'
    const x = 216 + (i % 4) * 47
    const y = top + 2 + Math.floor(i / 4) * 34
    piece(c, v, `A_HotButton1${state}`, { x, y, w: 32, h: 32 })
    drawText(c, String(i + 1), { x: x + 3, y: y + 3 }, rgb(ink))
  }
}

const CHAT = ['You hit a gnoll pup for 14 points of damage.', 'A gnoll pup tries to hit YOU, but misses!', 'Primitive begins to cast a spell.', 'You have gained experience!']

function chat(c: Canvas, v: SkinView, ink: Rgb3): void {
  const win = { x: 420, y: 10, w: 300, h: 248, title: 'Main chat' }
  const top = windowFrame(c, v, win, ink)
  CHAT.forEach((line, i) => drawText(c, line.slice(0, 44), { x: 428, y: top + 6 + i * 11 }, rgb(ink)))
  const sx = win.x + win.w - 17
  piece(c, v, 'A_VSBUpNormal', { x: sx, y: top })
  tile(c, v.imageNow('scrollbar_gutter.tga'), { x: sx, y: top + 22, w: 12, h: 160 })
  piece(c, v, 'A_VSBThumbTop', { x: sx, y: top + 60 })
  piece(c, v, 'A_VSBThumbMiddle', { x: sx, y: top + 64, w: 12, h: 30 })
  piece(c, v, 'A_VSBThumbBottom', { x: sx, y: top + 94 })
  piece(c, v, 'A_VSBDownNormal', { x: sx, y: top + 182 })
  piece(c, v, 'A_CheckBoxNormal', { x: 428, y: top + 190 })
  piece(c, v, 'A_CheckBoxPressed', { x: 448, y: top + 190 })
  piece(c, v, 'A_RadioBtnNormal', { x: 470, y: top + 188 })
  piece(c, v, 'A_RadioBtnPressed', { x: 496, y: top + 188 })
}

export const MOCK_W = 730
export const MOCK_H = 268

/** One full mockup of `v` on the game-world-ish dark backdrop. */
export function mockup(v: SkinView): Canvas {
  const c = new Canvas(MOCK_W, MOCK_H)
  for (let i = 0; i < MOCK_W * MOCK_H; i++) c.px.set([34, 40, 36, 255], i * 4)
  const ink = v.textColor('EQUI_ChatWindow.xml')
  inventory(c, v, ink)
  player(c, v, ink)
  hotbar(c, v, ink)
  chat(c, v, ink)
  return c
}

function scaled(c: Canvas, k: number): Canvas {
  const out = new Canvas(c.w * k, c.h * k)
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const s = (Math.floor(y / k) * c.w + Math.floor(x / k)) * 4
      out.px.set(c.px.subarray(s, s + 4), (y * out.w + x) * 4)
    }
  }
  return out
}

async function writeScales(sheet: Canvas, outPrefix: string): Promise<string[]> {
  const paths: string[] = []
  for (const k of [1, 2]) {
    const img = k === 1 ? sheet : scaled(sheet, k)
    const path = k === 1 ? `${outPrefix}-1x.png` : `${outPrefix}.png`
    await writeFile(path, encodePng(img.w, img.h, img.px))
    paths.push(path)
  }
  return paths
}

/** One labelled band per skin, stacked top to bottom; written at 2x (`<prefix>.png`) and 1x. */
export async function writeBands(bands: readonly { label: string; view: SkinView }[], outPrefix: string): Promise<string[]> {
  const bandH = MOCK_H + 22
  const sheet = new Canvas(MOCK_W, bandH * bands.length)
  for (let i = 0; i < sheet.w * sheet.h; i++) sheet.px.set([11, 15, 26, 255], i * 4)
  bands.forEach((b, i) => {
    drawText(sheet, b.label, { x: 10, y: i * bandH + 8 }, i === 0 ? [229, 233, 245, 1] : [196, 181, 253, 1])
    sheet.put(mockup(b.view), 0, i * bandH + 22)
  })
  return writeScales(sheet, outPrefix)
}

/** Base mockup on the left, EQ Zera on the right, captioned; written at 1x and 2x. */
export async function writeMockups(base: SkinView, ours: SkinView, outPrefix: string): Promise<string[]> {
  const sheet = new Canvas(MOCK_W * 2 + 30, MOCK_H + 24)
  for (let i = 0; i < sheet.w * sheet.h; i++) sheet.px.set([11, 15, 26, 255], i * 4)
  drawText(sheet, 'default_modern', { x: 10, y: 8 }, [229, 233, 245, 1])
  drawText(sheet, 'EQ Zera', { x: MOCK_W + 20, y: 8 }, [196, 181, 253, 1])
  sheet.put(mockup(base), 0, 24)
  sheet.put(mockup(ours), MOCK_W + 30, 24)
  const paths: string[] = []
  for (const k of [1, 2]) {
    const img = k === 1 ? sheet : scaled(sheet, k)
    const path = `${outPrefix}-${String(k)}x.png`
    await writeFile(path, encodePng(img.w, img.h, img.px))
    paths.push(path)
  }
  return paths
}
