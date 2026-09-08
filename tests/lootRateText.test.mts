// PURE UNIT TESTS for the loot ledger's rate line
// (src/renderer/src/features/loot/lootRateText.ts, JOS-261).
//
// No DOM, no React, no fixture — so this file never skips. It pins the three things that would look
// exactly like a working caption on screen and be a lie:
//
//   1. BOTH DENOMINATORS ARE NAMED. The whole point of the pair is that the reader can tell which
//      hour each number is standing on. A line that printed two rates and named neither, or that
//      dropped one of them, would answer half of two different reports.
//
//   2. EVERY RATE CARRIES ITS SPAN. One drop in five minutes is a true 12 drops/hr and a very
//      small sample; the span beside it is the only thing on screen that separates the two.
//
//   3. A NULL RATE IS AN EM-DASH, NEVER 0.00 — and it keeps its WORD, so a reader can still see
//      which denominator came up empty rather than watching one silently vanish.
//
// Imported RELATIVELY: node tests run through tsx with no `@shared` alias.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { WindowLootRates } from '../src/shared/lootRates'
import { ELAPSED_TIME_TITLE, LOOT_RATE_TITLE, lootRateText } from '../src/renderer/src/features/loot/lootRateText'

const MIN = 60_000
const HOUR = 60 * MIN

function rates(over: Partial<WindowLootRates> = {}): WindowLootRates {
  return {
    drops: 6,
    events: 6,
    activeMs: HOUR,
    wallMs: 2 * HOUR,
    dropsPerHourActive: 6,
    dropsPerHourWall: 3,
    ...over
  }
}

test('the line states BOTH denominators, each named and each with its own span', () => {
  const text = lootRateText(rates())
  assert.equal(text, '6 drops · 6.00 drops/hr over 1h 0m active · 3.00 drops/hr over 2h 0m elapsed')
})

/** Rule 1, as an assertion about the words rather than about the whole string: neither reading may
 *  be able to pass for the other, which means each one says which hour it divided by. */
test('neither rate can pass for the other — the words `active` and `elapsed` are both present', () => {
  const text = lootRateText(rates()) ?? ''
  assert.ok(text.includes('active'), text)
  assert.ok(text.includes('elapsed'), text)
  assert.ok(!/\d+ drops\/hr(?! over)/.test(text.replace(/-\s+drops\/hr/g, '')), 'no bare "N drops/hr" anywhere')
})

/** Rule 2. A rate that outran its span would be a confident claim about ten minutes of play. */
test('a rate never appears without the span it was measured over', () => {
  const text = lootRateText(rates({ activeMs: 5 * MIN, wallMs: 5 * MIN, dropsPerHourActive: 12, dropsPerHourWall: 12, drops: 1 }))
  // …and ONE drop is a drop, not "1 drops": the count is a sentence, and the span beside the rate
  // is what stops a single pickup from reading as a confident 12 an hour.
  assert.equal(text, '1 drop · 12.0 drops/hr over 5m active · 12.0 drops/hr over 5m elapsed')
})

/** Rule 3, on the active half: no active time is not a measured zero, and the reader still sees
 *  WHICH half is missing. */
test('a null active rate is an em-dash that keeps its word, never 0.00', () => {
  const text = lootRateText(rates({ activeMs: 0, dropsPerHourActive: null })) ?? ''
  assert.ok(text.includes('- drops/hr active'), text)
  assert.ok(!text.includes('0.00 drops/hr active'), text)
  assert.ok(text.includes('3.00 drops/hr over 2h 0m elapsed'), 'and the other half still states itself')
})

/** Rule 3, on the wall half: a window that is entirely a logout has no online wall to divide by. */
test('a null wall rate is an em-dash too — a window that is all logout divides by nothing', () => {
  const text = lootRateText(rates({ wallMs: 0, dropsPerHourWall: null })) ?? ''
  assert.ok(text.includes('- drops/hr elapsed'), text)
  assert.ok(text.includes('6.00 drops/hr over 1h 0m active'))
})

/** A slice you looted nothing in already says so twice above the line; a third sentence full of
 *  zeroes would be noise, so the line is simply absent. */
test('no drops in the window ⇒ no line at all', () => {
  assert.equal(lootRateText(rates({ drops: 0, dropsPerHourActive: 0, dropsPerHourWall: 0 })), null)
})

/** Thousands separate, like every other count in this caption. */
test('the numerator is grouped, like every other count on the ledger', () => {
  const text = lootRateText(rates({ drops: 12_400, dropsPerHourActive: 12_400, dropsPerHourWall: 6_200 })) ?? ''
  assert.ok(text.startsWith('12,400 drops · '), text)
})

/**
 * THE HOVER SENTENCE CARRIES BOTH DEFINITIONS AND THE APP'S ONE SPELLING OF "ACTIVE TIME"
 * (JOS-249). A surface that defined its own denominator in its own words is how two surfaces end
 * up meaning two things by one phrase.
 */
test('the hover sentence defines both denominators, in the app’s one spelling', () => {
  assert.ok(LOOT_RATE_TITLE.includes('Active time = the span shown minus every gap over 5 minutes'))
  assert.ok(LOOT_RATE_TITLE.includes(ELAPSED_TIME_TITLE))
  assert.ok(ELAPSED_TIME_TITLE.includes('logged out'), 'the wall half says what it carves out')
  assert.ok(LOOT_RATE_TITLE.includes('stack sizes'), 'and the numerator says what it counts')
})
