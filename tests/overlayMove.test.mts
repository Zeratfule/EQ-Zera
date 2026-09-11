// MOVING A STRIP IS A BUTTON (2026-09-10) — the pure halves of it.
//
// The feature is three buttons in Preferences, Overlays, and almost all of it is window lifecycle:
// the Move press, the raise, the temporary open, the push at a webContents. None of that can be
// asserted without Electron, and it is the e2e's subject (tests/e2e/overlayMoveSteps.mts drives all
// three specs). What IS pure, and what would rot silently if nobody pinned it:
//
//   1. WHAT "RESET POSITION" PUTS BACK. Reset writes `defaultOverlayBounds(kind, workArea)` into the
//      store and applies it. The handler is three lines of Electron around that one call, so the
//      claim worth pinning is the call: each strip's default is its own, it is inside the work area,
//      and it is NOT a meter slot (a strip holds none — JOS-406).
//   2. WHAT A PREVIEW SAYS. The three sample payloads are copy the user reads over a running game,
//      and copy is a promise. The con card's sample in particular must name a mob that cannot exist
//      and must state NOTHING about its resists: a preview that printed guidance would be the app
//      inventing a creature (world-model law 1).
//   3. THAT A PREVIEW IS SHORT AND SINGULAR. Six seconds, and one stable id per kind, so pressing
//      Preview twice refreshes the card on screen rather than stacking a second one.
//
// No Electron, no jsdom — the split every card feature in this repo uses.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BANNER_PREVIEW_ID,
  BANNER_PREVIEW_TEXT,
  CON_CARD_PREVIEW_ID,
  CON_CARD_PREVIEW_NAME,
  OVERLAY_PREVIEW_MS,
  TOAST_PREVIEW_ID,
  previewBannerPayload,
  previewConCardPayload,
  previewToastPayload
} from '../src/shared/overlayPreview'
import { introToastPayload } from '../src/shared/toast'
import { validateAlertBannerPayload } from '../src/shared/alertBanner'
import { RESIST_AXES } from '../src/shared/resistTypes'
import { STRIP_KINDS, defaultOverlayBounds, isStripKind } from '../src/main/overlayLayout'
import { OVERLAY_STRIP_KINDS } from '../src/shared/overlayLabels'

/** A plain 1920x1080 work area with a taskbar, which is what most of these installs are on. */
const AREA = { x: 0, y: 0, width: 1920, height: 1040 }

// ---- 1. what Reset position puts back ------------------------------------------------------

test('the three MOVABLE strips are the three the buttons are offered under, in one list', () => {
  // Two lists of the same three kinds already existed (geometry's and the label map's) and this
  // ticket adds three buttons per kind; if they ever disagree, one strip silently loses its row.
  assert.deepEqual([...STRIP_KINDS].sort(), [...OVERLAY_STRIP_KINDS].sort())
  for (const kind of STRIP_KINDS) assert.equal(isStripKind(kind), true, `${kind} is a strip`)
})

test('resetting a strip puts it back at ITS OWN shipped rectangle, inside the work area', () => {
  const seen = new Set<string>()
  for (const kind of STRIP_KINDS) {
    const b = defaultOverlayBounds(kind, AREA)
    // INSIDE THE WORK AREA, whole. This is the claim Reset exists for: a strip dragged onto a
    // monitor that is now unplugged has no way back, and a "default" that landed off the edge
    // would be no way back either.
    assert.ok(b.x >= AREA.x && b.y >= AREA.y, `${kind} starts inside the work area`)
    assert.ok(b.x + b.width <= AREA.x + AREA.width, `${kind} ends inside it horizontally`)
    assert.ok(b.y + b.height <= AREA.y + AREA.height, `${kind} ends inside it vertically`)
    // THREE DIFFERENT PLACES. The toast and the con card share a band at the top and the banner
    // sits a third of the way down; what must never happen is two strips resetting onto each other.
    const key = `${String(b.x)},${String(b.y)}`
    assert.equal(seen.has(key), false, `${kind} resets somewhere no other strip resets to`)
    seen.add(key)
  }
})

