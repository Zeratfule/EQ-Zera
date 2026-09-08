// ============================================================================
// TELEMETRY VALIDATORS — the gate every usage event passes, three times.
// ============================================================================
//
// The other half of `./telemetry.ts`. It is a separate file for one reason and it is a boring
// one: the contract plus its validators is past the repo's 400-code-line factoring ceiling, and
// the answer to that here is a split, not a widened threshold (the same call
// `storeMigrationsPresence.test.mts` and `appHarness.mts` made). Nothing else changes — this is
// still ONE definition of what an event may be, spelled across FIVE files that only ever move
// together:
//
//   telemetry.ts                 the contract: the union, the enums, the buckets, the patterns
//   telemetryValidate.ts         THIS FILE — the dispatch table and eight of the eleven validators
//   telemetryValidateBase.ts     the seven primitives every validator is built from
//   telemetryValidateError.ts    `errorReport`, the one event whose strings are pattern-bound
//                                rather than enum-bound (JOS-100)
//   telemetryValidateSession.ts  the three SESSION reports — the events that carry OPTIONAL
//                                RIDERS, which is a rule of its own (JOS-208 phase 3)
//
// The last three were split out as `errorReport`, and then the checkpoint counters, pushed this
// file past the same ceiling; all three are re-exported or re-imported from here so no importer
// anywhere had to change.
//
// WHO RUNS THESE, AND WHY ALL THREE:
//   * the renderer's `track()` shim — so a mistake is caught where it was made;
//   * MAIN, at the IPC handler — because the renderer is untrusted, always, and the renderer is
//     where this app's strings live (character names, zones, search boxes, alert text);
//   * wave A2's ingest Lambda — because a client is a client.
//
// THE MECHANISM THAT MAKES THE PRIVACY CLAIM STRUCTURAL: these functions do not SANITIZE an
// object, they CONSTRUCT a new one field by field from the schema. So an event that arrives
// carrying `characterName` does not get it stripped by a rule someone has to remember — the
// property simply never appears in the value that comes back. `tests/telemetryContract.test.mts`
// pins exactly that.
//
// PURE, like the contract: total (every failure is a typed value) and side-effect free (nothing
// throws, and the same input always gives the same answer). The deepest import chain in the set
// reaches `./errorReport` → `./sanitizeText`, and both are import-free-or-nearly-so on purpose:
// this module bundles into the ingest Lambda, and the server's defense-in-depth check IS
// re-running the client's redactor, which means the redactor has to be reachable from here.

import {
  ALERT_COUNT_EDGES,
  APP_VERSION_RE,
  CHAR_COUNT_EDGES,
  CPU_COUNT_EDGES,
  DISPLAY_COUNT_EDGES,
  isTelemetryObject,
  LOG_SIZE_BYTES_EDGES,
  MAX_BATCH_EVENTS,
  MAX_COUNT,
  MAX_DURATION_MS,
  MAX_TZ_OFFSET_HOURS,
  MIN_TZ_OFFSET_HOURS,
  PRIMARY_SCALE_EDGES,
  TELEMETRY_API_VERSION,
  TELEMETRY_CHANNELS,
  TELEMETRY_EVENT_KINDS,
  TELEMETRY_EQ_WINDOW_MODES,
  TELEMETRY_FAILURE_CLASSES,
  TELEMETRY_FEATURES,
  TELEMETRY_FUNNELS,
  TELEMETRY_FUNNEL_STEPS,
  TELEMETRY_GPU_COMPOSITING,
  TELEMETRY_GPU_VENDORS,
  TELEMETRY_OUTCOMES,
  TELEMETRY_OVERLAY_KINDS,
  TELEMETRY_PLATFORMS,
  TELEMETRY_UPDATE_CHANNELS,
  TELEMETRY_UPDATE_STEPS,
  TELEMETRY_VIEWS,
  TELEMETRY_VOICE_ENGINES,
  TOTAL_MEM_GB_EDGES,
  UUID_V4_RE,
  type EvFunnelStep,
  type EvHealthCounters,
  type EvSetupSnapshot,
  type EvUpdateOutcome,
  type TelemetryBatch,
  type TelemetryEnvelope,
  type TelemetryEqWindowMode,
  type TelemetryEvent,
  type TelemetryEventKind,
  type TelemetryGpuCompositing,
  type TelemetryGpuVendor,
  type TelemetryOverlayKind,
  type TelemetryRecord
} from './telemetry'
// THE PRIMITIVES live in `./telemetryValidateBase.ts` and the ERROR REPORT's validator in
// `./telemetryValidateError.ts` — both split out of this file when JOS-100 pushed it past the
// repo's 400-code-line ceiling, and both re-exported below so every existing importer of this
// module keeps working unchanged. `Validated` and `TelemetryValidationFailure` are named by
// callers across main, the renderer, the CLI and the Lambda; moving them behind a new import
// path would have been a rename dressed up as a factoring.
import {
  bucket,
  fail,
  flag,
  matching,
  oneOf,
  signedInt,
  whole,
  type TelemetryValidationFailure,
  type Validated
} from './telemetryValidateBase'
import { validateErrorReport } from './telemetryValidateError'
// …and the three SESSION reports in `./telemetryValidateSession.ts`, split out when JOS-208
// phase 3's checkpoint counters pushed this file past the same ceiling. The cut is by subject: they
// are the events that carry OPTIONAL RIDERS, which is a rule of its own and now has a file to state
// it in. Same re-export discipline as the other two, so nothing that imports this module changed.
import { vSessionEnd, vSessionHeartbeat, vSessionStart } from './telemetryValidateSession'

