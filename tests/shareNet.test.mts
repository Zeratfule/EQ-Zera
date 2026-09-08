// ============================================================================
// shareNet.test.mts — share/net.ts, the origin boundary for share links.
// ============================================================================
//
// The share service is the second compiled-in host this app talks to, and it inherits
// feedback/net.ts's law: ONE origin, no user-configurable override, and a loopback-only dev gate.
// What is pinned here, and why each one is load-bearing:
//
//   * THE NO-OVERRIDE LAW. `SHARE_ORIGIN` is the compiled constant in every shipped build and in
//     every non-Electron process, including this test runner. An overridable share host would let
//     "publish my character card" become "publish it to a host of somebody else's choosing".
//   * THE DEV GATE, driven as DATA (`RuntimeFacts`), so the PACKAGED case is a value rather than
//     an environment nobody can reproduce in a unit test. Packaged, e2e, non-Electron and a
//     non-loopback url each close it on their own.
//   * `parseShareLink`, which is what stands between a pasted string and a main-process fetch.
//     Exact origin, two routes, a closed id class, and a bare id refused — a pasted word must
//     never become a network request.
//
// Same shape as tests/feedbackNet.test.mts: no Electron, no network, no fixtures, so this suite
// NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RuntimeFacts } from '../src/main/feedback/net'
import {
  DEV_SHARE_ENV,
  SHARE_ORIGIN,
  devShareOriginFor,
  isDeleteToken,
  isShareId,
  parseShareLink,
  profileUrlFor,
  recordUrl,
  createUrl,
  shareEndpointConfigured,
  shareOriginFor,
  shareUrlFor
} from '../src/main/share/net'

const COMPILED = 'https://share.eqzera.com'

/** A dev checkout on Windows, which is the only fact set that can open the gate. */
const DEV: RuntimeFacts = {
  execPath: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
  platform: 'win32',
  electron: '33.0.0',
  e2e: false,
  url: 'http://127.0.0.1:8788'
}

// ---- the compiled origin --------------------------------------------------------------------

test('the share origin is the compiled constant, and this process has no override', () => {
  // The test runner is not Electron, so the gate is shut whatever EQ_SHARE_URL says.
  assert.equal(SHARE_ORIGIN, COMPILED)
  assert.equal(shareEndpointConfigured(), true)
  assert.equal(DEV_SHARE_ENV, 'EQ_SHARE_URL')
})

test('an EQ_E2E run is DARK - no origin, so no request is possible at all', () => {
  // The feedback stack's law, applied here (queueFlushEnabled): the headless harness never
  // submits. `share.eqzera.com` is a live host, so "the endpoint is unreachable in e2e" would be
  // an assumption with a shelf life; an empty origin is a structure.
  assert.equal(shareOriginFor(true, ''), '')
  assert.equal(shareOriginFor(true, 'http://127.0.0.1:8788'), '')
  // …and outside it, the dev origin when the gate opened, the compiled constant otherwise.
  assert.equal(shareOriginFor(false, ''), COMPILED)
  assert.equal(shareOriginFor(false, 'http://127.0.0.1:8788'), 'http://127.0.0.1:8788')
})

test('every route is built from that origin and nothing else', () => {
  assert.equal(shareUrlFor('aB3xY9kQ2m'), `${COMPILED}/s/aB3xY9kQ2m`)
  assert.equal(profileUrlFor('aB3xY9kQ2m'), `${COMPILED}/p/aB3xY9kQ2m`)
  assert.equal(createUrl(), `${COMPILED}/api/v1/shares`)
  assert.equal(recordUrl('aB3xY9kQ2m'), `${COMPILED}/api/v1/shares/aB3xY9kQ2m`)
})

// ---- the dev gate ---------------------------------------------------------------------------

test('the dev gate opens only for an unpackaged Electron dev run', () => {
  assert.equal(devShareOriginFor(DEV), 'http://127.0.0.1:8788')
  // PACKAGED — the exe is not electron.exe, which is Electron's own isPackaged definition.
  assert.equal(devShareOriginFor({ ...DEV, execPath: 'C:\\Program Files\\EQ Zera\\EQ Zera.exe' }), '')
  // An exe name we do not recognize reads as packaged: fail-closed, always.
  assert.equal(devShareOriginFor({ ...DEV, execPath: 'C:\\x\\something.exe' }), '')
  // The headless harness never publishes, so it never unlocks either.
  assert.equal(devShareOriginFor({ ...DEV, e2e: true }), '')
  // Not Electron at all (this test runner, a script).
  assert.equal(devShareOriginFor({ ...DEV, electron: undefined }), '')
  assert.equal(devShareOriginFor({ ...DEV, electron: '' }), '')
  // No value to read.
  assert.equal(devShareOriginFor({ ...DEV, url: undefined }), '')
})

