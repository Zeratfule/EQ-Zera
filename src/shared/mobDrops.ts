// MOB DROPS, SPLIT ONCE (JOS-194 round 6) — the single answer to "what does this thing drop,
// and how much of that have I seen myself".
//
// ORDERING IS A CLAIM ABOUT AUTHORITY, and it was already written down twice: the wiki page's
// `known_loot` is the definitive statement of what a mob can drop, so it LEADS; your own loot
// history is CORROBORATION and rides on the matching row as a count; and only the items your
// history has that the page does NOT list get a second, secondary block, because one lucky drop
// is evidence rather than a drop table.
//
// It is here rather than in a component because three surfaces now ask the same question — the
// consider strip's `drops: a, b, c +N` tail, the event overlay's mob hover card, and (round 6)
// the respawn row's hover — and the round-6 brief was explicit that a second drops source is the
// thing not to build. `MobKnowledge` is that source; this is the one fold over it.
//
// Pure: no React, no Electron, no node. Unit-tested by tests/mobDrops.test.mts.

import type { MobDrop, MobSeenDrop } from './mobTypes'

/** One row of the definitive table: what the page states, plus what your own history corroborates. */
export interface MobDropRow {
  item: string
  /** Rarity EXACTLY as the page states it — see `MobDrop.rarity`. Absent when it states none. */
  rarity?: string
  /** How many you have looted. Absent when your history has never seen this listed drop. */
  seenCount?: number
}

export interface MobDropsSplit {
  /** The page's table, in the page's order, annotated with your counts. */
  wiki: MobDropRow[]
  /** Items only YOUR history knows about — never mixed into the table above. */
  extraSeen: MobSeenDrop[]
}

/** The one drops fold. A knowledge that says nothing yields two empty lists, never a claim. */
export function splitMobDrops(
  k: { dropsWiki?: MobDrop[]; dropsSeen?: MobSeenDrop[] } | null | undefined
): MobDropsSplit {
  const seen = k?.dropsSeen ?? []
  const wikiDrops = k?.dropsWiki ?? []
  // Names are dirty (world-model law 2): canonicalize at the join, display raw on both sides.
  const seenByKey = new Map(seen.map((d) => [d.item.toLowerCase(), d]))
  const wikiKeys = new Set(wikiDrops.map((d) => d.item.toLowerCase()))
  const wiki = wikiDrops.map((d) => {
    const mine = seenByKey.get(d.item.toLowerCase())
    const row: MobDropRow = { item: d.item }
    if (d.rarity !== undefined) row.rarity = d.rarity
    if (mine) row.seenCount = mine.count
    return row
  })
  return { wiki, extraSeen: seen.filter((d) => !wikiKeys.has(d.item.toLowerCase())) }
}

/** Every drop NAME the two sources between them know, definitive table first. */
export function mobDropNames(split: MobDropsSplit): string[] {
  return [...split.wiki.map((d) => d.item), ...split.extraSeen.map((d) => d.item)]
}
