// shared/shareCardMap.ts — WHERE EACH GEAR CELL SITS ON THE CARD PICTURE.
//
// A published share (share.eqzera.com) shows the card as an IMAGE, and an image has no cells in
// it: the page draws one flat picture and the reader cannot ask what the third box on the second
// row is. The owner's ask (2026-09-09) is that hovering an armour piece on that page names the
// item, which means the page has to know where the boxes ARE — and only the app was ever there
// when the picture was taken.
//
// So a publish that carries a card may also carry this map: one entry per gear cell that was
// DRAWN on it, in FRACTIONS of the picture (0..1, x/y the top-left corner, w/h the size). Fractions
// rather than pixels because the capture's pixel size is the display's business — a 720 CSS px
// card is 1500 device pixels on one machine and 2900 on another (main/ipc/characterShare.ts) — and
// the page scales the picture again on its own. A fraction survives every one of those steps.
//
// THE MEASUREMENT IS THE RENDERER'S AND THE TRUST IS NOBODY'S. Layout only exists in the renderer,
// so that is where the boxes are read (features/character/share/measureCardMap.ts); by the time
// the numbers reach main they are renderer-supplied input like the capture rectangle beside them,
// which is what `sanitizeCardMap` is for. It rebuilds every entry field by field, refuses anything
// that is not a fraction, drops a slot the profile does not actually carry, and never throws.

/** One gear cell's place on the card, as a fraction of the card picture. */
export interface CardMapEntry {
  /** the envelope cell's own slot id (`ear1`, `head`, …) */
  slot: string
  /** the left edge, 0..1 */
  x: number
  /** the top edge, 0..1 */
  y: number
  /** the width, 0..1 */
  w: number
  /** the height, 0..1 */
  h: number
}

/**
 * The most cells a card can state. The armory is twenty-four places and only the filled ones
 * travel, so forty is headroom rather than a limit anything real meets.
 */
export const MAX_CARD_MAP = 40

/**
 * How many raw entries are looked at before the sanitizer stops. The cap above bounds the OUTPUT;
 * this bounds the work, so a caller that sent ten thousand unusable objects costs a fixed amount.
 */
const MAX_SCAN = MAX_CARD_MAP * 4

/**
 * A box that ends one ten-thousandth past the edge is a rounding artefact of `getBoundingClientRect`
 * divided by a card width, not a lie about the picture. It is clamped back to the edge; anything
 * further out is refused.
 */
const OVERSHOOT = 1.0001

/** Four decimals is a quarter of a pixel on a 2400px card, and it keeps the body small. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

/** A fraction of the card, or null. `positive` is the difference between an edge and a size. */
function fraction(v: unknown, positive: boolean): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  if (v > 1) return null
  if (positive ? v <= 0 : v < 0) return null
  return v
}

/** The four numbers of one raw entry, whole and inside the picture, or null. */
function boxOf(r: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
  const x = fraction(r.x, false)
  const y = fraction(r.y, false)
  const w = fraction(r.w, true)
  const h = fraction(r.h, true)
  if (x === null || y === null || w === null || h === null) return null
  if (x + w > OVERSHOOT || y + h > OVERSHOOT) return null
  return { x, y, w, h }
}

/** One untrusted entry -> one this app would publish, or null when it is not a cell on a card. */
function sanitizeEntry(v: unknown, slots: ReadonlySet<string>): CardMapEntry | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const slot = typeof r.slot === 'string' ? r.slot : ''
  // A slot the sanitized profile does not carry is a hotspot over nothing - the page would draw a
  // tooltip for an item that is not in the body it was served.
  if (!slots.has(slot)) return null
  const box = boxOf(r)
  if (box === null) return null
  return {
    slot,
    x: round4(box.x),
    y: round4(box.y),
    w: round4(Math.min(box.w, 1 - box.x)),
    h: round4(Math.min(box.h, 1 - box.y))
  }
}

/**
 * An untrusted card map -> the entries this app will publish beside a card.
 *
 * `slots` is the set of slot ids of the RE-SANITIZED profile, so the map can never name a cell the
 * envelope does not carry. First entry wins a repeated slot (a duplicate is a measurement bug, and
 * a page that got two boxes for one slot would draw the later one over the earlier).
 */
export function sanitizeCardMap(raw: unknown, slots: ReadonlySet<string>): CardMapEntry[] {
  const out: CardMapEntry[] = []
  if (!Array.isArray(raw)) return out
  const seen = new Set<string>()
  for (const one of raw.slice(0, MAX_SCAN)) {
    if (out.length >= MAX_CARD_MAP) break
    const entry = sanitizeEntry(one, slots)
    if (entry === null || seen.has(entry.slot)) continue
    seen.add(entry.slot)
    out.push(entry)
  }
  return out
}
