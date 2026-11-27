// `formatTime` is 24-hour 00-23 everywhere: five past midnight is "00:05", never "24:05" (the
// `hour12: false` trap, which lets a locale pick the h24 cycle). A caller's own `hour12` still wins.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTime } from '../src/renderer/src/lib/formatDate'

const MIDNIGHT_05 = new Date(2026, 10, 27, 0, 5, 9).getTime()
const LATE = new Date(2026, 10, 27, 23, 59, 0).getTime()
const HM = { hour: '2-digit', minute: '2-digit' } as const

test('five past midnight is 00:05, never 24:05', () => {
  assert.equal(formatTime(MIDNIGHT_05, HM), '00:05')
  assert.match(formatTime(MIDNIGHT_05), /^00:05:09$/)
})

test('the last minute of the day is 23:59', () => {
  assert.equal(formatTime(LATE, HM), '23:59')
})

test('an explicit hour12 still asks for the 12-hour clock', () => {
  assert.match(formatTime(MIDNIGHT_05, { ...HM, hour12: true }), /^12:05\s?AM$/i)
})

test('an unknown timestamp is empty', () => {
  assert.equal(formatTime(0), '')
})
