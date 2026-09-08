// characterShare.ts — the CHARACTER PROFILE half of share strings, main-side.
//
// The same three-layer arrangement `share.ts` has, for the same reason: the RULES are pure
// (`src/shared/characterShare.ts` — the projection, the sanitizer, the text summary), the WIRE
// FORMAT is `shareCodec.ts` (pure + `node:zlib`), and this file is the thin layer that bolts the
// two together so there is exactly ONE encoder and ONE decoder in the app.
//
// WHY THE RENDERER CANNOT DO THIS ITSELF, stated once because it is the ticket's one structural
// surprise: `EQC1-` is `base64url(deflateRaw(canonicalJson(envelope)))`, and deflate lives in
// `node:zlib`. A renderer-side codec would be a second implementation of the format — the exact
// thing shareCodec.ts's header rules out — and a stored-block encoder written to dodge that would
// answer strings four times the size that no other producer would ever match. So the Character
// tab's Share dialog asks main to encode, and asks main to decode a pasted one, over two channels
// beside the image one (`character:shareString`, `character:readShare`).
//
// THE PROFILE IS SANITIZED ON THE WAY OUT AS WELL AS ON THE WAY IN. The renderer built it, and a
// renderer value is untrusted at the handler whether or not today's only caller is this app's own
// UI (AGENTS.md, the trust-boundary rule). Sanitizing before encoding also guarantees the wire
// shape matches the schema exactly, with no stray key a future sheet field could add — the same
// argument `buildAlertSetBody` makes for re-sanitizing on export.

import { SHARE_ERROR_TEXT, makeEnvelope } from '../shared/profiles'
import { sanitizeCharacterShare, type CharacterProfileShare } from '../shared/characterShare'
import { decodeShareString, encodeShareString } from './shareCodec'

/** What a decode answers with: a profile this app may draw, or prose saying why not. */
export type CharacterShareRead =
  | { ok: true; profile: CharacterProfileShare; appVersion: string; createdAt: string }
  | { ok: false; error: string }

/** Encode a profile into its single-line share string, or null when there is nothing in it. */
export function encodeCharacterShare(profile: unknown, appVersion: string): string | null {
  const body = sanitizeCharacterShare(profile)
  if (!body) return null
  return encodeShareString(makeEnvelope('character', body, appVersion))
}

/**
 * Decode a pasted string into a profile. NEVER throws and never surfaces a stack: every failure
 * comes back as the validator's own user-facing prose, which is what the paste box prints.
 *
 * A string that decodes to some OTHER kind is refused in its own words rather than through the
 * generic 'unknown-kind' line, because the reader is holding a real share string and the useful
 * thing to say is where it belongs.
 */
export function decodeCharacterShare(text: string): CharacterShareRead {
  const decoded = decodeShareString(text)
  if (!decoded.ok) return { ok: false, error: SHARE_ERROR_TEXT[decoded.error] }
  const env = decoded.envelope
  if (env.kind !== 'character') {
    return {
      ok: false,
      error: 'That share string carries settings, not a character. Import it under Preferences.'
    }
  }
  const profile = sanitizeCharacterShare(env.body)
  if (!profile) return { ok: false, error: SHARE_ERROR_TEXT['empty-payload'] }
  return { ok: true, profile, appVersion: env.app, createdAt: env.at }
}

/** A suggested file name for the card image - dated, so a folder of shares self-sorts. */
export function shareImageName(name: string): string {
  const day = new Date().toISOString().slice(0, 10)
  // Anything that is not a plain name character becomes a dash: this string reaches a save
  // dialog's default path, and the renderer supplied it.
  const stem = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `eq-zera-${stem || 'character'}-${day}.png`
}
