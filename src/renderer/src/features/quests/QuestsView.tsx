// THE QUESTS TAB (EQ Zera, 2026-09-06).
//
// Two things a player wants from a quest catalog, in the order they want them:
//
//   1. "I just looted X — what is it for?"  The top section lists every quest item in this
//      character's loot history, newest first, each with the quests it feeds. It is empty until
//      the log has seen a quest item, and says so in one line rather than hiding.
//   2. "Find me the quest."  A search over names, givers, zones and items, and under it the
//      whole catalog filtered by the character's class loadout and a start zone — because 904
//      quests is a list nobody scrolls, and a Cleric does not want the Warrior epic in the way.
//
// Either one opens a `QuestPage`. Every item name links OUT to the Loot drill-down through the
// app's router (`onOpenLoot`), the same contract the Exaltations and Gear tabs use.
//
// KEYED BY CHARACTER from App.tsx like the rest: the catalog is character-independent, but the
// loot join is not, and the remount is how this app says whose loot.

import { type JSX, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Chip, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import type { QuestEntry } from '@shared/types'
import { questClasses, type LootedQuestItem } from '../../../../shared/questIndex'
// The character's resolved class LOADOUT (EQ Legends gives one character several classes) — the
// same reading the Alerts tab and the level-unlock list use.
import { useResolvedClasses } from '../alerts/lineIntel'
import { QuestPage } from './QuestPage'
import { QUEST_BY_PAGE, QUEST_CATALOG, QUEST_SCRAPED_AT, QUEST_ZONES, browseQuests, searchQuests } from './questSearch'
import { TrackedQuests } from './TrackedQuests'
import { useQuestItems } from './useQuestItems'
import { useQuestPins } from './useQuestPins'
import { useQuestProgress } from './useQuestProgress'

/** The browse list is capped: past this the answer is a narrower filter, not a longer scroll. */
const BROWSE_CAP = 250
const NO_CLASSES: readonly string[] = []

function classSummary(q: QuestEntry): string {
  const open = questClasses(q)
  if (open === 'all') return 'Any class'
  return open.length > 3 ? `${open.slice(0, 3).join(', ')} +${String(open.length - 3)}` : open.join(', ')
}

function QuestRow({ quest, held, onOpen }: { quest: QuestEntry; held: number; onOpen: (q: QuestEntry) => void }): JSX.Element {
  const where = [quest.giver, quest.startZone].filter(Boolean).join(' · ')
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="baseline"
      role="button"
      tabIndex={0}
      data-testid="quest-row"
      onClick={() => onOpen(quest)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(quest)
      }}
      sx={{ py: 0.4, px: 0.75, borderRadius: 1, cursor: 'pointer', minWidth: 0, '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
        {quest.name}
      </Typography>
      {quest.minLevel !== undefined && (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          Lvl {quest.minLevel}+
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
        {where}
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      <Typography variant="caption" color="text.disabled" noWrap sx={{ flexShrink: 0 }}>
        {classSummary(quest)}
      </Typography>
      {held > 0 && (
        <Typography variant="caption" sx={{ color: 'success.main', flexShrink: 0 }}>
          {held} {held === 1 ? 'item' : 'items'} held
        </Typography>
      )}
    </Stack>
  )
}

/** Section 1: the quest items in the loot history, each with the quests it feeds. */
function HeldItems({ items, onOpen }: { items: LootedQuestItem[]; onOpen: (q: QuestEntry) => void }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, flexShrink: 0 }} data-testid="quest-held">
      <Typography variant="caption" className="eq-display-label" sx={{ display: 'block', color: 'text.secondary', mb: 0.75 }}>
        Your quest items · {items.length}
      </Typography>
      {items.length === 0 ? (
        <Typography variant="caption" color="text.disabled" data-testid="quest-held-empty">
          Nothing yet - the first quest item you loot lands here, with the quests it belongs to.
        </Typography>
      ) : (
        <Stack spacing={0.5} sx={{ maxHeight: 180, overflow: 'auto' }}>
          {items.map((it) => (
            <Stack key={it.key} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap data-testid="quest-held-row">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {it.item}
                {it.count > 1 && (
                  <Typography component="span" variant="caption" color="text.secondary">
                    {' '}×{it.count}
                  </Typography>
                )}
              </Typography>
              {it.refs.map((ref) => (
                <Chip
                  key={`${ref.quest.page}:${ref.role}`}
                  size="small"
                  variant="outlined"
                  color={ref.role === 'required' ? 'primary' : 'default'}
                  label={ref.role === 'required' ? ref.quest.name : `${ref.quest.name} (reward)`}
                  onClick={() => onOpen(ref.quest)}
                />
              ))}
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  )
}

/** The search box, the class-loadout toggle and the zone menu. */
function FilterRow({
  query,
  setQuery,
  classes,
  myClasses,
  toggleMyClasses,
  zone,
  setZone
}: {
  query: string
  setQuery: (q: string) => void
  classes: readonly string[]
  myClasses: boolean
  toggleMyClasses: () => void
  zone: string
  setZone: (z: string) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <TextField
        size="small"
        placeholder="Search quests, NPCs, zones, items"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ minWidth: 280, flexGrow: 1 }}
        slotProps={{ htmlInput: { 'data-testid': 'quests-search' } }}
      />
      {classes.length > 0 && (
        <Chip
          size="small"
          label={`My classes · ${classes.join(' / ')}`}
          color={myClasses ? 'primary' : 'default'}
          variant={myClasses ? 'filled' : 'outlined'}
          onClick={toggleMyClasses}
          data-testid="quests-filter-class"
        />
      )}
      <Select size="small" displayEmpty value={zone} onChange={(e) => setZone(e.target.value)} sx={{ minWidth: 200 }} data-testid="quests-filter-zone">
        <MenuItem value="">Any start zone</MenuItem>
        {QUEST_ZONES.map((z) => (
          <MenuItem key={z.zone} value={z.zone}>
            {z.zone} · {z.count}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  )
}

/** The count line under the list, and the wiki's date. */
function footerText(searching: boolean, shown: number, matched: number): string {
  const total = String(QUEST_CATALOG.length)
  const line = searching
    ? `${String(matched)} of ${total} quests`
    : matched > BROWSE_CAP
      ? `Showing ${String(BROWSE_CAP)} of ${String(matched)} - search or pick a zone to narrow it`
      : `${String(shown)} of ${total} quests`
  return QUEST_SCRAPED_AT === '' ? line : `${line} · wiki data as of ${QUEST_SCRAPED_AT.slice(0, 10)}`
}

/**
 * The tab, plus the DEEP-LINK anchor a quest-item toast arrives with (ROADMAP §1).
 *
 * `anchor` is a wiki PAGE title, which is the id the whole catalog is keyed by; `anchorNonce`
 * makes the same page asked for twice arrive twice, and `onAnchorApplied` retires the payload the
 * moment it lands so a later visit to this tab opens on the list.
 */
interface QuestsViewProps {
  onOpenLoot: (item?: string) => void
  anchor?: string | null
  anchorNonce?: number
  onAnchorApplied?: () => void
}

export default function QuestsView({ onOpenLoot, anchor = null, anchorNonce = 0, onAnchorApplied }: QuestsViewProps): JSX.Element {
  const classes = useResolvedClasses()
  const { items, byQuest } = useQuestItems()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [myClasses, setMyClasses] = useState(true)
  const [zone, setZone] = useState('')
  const [open, setOpen] = useState<QuestEntry | null>(null)
  // The tracker, and its progress. Loops rather than `.map` over the pins is not required here —
  // a projection is what a renderer is for — but the page list is memoised so `useQuestProgress`
  // is not handed a fresh array on every keystroke in the search box.
  const [pins] = useQuestPins()
  const trackedPages = useMemo(() => pins.map((p) => p.page), [pins])
  const trackedProgress = useQuestProgress(trackedPages)

  const hits = useMemo(() => searchQuests(deferred), [deferred])
  const browse = useMemo(
    () => browseQuests({ classes: myClasses ? classes : NO_CLASSES, zone, heldPages: new Set(byQuest.keys()) }),
    [myClasses, classes, zone, byQuest]
  )

  // THE ANCHOR LANDS ON MOUNT AS WELL AS ON A NONCE CHANGE, and that is the load-bearing half: a
  // view UNMOUNTS on every tab switch (the JOS-90/97/116 law), so the deep link that switched to
  // this tab is arriving at a view that has never run this effect before. The ref remembers which
  // nonce was applied rather than whether anything was, so a second link to the same page while
  // this tab is already open still opens it. A page the catalog does not know clears the pane and
  // leaves the reader on the list, which is the honest ending for an anchor we cannot resolve.
  const appliedNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (anchor === null || appliedNonceRef.current === anchorNonce) return
    appliedNonceRef.current = anchorNonce
    setOpen(QUEST_BY_PAGE.get(anchor) ?? null)
    onAnchorApplied?.()
  }, [anchor, anchorNonce, onAnchorApplied])

  if (open) {
    const quest = QUEST_BY_PAGE.get(open.page) ?? open
    return <QuestPage quest={quest} held={byQuest.get(quest.page) ?? []} onBack={() => setOpen(null)} onOpenLoot={onOpenLoot} />
  }

  const searching = deferred.trim() !== ''
  const list = searching ? hits.map((h) => h.entry) : browse.slice(0, BROWSE_CAP)

  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }} data-testid="quests-view">
      <TrackedQuests pins={pins} progressByPage={trackedProgress} onOpen={setOpen} />
      <HeldItems items={items} onOpen={setOpen} />
      <FilterRow
        query={query}
        setQuery={setQuery}
        classes={classes}
        myClasses={myClasses}
        toggleMyClasses={() => setMyClasses((v) => !v)}
        zone={zone}
        setZone={setZone}
      />
      <Paper variant="outlined" sx={{ p: 1, flexGrow: 1, minHeight: 0, overflow: 'auto' }} data-testid="quests-list">
        {list.length === 0 ? (
          <Typography variant="caption" color="text.disabled" sx={{ p: 1, display: 'block' }}>
            {searching ? 'No quest matches that.' : 'No quests match these filters.'}
          </Typography>
        ) : (
          list.map((q) => <QuestRow key={q.page} quest={q} held={byQuest.get(q.page)?.length ?? 0} onOpen={setOpen} />)
        )}
      </Paper>
      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
        {footerText(searching, list.length, searching ? hits.length : browse.length)}
      </Typography>
    </Stack>
  )
}

/**
 * The App.tsx mount, as a sibling of `SpellDrill` rather than one more `view ===` branch inside
 * `PlainView` — that switch sits at the measured complexity ceiling (see its header).
 */
export function QuestsBranch({
  view,
  viewKey,
  onOpenLoot,
  anchor,
  anchorNonce,
  onAnchorApplied
}: {
  view: string
  viewKey: string
  onOpenLoot: (item?: string) => void
  /** `AppRouting.questPage` — the quest page a deep link asked for, or null. */
  anchor: string | null
  anchorNonce: number
  onAnchorApplied: () => void
}): JSX.Element | null {
  return view === 'quests' ? (
    <QuestsView key={viewKey} onOpenLoot={onOpenLoot} anchor={anchor} anchorNonce={anchorNonce} onAnchorApplied={onAnchorApplied} />
  ) : null
}
