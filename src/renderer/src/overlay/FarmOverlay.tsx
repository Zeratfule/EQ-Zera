// FarmOverlay (roadmap 2 item 8) — the CAMP read, floating over the game: what this spot is paying
// per hour, measured over the zone stay you are standing in right now.
//
// The question it answers is the one a farmer asks every twenty minutes and currently answers by
// alt-tabbing: is this camp worth staying at. So the window is six lines, each one
// `label · value`, and there is nothing to configure — no slice picker, no row checklist, no
// denominator toggle. The XP overlay owns all three of those and answers "how is my character
// doing"; this one answers "how is this CAMP doing", and every knob those controls offer would
// widen it back into the first question.
//
// IT DERIVES NOTHING. Every number is `overlay/farmRows.ts` — pure, node-tested, and built out of
// `rangeStats`, `windowLootRates`, `respawnReading` and the `coin` module's own rows. This file
// draws the result and owns the window: the persisted config, the drag/resize, the alpha and the
// text size. A second rate math in a floating window is the drift `windowScope.ts` exists to
// prevent, one process further away.
//
// THE COIN LADDER IS ON THE ROW, NOT IN A TOOLTIP. `shared/acquireEvents.ts` states the law: EQ's
// platinum/gold/silver/copper conversion is printed in NO line of the log, so a consumer that wants
// coin-per-hour DECLARES ITS OWN RATE IN THE OPEN. `farmRows.COIN_ROW_LABEL` is that declaration
// spelled into the label of the very row it divides — `Coin/h (1p=10g=100s=1000c)` — so nobody can
// read the number without reading the assumption. It is deliberately not a hover: JOS-358 keeps
// these windows' tooltips in the title bar, and an assumption behind a hover is a hidden one.
//
// IT TICKS ITSELF, and the beat is between the two this bundle already has. The respawn window
// ticks at 1 Hz because a countdown must move while the log is silent and its rows cost no fold;
// the XP window ticks at 30 s because nothing in it is a countdown. This window has one countdown
// among five rates, and its whole view is a `rangeStats` fold — so it re-reads every 5 s, which is
// fast enough that a `m + ss` clock never reads as frozen and slow enough that the fold is not
// something anybody notices.
//
// MUI-FREE, plain divs and inline styles, like every file in this bundle.

import { type JSX, useEffect, useMemo, useState } from 'react'
import type { CharacterSnap, LootEvent, LootSnap, ProgressionSnap } from '@shared/types'
import { EMPTY_COIN_SNAP, type CoinSnap } from '@shared/coinTypes'
import { EMPTY_RESPAWN_SNAP, type RespawnSnap } from '@shared/respawn'
import { EMPTY_PROGRESSION } from '../features/leveling/progressionDelta'
import { OverlayHeader } from './OverlayHeader'
import { FOOTER_ROW, OverlayContent } from './overlayScale'
import { TextScaleStepper } from './TextScaleStepper'
import { useOverlayModule } from './useOverlayModule'
import { type OverlayChrome, useOverlayChrome } from './useOverlayChrome'
import { FARM_HYDRATING, farmOverlayView, type FarmRow } from './farmRows'
import { PALETTE, withAlpha } from '../../../shared/palette'

/** This window's accent — a mint teal, deliberately none of the five already in use (damage violet,
 *  healing green, debuff red, XP blue, respawn amber). Two windows that look alike at a glance
 *  would be worse than either of them being the wrong hue. */
const ACCENT = '#7fd7c4'
const ACCENT_BG = 'rgba(127,215,196,0.2)'

const NO_LOOT: LootEvent[] = []
const NO_CHARACTER: CharacterSnap = { character: null }

/** How often the readings are re-folded while the log is silent — see the file header. */
const TICK_MS = 5000

/** A local clock, so a stay that ends at the live edge keeps re-reading while nothing arrives. It
 *  asks main for nothing: the fold is over state this window already holds. */
function useFarmClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [])
  return now
}

/**
 * One printed line: the label, then the reading, on ONE row.
 *
 * NO HOVER (JOS-358) — these windows keep tooltips in the title bar. What a row can say, it says in
 * the open, which is why the coin row's ladder is in its label rather than behind a pointer.
 */
function FarmLine({ row }: { row: FarmRow }): JSX.Element {
  return (
    <div
      data-testid="farm-row"
      data-row={row.id}
      style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 2px' }}
    >
      {/* NO `textTransform: uppercase` HERE, unlike the XP window's labels, and the coin row is
          why: the ladder is spelled into this label and EQ's denominations are lower case, so
          upper-casing it would print `1P=10G=100S=1000C` — a declared assumption rendered in a
          notation nobody writes. One row's honesty outranks five rows' typography. */}
      <span
        style={{
          fontSize: 9.5,
          letterSpacing: 0.3,
          color: 'rgba(255,255,255,0.45)',
          flexShrink: 0,
          whiteSpace: 'nowrap'
        }}
      >
        {row.label}
      </span>
      <span
        data-testid="farm-value"
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: ACCENT,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {row.value}
      </span>
    </div>
  )
}

