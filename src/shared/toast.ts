// toast.ts — the CELEBRATION TOAST payload (docs/plans/celebration-toasts.md §2), its
// renderer→main request shape, the validator main re-runs on that request, and the pure
// formatter that turns an item's knowledge into the two-or-three stat lines the toast card
// prints.
//
// WHY A REQUEST AND A PAYLOAD. The producers are the main window's always-mounted celebration
// detectors (T4): they know the TITLE and, for a Sky turn-in, the reward item's NAME — nothing
// more. Main resolves that name into the embedded card (icon id, colour hint, stat lines) with
// `lookupItem`, because the overlay bundle is MUI-free and FETCHES NOTHING (T5): everything it
// draws arrives inside one push. So the wire carries two shapes:
//
//   ToastRequest  renderer → main   what happened + optionally the reward item's name
//   ToastPayload  main → overlay    the same, with the item card RESOLVED and pre-formatted
//
// THE VALIDATOR IS NOT A FORMALITY. `toast:show` is a renderer→main channel, and this repo's
// rule is that renderer input is re-validated at the handler rather than trusted because
// today's only caller is the app's own UI (the `sounds:getData` packId precedent). Everything
// here is a closed union or a capped string: an unknown kind, an over-long title or an
// unlisted focus view is DROPPED, never forwarded. The payload then crosses into a window
// that draws it, so "capped" is a rendering guarantee too — a 40 kB title cannot push the
// card off screen.
//
// Pure + dependency-free (types only), so `npm test` exercises it with no Electron.

import type { ItemKnowledge, ItemStatBlock } from './types'
import type { AppFocus, AppFocusView } from './types'

// ---- the toast overlay's own config knobs (docs/plans/celebration-toasts.md §3) --------
//
// They ride `overlays.toast` (OverlayConfig.toast) rather than a second store key, so the
// toast is a sixth overlay KIND in every sense: one open-state, one persisted bounds, one
// per-kind config read. `open` IS the design's `enabled` — a toast overlay that is open is
// the feature being on, and two switches for one state is how they drift.

/**
 * Timing for the toast kind. Everything else it needs is standard OverlayConfig.
 *
 * THE TOAST HAS NO SOUND OF ITS OWN (owner, 2026-08-05: "remove the sound controls from
 * preferences, they are already covered by Alerts module"). It shipped with a `sound`/`volume`
 * pair that defaulted to silent precisely because the seeded "Raid target defeated" and "Quest
 * complete" ALERTS already speak on these exact events — which made the picker a way to opt into
 * hearing the same kill twice, in a second place, with second volume rules. The alerts are the
 * audio path; this is the card. A store written by that build may still carry the two keys: they
 * are simply never read again, and dropping a read of optional keys needs no migration (the next
 * write of this blob drops them on its own).
 */
export interface ToastOverlayConfig {
  /** how long a card holds before it leaves, when the payload names no duration of its own */
  durationMs: number
  /**
   * Has this install ever been TOLD what the celebration overlay is (JOS-83)?
   *
   * False (the default, and what an absent key reads as) means the overlay owes the user one
   * self-identifying card the next time it comes up — see `introToastPayload` below. It flips true
   * the moment that card is queued, so the introduction is once per install and never again.
   *
   * It defaults false for a store that already HAS a toast blob too, which is deliberate: a store
   * written before this field existed is exactly the population that has been living with an
   * unlabelled strip, and one dismissible card is the cheapest way to answer it.
   */
  introduced: boolean
}

export const DEFAULT_TOAST_DURATION_MS = 6000

export const DEFAULT_TOAST_CONFIG: ToastOverlayConfig = {
  durationMs: DEFAULT_TOAST_DURATION_MS,
  introduced: false
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}

