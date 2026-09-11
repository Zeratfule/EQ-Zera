// ---- photographing a card the renderer is already showing (EQ Zera) ----
//
// ONE CAPTURE PATH, TWO CARDS. This was `character:shareImage`'s private machinery until the FIGHT
// card arrived (owner, 2026-09-11: *"We should also make the Discord sharing be able to have DPS
// meter sharing also."*). A second card meant a second screenshot, and a second screenshot meant
// either a second opinion about how a renderer rectangle becomes device-independent pixels or one
// function both cards call. AGENTS.md's answer to a file at its ceiling is a split, and the split
// that was already implied here is the one between "photograph this box" and "what is in the box".
//
// NOTHING BELOW CHANGED IN BEHAVIOUR. The validation, the zoom multiply, the clamp, the empty-image
// refusals and the two sentences are byte-for-byte what `character:shareImage` has always done; the
// character handler now calls them and so does the combat one.
//
// ---------------------------------------------------------------------------
// THE RECTANGLE IS RENDERER-SUPPLIED INPUT, AND IT REACHES `capturePage`
// ---------------------------------------------------------------------------
// The handler is handed a card's own `getBoundingClientRect()`. That is a renderer string's problem
// in numeric clothing (AGENTS.md: validated AT THE HANDLER, not trusted because today's only caller
// is this app's own UI), so `captureRect` refuses anything that is not finite and positive, and
// clamps what is left INTO the window's content box. A rectangle that misses the content entirely
// is refused rather than silently answering a black image.
//
// AND CSS PIXELS ARE NOT DIP. The main window carries an Electron ZOOM FACTOR (JOS-123,
// shared/uiScale.ts), so a card measured at 720 CSS px is 900 device-independent pixels at the
// 1.25 stop — and `capturePage` speaks DIP. One multiply by `getZoomFactor()` is the whole fix, and
// without it every capture at a non-default text size is cropped. Electron then renders the capture
// at the display's own scale factor, which is where the crispness comes from; there is no
// devicePixelRatio argument to pass and nothing here invents one.
//
// THE CARD IS PHOTOGRAPHED WHERE IT ALREADY IS. No offscreen window, no second renderer: the dialog
// is on screen when the button is pressed, so the capture is of the same pixels the reader is
// looking at — the 3D figure included, which is why this is a `capturePage` and not a canvas read.

import { app, clipboard, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logError } from '../errorLog'
import { getMainWindow } from '../windows'

/** The reply of every card-image handler. `canceled` is the save dialog being dismissed. */
export interface CardImageResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

/** What the renderer asks a card-image handler for. One object rather than three arguments. */
export interface CardImageRequest {
  rect: unknown
  op?: unknown
  name?: unknown
}

/** Biggest capture this app will take, per side. A share card is 720 CSS px wide. */
const MAX_CAPTURE_PX = 4000

/** The one sentence a capture that produced nothing gets. */
export const CARD_NOT_CAPTURED = 'The card could not be captured.'

/** …and the one a rectangle that is not on screen gets. */
export const CARD_NOT_ON_SCREEN = 'The card is not on screen.'

function finitePositive(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * The renderer's CSS rectangle -> an Electron capture rectangle inside the content box, or null
 * when there is nothing legal to capture. See the header for why each half is here.
 */
export function captureRect(
  raw: unknown,
  zoom: number,
  content: { width: number; height: number }
): Electron.Rectangle | null {
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

/**
 * Photograph the card the renderer measured, or null when there is nothing legal to capture.
 * THE ONE capture path: the character link publisher, the character image buttons and the fight
 * card all reach a `capturePage` through here and nowhere else.
 */
export async function captureCard(rect: unknown): Promise<Electron.NativeImage | null> {
  const window = getMainWindow()
  if (!window) return null
  const [width, height] = window.getContentSize()
  const box = captureRect(rect, window.webContents.getZoomFactor(), { width, height })
  if (!box) return null
  const image = await window.webContents.capturePage(box)
  return image.isEmpty() ? null : image
}

/** Put the captured card on the clipboard as an IMAGE (never as a data URL in a text field). */
export function copyImage(image: Electron.NativeImage): CardImageResult {
  if (image.isEmpty()) return { ok: false, error: CARD_NOT_CAPTURED }
  clipboard.writeImage(image)
  return { ok: true }
}

/** Save the captured card through the OS dialog. `fileName` seeds the default path. */
export async function saveImage(image: Electron.NativeImage, fileName: string): Promise<CardImageResult> {
  if (image.isEmpty()) return { ok: false, error: CARD_NOT_CAPTURED }
  const window = getMainWindow()
  const opts = {
    title: 'Save share card',
    defaultPath: join(app.getPath('pictures'), fileName),
    filters: [{ name: 'PNG image', extensions: ['png'] }]
  }
  const res = window ? await dialog.showSaveDialog(window, opts) : await dialog.showSaveDialog(opts)
  if (res.canceled || !res.filePath) return { ok: false, canceled: true }
  try {
    writeFileSync(res.filePath, image.toPNG())
    return { ok: true, path: res.filePath }
  } catch (err) {
    logError('main:cardCapture', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Capture the card the request measured, then do the one thing that was asked of it.
 *
 * `fileName` is the caller's, because a character card and a fight card are named for different
 * things (`shareImageName` / `fightImageName`) and neither name belongs to the screenshot.
 */
export async function shareCardImage(req: unknown, fileName: (name: string) => string): Promise<CardImageResult> {
  const window = getMainWindow()
  if (!window) return { ok: false, error: 'There is no window to capture.' }
  const request = (req && typeof req === 'object' ? req : {}) as CardImageRequest
  const op = request.op === 'save' ? 'save' : 'copy'
  const image = await captureCard(request.rect)
  if (!image) return { ok: false, error: CARD_NOT_ON_SCREEN }
  if (op === 'copy') return copyImage(image)
  return saveImage(image, fileName(typeof request.name === 'string' ? request.name : ''))
}
