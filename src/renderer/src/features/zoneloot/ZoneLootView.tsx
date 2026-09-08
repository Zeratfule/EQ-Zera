// THE ZONE LOOT TAB (EQ Zera, ROADMAP §2).
//
// "I am going to <zone>. Who lives there, what do they drop, and have I ever had any of it?"
// One picker, one search box, one table: mob (with the level the wiki states), item, era, your own
// count, your own per-hour. The joins are all in `zoneLoot.ts` and `useZoneLoot.ts`; this file is
// the surface.
//
// NO RARITY COLUMN, and the reason is in zoneLoot.ts's header: the committed catalog carries drop
// NAMES only. What replaces it is the pair of columns nothing else in the app can supply - what
// YOU have had out of this zone, and how fast it came.
//
// THE OUT-OF-ERA DISCLOSURE IS THE MOB PAGE'S, not a second opinion: out-of-era rows fold behind
// one chip labelled by `outOfEraLabel`, in-era and unknown rows show plainly, and expanding it
// restores the wiki's whole claim. Same label, same rule, same `EraChip`.
//
// AND SINCE THE UPGRADE FINDER IT ANSWERS A SECOND QUESTION: "which of these would I actually
// wear?" A row whose item beats what the inventory dump says is on your body, under the profile the
// Build tab is on, wears a success chip naming the cell and the gain; the filter row offers an
// `Upgrades · N` toggle, and the footer counts them. The verdict is the Build tab's own
// (`shared/build/upgradeFinder.ts`) reached through `useUpgradeFinder`, so the chip here and the
// gauges there can never disagree. With no dump the toggle is offered and refused with a reason,
// because "every cell is empty" is not a comparison.
//
// THE ZONE CHOICE OUTLIVES A TAB SWITCH. A view unmounts on every one of those (the JOS-90/97/116
// law), so the pick lives in a renderer pref (`eq.zoneloot.zone`) and DEGRADES to "nothing picked"
// when the stored name is not a zone this build's catalog knows. Nothing stored at all seeds from
// where the character is standing, once, on the change that resolves it - never on every render,
// because an effect cannot tell a click from a mount.

