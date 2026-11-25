// useQuestLayer.ts — the Maps tab's QUEST PIN LAYER state (quest locations wave): which quests it
// draws, whether it is on, and the pins for the map on screen.
//
// WHICH QUESTS: every quest the character is TRACKING (the Quests tab's tracker, one document for
// the whole app — shared/questPins.ts) plus the quest the current target was jumped from, so
// arriving from an untracked quest still shows that quest's other places beside the target.
// Resolving is shared/questLocations.ts's job and picking what falls on this map is
// shared/questMapPins.ts's; this hook only gathers the inputs.
//
// ON BY DEFAULT, REMEMBERED IN `eq.maps.questPins`. A pref, not `useState`: the view unmounts on
// every tab switch (the JOS-90 law). A stored value that is not exactly 'off' reads as on, so an
// unreadable value degrades to the default rather than erroring (JOS-105).

import { useCallback, useMemo, useState } from 'react'
import type { ZoneShort } from '@shared/maps'
import { questPinsInZone, type QuestForPins, type QuestMapPin } from '../../../../shared/questMapPins'
import { QUEST_BY_PAGE } from '../quests/questSearch'
import { questLocationsFor } from '../quests/questLocIndex'
import { useQuestPins } from '../quests/useQuestPins'

const PREF_KEY = 'eq.maps.questPins'

function loadOn(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}

function saveOn(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    // a full or blocked store loses the preference, never the map
  }
}

export interface QuestLayer {
  on: boolean
  toggle: () => void
  /** the pins for the zone drawn — empty when the layer is off */
  pins: QuestMapPin[]
  /** how many quests the layer is drawing for (tracked + the jumped-from one) */
  quests: number
}

/** The layer for the map drawn (`zone` = `data.zone`), given the quest a target came from. */
export function useQuestLayer(zone: ZoneShort | undefined, fromQuest: string | undefined, keep: (loc: { ns: number; ew: number }) => boolean): QuestLayer {
  const [on, setOn] = useState(loadOn)
  const [tracked] = useQuestPins()
  const quests = useMemo(() => {
    const pages: string[] = []
    for (const pin of tracked) pages.push(pin.page)
    if (fromQuest !== undefined && !pages.includes(fromQuest)) pages.push(fromQuest)
    const out: QuestForPins[] = []
    for (const page of pages) {
      const q = QUEST_BY_PAGE.get(page)
      if (q) out.push({ page: q.page, name: q.name, locs: questLocationsFor(q) })
    }
    return out
  }, [tracked, fromQuest])
  // Off-map pins are not drawn: the map file's own extent is the last word (useMapQuestOverlay.tsx).
  const pins = useMemo(() => (on ? questPinsInZone(quests, zone, keep) : []), [on, quests, zone, keep])
  // Persisted on the CHANGE HANDLER, not by an effect: an effect cannot tell the click from a mount.
  const toggle = useCallback(() => {
    const next = !on
    saveOn(next)
    setOn(next)
  }, [on])
  return { on, toggle, pins, quests: quests.length }
}
