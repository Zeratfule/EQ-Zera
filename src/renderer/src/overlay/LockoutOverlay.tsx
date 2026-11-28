// LockoutOverlay (2026-11-27) — when your Denon's Desperate Dirge can land on the same targets again.
//
// The 2026-11-10 patch lets the dirge land on one target only once every two ticks, and the game
// prints NOTHING when a locked target shrugs it off. So the clock starts on your last LANDING: the
// `buffTimers` module publishes one row per landing burst (live tail only), and this window reads
// each row against the wall clock through shared/spellLockouts.ts — red while it certainly cannot
// land, amber while it may, green once it certainly can. With nothing running it says each rule's
// spell is ready, so the window never just goes blank.
//
// IT DERIVES NOTHING AND FOLDS NOTHING, and it ticks itself at 1 Hz like the respawn clocks: a
// lockout runs out precisely while the log is quiet. No row hover (JOS-358): the targets the burst
// hit are a line on the row instead.
//
// MUI-FREE, plain divs and inline styles, like every file in this bundle.

import { type JSX, useEffect, useState } from 'react'
import type { BuffTimersSnap } from '@shared/buffTimers'
import {
  EMPTY_LOCKOUTS,
  idleLockoutRules,
  lockoutRankLabel,
  lockoutTargetsLabel,
  lockoutTimeLabel,
  shownLockouts,
  type LockoutPhase,
  type LockoutReading,
  type SpellLockout
} from '@shared/spellLockouts'
import { fmtDuration } from '../features/buffs/format'
import { OverlayHeader } from './OverlayHeader'
import { FOOTER_ROW, OverlayContent } from './overlayScale'
import { TextScaleStepper } from './TextScaleStepper'
import { useOverlayModule } from './useOverlayModule'
import { type OverlayChrome, useOverlayChrome } from './useOverlayChrome'
import { PALETTE, withAlpha } from '../../../shared/palette'

/** The window's accent: a song-ish teal, none of the other windows' colours. */
const ACCENT = '#5fc8c0'
const ACCENT_BG = 'rgba(95,200,192,0.2)'
const TONE: Record<LockoutPhase, string> = {
  locked: '#e07a6a',
  maybe: PALETTE.amber,
  ready: '#7fd18b'
}

const EMPTY_TIMERS: BuffTimersSnap = { holds: [], ends: [], lockouts: EMPTY_LOCKOUTS }

function useSecondsClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(id)
    }
  }, [])
  return now
}

/** The window: earliest marked as a notch, the fill growing toward certain in the phase colour. */
function LockoutBar({ reading, tone }: { reading: LockoutReading; tone: string }): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        height: 3,
        borderRadius: 2,
        background: 'rgba(255,255,255,0.08)',
        marginTop: 2,
        overflow: 'hidden'
      }}
    >
      <div
        data-testid="lockout-fill"
        style={{ width: `${(reading.fraction * 100).toFixed(1)}%`, height: '100%', background: tone }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${(reading.earliestFraction * 100).toFixed(1)}%`,
          width: 1,
          background: 'rgba(255,255,255,0.55)'
        }}
      />
    </div>
  )
}

function LockoutRow({ lockout, reading }: { lockout: SpellLockout; reading: LockoutReading }): JSX.Element {
  const tone = TONE[reading.phase]
  const rank = lockoutRankLabel(lockout)
  return (
    <div
      data-testid="lockout-row"
      data-phase={reading.phase}
      data-spell={lockout.spell}
      data-count={String(lockout.count)}
      aria-label={`${lockout.spell} on ${lockoutTargetsLabel(lockout)}`}
      style={{ padding: '2px 2px 3px 5px', borderLeft: `2px solid ${tone}`, marginBottom: 3 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'nowrap', minWidth: 0 }}>
        <span
          style={{
            fontSize: 11.5,
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {lockout.spell}
          {rank != null && <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>{rank}</span>}
          {lockout.count > 1 && (
            <span data-testid="lockout-count" style={{ color: 'rgba(255,255,255,0.55)', marginLeft: 4 }}>
              {`x${String(lockout.count)}`}
            </span>
          )}
        </span>
        <span
          data-testid="lockout-time"
          style={{ fontSize: 12, fontWeight: 700, color: tone, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
        >
          {lockoutTimeLabel(reading, fmtDuration)}
        </span>
      </div>
      <LockoutBar reading={reading} tone={tone} />
      <div
        data-testid="lockout-targets"
        style={{
          fontSize: 9,
          color: 'rgba(255,255,255,0.45)',
          marginTop: 2,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {lockoutTargetsLabel(lockout)}
      </div>
    </div>
  )
}

function LockoutFooter({
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
    <div style={{ ...FOOTER_ROW, ...noDrag, gap: 6 }}>
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

export default function LockoutOverlay(): JSX.Element {
  const snap = useOverlayModule<BuffTimersSnap>('buffTimers', EMPTY_TIMERS).lockouts ?? EMPTY_LOCKOUTS
  const { locked, bgAlpha, textScale, hovering, patch, toggleLock, capture, dragRegion, noDrag } =
    useOverlayChrome()
  const nowMs = useSecondsClock()
  const rows = shownLockouts(snap, nowMs)
  const idle = idleLockoutRules(snap, rows)

  return (
    <div
      data-testid="lockout-overlay"
      style={{
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
        tag="LOCK"
        title="Dirge lockout"
        titleColor={ACCENT}
        tail={rows.length > 0 ? String(rows.length) : undefined}
        tailTitle="Red: cannot land on those targets yet. Amber: may. Green: will."
        iconAccentBg={ACCENT_BG}
        chrome={{ locked, hovering, dragRegion, noDrag, toggleLock, capture }}
      />

      <OverlayContent textScale={textScale} testId="lockout-overlay-rows" locked={locked} capture={capture}>
        {rows.map(({ lockout, reading }) => (
          <LockoutRow key={`${lockout.spell}|${String(lockout.startedTs)}`} lockout={lockout} reading={reading} />
        ))}
        {idle.map((rule) => (
          <div
            key={rule.spell}
            data-testid="lockout-idle"
            style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', padding: '6px 2px' }}
          >
            {`${rule.spell}: ready`}
          </div>
        ))}
      </OverlayContent>

      {!locked && <LockoutFooter bgAlpha={bgAlpha} textScale={textScale} patch={patch} noDrag={noDrag} />}
    </div>
  )
}
