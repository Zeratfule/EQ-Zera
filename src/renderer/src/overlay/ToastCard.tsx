// ToastCard — one celebration card, and the compact item window it embeds.
//
// MUI-FREE BY LAW (AGENTS.md: the overlay bundle is plain React + inline styles). This file is
// deliberately not the lazily-imported `ItemWindow` the event overlay's hover cards use: a
// toast's reward block is three lines and an icon, it arrives PRE-FORMATTED in the payload
// (docs/plans/celebration-toasts.md T5 — the overlay fetches nothing), and pulling MUI into the
// window that is supposed to be the cheapest thing on screen would defeat the point.
//
// LOOK (§4): dark glass, an accent-coloured title, a muted subtitle, a 10px radius and a hairline. Enter is
// a 250 ms slide-down + fade; exit is the same in reverse over 300 ms. Both are CSS transitions
// on transform/opacity — compositor-only properties, so the animation costs the game nothing.
//
// SCALE (owner, 2026-08-05: "look and feel is good, but it needs to be a bit bigger/more
// prominent"). Every number below went up by roughly a quarter — 18px title, 13px subtitle,
// 52px icon, more padding — against a 560px lane (main/overlayLayout.ts). The MOTION is
// deliberately untouched: it was already right, and a celebration that arrives faster or
// further would read as an alarm.
//
// THE ITEM CARD IS THE CLICK TARGET (T6) where there is one: it takes the pointer cursor and a
// hairline highlight on hover. The card as a whole pins on hover; only the reward block claims to
// go anywhere.
//
// …AND WHERE THERE IS NO REWARD BLOCK, THE CARD SAYS SO IN WORDS (JOS-334). The level-up card is
// the whole click target — a level is not a reward you can hold — and it spent its first release
// advertising that with a pointer cursor and nothing else, which is an affordance only for a
// reader who was already hovering a card they had no reason to hover. It now prints a compact
// action naming where the click goes ("See what's new at 24"). The card-wide click is untouched:
// the button fires the SAME `onOpen`, so this is the promise becoming visible, not a second path.
//
// EVERY CARD SAYS WHOSE IT IS, AND EVERY CARD CLOSES (JOS-83). A new user reported the strip as a
// nameless rectangle they took for a malfunction, so the card grew a chrome row: the app's name on
// the left, a × on the right. The row is INSIDE the card, which is the only thing this overlay
// ever paints — the resting state is still an empty transparent window, and that is what keeps
// the kind defaultable-on. The × dismisses THIS card (the queue reducer has always had the
// action; nothing was wired to it), and on the introduction card there is one more way out: a
// button that closes the overlay for good.

import { type CSSProperties, type JSX, type MouseEvent, useEffect, useState } from 'react'
import {
  TOAST_INTRO_BODY,
  toastActionLabel,
  type ToastItemCard,
  type ToastPayload,
  type ToastQuestCard
} from '@shared/toast'
import { updateActionLabel } from '@shared/updateToast'
import { TOAST_ENTER_MS, TOAST_EXIT_MS } from './toastQueue'
import { ToastQuestBlock } from './ToastQuestBlock'
import { PALETTE, withAlpha } from '../../../shared/palette'

const ACCENT = PALETTE.accent
const MUTED = '#a8b0c6'
const ITEM_GREEN = '#5fe08a'
const MONO = '"Consolas","Courier New",monospace'

/** What the chrome row prints. Short enough for the lane at any text scale, specific enough that
 *  a player who has never opened Preferences knows which program put it there. */
const OVERLAY_LABEL = 'EQ Companion · celebration overlay'

/**
 * WHICH QUEST BLOCK SHOWS ITS STEPS — exactly one, and the rule is one line long (2026-09-08).
 *
 * THE ONE THAT NAMES THE LOOTED ITEM, else the FIRST. A drop that feeds three quests used to draw
 * three step windows stacked in a notification, which is a page rather than a card and is how the
 * bubble came to be taller than its window. The lit block is the one the reader came for: it holds
 * the step that says what to do with the thing they are holding. With nothing lit anywhere, the
 * first block is the card's own order and therefore the honest default.
 *
 * The other blocks are still DRAWN, named and clickable — the card's promise is that it lists every
 * quest that wants the drop, and that promise is kept by the header line (ToastQuestBlock.tsx).
 */
