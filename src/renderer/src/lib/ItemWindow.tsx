// ItemWindow.tsx — the EQ Legends ITEM DESCRIPTION WINDOW, in our dark theme.
//
// One renderer for both item surfaces: the posky hover tooltip (compact) and the loot
// detail dialog (full). It reproduces the game window's LAYOUT and COLOR SEMANTICS
// (green name, white flags, magenta effects, red damage ratio, right-aligned saves)
// rather than its chrome, tuned for WCAG AA on our dark background.
//
// Law 1 (never invent) drives every conditional here: a row exists only when the DATA
// exists. Unknown is not empty — an item whose exaltation sockets we've never read shows
// NO socket rows at all, and the tier meter appears only for a name that actually
// carries its item level (` +N`). Within-tier item exp is unobservable (no log line
// reports it), so the meter shows tier position, never a fabricated exp fill.
//
// PROJECTION (full window, `projectable` callers only): a whole-tier slider redraws the block at
// +0..+10 through `shared/itemProjection.ts`, each changed value beside its muted +0 base. The
// meter keeps the item's REAL tier; the slider starts there and the caption says when it differs.
// Only a caller holding the BASE block may opt in: scaling a block that already reads +N applies
// the upgrade twice (the module header says which surfaces hold which).

import { type JSX, useMemo } from 'react'
import { Box, Chip, Stack, Typography } from '@mui/material'
import {
  EFFECT_LABEL,
  expToNextTier,
  itemTierFromName,
  parseStatsBlock,
  statLabel,
  tierBonusPct,
  unlockedExaltationSlots,
  ITEM_MAX_TIER,
  type ItemStat,
  type ItemStatBlock
} from '@shared/itemStats'
import { itemWindowRows, type ItemWindowRow, type ItemWindowRows } from '@shared/itemProjection'
import { ItemProjection, useItemProjection } from './ItemProjection'
import { Tooltip } from './Tooltip'
import { PALETTE } from '../../../shared/palette'

/** Item-window palette. All foregrounds ≥ 7:1 on `bg` (AA at any size, AAA for body). */
export const EQ_ITEM_COLORS = {
  bg: '#0f1017',
  border: '#8a6f24',
  name: '#5fe08a', // item name — green, as in game
  text: '#e9eaf2', // flags + flavor — white
  label: '#a8b0c6', // stat labels — muted
  value: '#e9eaf2',
  effect: '#f08ae0', // effects + filled exaltations — magenta
  ratio: '#ff8079', // damage ratio — red
  projected: '#5fe08a', // a value the projection moved — the green the game paints gains in
  meter: PALETTE.accent
} as const

const MONO = '"Consolas","Courier New",monospace'

/**
 * Item icons come from the app's PERMANENT image cache, never straight off the network.
 *
 * `eqimg://item/<id>` is served by the main process (src/main/imageCache.ts): a disk hit in
 * `<userData>/image-cache/` when we've seen the icon before, otherwise ONE polite fetch of
 * the eqlwiki redirect (`…Special:Redirect/file/Item_<id>.png`) that is then stored forever.
 * Every consumer — hover tooltip, loot dialog, overlay windows — goes through this one
 * function, so they all share the same cache and no window can re-download an icon another
 * one already has. A miss that fails to fetch responds 404 and the `<img onError>` below
 * hides the icon, exactly as a dead https URL used to.
 */
export function itemIconUrl(iconId: number): string {
  return `eqimg://item/${iconId}`
}

/** A projected value's +0 base, muted, ahead of the new value ("15 → 19"; "new +3" when added). */
function BaseMark({ base, added }: { base?: string; added?: boolean }): JSX.Element | null {
  if (base === undefined && !added) return null
  return (
    <Box component="span" sx={{ color: EQ_ITEM_COLORS.label }}>
      {base === undefined ? 'new ' : `${base} → `}
    </Box>
  )
}

