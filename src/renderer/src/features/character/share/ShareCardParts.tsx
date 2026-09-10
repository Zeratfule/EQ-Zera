// character/share/ShareCardParts — the four blocks the share card is built from.
//
// Split from ShareCard.tsx for the ordinary factoring reason, and they share one rule worth saying
// once: EVERY BLOCK DRAWS FROM `CharacterProfileShare` AND NOTHING ELSE. The card is rendered
// twice by two very different callers — the Share dialog, off your own live sheet, and the viewer,
// off a stranger's decoded string — and the only way those two can be guaranteed to look the same
// is for neither of them to be able to reach anything the wire does not carry.
//
// A GEAR CELL WITH NOTHING IN IT IS STILL DRAWN. The armory grid's law (SlotGrid.tsx): an empty
// slot is the thing you have not equipped, so it renders quiet rather than being omitted, and the
// card is the same twenty-four places on every character. The wire carries only the FILLED cells —
// there is no point spending a share string on absences — so the grid walks `SHEET_SLOTS` and
// looks each one up.

import type { JSX } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { SHEET_SLOTS } from '@shared/characterSheet'
import type { CharacterProfileShare, ShareCell, ShareScores, ShareTotals } from '@shared/characterShare'
import { FONTS, PALETTE, withAlpha } from '../../../../../shared/palette'
import { RACE_OPTIONS } from '../modelPrefs'
import { itemIconUrl } from '../../../lib/ItemWindow'
import { ShareItemTooltip } from './ShareItemTooltip'

/** The Build tab's own four labels and colours, so the card and the tab never drift. */
const SCORES: readonly { key: keyof ShareScores; label: string; color: string }[] = [
  { key: 'tank', label: 'Tank', color: PALETTE.cyan },
  { key: 'dps', label: 'DPS', color: PALETTE.red },
  { key: 'heal', label: 'Healer', color: PALETTE.green },
  { key: 'solo', label: 'Solo', color: PALETTE.accent }
]

// ---------------------------------------------------------------------------------- the figure

/** The race's own name, or the two-letter code when this build has never heard of it. */
function raceLabel(code: string): string {
  return RACE_OPTIONS.find((r) => r.code === code)?.label ?? code
}

/**
 * THE FIGURE, or what can honestly be said instead of one.
 *
 * The snapshot is the last frame the 3D figure drew (`characterModelSnapshot`), pinned as a still
 * image so the card is a picture rather than a scene. There is no snapshot on a machine with no
 * EverQuest install, and there is never one in the VIEWER — a rendered figure is megabytes and a
 * share string is a chat message — so the tile names the look the sharer picked instead of drawing
 * a doll that would be this app's guess at somebody else's character.
 */
export function ShareFigure({ look, image }: { look: CharacterProfileShare['look']; image: string | null }): JSX.Element {
  const words = [raceLabel(look.race), look.sex === 'F' ? 'female' : 'male']
  if (look.face !== undefined) words.push(`face ${String(look.face)}`)
  return (
    <Box
      data-testid="character-share-figure"
      sx={{
        width: 200,
        flexShrink: 0,
        border: '1px solid',
        borderColor: withAlpha(PALETTE.accent, 0.35),
        borderRadius: 1,
        p: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 240,
        alignSelf: 'stretch',
        bgcolor: withAlpha(PALETTE.accent, 0.04)
      }}
    >
      {/* THE FIGURE FILLS THE TILE (owner, 2026-09-10, second report: "still extremely small").
          Scaling the crop by WIDTH let the ground ring, which is wider than the body, decide the
          size, and the body came out at a third of the tile. The image now takes the tile's whole
          height above the caption and covers it: the larger of the two scale factors wins, the
          ring's edges may be trimmed, and the body is as tall as the tile allows. */}
      {image !== null && (
        <Box
          component="img"
          src={image}
          alt=""
          sx={{ display: 'block', width: '100%', flex: '1 1 0', minHeight: 0, objectFit: 'cover', objectPosition: 'center 40%' }}
        />
      )}
      <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.5, textAlign: 'center' }}>
        {words.join(' · ')}
      </Typography>
    </Box>
  )
}

// ------------------------------------------------------------------------------------ the gear

