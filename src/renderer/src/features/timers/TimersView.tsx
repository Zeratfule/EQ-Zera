// THE TIMERS TAB — respawn clocks started by death messages (JOS-194).
//
// Two panels, and the second one is why the feature is usable on the first kill of a fresh
// install rather than after a configuration session:
//
//   LEFT   the live clocks. One row per watched mob that has died, counting down — and, since
//          round 7, carrying everything that mob's watch can be edited with.
//   RIGHT  what you just killed. Every mob whose death this fold has seen recently, each with a
//          one-click Watch. Clicking it does not merely arm the FUTURE — the module already holds
//          the death, so the clock starts from the kill you already made. That is the whole
//          discoverability story: kill something, look at this tab, click Watch, see a clock.
//
// NOTHING IS CLOCKED UNTIL YOU SAY SO (owner ruling, 2026-08-10 — argued in shared/respawn.ts).
// The right-hand panel is therefore the ONLY way a row ever appears on the left, which makes the
// two panels a single flow rather than a list and its settings: the empty state on the left points
// at the panel on the right, and the panel on the right is a list of things that have actually
// died rather than a catalog to go shopping in.
//
// AND THE PAGE IS SCOPED TO ONE ZONE (same ruling). The scope switch at the top defaults to the
// zone the fold is in and the whole page obeys it — clocks AND recently-killed — because "what can
// I do about this right now" is a question about where you are standing. All zones is one click
// away and is what you want when you are setting up a camp you are not in yet; the counts on the
// switch say how much is hiding either way, so the default never silently swallows anything.
//
// AND UNWATCHING IS ON THE MOB, NOT IN A LIST (owner ruling, round 4, FINISHED in round 7). Watch
// was always a per-mob click; stopping used to mean finding the name again in "Your watches" at the
// bottom of this page. Round 4 put Unwatch on the clock row and on the Recently-killed entry and
// left the list standing for the one thing it still had — typing a number. Round 7 removed it: the
// seconds box is on the mob's Running entry now, beside the gaps that produced the number it
// overrides, and this page has no third section. The stated cost is in shared/respawn.ts: a watch
// whose clock is not on screen (another zone — switch the scope; or a mob you have never killed) has
// no row to carry its box, and its Recently-killed entry still toggles the watch off.
//
// AND A WATCHED MOB IS ALWAYS UNDER RUNNING (owner ruling, round 8). The owner clicked Watch on a
// kill from hours earlier, the button flipped to Unwatch — and this panel still read "No clocks
// running", because the fold swept every row whose estimate had elapsed more than half an hour ago.
// A watched mob the fold holds a death for now ALWAYS has a row here; when its clock is long gone it
// says so honestly (`respawnClockLabel`) and sorts under the live ones. So the empty state below
// means what it says again — nothing is watched here, rather than something watched and hidden.
//
// AND THIS PAGE RE-ORDERS AGAINST ITS OWN CLOCK, the way the floating window always has. The order
// is a function of NOW — soonest due, a sighting ageing out of UP, a countdown passing into stale —
// while the module publishes an order only when the FOLD changes, which on an idle log is never.
// So the rows are sorted here, per tick, by the same `orderRespawnRows` both surfaces read.
//
// AND THE PAGE STOPPED EXPLAINING ITSELF (owner ruling, round 5). Each of the four rounds above
// left its ruling written out in prose at the top of this file's render, and the result was a
// thirteen-line paragraph over a page whose every control is one word. It is gone, not moved: the
// facts it recited are each already stated by something the user is looking at — the rung on a
// clock row, `wiki default`, `UP`, the zone chip and the scope switch, the Watch/Unwatch pair —
// and the sentences behind them live on those things' hovers (`respawnProvenance`,
// `RESPAWN_CONFIRM_TITLE`, both in shared/respawn.ts). Round 7's addendum took one more: Unwatch has
// no tooltip at all now — the control speaks for itself. And round 9 took the LAST one: the caption
// under the clocks existed to state the seconds box's limits, the box is gone, and the modal that
// replaced it says what it accepts where the typing happens. This page now carries no standing
// sentence of its own at all.
//
// AND THE NUMBER IS EDITED IN A MODAL (owner ruling, round 9). The clock row's duration and its rung
// are one bordered unit with a small edit affordance attached; pressing it opens `RespawnEditDialog`,
// which is the first surface in this feature with room to put the evidence and the decision in front
// of each other — the hover card, every gap the fold measured, the wiki's words and a link to the
// page they came from, the number, and the way back to the calculated one. It is TAB-ONLY: the
// floating window paints the overridden STATE and carries none of the editing.
//
// AND EVERY MOB ON THIS PAGE OPENS ITS CARD (owner ruling, rounds 6 and 7). Pointing at a clock row
// reveals the mob's drop table with your own loot counts riding it; round 7 put the same card on the
// Recently-killed entries, which is the surface where "is this worth watching at all" is actually
// asked. One component, one lookup door, two notes (`respawnCardNote` / `respawnCandidateNote`).
//
// AND RECENTLY KILLED IS SEARCHABLE (owner ruling, round 7), built to the JOS-206 findings rather
// than to taste, because this is the same shape of list that made the Sky tab stall:
//
//   * THE FILTER IS PURE AND SINGLE-PASS, and lives in shared/respawn.ts where it is node-tested.
//   * THE INPUT OWNS ITS OWN STATE and is memoized, so a keystroke never waits on the list.
//   * THE QUERY LIVES IN THE PANEL THAT USES IT, not on the page — typing re-renders the
//     Recently-killed column and nothing else. The clocks column, which re-renders once a second on
//     its own, is not dragged into it.
//   * THE ROW IS MEMOIZED AND ITS PROPS ARE STABLE — it takes the mob's KEY and hands it back, so
//     the two writers are `useCallback`s with no per-row closure and no `prefs` in their deps (the
//     prefs are read through a ref at click time, which is the only moment they are needed).

