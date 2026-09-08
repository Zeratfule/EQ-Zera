// codec.ts — bytes, ids and digests, in the WEB dialect.
//
// `src/main/shareCodec.ts` is the app's half of the same wire format and it uses `node:zlib` +
// `Buffer`; neither exists in a Worker, so the deflate-raw side is re-spelled here on
// `CompressionStream`. THE FORMAT IS NOT RE-DECIDED, only re-implemented: this file emits
// `base64url(deflateRaw(utf8(canonicalJson(envelope))))` and `decodeShareString` in the app reads
// it back — `tests/shareServer.test.mts` proves that round trip rather than trusting the claim.
//
// Everything here is standard-library: `CompressionStream`, `crypto.getRandomValues`,
// `crypto.subtle`, `btoa`/`atob`. All four are globals in workerd AND in Node 24, which is what
// lets the root suite drive the handler with no runtime emulation.

/** base64url: `+/` → `-_`, padding stripped. Same alphabet the app's codec writes. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  // Chunked so a large card cannot blow the argument limit of String.fromCharCode.apply.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Standard base64 → bytes, or null when the text is not base64 at all. The card arrives as a
 * base64 string from an untrusted POST body, so "that is not base64" has to be an answerable
 * question rather than a thrown DOMException halfway through a request.
 */
export function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/** Drain a ReadableStream of Uint8Array into one buffer. */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/**
 * `deflateRaw(utf8(text))` as base64url — the payload half of an `EQC1-` string.
 *
 * deflate-raw (no zlib header) because that is what `inflateRawSync` on the other side reads; the
 * prefix already identifies the format, so the two header bytes would buy nothing.
 */
export async function deflateRawBase64Url(text: string): Promise<string> {
  const source = new Blob([new TextEncoder().encode(text)]).stream()
  const deflated = source.pipeThrough(new CompressionStream('deflate-raw'))
  return toBase64Url(await readAll(deflated))
}

/** The id alphabet. No punctuation: an id rides in a URL, a Discord embed and a double-click. */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * A fresh share id: `length` chars drawn UNIFORMLY from the 62-char alphabet.
 *
 * Rejection sampling, not `% 62`: 256 is not a multiple of 62, so the modulo would make the first
 * eight letters ~5% likelier than the rest. That is a small bias and it is also free to avoid.
 */
export function newId(length: number): string {
  let out = ''
  const buf = new Uint8Array(length * 2)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    for (const byte of buf) {
      if (byte >= 248) continue // 248 = 4 * 62; the tail would bias the draw
      out += ID_ALPHABET[byte % 62]
      if (out.length === length) break
    }
  }
  return out
}

/** The private delete token: 32 random bytes, base64url. Returned ONCE, never stored. */
export function newDeleteToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/** SHA-256 of a UTF-8 string, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on strings short-circuits at the first differing character, which leaks the length of a
 * correct prefix. The digests are equal-length by construction, so the loop is honest and cheap.
 */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** A per-response CSP nonce: 16 random bytes, base64url. */
export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}
