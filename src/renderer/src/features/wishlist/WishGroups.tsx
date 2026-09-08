// wishlist/WishGroups.tsx — THE WISH LIST AS A ROUTE, plus the strip of things you already got
// (JOS-326).
//
// "HERE IS WHERE TO GO AND WHAT TO CAMP." Every wish, grouped by the zone that feeds the most of
// them, so the biggest heading is literally the next trip worth making. This is the Farm rollup's
// drawing half, re-aimed: the grouping arithmetic (primary zone, the "also:" tail, the four
// non-zone headings, the JOS-42 era override) is `plannerFarm.groupNeeds` and is not restated here.
//
// THE ROW SAYS LESS ABOUT A GEAR WISH THAN ABOUT A DONOR WISH, AND THAT IS THE POINT. A donor wish
// names the effect it is wanted for and quotes the merge cost (`costText`, which reads
// `extractionCost`'s own fields and never recomputes them). A gear wish names neither, because
// neither is a fact about it: you want the breastplate, and looting it is the whole job.
//
// THE ERA TOGGLE HIDES ROWS FROM THE ROUTE AND SAYS HOW MANY (the FarmList rule, kept). It is the
// SAME shared toggle the effect browser uses (`useEraOnly`, one `eq.planner.era` key), and it also
// STEERS THE GROUPING: while it is on, a wish is filed under a zone you can actually reach and its
// later-expansion zones drop to the muted "also:" tail chipped with their own expansion. What it
// does NOT do is reach the add control — a wish is allowed to be aspirational (wishSearch.ts's
// header argues that at length).
//
// THE DONE STRIP IS DISMISSED, NOT DELETED. A wish the progress join says is fulfilled leaves the
// route and appears here; Clear files its id under `clearedDone` and it stops rendering anywhere,
// while the entry itself stays in the document. A user who wants the record gone too uses the
// row's own remove, which drops both. Two gestures because they are two different statements.

