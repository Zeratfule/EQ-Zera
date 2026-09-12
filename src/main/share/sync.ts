// share/sync.ts — "send my settings to my other PC", the round trips (docs/plans/settings-sync.md).
//
// THE SERVICE IS A DEAD DROP. It takes a blob it cannot read, gives back a ten-character code, and
// hands the blob to whoever quotes that code for the next 24 hours. Everything that makes the
// transfer private happens in `./syncCrypto.ts` before the first byte leaves; everything that makes
// the IMPORT safe is the merge this feature does NOT re-invent (`applyShare`, additive by
// construction - src/shared/profiles.ts).
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT:
//
//   * NOTHING THROWS. Every failure is one short sentence from `SYNC_ERROR` (shared/settingsSync.ts),
//     for `links.ts`'s reason: these results cross an IPC boundary and "TypeError: fetch failed" is
//     not something a reader can act on.
//   * THE DISCORD CHANNELS ARE OPT-IN TWICE. The sender ticks a box to include them (they are
//     webhook credentials); the RECEIVER ticks one to store them. A payload that carries channels
//     the receiver did not confirm is decrypted, counted, and dropped.
//   * THE DECRYPTED PAYLOAD NEVER CROSSES IPC. `receiveSettings` answers it to its MAIN-side caller
//     (src/main/ipc/sync.ts), which keeps it and hands the renderer the preview and a count - the
//     same arrangement `publishShare` uses for the delete token, and for the same reason.
//
// EVERY IMPURE SEAM IS INJECTED (`SyncDeps`): `fetch`, the settings export/preview/apply, and the
// Discord channel store. So this module is Electron-free and drivable under plain node with no
// network at all (tests/syncSettings.test.mts); src/main/ipc/sync.ts passes the real ones.

import { MAX_CHANNELS, type DiscordChannel } from '../../shared/discordChannels'
import type { ShareApplyResult, SharePreview } from '../../shared/profiles'
import {
  MAX_SYNC_BLOB_BYTES,
  SYNC_ERROR,
  SYNC_PAYLOAD_VERSION,
  type SyncApplyResult,
  type SyncSendResult
} from '../../shared/settingsSync'
import { shareEndpointConfigured, shareRequest, syncRecordUrl, syncUrl, type ShareFetch } from './net'
import {
  decryptSyncBlob,
  encryptSyncPayload,
  formatTransferCode,
  isServiceCode,
  mintSyncKey,
  parseTransferCode,
  type SyncPayload
} from './syncCrypto'

/** The renderer's whitelisted localStorage map, which rides into every settings call. */
type UiPrefMap = Record<string, string>

/** Everything this module needs from the impure world. See the header. */
export interface SyncDeps extends ShareFetch {
  /** `exportSettingsString(app.getVersion(), ui)` - the same bundle the Copy button produces */
  exportSettings: (ui: UiPrefMap) => string
  /** `previewShare` - decode + plan, writing nothing */
  previewSettings: (text: string, ui: UiPrefMap) => SharePreview
  /** `applyShare` - the additive merge, with its default selection */
  applySettings: (text: string, ui: UiPrefMap) => ShareApplyResult
  /** the channels this install holds, tokens included (main-side only) */
  listChannels: () => DiscordChannel[]
  /** `addDiscordChannel` - false when the list is full */
  addChannel: (channel: DiscordChannel) => boolean
}

/** What a send is asked to do. */
export interface SendRequest {
  ui: UiPrefMap
  /** include the connected Discord channels - default OFF, because they are credentials */
  includeDiscord: boolean
}

/**
 * A receive, as its MAIN-side caller sees it: the renderer's half plus the decrypted payload. The
 * payload is the one field that must never be forwarded - see header item 3.
 */
export type ReceiveOutcome =
  | { ok: true; preview: SharePreview; discordChannels?: number; payload: SyncPayload }
  | { ok: false; error: string }

/** A failed HTTP attempt -> the one sentence that describes it. `links.ts sentenceFor`'s twin. */
function sentenceFor(status: number, fallback: string): string {
  if (status === 0) return SYNC_ERROR.offline
  if (status === 429) return SYNC_ERROR.busy
  if (status === 413) return SYNC_ERROR.tooBig
  return fallback
}

// ------------------------------------------------------------------------------------- sending

/** Roughly how many bytes a base64 string decodes to, without decoding it. */
function decodedSize(base64: string): number {
  return Math.floor((base64.length * 3) / 4)
}

/** The `{ code, expiresAt }` a create replies with, or null when the reply was not one. */
function createdTransfer(body: unknown): { code: string; expiresAt: string } | null {
  if (!body || typeof body !== 'object') return null
  const r = body as Record<string, unknown>
  if (!isServiceCode(r.code)) return null
  return { code: r.code, expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : '' }
}

/**
 * Encrypt this install's settings, upload the ciphertext, and answer the code the user carries.
 *
 * The size check happens BEFORE the request: a bundle the service could not store should not cost
 * anybody a round trip, and the sentence is the same either way.
 */
