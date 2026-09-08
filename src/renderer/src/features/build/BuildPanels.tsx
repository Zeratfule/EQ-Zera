// The two columns under the gauges (EQ Zera, 2026-09-06): YOUR SET (every cell, what is in it,
// what it is worth under the selected profile, and the swaps being tried) and UPGRADES (per cell,
// the rows that beat what is worn, with where they come from and a Swap in).

import type { JSX } from 'react'
import { Box, Button, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import type { GearRow } from '@shared/planner/gear'
import { planSlotLabel, type PlanSlotId } from '@shared/planner/types'
import { itemScore } from '../../../../shared/build/profiles'
import type { CellUpgrade } from '../../../../shared/build/optimizer'
import { PROFILE_LABEL } from '../../../../shared/build/profiles'
import { FONTS } from '../../../../shared/palette'
import { itemIconUrl } from '../../lib/ItemWindow'
import { BUILD_CELLS, type BuildState } from './useBuild'

const SCORE_SX = { fontFamily: FONTS.mono, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const

function fmt(n: number): string {
  return Math.round(n).toLocaleString()
}

/** Where a row comes from, in one short clause: its first stated drop, or the flag that says. */
export function sourceText(row: GearRow): string {
  const src = row.wikiSources?.[0]
  if (src) return src.zone ? `${src.mob} · ${src.zone}` : src.mob
  if (row.quest) return 'quest reward'
  if (row.playerCrafted) return 'player crafted'
  return 'source not stated'
}

function Icon({ row }: { row: GearRow | null }): JSX.Element | null {
  if (!row?.iconId) return null
  return <img src={itemIconUrl(row.iconId)} alt="" width={20} height={20} style={{ flexShrink: 0, borderRadius: 3 }} />
}

function SetRow({ cell, build, onOpenLoot }: { cell: PlanSlotId; build: BuildState; onOpenLoot: (item: string) => void }): JSX.Element {
  const row = build.set.get(cell) ?? null
  const swapped = build.swaps.has(cell)
  const unknown = build.unknown.find((u) => u.cell === cell)
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.35, minWidth: 0 }} data-testid={`build-cell-${cell}`}>
      <Typography variant="caption" className="eq-display-label" sx={{ width: 84, flexShrink: 0, color: 'text.disabled' }}>
        {planSlotLabel(cell)}
      </Typography>
      <Icon row={row} />
      <Typography
        variant="body2"
        noWrap
        onClick={row ? () => onOpenLoot(row.name) : undefined}
        sx={{ minWidth: 0, flexGrow: 1, cursor: row ? 'pointer' : 'default', color: row ? (swapped ? 'primary.main' : 'text.primary') : 'text.disabled', '&:hover': row ? { textDecoration: 'underline' } : undefined }}
      >
        {row ? row.name : unknown ? `${unknown.name} (not in the item database)` : 'empty'}
      </Typography>
      {swapped && <Chip size="small" label="trying" color="primary" variant="outlined" sx={{ height: 18, fontSize: 9 }} />}
      {row && (
        <Typography variant="caption" sx={{ ...SCORE_SX, color: 'text.secondary' }}>
          {fmt(itemScore(row.stats, build.weights))}
        </Typography>
      )}
      {swapped && (
        <IconButton size="small" aria-label="Undo this swap" onClick={() => build.unswap(cell)} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Stack>
  )
}

export function BuildSetPanel({ build, onOpenLoot }: { build: BuildState; onOpenLoot: (item: string) => void }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, display: 'flex', flexDirection: 'column', minHeight: 0 }} data-testid="build-set">
      <Stack direction="row" alignItems="baseline" spacing={1} className="eq-card-rule" sx={{ pb: 0.5, mb: 0.75 }}>
        <Typography variant="caption" className="eq-display-label" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          Your set · {PROFILE_LABEL[build.profile]} score
        </Typography>
        <Typography variant="caption" sx={{ ...SCORE_SX, color: 'primary.main' }} data-testid="build-score">
          {fmt(build.score.current)} / {fmt(build.score.best)} best
        </Typography>
        {build.swaps.size > 0 && (
          <Button size="small" onClick={build.reset} data-testid="build-reset">
            Reset swaps
          </Button>
        )}
      </Stack>
      <Box sx={{ overflow: 'auto', minHeight: 0 }}>
        {BUILD_CELLS.map((cell) => (
          <SetRow key={cell} cell={cell} build={build} onOpenLoot={onOpenLoot} />
        ))}
      </Box>
      <Typography variant="caption" color="text.disabled" sx={{ mt: 0.75 }}>
        Worn items are scored at the tier your dump states; candidates at their base tier. A two-hander in PRIMARY still shows a SECONDARY cell.
      </Typography>
    </Paper>
  )
}

function UpgradeCell({ up, build, onOpenLoot }: { up: CellUpgrade; build: BuildState; onOpenLoot: (item: string) => void }): JSX.Element {
  return (
    <Box sx={{ mb: 1 }} data-testid={`build-upgrade-${up.cell}`}>
      <Typography variant="caption" className="eq-display-label" sx={{ color: 'text.disabled' }}>
        {planSlotLabel(up.cell)} · {up.current ? up.current.name : 'empty'}
      </Typography>
      {up.options.map((o) => (
        <Stack key={o.row.key} direction="row" spacing={1} alignItems="center" sx={{ py: 0.3, minWidth: 0 }}>
          <Icon row={o.row} />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography
              variant="body2"
              noWrap
              onClick={() => onOpenLoot(o.row.name)}
              sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              {o.row.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {sourceText(o.row)}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ ...SCORE_SX, color: 'success.main' }}>
            +{fmt(o.delta)}
          </Typography>
          <Button size="small" variant="outlined" onClick={() => build.swap(up.cell, o.row)} sx={{ flexShrink: 0 }}>
            Swap in
          </Button>
        </Stack>
      ))}
    </Box>
  )
}

export function BuildUpgradesPanel({ build, onOpenLoot }: { build: BuildState; onOpenLoot: (item: string) => void }): JSX.Element {
  const withOptions: CellUpgrade[] = []
  for (const up of build.upgrades) if (up.options.length > 0) withOptions.push(up)
  return (
    <Paper variant="outlined" sx={{ p: 1.25, display: 'flex', flexDirection: 'column', minHeight: 0 }} data-testid="build-upgrades">
      <Typography variant="caption" className="eq-display-label eq-card-rule" sx={{ display: 'block', color: 'text.secondary', pb: 0.5, mb: 0.75 }}>
        Upgrades for {PROFILE_LABEL[build.profile]} · {withOptions.length} {withOptions.length === 1 ? 'slot' : 'slots'}
      </Typography>
      <Box sx={{ overflow: 'auto', minHeight: 0 }}>
        {withOptions.length === 0 ? (
          <Typography variant="caption" color="text.disabled">
            Nothing in the index beats what you wear under these filters. Turn off in-era or owned-only to widen the search.
          </Typography>
        ) : (
          withOptions.map((up) => <UpgradeCell key={up.cell} up={up} build={build} onOpenLoot={onOpenLoot} />)
        )}
      </Box>
    </Paper>
  )
}
