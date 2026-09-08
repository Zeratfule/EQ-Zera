// One respawn clock, drawn (JOS-194). Used by the Timers tab; the floating overlay draws the same
// facts with plain divs because that bundle is MUI-free, and both surfaces take the clock's
// WORDING and the provenance line from `shared/respawn.ts` rather than spelling either twice.
//
// WHAT THE ROW IS CAREFUL ABOUT. It never says the mob is up FROM A CLOCK. `due` means the estimate
// elapsed, the label says "due" and not "spawned", and the provenance line under the name states
// which rung of the ladder produced the number and how thin the evidence is ("your kills (2 gaps)").
// A countdown with no provenance is a countdown the user has to trust blindly, and the whole
// argument of this feature is that the number the wiki would have given them does not deserve
// that (shared/respawnWiki.ts).
//
// AND IT SAYS ALL OF THAT IN LABELS (owner ruling, round 5: too much explanatory text). Rounds 1-4
// each left a sentence behind on this row — what a gap proves, what the floor did, what a sighting
// does not prove — until the row was three lines of prose under a countdown. Every one of those
// facts now lives on the HOVER (`respawnProvenance`, in shared/respawn.ts so the floating window's
// native title is the same string) and the row itself prints only state: the name, the number, the
// rung, the zone, and the age of any sighting.
//
// THE ONE PLACE IT DOES SAY UP IS WHEN THE LOG SAID SO (owner ruling, round 3). A row whose mob has
// been named by a parsed event since its clock started reads UP, in a colour used nowhere else on
// this surface, with the age of that evidence and the family of line that carried it printed
// underneath. That is not the clock changing its mind — the countdown, the bar and the provenance
// are all still there — it is the row leading with the fact instead of the estimate.
//
// AND THE RE-BASE IS A BUTTON, NEVER A RULE. A sighting proves the mob is up and says nothing about
// when it spawned, so nothing here moves the clock on its own. The button appears only on a seen
// row, says what it will do, and is the only path to `basis: 'sighting'` — which the row then
// states out loud, because a number resting on the user's judgement must never look like one
// resting on a line the game printed.
//
// AND THE HOVER IS NOW THE MOB'S CARD (owner ruling, round 6). A countdown says when; the question
// a player standing on a spawn point is asking is whether to keep standing there, which is a
// question about loot. So pointing at a row reveals the SAME card the `/con` hover has always
// drawn — the wiki drop table with your own loot counts riding on it, and anything only your
// history knows underneath — with round 5's provenance sentence as its leading block. No second
// drops source, no second card, and the sentence is still the one string both surfaces read.
//
// AND THE ROW CARRIES ITS OWN WAY OUT (owner ruling, round 4). Every row here is a mob the user
// asked for by name, so the question "do I still want this clock" is asked AT the clock — not by
// scrolling to a list at the bottom of the page and matching a name against it, which is where the
// only unwatch used to live. It is the same control the Recently-killed entry offers, so the mob
// reads the same wherever you meet it.
//
// AND ROUND 7 FINISHED THAT MOVE. "Your watches" — the list at the bottom of the tab that round 4
// left standing — is gone, so the OTHER thing it held came here too: rung 1 of the ladder, the
// number that outranks everything this app learned. It is on the row because that is where the
// player is standing when they decide the number is wrong.
//
// AND ROUND 9 CHANGED ITS SHAPE (owner ruling — this SUPERSEDES round 7's bare seconds box, which is
// deleted rather than hidden). Three things happened to this row and they are one idea:
//
//   * THE DURATION AND ITS SOURCE ARE ONE THING. They used to sit at opposite ends of the same line,
//     which reads as two facts sharing a row rather than as a fact and its provenance. They are now
//     one bordered unit — `respawnDurationText` and `respawnSourceLabel` inside one box — so a
//     glance reads "9m 30s, from the wiki".
//   * THE EDIT AFFORDANCE IS ATTACHED TO THAT UNIT, because it edits that unit and nothing else, and
//     it is an ICON: a text field on a 30px countdown row was the whole of what was wrong with the
//     seconds box. It opens `RespawnEditDialog`, which is where the evidence and the decision finally
//     meet.
//   * AN OVERRULED ROW IS IN A STATE. `respawnOverridden` is the one definition (`source === 'custom'`)
//     and this surface paints it in the theme's accent on that same unit — so a camp's worth of clocks
//     tells you at a glance which numbers are yours. The floating window paints the same state in its
//     own palette and carries none of the editing.
//
// AND THE ROW EXISTS EVEN WHEN THE CLOCK IS LONG GONE (owner ruling, round 8). A watched mob always
// has a row, so this component now draws one whose estimate elapsed hours ago — and it must not do
// that by shouting. A STALE row says the honest thing instead of a number that grows forever
// (`respawnClockLabel`: "due long ago", or "awaiting next death" where there was never an estimate),
// drops the progress bar because there is no estimate left running to draw, and goes grey so the
// clock actually ticking in front of you is still the loudest thing on the page. Everything else on
// it is unchanged: the hover, the gaps, the seconds box and Unwatch are all still there, because the
// row is still a mob the user is watching.
//
// AND THE ROW SHOWS ITS WORKING. Under the countdown it now prints the GAPS this fold measured for
// this mob in this zone — the samples `<= 3m 00s` is the minimum of — newest first. They are not a
// new claim and not a new source: the same numbers, un-minimised, said plainly, so "where did that
// estimate come from" is answerable without opening the hover. What they are NOT is spawns
// observed; see `respawnGapsLabel` in shared/respawn.ts for why that wording is load-bearing.

