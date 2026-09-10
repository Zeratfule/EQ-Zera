// ---- sharing a character profile (EQ Zera) ----
//
// Three handlers: encode a profile, read a pasted one back, and photograph the share card.
// The RULES are pure (shared/characterShare.ts) and the codec is `../characterShare.ts`; this
// file is the Electron half — the clipboard, the save dialog, and the one screenshot.
//
// ---------------------------------------------------------------------------
// THE RECTANGLE IS RENDERER-SUPPLIED INPUT, AND IT REACHES `capturePage`
// ---------------------------------------------------------------------------
// `character:shareImage` is handed the share card's own `getBoundingClientRect()`. That is a
// renderer string's problem in numeric clothing (AGENTS.md: validated AT THE HANDLER, not trusted
// because today's only caller is this app's own UI), so `captureRect` refuses anything that is
// not finite and positive, and clamps what is left INTO the window's content box. A rectangle
// that misses the content entirely is refused rather than silently answering a black image.
//
// AND CSS PIXELS ARE NOT DIP. The main window carries an Electron ZOOM FACTOR (JOS-123,
// shared/uiScale.ts), so a card measured at 720 CSS px is 900 device-independent pixels at the
// 1.25 stop — and `capturePage` speaks DIP. One multiply by `getZoomFactor()` is the whole fix,
// and without it every capture at a non-default text size is cropped. Electron then renders the
// capture at the display's own scale factor, which is where the crispness comes from; there is no
// devicePixelRatio argument to pass and nothing here invents one.
//
// THE CARD IS PHOTOGRAPHED WHERE IT ALREADY IS. No offscreen window, no second renderer: the
// dialog is on screen when the button is pressed, so the capture is of the same pixels the reader
// is looking at — the 3D figure included, which is why this is a `capturePage` and not a canvas
// read.

import { app, clipboard, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import { sanitizeCharacterShare } from '../../shared/characterShare'
import { sanitizeCardMap, type CardMapEntry } from '../../shared/shareCardMap'
import { logError } from '../errorLog'
import { decodeCharacterShare, encodeCharacterShare, shareImageName, type CharacterShareRead } from '../characterShare'
import { fetchSharedProfile, parseShareLink, publishShare, revokeShare } from '../share/links'
import {
  deleteShareLink,
  findShareLink,
  findShareLinkById,
  listShareLinkViews,
  saveShareLink
} from '../storeShareLinks'
import type { ShareLinkOwner, ShareLinkRecord, ShareLinkView } from '../../shared/shareLinks'
import { getMainWindow } from '../windows'

/** The card's DOM rectangle, in CSS pixels, as the renderer measured it. */
interface DomRect {
  x: number
  y: number
  width: number
  height: number
}

/** What the renderer asks for. One object rather than three positional arguments. */
interface ShareImageRequest {
  rect: DomRect
  op: 'copy' | 'save'
  /** the character's name, for the save dialog's default file name; sanitized before use */
  name?: string
}

/** The reply of `character:shareImage`. `canceled` is the save dialog being dismissed. */
export interface ShareImageResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

/** Biggest capture this app will take, per side. A share card is 720 CSS px wide. */
const MAX_CAPTURE_PX = 4000

function finitePositive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * The renderer's CSS rectangle -> an Electron capture rectangle inside the content box, or null
 * when there is nothing legal to capture. See the header for why each half is here.
 */
function captureRect(raw: unknown, zoom: number, content: { width: number; height: number }): Electron.Rectangle | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const width = finitePositive(r.width)
  const height = finitePositive(r.height)
  if (width === null || height === null) return null
  if (typeof r.x !== 'number' || !Number.isFinite(r.x)) return null
  if (typeof r.y !== 'number' || !Number.isFinite(r.y)) return null
  const x = Math.max(0, Math.min(content.width, Math.floor(r.x * zoom)))
  const y = Math.max(0, Math.min(content.height, Math.floor(r.y * zoom)))
  const w = Math.min(MAX_CAPTURE_PX, content.width - x, Math.ceil(width * zoom))
  const h = Math.min(MAX_CAPTURE_PX, content.height - y, Math.ceil(height * zoom))
  return w >= 1 && h >= 1 ? { x, y, width: w, height: h } : null
}

