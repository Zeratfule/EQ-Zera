// ============================================================================
// syncCrypto.test.mts — the promise "the service stores bytes it cannot read", made checkable.
// ============================================================================
//
// No Electron, no network, no fixtures, so this suite NEVER skips. What is guarded, and why each
// one is load-bearing:
//
//   * THE ROUND TRIP, WITH AND WITHOUT THE CHANNELS. A settings-only payload and one carrying
//     Discord channels both survive encrypt -> decrypt byte-for-byte; the channels are the half
//     that is opt-in, and a silent loss there would look exactly like "the box did nothing".
//   * THE CODE FORMAT IS A CONTRACT WITH A PERSON WHO TYPES. It is `<service code>-<key>`, split at
//     the FIRST hyphen (base64url can contain one, the service code cannot), and parsing is lenient
//     about the ways a code gets carried across a room - spaces, a wrapped line, quotes - and
//     STRICT about case, because both halves are case-sensitive and folding one would refuse a code
//     the user typed exactly right.
//   * A FLIPPED BYTE FAILS CLEANLY. GCM's tag is what makes tampering a refusal rather than
//     garbage, and `decryptSyncBlob` must answer null for it - never throw, never half a payload.
//   * A WRONG KEY IS THE SAME EVENT. Which is what lets the app say one honest sentence about both.
//   * AND AUTHENTICITY IS NOT SHAPE. A payload that decrypts is still parsed: a wrong version is
//     refused, and a channel whose token is not in the closed class is dropped rather than stored.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { DiscordChannel } from '../src/shared/discordChannels'
import {
  decryptSyncBlob,
  encryptSyncPayload,
  formatTransferCode,
  mintSyncKey,
  parseTransferCode,
  sanitizeSyncPayload,
  SYNC_KEY_BYTES,
  type SyncPayload
} from '../src/main/share/syncCrypto'

/** A settings bundle, standing in for the real `EQC1-` line (this file never encodes one). */
const SETTINGS = `EQC1-${'abcDEF012_-'.repeat(20)}`

/** The service's own id shape: ten characters out of `[A-Za-z0-9]`. */
const CODE = 'Ab3dE9fGh1'

/** One connected channel, in the classes `shared/discordWebhook.ts` states. */
const CHANNEL: DiscordChannel = {
  id: '1234567890123456789',
  token: 'abcdefghij'.repeat(6).concat('12345678'),
  channelId: '9876543210987654321',
  guildId: '1122334455667788990',
  label: '#gear · Guild of Thieves',
  addedAt: 1_757_000_000_000
}

function payload(extra?: Partial<SyncPayload>): SyncPayload {
  return { v: 1, settings: SETTINGS, ...extra }
}

// ---- the round trip ---------------------------------------------------------------------------

test('a settings payload survives encrypt -> decrypt unchanged', () => {
  const key = mintSyncKey()
  assert.equal(key.length, SYNC_KEY_BYTES)
  const blob = encryptSyncPayload(payload(), key)
  // The blob is base64 and carries no plaintext at all - the settings string is not in it.
  assert.ok(!blob.includes('EQC1-'))
  assert.deepEqual(decryptSyncBlob(blob, key), payload())
})

test('the Discord channels ride along when they are included', () => {
  const key = mintSyncKey()
  const sent = payload({ discordChannels: [CHANNEL] })
  const back = decryptSyncBlob(encryptSyncPayload(sent, key), key)
  assert.deepEqual(back, sent)
  assert.equal(back?.discordChannels?.[0]?.token, CHANNEL.token)
})

test('two encryptions of the same payload are different bytes', () => {
  // A FRESH NONCE EVERY TIME. Two identical bundles must not be recognizable as identical on the
  // service, and a repeated nonce under one key is the one thing GCM cannot survive.
  const key = mintSyncKey()
  assert.notEqual(encryptSyncPayload(payload(), key), encryptSyncPayload(payload(), key))
})

// ---- the code ---------------------------------------------------------------------------------

test('a transfer code is the service code, a hyphen, and the key', () => {
  const key = Buffer.from('000102030405060708090a0b', 'hex')
  const code = formatTransferCode(CODE, key)
  assert.equal(code, `${CODE}-${key.toString('base64url')}`)
  // 10 + 1 + 16: twelve random bytes is exactly sixteen base64url characters, no padding.
  assert.equal(code.length, 27)
  const parsed = parseTransferCode(code)
  assert.equal(parsed?.code, CODE)
  assert.deepEqual(parsed?.key, key)
})