function openQuestIndex(quests: ToastQuestCard[]): number {
  const lit = quests.findIndex((q) => q.litStep !== undefined)
  return lit === -1 ? 0 : lit
}

/** The name colour the payload's hint asks for. Unknown/absent ⇒ the ordinary item green. */
function nameColor(flag: string | undefined): string {
  return flag === 'lore' || flag === 'magic' ? ACCENT : ITEM_GREEN
}

/** Item icons come from the app's PERMANENT cache (`eqimg://`), never the network — the
 *  overlay's CSP lists `img-src 'self' data: eqimg:` precisely so that stays structural. */
function iconUrl(iconId: number): string {
  return `eqimg://item/${String(iconId)}`
}

/**
 * The identity + close row every card carries.
 *
 * `stop` on the button is load-bearing: a card with no reward block IS a click target (the
 * level-up card takes you to the Leveling tab), and "close" must never double as "go there".
 */
function CardChrome({ onDismiss }: { onDismiss: () => void }): JSX.Element {
  const [hot, setHot] = useState(false)
  const close = (e: MouseEvent): void => {
    e.stopPropagation()
    onDismiss()
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 6
      }}
    >
      <span
        data-testid="toast-source-label"
        style={{
          color: MUTED,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          opacity: 0.85,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {OVERLAY_LABEL}
      </span>
      <button
        type="button"
        data-testid="toast-close"
        // The ARIA name and nothing else (JOS-358). A `title` here said 'Dismiss' over a ✕ that
        // already says it, on a card rather than in a window title bar — and this window's cards
        // slide away on their own timer, which is exactly the shape a stranded popup outlives.
        aria-label="Dismiss this celebration"
        onClick={close}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          lineHeight: '18px',
          padding: 0,
          borderRadius: 4,
          border: `1px solid ${hot ? ACCENT : 'rgba(255,255,255,0.18)'}`,
          background: hot ? withAlpha(PALETTE.accent, 0.16) : 'transparent',
          color: hot ? ACCENT : MUTED,
          fontSize: 13,
          cursor: 'pointer'
        }}
      >
        ×
      </button>
    </div>
  )
}

/**
 * The introduction card's extra half (JOS-83): what this window is, and the way to be rid of it
 * permanently rather than for six seconds. `eqOverlay.close()` is the same door the meters' close
 * buttons use — it closes the window AND persists `open:false`, so it does not come back next
 * launch and Preferences shows the state it is actually in.
 */
function IntroBlock(): JSX.Element {
  const [hot, setHot] = useState(false)
  return (
    <div style={{ marginTop: 10 }}>
      <div data-testid="toast-intro-body" style={{ color: MUTED, fontSize: 12, lineHeight: 1.5 }}>
        {TOAST_INTRO_BODY}
      </div>
      <button
        type="button"
        data-testid="toast-intro-disable"
        onClick={(e) => {
          e.stopPropagation()
          window.eqOverlay.close()
        }}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        style={{
          marginTop: 10,
          border: `1px solid ${hot ? ACCENT : withAlpha(PALETTE.accent, 0.45)}`,
          borderRadius: 4,
          background: hot ? withAlpha(PALETTE.accent, 0.16) : 'transparent',
          color: ACCENT,
          fontSize: 12,
          padding: '4px 10px',
          cursor: 'pointer'
        }}
      >
        Turn this overlay off
      </button>
    </div>
  )
}