import { memo, useCallback, useMemo, useRef, useState, type JSX } from 'react'
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import {
  filterRespawnCandidates,
  orderRespawnRows,
  respawnCandidateNote,
  respawnInZone,
  type RespawnCandidate,
  type RespawnPrefs,
  type RespawnRow
} from '@shared/respawn'
import Tooltip from '../../lib/Tooltip'
import { MOB_CARD_SLOT_PROPS, MobCard } from '../../lib/hoverCards'
import { mainMobLookup } from './mobLookup'
import { RespawnRowBar } from './RespawnRowBar'
import { RESPAWN_TOGGLE_SX, UnwatchButton } from './UnwatchButton'
import {
  useConfirmSighting,
  useRespawnSnap,
  useSecondsClock,
  useSetRespawnPrefs,
  useUnwatch
} from './useRespawn'

/** Which zone the page is showing. Component state: a view mode, not a preference. */
type Scope = 'zone' | 'all'

/** Add or update one watch, leaving the rest of the list alone. */
function withWatch(prefs: RespawnPrefs, key: string, display: string, customSec?: number): RespawnPrefs {
  const rest = prefs.watches.filter((w) => w.key !== key)
  const entry = customSec === undefined ? { key, display } : { key, display, customSec }
  return { ...prefs, watches: [...rest, entry] }
}

/**
 * ONE RECENTLY-KILLED ENTRY. `memo` because this list is the one on the page that a keystroke
 * re-filters, and its rows are the ones JOS-206 measured as the cost: a row whose props did not
 * change must not reconcile a MUI Button, a Tooltip and (now) a hover card anchor.
 *
 * ITS PROPS ARE PRIMITIVES AND STABLE FUNCTIONS. It takes the mob's key and display back UP rather
 * than being handed a closure over the watch list — that is what lets the two writers be
 * `useCallback`s that never change identity, which is the half of memoization people forget.
 */
