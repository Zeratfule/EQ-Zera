// ============================================================================
// syncSettings.test.mts — share/sync.ts, the round trips behind "send my settings to my other PC".
// ============================================================================
//
// `fetch` and every impure seam are INJECTED, so every claim below is made without a network,
// without Electron and without a store. What is guarded, and why each one is load-bearing:
//
//   * THE SERVICE ONLY EVER SEES CIPHERTEXT. The POST body is `{ blob }` and nothing else: the
//     settings string does not appear in it, and neither does the key. The test proves it the only
//     way that means anything - by taking the key out of the CODE the user was shown and opening
//     the blob the service was sent.
//   * THE KEY IS NEVER IN A URL. A read addresses `/api/v1/sync/<service code>`; the half of the
//     transfer code that opens the blob must not travel in a request path, a query or a header.
//   * THE DISCORD CHANNELS TRAVEL ONLY WHEN THE SENDER SAYS SO, and are STORED only when the
//     receiver says so. They are webhook credentials; two independent answers, both default off.
//   * A DUPLICATE IS A SKIP, NOT A REPLACE. A channel this install already holds may have been
//     renamed or made the default, and re-adding it would quietly undo both.
//   * AND NOTHING THROWS. A transport failure, a 404, a 413 and a blob that does not decrypt are
//     all `{ ok: false, error: <sentence> }`, because these results cross an IPC boundary.
//
// No Electron, no network, no fixtures, so this suite NEVER skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordChannel } from '../src/shared/discordChannels'
import type { ShareApplyResult, SharePreview } from '../src/shared/profiles'
import { SYNC_ERROR } from '../src/shared/settingsSync'
import { SHARE_ORIGIN } from '../src/main/share/net'
import { applyReceivedSettings, receiveSettings, sendSettings, type SyncDeps } from '../src/main/share/sync'
import { decryptSyncBlob, encryptSyncPayload, parseTransferCode } from '../src/main/share/syncCrypto'

const CODE = 'Ab3dE9fGh1'
const EXPIRES = '2026-09-13T12:00:00.000Z'
const SETTINGS = `EQC1-${'abcDEF012_-'.repeat(10)}`

/** A connected channel, in the classes `shared/discordWebhook.ts` states. */
function channel(n: number, label = `#channel-${String(n)}`): DiscordChannel {
  return {
    id: `12345678901234567${String(n).padStart(2, '0')}`,
    token: 'abcdefghij'.repeat(6).concat('1234567', String(n)),
    channelId: '9876543210987654321',
    guildId: '1122334455667788990',
    label,
    addedAt: 1_757_000_000_000
  }
}

/** A preview that would add something. The planner's own shape; nothing here re-implements it. */
const PREVIEW: SharePreview = {
  ok: true,
  kind: 'settings',
  alerts: [],
  scalars: [{ id: 'alertPrefs.globalVolume', label: 'Alert volume', current: '50', incoming: '80' }],
  missingPacks: [],
  text: SETTINGS
}

const APPLIED: ShareApplyResult = { ok: true, added: 2, skipped: 1, rekeyed: 0, scalarsApplied: 1, ui: { 'eq.combat.scope': 'fight' } }

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

interface Reply {
  status: number
  json?: unknown
  text?: string
}

/** The deps, with a scripted transport and an in-memory channel list. */
function rig(
  replies: Reply[] | 'throws',
  opts: { channels?: DiscordChannel[]; preview?: SharePreview; applied?: ShareApplyResult } = {}
): { deps: SyncDeps; calls: Call[]; stored: DiscordChannel[]; exported: string } {
  const calls: Call[] = []
  const queue = replies === 'throws' ? [] : [...replies]
  const stored = [...(opts.channels ?? [])]
  const fetchFn = (input: unknown, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === 'string' ? init.body : ''
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: raw === '' ? null : (JSON.parse(raw) as unknown)
    })
    if (replies === 'throws') return Promise.reject(new Error('fetch failed'))
    const next = queue.shift() ?? { status: 500 }
    const text = next.text ?? (next.json === undefined ? '' : JSON.stringify(next.json))
    return Promise.resolve({ status: next.status, text: () => Promise.resolve(text) } as Response)
  }
  const deps: SyncDeps = {
    fetch: fetchFn as unknown as typeof globalThis.fetch,
    exportSettings: () => SETTINGS,
    previewSettings: () => opts.preview ?? PREVIEW,
    applySettings: () => opts.applied ?? APPLIED,
    listChannels: () => [...stored],
    addChannel: (c) => {
      stored.push(c)
      return true
    }
  }
  return { deps, calls, stored, exported: SETTINGS }
}

const created: Reply = { status: 201, json: { code: CODE, expiresAt: EXPIRES } }

/** What the service was sent, decrypted with the key out of the code the user was shown. */
function openSent(code: string, call: Call | undefined): ReturnType<typeof decryptSyncBlob> {
  const parsed = parseTransferCode(code)
  assert.ok(parsed)
  const blob = (call?.body as { blob?: string } | null)?.blob
  return decryptSyncBlob(blob, parsed.key)
}