export type { TelemetryValidationFailure, Validated }

// --- one validator per event kind. Small on purpose: the dispatch table below is the only
// --- place that knows which is which, so adding an event is one interface + one entry + one
// --- doc row (and the doc-parity test fails until the row exists).

function vViewDwell(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const view = oneOf(o.view, 'view', TELEMETRY_VIEWS)
  if (!view.ok) return view
  const ms = whole(o.ms, 'ms', MAX_DURATION_MS)
  if (!ms.ok) return ms
  return { ok: true, value: { t: 'viewDwell', view: view.value, ms: ms.value } }
}

function vOverlayToggle(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const kind = oneOf(o.kind, 'kind', TELEMETRY_OVERLAY_KINDS)
  if (!kind.ok) return kind
  const open = flag(o.open, 'open')
  if (!open.ok) return open
  return { ok: true, value: { t: 'overlayToggle', kind: kind.value, open: open.value } }
}

function vFeatureUse(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const feature = oneOf(o.feature, 'feature', TELEMETRY_FEATURES)
  if (!feature.ok) return feature
  const count = whole(o.count, 'count', MAX_COUNT)
  if (!count.ok) return count
  return { ok: true, value: { t: 'featureUse', feature: feature.value, count: count.value } }
}

function vAlertFired(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const count = whole(o.count, 'count', MAX_COUNT)
  if (!count.ok) return count
  const spoken = whole(o.spokenCount, 'spokenCount', MAX_COUNT)
  if (!spoken.ok) return spoken
  return { ok: true, value: { t: 'alertFired', count: count.value, spokenCount: spoken.value } }
}

/** The overlay list, as a SET of the closed kinds — deduped and re-ordered canonically, so the
 *  field carries membership and nothing else (not click order, not a repeat count). */
function overlaySet(raw: unknown): Validated<TelemetryOverlayKind[]> {
  if (!Array.isArray(raw)) return fail('overlaysEnabled', 'overlaysEnabled must be a list.')
  for (const k of raw) {
    const one = oneOf(k, 'overlaysEnabled[]', TELEMETRY_OVERLAY_KINDS)
    if (!one.ok) return one
  }
  const set = new Set(raw as TelemetryOverlayKind[])
  return { ok: true, value: TELEMETRY_OVERLAY_KINDS.filter((k) => set.has(k)) }
}

function vSetupSnapshot(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const chars = bucket(o.charCountBucket, 'charCountBucket', CHAR_COUNT_EDGES)
  if (!chars.ok) return chars
  const logSize = bucket(o.logSizeBucket, 'logSizeBucket', LOG_SIZE_BYTES_EDGES)
  if (!logSize.ok) return logSize
  const alerts = bucket(o.alertCountBucket, 'alertCountBucket', ALERT_COUNT_EDGES)
  if (!alerts.ok) return alerts
  const overlays = overlaySet(o.overlaysEnabled)
  if (!overlays.ok) return overlays
  const ring = flag(o.cursorRing, 'cursorRing')
  if (!ring.ok) return ring
  const autoHide = flag(o.autoHide, 'autoHide')
  if (!autoHide.ok) return autoHide
  const engine = oneOf(o.voiceEngine, 'voiceEngine', TELEMETRY_VOICE_ENGINES)
  if (!engine.ok) return engine
  const packs = whole(o.soundPackCount, 'soundPackCount', MAX_COUNT)
  if (!packs.ok) return packs
  const channel = oneOf(o.updateChannel, 'updateChannel', TELEMETRY_UPDATE_CHANNELS)
  if (!channel.ok) return channel
  const value: EvSetupSnapshot = {
    t: 'setupSnapshot',
    charCountBucket: chars.value,
    logSizeBucket: logSize.value,
    alertCountBucket: alerts.value,
    overlaysEnabled: overlays.value,
    cursorRing: ring.value,
    autoHide: autoHide.value,
    voiceEngine: engine.value,
    soundPackCount: packs.value,
    updateChannel: channel.value
  }
  return machineClass(o, value)
}