test('parsing is lenient about how a code was carried across the room', () => {
  const key = mintSyncKey()
  const code = formatTransferCode(CODE, key)
  for (const typed of [
    `  ${code}  `,
    `${code}\n`,
    `${code.slice(0, 6)} ${code.slice(6)}`,
    `\`${code}\``,
    `"${code}"`,
    `${code.slice(0, 14)}\n${code.slice(14)}`
  ]) {
    const parsed = parseTransferCode(typed)
    assert.equal(parsed?.code, CODE, JSON.stringify(typed))
    assert.deepEqual(parsed?.key, key, JSON.stringify(typed))
  }
})

test('CASE IS NOT FOLDED, because both halves are case-sensitive', () => {
  const key = mintSyncKey()
  const code = formatTransferCode(CODE, key)
  const lowered = parseTransferCode(code.toLowerCase())
  // It still PARSES (both halves are still in their classes) - it simply is not the same transfer,
  // which is the honest outcome: re-casing somebody's code would address a different record.
  assert.notEqual(lowered?.code, CODE)
})

test('anything that is not a transfer code is refused', () => {
  for (const text of [
    '',
    CODE,
    `${CODE}-`,
    `-${'a'.repeat(16)}`,
    `Ab3dE9fGh1-${'a'.repeat(4)}`,
    `Ab3/E9fGh1-${'a'.repeat(16)}`,
    `../api/v1-${'a'.repeat(16)}`,
    `https://share.eqzera.com/s/${CODE}`,
    'EQC1-abcdef',
    42,
    null,
    undefined,
    `${CODE}-${'a'.repeat(600)}`
  ]) {
    assert.equal(parseTransferCode(text), null, JSON.stringify(text))
  }
})

// ---- tampering and the wrong key --------------------------------------------------------------

/** Flip one bit of the blob at `at`, and hand back the re-encoded string. */
function bend(blob: string, at: number): string {
  const raw = Buffer.from(blob, 'base64')
  raw[at] = (raw[at] ?? 0) ^ 0x01
  return raw.toString('base64')
}

test('a flipped byte - anywhere - fails cleanly rather than throwing', () => {
  const key = mintSyncKey()
  const blob = encryptSyncPayload(payload({ discordChannels: [CHANNEL] }), key)
  const raw = Buffer.from(blob, 'base64')
  // The nonce, the tag, and the ciphertext itself: three regions, all authenticated.
  for (const at of [0, 12, 20, raw.length - 1]) {
    assert.equal(decryptSyncBlob(bend(blob, at), key), null, String(at))
  }
  // …and so does a truncated one, which is what a copy that lost its tail looks like.
  assert.equal(decryptSyncBlob(blob.slice(0, 20), key), null)
  assert.equal(decryptSyncBlob('', key), null)
  assert.equal(decryptSyncBlob('not base64 at all!!', key), null)
  assert.equal(decryptSyncBlob(null, key), null)
})

test('a wrong key opens nothing, and says so the same way', () => {
  const blob = encryptSyncPayload(payload(), mintSyncKey())
  assert.equal(decryptSyncBlob(blob, mintSyncKey()), null)
  // Including a key of the right SHAPE but the wrong length - it is hashed, so nothing rejects it
  // before the tag does.
  assert.equal(decryptSyncBlob(blob, randomBytes(32)), null)
})

// ---- the plaintext is still parsed -------------------------------------------------------------

test('a payload of an unknown version is refused rather than read for what it recognizes', () => {
  const key = mintSyncKey()
  const blob = encryptSyncPayload({ v: 2, settings: SETTINGS } as SyncPayload, key)
  assert.equal(decryptSyncBlob(blob, key), null)
})

test('a channel that is not in the closed classes is dropped, and duplicates collapse', () => {
  const good = sanitizeSyncPayload({
    v: 1,
    settings: SETTINGS,
    discordChannels: [CHANNEL, { ...CHANNEL, label: 'second copy' }, { id: 'nope', token: 'nope' }, 7]
  })
  assert.equal(good?.discordChannels?.length, 1)
  assert.equal(good.discordChannels?.[0]?.label, CHANNEL.label)

  // …and the shapes that are not a payload at all.
  for (const raw of [null, 'string', [], { v: 1 }, { v: 1, settings: '' }, { settings: SETTINGS }]) {
    assert.equal(sanitizeSyncPayload(raw), null, JSON.stringify(raw))
  }
})

test('an empty channel list is not a field, so a payload without one round-trips identically', () => {
  const cleaned = sanitizeSyncPayload({ v: 1, settings: SETTINGS, discordChannels: [] })
  assert.deepEqual(cleaned, { v: 1, settings: SETTINGS })
  assert.equal(cleaned !== null && 'discordChannels' in cleaned, false)
})
