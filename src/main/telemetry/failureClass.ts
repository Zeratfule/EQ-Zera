// telemetry/failureClass.ts — an error MESSAGE reduced to one of five words.
//
// The schema carries `failureClass` and never a message (src/shared/telemetry.ts: five values,
// and 'other' is where everything else lands). Something has to do the reduction, and there are
// exactly two producers of failures worth classing — the voice-model download (ipc/speech.ts) and
// the auto-updater (updater.ts) — so the mapping lives once, here, and is PURE so
// `tests/telemetryProducers.test.mts` can pin every arm against the real strings both of them
// produce.
//
// THE INPUT IS A MESSAGE AND THE OUTPUT IS A CATEGORY, which means the message itself never
// leaves this function. That is the whole point of the split: the call sites hand an error text
// to a function whose return type cannot hold one.
//
// FAILING TOWARD 'other' IS DELIBERATE. A wrong class is worse than an unclassified one — an
// operator reading "12 checksum failures" would go and look at the CDN. So each arm matches
// something specific and unambiguous, and everything else is 'other'.

import type { TelemetryFailureClass } from '../../shared/telemetry'

/** `err.message` when there is one, else the value stringified — the shape both producers hold. */
export function failureTextOf(err: unknown): string {
  if (err instanceof Error) return err.message
  const message = (err as { message?: unknown } | null | undefined)?.message
  return typeof message === 'string' ? message : String(err)
}

/**
 * The five-way reduction, in PRIORITY ORDER — the first arm that matches wins, because a real
 * message can satisfy two of them ("timed out" inside a socket error is a timeout, not a generic
 * network fault, and that distinction is the reason to have both).
 */
export function classifyFailure(raw: unknown): TelemetryFailureClass {
  const text = failureTextOf(raw).toLowerCase()
  if (/timed? ?out|etimedout|abort|deadline/.test(text)) return 'timeout'
  // The digest gate in speech/provision.ts, and electron-updater's own sha512 verification.
  if (/sha256|sha512|checksum|digest|hash mismatch/.test(text)) return 'checksum'
  if (/enospc|erofs|eacces|eperm|emfile|no space|disk|permission denied/.test(text)) return 'disk'
  if (
    /enotfound|econnreset|econnrefused|ehostunreach|enetunreach|epipe|socket|dns|tls|certificate|fetch failed|network|http \d{3}|short read|empty body|status code/.test(
      text
    )
  ) {
    return 'network'
  }
  return 'other'
}