const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * Coerce a stored/patched toast config into the valid shape (the store's clamp lives here).
 * The result carries ONLY the fields above, so a stored `sound`/`volume` left over from the
 * first toast build is dropped the next time this blob is written — never read, never honoured.
 */
export function normalizeToastConfig(v: unknown): ToastOverlayConfig {
  const o = asRecord(v)
  const duration = Math.floor(asNumber(o.durationMs, DEFAULT_TOAST_CONFIG.durationMs))
  return {
    durationMs: Math.min(TOAST_MAX_DURATION_MS, Math.max(TOAST_MIN_DURATION_MS, duration)),
    // Only a literal `true` counts. Anything else — absent, a string, a hand-edited 1 — leaves the
    // introduction owed, because showing one extra card is a smaller failure than never explaining
    // the window at all.
    introduced: o.introduced === true
  }
}

/**
 * What kind of celebration this is. Closed union — the overlay styles per member.
 *
 * 'levelUp' (docs/plans/levelup-whats-new.md §2) joined in wave O2: a ding, titled "Level 24!"
 * and subtitled with what it unlocked for the loadout you were running AT THE DING'S TIMESTAMP.
 * It carries no item card — a level is not a reward you can hold — so it is the first kind whose
 * click target is the card itself rather than an embedded reward block.
 */
/**
 * 'questItem' (EQ Zera, ROADMAP item 1): a LIVE loot of an item the quest catalog knows — the card
 * names the quest(s) it belongs to and lists their steps, the step naming the item lit. It carries the
 * looted item as its reward-style card (resolved in main like a Sky reward) AND one `ToastQuestCard`
 * per quest (resolved in main from the committed catalog by wiki page title — `questPages` below).
 */
/**
 * 'wishDrop' and 'wishZone' (EQ Zera) are the WISH LIST speaking. A drop is an item card like a
 * Sky reward - the thing you wrote down that you wanted just landed in your bags. A zone card
 * carries no item at all: it counts what drops where you are standing and names the first few, so
 * the CARD is its own click target, straight to the Wish list tab.
 */
/**
 * 'death' (EQ Zera, ROADMAP item 7) is the DEATH RECAP speaking, and it is the first kind that
 * carries neither an item nor a focus: a plain title + subtitle card. There is nothing to hand you
 * and nowhere the card could honestly send you - the recap's own surface is the Overview card, and
 * a click that opened the Overview would be a link to "the page you were already on". The subtitle
 * says what the last seconds held (the window's damage, who dealt most of it, which skill), and
 * every clause of it is omitted rather than invented when the log did not say.
 */
/**
 * 'update' (EQ Zera, owner direction 2026-09-08) is THE UPDATER speaking, and it is the first kind
 * MAIN builds for itself: no detector asks for it, no renderer may request it, and the card it
 * draws is the only place in the app where a click starts a download or an install. Everything
 * about it is main-built by construction — `updateToast.ts` builds the payload, `main/updater.ts`
 * pushes it straight at the overlay window, and `TOAST_KINDS` below deliberately does not list it,
 * so `validateToastRequest` refuses the kind outright on the renderer→main channel.
 */
export type ToastKind =
  | 'bossKill'
  | 'skyQuestComplete'
  | 'levelUp'
  | 'intro'
  | 'questItem'
  | 'wishDrop'
  | 'wishZone'
  | 'death'
  | 'update'

/**
 * The kinds a PRODUCER may send over `toast:show` — deliberately NOT every member of the union.
 *
 * 'intro' (JOS-83) is built by the overlay window for itself out of its own persisted config and
 * never crosses the wire, so admitting it here would only widen what a renderer can ask main to
 * draw. The union is what the CARD can render; this list is what the CHANNEL accepts, and they
 * are not the same question.
 *
 * 'update' is absent for a HARDER reason than the introduction's (EQ Zera, 2026-09-08). That card
 * is the one card whose buttons download and install an executable, and its `action` field is what
 * arms them. A renderer that could ask for the kind could ask for the action with it, which would
 * put "restart into a new build" one compromised renderer string away. Main builds it; the wire
 * never carries it; `optionalFields` never copies an `action` whatever the kind.
 */
export const TOAST_KINDS: ToastKind[] = [
  'bossKill',
  'skyQuestComplete',
  'levelUp',
  'questItem',
  'wishDrop',
  'wishZone',
  'death'
]

/**
 * The reward item, as the toast draws it. Everything is RESOLVED IN MAIN and pre-formatted:
 * the overlay renders these strings verbatim and asks nobody anything.
 */
export interface ToastItemCard {
  name: string
  /** wiki icon id — the overlay renders `eqimg://item/<id>` (permanent cache, never network) */
  iconId?: number
  /** rendering hint for the NAME's colour: 'lore' | 'magic'. Absent ⇒ the ordinary item green. */
  colorFlag?: string
  /** pre-formatted key stat lines ("MAGIC ITEM · LORE ITEM", "Slot: FINGER", …) */
  lines: string[]
}

/**
 * One quest a looted item belongs to, as the quest-item toast draws it (docs: ROADMAP.md §1).
 * RESOLVED IN MAIN from the committed catalog (`src/main/questCatalog.ts`) and pre-cut to the
 * card's caps by `toastQuestCard` (shared/toastQuest.ts): the overlay renders these strings
 * verbatim and fetches nothing, exactly as it does for `ToastItemCard`.
 */
export interface ToastQuestCard {
  /** the quest's display name */
  name: string
  /** the quest's wiki page title — the deep-link anchor (`AppFocus { view: 'quests', quest: page }`) */
  page: string
  /** "giver · start zone", whichever the catalog knows; absent when it knows neither */
  where?: string
  /** how the looted item relates: a turn-in/collectible, or something the quest hands out */
  role: 'required' | 'reward'
  /** the steps the card prints — a WINDOW of the quest's steps around the lit one, capped */
  steps: string[]
  /** index into `steps` of the step that names the looted item, when one does */
  litStep?: number
  /** how many of the quest's steps come BEFORE `steps[0]` (0 ⇒ the window starts at step 1) */
  before: number
  /** how many of the quest's steps come AFTER the last one here (0 ⇒ the window runs to the end) */
  after: number
}

// ---- the card that DOES something (EQ Zera, owner direction 2026-09-08) ----------------
//
// "We also need a way to push updates to people's apps so they can see when there's an available
// update, click on the notification when there is one, and it will just automatically download and
// update from there." Every other toast card is a statement about something that already happened;
// this one is a control. So it carries a second, much narrower thing on the wire: an ACTION NAME.
//
// THE UNION IS THE WHOLE SECURITY SURFACE. The overlay never decides what a click does — it hands
// the name back to main, and main matches it against these two members and nothing else. Two
// consequences, both deliberate: the overlay cannot invent a third action, and main's handler is a
// closed switch rather than a dispatcher over strings. The names are verbs about the UPDATER, not
// about a window, because that is the only subsystem an overlay card is allowed to drive.

/** What a toast card's button asks main to do. Closed union; main matches it exactly. */
export type ToastUpdateAction = 'updateDownload' | 'updateInstall'

/** The two members, as data, for the handler's validation and for a test to enumerate. */
export const TOAST_UPDATE_ACTIONS: ToastUpdateAction[] = ['updateDownload', 'updateInstall']

/** Is this an action main will honour? The ONLY admission test the `toast:action` handler runs. */
export function isToastUpdateAction(v: unknown): v is ToastUpdateAction {
  return typeof v === 'string' && (TOAST_UPDATE_ACTIONS as string[]).includes(v)
}

/**
 * The overlay→main channel a card's action button sends on.
 *
 * IT LIVES HERE RATHER THAN IN `shared/ipc.ts` on purpose: this is the one channel whose whole
 * contract (the action union, the validator, the payload field that arms it) is in this file, and
 * a name in one place with its meaning in another is how the two drift. Everything else about it
 * is ordinary — fire-and-forget `send`, re-validated at the handler like every renderer input.
 */
export const TOAST_ACTION_CHANNEL = 'toast:action'

/** One celebration, as the toast overlay receives it. */
export interface ToastPayload {
  /** dedupe / eviction key — a repeat id refreshes the card already on screen */
  id: string
  kind: ToastKind
  /** headline ("Lord Nagafen defeated", "Quest complete: Test of Sacrifice") */
  title: string
  /** supporting line: the instance tier, the quest's class, the zone */
  subtitle?: string
  /** the Sky reward, embedded (resolved in main) */
  item?: ToastItemCard
  /** 'questItem' only: the quest(s) the looted item belongs to, resolved in main (capped: TOAST_MAX_QUESTS) */
  quests?: ToastQuestCard[]
  /** where a click takes you (T6) — re-validated at the IPC handler like every deep link */
  focus?: AppFocus
  /**
   * What the card's button (and its whole body) asks main to DO, for the one kind that acts.
   * Set only on a MAIN-BUILT payload; `ToastRequest` below omits it, so no renderer request can
   * ever carry one.
   */
  action?: ToastUpdateAction
  /** how long the card holds before it starts leaving. Absent ⇒ the config's duration. */
  durationMs?: number
}

/**
 * What a PRODUCER sends (renderer → main). Same shape minus the resolved card: the detector
 * knows the reward item's NAME, main knows how to look it up.
 *
 * `action` IS OMITTED, NOT MERELY UNVALIDATED. A request type that could spell the field would
 * make "the validator drops it" a fact about one function; omitting it makes a request carrying an
 * action a TYPE ERROR at every producer in the tree, and leaves the validator's drop as the second
 * lock rather than the only one.
 */
export interface ToastRequest extends Omit<ToastPayload, 'item' | 'quests' | 'action'> {
  /** the reward item to embed as a card, by name. Main resolves it; an unknown name simply
   *  yields no card rather than a fabricated one (world-model law 1). */
  itemName?: string
  /**
   * 'questItem' only: the wiki page titles of the quests to draw, in the order to draw them. Main
   * resolves each against the committed catalog; a title it does not know yields no card. Kept
   * only on a 'questItem' request and capped at TOAST_MAX_QUESTS by the validator.
   */
  questPages?: string[]
}

// ---- caps (rendering guarantees, not taste) ------------------------------------------

export const TOAST_MAX_TEXT = 120
export const TOAST_MAX_LINES = 4
export const TOAST_MAX_LINE = 64
/** Longest a payload may hold the screen, whatever it asks for. */
export const TOAST_MAX_DURATION_MS = 30_000
export const TOAST_MIN_DURATION_MS = 1_000
/**
 * Most quests one quest-item card names; a looted item that feeds more is still three cards' worth.
 *
 * THREE NAMED IS NOT THREE OPENED (2026-09-08). All three are drawn, but only ONE is drawn with its
 * steps: the block that names the looted item, or the first when no block does. The other two are
 * their header line and a "+N steps" note (overlay/ToastCard.tsx picks the open one,
 * overlay/ToastQuestBlock.tsx draws both shapes). A drop that feeds three quests was three full
 * walkthroughs stacked in a notification, which is a page, not a card — and the window now GROWS to
 * whatever it draws, so the tightening is what keeps a celebration from being one.
 */
export const TOAST_MAX_QUESTS = 3
/**
 * Most steps a quest block prints (a window around the lit step; the rest is a "+N more" line).
 *
 * 6 → 4 on 2026-09-08, with the owner's "the bottom of the bubble appears cut off" report. The
 * window still CENTRES on the lit step, so the step that names the drop is on screen either way;
 * what shrinks is the context around it, and `before`/`after` absorb the difference honestly. Four
 * is one line of anchor and three of neighbourhood, which is what a notification has room to say.
 */
export const TOAST_MAX_QUEST_STEPS = 4
/** Longest a printed step may be — the wiki's walkthrough paragraphs are cut, never wrapped forever. */
export const TOAST_MAX_STEP_TEXT = 160

// ---- the introduction card (JOS-83) ---------------------------------------------------
//
// WHY A CARD AND NOT A LABEL. The celebration overlay's resting state is an EMPTY, transparent,
// click-through strip, and that is exactly what lets it default ON: it costs the player nothing
// the 99.9% of the time nothing is being celebrated. Anything permanently painted there —
// a title bar, a watermark, a hairline outline — would park chrome over the game forever and
// trade a rare confusion for a constant one.
//
// So the overlay says what it is ONCE, the first time it ever comes up, through the mechanism it
// already has: a card, in the queue, with the same clock, the same hover-pin and the same close
// button every other card now carries. A user who has never seen a celebration therefore meets a
// LABELLED, DISMISSIBLE card instead of a nameless rectangle — which is the whole of the report
// this exists for (a new user who took the strip for a malfunction and uninstalled).

/** The introduction's dedupe key. Stable, so a double-mount refreshes one card rather than two. */
export const TOAST_INTRO_ID = 'overlay-intro'

/**
 * How long the introduction holds. The MAXIMUM a card may ever hold, and bounded on purpose:
 * a card on screen is a card capturing the mouse over the strip (ToastOverlay.useMouseCapture),
 * so an introduction that waited forever for a click would be a permanent hole in the game's
 * input. Long enough to read and act on, short enough that ignoring it costs nothing.
 */
export const TOAST_INTRO_MS = TOAST_MAX_DURATION_MS

/** The line the introduction card prints under its subtitle — what the window IS, and the two
 *  ways out of it. Lives here (not in the component) so a test can pin the promise it makes. */
export const TOAST_INTRO_BODY =
  'This window belongs to EQ Zera, not to EverQuest. Close it with the ×, or switch it off any time in Preferences → Overlays.'

/**
 * The one card the celebration overlay shows about itself. Pure and argument-free: it is the same
 * text on every install, and building it here rather than in the component is what lets
 * `npm test` assert that the app NAMES ITSELF in it.
 */
export function introToastPayload(): ToastPayload {
  return {
    id: TOAST_INTRO_ID,
    kind: 'intro',
    title: 'EQ Zera - celebration overlay',
    subtitle:
      'Boss kills, Sky quest completions, level-ups, quest item drops and wished items will appear here.',
    durationMs: TOAST_INTRO_MS
  }
}

// ---- the card's own call to action (JOS-334) ------------------------------------------
//
// THE CARD WAS CLICKABLE AND SAID SO TO NOBODY. The level-up toast (the first kind whose whole
// card is the click target, because a level carries no reward block to hang the affordance on)
// shipped as a title and a subtitle over a pointer cursor — and a pointer cursor is not an
// affordance in a window a player almost never hovers before deciding to ignore it. The card now
// prints the promise it was already keeping.
//
// THE WORDS LIVE HERE, NOT IN THE COMPONENT, for the reason TOAST_INTRO_BODY does: a string this
// small is still a PROMISE the app makes, and `npm test` can pin a promise in a pure module
// without Electron, a window or a screenshot.
//
// WHY THESE WORDS. "See what's new" is already the app's voice for "go read the thing that
// changed" — WhatsNewTeaser.tsx says exactly that about a release — and the destination this link
// lands on is literally titled "New at this level" (NewAtLevelPanel.tsx), so the label is a
// sentence the panel finishes rather than a generic "Open". The LEVEL is named because the card
// may be the second one in a stack and because a ding is about a number: "See what's new at 24"
// tells the reader both where they are going and which of the two cards they are answering.
//
// AND IT SPEAKS ONLY FOR DESTINATIONS IT CAN NAME. An unnamed view gets NO label rather than an
// invented one: the whole-card click keeps working exactly as before, and a card would rather
// under-promise than print a sentence about a place this function is guessing at (law 1's habit,
// applied to prose). Today that means the leveling anchor and nothing else — the Sky reward's
// destination is already visible as its reward block, and a boss kill names no destination at all.

/**
 * The visible label for a card whose OWN body is the deep link, or undefined when there is
 * nothing honest to print. Pure: the wording is a test's business, not a screenshot's.
 */
export function toastActionLabel(focus: AppFocus | undefined): string | undefined {
  if (focus?.view !== 'leveling') return undefined
  // A leveling focus with no level anchors the panel on the character's own — still "what's new",
  // just not new AT anything this card can name.
  return focus.level === undefined ? 'See what’s new' : `See what’s new at ${String(focus.level)}`
}

/** The deep-link destinations a toast may name. Mirrors the AppFocusView union (closed set). */
const FOCUS_VIEWS: AppFocusView[] = ['mobs', 'posky', 'leveling', 'quests', 'wishlist']

/** Levels the game can state. A focus asking for level 0 or 900 is a bug, not a destination. */
const MAX_FOCUS_LEVEL = 200

function cappedText(v: unknown, max = TOAST_MAX_TEXT): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined
}

