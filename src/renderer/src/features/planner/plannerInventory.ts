// planner/plannerInventory.ts — WHAT YOU ARE WEARING, read live from the character's own dump
// (V7, docs/plans/planner-v2.md).
//
// WHAT THIS WAS FOR, AND WHO READS IT NOW — THE GEAR TAB'S COMPARISON CARD (JOS-338).
//
// It was written for the exaltation planner's Inventory tab, whose cells filled their hosts from
// the character's newest `/outputfile inventory` dump; the Gear tab's sets pane then took the same
// read for its "versus what you are wearing" diff. JOS-326 removed the board (and with it the two
// cell-shaped helpers only the board used, `hostsBySlot` and `effectiveHost`), and JOS-325 retired
// gear sets in the same wave — so for two tickets this hook had NO CALLER, and the note here asked
// the next integrator to either retire the whole channel (`IPC.plannerInventory`, its handler in
// src/main/ipc/planner.ts, its preload method, and the reference to this file in
// `features/character/useCharacterSheet.ts`) or find it a reader.
//
// IT FOUND A READER, AND IT IS THE SAME QUESTION THE HOOK WAS ALWAYS ASKING. `features/gear`'s
// hover card compares a search row against what is in the slots that item would occupy
// (gearData.ts `useGearCompare` states why this channel and not the ownership payload beside it):
// the answer has to be keyed by CELL, carry `itemKey`, and carry the dump's mtime, which is this
// payload exactly. Nothing about the transport changed for it — the retirement note is simply
// spent.
//
// LIVE, WITH NO CLICK ANYWHERE (owner, 2026-08-05: "type the command, watch it fill"). Main
// already watches the dump and pushes `inventory:autoReloaded` when the player rewrites it; this
// hook re-asks on that push, so running `/outputfile inventory` in game fills the surface while it
// is on screen. Main's watcher also covers the FIRST dump a character ever writes (session.ts).
//
// IT NEVER WRITES ANYTHING. The dump answers "what is in that slot right now" at RENDER time, so
// what it says follows your gear instead of freezing the day you first opened a tab — and no
// stored document can be corrupted by a dump that changed under it.

import { useCallback, useEffect, useState } from 'react'
import type { PlannerInventory } from '@shared/planner/inventorySlots'

export interface PlannerInventoryState {
  /** the parsed dump, or null when this character has never written one */
  inventory: PlannerInventory | null
  /** false until the first read settles — a data-availability flag, not an error */
  ready: boolean
}

/**
 * The character's equipped items, re-read whenever the dump is rewritten.
 *
 * Not module-cached, unlike the donor corpus: that is compiled-in bytes that cannot change while
 * the app runs, and this is a file the player rewrites mid-session on purpose.
 */
export function usePlannerInventory(): PlannerInventoryState {
  const [state, setState] = useState<PlannerInventoryState>({ inventory: null, ready: false })

  const read = useCallback((alive: () => boolean) => {
    void window.eq
      .plannerInventory()
      .then((inventory) => {
        if (alive()) setState({ inventory, ready: true })
      })
      .catch(() => {
        /* main never rejects; no dump is a null answer, not a failure */
        if (alive()) setState({ inventory: null, ready: true })
      })
  }, [])

  useEffect(() => {
    let alive = true
    const live = (): boolean => alive
    read(live)
    // The push carries the path and mtime, and we deliberately ignore both: main is the only
    // thing that knows which dump belongs to the active character, so the answer is re-asked
    // rather than patched from the event.
    const off = window.eq.onInventoryReload(() => read(live))
    return () => {
      alive = false
      off()
    }
  }, [read])

  return state
}