import { type JSX } from 'react'
import { Box, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { Tooltip } from '../../lib/Tooltip'
import { DonorName, EraChip, MismatchChip, NoSlotChip, StateChip } from '../planner/PlannerChips'
import { classesMismatch } from '../planner/plannerClasses'
import { CURRENT_ERA_LABEL } from '../planner/plannerData'
import { campText, costText, type FarmGroup, type FarmNeed, type FarmRow, type FarmZone } from '../planner/plannerFarm'
import type { ClassAbbr } from '@shared/classCombo'

const KIND_HINT: Record<FarmGroup['kind'], string> = {
  zone: 'Wishes whose best-known camp is in this zone.',
  quest: 'These come from a quest, not a camp.',
  crafted: 'These are made, not dropped.',
  unstated: 'The catalog states no home zone for these.',
  unknown: 'Nothing says where these come from.'
}

/**
 * The "also: …" tail — the item's other camps. A zone from a LATER expansion carries its own
 * expansion name inline, because that is the whole difference between "another place you could
 * camp this" and "another place, once the server opens it". A zone the table cannot place says
 * nothing extra: an unplaceable name is a gap in our tables, not a claim about the game (law 1).
 */
function AlsoZones({ zones }: { zones: readonly FarmZone[] }): JSX.Element {
  return (
    <Typography
      variant="caption"
      noWrap
      data-testid="wishlist-also"
      sx={{ display: 'block', color: 'text.disabled' }}
    >
      also:{' '}
      {zones.map((z, i) => (
        <Box key={z.name} component="span">
          {i > 0 && ', '}
          {z.name}
          {z.outOfEra && (
            <Box component="span" data-testid="wishlist-also-era" sx={{ ml: 0.5, opacity: 0.85 }}>
              ({z.eraLabel})
            </Box>
          )}
        </Box>
      ))}
    </Typography>
  )
}

/** What a row is WANTED FOR — the effect on a donor wish, the honest word `gear` otherwise. */
function WantedFor({ row }: { row: FarmNeed }): JSX.Element {
  return (
    <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
      {row.effect ?? 'gear'}
    </Typography>
  )
}

/** The `from your exaltation plan` label — provenance, and the only thing a seeded row says extra. */
function ImportChip(): JSX.Element {
  return (
    <Chip
      size="small"
      variant="outlined"
      label="from your exaltation plan"
      data-testid="wishlist-import-chip"
      title="Imported once from a socket you had planned on the old Exaltations board. Delete it like any other wish."
      sx={{ height: 18, fontSize: 10, flexShrink: 0, '& .MuiChip-label': { px: 0.6 } }}
    />
  )
}

export interface WishRowProps {
  row: FarmRow
  /** the browse's class filter — a wish outside it is chipped, never dropped (V2's rule) */
  classes: readonly ClassAbbr[]
  /** this row came from the one-time exaltation-plan seed */
  imported: boolean
  onRemove: (itemKey: string) => void
  onOpenLoot?: (item: string) => void
}

function Row({ row, classes, imported, onRemove, onOpenLoot }: WishRowProps): JSX.Element {
  const camp = campText(row)
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid="wishlist-row"
      data-item={row.itemKey}
      sx={{ flexWrap: 'nowrap', py: 0.5, px: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box sx={{ minWidth: 0, flexShrink: 1, width: 260 }}>
        <Typography variant="body2" component="div" noWrap sx={{ minWidth: 0 }}>
          <DonorName name={row.name} bold onOpen={onOpenLoot} />
        </Typography>
        <WantedFor row={row} />
      </Box>

      <Box sx={{ minWidth: 0, flexShrink: 1, width: 240 }}>
        <Typography variant="caption" noWrap sx={{ display: 'block' }}>
          {camp === '' ? '-' : camp}
        </Typography>
        {row.also.length > 0 && <AlsoZones zones={row.also} />}
      </Box>

      {/* Donor-only: the merge tier the effect extracts at, and what getting there costs. */}
      {row.tierRequired !== undefined && (
        <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 1, minWidth: 0 }}>
          {costText(row.tierRequired)}
        </Typography>
      )}
      <Box sx={{ flexGrow: 1, minWidth: 4 }} />
      {imported && <ImportChip />}
      {classesMismatch(row.classes, classes) && <MismatchChip classes={row.classes} />}
      {row.slots.length === 0 && row.effect !== undefined && <NoSlotChip />}
      <EraChip subject={row.subject} />
      <StateChip progress={row.progress} title={stateHint(row)} />
      <Tooltip title="Remove from your wish list">
        <IconButton
          size="small"
          data-testid="wishlist-remove"
          aria-label={`Remove ${row.name}`}
          onClick={() => onRemove(row.itemKey)}
          sx={{ flexShrink: 0 }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}

/**
 * The state chip's hover text, and the ONE place the two kinds of wish need different words.
 *
 * The chip's own vocabulary is the donor one (`PlannerChips.STATE_HINT`): its `ready` says "the log
 * saw this item merged to at least the tier its effect extracts at", which is exactly right for a
 * donor wish and simply not what a gear wish is about. A gear wish overrides it with the sentence
 * that IS its rule; anything else keeps the shared one by returning undefined.
 */
function stateHint(row: FarmNeed): string | undefined {
  if (row.effect !== undefined) return undefined
  const { held, looted } = row.progress
  if (held > 0 || looted > 0) return 'You have one of these - it is off the route.'
  return 'Nothing observed yet - no copy held and none ever looted.'
}

function Group({
  group,
  classes,
  importedKeys,
  onRemove,
  onOpenLoot
}: {
  group: FarmGroup
  classes: readonly ClassAbbr[]
  importedKeys: ReadonlySet<string>
  onRemove: (itemKey: string) => void
  onOpenLoot?: (item: string) => void
}): JSX.Element {
  return (
    <Paper
      variant="outlined"
      data-testid="wishlist-group"
      data-out-of-era={group.zone?.outOfEra === true ? 'true' : 'false'}
      sx={{ mb: 1 }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1, py: 0.75, bgcolor: 'action.hover', flexWrap: 'nowrap' }}
      >
        <Tooltip title={KIND_HINT[group.kind]}>
          <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
            {group.title}
          </Typography>
        </Tooltip>
        {/* Only reachable with the era filter OFF — with it on, a heading is always a zone you can
            go to (JOS-42). Off, the heading is honest about what it is asking of you. */}
        {group.zone?.outOfEra === true && (
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={group.zone.eraLabel}
            sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {group.rows.length} {group.rows.length === 1 ? 'wish' : 'wishes'}
        </Typography>
      </Stack>
      {group.rows.map((row) => (
        <Row
          key={row.id}
          row={row}
          classes={classes}
          imported={importedKeys.has(row.itemKey)}
          onRemove={onRemove}
          onOpenLoot={onOpenLoot}
        />
      ))}
    </Paper>
  )
}

export interface WishGroupsProps {
  groups: readonly FarmGroup[]
  classes: readonly ClassAbbr[]
  importedKeys: ReadonlySet<string>
  onRemove: (itemKey: string) => void
  onOpenLoot?: (item: string) => void
}

/** The zone rollup itself. The empty state is the caller's — only it knows WHY there is nothing. */
export default function WishGroups({
  groups,
  classes,
  importedKeys,
  onRemove,
  onOpenLoot
}: WishGroupsProps): JSX.Element {
  return (
    <>
      {groups.map((group) => (
        <Group
          key={`${group.kind}:${group.title}`}
          group={group}
          classes={classes}
          importedKeys={importedKeys}
          onRemove={onRemove}
          onOpenLoot={onOpenLoot}
        />
      ))}
    </>
  )
}

export interface DoneStripProps {
  rows: readonly FarmNeed[]
  onClear: () => void
  onOpenLoot?: (item: string) => void
}

/**
 * WHAT YOU ALREADY GOT — one quiet strip under the route, and a Clear that means "stop showing me
 * these" rather than "forget I wanted them".
 *
 * It is a strip rather than a group because it is not part of the route: nothing here needs
 * camping, so the zone, the camp line and the merge cost would all be noise. A name, why it is
 * done, and the way out.
 */
export function DoneStrip({ rows, onClear, onOpenLoot }: DoneStripProps): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <Paper variant="outlined" data-testid="wishlist-done" sx={{ mb: 1, borderColor: 'success.main' }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 1, py: 0.75, bgcolor: 'action.hover', flexWrap: 'nowrap' }}
      >
        <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
          Got it
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {rows.length} {rows.length === 1 ? 'wish' : 'wishes'} fulfilled
        </Typography>
        <Tooltip title="Stop showing these. They stay on your list; nothing is deleted.">
          <Chip
            size="small"
            label="Clear"
            data-testid="wishlist-done-clear"
            onClick={onClear}
            sx={{ height: 20, flexShrink: 0 }}
          />
        </Tooltip>
      </Stack>
      {rows.map((row) => (
        <Stack
          key={row.id}
          direction="row"
          spacing={1}
          alignItems="center"
          data-testid="wishlist-done-row"
          data-item={row.itemKey}
          sx={{ flexWrap: 'nowrap', py: 0.5, px: 1, borderBottom: 1, borderColor: 'divider' }}
        >
          <Typography variant="body2" component="div" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
            <DonorName name={row.name} onOpen={onOpenLoot} />
          </Typography>
          <Typography variant="caption" noWrap sx={{ color: 'text.secondary', minWidth: 0, flexShrink: 1 }}>
            {row.effect ?? 'gear'}
          </Typography>
          <Box sx={{ flexGrow: 1, minWidth: 4 }} />
          <StateChip progress={row.progress} title={stateHint(row)} />
        </Stack>
      ))}
    </Paper>
  )
}

/** The era toggle plus what it is holding back — the FarmList bar, re-worded for wishes. */
export function WishEraBar({
  eraOnly,
  setEraOnly,
  hidden,
  outstanding
}: {
  eraOnly: boolean
  setEraOnly: (v: boolean) => void
  hidden: number
  outstanding: number
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', mb: 1 }}>
      <Tooltip title={`Hide wishes whose only known sources are outside ${CURRENT_ERA_LABEL}.`}>
        <Chip
          size="small"
          label="Current era"
          data-testid="wishlist-era-toggle"
          color={eraOnly ? 'primary' : 'default'}
          variant={eraOnly ? 'filled' : 'outlined'}
          onClick={() => setEraOnly(!eraOnly)}
          sx={{ flexShrink: 0 }}
        />
      </Tooltip>
      {/* A filter that can hide a row the user JUST added must say so out loud — the JOS-67 lesson,
          and the reason the add control does not apply this filter at all (wishSearch.ts). */}
      {hidden > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="wishlist-era-hidden"
          sx={{ flexShrink: 0 }}
        >
          {hidden} out of era, hidden
        </Typography>
      )}
      <Box sx={{ flexGrow: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {outstanding} still to find
      </Typography>
    </Stack>
  )
}
