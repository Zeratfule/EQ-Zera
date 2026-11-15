// patchNotes/net.ts — the one outbound origin the patch notes use, and the GET that reaches it.
//
// A DELIBERATE OUTBOUND ORIGIN (AGENTS.md "Cloud"): `https://www.everquestlegends.com`, GET only,
// from main only, 15 s per request, a plain browser User-Agent and nothing else in the request.
// No cookie, no id, no version, no character: the developer's site learns that somebody read
// its public patch notes page, which is what a browser visit tells it too.
//
// UNDER `EQ_E2E` THE ORIGIN IS DARK unless the harness names a LOOPBACK stub in
// `EQ_E2E_PATCH_NOTES_ORIGIN` (tests/e2e/patch-notes.e2e.mts serves committed fixtures there), so
// the headless suite can never reach the live site. A packaged build never reads the variable.
//
// Electron-free: tests/patchNotesRun.test.mts loads it directly.

import { PATCH_NOTES_ORIGIN } from '../../shared/patchNotes'

export const E2E_ORIGIN_ENV = 'EQ_E2E_PATCH_NOTES_ORIGIN'
export const REQUEST_TIMEOUT_MS = 15_000
/** A patch notes page is ~30 kB; anything past this is not one. */
export const MAX_PAGE_BYTES = 4 * 1024 * 1024
/** A browser's, because the site serves browsers. It names nothing about this app or its user. */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

/** `http://127.0.0.1:<port>` exactly, normalized, or ''. Numeric loopback only: a name could resolve anywhere. */
export function loopbackOrigin(raw: string | undefined): string {
  if (raw === undefined || raw.length === 0 || raw.length > 64) return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1') return ''
    if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '' || u.pathname !== '/') return ''
    return u.origin
  } catch {
    return ''
  }
}

/** The origin this process talks to. '' means no request is possible. */
export function patchNotesOriginFor(e2e: boolean, envValue: string | undefined): string {
  return e2e ? loopbackOrigin(envValue) : PATCH_NOTES_ORIGIN
}

/**
 * GET a page as text. Rejects on a network error, the timeout, a non-2xx status, a redirect that
 * leaves `origin`, or a body over the size cap.
 */
export async function fetchPageText(url: string, origin: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    credentials: 'omit',
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (res.url !== '' && new URL(res.url).origin !== origin) throw new Error('redirected off the patch notes origin')
  if (!res.ok) throw new Error(`HTTP ${String(res.status)}`)
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_PAGE_BYTES) throw new Error('page too large')
  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_PAGE_BYTES) throw new Error('page too large')
  return new TextDecoder('utf-8').decode(buf)
}
