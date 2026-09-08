import { useEffect, useState } from 'react'
import type { CombatSnapshot } from '@shared/combat'
import { LIVE_SELECTION, type CombatScope } from './dashboardData'
import { useGlobalFight } from './useGlobalFight'
import type { CombatFocus } from './combatFocus'

/** Re-export: the sentinel lives with the scope helpers (dashboardData) so the overlay entry —
 *  which never imports this hook — can share one definition. */
export const LIVE = LIVE_SELECTION

/** Renderer-local view pref, same shape as App.tsx's saved view / BossView's density. */
const SCOPE_KEY = 'eq.combat.scope'

function loadScope(): CombatScope {
  const v = localStorage.getItem(SCOPE_KEY)
  return v === 'overall' ? 'overall' : 'fight'
}

/** Default cap on finalized-fight summaries fetched per snapshot (Task #17 wire
 *  payload cap). The zone summary + current fight are always included; a "Load
 *  more" affordance bumps this. */
const DEFAULT_MAX_SEGMENTS = 100

export interface UseCombat {
  snap: CombatSnapshot | null
  showUnparsed: boolean
  setShowUnparsed: (v: boolean) => void
  selection: string
  setSelection: (id: string) => void
  /**
   * Fight vs Overall — an EXPLICIT scope, never an automatic switch. It decides both what the
   * body shows and what the selector may list (fights only / zone sessions only). Persisted
   * renderer-side like the other view prefs.
   */
  scope: CombatScope
  setScope: (s: CombatScope) => void
  /**
   * Jump to an explicit scope + selection (a deep link from another tab). Distinct from
   * `setScope`, which lands on that scope's own current row: here the caller has already decided
   * what it wants selected. The scope is persisted, exactly as a manual scope change is —
   * arriving via "see this fight in Combat" is a real scope choice. A FIGHT focus writes the
   * GLOBAL selection (P4), so following a deep link moves the open fight overlays too.
   */
  focusFight: (f: CombatFocus) => void
  /** current finalized-fight cap in the fetched snapshot */
  maxSegments: number
  /** bump the cap by another page of fights (Load more) */
  loadMore: () => void
  /**
   * When true, the snapshot includes the selected encounter's timeline (Task #51).
   * Defaults to TRUE now that the combat DASHBOARD derives its DPS curve and per-mob
   * breakdown from the same event ring — the payload is needed for every ring-backed
   * selection, not just while the Timeline chart is on screen. The engine caps a
   * serialized timeline at 2k events (uniform-stride downsample above that), so the
   * cost is bounded; ring-less selections (zone sessions) return null for free.
   */
  wantTimeline: boolean
  setWantTimeline: (v: boolean) => void
}

/**
 * Views the main-process combat engine. The engine owns all state (it's seeded
 * from the full log and fed the live tail), so the UI is a pure view.
 *
 * FIX 4: refresh is event-driven — a fresh snapshot is fetched immediately on the
 * main-side `onCombatActivity` ping (throttled to ~4x/sec there), giving sub-second
 * meter updates during a fight. A slow 1s fallback poll remains for timer-driven UI
 * (the "active" state decay) and to cover any missed event.
 */
export function useCombat(): UseCombat {
  const [showUnparsed, setShowUnparsed] = useState(false)
  const [scope, setScopeState] = useState<CombatScope>(loadScope)
  /**
   * TWO SELECTIONS, ONE PER SCOPE — and only the FIGHT one is global (P4 and its carve-out).
   *
   * The fight selection is not state of this hook at all: it lives in main and is shared with
   * every fight overlay, so picking a fight here moves them and picking one there moves this.
   * The zone-session selection stays exactly what it was, local to this surface.
   *
   * Keeping them SEPARATE (rather than one `selection` that the scope reinterprets) is what
   * makes P5 true here: flipping the scope shows the other list's own current row and cannot
   * write anything, so an Overall session can never be mistaken for a global fight pick.
   */
  const { fightId, selectFight } = useGlobalFight(window.eq)
  const [zoneSelection, setZoneSelection] = useState<string>('zone')
  const [maxSegments, setMaxSegments] = useState(DEFAULT_MAX_SEGMENTS)
  const [wantTimeline, setWantTimeline] = useState(true)
  const [snap, setSnap] = useState<CombatSnapshot | null>(null)

  /** What this surface is showing — the scope picks which of the two selections is in force. */
  const selection = scope === 'fight' ? fightId : zoneSelection
  /** …and which one a pick writes. The scope is never changed by either (P5). */
  const setSelection = (id: string): void => {
    if (scope === 'fight') selectFight(id)
    else setZoneSelection(id)
  }

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      // The engine-side pet fold is GONE (not "off"): pet presentation is the renderer's nesting
      // pref (eq.combat.petRow) applied by petRows.meterPanel, and the snapshot always carries
      // the separate, authoritative sources — for this view and for the overlays alike.
      const s = await window.eq.getCombatSnapshot({
        selectedId: selection === LIVE ? undefined : selection,
        showUnparsed,
        maxSegments,
        timeline: wantTimeline
      })
      if (alive) setSnap(s)
    }
    void tick()
    const off = window.eq.onCombatActivity(() => void tick())
    const iv = setInterval(() => void tick(), 1000)
    return () => {
      alive = false
      off()
      clearInterval(iv)
    }
  }, [selection, showUnparsed, maxSegments, wantTimeline])

  const loadMore = (): void => setMaxSegments((n) => n + DEFAULT_MAX_SEGMENTS)

  /**
   * Switching scope shows the OTHER scope's own current row — it writes nothing.
   *
   * It used to reset the incoming scope to its head row, which was right when a selection was
   * one piece of local state that had to be made listable again. Now each scope keeps its own
   * (the fight one globally), so resetting would be an automatic write to a selection three
   * other surfaces are also looking at — the exact "the ground moved under me" failure the
   * scope law exists to prevent.
   */
  const setScope = (s: CombatScope): void => {
    setScopeState(s)
    localStorage.setItem(SCOPE_KEY, s)
  }

  /** See UseCombat.focusFight — a deep link decides BOTH halves, so the selection survives. */
  const focusFight = (f: CombatFocus): void => {
    setScopeState(f.scope)
    localStorage.setItem(SCOPE_KEY, f.scope)
    if (f.scope === 'fight') selectFight(f.selection)
    else setZoneSelection(f.selection)
  }

  return {
    snap,
    showUnparsed,
    setShowUnparsed,
    selection,
    setSelection,
    scope,
    setScope,
    focusFight,
    maxSegments,
    loadMore,
    wantTimeline,
    setWantTimeline
  }
}