// ---- sending ----------------------------------------------------------------------------------

test('a send POSTs ciphertext alone, and the code the user gets is what opens it', async () => {
  const { deps, calls } = rig([created])
  const res = await sendSettings({ ui: {}, includeDiscord: false }, deps)
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.code.startsWith(`${CODE}-`), true)
  assert.equal(res.expiresAt, EXPIRES)

  assert.equal(calls.length, 1)
  const call = calls[0]
  assert.equal(call?.method, 'POST')
  assert.equal(call?.url, `${SHARE_ORIGIN}/api/v1/sync`)
  assert.equal(call?.headers['Content-Type'], 'application/json')
  // THE BODY IS ONE FIELD, and the settings are not in it in any readable form.
  assert.deepEqual(Object.keys(call?.body as object), ['blob'])
  assert.equal(JSON.stringify(call?.body).includes('EQC1-'), false)
  // …and the key half of the code, which never left this machine, is what opens what was sent.
  assert.equal(openSent(res.code, call)?.settings, SETTINGS)
})

test('the Discord channels travel ONLY when the sender ticked the box', async () => {
  const channels = [channel(1), channel(2)]
  const off = rig([created], { channels })
  const a = await sendSettings({ ui: {}, includeDiscord: false }, off.deps)
  assert.equal(a.ok, true)
  if (!a.ok) return
  assert.equal(openSent(a.code, off.calls[0])?.discordChannels, undefined)

  const on = rig([created], { channels })
  const b = await sendSettings({ ui: {}, includeDiscord: true }, on.deps)
  assert.equal(b.ok, true)
  if (!b.ok) return
  const sent = openSent(b.code, on.calls[0])
  assert.equal(sent?.discordChannels?.length, 2)
  assert.equal(sent?.discordChannels?.[0]?.token, channels[0]?.token)
})

test('every send failure is one short sentence, and nothing throws', async () => {
  const cases: [Reply | 'throws', string][] = [
    ['throws', SYNC_ERROR.offline],
    [{ status: 413 }, SYNC_ERROR.tooBig],
    [{ status: 429 }, SYNC_ERROR.busy],
    [{ status: 400 }, SYNC_ERROR.refused],
    [{ status: 500 }, SYNC_ERROR.refused],
    [{ status: 201, json: { expiresAt: EXPIRES } }, SYNC_ERROR.badReply],
    [{ status: 201, json: { code: 'a/b' } }, SYNC_ERROR.badReply],
    [{ status: 201, text: '<html>oops</html>' }, SYNC_ERROR.badReply]
  ]
  for (const [reply, sentence] of cases) {
    const { deps } = rig(reply === 'throws' ? 'throws' : [reply])
    const res = await sendSettings({ ui: {}, includeDiscord: false }, deps)
    assert.equal(res.ok, false, JSON.stringify(reply))
    if (res.ok) continue
    assert.equal(res.error, sentence, JSON.stringify(reply))
    // A sentence, not a stack: no status codes, no host names, no verbs.
    assert.ok(!/\d{3}|http|fetch/i.test(res.error), res.error)
  }
})

// ---- receiving --------------------------------------------------------------------------------

/** The service's reply for a payload encrypted under the key inside `code`. */
function serving(code: string, extra?: { discordChannels?: DiscordChannel[] }): Reply {
  const parsed = parseTransferCode(code)
  assert.ok(parsed)
  const blob = encryptSyncPayload({ v: 1, settings: SETTINGS, ...extra }, parsed.key)
  return { status: 200, json: { blob, expiresAt: EXPIRES } }
}

/** A transfer code whose key is ours to script with. */
function transferCode(): string {
  return `${CODE}-${Buffer.from('0102030405060708090a0b0c', 'hex').toString('base64url')}`
}

test('a receive GETs the SERVICE CODE only - the key never reaches a URL', async () => {
  const code = transferCode()
  const { deps, calls } = rig([serving(code)])
  const res = await receiveSettings(code, {}, deps)
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.method, 'GET')
  assert.equal(calls[0]?.url, `${SHARE_ORIGIN}/api/v1/sync/${CODE}`)
  const keyHalf = code.slice(CODE.length + 1)
  assert.equal(calls[0]?.url.includes(keyHalf), false)
  assert.equal(JSON.stringify(calls[0]?.headers).includes(keyHalf), false)
  // The preview is the paste box's own, and the payload is answered to MAIN, never further.
  assert.equal(res.preview.ok, true)
  assert.equal(res.payload.settings, SETTINGS)
  assert.equal(res.discordChannels, undefined)
})