import { type JSX, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Autocomplete, Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { PROFILE_LABEL, type BuildProfile } from '../../../../shared/build/profiles'
import { formatDropRate } from '../../lib/formatRate'
import { useWindowedRows, type WindowedRows } from '../../lib/useWindowedRows'
import { UpgradeChip } from '../loot/UpgradeLine'
import { outOfEraLabel } from '../mobs/dropEra'
import { MOB_SCRAPED_AT } from '../mobs/mobSearch'
import type { MobTarget } from '../mobs/mobTarget'
import { EraChip } from '../planner/PlannerChips'
import { filterRows, zoneLootSummary, type ZoneLootRow, type ZoneOption } from './zoneLoot'
import { useDefaultZone, useZoneLoot, zoneLootOptions } from './useZoneLoot'

/** Where the pick is remembered. Renderer pref, `eq.<feature>.*` like every other one. */
const ZONE_KEY = 'eq.zoneloot.zone'
/** Fixed dense-row height (px) - `useWindowedRows` is a fixed-height hook (lootRows.tsx). */
const ROW_HEIGHT = 37
/** The fixed-height contract as CSS: one clipped line per cell, so no row can wrap and desync. */
const FIXED_ROW = {
  height: ROW_HEIGHT,
  maxHeight: ROW_HEIGHT,
  '& td': { py: 0, maxHeight: ROW_HEIGHT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
} as const
/** Column widths from the HEADER alone - the other half of the fixed-height contract. */
const FIXED_TABLE = { tableLayout: 'fixed' } as const

/** The stored zone, or '' when nothing is stored or the stored name is not a known zone. */
function loadZone(): string {
  const stored = localStorage.getItem(ZONE_KEY) ?? ''
  if (stored === '') return ''
  return zoneLootOptions().some((o) => o.zone === stored) ? stored : ''
}

/** The upgrades toggle's whole state, as one prop - the filter row already carries seven. */
interface UpgradeFilter {
  /** rows in the searched table that beat what you wear */
  count: number
  on: boolean
  /** no dump means nothing to compare against, so the chip is offered and refused with a reason */
  hasDump: boolean
  onToggle: () => void
}

/** The picker, the search box, the era disclosure and the upgrades toggle. */
function FilterRow({
  zone,
  onPickZone,
  query,
  setQuery,
  outCount,
  showOut,
  onToggleOut,
  upgrades
}: {
  zone: string
  onPickZone: (z: string) => void
  query: string
  setQuery: (q: string) => void
  outCount: number
  showOut: boolean
  onToggleOut: () => void
  upgrades: UpgradeFilter
}): JSX.Element {
  const options = zoneLootOptions()
  const picked = useMemo(() => options.find((o) => o.zone === zone) ?? null, [options, zone])
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
      <Autocomplete
        size="small"
        autoHighlight
        openOnFocus
        options={options}
        value={picked}
        onChange={(_e, next: ZoneOption | null) => onPickZone(next?.zone ?? '')}
        getOptionLabel={(o) => o.zone}
        isOptionEqualToValue={(a, b) => a.key === b.key}
        noOptionsText="No zone matches."
        sx={{ minWidth: 260 }}
        renderInput={(params) => <TextField {...params} placeholder="Pick a zone" slotProps={{ htmlInput: { ...params.inputProps, 'data-testid': 'zoneloot-zone' } }} />}
      />
      <TextField
        size="small"
        placeholder="Search mobs and items in this zone"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ minWidth: 260, flexGrow: 1 }}
        slotProps={{ htmlInput: { 'data-testid': 'zoneloot-search' } }}
      />
      {outCount > 0 && (
        <Chip
          size="small"
          label={outOfEraLabel(outCount)}
          color={showOut ? 'warning' : 'default'}
          variant={showOut ? 'filled' : 'outlined'}
          onClick={onToggleOut}
          data-testid="zoneloot-era-toggle"
        />
      )}
      <UpgradesToggle upgrades={upgrades} />
    </Stack>
  )
}

/** `Upgrades · N`. Present with no dump too, saying what would make it work. */
function UpgradesToggle({ upgrades }: { upgrades: UpgradeFilter }): JSX.Element {
  const off = !upgrades.hasDump
  return (
    <Chip
      size="small"
      label={`Upgrades · ${String(upgrades.count)}`}
      color={upgrades.on ? 'success' : 'default'}
      variant={upgrades.on ? 'filled' : 'outlined'}
      disabled={off}
      title={off ? 'Load an inventory dump to compare' : undefined}
      onClick={off ? undefined : upgrades.onToggle}
      data-testid="zoneloot-upgrades-toggle"
    />
  )
}

/** A clickable name: underlined on hover, keyboard-reachable, no tooltip. */
function LinkText({ text, dim, onOpen }: { text: string; dim?: boolean; onOpen: () => void }): JSX.Element {
  return (
    <Box
      component="span"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
      sx={{
        color: dim ? 'text.secondary' : 'text.primary',
        cursor: 'pointer',
        textDecoration: 'underline dotted',
        textUnderlineOffset: 2,
        '&:hover': { color: 'primary.main' }
      }}
    >
      {text}
    </Box>
  )
}

/** The spacer rows that reserve the full scroll height - the LootView idiom, five columns wide. */
function PadRow({ height }: { height: number }): JSX.Element | null {
  if (height <= 0) return null
  return (
    <TableRow style={{ height }}>
      <TableCell colSpan={5} sx={{ p: 0, border: 0 }} />
    </TableRow>
  )
}

