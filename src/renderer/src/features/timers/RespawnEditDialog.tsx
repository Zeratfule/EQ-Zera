// THE RESPAWN EDIT MODAL (JOS-194, owner ruling round 9) — where the number gets overruled.
//
// WHY A MODAL AND NOT A FIELD. Round 7 put a bare `sec` box on the clock row, which was the right
// PLACE and the wrong SHAPE: it asked the player to know the app wanted seconds, to convert "about
// 44 minutes" into 2640 in their head, and to decide whether they knew better than the fold while
// looking at none of the fold's evidence. This is the first surface in the feature with room to put
// the evidence and the decision in front of each other, so it holds all of it:
//
//   1. THE HOVER CARD ITSELF — the same `MobCard` the row's tooltip draws, not a re-statement of it.
//      It carries the mob, its drop table with your own loot counts, the round-5 provenance
//      sentence, EVERY gap the fold measured (round 9 added those lines to the card, so the hover
//      grew them at the same time) and what the wiki said in the wiki's own words.
//   2. THE WIKI LINK. Quoting a source the reader cannot open is half of provenance. The title comes
//      from the committed floor (`RespawnRow.wikiPage`, which the scrape has always carried) and,
//      where the floor has no row for this mob, from the mob knowledge the card is already fetching
//      — one lookup, two readers. `wikiPageUrl` is the ONE place a title becomes a URL, and the link
//      opens in the SYSTEM BROWSER: `target="_blank"` is turned into `shell.openExternal` by main's
//      `setWindowOpenHandler`, against the allowlist in security.ts. Never an app window.
//   3. THE NUMBER, prefilled with the duration currently in force and written the way the field
//      accepts it (`formatRespawnDuration`), so opening the modal, changing nothing and saving
//      cannot move the clock. The grammar is `parseRespawnDuration`'s, stated in its header and
//      summarised in one caption here; what it refuses it refuses out loud rather than half-reading.
//   4. THE WAY BACK. Clear/revert states the calculated number BEFORE you press it (`respawnCalculated`
//      re-runs the ladder with rung 1 removed), because a revert whose result you cannot see is a
//      dare rather than a control.
//
// IT IS TAB-ONLY, and that is the round-7 card ruling applied one size up: a 300px window over the
// game cannot afford a 300px card, and it can afford a modal even less. The floating window shows
// the OVERRIDDEN state (it is a fact about the clock it is drawing) and carries no way to edit it.
//
// THE WRITE IS THE ONE THAT ALREADY EXISTED. Saving calls the same `onSetCustom` the retired seconds
// box called, which lands on `setRespawn` → normalize → module → `flushNow` — so rung 1, the module
// revision and the persistence are untouched by this round, exactly as the brief said they would be.