/**
 * THE RANK, AS A BADGE ON THE ICON (owner report, 2026-09-09: *"a lot of the item names don't show
 * what the +X ranks are because item names are too long"*).
 *
 * The cell is one third of a 720px card and an item name is world-supplied text, so the name is
 * ellipsized - which put the ` +5` on the wrong side of the cut for every long name on the card.
 * The rank is the reader's headline number, so it stops riding the string at all: it is drawn from
 * `cell.tier` in the corner of the icon, where nothing can push it out, and the name printed beside
 * it is the BASE name (`cell.base`), which is now shorter by exactly the part that moved.
 */
function RankBadge({ tier }: { tier: number }): JSX.Element {
  return (
    <Box
      data-testid="character-share-rank"
      data-rank={String(tier)}
      sx={{
        position: 'absolute',
        right: -4,
        bottom: -5,
        px: 0.25,
        borderRadius: 0.5,
        border: '1px solid',
        borderColor: withAlpha(PALETTE.accent, 0.7),
        bgcolor: PALETTE.bg,
        color: PALETTE.accent,
        fontSize: 8.5,
        fontWeight: 700,
        lineHeight: 1.3
      }}
    >
      +{tier}
    </Box>
  )
}

function GearCell({ label, cell }: { label: string; cell: ShareCell | undefined }): JSX.Element {
  return (
    <Box
      data-testid="character-share-slot"
      {...(cell ? { 'data-filled': 'true' } : {})}
      sx={{
        display: 'flex',
        flexGrow: 1,
        gap: 0.6,
        alignItems: 'center',
        minWidth: 0,
        border: '1px solid',
        borderColor: cell ? withAlpha(PALETTE.accent, 0.3) : 'divider',
        borderRadius: 0.5,
        px: 0.5,
        py: 0.35
      }}
    >
      <GearIcon cell={cell} />
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography sx={{ fontSize: 8.5, lineHeight: 1.2, color: 'text.disabled' }}>{label}</Typography>
        <Typography
          sx={{
            fontSize: 10.5,
            lineHeight: 1.25,
            color: cell ? PALETTE.text : 'text.disabled',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {/* The base name, with the rank now drawn on the icon - see `RankBadge`. A body that
              carried no base name (a v1 profile, or an item whose name states no rank) prints the
              name it sent, unchanged. */}
          {cell ? (cell.base ?? cell.item) : 'empty'}
        </Typography>
        {cell && <SocketLine cell={cell} />}
      </Box>
    </Box>
  )
}

/** The icon frame, the rank badge in its corner, and a dead icon URL hiding itself. */
function GearIcon({ cell }: { cell: ShareCell | undefined }): JSX.Element {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 22,
        height: 22,
        flexShrink: 0,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 0.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {cell?.tier !== undefined && <RankBadge tier={cell.tier} />}
      {cell?.iconId !== undefined && (
        <Box
          component="img"
          src={itemIconUrl(cell.iconId)}
          alt=""
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none'
          }}
          sx={{ width: 18, height: 18, imageRendering: 'pixelated' }}
        />
      )}
    </Box>
  )
}

/** How many exaltations are socketed into this item, and whether one of them is its look. */
function SocketLine({ cell }: { cell: ShareCell }): JSX.Element | null {
  if (cell.exaltations.length === 0) return null
  return (
    <Typography sx={{ fontSize: 8.5, lineHeight: 1.3, color: PALETTE.magenta }}>
      {cell.exaltations.length} exaltation{cell.exaltations.length === 1 ? '' : 's'}
      {cell.ornament !== undefined ? ' · ornamented' : ''}
    </Typography>
  )
}

/**
 * One place on the card: the cell, and - when something is worn in it - the item window behind it.
 *
 * THE CARD IS STILL A PICTURE. Its header says nothing inside it is a hover surface, and the
 * reason was that an affordance would be a dead pixel in the photograph. A tooltip is the one
 * shape that does not break that: it draws nothing until the pointer stops, the capture is taken
 * from a button OUTSIDE the card, and the photographed pixels are byte-identical to what they were.
 * What it buys is the owner's ask - the reader of a share link can finally ask what a piece of gear
 * does - and it is the same wrapper on both callers, so the dialog and the viewer stay identical.
 */
