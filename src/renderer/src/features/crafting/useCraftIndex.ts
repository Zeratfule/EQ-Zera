// crafting/useCraftIndex.ts — the recipe index in the renderer, plus the two other things the
// Crafting tab needs to know: what you hold, and which tradeskill you last picked.
//
// ONE FETCH PER WINDOW, the `gearData.useGearIndex` precedent and for the same reasons: the corpus
// is 8.6 MB and stays in MAIN, the recipes are built there once and arrive over ONE IPC call, and
// they are derived from committed bytes so they cannot change while the app runs. The in-flight
// promise is cached too, so two mounts in the same frame share one round trip.
//
// A VIEW UNMOUNTS ON EVERY TAB SWITCH (JOS-90/97/116), which is why the module-level cache is a
// module-level cache: remounting the tab must not re-ask, and the state a user CHOSE (the skill
// filter) must not evaporate. The search box is deliberately NOT persisted — the gear area's own
// rule, stated in `areaMemory.ts`: what you TYPED is session-scoped at most, and a week-old query
// greeting a fresh launch is a worse surface, not a better one.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ownedCount, ownershipIndexFrom, ownershipRowsFor } from '@shared/planner/ownership'
import type { CraftIndex, CraftSkill } from '@shared/craft'
import { TRADESKILLS } from '@shared/craft'
import { useGearOwnership } from '../gear/gearData'
import type { HaveFn } from './craftPlan'

// ---- the fetch ----------------------------------------------------------------------

export interface CraftIndexState {
  index: CraftIndex | null
  /** false until the first fetch settles */
  ready: boolean
}

const EMPTY: CraftIndexState = { index: null, ready: false }

let CACHE: CraftIndexState | null = null
let INFLIGHT: Promise<CraftIndexState> | null = null

/**
 * THE TYPED ACCESSOR, AND WHY IT IS A CAST.
 *
 * `window.eq` is typed as `EqApi`, which is `typeof api` in `src/preload/index.ts` — so the method
 * only becomes visible to the renderer once `...craftApi` is spread into that object. That spread is
 * one of the three wiring lines the integrator adds; until it lands, this file has to typecheck
 * standing alone. The optional call is not defensive theatre either: it is exactly what a build
 * with the handler registered and the bridge not yet spread would look like, and the honest answer
 * to that is the same empty state as a fetch that failed.
 *
 * THE INTEGRATOR REMOVES THIS CAST once the bridge carries the method — `window.eq.getCraftIndex()`
 * is then an ordinary call like every other one in this feature's neighbours.
 */
function invokeCraftIndex(): Promise<CraftIndex> | undefined {
  return window.eq.getCraftIndex()
}

async function fetchIndex(): Promise<CraftIndexState> {
  const index = (await invokeCraftIndex()) ?? null
  CACHE = { index, ready: true }
  return CACHE
}

/** Every recipe the corpus states, fetched at most once per window. */
export function useCraftIndex(): CraftIndexState {
  const [state, setState] = useState<CraftIndexState>(() => CACHE ?? EMPTY)

  useEffect(() => {
    if (CACHE !== null) return
    let alive = true
    INFLIGHT ??= fetchIndex()
    void INFLIGHT.then((next) => {
      if (alive) setState(next)
    }).catch(() => {
      /* main never rejects; a null index renders the honest empty state */
      if (alive) setState({ index: null, ready: true })
    })
    return () => {
      alive = false
    }
  }, [])

  return state
}

// ---- what you hold ------------------------------------------------------------------

export interface CraftHoldings {
  /** how many of an item key this character holds, all places and all plus levels together */
  have: HaveFn
  /** this character has written an `/outputfile inventory` dump at all */
  hasDump: boolean
  /** false until the first read settles — the tab draws neither verdict rather than guessing */
  ready: boolean
}

/**
 * THE OWNERSHIP JOIN, AND WHY IT NEEDS NO TRANSLATION.
 *
 * A recipe's `CraftIngredient.key` is `itemTierKey` of the ingredient name and the ownership index
 * is filed under `ownershipKey`, which IS `itemTierKey` (shared/planner/ownership.ts states that
 * the three spellings of this key across the three layers are pinned equal). So the join is an
 * identity, never a match — law 12, and the reason this feature has no lookup table.
 *
 * `ownershipRowsFor` takes a NAME and applies `ownershipKey` to it, which is idempotent on a key
 * that is already canonical, so handing it the ingredient key is correct rather than merely
 * convenient. Bags, bank, shared bank, depot, keyring and worn all count: the question is "do you
 * have one", and the dump is the only thing that can answer it.
 */
export function useCraftHoldings(): CraftHoldings {
  const { payload, readAt } = useGearOwnership()
  const index = useMemo(() => ownershipIndexFrom(payload.entries), [payload.entries])
  const have = useCallback<HaveFn>((key) => ownedCount(ownershipRowsFor(index, key)), [index])
  return { have, hasDump: payload.path !== null, ready: readAt !== null }
}

// ---- the remembered tradeskill ------------------------------------------------------

/** Where the tab remembers the tradeskill you picked. Renderer-only, like every `eq.*` pref. */
export const CRAFT_SKILL_KEY = 'eq.crafting.skill'

const ALLOWED: readonly string[] = [...TRADESKILLS, 'Other']

/**
 * A stored value DEGRADES, IT NEVER ERRORS (JOS-105). Storage is a string another build wrote and
 * the user can edit; anything that is not a member of the closed vocabulary reads as Any.
 */
function sanitizeSkill(raw: string | null): CraftSkill | '' {
  return raw !== null && ALLOWED.includes(raw) ? (raw as CraftSkill) : ''
}

/**
 * The tradeskill filter, remembered across the tab switch that unmounts this view.
 *
 * IT IS ITS OWN TINY HOOK rather than a call to the gear area's `useRemembered`, for one stated
 * reason: that hook looks its tier up from `AREA_FORM_TIER`, a closed key union in
 * `features/gear/areaMemory.ts`, and this feature does not own that file. The rule it applies is
 * the same one — a closed-vocabulary PICK lives on the restart tier — and folding this key into
 * that table is a two-line follow-up whenever the gear area is next open for edits.
 */
export function useCraftSkill(): [CraftSkill | '', (next: CraftSkill | '') => void] {
  const [skill, setSkill] = useState<CraftSkill | ''>(() => {
    try {
      return sanitizeSkill(window.localStorage.getItem(CRAFT_SKILL_KEY))
    } catch {
      return ''
    }
  })
  const set = useCallback((next: CraftSkill | '') => {
    setSkill(next)
    try {
      if (next === '') window.localStorage.removeItem(CRAFT_SKILL_KEY)
      else window.localStorage.setItem(CRAFT_SKILL_KEY, next)
    } catch {
      // A preference that cannot be persisted still applies to this session.
    }
  }, [])
  return [skill, set]
}