test('the dev override is LOOPBACK-ONLY, which is the whole reason it is safe', () => {
  const at = (url: string): string => devShareOriginFor({ ...DEV, url })
  // The two numeric literals, http or https, on any port.
  assert.equal(at('http://127.0.0.1:8788'), 'http://127.0.0.1:8788')
  assert.equal(at('https://127.0.0.1:8788/'), 'https://127.0.0.1:8788')
  assert.equal(at('http://[::1]:8788'), 'http://[::1]:8788')
  // `localhost` is a NAME and resolves through whatever the machine's resolver says today.
  assert.equal(at('http://localhost:8788'), '')
  // Anything that is not loopback, including the real service and a look-alike.
  assert.equal(at('https://share.eqzera.com'), '')
  assert.equal(at('https://evil.com'), '')
  assert.equal(at('http://127.0.0.1.evil.com'), '')
  // Other schemes, credentials, queries and fragments are all refused outright.
  assert.equal(at('file:///C:/x'), '')
  assert.equal(at('http://user:pw@127.0.0.1:8788'), '')
  assert.equal(at('http://127.0.0.1:8788/?x=1'), '')
  assert.equal(at('http://127.0.0.1:8788/#x'), '')
  assert.equal(at('not a url'), '')
  assert.equal(at(''), '')
})

// ---- the closed classes ---------------------------------------------------------------------

test('an id and a token are closed character classes, because both reach a request', () => {
  assert.equal(isShareId('aB3xY9kQ2m'), true)
  assert.equal(isShareId('a'), true)
  // A dot, a slash, a percent escape or a query would let an id address another route.
  assert.equal(isShareId('a/b'), false)
  assert.equal(isShareId('a.b'), false)
  assert.equal(isShareId('a%2fb'), false)
  assert.equal(isShareId('a-b'), false)
  assert.equal(isShareId(''), false)
  assert.equal(isShareId('a'.repeat(33)), false)
  assert.equal(isShareId(42), false)

  // base64url of 32 bytes is 43 chars; the class is base64url and nothing else.
  assert.equal(isDeleteToken('a'.repeat(43)), true)
  assert.equal(isDeleteToken('aB_9-x'.repeat(8)), true)
  assert.equal(isDeleteToken('short'), false)
  assert.equal(isDeleteToken('a'.repeat(43) + '\r\nX-Evil: 1'), false)
  assert.equal(isDeleteToken(null), false)
})

// ---- parseShareLink -------------------------------------------------------------------------

test('parseShareLink accepts the two link shapes this service publishes', () => {
  const id = 'aB3xY9kQ2m'
  assert.equal(parseShareLink(`${COMPILED}/s/${id}`), id)
  assert.equal(parseShareLink(`${COMPILED}/p/${id}`), id)
  // A trailing slash, a query a chat client appended, a fragment, surrounding whitespace.
  assert.equal(parseShareLink(`${COMPILED}/s/${id}/`), id)
  assert.equal(parseShareLink(`${COMPILED}/s/${id}?utm=discord`), id)
  assert.equal(parseShareLink(`${COMPILED}/s/${id}#card`), id)
  assert.equal(parseShareLink(`  ${COMPILED}/s/${id}  `), id)
  // An explicit :443 is the default port, not a different service - WHATWG strips it.
  assert.equal(parseShareLink(`https://share.eqzera.com:443/s/${id}`), id)
  // The host is normalized by `new URL()`, so a shouty spelling is the same host.
  assert.equal(parseShareLink(`https://SHARE.EQZERA.COM/s/${id}`), id)
})

test('parseShareLink refuses everything that is not one', () => {
  const id = 'aB3xY9kQ2m'
  // EXACT origin, never a suffix match.
  assert.equal(parseShareLink(`https://share.eqzera.com.evil.com/s/${id}`), null)
  assert.equal(parseShareLink(`https://evil-share.eqzera.com/s/${id}`), null)
  assert.equal(parseShareLink(`https://eqzera.com/s/${id}`), null)
  // http is a silent downgrade, and a non-default port is a different service.
  assert.equal(parseShareLink(`http://share.eqzera.com/s/${id}`), null)
  assert.equal(parseShareLink(`https://share.eqzera.com:8443/s/${id}`), null)
  // Credentials in the URL are refused outright.
  assert.equal(parseShareLink(`https://u:p@share.eqzera.com/s/${id}`), null)
  // Only the two routes, and only ONE path segment under them.
  assert.equal(parseShareLink(`${COMPILED}/api/v1/shares`), null)
  assert.equal(parseShareLink(`${COMPILED}/c/${id}.png`), null)
  assert.equal(parseShareLink(`${COMPILED}/s`), null)
  assert.equal(parseShareLink(`${COMPILED}/s/${id}/extra`), null)
  assert.equal(parseShareLink(COMPILED), null)
  // An id outside the closed class, including the traversal spellings `new URL()` resolves away.
  assert.equal(parseShareLink(`${COMPILED}/s/a.b`), null)
  assert.equal(parseShareLink(`${COMPILED}/s/${'a'.repeat(40)}`), null)
  assert.equal(parseShareLink(`${COMPILED}/s/../api/v1/shares`), null)
  // A BARE ID IS NOT A LINK. A pasted word must never become a network request.
  assert.equal(parseShareLink(id), null)
  // Neither is a share string, which is what the other decoder is for.
  assert.equal(parseShareLink('EQC1-abcdef'), null)
  assert.equal(parseShareLink(''), null)
  assert.equal(parseShareLink(undefined), null)
  assert.equal(parseShareLink(`${COMPILED}/s/${id}?${'x'.repeat(4000)}`), null)
})