test('a strip’s shipped rectangle is horizontally CENTRED, not docked into the meter stack', () => {
  for (const kind of STRIP_KINDS) {
    const b = defaultOverlayBounds(kind, AREA)
    const centre = AREA.x + (AREA.width - b.width) / 2
    assert.ok(Math.abs(b.x - centre) <= 1, `${kind} is centred (x ${String(b.x)} vs ${String(centre)})`)
  }
})

// ---- 2 + 3. what a preview says, and for how long -------------------------------------------

test('a preview holds for six seconds — a glance at a rectangle, not something to dismiss', () => {
  assert.equal(OVERLAY_PREVIEW_MS, 6_000)
  assert.equal(previewToastPayload().durationMs, OVERLAY_PREVIEW_MS)
  assert.equal(previewBannerPayload(1_000).holdMs, OVERLAY_PREVIEW_MS)
  // The con card's clock is the USER's (`autoHideMs`, and zero means never), so its sample has to
  // carry one of its own or a preview could sit there until somebody closed it.
  assert.equal(previewConCardPayload(1_000).holdMs, OVERLAY_PREVIEW_MS)
})

test('each preview has ONE stable id, so pressing Preview twice refreshes rather than stacks', () => {
  const ids = [TOAST_PREVIEW_ID, BANNER_PREVIEW_ID, CON_CARD_PREVIEW_ID]
  assert.equal(new Set(ids).size, 3, 'three kinds, three ids')
  assert.equal(previewToastPayload().id, TOAST_PREVIEW_ID)
  assert.equal(previewBannerPayload(1).id, BANNER_PREVIEW_ID)
  assert.equal(previewConCardPayload(1).id, CON_CARD_PREVIEW_ID)
  // Twice in a row is the same card, exactly (the toast's carries no clock of its own).
  assert.deepEqual(previewToastPayload(), previewToastPayload())
  assert.deepEqual(previewBannerPayload(7), previewBannerPayload(7))
})

test('the celebration preview IS the introduction card, on a preview clock and its own id', () => {
  // Not a fourth piece of copy: the introduction already says what this window is and that it
  // belongs to EQ Zera rather than to EverQuest, and a second wording would be a second answer.
  const intro = introToastPayload()
  const preview = previewToastPayload()
  assert.equal(preview.title, intro.title)
  assert.equal(preview.subtitle, intro.subtitle)
  assert.equal(preview.kind, intro.kind)
  assert.notEqual(preview.id, intro.id, 'never mistaken for the once-per-install introduction')
})

test('the banner preview says what the strip is for, in the place it will say it', () => {
  assert.equal(previewBannerPayload(1).text, BANNER_PREVIEW_TEXT)
  assert.match(BANNER_PREVIEW_TEXT, /^Preview:/, 'labelled, so it is never read as a real alert')
  // It is a legal payload by the SAME validator a real firing goes through, which is what keeps a
  // preview honest: main builds it, but nothing about its shape is special.
  assert.notEqual(validateAlertBannerPayload(previewBannerPayload(1)), null)
})

test('the con card preview names a mob that cannot exist and claims NOTHING about its resists', () => {
  const card = previewConCardPayload(4_000)
  assert.equal(card.name, CON_CARD_PREVIEW_NAME)
  assert.equal(card.zone, 'Preview', 'the identity line is where this card says what it is')
  assert.equal(typeof card.level, 'number')
  // ALL FIVE AXES, ALL EMPTY. "Nothing has been seen" is a statement this wire already has a shape
  // for; five chips carrying invented guidance about a creature that does not exist would not be.
  assert.equal(card.chips.length, RESIST_AXES.length)
  assert.deepEqual(card.chips.map((c) => c.axis), [...RESIST_AXES])
  for (const chip of card.chips) {
    assert.equal(chip.tag, null, `${chip.axis} states no band`)
    assert.equal(chip.fit, null, `${chip.axis} states no estimate`)
    assert.equal(chip.n, 0)
    assert.equal(chip.empirical.total, 0)
  }
  // …and it does NOT print the "your client's spell table could not be read" warning, which would
  // be a claim about this machine rather than a sample.
  assert.equal(card.spellData, true)
  assert.equal(card.ts, 4_000, 'the clock is the caller’s, like every other card on this wire')
})