import { Box, Button, IconButton, LinearProgress, Stack, Typography } from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import { useState, type JSX } from 'react'
import {
  RESPAWN_CONFIRM_TITLE,
  respawnBasisLabel,
  respawnCardNote,
  respawnClockLabel,
  respawnDurationText,
  respawnGapsLabel,
  respawnOverridden,
  respawnReading,
  respawnSeenLabel,
  respawnSourceLabel,
  type RespawnReading,
  type RespawnRow
} from '@shared/respawn'
import Tooltip from '../../lib/Tooltip'
import { MOB_CARD_SLOT_PROPS, MobCard } from '../../lib/hoverCards'
import { fmtDuration } from '../buffs/format'
import { mainMobLookup } from './mobLookup'
import { RespawnEditDialog } from './RespawnEditDialog'
import { UnwatchButton } from './UnwatchButton'

/**
 * THE ROW'S TONE, one function for the accent, the clock text and the bar.
 *
 * Red when the log says it is UP, green once the clock ran out, blue while it runs. Every row on
 * screen is a mob the user asked for (tracking is opt-in), so there is no second class of ROW to
 * colour apart — only a second kind of FACT, and it is the one that outranks the countdown.
 *
 * AND GREY WHEN THE CLOCK STOPPED MEANING ANYTHING (round 8). A row whose estimate elapsed hours
 * ago is not "go and look" — painting it the same green as a clock that ran out ninety seconds ago
 * would make the loudest thing on the page the least useful one. It is dimmed rather than removed:
 * the ruling is that a watched mob is always visible.
 */
type RowTone = 'error' | 'success' | 'info' | 'stale'

function tone(r: RespawnReading): RowTone {
  if (r.seen) return 'error'
  if (r.stale) return 'stale'
  return r.due ? 'success' : 'info'
}

/** The clock's own colour. Blue is the resting state, so a running number is plain text. */
const CLOCK_COLOR: Record<RowTone, string> = {
  error: 'error.main',
  success: 'success.main',
  info: 'text.primary',
  stale: 'text.disabled'
}

/** The stripe down the left edge, which is the row's accent at a glance. */
const EDGE_COLOR: Record<RowTone, string> = {
  error: 'error.main',
  success: 'success.main',
  info: 'info.main',
  stale: 'divider'
}