const CandidateRow = memo(function CandidateRow({
  cand,
  onWatch,
  onUnwatch
}: {
  cand: RespawnCandidate
  onWatch: (key: string, display: string) => void
  onUnwatch: (key: string) => void
}): JSX.Element {
  return (
    <Tooltip
      // ROUND 7: the same card the clock rows draw — the mob's drop table with your own loot counts
      // riding it — because "is this worth watching" is the same question as "is it worth waiting
      // for", asked one decision earlier. The note is the shorter one: a candidate has no rung.
      title={<MobCard mob={cand.display} note={respawnCandidateNote(cand)} lookup={mainMobLookup} />}
      slotProps={MOB_CARD_SLOT_PROPS}
      disableInteractive
      placement="top-start"
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        data-testid="respawn-candidate"
        data-respawn-mob={cand.key}
        sx={{ py: 0.5 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {cand.display}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {cand.zone.length > 0 ? cand.zone : 'unknown zone'} · {cand.kills} kill
            {cand.kills === 1 ? '' : 's'}
            {cand.wikiText !== undefined ? ` · wiki: ${cand.wikiText}` : ''}
          </Typography>
        </Box>
        {/* `watched` is the MODULE's answer, not a second one worked out here from the same
            snapshot's prefs — one fact, one owner. The two states are ONE TOGGLE (round 4): the same
            size of button in the same place, saying the opposite thing. */}
        {cand.watched ? (
          <UnwatchButton
            mobKey={cand.key}
            display={cand.display}
            testId="respawn-unwatch"
            onUnwatch={onUnwatch}
          />
        ) : (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            data-testid="respawn-watch"
            // The SAME shape as its opposite (RESPAWN_TOGGLE_SX) — one control with two states, not
            // two buttons that happen to share a slot.
            sx={RESPAWN_TOGGLE_SX}
            onClick={(e) => {
              e.stopPropagation()
              onWatch(cand.key, cand.display)
            }}
          >
            Watch
          </Button>
        )}
      </Stack>
    </Tooltip>
  )
})

/**
 * THE SEARCH BOX, and it holds its own text (JOS-206's fourth fix, which is the one that stops a
 * keystroke from being a round trip through the list).
 *
 * `memo` + a stable `onQuery` means the box does not re-render when the results do; its value comes
 * from nowhere but its own state, so nothing about how long the filter takes can be felt while
 * typing. There is deliberately no programmatic writer for it — nothing on this page reveals a
 * candidate the way the Sky tab reveals a quest — so the sync problem that shape usually brings
 * does not exist here.
 */
const RecentSearch = memo(function RecentSearch({
  onQuery
}: {
  onQuery: (q: string) => void
}): JSX.Element {
  const [text, setText] = useState('')
  return (
    <TextField
      size="small"
      fullWidth
      placeholder="Search name, zone or wiki"
      value={text}
      data-testid="respawn-search"
      sx={{ mb: 1 }}
      onChange={(e) => {
        setText(e.target.value)
        onQuery(e.target.value)
      }}
    />
  )
})

function ClocksPanel({
  rows,
  nowMs,
  elsewhere,
  zoneName,
  onConfirmSighting,
  onUnwatch,
  onSetCustom
}: {
  rows: RespawnRow[]
  nowMs: number
  /** How many clocks the scope is hiding. Stated, never silently dropped. */
  elsewhere: number
  zoneName: string
  onConfirmSighting: (rowId: string) => void
  /** Round 4: the row's own way out, handed down so the clock carries it instead of a list. */
  onUnwatch: (key: string) => void
  /** Round 7: rung 1, typed on the clock — the other half of what the retired list used to hold. */
  onSetCustom: (key: string, display: string, sec?: number) => void
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="respawn-empty" sx={{ py: 2 }}>
        {elsewhere > 0
          ? `No clocks in ${zoneName}. ${elsewhere} running in other zones.`
          : 'No clocks running. Watch a mob from Recently killed.'}
      </Typography>
    )
  }
  return (
    // ROUND 9 TOOK THE LAST CAPTION OFF THIS PAGE. It stated the seconds box's limits, because a
    // tooltip on an input the user is typing into is against the house rules and an out-of-range
    // number silently cleared. The box is gone and the modal that replaced it says the same thing
    // where the typing happens (`RESPAWN_INPUT_HELP`), states what it understood while you type, and
    // refuses out loud instead of clearing — so the page keeps no standing sentence at all.
    <Stack spacing={0.75} data-testid="respawn-rows">
      {rows.map((row) => (
        <RespawnRowBar
          key={row.id}
          row={row}
          nowMs={nowMs}
          onConfirmSighting={onConfirmSighting}
          onUnwatch={onUnwatch}
          onSetCustom={onSetCustom}
        />
      ))}
    </Stack>
  )
}

/** The scope switch, and the counts that say what each side is holding. */
function ScopeSwitch({
  scope,
  onScope,
  zoneName,
  here,
  total
}: {
  scope: Scope
  onScope: (s: Scope) => void
  zoneName: string
  here: number
  total: number
}): JSX.Element {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      data-testid="respawn-scope"
      value={scope}
      onChange={(_e, v: Scope | null) => {
        // MUI hands back null when the pressed button was already selected; a scope must always
        // have a value, so that click is a no-op rather than an unscoped page.
        if (v !== null) onScope(v)
      }}
    >
      <ToggleButton data-testid="respawn-scope-zone" value="zone">
        {zoneName} ({here})
      </ToggleButton>
      <ToggleButton data-testid="respawn-scope-all" value="all">
        All zones ({total})
      </ToggleButton>
    </ToggleButtonGroup>
  )
}