/**
 * THE MACHINE CLASS (JOS-364), checked the way every optional rider in this file is: absent and
 * null both mean "this client does not measure it", and the field is then NOT copied across
 * rather than defaulted — which is what keeps `tests/telemetryContract.test.mts`'s round-trip
 * assertion meaningful and what makes an older ingest reading a newer client harmless.
 *
 * A PRESENT FIELD IS STILL FULLY CHECKED. Optional means "may be absent", never "may be
 * anything": a bucket index outside its ladder or a string outside its enum fails the whole
 * event here exactly as `charCountBucket` does, which is the property the ladders exist for.
 *
 * It is a separate function only because the two together are past the repo's per-function
 * ceiling; the split is by subject (what the install is configured like / what the machine is).
 */
function machineClass(
  o: Record<string, unknown>,
  value: EvSetupSnapshot
): Validated<TelemetryEvent> {
  const ladders = machineBuckets(o, value)
  if (!ladders.ok) return ladders
  const enums = machineEnums(o, value)
  if (!enums.ok) return enums
  if (o.safeMode !== undefined && o.safeMode !== null) {
    const safe = flag(o.safeMode, 'safeMode')
    if (!safe.ok) return safe
    value.safeMode = safe.value
  }
  return { ok: true, value }
}

/** The four ladders. Split from its caller purely to stay under the repo's complexity ceiling —
 *  a loop with an optional-field guard and a failure return costs three branches per axis. */
function machineBuckets(
  o: Record<string, unknown>,
  value: EvSetupSnapshot
): Validated<true> {
  const buckets = [
    ['cpuCountBucket', CPU_COUNT_EDGES],
    ['totalMemBucket', TOTAL_MEM_GB_EDGES],
    ['displayCountBucket', DISPLAY_COUNT_EDGES],
    ['primaryScaleBucket', PRIMARY_SCALE_EDGES]
  ] as const
  for (const [field, edges] of buckets) {
    if (o[field] === undefined || o[field] === null) continue
    const b = bucket(o[field], field, edges)
    if (!b.ok) return b
    value[field] = b.value
  }
  return { ok: true, value: true }
}

/** The three enums, same split for the same reason. */
function machineEnums(o: Record<string, unknown>, value: EvSetupSnapshot): Validated<true> {
  const enums = [
    ['gpuVendor', TELEMETRY_GPU_VENDORS],
    ['gpuCompositing', TELEMETRY_GPU_COMPOSITING],
    ['eqWindowMode', TELEMETRY_EQ_WINDOW_MODES]
  ] as const
  for (const [field, allowed] of enums) {
    if (o[field] === undefined || o[field] === null) continue
    const e = oneOf(o[field], field, allowed)
    if (!e.ok) return e
    // The three enums have disjoint member types, so the assignment is spelled per field rather
    // than through the loop's union — a `oneOf` over `gpuVendor`'s list cannot produce a value
    // `eqWindowMode` would accept, and the compiler is the one saying so.
    if (field === 'gpuVendor') value.gpuVendor = e.value as TelemetryGpuVendor
    else if (field === 'gpuCompositing') value.gpuCompositing = e.value as TelemetryGpuCompositing
    else value.eqWindowMode = e.value as TelemetryEqWindowMode
  }
  return { ok: true, value: true }
}

function vFunnelStep(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const funnel = oneOf(o.funnel, 'funnel', TELEMETRY_FUNNELS)
  if (!funnel.ok) return funnel
  // The PAIR is checked, not the step alone: a step belongs to exactly one funnel.
  const step = oneOf(o.step, 'step', TELEMETRY_FUNNEL_STEPS[funnel.value])
  if (!step.ok) return step
  const value: EvFunnelStep = { t: 'funnelStep', funnel: funnel.value, step: step.value }
  if (o.outcome !== undefined && o.outcome !== null) {
    const outcome = oneOf(o.outcome, 'outcome', TELEMETRY_OUTCOMES)
    if (!outcome.ok) return outcome
    value.outcome = outcome.value
  }
  if (o.failureClass !== undefined && o.failureClass !== null) {
    const cls = oneOf(o.failureClass, 'failureClass', TELEMETRY_FAILURE_CLASSES)
    if (!cls.ok) return cls
    value.failureClass = cls.value
  }
  return { ok: true, value }
}