function Row({
  label,
  value,
  color,
  compact,
  base,
  added
}: {
  label?: string
  value: string
  color?: string
  compact?: boolean
  base?: string
  added?: boolean
}): JSX.Element {
  const moved = base !== undefined || added === true
  return (
    <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ lineHeight: 1.45 }}>
      {label && (
        <Typography component="span" sx={{ color: EQ_ITEM_COLORS.label, fontSize: compact ? 11 : 12, fontFamily: MONO }}>
          {label}
        </Typography>
      )}
      <Typography
        component="span"
        data-testid={moved ? 'item-projected-value' : undefined}
        sx={{
          color: color ?? (moved ? EQ_ITEM_COLORS.projected : EQ_ITEM_COLORS.value),
          fontSize: compact ? 11 : 12,
          fontFamily: MONO,
          textAlign: 'right',
          whiteSpace: 'nowrap'
        }}
      >
        <BaseMark base={base} added={added} />
        {value}
      </Typography>
    </Stack>
  )
}

function Line({ children, color, compact }: { children: React.ReactNode; color?: string; compact?: boolean }): JSX.Element {
  return (
    <Typography
      component="div"
      sx={{ color: color ?? EQ_ITEM_COLORS.text, fontSize: compact ? 11 : 12, fontFamily: MONO, lineHeight: 1.45 }}
    >
      {children}
    </Typography>
  )
}

/**
 * The tier meter. Rendered ONLY when the item level is KNOWN — either the displayed name
 * carries it (` +N`) or we watched this character merge the item (`observed`). The fill is
 * tier position out of the max tier — the game's own "x / y" within-tier exp is not
 * observable anywhere in the log, so it is never drawn.
 *
 * `observed` flips the header to say WHOSE tier this is: the name in front of you didn't
 * state a level, so the number comes from your own merge history (state, not process — a
 * chip-style tag, no methodology caption).
 */
function TierBlock({
  tier,
  compact,
  observed
}: {
  tier: number
  compact?: boolean
  observed?: boolean
}): JSX.Element {
  const next = expToNextTier(tier)
  const sockets = unlockedExaltationSlots(tier)
  return (
    <Box sx={{ my: 0.75 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography sx={{ color: EQ_ITEM_COLORS.text, fontSize: compact ? 11 : 12, fontFamily: MONO }}>
          Tier {tier}
          <Typography component="span" sx={{ color: EQ_ITEM_COLORS.label, fontSize: 'inherit', fontFamily: MONO }}>
            {' '}
            / {ITEM_MAX_TIER}
            {observed ? ' · yours' : ''}
          </Typography>
        </Typography>
        <Typography sx={{ color: EQ_ITEM_COLORS.label, fontSize: compact ? 10 : 11, fontFamily: MONO }}>
          +{tierBonusPct(tier)}% stats
        </Typography>
      </Stack>
      <Box sx={{ height: 5, bgcolor: 'rgba(255,255,255,0.10)', borderRadius: 1, mt: 0.4 }}>
        <Box
          sx={{
            height: 5,
            width: `${(Math.min(tier, ITEM_MAX_TIER) / ITEM_MAX_TIER) * 100}%`,
            bgcolor: EQ_ITEM_COLORS.meter,
            borderRadius: 1
          }}
        />
      </Box>
      {next !== null && (
        <Typography sx={{ color: EQ_ITEM_COLORS.label, fontSize: compact ? 10 : 11, fontFamily: MONO, mt: 0.3 }}>
          {next} item exp merged reaches Tier {tier + 1}
        </Typography>
      )}
      {!compact && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.6 }}>
          {sockets.map((s) => (
            <Tooltip key={s.type} title={`${s.what} - unlocks at +${s.unlocksAt}`} placement="top">
              <Chip
                size="small"
                variant="outlined"
                label={s.type}
                sx={{
                  height: 18,
                  fontSize: 10,
                  fontFamily: MONO,
                  color: EQ_ITEM_COLORS.label,
                  borderColor: 'rgba(255,255,255,0.18)'
                }}
              />
            </Tooltip>
          ))}
        </Stack>
      )}
    </Box>
  )
}

export interface ItemWindowProps {
  /** display name exactly as observed (keeps its ` +N` item level) */
  name: string
  /** structured stat block; when absent, `rawStats` is parsed on the spot */
  stats?: ItemStatBlock
  /** raw stat-block text (the posky scrape's per-item string) */
  rawStats?: string
  /** wiki icon id, when a lookup supplied one */
  iconId?: number
  /** flavor / lore footer (white, as the game prints it under the stats) */
  flavor?: string
  /** hover-surface density: smaller type, no socket chips, no borders */
  compact?: boolean
  /**
   * The item level THIS character was observed to merge this item to (itemTiers module,
   * Task #60). Used only when `name` itself carries no ` +N` — i.e. when we're looking at
   * the base item and the meter would otherwise be blank. Undefined = never observed, which
   * stays blank: unknown is not tier 0 (law 1).
   */
  observedTier?: number
  /**
   * The caller vouches `stats`/`rawStats` is the BASE (+0) block, so the full window may offer
   * the +N projection. Never set it for a block that is already scaled (a share card's).
   */
  projectable?: boolean
}

