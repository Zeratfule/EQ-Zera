// hoverCards — THE mob hover card, and the small card vocabulary the item card beside it shares.
//
// It lived in `overlay/feedHoverCards.tsx` until JOS-194 round 6 asked for the same card on a
// RESPAWN row, on two surfaces at once: the Timers tab (main window) and the floating Timers
// window. The brief was explicit — reuse the card and the drops data, do not grow a second of
// either — so the card moved down here to `lib/`, which both bundles already import from
// (`ItemWindow`, `itemKnowledgeView`), and the ONE thing that differed between the windows became
// a prop: the door to main's cache-first `mobs:lookup` (`window.eq` in the app, `window.eqOverlay`
// over the game). Nothing else about it changed.
//
// LAW (do not weaken): MUI-FREE. The overlay bundle is MUI-free except one lazily-imported
// ItemWindow, and this file is on that bundle's static path — plain React + inline styles only.
// It is also why the main window's Timers tab can hang this card off a MUI Tooltip without
// dragging the overlay into MUI: the card is just divs.
//
// HONESTY (law 1): each block renders only if that source said something. A mob whose page does
// not exist shows the con facts and "no wiki page" — never an empty drop table dressed up as
// "drops nothing".

import { type JSX, useEffect, useState } from 'react'
import type { FeedConsider, MobKnowledge } from '@shared/types'
import { CONSIDER_FACTION_COLOR, CONSIDER_FACTION_LABEL, considerDifficultyShort } from '@shared/logEvents'
import { splitMobDrops } from '@shared/mobDrops'

/** Card palette — the same semantics as EQ_ITEM_COLORS, respelled here so importing it
 *  (from ItemWindow.tsx, which pulls MUI at module scope) can't defeat the lazy import. */
export const CARD_TEXT = '#e9eaf2'
export const CARD_LABEL = '#a8b0c6'
export const CARD_ITEM = '#5fe08a'
export const CARD_MONO = '"Consolas","Courier New",monospace'
/** Your own history corroborating a listed drop. */
const CARD_MINE = '#7fd8a0'

export const LABEL_STYLE: React.CSSProperties = { color: CARD_LABEL, fontSize: 10, lineHeight: 1.4 }
export const TEXT_STYLE: React.CSSProperties = { color: CARD_TEXT, fontSize: 10, lineHeight: 1.4 }

/** A titled block of card rows, above a hairline. Renders nothing when the source said nothing. */
export function CardSection({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
      <div style={LABEL_STYLE}>{label}</div>
      {children}
    </div>
  )
}

/** `+N more` under a truncated list. */
export function MoreLine({ total, shown }: { total: number; shown: number }): JSX.Element | null {
  if (total <= shown) return null
  return <div style={LABEL_STYLE}>+{total - shown} more</div>
}

// ---- mob knowledge: ONE fetch per mob name, for the whole window's lifetime ---------------
//
// A feed (or a list of clocks) costs zero lookups until one row is pointed at, and re-hovering
// costs nothing at all. `mobs:lookup` is cache-first AND local-first in main (your own loot
// history + the quest catalog answer with no network), so the usual case is a single round trip.
const MOB_KNOWLEDGE = new Map<string, MobKnowledge>()
const MOB_PENDING = new Map<string, Promise<MobKnowledge | null>>()

/** The bridge method this card needs. Each window passes its own — see the file header. */
export type MobLookup = (name: string) => Promise<MobKnowledge>

/** Resolve a mob's knowledge, at most once per name. Never rejects — a miss resolves null. */
function lookupMobCached(name: string, lookup: MobLookup): Promise<MobKnowledge | null> {
  const key = name.toLowerCase()
  const hit = MOB_KNOWLEDGE.get(key)
  if (hit) return Promise.resolve(hit)
  const inflight = MOB_PENDING.get(key)
  if (inflight) return inflight
  const p = lookup(name)
    .then((k: MobKnowledge) => {
      MOB_KNOWLEDGE.set(key, k)
      MOB_PENDING.delete(key)
      return k
    })
    .catch(() => {
      MOB_PENDING.delete(key)
      return null
    })
  MOB_PENDING.set(key, p)
  return p
}

/**
 * Knowledge for a mob card that is CURRENTLY OPEN (mount == first hover).
 *
 * EXPORTED SINCE JOS-194 ROUND 9, for the respawn edit modal — which needs one field of it (`page`,
 * the wiki title, so it can link out) and would otherwise either duplicate this cache or open a
 * second lookup beside the card it is drawing. Sharing the hook means the modal's link and the
 * card's drops are answers to ONE question asked once, and the map above dedupes them.
 */
