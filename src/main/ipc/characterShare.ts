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
import { logError } from '../errorLog'
import { decodeCharacterShare, encodeCharacterShare, shareImageName } from '../characterShare'
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

/** Capture the card, then do the one thing that was asked of it. */
async function shareImage(req: unknown): Promise<ShareImageResult> {
  const window = getMainWindow()
  if (!window) return { ok: false, error: 'There is no window to capture.' }
  const request = (req && typeof req === 'object' ? req : {}) as Partial<ShareImageRequest>
  const op = request.op === 'save' ? 'save' : 'copy'
  const [width, height] = window.getContentSize()
  const rect = captureRect(request.rect, window.webContents.getZoomFactor(), { width, height })
  if (!rect) return { ok: false, error: 'The card is not on screen.' }
  const image = await window.webContents.capturePage(rect)
  if (op === 'copy') return copyImage(image)
  return saveImage(image, typeof request.name === 'string' ? request.name : '')
}

export function registerCharacterShareIpc(): void {
  ipcMain.handle(IPC.characterShareString, (_e, profile: unknown) =>
    encodeCharacterShare(profile, app.getVersion())
  )
  ipcMain.handle(IPC.characterShareRead, (_e, text: unknown) =>
    decodeCharacterShare(typeof text === 'string' ? text : '')
  )
  ipcMain.handle(IPC.characterShareImage, async (_e, req: unknown) => {
    try {
      return await shareImage(req)
    } catch (err) {
      logError('main:characterShareImage', err)
      return { ok: false, error: 'The card could not be captured.' } satisfies ShareImageResult
    }
  })
}