/**
 * THE CALL TO ACTION on a card whose own body is the link (JOS-334).
 *
 * WHY A BUTTON AND NOT A HINT. The alternative shapes were a permanent "click me" line of prose
 * and a chevron, and both fail the same way: they describe the card instead of offering
 * something. This is the shape the overlay already uses for an action — IntroBlock's "Turn this
 * overlay off", down to the accent hairline, the 4px radius and the warm fill on hover — so the
 * card gains a control the reader has met before rather than a new vocabulary in the one window
 * that is supposed to be the cheapest thing on screen. Compact on purpose: a celebration is
 * three seconds of attention, and a full-width button would read as a dialog.
 *
 * IT IS A PROMISE, NOT A SECOND PATH. `onClick` here IS the card's own `onOpen` — the same deep
 * link, through the same `focusApp` door. Nothing new is reachable through this button; what is
 * new is that the card admits, before it is hovered, that clicking goes somewhere.
 */
function CardAction({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  const [hot, setHot] = useState(false)
  return (
    <div style={{ marginTop: 9 }}>
      <button
        type="button"
        data-testid="toast-action"
        onClick={(e) => {
          // `stop` is load-bearing exactly as it is on the × (CardChrome): the CARD behind this
          // button fires the same link, and one click must be one landing — not two trips through
          // `focusApp`, which would bump the focus nonce twice and pulse the panel twice for a
          // single answer to a single question.
          e.stopPropagation()
          onClick()
        }}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        style={{
          border: `1px solid ${hot ? ACCENT : withAlpha(PALETTE.accent, 0.45)}`,
          borderRadius: 4,
          background: hot ? withAlpha(PALETTE.accent, 0.16) : 'transparent',
          color: ACCENT,
          fontSize: 12,
          padding: '3px 10px',
          cursor: 'pointer'
        }}
      >
        {label}
      </button>
    </div>
  )
}

function RewardBlock({ item, onClick }: { item: ToastItemCard; onClick?: () => void }): JSX.Element {
  const [hot, setHot] = useState(false)
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        display: 'flex',
        gap: 10,
        marginTop: 10,
        padding: 8,
        borderRadius: 8,
        border: `1px solid ${hot && clickable ? ACCENT : 'rgba(255,255,255,0.10)'}`,
        background: 'rgba(255,255,255,0.04)',
        cursor: clickable ? 'pointer' : 'default'
      }}
    >
      {item.iconId !== undefined && (
        <img
          src={iconUrl(item.iconId)}
          alt=""
          width={52}
          height={52}
          style={{ width: 52, height: 52, imageRendering: 'pixelated', flex: '0 0 auto' }}
          onError={(e) => {
            // A miss is never cached, so hiding the <img> is the whole failure path: the next
            // toast retries the fetch and the icon simply appears when the wiki is reachable.
            e.currentTarget.style.display = 'none'
          }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ color: nameColor(item.colorFlag), fontSize: 14, fontFamily: MONO, fontWeight: 700 }}>
          {item.name}
        </div>
        {item.lines.map((l) => (
          <div key={l} style={{ color: MUTED, fontSize: 12, fontFamily: MONO, lineHeight: 1.45 }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The enter/exit transition, as a style. `entering` is true for exactly one frame after mount,
 * which is what gives the browser a FROM state to animate out of — set both at once and there
 * is no transition at all, only a jump.
 */
/**
 * WHAT A CLICK ON THIS CARD DOES, AND WHAT THE BUTTON OVER IT SAYS — one decision, in one place,
 * so the two can never disagree (the JOS-334 rule, now with a second kind of click to keep honest).
 *
 * The order is the precedence: an ACTION card (the updater's, EQ Zera 2026-09-08) drives main and
 * wins; otherwise a card with no reward block is its own deep link, exactly as before; a card whose
 * reward block is the affordance, or which names no destination at all, returns nothing and stays
 * unclickable. `label` is always derived from the same thing that produced `run`, which is what
 * stops the button becoming decoration on a card that goes nowhere.
 */
function cardClick(payload: ToastPayload): { run?: () => void; label?: string } {
  const act = payload.action
  if (act) return { run: () => window.eqOverlay.toastAction(act), label: updateActionLabel(act) }
  const focus = payload.focus
  if (!focus || payload.item) return {}
  return { run: () => window.eqOverlay.focusApp(focus), label: toastActionLabel(focus) }
}

function motionStyle(entering: boolean, exiting: boolean): CSSProperties {
  const hidden = entering || exiting
  return {
    opacity: hidden ? 0 : 1,
    transform: hidden ? 'translateY(-8px)' : 'translateY(0)',
    transition: `opacity ${String(exiting ? TOAST_EXIT_MS : TOAST_ENTER_MS)}ms ease-out, transform ${String(
      exiting ? TOAST_EXIT_MS : TOAST_ENTER_MS
    )}ms ease-out`
  }
}

export function ToastCard({
  payload,
  exiting,
  bgAlpha,
  onHover,
  onDismiss
}: {
  payload: ToastPayload
  exiting: boolean
  bgAlpha: number
  onHover: (over: boolean) => void
  onDismiss: () => void
}): JSX.Element {
  const [entering, setEntering] = useState(true)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntering(false))
    return () => cancelAnimationFrame(id)
  }, [])

  const focus = payload.focus
  const onOpen = focus ? (): void => window.eqOverlay.focusApp(focus) : undefined
  // WHAT THIS CARD IS FOR, decided once (see `cardClick`): a card with no reward block is its own
  // click target — the level-up toast (docs/plans/levelup-whats-new.md §2) was the first, a level
  // being not a reward you can hold — and since JOS-334 it SAYS SO in a visible button rather than
  // in a pointer cursor. Where a reward block exists it stays the only affordance (T6), and an
  // updater card drives main instead of navigating.
  const { run: onCardClick, label: action } = cardClick(payload)
  // …and, on a quest-item card, which of its blocks shows its steps (see `openQuestIndex`).
  const openBlock = openQuestIndex(payload.quests ?? [])

  return (
    <div
      data-testid="toast-card"
      /* The kind, on the DOM: the overlay's OWN introduction (JOS-83) is a card in the same queue
         as a boss kill, and a harness counting CELEBRATIONS must be able to tell them apart
         without reading the card's prose (tests/e2e/character-switch.e2e.mts). */
      data-toast-kind={payload.kind}
      onClick={onCardClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        cursor: onCardClick ? 'pointer' : 'default',
        marginBottom: 10,
        padding: '14px 18px',
        borderRadius: 10,
        border: `1px solid ${withAlpha(PALETTE.accent, 0.35)}`,
        background: withAlpha(PALETTE.bg, String(bgAlpha)),
        backdropFilter: 'blur(6px)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
        ...motionStyle(entering, exiting)
      }}
    >
      <CardChrome onDismiss={onDismiss} />
      <div data-testid="toast-title" style={{ color: ACCENT, fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>
        {payload.title}
      </div>
      {payload.subtitle && (
        <div data-testid="toast-subtitle" style={{ color: MUTED, fontSize: 13, marginTop: 3 }}>
          {payload.subtitle}
        </div>
      )}
      {/* The card's own link, made visible (JOS-334). It renders only where the CARD is the click
          target, which is the same condition that made the pointer cursor appear. */}
      {action && onCardClick && <CardAction label={action} onClick={onCardClick} />}
      {/* A toast says a thing happened; the blocks below it are the only parts that promise to
          take you somewhere. The reward block was the first (T6). */}
      {payload.item && <RewardBlock item={payload.item} onClick={onOpen} />}
      {/* …and a quest-item drop says what the drop is FOR: one block per quest, each its own link
          into the Quests tab (ROADMAP.md §1). */}
      {payload.quests?.map((q, i) => (
        <ToastQuestBlock key={q.page} card={q} expanded={i === openBlock} />
      ))}
      {/* Last, the introduction, whose whole job is to offer a way out (JOS-83). */}
      {payload.kind === 'intro' && <IntroBlock />}
    </div>
  )
}