/**
 * Validate a focus target against the closed view union; anything else is dropped.
 *
 * Each anchor is capped or bounded on its own terms — `mob` and `quest` are display/lookup text
 * (capped, never a path), `level` is a small integer. An unknown property never survives: the
 * result is rebuilt field by field, so what crosses to the app's renderer is exactly this
 * vocabulary and nothing the asking window invented.
 */
function validFocus(v: unknown): AppFocus | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const o = v as Record<string, unknown>
  const view = typeof o.view === 'string' ? o.view : ''
  if (!(FOCUS_VIEWS as string[]).includes(view)) return undefined
  const out: AppFocus = { view: view as AppFocusView }
  const mob = cappedText(o.mob)
  if (mob) out.mob = mob
  const quest = cappedText(o.quest)
  if (quest) out.quest = quest
  const level = positiveInt(o.level)
  if (level !== undefined && level <= MAX_FOCUS_LEVEL) out.level = level
  return out
}

/**
 * The quest page titles a quest-item request names, or undefined when it names none worth keeping.
 * Each title is capped text, blanks and repeats fall out, and the list is cut at the card's own cap.
 */
function validQuestPages(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const pages: string[] = []
  for (const p of v) {
    const t = cappedText(p)
    if (t && !pages.includes(t)) pages.push(t)
    if (pages.length >= TOAST_MAX_QUESTS) break
  }
  return pages.length > 0 ? pages : undefined
}