/** ONE (mob, drop) line. `profile` rides in because the upgrade chip names it. */
function LootRow({
  row,
  profile,
  onOpenLoot,
  onOpenMob
}: {
  row: ZoneLootRow
  profile: BuildProfile
  onOpenLoot: (item: string) => void
  onOpenMob: (t: MobTarget) => void
}): JSX.Element {
  return (
    <TableRow hover data-testid="zoneloot-row" sx={FIXED_ROW}>
      <TableCell>
        <LinkText text={row.mob} onOpen={() => onOpenMob({ mob: row.mob })} />
        {row.level !== undefined && (
          <Typography component="span" variant="caption" color="text.secondary">
            {' '}
            {row.level}
          </Typography>
        )}
      </TableCell>
      <TableCell>
        <Box component="span" data-testid="zoneloot-item">
          <LinkText text={row.item} onOpen={() => onOpenLoot(row.item)} />
        </Box>
        {/* The ITEM cell rather than the Era cell beside it: `Era` is an 11% column under a fixed
            table layout, and a "+14 Chest" chip in it would be ellipsised into nothing. */}
        {row.upgrade && <UpgradeChip cell={row.upgrade.cell} delta={row.upgrade.delta} profile={profile} />}
      </TableCell>
      <TableCell>
        <EraChip subject={row.era} />
      </TableCell>
      <TableCell align="right">
        {row.seen > 0 && (
          <Typography component="span" variant="caption" sx={{ color: 'success.main' }}>
            {row.seen}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">
        <Typography component="span" variant="caption" color={row.perHour == null ? 'text.disabled' : 'text.secondary'}>
          {row.perHour == null ? '-' : formatDropRate(row.perHour)}
        </Typography>
      </TableCell>
    </TableRow>
  )
}

/** The windowed table. Only the slice a scroll box can paint is ever mounted. */
function LootTable({
  rows,
  win,
  profile,
  handlers
}: {
  rows: readonly ZoneLootRow[]
  win: WindowedRows
  profile: BuildProfile
  handlers: { onOpenLoot: (item: string) => void; onOpenMob: (t: MobTarget) => void }
}): JSX.Element {
  return (
    <Table size="small" stickyHeader sx={FIXED_TABLE}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ width: '26%' }}>Mob</TableCell>
          {/* No width: the item name takes whatever the stated columns leave. */}
          <TableCell>Item</TableCell>
          <TableCell sx={{ width: '11%' }}>Era</TableCell>
          <TableCell align="right" sx={{ width: '8%' }}>Yours</TableCell>
          <TableCell align="right" sx={{ width: '15%' }}>Per hour</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <PadRow height={win.topPad} />
        {rows.slice(win.start, win.end).map((row) => (
          <LootRow key={row.key} row={row} profile={profile} onOpenLoot={handlers.onOpenLoot} onOpenMob={handlers.onOpenMob} />
        ))}
        <PadRow height={win.bottomPad} />
      </TableBody>
    </Table>
  )
}

/** The one line under the table: what is on screen, and how old the wiki data is. */
function footerText(rows: readonly ZoneLootRow[]): string {
  const { mobs, drops, seen, upgrades } = zoneLootSummary(rows)
  const yours = seen > 0 ? ` · ${String(seen)} looted by you` : ''
  const better = upgrades > 0 ? ` · ${String(upgrades)} upgrades` : ''
  const line = `${String(mobs)} mobs · ${String(drops)} drops${yours}${better}`
  return MOB_SCRAPED_AT === '' ? line : `${line} · wiki data as of ${MOB_SCRAPED_AT.slice(0, 10)}`
}

/**
 * The one line the upgrades filter earns, and it is STATE rather than method: what the comparison
 * is against, and the tier each side is read at. It is on screen only while the toggle is on.
 */
function UpgradeCaption({ profile }: { profile: BuildProfile }): JSX.Element {
  return (
    <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }} data-testid="zoneloot-upgrade-caption">
      Compared with what you wear under the {PROFILE_LABEL[profile]} profile; worn items count at their +N, drops at base.
    </Typography>
  )
}

