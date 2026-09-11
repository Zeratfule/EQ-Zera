// RunOverlay (2026-09-11) — WHERE YOU ARE IN THE CRAWL, floating over the game.
//
// The owner's words after a Befallen 4 (Refined) run: the game's own in-instance tracker window
// "isn't sizeable and it's obtuse, we should do a clean overlay for it" — and then, on scope,
// "Run tracker overlay is all that's needed for this."
//
// IT DERIVES NOTHING. Every number is `shared/runTracker.ts` — pure, node-tested against the
// owner's own run folded through the real engine (tests/runTracker.test.mts). This file draws the
// result and owns the window: the persisted config, the drag/resize, the alpha and the text size.
// Same split, same reason, as the farm meter beside it.
//
// WHAT IT SHOWS AND WHAT IT WILL NOT. `runTracker.ts`'s header states the ONE fact the engine does
// not emit — who landed a named kill — and this window carries no `by` column for it. The reward
// chest and the doors it used to be without arrived with the parser that reads them, and they are
// rows here now; what is still refused is the row that claims nothing. `Reward chest: not yet` is
// printed only while a run is LIVE, because there a chest is genuinely still ahead of you; a run
// that finished without one draws no chest row at all, and a run with no doors draws no door row
// (world-model law 1: an unstated zero is not a measurement).
//
// IT TICKS ITSELF, at 1 Hz, because the elapsed clock is the one number here that has to keep
// moving while the log is silent — the respawn window's beat, for the respawn window's reason. A
// FINISHED run freezes: the tick still fires, and `runElapsedMs` reads the run's own end.
//
// THE MANUAL RUN IS LOCAL STATE, ON PURPOSE. `Start run here` is for the open-world dungeons that
// are not instances at all, and it opens no IPC channel: a run is a live thing, nothing about it is
// persisted, and the only consumer of the two instants is this window. Both controls exist in
// INTERACTIVE mode only — a locked overlay is click-through by law and has no clicks to give.
//
// MUI-FREE, plain divs and inline styles, like every file in this bundle.

import { type JSX, useEffect, useMemo, useState } from 'react'
import type { CoinSnap } from '@shared/coinTypes'
import { EMPTY_COIN_SNAP } from '@shared/coinTypes'
import type { DeathSnap } from '@shared/deathTypes'
import { EMPTY_DEATH_SNAP } from '@shared/deathTypes'
import type { KillsSnap } from '@shared/kills'
import type { LootEvent, ProgressionSnap } from '@shared/types'
import {
  RUN_OPEN_WORLD,
  RUN_UNKNOWN_TIER,
  runElapsedMs,
  runKillsPerMin,
  runTracker,
  type RunState
} from '@shared/runTracker'
import { EMPTY_PROGRESSION } from '../features/leveling/progressionDelta'
import { OverlayHeader } from './OverlayHeader'
import { FOOTER_ROW, OverlayContent } from './overlayScale'
import { TextScaleStepper } from './TextScaleStepper'
import { useOverlayModule } from './useOverlayModule'
import { type OverlayChrome, useOverlayChrome } from './useOverlayChrome'
// The DECLARED coin ladder and its wording, imported rather than re-stated: EQ prints its
// platinum/gold/silver/copper conversion in no line of the log, so the one consumer that turns
// denominations into a single number owns the declaration and every other surface reads it
// (shared/acquireEvents.ts's law, farmRows.ts's implementation).
import { COIN_LADDER_TEXT, coinCopper, coinText } from './farmRows'
import { PALETTE, withAlpha } from '../../../shared/palette'

/** This window's accent — a rose, deliberately none of the five already worn by a window (damage
 *  violet, healing green, XP blue, respawn amber, farm mint). Two windows that look alike at a
 *  glance would be worse than either of them being the wrong hue. */
const ACCENT = '#e88fb4'
const ACCENT_BG = 'rgba(232,143,180,0.2)'
/** The dim that every secondary word in this window is set in. */
const DIM = 'rgba(255,255,255,0.45)'

/** One second — the elapsed clock must move while the log is idle. */
const TICK_MS = 1000

const NO_LOOT: LootEvent[] = []
const NO_KILLS: KillsSnap = { v: 5, mobs: {} }

/** What this window says before it has a run. State, never process. */
export const RUN_EMPTY_TEXT = 'No run yet. Enter an instance, or Start run here.'

