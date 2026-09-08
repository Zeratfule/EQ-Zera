// toast.ts — main's half of the CELEBRATION TOAST (docs/plans/celebration-toasts.md).
//
// ONE HOP IN, ONE HOP OUT. The main window's always-mounted celebration detectors say what
// happened (`toast:show`, a ToastRequest); this module answers the one question only main can:
// WHAT DOES THE REWARD LOOK LIKE — `lookupItem` (cache-first, local posky before wiki) plus the
// pure `toastItemCard` formatter, so the overlay receives a finished card. The overlay bundle is
// MUI-free and fetches NOTHING (T5): if the item's knowledge is not in the payload, it is not on
// screen.
//
// A TOAST MAKES NO SOUND (owner, 2026-08-05: "remove the sound controls from preferences, they
// are already covered by Alerts module"). There used to be a second hop out — main read the
// toast's own `{packId, soundId}` + volume and asked the main window to play it. Both producers
// already fire a seeded ALERT with its own voice on the same event, so that path could only ever
// add a second voice over one kill. It is deleted rather than defaulted off: the toast's config
// no longer has a sound to read, and `toast:sound` is gone with it.
//
// LIVE-ONLY DISCIPLINE IS THE DETECTORS' (T4/celebrations law). There is deliberately NO gate
// here: `useBossKills` and `useProgress` already own "a LIVE transition, never hydration", and a
// second predicate in this file could only ever disagree with them.
//
// A CLOSED TOAST OVERLAY IS SILENT. Nothing is rendered and nothing is played when the window
// is not open — the sound belongs to the toast, not to the event (the event already has its own
// alert). That also makes the Preferences switch honest: off means off, everywhere.
//
// THE QUEST HOP IS THE SAME HOP AGAIN (EQ Zera, ROADMAP §1). A 'questItem' request adds one more
// thing only main can answer: the detector matched a live loot line to some quest PAGES and sends
// their titles; main turns each into a finished quest block (`questByPage` + the pure
// `toastQuestCard`) so the overlay still fetches nothing. Unknown titles are dropped SILENTLY and
// the rest of the card is drawn — a page the committed catalog does not carry is a page nobody
// gets to invent (law 1) — and the looted item still rides `itemName` into its own card exactly
// as a Sky reward does, because "what is it" and "what is it for" are two answers, not one.

import { ipcMain } from 'electron'
import { IPC } from '../shared/ipc'
import { logError } from './errorLog'
import { lookupItem } from './itemLookup'
import { questByPage } from './questCatalog'
import { getOverlayConfig } from './store'
import { getOverlayWindow } from './windows'
import {
  DEFAULT_TOAST_CONFIG,
  toastItemCard,
  validateToastRequest,
  type ToastItemCard,
  type ToastPayload,
  type ToastQuestCard,
  type ToastRequest
} from '../shared/toast'
import { toastQuestCard } from '../shared/toastQuest'

/**
 * Resolve the embedded reward card, or undefined when there is nothing honest to draw.
 *
 * Never throws and never blocks the toast: an offline/unknown item yields NO card rather than a
 * fabricated one (world-model law 1), and the title still fires on time.
 */
async function resolveItemCard(name: string | undefined): Promise<ToastItemCard | undefined> {
  if (!name) return undefined
  try {
    const k = await lookupItem(name)
    // A lookup that found no page still carries the name we asked with; a card of just a name
    // is worth drawing (it IS the reward), so only a hard failure drops the card.
    return toastItemCard(k)
  } catch (err) {
    logError('main:toastItemLookup', { item: name, error: String(err) })
    return undefined
  }
}

/**
 * Resolve the quest blocks a 'questItem' card draws, in the order the producer asked for them.
 *
 * Synchronous and offline: the catalog is committed data inlined into this bundle, so unlike the
 * item card there is nothing to await and nothing to fail. A page the catalog does not know
 * simply contributes no block — the toast is smaller, never wrong — and every other kind gets an
 * empty list whatever it sent (the validator already dropped `questPages` there; this is the
 * second lock on the same door).
 */
function resolveQuestCards(req: ToastRequest): ToastQuestCard[] {
  if (req.kind !== 'questItem') return []
  // The item the card is ABOUT: its name when the producer named one, else the headline, which is
  // what the step-lighting and the role join are matched on.
  const itemName = req.itemName ?? req.title
  const cards: ToastQuestCard[] = []
  for (const page of req.questPages ?? []) {
    const q = questByPage(page)
    if (q) cards.push(toastQuestCard(q, itemName))
  }
  return cards
}

/**
 * Push a finished payload at the toast overlay. A window that is still loading its page (the
 * first toast after the overlay is switched on, and every toast in the e2e harness's first
 * moments) would silently drop the send, so the push waits for `did-finish-load` instead.
 */
function sendToToastOverlay(payload: ToastPayload): void {
  const w = getOverlayWindow('toast')
  if (!w || w.isDestroyed()) return
  const wc = w.webContents
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(IPC.onToast, payload))
  else wc.send(IPC.onToast, payload)
}

/** Build the wire payload for a validated request (item card already resolved). */
function buildPayload(req: ToastRequest, item: ToastItemCard | undefined, durationMs: number): ToastPayload {
  const payload: ToastPayload = {
    id: req.id,
    kind: req.kind,
    title: req.title,
    durationMs: req.durationMs ?? durationMs
  }
  if (req.subtitle) payload.subtitle = req.subtitle
  if (req.focus) payload.focus = req.focus
  if (item) payload.item = item
  const quests = resolveQuestCards(req)
  if (quests.length > 0) payload.quests = quests
  return payload
}

/**
 * The whole flow for one request: validate, bail if the overlay is off, resolve the card, then
 * fan out. Exported for the tests that drive it without an IPC round trip.
 */
export async function showToast(input: unknown): Promise<boolean> {
  const req = validateToastRequest(input)
  if (!req) return false
  const cfg = getOverlayConfig('toast')
  if (!cfg.open) return false
  const toastCfg = cfg.toast ?? DEFAULT_TOAST_CONFIG
  const item = await resolveItemCard(req.itemName)
  sendToToastOverlay(buildPayload(req, item, toastCfg.durationMs))
  return true
}

export function registerToastIpc(): void {
  ipcMain.on(IPC.toastShow, (_e, req: unknown) => {
    void showToast(req).catch((err: unknown) => logError('main:toastShow', err))
  })
}
