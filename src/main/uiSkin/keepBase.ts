/**
 * Gauges that keep the BASE skin's look exactly (owner, 2026-11-15: "keep the experience and AA
 * experience bars the same as they are in the Default modern").
 *
 * They draw from the same pieces (A_GaugeFill, A_GaugeBackground, ...) as the HP/mana/endurance
 * gauges the skin redraws, so the skin gives them pieces of their own. This is the one structural
 * XML edit the generator makes, and it is minimal and additive:
 *   - inside a kept gauge's <GaugeDrawTemplate>, each piece name `A_X` becomes `EQZBase_A_X`, and
 *     the gauge's colours are left exactly as the base wrote them;
 *   - the skin's copy of EQUI_Animations.xml gains a <TextureInfo> and a <Ui2DAnimation> per renamed
 *     piece, cutting the same rectangle from `EQZBase_<texture>`;
 *   - `EQZBase_<texture>` is a byte-for-byte copy of the base texture, made on the player's machine.
 */
import type { AnimFrame } from './animations'
import { rewriteXmlColors } from './xmlColors'

export const KEEP_PREFIX = 'EQZBase_'

/** EQType 4 is the experience gauge and 5 the AA experience gauge, in every window that has one. */
const KEPT_EQTYPES = new Set(['4', '5'])
const KEPT_NAMES = /ExpGauge|AltAdvGauge/i

const GAUGE = /<Gauge\s+item\s*=\s*"([^"]+)"[\s\S]*?<\/Gauge>/g
const TEMPLATE = /<GaugeDrawTemplate>[\s\S]*?<\/GaugeDrawTemplate>/
const TEMPLATE_PIECE = /<(\w+)>\s*(A_\w+)\s*<\/\1>/g

export function isKeptGauge(item: string, block: string): boolean {
  const eqType = /<EQType>\s*(\d+)\s*<\/EQType>/.exec(block)?.[1]
  return (eqType !== undefined && KEPT_EQTYPES.has(eqType)) || KEPT_NAMES.test(item)
}

export interface KeptRewrite {
  text: string
  /** colour blocks retuned (outside kept gauges) */
  changed: number
  /** base piece names the kept gauges now reach through `EQZBase_` */
  pieces: Set<string>
}

function renameTemplatePieces(block: string, pieces: Set<string>): string {
  return block.replace(TEMPLATE, (tpl) =>
    tpl.replace(TEMPLATE_PIECE, (_m, tag: string, name: string) => {
      pieces.add(name)
      return `<${tag}>${KEEP_PREFIX}${name}</${tag}>`
    })
  )
}

/** Retunes the colours of a window XML, except inside kept gauges, which are pointed at base pieces. */
export function rewriteKeepingGauges(xml: string): KeptRewrite {
  const pieces = new Set<string>()
  let changed = 0
  let out = ''
  let last = 0
  const retune = (seg: string): string => {
    const r = rewriteXmlColors(seg)
    changed += r.changed
    return r.text
  }
  for (const m of xml.matchAll(GAUGE)) {
    const at = m.index
    out += retune(xml.slice(last, at))
    out += isKeptGauge(m[1] ?? '', m[0]) ? renameTemplatePieces(m[0], pieces) : retune(m[0])
    last = at + m[0].length
  }
  out += retune(xml.slice(last))
  return { text: out, changed, pieces }
}

/** The base texture a kept piece is cut from, renamed. */
export function keptTextureName(texture: string): string {
  return `${KEEP_PREFIX}${texture}`
}

/**
 * The block appended to the skin's EQUI_Animations.xml: a TextureInfo per copied texture, then a
 * Ui2DAnimation per kept piece. `nl` is the file's own line ending.
 */
export function keptAnimationsXml(frames: readonly AnimFrame[], sizes: ReadonlyMap<string, { w: number; h: number; name: string }>, nl: string): string {
  const lines: string[] = [`\t<!-- EQ Zera: untouched base pieces for the experience and AA experience gauges -->`]
  for (const [lower, s] of sizes) {
    if (!frames.some((f) => f.texture === lower)) continue
    lines.push(`\t<TextureInfo item="${keptTextureName(s.name)}"><Size><CX>${String(s.w)}</CX><CY>${String(s.h)}</CY></Size></TextureInfo>`)
  }
  for (const f of frames) {
    const tex = sizes.get(f.texture)?.name ?? f.texture
    lines.push(
      `\t<Ui2DAnimation item="${KEEP_PREFIX}${f.name}">`,
      `\t\t<Frames>`,
      `\t\t\t<Texture>${keptTextureName(tex)}</Texture>`,
      `\t\t\t<Location><X>${String(f.x)}</X><Y>${String(f.y)}</Y></Location>`,
      `\t\t\t<Size><CX>${String(f.w)}</CX><CY>${String(f.h)}</CY></Size>`,
      `\t\t\t<Hotspot><X>0</X><Y>0</Y></Hotspot>`,
      `\t\t</Frames>`,
      `\t</Ui2DAnimation>`
    )
  }
  return lines.join(nl) + nl
}

/** Inserts `block` before the file's first Ui2DAnimation (after its TextureInfo list). */
export function insertIntoAnimations(xml: string, block: string): string {
  const at = xml.search(/<Ui2DAnimation\b/)
  if (at < 0) return xml.replace(/<\/XML>\s*$/i, `${block}</XML>`)
  const lineStart = xml.lastIndexOf('\n', at) + 1
  return xml.slice(0, lineStart) + block + xml.slice(lineStart)
}
