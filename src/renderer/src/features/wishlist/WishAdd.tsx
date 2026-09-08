// wishlist/WishAdd.tsx — THE ONE ADD CONTROL (JOS-326).
//
// One button, one search box, one result list — and the list is the WHOLE corpus: gear rows and
// donor rows together, each row saying which it is. `wishSearch.ts` owns the union and the
// ranking; this file draws it and takes the click.
//
// A POPOVER, THE `ItemFilterPicker` PRECEDENT. The wish list's own toolbar already carries a search
// box over the wishes and an era toggle, and a second always-present text input beside them would
// read as two searches with no way to tell which one you were in. The button says what it does,
// and the search that opens is unambiguously the corpus one.
//
// SEARCHED IN THE RENDERER, NOT OVER IPC — the difference from the picker above. That one asks
// main's item index (`plannerSearchItems`) because the Board needed HOST candidates and main is
// where the 8.6 MB corpus lives. Both indices this searches are ALREADY IN THE RENDERER: the gear
// index and the donor corpus are each fetched once per window and cached (gearData.ts,
// plannerData.ts), so a keystroke is a linear scan over arrays that are already here rather than a
// structured-clone round trip. The standing search law applies as usual — the input echoes
// instantly and the FILTER runs on the deferred value.
//
// AN ALREADY-WISHED ROW SAYS SO AND STAYS UNCLICKABLE, rather than accepting a click that the
// model would dedupe into nothing. The list dedupes by item, so an item's gear row and its donor
// rows all go quiet together once any one of them has been taken — which is correct: the wish is
// for the ITEM, and it is already on the list.
//
// The list is a FIXED-height scroll box for the standing reason (AGENTS.md UI conventions): a
// popover that grows with its hit count walks off the screen.

import { type JSX, useDeferredValue, useMemo, useState } from 'react'
import { Box, Button, Chip, Popover, Stack, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import type { GearRow } from '@shared/planner/gear'
import { itemIconUrl } from '../../lib/ItemWindow'
import { EraChip } from '../planner/PlannerChips'
import type { DonorRow } from '../planner/plannerData'
import { MIN_WISH_QUERY, searchWishCorpus, type WishHit } from './wishSearch'

const LIST_MAX_H = 300

/** The kind chip — the one thing every row in a two-index result list has to state. */
function KindChip({ kind }: { kind: WishHit['kind'] }): JSX.Element {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={kind === 'donor' ? 'secondary' : 'default'}
      label={kind}
      data-testid="wishlist-hit-kind"
      data-kind={kind}
      title={
        kind === 'donor'
          ? 'An item wanted for the exaltation effect it carries'
          : 'An item wanted to wear'
      }
      sx={{ height: 18, fontSize: 10, flexShrink: 0, '& .MuiChip-label': { px: 0.6 } }}
    />
  )
}

function HitRow({
  hit,
  wished,
  onPick
}: {
  hit: WishHit
  wished: boolean
  onPick: (hit: WishHit) => void
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid="wishlist-hit"
      data-kind={hit.kind}
      onClick={wished ? undefined : () => onPick(hit)}
      sx={{
        px: 1,
        py: 0.5,
        flexWrap: 'nowrap',
        opacity: wished ? 0.55 : 1,
        cursor: wished ? 'default' : 'pointer',
        ...(wished ? {} : { '&:hover': { bgcolor: 'action.hover' } })
      }}
    >
      {hit.iconId !== undefined && (
        <Box
          component="img"
          src={itemIconUrl(hit.iconId)}
          alt=""
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none'
          }}
          sx={{ width: 20, height: 20, imageRendering: 'pixelated', flexShrink: 0 }}
        />
      )}
      <Box sx={{ minWidth: 0, flexShrink: 1 }}>
        <Typography variant="body2" noWrap title={hit.name}>
          {hit.name}
        </Typography>
        {hit.effect !== undefined && (
          <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
            {hit.effect}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 4 }} />
      <EraChip subject={hit} />
      <KindChip kind={hit.kind} />
      {wished && (
        <Chip
          size="small"
          color="success"
          variant="outlined"
          label="wished"
          sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
        />
      )}
    </Stack>
  )
}

/** Why the list is empty, in the words of whichever reason applies. Never a bare "no results". */
function emptyLine(text: string, ready: boolean): string {
  if (text.trim().length < MIN_WISH_QUERY) return 'Type at least two letters to search every item and effect.'
  if (!ready) return 'Reading the item database…'
  return 'Nothing in the item database matches that.'
}

export interface WishAddProps {
  gear: readonly GearRow[]
  donors: readonly DonorRow[]
  /** false until BOTH indices have settled — an empty result before that is not an answer */
  ready: boolean
  /** the item keys already on the list */
  wished: ReadonlySet<string>
  onPick: (hit: WishHit) => void
}

export default function WishAdd({ gear, donors, ready, wished, onPick }: WishAddProps): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [text, setText] = useState('')
  // The standing search law: the input echoes instantly, the scan runs on the deferred value.
  const query = useDeferredValue(text)
  const hits = useMemo(
    () => (anchor === null ? [] : searchWishCorpus(gear, donors, query)),
    [anchor, gear, donors, query]
  )

  return (
    <>
      <Button
        size="small"
        variant="contained"
        startIcon={<AddIcon />}
        data-testid="wishlist-add-open"
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ flexShrink: 0 }}
      >
        Add a wish
      </Button>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 420 } } }}
      >
        <Box sx={{ p: 1 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Search every item and effect"
            value={text}
            data-testid="wishlist-add-search"
            onChange={(e) => setText(e.target.value)}
          />
        </Box>
        <Box
          data-testid="wishlist-add-hits"
          sx={{ maxHeight: LIST_MAX_H, overflow: 'auto', borderTop: 1, borderColor: 'divider' }}
        >
          {hits.map((hit) => (
            <HitRow
              key={`${hit.kind}:${hit.key}:${hit.effect ?? ''}`}
              hit={hit}
              wished={wished.has(hit.key)}
              onPick={(picked) => {
                onPick(picked)
                setAnchor(null)
              }}
            />
          ))}
          {hits.length === 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="wishlist-add-empty"
              sx={{ display: 'block', p: 1.5 }}
            >
              {emptyLine(text, ready)}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  )
}