/**
 * The OPTIONAL half of a request, each field kept only when it validates. Its own function so the
 * required-field gate above it stays a short read (and under the complexity ceiling).
 */
function optionalFields(o: Record<string, unknown>, kind: ToastKind): Partial<ToastRequest> {
  const out: Partial<ToastRequest> = {}
  const subtitle = cappedText(o.subtitle)
  if (subtitle) out.subtitle = subtitle
  const itemName = cappedText(o.itemName)
  if (itemName) out.itemName = itemName
  const focus = validFocus(o.focus)
  if (focus) out.focus = focus
  // Quest pages ride ONLY a quest-item request: on any other kind they are noise a window would
  // draw, so they are dropped with the rest of the unknown properties.
  const questPages = kind === 'questItem' ? validQuestPages(o.questPages) : undefined
  if (questPages) out.questPages = questPages
  const durationMs = positiveInt(o.durationMs)
  if (durationMs !== undefined) {
    out.durationMs = Math.min(TOAST_MAX_DURATION_MS, Math.max(TOAST_MIN_DURATION_MS, durationMs))
  }
  return out
}

/**
 * Re-validate a renderer-supplied toast request. Returns a NEW object carrying only the
 * fields this module names — unknown properties are stripped, not passed through — or null
 * when the request cannot be honoured (no id, no title, or an unknown kind).
 *
 * TWO REFUSALS ARE NAMED HERE BECAUSE THEY ARE THE UPDATE CARD'S (EQ Zera, 2026-09-08): the kind
 * `update` is not in `TOAST_KINDS`, so a request naming it returns null outright; and `action` is
 * not a field this function copies, so a request carrying one loses it even on a kind that is
 * accepted. Between them a renderer cannot ask for a card that downloads or installs anything —
 * which is the point, since the only process that may offer that is the one that owns the updater.
 */
