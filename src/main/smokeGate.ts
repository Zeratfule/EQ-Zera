// ============================================================================
// smokeGate.ts — the DECISIONS the post-release smoke hook makes. Pure, testable.
// ============================================================================
//
// Split out of `smokeFeedback.ts` for the same reason `triage/rows.ts` is split out of
// `triage/backend.ts`: the interesting decisions here are decisions about MEANING — is the
// hook armed, what does the report say, which of four outcomes was that — and they must be
// provable without Electron, without a network and without a build.
//
// NOTHING IN THIS FILE IMPORTS ELECTRON. The one non-type import is `MIN_DESCRIPTION` from the
// shared contract, so `tests/smokeFeedback.test.mts` loads this module directly. The runner
// next door owns everything with a side effect.
//
// THE GATE IS TWO CONDITIONS AND BOTH ARE LOAD-BEARING:
//   * `EQ_SMOKE_FEEDBACK` non-empty — the hook is opt-in; every ordinary launch skips it.
//   * NOT under `EQ_E2E=1` — THE HARNESS NEVER SUBMITS. That law predates this file
//     (feedback/submit.ts's first gate, e2e.ts) and this hook must not become the one path
//     that quietly breaks it. `submitFeedback` would refuse anyway; refusing here means an E2E
//     run never even builds a slice.

import { MIN_DESCRIPTION } from '../shared/feedback'
// TYPE-ONLY, and deliberately so: importing the value side of `./feedback` would drag Electron
// in and this module would stop being loadable from a plain node test.
import type { SubmitResult } from './feedback/submit'

/** The env var that arms the hook. Its VALUE is the run's nonce. */
export const SMOKE_ENV = 'EQ_SMOKE_FEEDBACK'

/** The slice window the smoke report attaches. The mocked log spans 10 minutes, so 15 covers it. */
export const SMOKE_WINDOW_MINUTES = 15

/** The one line the guest script greps out of the captured stdout. */
export const SMOKE_RESULT_PREFIX = 'EQ_SMOKE_RESULT'

/** The four outcomes worth telling apart. `closed` is the kill switch, and is NOT a failure. */
export type SmokeOutcome = 'sent' | 'queued' | 'closed' | 'error'

/**
 * THE GATING PREDICATE. Returns the nonce when the hook is armed, null otherwise.
 *
 * Taking the environment and the E2E flag as PARAMETERS rather than reading the module-level
 * `process.env` / `E2E` is what makes "and never under E2E" a thing a test can prove rather
 * than a thing a comment claims.
 */
export function smokeNonce(
  env: Readonly<Record<string, string | undefined>>,
  e2e: boolean
): string | null {
  if (e2e) return null
  const raw = env[SMOKE_ENV]
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value.length > 0 ? value : null
}

/**
 * The description the report carries: `smoke: <nonce>`, padded ONLY if that is shorter than
 * MIN_DESCRIPTION. Padding rather than a canned paragraph, because the shared validator is one
 * of the layers under test — the report must pass it the same way a user's would, and a
 * description built to be exactly long enough proves the limit is real.
 */
export function smokeDescription(nonce: string): string {
  const base = `smoke: ${nonce}`
  return base.length >= MIN_DESCRIPTION ? base : base.padEnd(MIN_DESCRIPTION, '.')
}

/**
 * Which of the four outcomes a `SubmitResult` is.
 *
 * `closed` is checked BEFORE `queued` because a closed endpoint deliberately never queues
 * (submit.ts `retryable`) — re-POSTing at a paused endpoint is precisely what the kill switch
 * exists to prevent — so the two can never both be true, and the order states which fact wins
 * if that ever changes.
 */
export function smokeOutcome(res: SubmitResult): SmokeOutcome {
  if (res.ok) return 'sent'
  if (res.error === 'closed') return 'closed'
  return res.queued ? 'queued' : 'error'
}

/**
 * ONE line, `key=value` pairs, with no line break anywhere inside it — the guest parses it
 * out of a captured stdout stream with a regex, so a message that wrapped would truncate the
 * outcome. `message` is whitespace-collapsed for exactly that reason.
 */
export function smokeResultLine(nonce: string, res: SubmitResult): string {
  const parts = [SMOKE_RESULT_PREFIX, `outcome=${smokeOutcome(res)}`, `nonce=${nonce}`]
  if (res.ok) {
    parts.push(`reportId=${res.reportId}`, `logUploaded=${String(res.logUploaded)}`)
  } else {
    parts.push('reportId=', `error=${res.error}`, `message=${res.message.replace(/\s+/g, ' ')}`)
  }
  return parts.join(' ')
}