/** Put the captured card on the clipboard as an IMAGE (never as a data URL in a text field). */
function copyImage(image: Electron.NativeImage): ShareImageResult {
  if (image.isEmpty()) return { ok: false, error: 'The card could not be captured.' }
  clipboard.writeImage(image)
  return { ok: true }
}

/** Save the captured card through the OS dialog. */
async function saveImage(image: Electron.NativeImage, name: string): Promise<ShareImageResult> {
  if (image.isEmpty()) return { ok: false, error: 'The card could not be captured.' }
  const window = getMainWindow()
  const opts = {
    title: 'Save share card',
    defaultPath: join(app.getPath('pictures'), shareImageName(name)),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  }
  const res = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  try {
    writeFileSync(res.filePath, image.toPNG())
    return { ok: true, path: res.filePath }
  } catch (err) {
    logError('main:characterShareImage', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Photograph the card the renderer measured, or null when there is nothing legal to capture.
 * The ONE capture path: the link publisher below reuses it rather than growing a second opinion
 * about how a renderer rectangle becomes device-independent pixels.
 */
async function captureCard(rect: unknown): Promise<Electron.NativeImage | null> {
  const window = getMainWindow()
  if (!window) return null
  const [width, height] = window.getContentSize()
  const box = captureRect(rect, window.webContents.getZoomFactor(), { width, height })
  if (!box) return null
  const image = await window.webContents.capturePage(box)
  return image.isEmpty() ? null : image
}

/** Capture the card, then do the one thing that was asked of it. */
async function shareImage(req: unknown): Promise<ShareImageResult> {
  const window = getMainWindow()
  if (!window) return { ok: false, error: 'There is no window to capture.' }
  const request = (req && typeof req === 'object' ? req : {}) as Partial<ShareImageRequest>
  const op = request.op === 'save' ? 'save' : 'copy'
  const image = await captureCard(request.rect)
  if (!image) return { ok: false, error: 'The card is not on screen.' }
  if (op === 'copy') return copyImage(image)
  return saveImage(image, typeof request.name === 'string' ? request.name : '')
}

// ---------------------------------------------------------------------------
// SHARE LINKS (docs/plans/share-links.md)
// ---------------------------------------------------------------------------
// The delete token stops here. It is written into main's own store and read back out of it; the
// three replies below carry a url, a boolean and a redacted list, and nothing else.
//
// THE CARD IS OPTIONAL, THE PROFILE IS NOT. A capture that produced nothing (the dialog scrolled
// away, a window that is not there) publishes the profile without an image rather than refusing:
// the link's page still renders the whole card from the body, and the picture is what Discord
// unfurls. A profile that does not sanitize IS a refusal - there would be nothing to serve.

/** What the renderer asks for when it presses Copy link. */
interface ShareLinkRequest {
  rect: unknown
  profile: unknown
  /** where the card's gear cells sit on the picture at `rect`, as the renderer measured them */
  cardMap: unknown
}

/** What `character:shareLink` answers. `updated` is "the same URL now shows the new card". */
export type ShareLinkResult =
  | { ok: true; url: string; updated: boolean }
  | { ok: false; error: string }

/** Who a profile is about, as the two fields the record is keyed by. Untrusted, so bounded. */
function ownerOf(profile: unknown): ShareLinkOwner {
  const p = (profile && typeof profile === 'object' ? profile : {}) as Record<string, unknown>
  const name = typeof p.name === 'string' ? p.name : undefined
  const classes = Array.isArray(p.classes) ? p.classes.filter((c): c is string => typeof c === 'string') : []
  return { ...(name === undefined ? {} : { name }), classes }
}

/** The level the card printed, when the profile carried one. */
function levelOf(profile: unknown): number | undefined {
  const p = (profile && typeof profile === 'object' ? profile : {}) as Record<string, unknown>
  return typeof p.level === 'number' && Number.isFinite(p.level) ? Math.floor(p.level) : undefined
}

/** Write down what a successful publish produced. Its own function so `shareLink` stays simple. */
function recordLink(
  published: { id: string; url: string; updated: boolean; deleteToken?: string },
  profile: unknown,
  existing: ShareLinkRecord | undefined
): void {
  const owner = ownerOf(profile)
  const level = levelOf(profile)
  const now = Date.now()
  saveShareLink({
    id: published.id,
    url: published.url,
    // A PUT keeps the token we already hold; only a create is ever handed a new one, so one of
    // the two is always present on a success and the empty fallback is unreachable by
    // construction (an unsanitizable record is simply not written).
    deleteToken: published.deleteToken ?? existing?.deleteToken ?? '',
    ...(owner.name === undefined ? {} : { name: owner.name }),
    ...(level === undefined ? {} : { level }),
    classes: [...owner.classes],
    createdAt: published.updated ? (existing?.createdAt ?? now) : now,
    updatedAt: now
  })
}

/**
 * THE LINK CARD IS A JPEG AT FULL CAPTURE WIDTH (owner, 2026-09-09: "let's do them both", big
 * AND sharp). `capturePage` answers at the display's own scale, so a 720 CSS px card on a
 * high-DPI display is a 1500 to 2900 px image with a 3D figure in it. As a PNG that was well
 * past the service's cap and the first fix shrank it to fit, which made the page's card small.
 * share-server now takes PNG, JPEG or WebP up to 1 MB (its MAX_CARD_BYTES; Worker dd389965,
 * docs/plans/share-links.md) and the page draws the card at 2x, so the full-width capture as a
 * JPEG is what shows big and sharp. Order: JPEG at the full width, then the same ladder of widths
 * as JPEG, then the envelope alone rather than refusing the whole share; the link is the point of
 * the publish and the picture is its garnish. The clipboard and Save image paths keep the PNG.
 */
const LINK_CARD_MAX_BYTES = 1024 * 1024
const LINK_CARD_WIDTHS = [2400, 1920, 1440, 1080, 900, 720]
const LINK_CARD_JPEG_QUALITY = 90

function cardBytesForLink(image: Electron.NativeImage | null): Buffer | null {
  if (!image || image.isEmpty()) return null
  const full = image.toJPEG(LINK_CARD_JPEG_QUALITY)
  if (full.length <= LINK_CARD_MAX_BYTES) return full
  const { width } = image.getSize()
  for (const w of LINK_CARD_WIDTHS) {
    if (w >= width) continue
    const jpeg = image.resize({ width: w, quality: 'best' }).toJPEG(LINK_CARD_JPEG_QUALITY)
    if (jpeg.length <= LINK_CARD_MAX_BYTES) return jpeg
  }
  return null
}

/**
 * THE CELL BOXES ARE THE RECTANGLE'S PROBLEM ALL OVER AGAIN (see this file's header). The renderer
 * measured them, so they are untrusted numbers at the handler, and the slot names among them are
 * checked against the profile as the ENVELOPE will carry it - `sanitizeCharacterShare` is the
 * function that decides which cells travel, so asking it is the only way the map cannot name a
 * cell the page will not be served. No picture means no map: the fractions are fractions of it.
 */
function cardMapFor(profile: unknown, card: Buffer | null, raw: unknown): CardMapEntry[] {
  if (card === null) return []
  const clean = sanitizeCharacterShare(profile)
  if (!clean) return []
  const slots = new Set<string>()
  for (const cell of clean.cells) slots.add(cell.slot)
  return sanitizeCardMap(raw, slots)
}

/**
 * What a publish produced, INCLUDING THE ID. Only `publishCharacterLink`'s callers see this shape;
 * `character:shareLink` drops the id on its way to the renderer, because the renderer already gets
 * the id it needs from `character:shareLinks` and a url is what a Copy button wants.
 */
export type PublishedLink =
  | { ok: true; id: string; url: string; updated: boolean }
  | { ok: false; error: string }

/**
 * MEASURE, PHOTOGRAPH, PUBLISH, RECORD — the whole of what pressing Copy link does, as one
 * function so the DISCORD post can do exactly it rather than a second version of it
 * (src/main/ipc/discord.ts). Two publish paths would be two opinions about which record a
 * character re-uses, which card bytes travel and what gets written down afterwards, and the one
 * that was not being looked at would drift.
 *
 * Never throws; every failure is a sentence.
 */
export async function publishCharacterLink(req: unknown): Promise<PublishedLink> {
  const request = (req && typeof req === 'object' ? req : {}) as Partial<ShareLinkRequest>
  const existing = findShareLink(ownerOf(request.profile))
  const image = await captureCard(request.rect)
  const card = cardBytesForLink(image)
  const published = await publishShare(
    {
      profile: request.profile,
      card,
      appVersion: app.getVersion(),
      existing: existing ? { id: existing.id, deleteToken: existing.deleteToken } : undefined,
      cardMap: cardMapFor(request.profile, card, request.cardMap)
    },
    { fetch: globalThis.fetch }
  )
  if (!published.ok) return published
  recordLink(published, request.profile, existing)
  return { ok: true, id: published.id, url: published.url, updated: published.updated }
}

/** Publish, then answer the renderer with the url and nothing else. */
async function shareLink(req: unknown): Promise<ShareLinkResult> {
  const published = await publishCharacterLink(req)
  if (!published.ok) return published
  return { ok: true, url: published.url, updated: published.updated }
}

/** Revoke, then forget. A revoke that failed leaves the record alone - the link still serves. */
async function shareRevoke(req: unknown): Promise<{ ok: boolean; error?: string }> {
  const id = (req && typeof req === 'object' ? (req as Record<string, unknown>).id : undefined)
  const rec = typeof id === 'string' ? findShareLinkById(id) : undefined
  // Nothing stored for that id means there is nothing serving it either, as far as this install
  // knows - which is the state the user asked for.
  if (!rec) return { ok: true }
  const res = await revokeShare(rec.id, rec.deleteToken, { fetch: globalThis.fetch })
  if (!res.ok) return res
  deleteShareLink(rec.id)
  return { ok: true }
}

/**
 * Read a pasted string OR a share link. The link is tried FIRST because the two are unambiguous
 * (a link parses as a URL on our own origin; an `EQC1-` string does not parse as one at all), and
 * because a reader holding a link should not have to know which box it belongs in.
 */
async function readShare(text: string): Promise<CharacterShareRead> {
  if (parseShareLink(text) !== null) return fetchSharedProfile(text, { fetch: globalThis.fetch })
  return decodeCharacterShare(text)
}

export function registerCharacterShareIpc(): void {
  ipcMain.handle(IPC.characterShareString, (_e, profile: unknown) =>
    encodeCharacterShare(profile, app.getVersion())
  )
  ipcMain.handle(IPC.characterShareRead, (_e, text: unknown) =>
    readShare(typeof text === 'string' ? text : '')
  )
  ipcMain.handle(IPC.characterShareImage, async (_e, req: unknown) => {
    try {
      return await shareImage(req)
    } catch (err) {
      logError('main:characterShareImage', err)
      return { ok: false, error: 'The card could not be captured.' } satisfies ShareImageResult
    }
  })
  ipcMain.handle(IPC.characterShareLink, async (_e, req: unknown) => {
    try {
      return await shareLink(req)
    } catch (err) {
      logError('main:characterShareLink', err)
      return { ok: false, error: 'The link could not be created.' } satisfies ShareLinkResult
    }
  })
  ipcMain.handle(IPC.characterShareRevoke, async (_e, req: unknown) => {
    try {
      return await shareRevoke(req)
    } catch (err) {
      logError('main:characterShareLink', err)
      return { ok: false, error: 'That link could not be revoked.' }
    }
  })
  ipcMain.handle(IPC.characterShareLinks, (_e, who: unknown): ShareLinkView[] => {
    const owner = who && typeof who === 'object' ? ownerOf(who) : undefined
    return listShareLinkViews(owner)
  })
}