const HEALTH_FIELDS = [
  'rendererCrashes',
  'mainErrorLogLines',
  'parserStalls',
  'presenceRestarts',
  'speechFailures'
] as const

/**
 * The fields JOS-133 added, which are OPTIONAL for the additive-field rule's reason (see
 * `EvHealthCounters`): this validator also runs in the ingest Lambda, which is deployed by hand
 * and therefore reads events from clients both newer AND older than itself. Required here, a
 * client predating the field would fail the whole batch and be told 400 — which
 * `telemetryPermanentRefusal` classes as permanent, so it would DROP every counter it holds.
 *
 * Absent and null both mean "this client does not measure it", exactly as they do for
 * `linesParsed`. The field is then not copied across at all rather than defaulted to 0, which is
 * what keeps `tests/telemetryContract.test.mts`'s round-trip assertion meaningful.
 */
const HEALTH_OPTIONAL_FIELDS = [
  'imageFetchFailures',
  'suppressedErrorLines',
  // JOS-266's, optional for exactly the same reason and added the same way — which is what the
  // rule is FOR: a third additive field costs one line here and nothing at either end of a skew.
  'imageCacheReadFailures',
  // JOS-364's two lost-child counters, added the same way for the fourth and fifth time. The GPU
  // one is an ERROR (it is `rendererCrashes` with a different process); the utility one is not —
  // `HEALTH_NON_ERROR_FIELDS` (./telemetryRollup.ts) is where that distinction is kept.
  'gpuProcessGone',
  'utilityProcessGone'
] as const

function vHealthCounters(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const counts: number[] = []
  for (const field of HEALTH_FIELDS) {
    const n = whole(o[field], field, MAX_COUNT)
    if (!n.ok) return n
    counts.push(n.value)
  }
  const value: EvHealthCounters = {
    t: 'healthCounters',
    rendererCrashes: counts[0],
    mainErrorLogLines: counts[1],
    parserStalls: counts[2],
    presenceRestarts: counts[3],
    speechFailures: counts[4]
  }
  for (const field of HEALTH_OPTIONAL_FIELDS) {
    const raw = o[field]
    if (raw === undefined || raw === null) continue
    const n = whole(raw, field, MAX_COUNT)
    if (!n.ok) return n
    value[field] = n.value
  }
  return { ok: true, value }
}

function vUpdateOutcome(o: Record<string, unknown>): Validated<TelemetryEvent> {
  const step = oneOf(o.step, 'step', TELEMETRY_UPDATE_STEPS)
  if (!step.ok) return step
  const ok = flag(o.ok, 'ok')
  if (!ok.ok) return ok
  const value: EvUpdateOutcome = { t: 'updateOutcome', step: step.value, ok: ok.value }
  if (o.failureClass !== undefined && o.failureClass !== null) {
    const cls = oneOf(o.failureClass, 'failureClass', TELEMETRY_FAILURE_CLASSES)
    if (!cls.ok) return cls
    value.failureClass = cls.value
  }
  return { ok: true, value }
}

/**
 * THE TWO SWITCH-FLIP EVENTS (JOS-109), and their validator is the shortest one in the file
 * because the schema gave them nothing to check: a flip is the ENVELOPE plus the fact that it
 * happened.
 *
 * "REFUSES PAYLOADS" IS SPELLED AS CONSTRUCTION, NOT AS REJECTION, and that is the same decision
 * every other validator here makes for the same reason (`validateTelemetryEvent`'s note, and the
 * pin in `tests/telemetryContract.test.mts`). These functions return a literal — so a client that
 * bolted a character name, a session length or anything else onto an `optOut` does not get it
 * stripped by a rule somebody has to remember; the property simply never appears in the value
 * that comes back, on the client and again on the server.
 *
 * A HARD REJECTION WOULD BE THE WORSE ANSWER, and it is worth saying why rather than leaving it as
 * a style choice. `validateTelemetryBatch` fails the WHOLE batch on one bad event and the endpoint
 * answers 400, which `telemetryPermanentRefusal` classes as "these bytes will never be accepted" —
 * so a future client that adds an optional field to a flip event would black out every counter in
 * the fleet until the Lambda caught up. Dropping is what makes THE ADDITIVE-FIELD RULE work; the
 * privacy property is the construction, not the refusal.
 */
function vOptOut(): Validated<TelemetryEvent> {
  return { ok: true, value: { t: 'optOut' } }
}