/** The bar's palette colour. No entry for `stale`: a stale row draws no bar (see the render). */
const BAR_COLOR = { error: 'error', success: 'success', info: 'info' } as const

/**
 * THE SEEN LINE AND THE ONLY AFFORDANCE THAT MOVES A CLOCK WITHOUT A LOG LINE BEHIND IT.
 *
 * The two live together and appear only while the row is seen: the button is meaningless without
 * the evidence, and the evidence is the thing the button is confirming.
 */
function SeenRow({
  row,
  nowMs,
  onConfirmSighting
}: {
  row: RespawnRow
  nowMs: number
  onConfirmSighting?: (rowId: string) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, minWidth: 0 }}>
      <Typography variant="caption" data-testid="respawn-seen" sx={{ flex: 1, minWidth: 0, color: 'error.main' }}>
        {respawnSeenLabel(row, nowMs, fmtDuration)}
      </Typography>
      {onConfirmSighting !== undefined && (
        <Tooltip title={RESPAWN_CONFIRM_TITLE}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            data-testid="respawn-confirm-sighting"
            sx={{ py: 0, minWidth: 0, fontSize: 11, textTransform: 'none' }}
            onClick={(e) => {
              // The row itself carries a tooltip; a click on the button is about the button.
              e.stopPropagation()
              onConfirmSighting(row.id)
            }}
          >
            Start clock here
          </Button>
        </Tooltip>
      )}
    </Stack>
  )
}

/**
 * THE ROW'S WORKING: the gaps it measured, newest first.
 *
 * Its own line because it is the evidence under the number, and it is absent when there is none (a
 * row numbered by the wiki, or by a kill with nothing to pair it with) rather than drawn as an empty
 * label. Round 7 shared this line with the seconds box; round 9 deleted the box, so the gaps have
 * the line to themselves and the same numbers are in the edit modal beside the field that overrules
 * them.
 */
