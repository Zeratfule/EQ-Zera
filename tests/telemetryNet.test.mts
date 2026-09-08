// src/main/telemetry/ — THE LIT-BUILD LAW, and the ring that fills behind it.
//
// This file used to prove the opposite. Until the owner approved collection it pinned three
// dark-build facts (the endpoint is '', there is no transport at all, there is no override) so
// that SECURITY.md's "no telemetry of any kind" was a structural fact rather than a promise —
// and so that lighting the endpoint could not happen QUIETLY: the test that forced the doc
// amendment was the test that failed. It failed, the docs were amended, and this is the same
// discipline pointed the other way. What is asserted now:
//
//   1. THE ENDPOINT IS EXACTLY ONE STRING, spelled out here character for character. Changing
//      where this app's usage data goes must mean editing this line of this test.
//   2. THE ONLY FETCH IN THE DIRECTORY NAMES THAT CONSTANT. Every file under
//      `src/main/telemetry/` is read; every `fetch(` in it must be `fetch(TELEMETRY_API_URL`.
//      A second target — a variable, a parameter, a template string — fails here.
//   3. THERE IS STILL NO OVERRIDE. No setter, no env var, no store key can supply an endpoint.
//      Unlike feedback, telemetry does not even have a loopback dev gate: it has no local-stack
//      rehearsal need, and a gate that does not exist cannot be widened.
//   4. THE CONSENT GATES ARE UNCHANGED, and they are the reason a lit build is defensible at
//      all: nothing transmits before the first-run notice has rendered, and opting out drops
//      the buffer and the id rather than merely stopping the timer.
//
// No Electron, no fixtures, no network: this suite never skips. (`ring.ts`'s pure half is tested
// here too; its file half needs `app.getPath` and is exercised by the e2e spec.)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as net from '../src/main/telemetry/net'
import {
  TELEMETRY_API_URL,
  telemetryCollectEnabled,
  telemetryEndpointConfigured,
  telemetryFlushEnabled,
  telemetryPermanentRefusal
} from '../src/main/telemetry/net'
import { emptyRing, parseRingFile, pushCapped, TELEMETRY_RING_VERSION } from '../src/main/telemetry/ring'
import { TELEMETRY_BUFFER_CAP, type TelemetryPrefs, type TelemetryRecord } from '../src/shared/telemetry'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TELEMETRY_DIR = join(ROOT, 'src', 'main', 'telemetry')

const prefs = (over: Partial<TelemetryPrefs> = {}): TelemetryPrefs => ({
  enabled: true,
  noticeShown: true,
  analyticsId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  ...over
})

// ---- 1. THE ENDPOINT --------------------------------------------------------------------

/**
 * THE ONE URL, pinned as a literal. Not `.startsWith('https://')`, not a regex over
 * execute-api: the whole value of this assertion is that redirecting this app's usage data
 * somewhere else cannot be done without editing this exact line, in a test called THE PIN.
 */
// EQ ZERA FORK: THE BUILD IS DARK AGAIN. The endpoint is '' and stays '' until this fork stands up
// its own ingest and edits this line on purpose. Everything below that used the lit endpoint now
// uses a stand-in URL so the gate arithmetic is still exercised.
const ENDPOINT = ''
const LIT_STAND_IN = 'https://example.invalid/v1/telemetry'

test('THE DARK PIN: no compiled-in telemetry endpoint, so nothing can ever be sent', () => {
  assert.equal(TELEMETRY_API_URL, ENDPOINT)
  assert.equal(telemetryEndpointConfigured(), false)
  assert.equal(telemetryFlushEnabled(false, TELEMETRY_API_URL, prefs()), false)
})

test('THE TRUTH TABLE: the flush gate needs all four facts, and the endpoint is now one of them', () => {
  // The row that sends: a real build, a user who has not opted out, and the notice rendered
  // (with a stand-in endpoint — this fork compiles none in).
  assert.equal(telemetryFlushEnabled(false, LIT_STAND_IN, prefs()), true)

  // Every single-fact negation, each fatal on its own.
  assert.equal(
    telemetryFlushEnabled(true, TELEMETRY_API_URL, prefs()),
    false,
    'THE E2E LAW (plan T7): the headless harness never sends, lit endpoint or not'
  )
  assert.equal(telemetryFlushEnabled(false, '', prefs()), false, 'no endpoint ⇒ nowhere to send')
  assert.equal(
    telemetryFlushEnabled(false, TELEMETRY_API_URL, prefs({ enabled: false })),
    false,
    "THE OPT-OUT: the user's switch is off, so the network is off — immediately, not next launch"
  )
  assert.equal(
    telemetryFlushEnabled(false, TELEMETRY_API_URL, prefs({ noticeShown: false })),
    false,
    'THE T1 GATE: nothing transmits before the first-run notice has rendered'
  )

  // …and every combination of the two consent facts, because these are the two that a user
  // controls and neither may be compensated for by the other.
  for (const enabled of [true, false]) {
    for (const noticeShown of [true, false]) {
      assert.equal(
        telemetryFlushEnabled(false, LIT_STAND_IN, prefs({ enabled, noticeShown })),
        enabled && noticeShown,
        `enabled=${String(enabled)} noticeShown=${String(noticeShown)}`
      )
    }
  }
})