/** What the Recently-killed list says when it is showing nothing, and WHY it is showing nothing. */
function RecentEmpty({
  query,
  scoped,
  anyRecent,
  zoneName
}: {
  query: string
  scoped: boolean
  anyRecent: number
  zoneName: string
}): JSX.Element {
  // A search that matched nothing is a different state from an empty log, and saying so is what
  // keeps a typo from reading as "this dungeon killed nothing".
  const text =
    query.trim().length > 0
      ? `No kills match "${query.trim()}".`
      : scoped && anyRecent > 0
        ? `Nothing has died in ${zoneName} yet. ${anyRecent} elsewhere.`
        : 'Nothing has died yet in this log.'
  return (
    <Typography variant="body2" color="text.secondary" data-testid="respawn-recent-empty">
      {text}
    </Typography>
  )
}

/**
 * THE RIGHT-HAND COLUMN: what you killed, and the one door a clock comes through.
 *
 * Its own component because the page reached the repo's `max-lines-per-function` ceiling when round
 * 4 wired the removal writer through it, and the answer to that is a split rather than a widened
 * threshold. The seam is the honest one anyway — the left column is the running clocks and this is
 * where they are ADMITTED and retired.
 *
 * IT OWNS THE QUERY (round 7). The typed text is this panel's business and nothing else on the page
 * reads it, so holding it here means a keystroke re-renders one column instead of the whole tab —
 * and in particular does not re-render the clocks, which are already re-rendering once a second.
 */
