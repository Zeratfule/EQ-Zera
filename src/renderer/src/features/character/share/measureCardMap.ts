// character/share/measureCardMap — where the card's gear cells are, at the instant it is published.
//
// THE RENDERER IS THE ONLY SIDE THAT HAS LAYOUT. Main photographs the card by handing a rectangle
// to `capturePage`; it never sees a box inside it, and the share page that draws the photograph
// sees even less. So the hotspots the page overlays (shared/shareCardMap.ts) are measured HERE,
// against the same element and at the same moment as the capture rectangle beside them - a map
// measured a beat earlier would be a map of the card before the reader resized the window.
//
// EVERY NUMBER IS A FRACTION OF THE CARD, never a pixel: see the shared module's header for why.
// And nothing here is trusted downstream - main re-checks all of it (`sanitizeCardMap`), because a
// renderer value is untrusted at the handler whether or not this is today's only caller.

import { MAX_CARD_MAP, type CardMapEntry } from '@shared/shareCardMap'

/** Every gear cell of the card carries this, whatever it holds (share/ShareCardParts.tsx). */
const CELL = '[data-testid^="share-cell-"]'
const CELL_PREFIX = 'share-cell-'

/** …and only a cell with an item in it says so, which is exactly the set the envelope carries. */
const FILLED = '[data-filled="true"]'

/** One cell -> its place on the card, or null when it is empty or has no box to speak of. */
function cellEntry(el: Element, card: DOMRect): CardMapEntry | null {
  const slot = (el.getAttribute('data-testid') ?? '').slice(CELL_PREFIX.length)
  if (slot === '') return null
  // AN EMPTY PLACE IS STILL DRAWN on the card (the armory grid's law) and is NOT in the envelope,
  // so it gets no hotspot: there would be no item for the page to name.
  if (el.querySelector(FILLED) === null) return null
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  return {
    slot,
    x: (box.left - card.left) / card.width,
    y: (box.top - card.top) / card.height,
    w: box.width / card.width,
    h: box.height / card.height
  }
}

/**
 * The filled gear cells inside `root`, as fractions of `root`'s own rectangle - which is the
 * rectangle main photographs, so the fractions are fractions of the published picture.
 */
export function measureCardMap(root: HTMLElement): CardMapEntry[] {
  const out: CardMapEntry[] = []
  const card = root.getBoundingClientRect()
  if (card.width <= 0 || card.height <= 0) return out
  for (const el of root.querySelectorAll(CELL)) {
    if (out.length >= MAX_CARD_MAP) break
    const entry = cellEntry(el, card)
    if (entry !== null) out.push(entry)
  }
  return out
}