function GearSlot({ slot, label, cell }: { slot: string; label: string; cell: ShareCell | undefined }): JSX.Element {
  const box = (
    <Box data-testid={`share-cell-${slot}`} sx={{ display: 'flex', minWidth: 0 }}>
      <GearCell label={label} cell={cell} />
    </Box>
  )
  return cell ? <ShareItemTooltip cell={cell}>{box}</ShareItemTooltip> : box
}

/**
 * The twenty-four places, three columns across the card. Keyed on the sheet's own slot ids, so the
 * order is the armory's order on both sides of a share.
 */
export function ShareGearGrid({ cells }: { cells: readonly ShareCell[] }): JSX.Element {
  const bySlot = new Map<string, ShareCell>()
  for (const cell of cells) bySlot.set(cell.slot, cell)
  return (
    <Box
      data-testid="character-share-grid"
      sx={{ flexGrow: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5 }}
    >
      {SHEET_SLOTS.map((slot) => (
        <GearSlot key={slot.id} slot={slot.id} label={slot.label} cell={bySlot.get(slot.id)} />
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------------------------- the totals

const signed = (n: number): string => (n > 0 ? `+${String(n)}` : String(n))

/**
 * What the gear adds up to, on one line. The same scope line the sheet's panel carries ("from
 * gear"), because the number means the same thing here and a card that dropped the qualifier would
 * be claiming a character's real AC.
 */
export function ShareTotalsRow({ totals }: { totals: ShareTotals }): JSX.Element {
  const parts: string[] = [`AC ${String(totals.ac)}`]
  for (const stat of totals.stats) parts.push(`${stat.label} ${signed(stat.total)}`)
  for (const save of totals.saves) parts.push(`${save.label} ${signed(save.total)}`)
  for (const row of totals.unsummed) parts.push(`${row.label} ${row.values.join(' ')}`)
  return (
    <Box data-testid="character-share-totals" sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 0.75 }}>
      <Typography variant="caption" className="eq-display-label" sx={{ color: 'text.secondary', display: 'block' }}>
        Stats from gear, with +N
      </Typography>
      <Typography sx={{ fontSize: 10.5, lineHeight: 1.5, color: PALETTE.text }}>{parts.join('  ·  ')}</Typography>
      <Typography sx={{ fontSize: 9.5, color: 'text.disabled' }}>
        {totals.counted} of {totals.counted + totals.unknown} worn items
        {totals.unknown > 0 ? ` · ${String(totals.unknown)} not in the item database` : ''}
      </Typography>
    </Box>
  )
}

// ---------------------------------------------------------------------------------- the scores

function ScoreTile({ label, value, color }: { label: string; value: number; color: string }): JSX.Element {
  return (
    <Box
      data-testid="character-share-score"
      data-score={String(value)}
      sx={{ flex: 1, minWidth: 0, border: '1px solid', borderColor: withAlpha(color, 0.5), borderRadius: 1, p: 0.75 }}
    >
      <Typography variant="caption" className="eq-display-label" sx={{ color: 'text.secondary', display: 'block' }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: FONTS.mono, fontSize: 22, lineHeight: 1, color }}>{value}%</Typography>
      <Box sx={{ mt: 0.5, height: 5, borderRadius: 3, bgcolor: withAlpha(color, 0.15) }}>
        <Box sx={{ width: `${String(value)}%`, height: '100%', borderRadius: 3, bgcolor: color }} />
      </Box>
    </Box>
  )
}

/**
 * The four meters — or the one sentence that replaces them.
 *
 * A profile with no `scores` is a profile whose Build tab had no reading to give (no dump loaded,
 * no gear index): four bars at zero would be a claim, and law 1 forbids inventing one. So the
 * absence is drawn as an absence and says what would fix it.
 */
export function ShareScoreRow({ scores }: { scores: ShareScores | undefined }): JSX.Element {
  if (!scores) {
    return (
      <Typography
        variant="caption"
        color="text.disabled"
        data-testid="character-share-no-scores"
        sx={{ display: 'block' }}
      >
        No gear scores in this profile - the Build tab had nothing to measure them against.
      </Typography>
    )
  }
  return (
    <Stack direction="row" spacing={0.75} data-testid="character-share-scores">
      {SCORES.map((s) => (
        <ScoreTile key={s.key} label={s.label} value={scores[s.key]} color={s.color} />
      ))}
    </Stack>
  )
}