export function useMobKnowledge(
  name: string,
  lookup: MobLookup
): { data: MobKnowledge | null; loading: boolean } {
  const [data, setData] = useState<MobKnowledge | null>(() => MOB_KNOWLEDGE.get(name.toLowerCase()) ?? null)
  const [loading, setLoading] = useState(() => !MOB_KNOWLEDGE.get(name.toLowerCase()))

  useEffect(() => {
    const hit = MOB_KNOWLEDGE.get(name.toLowerCase())
    if (hit) {
      setData(hit)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void lookupMobCached(name, lookup).then((k) => {
      if (!alive) return
      setData(k)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [name, lookup])

  return { data, loading }
}

/** How many drops a mob card lists before collapsing to "+N more". Kept tight — this card floats
 *  over the game, and a 44-item table (a zol ghoul knight's real page) would swallow it. */
const MAX_DROPS = 6

/** The con line: faction rung, level and the short difficulty word, exactly as logged. */
function ConLine({ con }: { con?: FeedConsider }): JSX.Element | null {
  if (!con) return null
  return (
    <div style={LABEL_STYLE}>
      {CONSIDER_FACTION_LABEL[con.faction]}
      {con.level != null && ` · Lvl ${con.level}`}
      {` · ${considerDifficultyShort(con.difficulty) ?? con.difficulty}`}
    </div>
  )
}

/** The page's own level/zone, when it states them — a range as often as a number. */
function PageLevelZone({ data }: { data: MobKnowledge | null }): JSX.Element | null {
  if (!data) return null
  if (!data.levelText && !data.zone) return null
  return (
    <div style={LABEL_STYLE}>
      {data.zone}
      {data.zone && data.levelText && ' · '}
      {data.levelText && `lvl ${data.levelText}`}
    </div>
  )
}

/** THE DROP TABLE (definitive), with your own counts riding on the matching rows. */
function WikiDrops({ wiki }: { wiki: ReturnType<typeof splitMobDrops>['wiki'] }): JSX.Element | null {
  if (wiki.length === 0) return null
  return (
    <CardSection label="Drops:">
      {wiki.slice(0, MAX_DROPS).map((d) => (
        <div key={d.item} style={TEXT_STYLE}>
          <span style={{ color: CARD_ITEM }}>{d.item}</span>
          {d.rarity !== undefined && <span style={{ color: CARD_LABEL }}> · {d.rarity}</span>}
          {d.seenCount !== undefined && (
            <span style={{ color: CARD_MINE }}> · seen {d.seenCount}×</span>
          )}
        </div>
      ))}
      <MoreLine total={wiki.length} shown={MAX_DROPS} />
    </CardSection>
  )
}

/** Evidence the page doesn't carry — secondary by construction. */
function ExtraSeenDrops({ extraSeen }: { extraSeen: { item: string; count: number }[] }): JSX.Element | null {
  if (extraSeen.length === 0) return null
  return (
    <CardSection label="Also looted by you:">
      {extraSeen.slice(0, MAX_DROPS).map((d) => (
        <div key={d.item} style={TEXT_STYLE}>
          <span style={{ color: CARD_ITEM }}>{d.item}</span>
          <span style={{ color: CARD_LABEL }}> ×{d.count}</span>
        </div>
      ))}
      <MoreLine total={extraSeen.length} shown={MAX_DROPS} />
    </CardSection>
  )
}

/** Quests that name this mob. */
function MobQuests({ quests }: { quests: { quest: string; zone?: string }[] }): JSX.Element | null {
  if (quests.length === 0) return null
  return (
    <CardSection label={`Named by ${quests.length === 1 ? 'quest' : 'quests'}:`}>
      {quests.slice(0, MAX_DROPS).map((q) => (
        <div key={q.quest} style={TEXT_STYLE}>
          {q.quest}
          {q.zone !== undefined && <span style={{ color: CARD_LABEL }}> · {q.zone}</span>}
        </div>
      ))}
      <MoreLine total={quests.length} shown={MAX_DROPS} />
    </CardSection>
  )
}

/**
 * Say the honest thing when a source came back empty, and ONLY for the source that did (law 1) —
 * "no wiki page" is a different statement from "its wiki page lists no loot".
 */
function MobCardFooter({
  data,
  loading,
  wikiCount
}: {
  data: MobKnowledge | null
  loading: boolean
  wikiCount: number
}): JSX.Element {
  return (
    <>
      {loading && !data && <div style={{ ...LABEL_STYLE, marginTop: 4 }}>Looking up…</div>}
      {data?.notFound === true && <div style={{ ...LABEL_STYLE, marginTop: 4 }}>no wiki page</div>}
      {data && data.notFound !== true && data.offline !== true && wikiCount === 0 && (
        <div style={{ ...LABEL_STYLE, marginTop: 4 }}>its wiki page lists no loot</div>
      )}
      {data?.offline === true && (
        <div style={{ ...LABEL_STYLE, marginTop: 4 }}>offline - showing what&apos;s known locally</div>
      )}
    </>
  )
}

/**
 * WHAT THIS SURFACE KNOWS AND THE MOB PAGE DOES NOT (JOS-194 round 6).
 *
 * The one seam through which a caller adds a titled block ABOVE the drop table. It exists for the
 * respawn surfaces, whose subject is the clock: a Timers row's card leads with what we know about
 * that mob's respawn (`respawnProvenance` — the raw gap and what it proves, the wiki's verbatim
 * words, whether the floor lifted it, whether the base is a sighting) and then answers the other
 * half of the same question, which is whether the thing is worth waiting for.
 *
 * It is a STRING, not a node, deliberately: the round-5 ruling capped that sentence by test, and a
 * node-shaped slot is an invitation to grow a paragraph back into a hover.
 *
 * ROUND 9 ADDED `lines`, and it is STRINGS for the same reason. The owner asked the card to show the
 * observed gaps (all of them) and the wiki default, which are LISTS rather than clauses — reciting
 * them inside the capped sentence would have grown it back into the paragraph round 5 deleted, and a
 * node slot would have let any caller draw anything. A caller hands over prepared lines; the card
 * decides how a line looks.
 */
export interface MobCardNote {
  label: string
  text: string
  /** Facts of the same block that read as lines rather than as prose. Empty/absent draws nothing. */
  lines?: string[]
}

/**
 * HOW A MUI TOOLTIP MUST DRESS THIS CARD, hoisted to module scope so every surface that hangs it
 * off a Tooltip passes the SAME object identity (the JOS-206 finding: fresh `slotProps` with nested
 * `sx` rebuilt per render is real reconciliation cost across a list of anchors, and this card now
 * hangs off every clock row AND every Recently-killed entry).
 *
 * The values themselves are the card getting the tooltip out of its way: `MobCard` draws its own
 * surface — it has to, being the same component the MUI-free overlay bundle renders — so the
 * tooltip contributes no padding, no background and no 300px width cap on top of the card's own.
 *
 * A PLAIN OBJECT, which is why it can live in this MUI-free file: nothing here imports MUI, it is
 * only shaped for it.
 */
export const MOB_CARD_SLOT_PROPS = {
  tooltip: { sx: { p: 0, bgcolor: 'transparent', maxWidth: 'none' } }
} as const

/**
 * THE mob hover card — what a `/con` was actually asking, and what a respawn clock is about.
 *
 * It leads with the facts the anchor already gave (faction rung, level, rare — or, on a Timers
 * row, the respawn note), then the DROP TABLE, then the evidence the page does not carry, then
 * the quests that name it.
 *
 * Item names are PLAIN TEXT here: over the game the card is `pointerEvents:none` (HoverCardLayer)
 * so a nested hover is impossible by construction, and in the app it hangs off a Tooltip that
 * closes the moment the pointer leaves the row. The MOB PAGE is where item names become
 * KnownItemTooltip anchors and click through to the item dialog.
 */
export function MobCard({
  mob,
  con,
  note,
  lookup
}: {
  mob: string
  con?: FeedConsider
  /** A block this surface knows and the page does not — see `MobCardNote`. */
  note?: MobCardNote
  lookup: MobLookup
}): JSX.Element {
  const { data, loading } = useMobKnowledge(mob, lookup)
  const { wiki, extraSeen } = splitMobDrops(data)
  const quests = data?.quests ?? []
  const factionColor = con ? CONSIDER_FACTION_COLOR[con.faction] : CARD_TEXT

  return (
    <div
      data-testid="mob-hover-card"
      data-mob={mob}
      style={{
        background: 'rgba(15,16,23,0.98)',
        border: `1px solid ${factionColor}`,
        borderRadius: 6,
        padding: 8,
        maxWidth: 300,
        fontFamily: CARD_MONO,
        boxShadow: '0 6px 20px rgba(0,0,0,0.6)'
      }}
    >
      <div style={{ color: factionColor, fontSize: 12, fontWeight: 700 }}>
        {mob}
        {con?.rare === true && <span style={{ ...LABEL_STYLE, marginLeft: 5 }}>rare</span>}
      </div>
      <ConLine con={con} />
      <PageLevelZone data={data} />

      {/* The surface's own subject first (a respawn row's clock), then: 1. the definitive drop
          table, 2. evidence the page doesn't carry, 3. quest mentions. */}
      {note && (
        <CardSection label={note.label}>
          <div data-testid="mob-card-note" style={TEXT_STYLE}>
            {note.text}
          </div>
          {/* ROUND 9: the lists the sentence above summarises — every gap the fold measured, and
              what the wiki said. Dimmer than the sentence, because they are its working. */}
          {(note.lines ?? []).map((line) => (
            <div key={line} data-testid="mob-card-note-line" style={LABEL_STYLE}>
              {line}
            </div>
          ))}
        </CardSection>
      )}
      <WikiDrops wiki={wiki} />
      <ExtraSeenDrops extraSeen={extraSeen} />
      <MobQuests quests={quests} />

      <MobCardFooter data={data} loading={loading} wikiCount={wiki.length} />
    </div>
  )
}
