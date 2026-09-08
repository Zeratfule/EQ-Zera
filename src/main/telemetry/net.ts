// telemetry/net.ts — the ONLY place usage analytics knows a hostname, and the ONLY place it
// can reach the network from.
//
// ============================ THIS BUILD IS DARK (EQ Zera fork) ============================
//
// The fork compiles an EMPTY endpoint: usage analytics are collected into the local ring only
// and never leave the machine. The upstream history below is kept for context.
//
// (upstream note follows)
//
// `TELEMETRY_API_URL` names the deployed ingest route. Until this commit it was `''` and the
// dark-build law (`tests/telemetryNet.test.mts`) made "this build sends nothing" a structural
// fact; the owner has now approved collection, so the constant is filled in and the same test
// file pins the opposite property just as hard:
//
//   * the endpoint is EXACTLY this string, compiled in;
//   * the ONLY fetch in this directory targets that constant and nothing else;
//   * the consent gates below are unchanged — nothing transmits before the first-run notice
//     has rendered, and opting out drops the buffer AND the id.
//
// SECURITY.md, README.md and TELEMETRY.md were amended in this same commit, because the moment
// this constant became non-empty the "no telemetry of any kind" sentence stopped being true.
//
// There is NO user-configurable endpoint override and there must never be one, for exactly the
// reason feedback/net.ts spells out at length: an overridable ingest URL is an exfiltration
// primitive, not a convenience. Unlike feedback there is not even a loopback dev gate here —
// telemetry has no local-stack rehearsal need that justifies one, and a gate that does not
// exist cannot be widened. Nothing in settings, in the UI, in an env var or on disk can point
// this anywhere else; `tests/telemetryNet.test.mts` pins the absence of every such mechanism.
//
// The predicates below are the telemetry twins of `queueFlushEnabled` (feedback/net.ts) and
// live here for the same reason: they are PURE, they are the whole startup decision, and they
// must stay pinnable by a node test that loads no Electron.

import type { TelemetryBatch, TelemetryPrefs } from '../../shared/telemetry'

/**
 * The ingest API as COMPILED IN — the `/v1/telemetry` route of the same API the feedback stack
 * uses (docs/plans/usage-analytics.md T5), in our own AWS account.
 *
 * This is the only value any build can ever use. It is a constant, not a setting.
 */
export const TELEMETRY_API_URL = ''

/** JSON POST budget. A batch is counters, not a log slice — feedback's submit budget is plenty. */
export const TELEMETRY_TIMEOUT_MS = 15_000

/** Shared with every other outbound request this app makes (feedback/imageCache/itemLookup). */
const UA = 'eq-zera/0.1 (telemetry)'

/** Does this build have an endpoint compiled in? The Preferences pane reads it to say what the
 *  "last batch sent" panel means. True in every build from this commit on. */
export function telemetryEndpointConfigured(): boolean {
  return TELEMETRY_API_URL.length > 0
}

/**
 * May this process SEND? Four facts, each fatal on its own — the same shape and the same
 * discipline as `queueFlushEnabled`:
 *
 *   * `e2e`         — the headless harness never sends (plan T7). It must never spin a timer
 *                     that could reach the network behind a test's back. STILL TRUE with the
 *                     endpoint lit, and now it is the only reason the e2e run stays silent.
 *   * `endpoint`    — a build with no endpoint has nowhere to send; timers that can only no-op
 *                     are noise. (Kept as a parameter rather than folded into the constant so
 *                     the predicate stays pure and the truth table stays testable.)
 *   * `enabled`     — the user's switch. Off means off, immediately (the buffer and the id are
 *                     dropped too — collector.ts `setTelemetryEnabled`).
 *   * `noticeShown` — T1, AND THIS IS THE POINT OF THE WHOLE DESIGN: collection may buffer
 *                     before the first-run notice has rendered, but the NETWORK does not start
 *                     until it has. "Opt-out" never means "sent before you were told".
 */
export function telemetryFlushEnabled(
  e2e: boolean,
  endpoint: string,
  prefs: TelemetryPrefs
): boolean {
  return !e2e && endpoint.length > 0 && prefs.enabled && prefs.noticeShown
}

/**
 * May this process COLLECT into the local ring? Only the user's own switch decides.
 *
 * Deliberately NOT gated on the notice or on the endpoint: T1 says "collection may buffer
 * pre-notice; the network starts only after the notice renders", and a buffer that fills from
 * the first second is what makes the notice's "here is exactly what would be sent" panel show
 * something real instead of an empty box. Nothing here can leave the machine on its own — the
 * only reader of the ring is the flush loop, and the flush loop is gated above.
 */
export function telemetryCollectEnabled(prefs: TelemetryPrefs): boolean {
  return prefs.enabled
}

/**
 * The outcome of one POST, as data. NOTHING in this module throws — the flush loop is
 * best-effort by contract (losing counters is not an app failure), and the only cheap way to
 * keep that promise is for the transport to report failure instead of raising it.
 *
 * `status: 0` means the request never got an answer (offline, DNS, TLS, timeout): the buffer is
 * KEPT for the next tick. A real 4xx is not retried forever — see flush.ts.
 */
export interface TelemetryAttempt {
  status: number
}

/**
 * POST one batch to `TELEMETRY_API_URL`. Never throws.
 *
 * THE URL IS NOT A PARAMETER, on purpose. Every other request this app makes takes its target
 * as an argument; this one cannot, because "the only fetch under src/main/telemetry/ names the
 * compiled-in constant" is a property `tests/telemetryNet.test.mts` asserts by reading this
 * file. A url parameter would make that assertion unwritable and would be the first half of an
 * endpoint override.
 *
 * The response body is not read at all: the server answers `{ok, accepted}`, the client has no
 * use for either number, and a body we never parse is a parser we never have to trust.
 */
export async function postTelemetryBatch(
  batch: TelemetryBatch,
  timeoutMs = TELEMETRY_TIMEOUT_MS
): Promise<TelemetryAttempt> {
  try {
    const res = await fetch(TELEMETRY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(timeoutMs)
    })
    return { status: res.status }
  } catch {
    return { status: 0 }
  }
}

/**
 * Is this status a REFUSAL OF THESE EVENTS rather than a bad moment? A 400 (the shared
 * validator said no) or a 413 (too large) will say exactly the same thing to the same bytes
 * forever, so those events are dropped rather than retried: a ring that can never drain is a
 * ring that stops recording the session the user is actually having.
 *
 * 429 (daily cap) and 503 (the operator's kill switch) are NOT permanent — they are "not now",
 * and the buffer waits for them. So is a transport failure (`status: 0`).
 */
export function telemetryPermanentRefusal(status: number): boolean {
  return status === 400 || status === 413
}
