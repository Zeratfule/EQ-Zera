// ToastQuestBlock — one quest, on the quest-item celebration card (ROADMAP.md §1).
//
// WHAT IT DRAWS. The quest's name and how the looted item relates to it ('turn-in' or 'reward'),
// where the quest starts, and a short run of its steps with the one that NAMES the item lit — the
// same green rule the Quests tab's walkthrough uses (features/quests/QuestPage.tsx), so a player
// who has seen one recognises the other.
//
// MUI-FREE BY LAW, like every file in this folder: plain React and inline styles, palette tokens
// from shared/palette. And EVERYTHING ARRIVES PRE-CUT FROM MAIN (celebration-toasts T5): the
// window, the caps, the ellipses and the lit index are all decided by shared/toastQuest.ts before
// the payload is sent. This component fetches nothing, looks nothing up, and holds no opinion
// about which steps deserve the room.
//
// WHY THE NUMBERS ARE PRINTED BY HAND. `card.steps` is a WINDOW, not the list: a mid-quest drop
// prints steps 14 to 19 of 31. A native `<ol>` marker would confidently number those 1 to 6, so
// the list carries no markers at all and each row prints `before + i + 1` itself. The counts on
// either side are said out loud for the same reason — a card would rather admit that six of
// thirty-one steps are on screen than let the reader believe the quest ends here.
//
// WHY ITS OWN FILE. ToastCard.tsx sits near the repo's 400-code-line factoring ceiling, and this
// is a coherent piece to lift rather than a fragment: everything about how a QUEST looks on a
// toast is here, and the card keeps what a card is.

import { type JSX, useState } from 'react'
import type { ToastQuestCard } from '@shared/toast'
import { PALETTE, withAlpha } from '../../../shared/palette'

const ACCENT = PALETTE.accent
const MUTED = '#a8b0c6'
const MONO = '"Consolas","Courier New",monospace'

/** How the looted item relates to this quest, in the two words a player uses for it. */
function roleTag(role: ToastQuestCard['role']): string {
  return role === 'reward' ? 'reward' : 'turn-in'
}

/** "3 earlier steps" / "1 more step" — the steps this window left out, counted honestly. */
function stepsWord(n: number, side: 'earlier' | 'more'): string {
  return `${String(n)} ${side} ${n === 1 ? 'step' : 'steps'}`
}

/** The muted one-liner that stands in for the steps above or below the window. */
function Elision({ text, testid }: { text: string; testid: string }): JSX.Element {
  return (
    <div data-testid={testid} style={{ color: MUTED, fontSize: 11, opacity: 0.85, margin: '2px 0' }}>
      {text}
    </div>
  )
}

/**
 * One step, numbered against the FULL quest rather than against the window (see the header).
 *
 * The lit row takes a 2px green rule and a faint green wash; every other row takes the same 2px
 * rule in transparent, so lighting a step moves no text sideways.
 */
function StepRow({ text, number, lit }: { text: string; number: number; lit: boolean }): JSX.Element {
  return (
    <li
      data-testid="toast-quest-step"
      {...(lit ? { 'data-lit': 'true' } : {})}
      style={{
        display: 'flex',
        gap: 6,
        padding: '1px 0 1px 5px',
        borderLeft: `2px solid ${lit ? PALETTE.green : 'transparent'}`,
        background: lit ? withAlpha(PALETTE.green, 0.08) : 'transparent'
      }}
    >
      <span style={{ color: MUTED, fontFamily: MONO, fontSize: 12, flex: '0 0 auto' }}>{`${String(number)}.`}</span>
      <span style={{ color: PALETTE.text, fontSize: 12, lineHeight: 1.4, minWidth: 0 }}>{text}</span>
    </li>
  )
}

/** The quest's name and, on the right, what the drop is to it. */
function QuestHead({ card }: { card: ToastQuestCard }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <span
        data-testid="toast-quest-name"
        style={{ color: ACCENT, fontSize: 14, fontWeight: 700, minWidth: 0 }}
      >
        {card.name}
      </span>
      <span
        data-testid="toast-quest-role"
        style={{
          color: MUTED,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          flexShrink: 0
        }}
      >
        {roleTag(card.role)}
      </span>
    </div>
  )
}

/**
 * The block itself, and the second click target on this card.
 *
 * It goes where the reward block goes — the Quests tab, at THIS quest's page — through the same
 * `focusApp` door every toast deep link uses. `stopPropagation` is load-bearing for the same
 * reason it is on the × and the call to action: one click must be one landing, never a trip
 * through `focusApp` for the block and a second for whatever is behind it.
 */
export function ToastQuestBlock({ card }: { card: ToastQuestCard }): JSX.Element {
  const [hot, setHot] = useState(false)
  return (
    <div
      data-testid="toast-quest"
      data-page={card.page}
      onClick={(e) => {
        e.stopPropagation()
        window.eqOverlay.focusApp({ view: 'quests', quest: card.page })
      }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      style={{
        marginTop: 10,
        padding: 8,
        borderRadius: 8,
        border: `1px solid ${hot ? ACCENT : 'rgba(255,255,255,0.10)'}`,
        background: 'rgba(255,255,255,0.04)',
        cursor: 'pointer'
      }}
    >
      <QuestHead card={card} />
      {card.where && (
        <div data-testid="toast-quest-where" style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>
          {card.where}
        </div>
      )}
      {card.before > 0 && (
        <Elision text={stepsWord(card.before, 'earlier')} testid="toast-quest-earlier" />
      )}
      <ol style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'grid', gap: 2 }}>
        {card.steps.map((step, i) => (
          <StepRow key={`${String(i)}:${step}`} text={step} number={card.before + i + 1} lit={i === card.litStep} />
        ))}
      </ol>
      {card.after > 0 && <Elision text={stepsWord(card.after, 'more')} testid="toast-quest-more" />}
    </div>
  )
}
