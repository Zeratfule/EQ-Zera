/**
 * Rewrites the colour VALUES in an EQ UI XML file and nothing else. A colour is an element named
 * in `XML_COLOR_ROLES` whose body is `<R>n</R><G>n</G><B>n</B>` (an `<Alpha>` and comments may sit
 * in front, whitespace and comments between). Only the three decimal numbers are replaced; every
 * other byte, including line endings and indentation, is reproduced from the match itself. Every
 * <Gauge> element is left exactly as the base wrote it (owner, in game: the base gauges stay).
 */
import type { Rgb } from './color'
import { XML_COLOR_ROLES, type XmlColorRole, mapXmlColor } from './recolor'

/** Whitespace, comments and an optional <Alpha> element. */
const LEAD = String.raw`((?:\s|<!--(?:(?!-->)[\s\S])*-->|<Alpha>\s*\d+\s*</Alpha>)*)`
/** Whitespace and comments. */
const SEP = String.raw`((?:\s|<!--(?:(?!-->)[\s\S])*-->)*)`
const NUM = String.raw`(\s*)(\d{1,3})(\s*)`

const COLOR_BLOCK = new RegExp(
  String.raw`<(\w+)>` + LEAD + `<R>${NUM}</R>` + SEP + `<G>${NUM}</G>` + SEP + `<B>${NUM}</B>`,
  'g'
)

export interface XmlRewrite {
  text: string
  /** How many colour blocks changed value. */
  changed: number
}

export type XmlColorMapper = (c: Rgb, role: XmlColorRole, tag: string) => Rgb

function channel(v: string | undefined): number {
  return Math.min(255, Number(v ?? '0'))
}

function rewriteSegment(text: string, map: XmlColorMapper): XmlRewrite {
  let changed = 0
  const out = text.replace(COLOR_BLOCK, (whole, ...g: (string | undefined)[]) => {
    const [tag = '', lead = '', r1, rv, r2, sepRG = '', g1, gv, g2, sepGB = '', b1, bv, b2] = g
    const role = XML_COLOR_ROLES[tag]
    if (!role) return whole
    const before: Rgb = [channel(rv), channel(gv), channel(bv)]
    const after = map(before, role, tag)
    if (after[0] === before[0] && after[1] === before[1] && after[2] === before[2]) return whole
    changed++
    const n = (pre = '', v: number, post = ''): string => `${pre}${String(v)}${post}`
    return (
      `<${tag}>${lead}<R>${n(r1, after[0], r2)}</R>${sepRG}` +
      `<G>${n(g1, after[1], g2)}</G>${sepGB}<B>${n(b1, after[2], b2)}</B>`
    )
  })
  return { text: out, changed }
}

/** A whole gauge element: its colours (fill, lines, the numbers' text) are the base skin's, always. */
const GAUGE = /<Gauge\b[\s\S]*?<\/Gauge>/g

export function rewriteXmlColors(text: string, map: XmlColorMapper = mapXmlColor): XmlRewrite {
  let changed = 0
  let out = ''
  let last = 0
  const outside = (seg: string): string => {
    const r = rewriteSegment(seg, map)
    changed += r.changed
    return r.text
  }
  for (const m of text.matchAll(GAUGE)) {
    out += outside(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  out += outside(text.slice(last))
  return { text: out, changed }
}