function vOptIn(): Validated<TelemetryEvent> {
  return { ok: true, value: { t: 'optIn' } }
}

const EVENT_VALIDATORS: Record<
  TelemetryEventKind,
  (o: Record<string, unknown>) => Validated<TelemetryEvent>
> = {
  sessionStart: vSessionStart,
  sessionHeartbeat: vSessionHeartbeat,
  sessionEnd: vSessionEnd,
  viewDwell: vViewDwell,
  overlayToggle: vOverlayToggle,
  featureUse: vFeatureUse,
  alertFired: vAlertFired,
  setupSnapshot: vSetupSnapshot,
  funnelStep: vFunnelStep,
  healthCounters: vHealthCounters,
  updateOutcome: vUpdateOutcome,
  errorReport: validateErrorReport,
  optOut: vOptOut,
  optIn: vOptIn
}

/**
 * ONE event. Run in the renderer's own `track()` shim (so a mistake is caught where it was
 * made), AGAIN in main at the IPC handler (renderer input is untrusted), and AGAIN in the
 * ingest Lambda (wave A2). Unknown fields are DROPPED, never rejected: the returned value is
 * constructed field by field from the schema, so nothing that is not in this file survives.
 */
export function validateTelemetryEvent(input: unknown): Validated<TelemetryEvent> {
  if (!isTelemetryObject(input)) return fail('event', 'An event object is required.')
  const t = input.t
  if (typeof t !== 'string' || !(t in EVENT_VALIDATORS)) {
    return fail('t', `t must be one of: ${TELEMETRY_EVENT_KINDS.join(', ')}.`)
  }
  return EVENT_VALIDATORS[t as TelemetryEventKind](input)
}

export function validateEnvelope(input: unknown): Validated<TelemetryEnvelope> {
  if (!isTelemetryObject(input)) return fail('env', 'env is required.')
  const analyticsId = matching(input.analyticsId, 'env.analyticsId', UUID_V4_RE, 'a v4 UUID')
  if (!analyticsId.ok) return analyticsId
  const appVersion = matching(
    input.appVersion,
    'env.appVersion',
    APP_VERSION_RE,
    'a semver version'
  )
  if (!appVersion.ok) return appVersion
  const channel = oneOf(input.channel, 'env.channel', TELEMETRY_CHANNELS)
  if (!channel.ok) return channel
  const platform = oneOf(input.platform, 'env.platform', TELEMETRY_PLATFORMS)
  if (!platform.ok) return platform
  const tz = signedInt(
    input.tzOffsetBucket,
    'env.tzOffsetBucket',
    MIN_TZ_OFFSET_HOURS,
    MAX_TZ_OFFSET_HOURS
  )
  if (!tz.ok) return tz
  return {
    ok: true,
    value: {
      analyticsId: analyticsId.value,
      appVersion: appVersion.value,
      channel: channel.value,
      platform: platform.value,
      tzOffsetBucket: tz.value
    }
  }
}

/** One buffered record: a client timestamp plus a validated event. */
export function validateRecord(input: unknown): Validated<TelemetryRecord> {
  if (!isTelemetryObject(input)) return fail('record', 'A record object is required.')
  if (typeof input.ts !== 'number' || !Number.isFinite(input.ts)) {
    return fail('ts', 'ts must be a number.')
  }
  const ev = validateTelemetryEvent(input.ev)
  if (!ev.ok) return ev
  return { ok: true, value: { ts: input.ts, ev: ev.value } }
}

/**
 * The whole batch, as the ingest Lambda will see it (wave A2). Cheapest checks first; the first
 * failure wins and names its field. An EMPTY batch is legal — the flush loop never sends one,
 * but a server that rejects it would be asserting something it does not need to.
 */
export function validateTelemetryBatch(input: unknown): Validated<TelemetryBatch> {
  if (!isTelemetryObject(input)) return fail('body', 'A JSON object body is required.')
  if (input.v !== TELEMETRY_API_VERSION) {
    return fail('v', `v must be ${TELEMETRY_API_VERSION}.`)
  }
  const env = validateEnvelope(input.env)
  if (!env.ok) return env
  if (!Array.isArray(input.events)) return fail('events', 'events must be a list.')
  if (input.events.length > MAX_BATCH_EVENTS) {
    return fail('events', `events must hold at most ${MAX_BATCH_EVENTS} records.`)
  }
  const events: TelemetryRecord[] = []
  for (const raw of input.events) {
    const rec = validateRecord(raw)
    if (!rec.ok) return rec
    events.push(rec.value)
  }
  return { ok: true, value: { v: TELEMETRY_API_VERSION, env: env.value, events } }
}