import { type JSX, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import {
  RESPAWN_INPUT_HELP,
  RESPAWN_INPUT_RANGE,
  RESPAWN_INPUT_UNREADABLE,
  formatRespawnDuration,
  parseRespawnDuration,
  respawnCalculated,
  respawnCardNote,
  respawnDurationText,
  respawnOverridden,
  respawnSourceLabel,
  type RespawnRow
} from '@shared/respawn'
import { wikiPageUrl } from '@shared/wiki'
import { MobCard, useMobKnowledge } from '../../lib/hoverCards'
import { fmtDuration } from '../buffs/format'
import { mainMobLookup } from './mobLookup'

/** What the field opens with: the duration in force, in the shorthand the field itself accepts. */
function prefillOf(row: RespawnRow): string {
  return row.estimateMs === undefined ? '' : formatRespawnDuration(Math.round(row.estimateMs / 1000))
}

/**
 * WHAT THE TYPED TEXT MEANS RIGHT NOW, under the field. It is a reading rather than a validation
 * pass: the field says what it understood while you type, so a refusal is discovered before Save
 * rather than by pressing it.
 */
function ParseLine({ text }: { text: string }): JSX.Element {
  const parsed = parseRespawnDuration(text)
  if (parsed.ok) {
    return (
      <Typography variant="caption" color="success.main" data-testid="respawn-edit-reading">
        = {fmtDuration(parsed.sec * 1000)}
      </Typography>
    )
  }
  if (parsed.reason === 'empty') {
    return (
      <Typography variant="caption" color="text.secondary" data-testid="respawn-edit-reading">
        {RESPAWN_INPUT_HELP}
      </Typography>
    )
  }
  return (
    <Typography variant="caption" color="error.main" data-testid="respawn-edit-error">
      {parsed.reason === 'range' ? RESPAWN_INPUT_RANGE : RESPAWN_INPUT_UNREADABLE}
    </Typography>
  )
}

/**
 * THE SOURCE, WITH A DOOR TO IT. The wiki's own words are already on the card above; what this adds
 * is the page they came from, as a link the OS opens.
 *
 * A mob the wiki says nothing about (85 % of what you kill in the dungeons this ticket targets) says
 * so and offers whatever page the lookup did resolve, if any — "no respawn stated" and "no page at
 * all" are different facts and this states which one it is (law 1).
 */
function WikiLine({ row, page }: { row: RespawnRow; page?: string }): JSX.Element {
  const url = wikiPageUrl(page)
  return (
    <Typography variant="caption" color="text.secondary" data-testid="respawn-edit-wiki">
      {row.wikiText === undefined ? 'The wiki states no respawn for this mob.' : `The wiki says "${row.wikiText}".`}
      {url !== undefined && (
        <>
          {' '}
          <Link href={url} target="_blank" rel="noreferrer" data-testid="respawn-edit-wiki-link">
            eqlwiki.com
          </Link>
        </>
      )}
    </Typography>
  )
}

/** The calculated number the clear control returns to, stated before it is pressed. */
function CalculatedLine({ row }: { row: RespawnRow }): JSX.Element {
  const calc = respawnCalculated(row)
  return (
    <Typography variant="caption" color="text.secondary" data-testid="respawn-edit-calculated">
      Calculated: {respawnDurationText(calc, fmtDuration)} · {respawnSourceLabel(calc)}
    </Typography>
  )
}

export function RespawnEditDialog({
  row,
  open,
  onClose,
  onSetCustom
}: {
  row: RespawnRow
  open: boolean
  onClose: () => void
  onSetCustom: (key: string, display: string, sec?: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(() => prefillOf(row))
  // RE-PREFILL ON EACH OPENING, and never while it is open. The row underneath re-renders once a
  // second forever (it is a countdown) and its estimate can move under a delta, so a field that
  // followed the row would fight anybody halfway through typing — the same reason the retired
  // seconds box owned its draft. `open` is the only dependency for exactly that reason.
  useEffect(() => {
    if (open) setDraft(prefillOf(row))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the row is read at OPEN.
  }, [open])

  const parsed = parseRespawnDuration(draft)
  // The knowledge the card is fetching anyway, read here for one field: the page to link to when the
  // committed floor has no row for this mob.
  const { data } = useMobKnowledge(row.display, mainMobLookup)

  const save = (): void => {
    if (!parsed.ok) return
    onSetCustom(row.key, row.display, parsed.sec)
    onClose()
  }
  const clear = (): void => {
    onSetCustom(row.key, row.display, undefined)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-testid="respawn-edit-dialog">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="subtitle1" component="div">
          {row.display}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {row.zone.length > 0 ? row.zone : 'unknown zone'} · {respawnDurationText(row, fmtDuration)} ·{' '}
          {respawnSourceLabel(row)}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          {/* THE HOVER CARD ITSELF — same component, same lookup door, same note (which since round
              9 carries every measured gap and the wiki default as lines of its own). */}
          <Box>
            <MobCard mob={row.display} note={respawnCardNote(row, fmtDuration)} lookup={mainMobLookup} />
          </Box>
          <WikiLine row={row} page={row.wikiPage ?? data?.page} />
          <CalculatedLine row={row} />
          <Box>
            <TextField
              size="small"
              fullWidth
              autoFocus
              label="Respawn"
              value={draft}
              data-testid="respawn-edit-input"
              onChange={(e) => {
                setDraft(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
            />
            <Box sx={{ mt: 0.5 }}>
              <ParseLine text={draft} />
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        {/* THE WAY BACK, and only where there is something to go back FROM: a row the user has not
            overruled has no override to clear, and a control that can only be a no-op is noise. */}
        {respawnOverridden(row) && (
          <Button size="small" color="inherit" data-testid="respawn-edit-clear" onClick={clear}>
            Use calculated
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" data-testid="respawn-edit-cancel" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" disabled={!parsed.ok} data-testid="respawn-edit-save" onClick={save}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