function DiscoveryPanel({
  recent,
  anyRecent,
  scoped,
  zoneName,
  onWatch,
  onUnwatch
}: {
  recent: RespawnCandidate[]
  /** How many candidates the fold holds in total, so the scoped empty state can say where they are. */
  anyRecent: number
  scoped: boolean
  zoneName: string
  onWatch: (key: string, display: string) => void
  onUnwatch: (key: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  // ONE PASS PER KEYSTROKE, memoized on identity: an empty query returns the SAME array the module
  // published, so the default path allocates nothing and this memo hits.
  const shown = useMemo(() => filterRespawnCandidates(recent, query), [recent, query])
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">Recently killed</Typography>
        {shown.length !== recent.length && (
          <Typography variant="caption" color="text.secondary" data-testid="respawn-search-count">
            {shown.length} of {recent.length}
          </Typography>
        )}
      </Stack>
      <RecentSearch onQuery={setQuery} />
      {shown.length === 0 ? (
        <RecentEmpty query={query} scoped={scoped} anyRecent={anyRecent} zoneName={zoneName} />
      ) : (
        <Stack data-testid="respawn-recent" divider={<Divider flexItem />}>
          {shown.map((c) => (
            <CandidateRow key={`${c.zone}::${c.key}`} cand={c} onWatch={onWatch} onUnwatch={onUnwatch} />
          ))}
        </Stack>
      )}
    </Box>
  )
}

export default function TimersView(): JSX.Element {
  const snap = useRespawnSnap()
  const nowMs = useSecondsClock()
  const setPrefs = useSetRespawnPrefs()
  const confirmSighting = useConfirmSighting()
  const unwatch = useUnwatch()
  const prefs = snap.prefs
  const [scope, setScope] = useState<Scope>('zone')

  // THE WATCH LIST, READ AT CLICK TIME RATHER THAN CLOSED OVER (JOS-206's "stable props"). Both
  // writers below edit one entry of a list they must not otherwise disturb, so they need the
  // CURRENT list — but taking it as a dependency would rebuild them on every module delta and
  // un-memoize every row they are handed to. A ref is the standard answer: the value is only ever
  // needed inside a handler, which by definition runs after the render that set it.
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const onWatch = useCallback(
    (key: string, display: string) => {
      setPrefs(withWatch(prefsRef.current, key, display))
    },
    [setPrefs]
  )
  const onSetCustom = useCallback(
    (key: string, display: string, sec?: number) => {
      setPrefs(withWatch(prefsRef.current, key, display, sec))
    },
    [setPrefs]
  )

  // The zone name as the switch and the empty states say it. The fold has no zone before the log
  // states one, and "this zone" is then a claim it cannot make.
  const zoneName = snap.zone.length > 0 ? snap.zone : 'Unknown zone'
  const hereRows = respawnInZone(snap.rows, snap.zone)
  const hereRecent = respawnInZone(snap.recent, snap.zone)
  // Scoped first, then ordered against THIS renderer's clock — see the header: the ranking moves
  // every second whether or not the log does.
  const rows = orderRespawnRows(scope === 'zone' ? hereRows : snap.rows, nowMs)
  const recent = scope === 'zone' ? hereRecent : snap.recent

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }} data-testid="timers-view">
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 0.5 }}>
        {/* ROUND 7: the page is called what the tab is called. "Respawn clocks" described the rows;
            the nav row has said Timers since the tab existed, and two names for one surface is the
            thing VIEW_LABELS exists to prevent one floor up. */}
        <Typography variant="h6">Timers</Typography>
        {snap.zone.length > 0 && <Chip size="small" label={snap.zone} variant="outlined" />}
      </Stack>
      <Box sx={{ mb: 2, mt: 1.5 }}>
        <ScopeSwitch
          scope={scope}
          onScope={setScope}
          zoneName={zoneName}
          here={hereRows.length}
          total={snap.rows.length}
        />
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="flex-start">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Running
          </Typography>
          <ClocksPanel
            rows={rows}
            nowMs={nowMs}
            elsewhere={scope === 'zone' ? snap.rows.length - hereRows.length : 0}
            zoneName={zoneName}
            onConfirmSighting={confirmSighting}
            onUnwatch={unwatch}
            onSetCustom={onSetCustom}
          />
        </Box>

        <DiscoveryPanel
          recent={recent}
          anyRecent={snap.recent.length}
          scoped={scope === 'zone'}
          zoneName={zoneName}
          onWatch={onWatch}
          onUnwatch={unwatch}
        />
      </Stack>
    </Box>
  )
}
