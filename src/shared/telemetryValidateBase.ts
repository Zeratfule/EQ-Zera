// ============================================================================
// TELEMETRY VALIDATION PRIMITIVES — the seven checks every event validator is built from.
// ============================================================================
//
// A THIRD FILE IN A ONE-DEFINITION SET, and it exists for exactly the reason the second one
// does. `./telemetry.ts` (the contract) split off `./telemetryValidate.ts` (the validators) when
// the pair passed the repo's 400-code-line factoring ceiling; JOS-100's `errorReport` pushed the
// validators past it in turn, and the answer here is a split rather than a widened threshold —
// the same call `usageStore.ts`, `AnalyticsBits.tsx`, `releaseHealth.ts` and `windowErrors.ts`
// all made.
//
// WHY THIS CUT AND NOT ANOTHER. `telemetryValidateError.ts` needs `fail`, `oneOf`, `whole`,
// `bucket` and `matching`; so does `telemetryValidate.ts`. Exporting them from the latter and
// importing them back would make the two files a CYCLE — which ESM tolerates and reviewers do
// not, and which would put a live import loop under the app's own privacy boundary. Lifting the
// shared bottom into a leaf that imports nothing but a type is the version of that with no loop.
//
// PURE and total, like everything else in this set: every failure is a typed value, nothing
// throws, and the same input always gives the same answer. It bundles into the ingest Lambda.

export interface TelemetryValidationFailure {
  ok: false
  error: 'invalid_event'
  /** Safe to render verbatim: it names the field and the legal values, nothing internal. */
  message: string
  /** Dotted path of the offending field. */
  field: string
}

export type Validated<T> = { ok: true; value: T } | TelemetryValidationFailure

export const fail = (field: string, message: string): TelemetryValidationFailure => ({
  ok: false,
  error: 'invalid_event',
  message,
  field
})

export function oneOf<T extends string>(
  raw: unknown,
  field: string,
  allowed: readonly T[]
): Validated<T> {
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as T }
  }
  return fail(field, `${field} must be one of: ${allowed.join(', ')}.`)
}

/** A whole number in `[0, max]`. Every count and every duration in the schema goes through it. */
export function whole(raw: unknown, field: string, max: number): Validated<number> {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0 || raw > max) {
    return fail(field, `${field} must be a whole number between 0 and ${String(max)}.`)
  }
  return { ok: true, value: raw }
}

/** A bucket INDEX for `edges` — `0 .. edges.length`. */
export function bucket(raw: unknown, field: string, edges: readonly number[]): Validated<number> {
  return whole(raw, field, edges.length)
}

export function flag(raw: unknown, field: string): Validated<boolean> {
  if (typeof raw !== 'boolean') return fail(field, `${field} must be true or false.`)
  return { ok: true, value: raw }
}

export function matching(
  raw: unknown,
  field: string,
  re: RegExp,
  what: string
): Validated<string> {
  if (typeof raw === 'string' && re.test(raw)) return { ok: true, value: raw }
  return fail(field, `${field} must be ${what}.`)
}

/** An integer in `[min, max]` (the one signed field: the timezone bucket). */
export function signedInt(
  raw: unknown,
  field: string,
  min: number,
  max: number
): Validated<number> {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min || raw > max) {
    return fail(field, `${field} must be a whole number between ${String(min)} and ${String(max)}.`)
  }
  return { ok: true, value: raw }
}