/** The quiet line that stands in for the table. Both states name what to do next. */
function EmptyState({ zone }: { zone: string }): JSX.Element {
  return (
    <Typography variant="body2" color="text.disabled" sx={{ p: 1 }} data-testid="zoneloot-empty">
      {zone === ''
        ? 'Pick a zone to see who lives there and what they drop.'
        : 'The wiki catalog lists no mobs for this zone.'}
    </Typography>
  )
}

export default function ZoneLootView({
  onOpenLoot,
  onOpenMob
}: {
  onOpenLoot: (item?: string) => void
  onOpenMob: (t: MobTarget) => void
}): JSX.Element {
  const [zone, setZone] = useState(loadZone)
  // A zone was restored ⇒ the seed below has nothing to say. Held in a ref rather than in state
  // because it is a fact about this mount, and re-rendering on it would say nothing new.
  const seeded = useRef(zone !== '')
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [showOut, setShowOut] = useState(false)
  const [upgradesOnly, setUpgradesOnly] = useState(false)

  const defaultZone = useDefaultZone()
  // SEEDS ONCE, on the change that resolves the character's zone - not on every render, and never
  // over a pick. The pick handler writes storage, so a deliberate clear is remembered as a clear.
  useEffect(() => {
    if (seeded.current || defaultZone === '') return
    seeded.current = true
    setZone(defaultZone)
  }, [defaultZone])

  const { rows, hasDump, profile } = useZoneLoot(zone)
  // Two passes over the same rows: the search decides what the disclosures are COUNTING, and they
  // decide what is shown. Counting over the unsearched table would offer "+95 out of era" beside
  // four rows - and the same argument makes the upgrades count a count of the SEARCHED table.
  const searched = useMemo(() => filterRows(rows, deferred, true), [rows, deferred])
  const visible = useMemo(() => filterRows(rows, deferred, showOut, upgradesOnly), [rows, deferred, showOut, upgradesOnly])
  const counts = useMemo(() => zoneLootSummary(searched), [searched])

  const scrollRef = useRef<HTMLDivElement>(null)
  const win = useWindowedRows({ count: visible.length, rowHeight: ROW_HEIGHT, scrollRef })

  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }} data-testid="zoneloot-view">
      <FilterRow
        zone={zone}
        onPickZone={(z) => {
          localStorage.setItem(ZONE_KEY, z)
          seeded.current = true
          setZone(z)
          setShowOut(false)
          setUpgradesOnly(false)
        }}
        query={query}
        setQuery={setQuery}
        outCount={counts.outOfEra}
        showOut={showOut}
        onToggleOut={() => setShowOut((v) => !v)}
        upgrades={{
          count: counts.upgrades,
          on: upgradesOnly,
          hasDump,
          onToggle: () => setUpgradesOnly((v) => !v)
        }}
      />
      {upgradesOnly && <UpgradeCaption profile={profile} />}
      <Paper
        ref={scrollRef}
        variant="outlined"
        data-testid="zoneloot-list"
        sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}
      >
        {visible.length === 0 ? (
          <EmptyState zone={zone} />
        ) : (
          <LootTable rows={visible} win={win} profile={profile} handlers={{ onOpenLoot, onOpenMob }} />
        )}
      </Paper>
      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }} data-testid="zoneloot-footer">
        {footerText(visible)}
      </Typography>
    </Stack>
  )
}

/**
 * The App.tsx mount, in the `QuestsBranch` idiom - a sibling of the other branches rather than one
 * more `view ===` arm inside `PlainView`, whose switch is at its measured complexity ceiling.
 */
export function ZoneLootBranch({
  view,
  viewKey,
  onOpenLoot,
  onOpenMob
}: {
  view: string
  viewKey: string
  onOpenLoot: (item?: string) => void
  onOpenMob: (t: MobTarget) => void
}): JSX.Element | null {
  return view === 'zoneloot' ? <ZoneLootView key={viewKey} onOpenLoot={onOpenLoot} onOpenMob={onOpenMob} /> : null
}
