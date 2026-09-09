// character/share/ShareItemTooltip — the item window behind a cell of a SHARED profile.
//
// The owner's report (2026-09-09): a share card names an item and states a set total, and there
// was nothing in between - no way to hover a slot and see what that piece of gear actually does,
// on your own card or on somebody else's link. This is that hover.
//
// ---------------------------------------------------------------------------
// IT READS THE BODY, AND ONLY THE BODY
// ---------------------------------------------------------------------------
// `KnownItemTooltip` — the app's item hover everywhere else — ANSWERS FROM THIS MACHINE: it calls
// `window.eq.lookupItem`, which reads the committed corpus, a userData cache and a wiki fallback.
// That is exactly right for your own gear and exactly wrong here. A shared profile is somebody
// else's character, frequently carrying items this install has never looked up, and a card that
// quietly filled its gaps from the local database would be showing a reader something the sharer
// never sent. So every line below comes out of `ShareCell` (shared/characterShareItem.ts) and
// nothing here fetches anything: what the sharer's body says is what the reader sees, and an item
// the sharer's OWN database did not know says so out loud (`known:false`) instead of drawing blank.
//
// THE DRAWING IS `ItemWindow`, the same EQ-style window the rest of the app opens, because a
// second opinion about how an item window looks is how two surfaces drift. It takes an
// `ItemStatBlock`, so the wire's flat fields are folded back into one — the fold is small, it is
// the only place the two shapes meet, and it is why the wire could stay flat (a page that is not
// this app has to render the same body without a parser).
//
// NOT A CAVEAT, AN ITEM WINDOW. The tooltip diet (AGENTS.md, UI conventions) rules out footnotes
// about where a number came from; the item window is the sanctioned exception it already grants
// `KnownItemTooltip`, and this is that same card with a smaller source of truth.

import type { JSX, ReactElement } from 'react'
import { Box, Typography } from '@mui/material'
import type { ShareCell } from '@shared/characterShare'
import type { ItemStat, ItemStatBlock } from '@shared/itemStats'
import { PALETTE } from '../../../../../shared/palette'
import { EQ_ITEM_COLORS, ItemWindow } from '../../../lib/ItemWindow'
import { Tooltip } from '../../../lib/Tooltip'

/** An integer as the item window spells it: a gain carries its sign. */
const signed = (n: number): string => (n > 0 ? `+${String(n)}` : String(n))

/** The three keys that travel as fields, back in the order an item page prints them. */
function fieldRows(cell: ShareCell): ItemStat[] {
  const rows: ItemStat[] = []
  if (cell.hp !== undefined) rows.push({ key: 'HP', value: signed(cell.hp) })
  if (cell.mana !== undefined) rows.push({ key: 'MANA', value: signed(cell.mana) })
  if (cell.endurance !== undefined) rows.push({ key: 'END', value: signed(cell.endurance) })
  return rows
}

/**
 * The wire's flat item facts -> the block `ItemWindow` draws.
 *
 * The save/stat split is by KEY, the same test `parseStatsBlock` applies (`SV *` is the subset the
 * game right-aligns), so a shared item's window lays out like every other item window in the app.
 */
function blockOf(cell: ShareCell): ItemStatBlock {
  const block: ItemStatBlock = {
    flags: [...(cell.flags ?? [])],
    stats: fieldRows(cell),
    saves: [],
    effects: [],
    exaltationSlots: [],
    extras: []
  }
  if (cell.ac !== undefined) block.ac = cell.ac
  for (const line of cell.stats ?? []) {
    const row: ItemStat = { key: line.key, value: line.value }
    if (line.key.toUpperCase().startsWith('SV ')) block.saves.push(row)
    else block.stats.push(row)
  }
  for (const effect of cell.effects ?? []) {
    block.effects.push({
      kind: effect.kind,
      name: effect.name,
      ...(effect.detail === undefined ? {} : { detail: effect.detail })
    })
  }
  applyWeapon(block, cell)
  return block
}

/** The three weapon numbers, when the body sent them. Its own function for the factoring bar. */
function applyWeapon(block: ItemStatBlock, cell: ShareCell): void {
  const weapon = cell.weapon
  if (!weapon) return
  if (weapon.dmg !== undefined) block.dmg = weapon.dmg
  if (weapon.delay !== undefined) block.atkDelay = weapon.delay
  if (weapon.skill !== undefined) block.skill = weapon.skill
}

/** What is socketed into this item, as the sharer's client named it. */
function SocketLines({ cell }: { cell: ShareCell }): JSX.Element | null {
  if (cell.exaltations.length === 0 && cell.ornament === undefined) return null
  return (
    <Box sx={{ mt: 0.5 }}>
      {cell.exaltations.map((name, i) => (
        <Typography
          // The same exaltation can be socketed twice into one item, so the position is the key.
          key={`${name}#${String(i)}`}
          sx={{ fontSize: 11, lineHeight: 1.4, color: PALETTE.magenta }}
        >
          Exaltation: {name}
        </Typography>
      ))}
      {cell.ornament !== undefined && (
        <Typography sx={{ fontSize: 11, lineHeight: 1.4, color: EQ_ITEM_COLORS.name }}>
          Ornamented as {cell.ornament}
        </Typography>
      )}
    </Box>
  )
}

/**
 * The card itself. Rendered inside a MUI tooltip's `title`, which mounts only while the tooltip is
 * open - so twenty-four of these cost nothing until one is hovered.
 */
export function ShareItemCard({ cell }: { cell: ShareCell }): JSX.Element {
  return (
    <Box data-testid="share-cell-tooltip" sx={{ maxWidth: 340 }}>
      <ItemWindow
        name={cell.item}
        stats={blockOf(cell)}
        {...(cell.iconId === undefined ? {} : { iconId: cell.iconId })}
        compact
      />
      <SocketLines cell={cell} />
      {!cell.known && (
        <Typography
          data-testid="share-cell-unknown"
          sx={{ fontSize: 11, lineHeight: 1.4, mt: 0.5, color: 'text.disabled' }}
        >
          Not in the item database, so this profile carries the name alone.
        </Typography>
      )}
    </Box>
  )
}

/**
 * The popper's surface: the game's own frame, the same one `KnownItemTooltip` draws its card on,
 * so a shared item and one of your own look identical when they are side by side.
 */
const CARD_SLOTS = {
  tooltip: {
    sx: {
      bgcolor: EQ_ITEM_COLORS.bg,
      border: `1px solid ${EQ_ITEM_COLORS.border}`,
      borderRadius: 1,
      maxWidth: 380,
      p: 1,
      boxShadow: 6
    }
  }
} as const

/** One cell of a shared profile's grid, with its item window behind it. */
export function ShareItemTooltip({
  cell,
  children
}: {
  cell: ShareCell
  children: ReactElement
}): JSX.Element {
  return (
    <Tooltip
      title={<ShareItemCard cell={cell} />}
      placement="top"
      enterDelay={150}
      disableInteractive
      slotProps={CARD_SLOTS}
    >
      {children}
    </Tooltip>
  )
}