test('a transfer carrying channels reports HOW MANY, never the channels', async () => {
  const code = transferCode()
  const { deps } = rig([serving(code, { discordChannels: [channel(1), channel(2)] })])
  const res = await receiveSettings(code, {}, deps)
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.discordChannels, 2)
  // The renderer's half of this reply is built in src/main/ipc/sync.ts out of exactly these two
  // fields; the payload beside them is what stays in main.
  assert.equal(res.payload.discordChannels?.length, 2)
})

test('a code that is not one is refused before a request is made', async () => {
  for (const text of ['', 'hello', CODE, `${CODE}-`, 'EQC1-abcdef', 42]) {
    const { deps, calls } = rig([serving(transferCode())])
    const res = await receiveSettings(text, {}, deps)
    assert.equal(res.ok, false, JSON.stringify(text))
    if (res.ok) continue
    assert.equal(res.error, SYNC_ERROR.badCode)
    assert.equal(calls.length, 0, JSON.stringify(text))
  }
})

test('an expired, unreachable or undecryptable transfer each says which', async () => {
  const code = transferCode()

  const gone = rig([{ status: 404 }])
  const expired = await receiveSettings(code, {}, gone.deps)
  assert.equal(expired.ok, false)
  if (!expired.ok) assert.equal(expired.error, SYNC_ERROR.expired)

  const dead = rig('throws')
  const offline = await receiveSettings(code, {}, dead.deps)
  assert.equal(offline.ok, false)
  if (!offline.ok) assert.equal(offline.error, SYNC_ERROR.offline)

  const busy = rig([{ status: 429 }])
  const tooMany = await receiveSettings(code, {}, busy.deps)
  assert.equal(tooMany.ok, false)
  if (!tooMany.ok) assert.equal(tooMany.error, SYNC_ERROR.busy)

  // A BLOB THAT BELONGS TO A DIFFERENT CODE. From out here a wrong key and a bent byte are the
  // same event, and the sentence says the true thing about both.
  const other = rig([serving(`${CODE}-${Buffer.from('ffffffffffffffffffffffff', 'hex').toString('base64url')}`)])
  const mismatch = await receiveSettings(code, {}, other.deps)
  assert.equal(mismatch.ok, false)
  if (!mismatch.ok) assert.equal(mismatch.error, SYNC_ERROR.undecryptable)

  // …and a reply with no blob in it at all.
  const empty = rig([{ status: 200, json: { expiresAt: EXPIRES } }])
  const nothing = await receiveSettings(code, {}, empty.deps)
  assert.equal(nothing.ok, false)
  if (!nothing.ok) assert.equal(nothing.error, SYNC_ERROR.undecryptable)
})

test('a transfer whose settings the planner refuses gets the paste box own prose', async () => {
  const code = transferCode()
  const refused: SharePreview = { ok: false, error: 'That share string looks cut off.', alerts: [], scalars: [], missingPacks: [], text: '' }
  const { deps } = rig([serving(code)], { preview: refused })
  const res = await receiveSettings(code, {}, deps)
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.error, 'That share string looks cut off.')
})

// ---- applying ---------------------------------------------------------------------------------

test('an apply runs the existing merge and hands back the localStorage writes', () => {
  const { deps, stored } = rig([])
  const res = applyReceivedSettings(
    { v: 1, settings: SETTINGS, discordChannels: [channel(1)] },
    {},
    { includeDiscord: false },
    deps
  )
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.added, 2)
  assert.equal(res.scalarsApplied, 1)
  assert.deepEqual(res.ui, { 'eq.combat.scope': 'fight' })
  // THE RECEIVER DID NOT CONFIRM THE CHANNELS, so nothing was stored.
  assert.equal(res.channelsAdded, 0)
  assert.equal(stored.length, 0)
})

test('the channels are stored only on confirmation, and a duplicate webhook is skipped', () => {
  const mine = channel(1, 'my own name for it')
  const { deps, stored } = rig([], { channels: [mine] })
  const res = applyReceivedSettings(
    { v: 1, settings: SETTINGS, discordChannels: [channel(1, 'their name'), channel(2)] },
    {},
    { includeDiscord: true },
    deps
  )
  assert.equal(res.ok, true)
  if (!res.ok) return
  assert.equal(res.channelsAdded, 1)
  assert.equal(stored.length, 2)
  // The row this install already had is untouched - its label is still the one the user chose.
  assert.equal(stored[0]?.label, 'my own name for it')
  assert.equal(stored[1]?.label, '#channel-2')
})

test('a merge that refuses is a sentence, and stores no channel either', () => {
  const refused: ShareApplyResult = { ok: false, error: 'That bundle is empty.', added: 0, skipped: 0, rekeyed: 0, scalarsApplied: 0, ui: {} }
  const { deps, stored } = rig([], { applied: refused })
  const res = applyReceivedSettings(
    { v: 1, settings: SETTINGS, discordChannels: [channel(1)] },
    {},
    { includeDiscord: true },
    deps
  )
  assert.equal(res.ok, false)
  if (res.ok) return
  assert.equal(res.error, 'That bundle is empty.')
  assert.equal(stored.length, 0)
})