function useSecondsClock(): number {
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

/** `m:ss` up to an hour, then `h:mm:ss`. A crawl is read in minutes, so the minutes are what lead. */
export function runClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = String(total % 60).padStart(2, '0')
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`
}

/**
 * The header's own line: the PLACE, then the difficulty the zone line stated.
 *
 * The parenthetical is the log's own adjective, lifted out of the zone name rather than looked up,
 * so a difficulty this app has never decoded prints the name and no tier at all instead of a wrong
 * one. An open-world or hand-started run is just the place.
 */
export function runTitle(state: RunState): string {
  const tier = state.tier
  if (tier === undefined || tier === RUN_OPEN_WORLD || tier === RUN_UNKNOWN_TIER) return state.base
  const adj = /\(([A-Za-z]+)\)\s*$/.exec(state.zone)
  return `${state.base} · tier ${String(tier)}${adj ? ` (${adj[1]})` : ''}`
}

/** The kills line: yours, the group's, and the pace over the run's own clock. */
export function runKillsText(state: RunState, nowMs: number): string {
  const rate = runKillsPerMin(state, nowMs)
  const pace = rate === null ? '' : ` · ${rate.toFixed(1)}/min`
  return `${String(state.kills)} · ${String(state.groupKills)} by group${pace}`
}

/**
 * The chest line: what it paid, split by where each item went.
 *
 * `not yet` is a STATE and is said only on a live run — a chest you have not reached is not a
 * chest that paid nothing. Items are stack-aware (`4 Bone Chips` is four), the key chips' own
 * rule, so the three parts always add up to the total in front of them.
 */
export function runChestText(state: RunState): string {
  const c = state.chest
  if (c.items === 0) return 'not yet'
  return `${String(c.items)} items: ${String(c.kept)} kept, ${String(c.sold)} sold, ${String(c.merged)} merged`
}

/** `label · value` on one line — this window's only row shape, the farm meter's own. */
function RunLine({ id, label, value }: { id: string; label: string; value: string }): JSX.Element {
  return (
    <div
      data-testid="run-row"
      data-row={id}
      style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 2px' }}
    >
      <span style={{ fontSize: 9.5, letterSpacing: 0.3, color: DIM, flexShrink: 0, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span
        data-testid="run-value"
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
        {value}
      </span>
    </div>
  )
}

/** One key kind and how many of it. A chip, because a key is a THING you are carrying. */
function KeyChips({ state }: { state: RunState }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 2px' }}>
      <span style={{ fontSize: 9.5, letterSpacing: 0.3, color: DIM, alignSelf: 'center' }}>Keys</span>
      {state.keys.map((k) => (
        <span
          key={k.name}
          data-testid="run-key"
          style={{
            fontSize: 10,
            padding: '0 4px',
            borderRadius: 3,
            color: ACCENT,
            border: `1px solid ${ACCENT}55`,
            whiteSpace: 'nowrap'
          }}
        >
          {k.name}
          {k.count > 1 ? ` x${String(k.count)}` : ''}
        </span>
      ))}
    </div>
  )
}

/**
 * The named, in the order they went down, each with how far into the run it was.
 *
 * NO `by` COLUMN. The log names the killer on `<Mob> has been slain by <Name>!` and the parser
 * reads it, but no module publishes it (shared/runTracker.ts states the gap), so this list says
 * WHAT and WHEN and stops there rather than crediting a kill to somebody it is guessing at.
 */
function NamedList({ state }: { state: RunState }): JSX.Element {
  return (
    <div style={{ marginTop: 3 }}>
      <div data-testid="run-named-head" style={{ fontSize: 9.5, letterSpacing: 0.3, color: DIM, padding: '0 2px' }}>
        Named {state.named.length}
      </div>
      {state.named.map((n, i) => (
        <div
          key={`${n.name}-${String(n.at)}-${String(i)}`}
          data-testid="run-named"
          style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '1px 2px' }}
        >
          <span
            style={{
              fontSize: 11,
              flexGrow: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {n.name}
          </span>
          <span style={{ fontSize: 10, color: DIM, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            +{runClock(n.at - state.startedAt)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * The control that decides where a run BEGINS when no zone line is going to say.
 *
 * IT LIVES IN THE FOOTER, NOT IN THE CONTENT PANE, and that is a MEASURED placement rather than a
 * taste: the pane scrolls, so a button under fourteen named rows is off the bottom of a window at
 * the shared 140x90 floor — `tests/e2e/overlayMinSizeSteps.mts` caught exactly that and is the
 * instrument this answer came from. The footer is the row that never scrolls away, and it wraps
 * (FOOTER_ROW), so a narrow window spends height rather than losing the control.
 *
 * INTERACTIVE ONLY, with the rest of the footer: a locked overlay is click-through by law and has
 * no clicks to give.
 */
function RunControls({ running, onToggle }: { running: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button
      type="button"
      data-testid={running ? 'run-end' : 'run-start'}
      onClick={onToggle}
      style={{
        flexShrink: 0,
        fontSize: 9.5,
        lineHeight: 1.5,
        padding: '0 5px',
        color: ACCENT,
        background: 'transparent',
        border: `1px solid ${ACCENT}55`,
        borderRadius: 3,
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      {running ? 'End run' : 'Start run here'}
    </button>
  )
}

function RunFooter({
  chrome,
  running,
  onToggle
}: {
  chrome: { bgAlpha: number; textScale: number; patch: OverlayChrome['patch']; noDrag: React.CSSProperties }
  running: boolean
  onToggle: () => void
}): JSX.Element {
  const { bgAlpha, textScale, patch, noDrag } = chrome
  return (
    <div style={{ ...FOOTER_ROW, ...noDrag, gap: 6 }}>
      <RunControls running={running} onToggle={onToggle} />
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

/** The body, once there IS a run: the counts, the keys, the deaths, the auto-sell, the named. */
function RunBody({ state, nowMs }: { state: RunState; nowMs: number }): JSX.Element {
  const sold = coinCopper(state.coinAutoSold)
  return (
    <>
      <RunLine id="kills" label="Kills" value={runKillsText(state, nowMs)} />
      {state.keys.length > 0 && <KeyChips state={state} />}
      {/* A live run says `not yet`; a finished one that opened no chest says nothing at all. */}
      {(state.chest.items > 0 || state.active) && (
        <RunLine id="chest" label="Reward chest" value={runChestText(state)} />
      )}
      {state.doors > 0 && <RunLine id="doors" label="Doors" value={String(state.doors)} />}
      {state.deaths > 0 && <RunLine id="deaths" label="Deaths" value={String(state.deaths)} />}
      {/* The ladder rides the LABEL of the row that divides by it, never a hover — the farm
          meter's rule, because an assumption behind a pointer is a hidden one. */}
      {sold > 0 && (
        <RunLine id="sold" label={`Auto-sold (${COIN_LADDER_TEXT})`} value={coinText(sold)} />
      )}
      {state.named.length > 0 && <NamedList state={state} />}
    </>
  )
}

export default function RunOverlay(): JSX.Element {
  const snap = useOverlayModule<ProgressionSnap>('progression', EMPTY_PROGRESSION)
  const kills = useOverlayModule<KillsSnap>('kills', NO_KILLS)
  const loot = useOverlayModule<LootEvent[]>('loot', NO_LOOT)
  const coin = useOverlayModule<CoinSnap>('coin', EMPTY_COIN_SNAP)
  const deaths = useOverlayModule<DeathSnap>('deaths', EMPTY_DEATH_SNAP)
  const { locked, bgAlpha, textScale, hovering, patch, toggleLock, capture, dragRegion, noDrag } =
    useOverlayChrome()
  const nowMs = useSecondsClock()
  // Session state, never persisted — see the file header. `null` is "the zone lines are in charge".
  const [manual, setManual] = useState<{ start: number; end: number | null } | null>(null)

  const state = useMemo(
    () =>
      runTracker({
        snap,
        kills,
        loot,
        coin: coin.rows,
        deaths,
        nowMs,
        manualStart: manual?.start ?? null,
        manualEnd: manual?.end ?? null
      }),
    [snap, kills, loot, coin, deaths, nowMs, manual]
  )
  const has = state.startedAt > 0

  return (
    <div
      data-testid="run-overlay"
      data-run-active={state.active ? 'true' : 'false'}
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
        tag="RUN"
        // A finished run wears the meters' own honest tag rather than being dressed up as live.
        last={has && !state.active}
        title={has ? runTitle(state) : 'Run tracker'}
        titleColor={ACCENT}
        tail={has ? runClock(runElapsedMs(state, nowMs)) : undefined}
        iconAccentBg={ACCENT_BG}
        chrome={{ locked, hovering, dragRegion, noDrag, toggleLock, capture }}
      />

      <OverlayContent textScale={textScale} testId="run-overlay-body" locked={locked} capture={capture}>
        {has ? (
          <RunBody state={state} nowMs={nowMs} />
        ) : (
          <div data-testid="run-empty" style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', padding: '8px 2px' }}>
            {RUN_EMPTY_TEXT}
          </div>
        )}
      </OverlayContent>

      {!locked && (
        <RunFooter
          chrome={{ bgAlpha, textScale, patch, noDrag }}
          running={state.active}
          onToggle={() => {
            if (state.active) {
              setManual((m) => (m ? { ...m, end: Date.now() } : { start: state.startedAt, end: Date.now() }))
              return
            }
            setManual({ start: Date.now(), end: null })
          }}
        />
      )}
    </div>
  )
}