export function validateToastRequest(input: unknown): ToastRequest | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Record<string, unknown>
  const id = cappedText(o.id)
  const title = cappedText(o.title)
  const kind = typeof o.kind === 'string' && (TOAST_KINDS as string[]).includes(o.kind)
    ? (o.kind as ToastKind)
    : null
  if (!id || !title || !kind) return null
  return { id, kind, title, ...optionalFields(o, kind) }
}

// ---- the item card's stat lines -------------------------------------------------------
//
// The in-game item window has a dozen rows; a toast has room for three. What survives is what
// tells you whether the thing you just won is worth wearing: its flags, where it goes, the
// numbers, and the effect on it. Everything is taken VERBATIM from the parsed block — nothing
// here computes, ranks or judges a stat (law 1).

/**
 * Flags + slot, the item window's first two rows, folded into one.
 *
 * A wiki stat block usually opens with the item's own NAME and a rule of dashes, and
 * `parseStatsBlock` — which never drops anything it does not understand (law 1) — keeps both as
 * FLAGS. The full item window can afford to print them; a three-line toast card cannot, and the
 * name is already the line above. So those two are skipped HERE, at the point of display, and
 * nowhere upstream.
 */
function headerLine(b: ItemStatBlock, name: string): string | undefined {
  const key = name.trim().toLowerCase()
  const flags = b.flags
    .filter((f) => !/^-+$/.test(f) && f.trim().toLowerCase() !== key)
    .slice(0, 3)
    .join(' · ')
  const slot = b.slot ? `Slot: ${b.slot}` : ''
  return [flags, slot].filter(Boolean).join('  ') || undefined
}