function WorkingLine({ row }: { row: RespawnRow }): JSX.Element | null {
  const gaps = respawnGapsLabel(row, fmtDuration)
  if (gaps.length === 0) return null
  return (
    <Typography
      variant="caption"
      data-testid="respawn-gaps"
      sx={{
        display: 'block',
        mt: 0.5,
        minWidth: 0,
        color: 'text.secondary',
        fontVariantNumeric: 'tabular-nums',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}
    >
      {gaps}
    </Typography>
  )
}

/**
 * THE DURATION AND WHERE IT CAME FROM, AS ONE THING (owner ruling, round 9).
 *
 * One bordered box holding the estimate, the rung that produced it and — on a surface that can write
 * — the affordance that overrules it. The border is what makes it one object rather than three
 * neighbours, and it is the same object in both states: an OVERRIDDEN row keeps the shape and
 * changes the colour, in the theme's accent, which is used by nothing else on this row (the clock's
 * own states are red / green / grey / plain).
 *
 * The edit icon is absent on a surface with no writer, the contract every other control here is
 * under, and its click is about ITSELF — the row is a hover-card anchor and the propagation stop is
 * the same one Unwatch and the confirm button make.
 */
function DurationUnit({ row, onEdit }: { row: RespawnRow; onEdit?: () => void }): JSX.Element {
  const over = respawnOverridden(row)
  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      data-testid="respawn-duration"
      data-respawn-overridden={over ? 'true' : 'false'}
      sx={{
        flexShrink: 0,
        pl: 0.75,
        pr: onEdit === undefined ? 0.75 : 0.25,
        py: 0.125,
        border: 1,
        borderRadius: 1,
        borderColor: over ? 'primary.main' : 'divider',
        bgcolor: over ? 'action.selected' : 'transparent',
        color: over ? 'primary.main' : 'text.secondary'
      }}
    >
      <Typography variant="caption" sx={{ color: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
        {respawnDurationText(row, fmtDuration)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'inherit', opacity: 0.8 }}>
        · {respawnSourceLabel(row)}
      </Typography>
      {onEdit !== undefined && (
        <IconButton
          size="small"
          data-testid="respawn-edit"
          aria-label={`Edit respawn for ${row.display}`}
          sx={{ p: 0.25, color: 'inherit' }}
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        >
          <EditOutlinedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Stack>
  )
}

/**
 * THE ESTIMATE RUNNING DOWN — and the two states that draw NO bar at all.
 *
 * A row with no estimate would draw an empty one, which reads as "nearly up" and would be a lie. A
 * STALE row (round 8) would draw a full one, which claims the moment it filled is still worth
 * knowing — it is not, which is the whole reason that row stopped printing a countdown.
 *
 * Its own component because `RespawnRowBar` is at the repo's factoring ceiling, the same reason
 * `SeenRow` and `WorkingLine` above are.
 */
function ClockBar({ hasEstimate, r, t }: { hasEstimate: boolean; r: RespawnReading; t: RowTone }): JSX.Element | null {
  if (!hasEstimate || t === 'stale') return null
  return (
    <LinearProgress
      variant="determinate"
      value={(1 - r.fraction) * 100}
      color={BAR_COLOR[t]}
      sx={{ mt: 0.5, height: 3, borderRadius: 2 }}
    />
  )
}

/**
 * THE LINE THE EYE GOES TO: the mob, the number, and the row's own way out.
 *
 * Its own component because `RespawnRowBar` is at the repo's `max-lines-per-function` ceiling — the
 * same reason `SeenRow`, `WorkingLine`, `DurationUnit` and `ClockBar` are, and the seam is the honest
 * one: this line is the ANSWER, everything below it is the working.
 */
function NameAndClock({
  row,
  nowMs,
  r,
  t,
  onUnwatch
}: {
  row: RespawnRow
  nowMs: number
  r: RespawnReading
  t: RowTone
  onUnwatch?: (key: string) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
      <Typography
        variant="body2"
        sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {row.display}
      </Typography>
      <Typography
        variant="body2"
        data-testid="respawn-clock"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          fontWeight: r.seen ? 700 : 400,
          // Blue is the resting state and would read as an alert on a number that is simply
          // counting; the facts worth colouring are UP, due, and long gone.
          color: CLOCK_COLOR[t]
        }}
      >
        {respawnClockLabel(row, nowMs, fmtDuration)}
      </Typography>
      {/* Last, so the countdown keeps its place on every row and the control never sits between the
          name and the number the eye is looking for. */}
      {onUnwatch !== undefined && (
        <UnwatchButton mobKey={row.key} display={row.display} testId="respawn-row-unwatch" onUnwatch={onUnwatch} />
      )}
    </Stack>
  )
}

export function RespawnRowBar({
  row,
  nowMs,
  onConfirmSighting,
  onUnwatch,
  onSetCustom
}: {
  row: RespawnRow
  nowMs: number
  /** Absent on a surface with no way to write (nothing today) — the button then does not exist. */
  onConfirmSighting?: (rowId: string) => void
  /** Same contract: no writer, no control. Round 4's affordance, on the mob rather than in a list. */
  onUnwatch?: (key: string) => void
  /**
   * Rung 1, edited on the clock it changes. Same contract again — no writer, no edit icon. Round 7
   * spent this on a bare seconds field; round 9 spends it on the modal, and it is the SAME write.
   */
  onSetCustom?: (key: string, display: string, sec?: number) => void
}): JSX.Element {
  const r = respawnReading(row, nowMs)
  const hasEstimate = row.estimateMs !== undefined
  const basis = respawnBasisLabel(row)
  const t = tone(r)
  /** Whether this row's modal is open. Local, because it is a view state about this row's controls. */
  const [editing, setEditing] = useState(false)
  return (
    <>
      <Tooltip
        // ROUND 6: the hover is the mob's CARD — its drop table (wiki, plus what you have looted off
        // it yourself) under what we know about its respawn. The timer half is round 5's provenance
        // string unchanged, carried in as the card's leading block rather than duplicated beside it.
        // ROUND 9: …and it says NOTHING while this row's modal is open. The click that opens the
        // modal is a hover, so the card is standing over the row the dialog is about — two answers
        // to one question, one of them behind the other. An EMPTY title is how a MUI tooltip is told
        // to close and stay closed ("there is no point in displaying an empty tooltip" — it forces
        // `open` false), and it is used rather than `disableHoverListener` because that only stops
        // the listeners: an already-open card would then never receive the mouseleave that closes
        // it, and would still be standing there long after the dialog was dismissed. MEASURED — the
        // e2e's "a clock row draws no card until it is pointed at" caught exactly that.
        title={
          editing ? (
            ''
          ) : (
            <MobCard mob={row.display} note={respawnCardNote(row, fmtDuration)} lookup={mainMobLookup} />
          )
        }
        slotProps={MOB_CARD_SLOT_PROPS}
        // The card has nothing to click — item names are plain text on it by design — so it takes no
        // pointer at all, which is the same law the floating window's card was drawn under while it
        // had one (a card that took the pointer while overlapping a row could swallow the Unwatch
        // beneath it, or fire the row's own mouseleave and flicker).
        disableInteractive
        // MUI opens a tooltip on the ANCHOR's focus by default, and this row contains buttons — so
        // tabbing along a list of clocks would throw a 300px card over each one in turn. This card is
        // a mouse affordance and says so.
        disableFocusListener
        placement="top-start"
      >
        <Box
          data-testid="respawn-row"
          data-respawn-mob={row.key}
          data-respawn-source={row.source}
          data-respawn-due={r.due ? 'true' : 'false'}
          data-respawn-seen={r.seen ? 'true' : 'false'}
          data-respawn-stale={r.stale ? 'true' : 'false'}
          // ROUND 9's state, stated at ROW level like every other one — the floating window states it
          // here too, so a reader of either surface asks the same question of the same element. It is
          // ALSO on the duration unit, which is the thing that actually changes colour.
          data-respawn-overridden={respawnOverridden(row) ? 'true' : 'false'}
          data-respawn-basis={row.basis}
          sx={{
            px: 1,
            py: 0.75,
            borderLeft: 3,
            borderColor: EDGE_COLOR[t],
            bgcolor: 'action.hover',
            borderRadius: 0.5
          }}
        >
            <NameAndClock row={row} nowMs={nowMs} r={r} t={t} onUnwatch={onUnwatch} />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25 }}>
            {/* Where it died, and (only when it is not the norm) what the clock counts from. The RUNG
                is no longer here: round 9 moved it into the duration unit it describes. */}
            <Typography
              variant="caption"
              sx={{
                flex: 1,
                minWidth: 0,
                color: 'text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {row.zone.length > 0 ? row.zone : 'unknown zone'}
              {basis.length > 0 ? ` · ${basis}` : ''}
            </Typography>
            <DurationUnit
              row={row}
              {...(onSetCustom === undefined
                ? {}
                : {
                    onEdit: () => {
                      setEditing(true)
                    }
                  })}
            />
          </Stack>
          <WorkingLine row={row} />
          {r.seen && <SeenRow row={row} nowMs={nowMs} onConfirmSighting={onConfirmSighting} />}
          <ClockBar hasEstimate={hasEstimate} r={r} t={t} />
        </Box>
      </Tooltip>
      {/* MOUNTED ONLY WHILE OPEN, outside the tooltip's anchor: the dialog prefills from the row at
          the instant it opens (a countdown row re-renders every second and must not re-prefill under
          the typing), and a portal rendered from inside a tooltip child is a needless entanglement. */}
      {editing && onSetCustom !== undefined && (
        <RespawnEditDialog
          row={row}
          open
          onClose={() => {
            setEditing(false)
          }}
          onSetCustom={onSetCustom}
        />
      )}
    </>
  )
}