test('COLLECTION is gated on the user’s switch ALONE — that is what makes the notice honest', () => {
  // T1: "Collection may buffer pre-notice; the network starts only after the notice renders."
  // A buffer that stayed empty until the notice was answered would leave the notice's own
  // "here is what would be sent" panel showing nothing, which is the wrong kind of honest.
  assert.equal(telemetryCollectEnabled(prefs({ noticeShown: false })), true)
  assert.equal(telemetryCollectEnabled(prefs()), true)
  assert.equal(telemetryCollectEnabled(prefs({ enabled: false })), false)
  assert.equal(telemetryCollectEnabled(prefs({ enabled: false, noticeShown: false })), false)
})

// ---- 2. THE ONLY TRANSPORT, AND THE ONLY TARGET -------------------------------------------

/** Every source file the telemetry feature owns in main. */
function telemetrySources(): { name: string; body: string }[] {
  return readdirSync(TELEMETRY_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((name) => ({ name, body: readFileSync(join(TELEMETRY_DIR, name), 'utf8') }))
}

/** Comments stripped: this directory TALKS about its transport at length, and a grep that
 *  counted prose would be a grep nobody could keep green. */
function codeOf(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test('THE TARGET PIN: every fetch under src/main/telemetry/ names TELEMETRY_API_URL', () => {
  const files = telemetrySources()
  assert.ok(files.length >= 4, `expected the feature's modules, found ${String(files.length)}`)

  let calls = 0
  for (const { name, body } of files) {
    const src = codeOf(body)
    for (const m of src.matchAll(/\bfetch\s*\(\s*([A-Za-z_$][\w$.]*|['"`])/g)) {
      calls++
      assert.equal(
        m[1],
        'TELEMETRY_API_URL',
        `${name}: fetch(${String(m[1])}…) — the only legal target is the compiled-in constant`
      )
    }
    // The other ways bytes leave a process. There is one transport here and it is `fetch`.
    for (const re of [/XMLHttpRequest/, /\bnet\.request\b/, /require\(['"]https?['"]\)/, /from ['"]node:https?['"]/, /new WebSocket/]) {
      assert.equal(re.test(src), false, `${name} contains ${String(re)} — one transport, no others`)
    }
  }
  assert.equal(calls, 1, 'exactly one POST site exists — net.ts postTelemetryBatch')
})

test('THERE IS NO OVERRIDE: no setter, no env var, nothing can supply an endpoint', () => {
  // The feedback precedent (§6.2): an overridable ingest URL is an exfiltration primitive, not
  // a convenience. Telemetry does not even have feedback's loopback dev gate — it has no
  // local-stack rehearsal need, and a gate that does not exist cannot be widened.
  assert.deepEqual(Object.keys(net).filter((k) => /^(set|override|configure)/i.test(k)), [])
  for (const { name, body } of telemetrySources()) {
    assert.equal(/process\.env/.test(body), false, `${name} must not read an env var for an endpoint`)
  }
  // …and `postTelemetryBatch` takes no url: a url parameter is the first half of an override,
  // and it would make the target pin above unwritable.
  // `.length` counts the parameters before the first defaulted one: the batch, and nothing else
  // a caller is required to supply. (`timeoutMs` defaults.)
  assert.equal(net.postTelemetryBatch.length, 1, 'postTelemetryBatch(batch) — no url parameter')
})

test('A REFUSAL OF THESE BYTES drops them; a bad moment keeps them', () => {
  // Retrying a 400 forever is a bug, not resilience (the feedback queue's rule) — and a ring
  // that can never drain stops recording the session the user is actually having.
  assert.equal(telemetryPermanentRefusal(400), true, 'the shared validator said no')
  assert.equal(telemetryPermanentRefusal(413), true, 'too large, and it will be next time too')
  for (const status of [0, 429, 500, 502, 503]) {
    assert.equal(
      telemetryPermanentRefusal(status),
      false,
      `${String(status)} is "not now" — offline, the daily cap, or the operator's kill switch`
    )
  }
})

test('OPT-OUT OPTS OUT: the switch drops the buffer AND the id, in the code that owns both', () => {
  // The live proof is tests/e2e/telemetry.e2e.mts (a real app, a real click, a real file). What
  // is pinned HERE is that the one function the switch and the notice both go through still
  // does both halves — a `setTelemetryEnabled` that only flipped a boolean would leave a user
  // who declined carrying an identifier for the thing they declined, and would leave up to 500
  // buffered events on their disk.
  const collector = codeOf(readFileSync(join(TELEMETRY_DIR, 'collector.ts'), 'utf8'))
  const off = /if \(!enabled\) \{([\s\S]*?)\n {2}\}/.exec(collector)?.[1] ?? ''
  assert.match(off, /dropRing\(\)/, 'turning it off must drop the local ring')
  assert.match(off, /analyticsId: null/, 'turning it off must discard the anonymous id')
  assert.match(off, /enabled: false/)
  // And the flush loop refuses to write the ring back for an opted-out install, so a POST in
  // flight when the switch was pressed cannot resurrect the file it just deleted.
  const flush = codeOf(readFileSync(join(TELEMETRY_DIR, 'flush.ts'), 'utf8'))
  assert.match(flush, /if \(!telemetryCollectEnabled\(getTelemetryPrefs\(\)\)\) return null/)
})

// ---- 3. THE RING ---------------------------------------------------------------------------

const rec = (ts: number): TelemetryRecord => ({ ts, ev: { t: 'sessionHeartbeat', uptimeMs: ts } })

test('the ring keeps the NEWEST records and drops the oldest — never the other way round', () => {
  // A counter feed that stopped recording at 500 would stop measuring exactly the long sessions
  // most worth measuring.
  let events: TelemetryRecord[] = []
  for (let i = 0; i < TELEMETRY_BUFFER_CAP + 25; i++) events = pushCapped(events, rec(i))
  assert.equal(events.length, TELEMETRY_BUFFER_CAP)
  assert.equal(events[0]?.ts, 25, 'the oldest 25 were dropped')
  assert.equal(events.at(-1)?.ts, TELEMETRY_BUFFER_CAP + 24, 'the newest is always kept')

  // Pure: the input array is never mutated.
  const before: TelemetryRecord[] = [rec(1)]
  const after = pushCapped(before, rec(2), 5)
  assert.equal(before.length, 1)
  assert.equal(after.length, 2)
  assert.deepEqual(pushCapped(before, rec(2), 0), [], 'a zero cap holds nothing')
})

test('a foreign, corrupt or hand-edited ring file is refused rather than trusted', () => {
  assert.deepEqual(parseRingFile({ version: TELEMETRY_RING_VERSION, events: [] }), emptyRing())
  for (const junk of [null, 42, 'nope', [], {}, { version: 99, events: [] }, { version: 1 }]) {
    assert.equal(parseRingFile(junk), null, JSON.stringify(junk))
  }

  // AND the records inside it go through the SHARED validator, so a hand edit cannot smuggle a
  // field the schema has no room for into a future batch. The ring is an input like any other.
  const parsed = parseRingFile({
    version: TELEMETRY_RING_VERSION,
    events: [
      { ts: 1, ev: { t: 'viewDwell', view: 'combat', ms: 10, characterName: 'Primitive' } },
      { ts: 2, ev: { t: 'notAnEvent', payload: 'anything at all' } },
      'not a record'
    ]
  })
  assert.deepEqual(parsed?.events, [{ ts: 1, ev: { t: 'viewDwell', view: 'combat', ms: 10 } }])
  assert.equal(parsed?.lastBatch, null, 'a display-only field is never restored from disk')
})

test('an over-long ring file is trimmed to the cap on read, not honored', () => {
  const events = Array.from({ length: TELEMETRY_BUFFER_CAP + 40 }, (_, i) => rec(i))
  const parsed = parseRingFile({ version: TELEMETRY_RING_VERSION, events })
  assert.equal(parsed?.events.length, TELEMETRY_BUFFER_CAP)
  assert.equal(parsed?.events.at(-1)?.ts, TELEMETRY_BUFFER_CAP + 39)
})
