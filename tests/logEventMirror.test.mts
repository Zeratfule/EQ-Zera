// ============================================================================
// THE KIND STRING IS A WIRE CONTRACT, AND IT HAS TWO AUTHORS.
// ============================================================================
//
// The engine writes `{"kind":"factionHit",…}` off `eqlog::event::Kind::as_str`; this side reads it
// off the `kind` discriminants in `shared/logEvents.ts` and the curated `LogEventKind` allowlist in
// `shared/alertTypes.ts`. Neither can see the other. A kind spelled `factionhit` on one side and
// `factionHit` on the other is not a compile error anywhere — it is an alert that silently never
// fires and a module that silently never folds, which is the failure mode this repo's telemetry
// pins already exist to refuse (`tests/breadcrumbVocabulary.test.mts`, the same argument).
//
// So this file reads the ENGINE'S OWN SOURCE as text — `tests/enginePackaging.test.mts`'s posture,
// and `breadcrumbVocabulary.test.mts`'s — and holds the two vocabularies to each other. It NEVER
// SKIPS: the engine source is committed, so a missing file is a broken probe and says so.
//
// WHY CONTAINMENT AND NOT EQUALITY. `LogEventKind` is a CURATED allowlist (its own header says so):
// several real kinds are deliberately absent because an alert on them would be parser-internal
// evidence rather than a thing a player wants to hear about (`ccWake`, `otherCastBegin`). So the
// claim is one-directional and exact where it can be: every kind THIS side names must be a kind the
// engine can actually write, and the pinned table below must be spelled the way the engine spells
// it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_LOG_EVENT_KINDS } from '../src/shared/logEventKinds'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EVENT_RS = join(ROOT, 'engine', 'crates', 'eqlog', 'src', 'event.rs')

/**
 * Every string `Kind::as_str` can answer with, read off the arms themselves. `Kind::Other` answers
 * the empty string — the honest answer for a kind this build does not know — and is dropped: it is
 * not a kind anything writes.
 */
function engineKinds(): Set<string> {
  const src = readFileSync(EVENT_RS, 'utf8')
  const out = new Set<string>()
  for (const m of src.matchAll(/Kind::[A-Za-z]+ => "([A-Za-z]+)"/g)) out.add(m[1])
  return out
}

test('every alertable kind is a string the engine can actually write', () => {
  const engine = engineKinds()
  assert.ok(
    engine.size >= 60,
    `the probe found only ${String(engine.size)} kinds in event.rs — the regex broke, not the list`
  )
  const unwritable = [...ALL_LOG_EVENT_KINDS].filter((k) => !engine.has(k)).sort()
  assert.deepEqual(
    unwritable,
    [],
    'shared/logEventKinds.ts names kinds the engine has no Kind::as_str arm for'
  )
})

// The three added 2026-09-08, pinned BY HAND rather than derived — a table generated from the same
// file it is checked against would agree with itself no matter what either side said. These are the
// spellings the parser's own unit tests assert, transcribed.
const ADDED_2026_09_08 = ['hail', 'factionHit', 'skillUp'] as const

test('the three kinds added for the quest / faction / skill surfaces are spelled identically on both sides', () => {
  const engine = engineKinds()
  for (const kind of ADDED_2026_09_08) {
    assert.ok(engine.has(kind), `the engine has no Kind::as_str arm answering "${kind}"`)
    assert.ok(
      (ALL_LOG_EVENT_KINDS as readonly string[]).includes(kind),
      `"${kind}" is not in ALL_LOG_EVENT_KINDS, so no alert can ever name it`
    )
  }
})