/** The window shell: the game's frame, or nothing at all on a compact hover surface. */
function shellSx(compact?: boolean): Record<string, unknown> {
  return {
    fontFamily: MONO,
    bgcolor: compact ? 'transparent' : EQ_ITEM_COLORS.bg,
    border: compact ? 'none' : `1px solid ${EQ_ITEM_COLORS.border}`,
    borderRadius: 1,
    p: compact ? 0.25 : 1.25,
    minWidth: compact ? 190 : 260
  }
}

/** Name (green) + icon. A dead icon URL hides itself; it never leaves a broken-image box. */
function ItemHeader({
  name,
  iconId,
  compact
}: {
  name: string
  iconId?: number
  compact?: boolean
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
      {iconId !== undefined && (
        <Box
          component="img"
          src={itemIconUrl(iconId)}
          alt=""
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none'
          }}
          sx={{ width: compact ? 22 : 32, height: compact ? 22 : 32, imageRendering: 'pixelated', flexShrink: 0 }}
        />
      )}
      <Typography
        component="div"
        sx={{
          color: EQ_ITEM_COLORS.name,
          fontWeight: 700,
          fontSize: compact ? 12.5 : 14,
          fontFamily: MONO,
          lineHeight: 1.25
        }}
      >
        {name}
      </Typography>
    </Stack>
  )
}

/** Flags (white), then class / race / slot — each line exists only when the data does. */
function IdentityLines({
  block,
  compact
}: {
  block?: ItemStatBlock
  compact?: boolean
}): JSX.Element | null {
  if (!block) return null
  return (
    <>
      {block.flags.length > 0 && <Line compact={compact}>{block.flags.join(', ')}</Line>}
      {block.classes && <Line compact={compact}>Class: {block.classes.join(' ')}</Line>}
      {block.races && <Line compact={compact}>Race: {block.races.join(' ')}</Line>}
      {block.slot && <Line compact={compact}>{titleSlot(block.slot)}</Line>}
    </>
  )
}

/** One grid column; each row's `key` is already its label. */
function GridColumn({ rows, compact }: { rows: ItemWindowRow[]; compact?: boolean }): JSX.Element {
  return (
    <Box>
      {rows.map((r) => (
        <Row key={r.key} label={r.key} value={r.value} base={r.base} compact={compact} />
      ))}
    </Box>
  )
}

/** Stat grid: physical | combat, with the damage ratio (red) closing the combat column. */
function StatGrid({ rows, compact }: { rows: ItemWindowRows; compact?: boolean }): JSX.Element | null {
  const { physical, combat, ratio } = rows
  if (physical.length === 0 && combat.length === 0) return null
  return (
    <Box sx={{ mt: 0.75, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2, alignItems: 'start' }}>
      <GridColumn rows={physical} compact={compact} />
      <Box>
        <GridColumn rows={combat} compact={compact} />
        {ratio && (
          <Row label="Ratio" value={ratio.value} base={ratio.base} color={EQ_ITEM_COLORS.ratio} compact={compact} />
        )}
      </Box>
    </Box>
  )
}

/** A two-column key/value grid — used for attributes and, again, for saves. */
function StatPairs({
  rows,
  compact
}: {
  rows: ItemWindowRow[]
  compact?: boolean
}): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <Box sx={{ mt: 0.5, display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 2 }}>
      {rows.map((s, i) => (
        <Row
          key={`${s.key}${String(i)}`}
          label={statLabel(s.key)}
          value={s.value}
          base={s.base}
          added={s.added}
          compact={compact}
        />
      ))}
    </Box>
  )
}