export async function sendSettings(req: SendRequest, deps: SyncDeps): Promise<SyncSendResult> {
  if (!shareEndpointConfigured()) return { ok: false, error: SYNC_ERROR.dark }
  const settings = deps.exportSettings(req.ui)
  const channels = req.includeDiscord ? deps.listChannels() : []
  const payload: SyncPayload = {
    v: SYNC_PAYLOAD_VERSION,
    settings,
    ...(channels.length === 0 ? {} : { discordChannels: channels })
  }
  const key = mintSyncKey()
  const blob = encryptSyncPayload(payload, key)
  if (decodedSize(blob) > MAX_SYNC_BLOB_BYTES) return { ok: false, error: SYNC_ERROR.tooBig }

  const res = await shareRequest(deps, 'POST', syncUrl(), { body: { blob } })
  if (res.status !== 201 && res.status !== 200) {
    return { ok: false, error: sentenceFor(res.status, SYNC_ERROR.refused) }
  }
  const made = createdTransfer(res.body)
  if (made === null) return { ok: false, error: SYNC_ERROR.badReply }
  return { ok: true, code: formatTransferCode(made.code, key), expiresAt: made.expiresAt }
}

// ----------------------------------------------------------------------------------- receiving

/** The `blob` a read replies with, or '' when the reply did not carry one. */
function servedBlob(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const raw = (body as Record<string, unknown>).blob
  return typeof raw === 'string' ? raw : ''
}

/**
 * Fetch a transfer and decrypt it, WITHOUT writing anything. What comes back is the same preview
 * the paste box renders, so the receiving user sees exactly what an import would add before any of
 * it happens - and a count of the Discord channels that rode along, if any did.
 *
 * A code that is not a code is refused before a request is made: a typo must never become a
 * request path, and the sentence says which problem it is.
 */
export async function receiveSettings(
  code: unknown,
  ui: UiPrefMap,
  deps: SyncDeps
): Promise<ReceiveOutcome> {
  if (!shareEndpointConfigured()) return { ok: false, error: SYNC_ERROR.dark }
  const parsed = parseTransferCode(code)
  if (parsed === null) return { ok: false, error: SYNC_ERROR.badCode }

  const res = await shareRequest(deps, 'GET', syncRecordUrl(parsed.code))
  if (res.status === 404 || res.status === 410) return { ok: false, error: SYNC_ERROR.expired }
  if (res.status !== 200) return { ok: false, error: sentenceFor(res.status, SYNC_ERROR.offline) }

  const payload = decryptSyncBlob(servedBlob(res.body), parsed.key)
  // A WRONG KEY AND A TAMPERED BLOB ARE THE SAME EVENT FROM HERE, and saying so is honest: both
  // mean the bytes on the service do not belong to the code that was typed.
  if (payload === null) return { ok: false, error: SYNC_ERROR.undecryptable }

  const preview = deps.previewSettings(payload.settings, ui)
  if (!preview.ok) return { ok: false, error: preview.error ?? SYNC_ERROR.empty }
  const count = payload.discordChannels?.length ?? 0
  return { ok: true, preview, ...(count === 0 ? {} : { discordChannels: count }), payload }
}

// ------------------------------------------------------------------------------------- applying

/**
 * Store the channels a payload carried, skipping the ones this install already has BY WEBHOOK ID.
 *
 * A duplicate is a skip rather than a replace: the local row may have been renamed or made the
 * default, and re-adding it would quietly undo both. A full list stops the loop - `addChannel`
 * answers false, and the count the caller reports is what actually landed.
 */
function addChannels(channels: readonly DiscordChannel[], deps: SyncDeps): number {
  const have = new Set(deps.listChannels().map((c) => c.id))
  let added = 0
  for (const channel of channels) {
    if (have.size >= MAX_CHANNELS) break
    if (have.has(channel.id)) continue
    if (!deps.addChannel(channel)) break
    have.add(channel.id)
    added++
  }
  return added
}

/**
 * Apply a received payload: the EXISTING additive merge over the settings string, and - only when
 * the user confirmed it - the Discord channels beside it.
 *
 * `includeDiscord` is the RECEIVER's answer, independent of the sender's. A payload that carries
 * channels nobody confirmed is simply not stored; there is no path here that writes a credential
 * because it arrived.
 */
export function applyReceivedSettings(
  payload: SyncPayload,
  ui: UiPrefMap,
  opts: { includeDiscord: boolean },
  deps: SyncDeps
): SyncApplyResult {
  const res = deps.applySettings(payload.settings, ui)
  if (!res.ok) return { ok: false, error: res.error ?? SYNC_ERROR.empty }
  const channels = opts.includeDiscord ? (payload.discordChannels ?? []) : []
  return {
    ok: true,
    added: res.added,
    skipped: res.skipped,
    rekeyed: res.rekeyed,
    scalarsApplied: res.scalarsApplied,
    ui: res.ui,
    channelsAdded: addChannels(channels, deps)
  }
}

/** Is there a sync service in this build at all? The card gates its buttons on it. */
export function syncAvailable(): boolean {
  return shareEndpointConfigured()
}