/** AC + the attribute grid, in source order, as `AC 21 · STR +20 · HP +80`. */
function statsLine(b: ItemStatBlock): string | undefined {
  const parts: string[] = []
  if (typeof b.ac === 'number') parts.push(`AC ${String(b.ac)}`)
  if (typeof b.dmg === 'number') parts.push(`DMG ${String(b.dmg)}`)
  if (typeof b.atkDelay === 'number') parts.push(`Delay ${String(b.atkDelay)}`)
  for (const s of b.stats) parts.push(`${s.key} ${s.value}`)
  return parts.length ? parts.slice(0, 6).join(' · ') : undefined
}

/** The first effect line, named the way the block names it. */
function effectLine(b: ItemStatBlock): string | undefined {
  const e = b.effects[0]
  if (!e) return undefined
  const kind = e.kind === 'effect' ? 'Effect' : `${e.kind[0].toUpperCase()}${e.kind.slice(1)} Effect`
  return `${kind}: ${e.name}`
}

/**
 * Fall back to the RAW stat-block text when the structured parse produced nothing — the wiki
 * writes some blocks in shapes the parser leaves in `extras`, and printing the page's own
 * lines is more honest than printing none.
 */
function rawLines(statsBlock: string | undefined): string[] {
  if (!statsBlock) return []
  return statsBlock
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^-+$/.test(l))
    .slice(1, 1 + TOAST_MAX_LINES)
}

/** The name colour hint: LORE first (the flag that constrains you), then MAGIC. */
function colorFlagOf(k: ItemKnowledge): string | undefined {
  if (k.lore) return 'lore'
  const flags = k.stats?.flags ?? []
  if (flags.some((f) => /magic/i.test(f))) return 'magic'
  return undefined
}

/**
 * Turn an item's knowledge into the compact card the toast embeds. Pure, so the exact lines a
 * Sky reward prints are pinned by a test rather than by looking at the app.
 */
export function toastItemCard(k: ItemKnowledge): ToastItemCard {
  const b = k.stats
  const lines = (
    b
      ? [headerLine(b, k.name), statsLine(b), effectLine(b)].filter((l): l is string => !!l)
      : rawLines(k.statsBlock)
  )
    .map((l) => l.slice(0, TOAST_MAX_LINE))
    .slice(0, TOAST_MAX_LINES)
  const card: ToastItemCard = { name: k.name.slice(0, TOAST_MAX_TEXT), lines }
  const iconId = positiveInt(k.iconId)
  if (iconId !== undefined) card.iconId = iconId
  const colorFlag = colorFlagOf(k)
  if (colorFlag) card.colorFlag = colorFlag
  return card
}