/** Footer — interactive mode only, and it is the shortest one in this bundle: there is nothing to
 *  configure here but how the window itself looks (see the file header). */
function FarmFooter({
  bgAlpha,
  textScale,
  patch,
  noDrag
}: {
  bgAlpha: number
  textScale: number
  patch: OverlayChrome['patch']
  noDrag: React.CSSProperties
}): JSX.Element {
  return (
    <div style={{ ...FOOTER_ROW, ...noDrag, gap: 6, fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>
      <input
        type="range"
        aria-label="Background opacity"
        min={0.1}
        max={1}
        step={0.02}
        value={bgAlpha}
        onChange={(e) => {
          patch({ bgAlpha: Number(e.target.value) })
        }}
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 20, accentColor: ACCENT, height: 4 }}
      />
      <TextScaleStepper textScale={textScale} patch={patch} noDrag={noDrag} />
    </div>
  )
}

export default function FarmOverlay(): JSX.Element {
  // FIVE MODULES, and every one of them the app's own — `progression` for the stay and the pace,
  // `loot` for the drop rate, `coin` for the income, `respawn` for the next clock, `character` for
  // the level on the header. Nothing is re-folded here.
  const prog = useOverlayModule<ProgressionSnap>('progression', EMPTY_PROGRESSION)
  const loot = useOverlayModule<LootSnap>('loot', NO_LOOT)
  const coin = useOverlayModule<CoinSnap>('coin', EMPTY_COIN_SNAP)
  const respawn = useOverlayModule<RespawnSnap>('respawn', EMPTY_RESPAWN_SNAP)
  const who = useOverlayModule<CharacterSnap>('character', NO_CHARACTER)
  const { locked, bgAlpha, textScale, hovering, patch, toggleLock, capture, dragRegion, noDrag } =
    useOverlayChrome()
  const now = useFarmClock()

  const view = useMemo(
    () => farmOverlayView({ snap: prog, loot, coin: coin.rows, respawn, level: who.level, nowMs: now }),
    [prog, loot, coin, respawn, who.level, now]
  )

  return (
    <div
      data-testid="farm-overlay"
      style={{
        // 100%, NOT 100vw/100vh — a viewport unit inside the scaled content pane resolves against
        // the window and is then zoomed (overlayScale).
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter, "Segoe UI", Roboto, system-ui, sans-serif',
        color: '#f2f2f2',
        background: withAlpha(PALETTE.bg, bgAlpha),
        border: locked ? '1px solid rgba(255,255,255,0.04)' : `1px solid ${ACCENT}66`,
        borderRadius: 8,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      <OverlayHeader
        tag="FARM"
        title="Farm"
        titleColor={ACCENT}
        tail={view.level === null ? undefined : `lvl ${view.level}${view.levelCue ? ` ${view.levelCue}` : ''}`}
        iconAccentBg={ACCENT_BG}
        chrome={{ locked, hovering, dragRegion, noDrag, toggleLock, capture }}
      />

      <OverlayContent textScale={textScale} testId="farm-rows" locked={locked} capture={capture}>
        {view.hydrating ? (
          // HYDRATION IS A STATE AND THE WINDOW SHOWS IT (AGENTS.md). Six em-dashes read as a
          // broken window; one quiet line reads as a young one, which is what it is.
          <div data-testid="farm-hydrating" style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', padding: '8px 2px' }}>
            {FARM_HYDRATING}
          </div>
        ) : (
          view.rows.map((r) => <FarmLine key={r.id} row={r} />)
        )}
        {/* ONE SPAN FOR THE WHOLE WINDOW, stated once rather than repeated on every row: a rate
            that never stated its span lets one drop in five minutes read as a confident 12/hr. It
            is the very denominator every rate above divided by, so the two cannot disagree. */}
        {!view.hydrating && (
          <div data-testid="farm-span" style={{ fontSize: 9, color: 'rgba(255,255,255,0.38)', padding: '3px 2px 0' }}>
            {view.span}
            {/* JUST ARRIVED, SAID ONCE. A stay that is forty seconds old cannot state a rate per
                hour, and four em-dashes with no explanation read as a broken window — so the
                reason is printed in the open, beside the very span it is about. */}
            {!view.measurable && <span data-testid="farm-too-short"> · too short to rate</span>}
          </div>
        )}
      </OverlayContent>

      {!locked && <FarmFooter bgAlpha={bgAlpha} textScale={textScale} patch={patch} noDrag={noDrag} />}
    </div>
  )
}