/** Effects (magenta), with any cast/cooldown timing attached underneath. */
function EffectsBlock({
  block,
  timing,
  compact
}: {
  block?: ItemStatBlock
  timing: ItemStat[]
  compact?: boolean
}): JSX.Element | null {
  if (!block || (block.effects.length === 0 && timing.length === 0)) return null
  return (
    <Box sx={{ mt: 0.6 }}>
      {block.effects.map((e, i) => (
        <Line key={`${e.kind}${i}`} color={EQ_ITEM_COLORS.effect} compact={compact}>
          {EFFECT_LABEL[e.kind]}: {e.name}
          {e.reqLevel !== undefined ? ` (Req Level ${e.reqLevel})` : e.detail ? ` (${e.detail})` : ''}
        </Line>
      ))}
      {timing.length > 0 && (
        <Line color={EQ_ITEM_COLORS.label} compact={compact}>
          {timing.map((t) => `${statLabel(t.key)}: ${t.value}`).join('   ')}
        </Line>
      )}
    </Box>
  )
}

/** Exaltation sockets — ONLY those the source actually described. */
function ExaltationBlock({
  block,
  compact
}: {
  block?: ItemStatBlock
  compact?: boolean
}): JSX.Element | null {
  if (!block || block.exaltationSlots.length === 0) return null
  return (
    <Box sx={{ mt: 0.6 }}>
      {block.exaltationSlots.map((s, i) => (
        <Line
          key={`${s.type}${i}`}
          color={s.content ? EQ_ITEM_COLORS.effect : EQ_ITEM_COLORS.label}
          compact={compact}
        >
          {s.content ? '☑' : '☐'} {s.type} Exaltation: {s.content ?? 'empty'}
        </Line>
      ))}
    </Box>
  )
}

/** Anything the parser didn't model, verbatim — never dropped. */
function ExtrasBlock({
  block,
  compact
}: {
  block?: ItemStatBlock
  compact?: boolean
}): JSX.Element | null {
  if (!block || block.extras.length === 0) return null
  return (
    <Box sx={{ mt: 0.6 }}>
      {block.extras.map((x, i) => (
        <Line key={i} compact={compact}>
          {x}
        </Line>
      ))}
    </Box>
  )
}

/**
 * Draw an item the way the game's item description window does. Renders nothing but the
 * name when there's no stat data at all (an honest "we only know the name").
 */
export function ItemWindow({
  name,
  stats,
  rawStats,
  iconId,
  flavor,
  compact,
  observedTier,
  projectable
}: ItemWindowProps): JSX.Element {
  const block = useMemo(() => stats ?? (rawStats ? parseStatsBlock(rawStats) : undefined), [stats, rawStats])
  // The displayed NAME wins when it states a level: that is this exact instance's tier, and
  // it is what the game itself would print. Our observed tier is the fallback for a base
  // name — it answers "what have I got this item to?" where the wiki has nothing to say.
  const nameTier = itemTierFromName(name)
  const tier = nameTier ?? observedTier
  const tierIsObserved = nameTier === undefined && observedTier !== undefined

  const projection = useItemProjection({ name, observedTier, block, allowed: projectable === true && !compact })
  // Cast/cooldown split out for the click effect, attrs and saves paired with their base.
  const rows = useMemo(() => itemWindowRows(block, projection.tier), [block, projection.tier])

  return (
    <Box sx={shellSx(compact)}>
      <ItemHeader name={name} iconId={iconId} compact={compact} />

      <IdentityLines block={block} compact={compact} />

      {/* Item level — only when the name carries it, or we watched this character merge it */}
      {tier !== undefined && <TierBlock tier={tier} compact={compact} observed={tierIsObserved} />}

      {projection.offered && <ItemProjection {...projection} colors={EQ_ITEM_COLORS} />}

      <StatGrid rows={rows} compact={compact} />
      <StatPairs rows={rows.attrs} compact={compact} />
      <StatPairs rows={rows.saves} compact={compact} />

      <EffectsBlock block={block} timing={rows.timing} compact={compact} />
      <ExaltationBlock block={block} compact={compact} />
      <ExtrasBlock block={block} compact={compact} />

      {flavor && (
        <Line compact={compact}>
          <Box component="span" sx={{ display: 'block', mt: 0.6 }}>
            {flavor}
          </Box>
        </Line>
      )}
    </Box>
  )
}

/** "CHEST" → "Chest", "PRIMARY SECONDARY" → "Primary / Secondary" (the game's slot line). */
function titleSlot(slot: string): string {
  return slot
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' / ')
}
