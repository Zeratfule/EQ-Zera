// http.ts — the response vocabulary, and the two gates every request passes through.
//
// TWO HEADERS ARE NOT NEGOTIABLE and so they are applied HERE rather than at each of the seven
// route handlers: `X-Content-Type-Options: nosniff` on every response (this service serves an
// attacker-supplied PNG and an attacker-influenced HTML page from ONE origin — content sniffing
// is exactly how those two become each other), and a strict `Content-Security-Policy` on the HTML.
// A route that forgets one would be a hole nobody notices, so no route gets the chance.
//
// Errors are `{ error, message }` with the status codes the spec names (400/401/404/413/415/429).
// The `error` code is the machine-readable half — the app's `src/main/share/links.ts` reads it —
// and `message` is one sentence a human can act on.

import type { RateLimiterLike } from './env'

/** On EVERY response, without exception. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extra }
  })
}

/** A refusal, in the one shape every refusal takes. */
export function errorResponse(status: number, error: string, message: string): Response {
  return jsonResponse({ error, message }, status, { 'Cache-Control': 'no-store' })
}

/**
 * The HTML page's CSP. `default-src 'none'` is the whole design: no fetch, no frame, no font, no
 * connect — the page is text and one same-origin image. The single `<style>` and single `<script>`
 * carry the per-response nonce, so even a hypothetical injection that survived `esc()` could not
 * execute.
 */
export function htmlResponse(html: string, nonce: string): Response {
  const csp = [
    "default-src 'none'",
    "img-src 'self'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
  return new Response(html, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'public, max-age=300'
    }
  })
}

/** The card, straight out of KV. Public and cacheable: the bytes never change under an id. */
export function pngResponse(png: ArrayBuffer): Response {
  return new Response(png, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600'
    }
  })
}

/** A successful DELETE. No body, by definition. */
export function noContentResponse(): Response {
  return new Response(null, { status: 204, headers: { ...BASE_HEADERS } })
}

export function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: location } })
}

/**
 * Who to count a request against. `CF-Connecting-IP` is set by the edge and cannot be spoofed by
 * the client; the fallbacks exist so `wrangler dev` and the unit suite take the same path rather
 * than a special case, and they all collapse to one bucket, which is the safe direction.
 */
export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'anon'
  )
}

/**
 * `true` when the request must be refused. AN ABSENT BINDING IS ALLOWED: `wrangler dev` and the
 * test suite run without the unsafe binding, and inventing a second "no limiter" branch would mean
 * the deployed path is the one nothing exercises.
 */
export async function rateLimited(
  limiter: RateLimiterLike | undefined,
  key: string
): Promise<boolean> {
  if (!limiter) return false
  const verdict = await limiter.limit({ key })
  return !verdict.success
}

/** The delete token out of `Authorization: Bearer <token>`, or null when it is not there. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/.exec(header.trim())
  return match ? (match[1] ?? null) : null
}
