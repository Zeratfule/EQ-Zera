// The celebration toast's QUEUE + HOVER-PIN semantics (docs/plans/celebration-toasts.md T8).
//
// Every timing rule the toast has is a pure reducer over an explicit `dtMs`
// (src/renderer/src/overlay/toastQueue.ts), which is what lets this file assert them in
// milliseconds instead of by watching a window: no DOM, no timers, no Electron, never skips.
//
// The rules under test, stated as the product states them:
//   * a card holds for its own duration, then plays a 300 ms exit and is gone;
//   * pointing at a card PAUSES that card — and only that card;
//   * leaving a card resumes it with a ~1.5 s grace, so it never vanishes under your pointer;
//   * three cards is the cap, and a fourth evicts the OLDEST, never the newest;
//   * arrival order is render order (newest underneath);
//   * a repeat id refreshes the card on screen instead of stacking a duplicate.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TOAST_CAP,
  TOAST_EXIT_MS,
  TOAST_GRACE_MS,
  toastReduce,
  type ToastCardState
} from '../src/renderer/src/overlay/toastQueue'
import type { ToastPayload } from '../src/shared/toast'

function payload(id: string, durationMs = 6000): ToastPayload {
  return { id, kind: 'bossKill', title: `${id} defeated`, durationMs }
}

const show = (s: ToastCardState[], p: ToastPayload): ToastCardState[] => toastReduce(s, { type: 'show', payload: p })
const tick = (s: ToastCardState[], dtMs: number): ToastCardState[] => toastReduce(s, { type: 'tick', dtMs })
const hover = (s: ToastCardState[], id: string, over: boolean): ToastCardState[] =>
  toastReduce(s, { type: 'hover', id, over })

/** Advance in 100 ms steps, the way the component's one interval does. */
function run(s: ToastCardState[], ms: number): ToastCardState[] {
  let out = s
  for (let t = 0; t < ms; t += 100) out = tick(out, 100)
  return out
}

const ids = (s: ToastCardState[]): string[] => s.map((c) => c.payload.id)

test('a card holds for its duration, then exits, then is gone', () => {
  let s = show([], payload('nagafen', 6000))
  assert.equal(s.length, 1)
  s = run(s, 5900)
  assert.equal(s[0].exitingMs, null, 'still holding just before its time is up')
  s = run(s, 200)
  assert.notEqual(s[0].exitingMs, null, 'the exit has begun')
  s = run(s, TOAST_EXIT_MS + 100)
  assert.deepEqual(s, [], 'and the card leaves the queue entirely')
})

test('pointing at a card pauses ITS clock, and nobody else’s', () => {
  let s = show(show([], payload('a')), payload('b'))
  s = hover(s, 'a', true)
  s = run(s, 10_000)
  assert.deepEqual(ids(s), ['a'], 'b timed out and left; a is pinned under the pointer')
  assert.equal(s[0].exitingMs, null)
  assert.ok(s[0].remainingMs > 0, 'a paused clock never drains')
})

test('leaving a pinned card resumes it with a grace period, not with whatever was left', () => {
  let s = show([], payload('a', 6000))
  s = run(s, 5500) // 500 ms left
  s = hover(s, 'a', true)
  s = run(s, 30_000) // read it for half a minute
  s = hover(s, 'a', false)
  assert.equal(s[0].remainingMs, TOAST_GRACE_MS, 'the clock is topped up to the grace floor')
  s = run(s, TOAST_GRACE_MS - 200)
  assert.equal(s[0].exitingMs, null, 'still up while the grace runs')
  s = run(s, 300)
  assert.notEqual(s[0].exitingMs, null, 'and then it goes')
})

test('a card with MORE time left than the grace keeps its own clock', () => {
  let s = show([], payload('a', 6000))
  s = run(s, 1000)
  s = hover(s, 'a', true)
  s = hover(s, 'a', false)
  assert.equal(s[0].remainingMs, 5000, 'the grace is a floor, never a reset')
})

test('the queue caps at three: a fourth evicts the OLDEST, and order is arrival order', () => {
  let s: ToastCardState[] = []
  for (const id of ['a', 'b', 'c']) s = show(s, payload(id))
  assert.deepEqual(ids(s), ['a', 'b', 'c'])
  s = show(s, payload('d'))
  assert.equal(s.length, TOAST_CAP)
  assert.deepEqual(ids(s), ['b', 'c', 'd'], 'the one that had been up longest is the one that goes')
})

test('a repeat id REFRESHES the card on screen instead of stacking a duplicate', () => {
  let s = show([], payload('nagafen', 6000))
  s = run(s, 5000)
  assert.equal(s[0].remainingMs, 1000)
  s = show(s, { ...payload('nagafen', 6000), subtitle: 'D4 · Refined' })
  assert.equal(s.length, 1, 'one boss, one card')
  assert.equal(s[0].remainingMs, 6000, 'its clock restarts')
  assert.equal(s[0].payload.subtitle, 'D4 · Refined', 'and it shows the NEW kill’s facts')
})

test('refreshing a card the user is reading does not yank the pin out from under them', () => {
  let s = hover(show([], payload('nagafen')), 'nagafen', true)
  s = show(s, payload('nagafen'))
  assert.equal(s[0].pinned, true)
  s = run(s, 20_000)
  assert.deepEqual(ids(s), ['nagafen'])
})

test('a card that has begun leaving cannot be caught by the pointer', () => {
  let s = show([], payload('a', 1000))
  s = run(s, 1100)
  assert.notEqual(s[0].exitingMs, null)
  s = hover(s, 'a', true)
  assert.equal(s[0].pinned, false, 'the exit is not interruptible')
  s = run(s, TOAST_EXIT_MS + 100)
  assert.deepEqual(s, [])
})

test('an idle queue returns the SAME array, so a pinned toast re-renders nothing', () => {
  const s = hover(show([], payload('a')), 'a', true)
  assert.equal(tick(s, 100), s)
  assert.equal(tick([], 100).length, 0)
})

test('dismissing removes exactly one card, immediately', () => {
  let s = show(show([], payload('a')), payload('b'))
  s = toastReduce(s, { type: 'dismiss', id: 'a' })
  assert.deepEqual(ids(s), ['b'])
  assert.equal(toastReduce(s, { type: 'dismiss', id: 'nope' }), s)
})
