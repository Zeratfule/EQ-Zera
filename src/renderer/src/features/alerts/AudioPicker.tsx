// AudioPicker — the alert row's TWO dropdowns: what this alert plays, and which one.
//
// Owner: "the voice vs sound should be integrated into this dropdown instead of having to drill
// into edit." Before this, the row showed a pack picker and a sound picker, and the fact that an
// alert could SPEAK instead lived two clicks away in the editor's Speech block — so the single
// most interesting thing about an alert ("does this one talk?") was invisible in the list where
// every other property of it is visible.
//
// THE TWO SELECTS, EXACTLY:
//   1. OUTPUT — every installed sound pack (as before), a divider, then "Voice (spoken)".
//      Choosing a pack means `audio:'sound'`; the voice entry means 'speech' and keeps the
//      pack/sound the def already had. The select DISPLAYS the def's actual state, so a def with
//      `audio:'speech'` reads "Voice (spoken)" — there is no hidden mode a row can be in without
//      saying so.
//   2. CONTEXTUAL — the pack's sound list for 'sound'; for 'speech' the speak-what modes as plain
//      sentences ("Speak: alert name"), with the custom entry drawn as the EDIT ACTION it is
//      ("✎ Edit spoken phrase… “<phrase>”", JOS-362 — SayPicker's header). Custom opens a small
//      popover anchored on the select itself, never a navigation: the whole point of this change
//      is that the row is where you configure an alert.
//
// TWO SELECTS ARE NOW THE WHOLE MODEL, not a compromise (JOS-362). There used to be a third
// channel ("Sound + voice") and a per-alert VOICE override, which together made three dimensions
// the row could not show — so 'both' kept its fine-tuning in the editor and the row carried a
// voice it could not author. The owner retired both: "also remove sound + spoken - too much
// garbage", and "our settings shouldn't store which voice per alert, only the preferences
// should". A def now has a channel, a sound and a sentence; the row shows all of them, and
// Preferences > Voice (spoken) owns who says it, for every alert at once.
//
// PREVIEW IS NOT REBUILT HERE. The row's ▶ routes through `previewAlertNow` → `playAlertNow`,
// whose `speechPlan` decides sound vs speech from the very fields these selects write — so a def
// switched to "Voice (spoken)" SPEAKS when previewed, through the same seam that fires it for
// real. There is no second preview path and there must not be one.
//   That claim was written here before it was TRUE: a global voice switch (retired 2026-08-04)
//   sat inside `speechPlan` and degraded a speaking def back to the pack sound whenever it was
//   off — which it was by default — so pressing ▶ on a row you had just switched to voice played
//   the old sound and looked like this picker had not saved. One seam, one path, and now one
//   pinned equality: features/alerts/preview.ts + tests/alertPreview.test.mts.
//
// LAYOUT CONTRACT (inherited from SoundPicker, unchanged): in the alert list the two Selects
// must be columns of the ROW's shared grid template (see the grid comment in AlertList), so the
// wrapper is `display: contents` and each Select takes its width from the shared template
// instead of from whichever pack/line/phrase happens to be selected — every row lands its
// selects at the same x, and each one ellipsizes its displayed value rather than growing.

import { type JSX, type Ref, useRef, useState } from 'react'
import {
  Box,
  Button,
  Divider,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import type { AlertDef, SoundPack, SpeechMode } from '@shared/types'
import { MAX_SPEECH_CHARS, SPEECH_MODES } from '@shared/speechText'
import { autoTokenNamesFor } from '@shared/alertTargets'
import VoiceSetupLink, { type VoiceSetupNotice } from './VoiceSetupLink'
import { autoTokenLine } from './SpeechBlock'
import {
  OUTPUT_SPEECH,
  applyAudioChoice,
  audioChoiceOf,
  displayedChoice,
  outputValueOf,
  soundNotice,
  withOutput,
  writeBase,
  withPhrase,
  withSoundId,
  withSpeechMode
} from './audioChoice'
import { fallbackPack, packLabel } from './SoundPicker'
import { DEFAULT_PACK_ID } from './suggestions'

/**
 * The suffix the two voice entries carry when the chosen tier has nothing to speak with.
 *
 * SHORT ON PURPOSE — it is a flag inside a menu item, not the explanation. The explanation (and
 * the link that fixes it) is `VoiceSetupLink`, rendered under the selects for a row that actually
 * speaks: a dropdown the user has to open is the wrong place for the fix, and the wrong place for
 * a sentence. The entries stay SELECTABLE either way — a def outlives a machine's voice
 * inventory (an imported alert set, a profile switch), and choosing one is legitimate.
 */
const VOICE_GAP_SUFFIX = ' - not set up'

/** The speak-what entries, as sentences rather than the def's field names. */
const SAY_LABELS: Record<SpeechMode, string> = {
  alertName: 'Speak: alert name',
  spellName: 'Speak: spell name',
  spellFirstWord: 'Speak: first word',
  custom: 'Speak: custom…'
}

/**
 * What the CUSTOM entry says as a menu ITEM — an action, in the app's own "…opens something"
 * spelling ("Add from suggestion…", "Choose log file…"). Two of them because there is a real
 * difference between rewording a phrase and writing the first one, and a menu that offers to
 * "edit" nothing is a small lie.
 */
const EDIT_PHRASE_LABEL = 'Edit spoken phrase…'
const WRITE_PHRASE_LABEL = 'Write a spoken phrase…'

/**
 * What the COLLAPSED select shows — what this alert will SAY, never what clicking it would do.
 *
 * The closed control is a readout of the def (AudioPicker's header: no hidden mode a row can be in
 * without saying so), so the custom entry's action wording must not leak into it; `renderValue` is
 * what keeps the two texts independent, the same seam TitleBar's character select uses.
 */
function sayValueLabel(mode: SpeechMode, phrase: string): string {
  return mode === 'custom' && phrase ? `Speak: “${phrase}”` : SAY_LABELS[mode]
}

/** A grid item must be allowed to shrink below its content for text-overflow to ever kick in. */
const GRID_SX = {
  minWidth: 0,
  width: '100%',
  '& .MuiSelect-select': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
} as const

/**
 * "What this row plays is not what it says" — the one-line consequence of a pack that is gone
 * (JOS-273, `soundNotice`). Nothing at all in the ordinary case, which is why it is a component
 * rather than a branch inside the picker's already-full body.
 *
 * It sits in the OUTPUT column under the select, the placement `VoiceSetupLink` established for
 * "something is wrong with the output you picked", and ellipsizes with the full text in a native
 * title — the row's no-popper law (AlertList.tsx, JOS-143).
 */
function SoundNoticeLine({ text }: { text: string | null }): JSX.Element | null {
  if (!text) return null
  return (
    <Typography
      variant="caption"
      color="warning.main"
      display="block"
      data-testid="alert-sound-notice"
      title={text}
      sx={{ mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >
      {text}
    </Typography>
  )
}

/**
 * The custom entry's own label — the pencil, the action, and the phrase it acts on.
 *
 * THE PENCIL IS THE APP'S EXISTING EDIT MARK, not a new control style: `EditIcon` at `fontSize: 14`
 * is what the loadout override, the class-combo row, the item-count correction and the respawn row
 * all wear (JOS-362's constraint was "match the app's existing menu idioms"). The phrase rides
 * ALONGSIDE the action rather than replacing it — the user still needs to see which sentence they
 * are about to rewrite — and it is `noWrap` under a `maxWidth` so a long phrase ellipsizes instead
 * of stretching the menu wider than the row it dropped out of.
 */
function EditPhraseEntry({ phrase }: { phrase: string }): JSX.Element {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <EditIcon sx={{ fontSize: 14 }} />
      <span>{phrase ? EDIT_PHRASE_LABEL : WRITE_PHRASE_LABEL}</span>
      {phrase ? (
        <Typography
          variant="body2"
          color="text.secondary"
          noWrap
          sx={{ minWidth: 0, maxWidth: 220 }}
        >{`“${phrase}”`}</Typography>
      ) : null}
    </Stack>
  )
}

/**
 * The speak-what select — the CONTEXTUAL column for a def whose output is 'speech'.
 *
 * THE CUSTOM ENTRY IS A BUTTON, NOT A VALUE (JOS-360, and this component exists to say so where it
 * happens). Three of the four modes are values: picking one is a write, and `onChange` is the right
 * seam. 'custom' is not — it needs a value FROM the user, so it opens the phrase popover, and it
 * has to do that on every click INCLUDING a click on the mode the def is already in.
 *
 * …AND NOW IT LOOKS LIKE ONE (JOS-362). It behaved as a button while reading as a status: the entry
 * was the phrase itself ("Speak: “Tortoises wore off {target}”"), so the one control that rewords a
 * spoken alert announced nothing about being clickable — "it reads as a status, not an affordance -
 * selecting it edits the phrase but nothing says so" (owner, hands-on). The ITEM is now the action
 * (`EditPhraseEntry`) and the COLLAPSED value stays the readout (`renderValue` → `sayValueLabel`),
 * which is the only split that satisfies both halves: a menu you have to open cannot be where the
 * row states what it will say, and a readout cannot be where an action announces itself. Behavior
 * is untouched — same `onClick` seam, same `onChange` guard, same tests.
 *
 * A MUI Select fires `onChange` only when the value CHANGES (SelectInput's `if (value !== newValue)`
 * guard), so an `onChange`-driven custom entry is DEAD for any def already at `mode:'custom'`. That
 * was survivable while `landsOnOther` was the only suggestion template shipping a phrase; JOS-347
 * and JOS-353 gave six more templates a default one, so every suggestion a user installs now
 * arrives in custom mode — and the one control that rewords a spoken alert from the row stopped
 * working on all of them ("we lost the ability to write custom spoken alerts", owner, 2026-08-14).
 * `onClick` on the MenuItem is called by the SAME handler, unconditionally and BEFORE that guard,
 * so it is the seam that survives a re-pick. Pinned by tests/e2e/customPhraseSteps.mts.
 */
function SayPicker({
  selectRef,
  mode,
  phrase,
  onMode,
  onCustom
}: {
  selectRef: Ref<HTMLDivElement>
  mode: SpeechMode
  /** The def's current phrase — shown as the custom entry's own label, so the row says what it says. */
  phrase: string
  onMode: (mode: SpeechMode) => void
  onCustom: () => void
}): JSX.Element {
  return (
    <Select
      size="small"
      ref={selectRef}
      data-testid="alert-say"
      value={mode}
      renderValue={() => sayValueLabel(mode, phrase)}
      onChange={(e) => {
        const next = e.target.value as SpeechMode
        if (next !== 'custom') onMode(next)
      }}
      sx={{ gridArea: 'line', ...GRID_SX }}
    >
      {SPEECH_MODES.map((m) => (
        <MenuItem
          key={m}
          value={m}
          data-testid={`alert-say-${m}`}
          {...(m === 'custom' ? { onClick: onCustom } : {})}
        >
          {m === 'custom' ? <EditPhraseEntry phrase={phrase} /> : SAY_LABELS[m]}
        </MenuItem>
      ))}
    </Select>
  )
}

/**
 * The custom-phrase popover: capped, confirmable, and anchored on the select that opened it.
 *
 * IT SAYS WHICH TOKEN THE APP FILLS IN (owner, 2026-08-14, mid-JOS-362: "add a small bit of
 * explanatory text… around {target} and what it can do"). The row is now a real authoring surface —
 * a user who never opens the editor would otherwise never learn that `{target}` exists — so the
 * dialog's own sentence is rendered here too, from the SAME `autoTokenNamesFor(trigger)` answer and
 * the SAME words (`autoTokenLine`, SpeechBlock.tsx). Naming the tokens THIS alert can actually fill
 * is the point: a hardcoded `{target}` would promise one to the triggers that never carry it.
 * One quiet caption, in the helper-text idiom — a hint, not documentation.
 */
function PhrasePopover({
  anchorEl,
  initial,
  tokenHint,
  onCancel,
  onCommit
}: {
  anchorEl: HTMLElement | null
  initial: string
  /** The auto-token sentence for this alert's trigger, or null when it fills in none. */
  tokenHint: string | null
  onCancel: () => void
  onCommit: (phrase: string) => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  return (
    <Popover
      open={anchorEl != null}
      anchorEl={anchorEl}
      onClose={onCancel}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { sx: { p: 1.25, width: 320 } } }}
    >
      <Stack spacing={1}>
        <TextField
          size="small"
          autoFocus
          fullWidth
          label="Say this"
          data-testid="alert-row-phrase"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(text)
          }}
          slotProps={{ htmlInput: { maxLength: MAX_SPEECH_CHARS } }}
          helperText={`${String(text.length)} / ${String(MAX_SPEECH_CHARS)}`}
        />
        {tokenHint !== null && (
          <Typography
            variant="caption"
            color="text.secondary"
            display="block"
            data-testid="alert-row-phrase-tokens"
            sx={{ mt: -0.5 }}
          >
            {tokenHint}
          </Typography>
        )}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={() => onCommit(text)}>
            OK
          </Button>
        </Stack>
      </Stack>
    </Popover>
  )
}

export default function AudioPicker({
  packs,
  def,
  voiceSetup,
  defaultPackId,
  onChange
}: {
  packs: SoundPack[]
  def: AlertDef
  /** Whether there is a voice to speak with, and how to go set one up (VoiceSetupLink.tsx). */
  voiceSetup: VoiceSetupNotice
  /**
   * The user's default sound pack (JOS-273). It decides which pack this row falls back to when the
   * def names one that is gone, and it is what the notice under the selects is about.
   */
  defaultPackId?: string
  /** persist the whole def (the row's own upsert) — this writes four of its fields. */
  onChange: (next: AlertDef) => void
}): JSX.Element {
  // The popover is keyed so each opening starts from the def's CURRENT phrase: a cancelled edit
  // must not be what the next opening shows.
  const [phraseOpen, setPhraseOpen] = useState(0)
  const sayRef = useRef<HTMLDivElement>(null)

  const choice = audioChoiceOf(def)
  // The pack the def points at, or the user's default when it points at an uninstalled one —
  // a Select whose value is not among its items renders empty and warns.
  const pack = packs.find((p) => p.id === choice.packId) ?? fallbackPack(packs, defaultPackId)
  // …and the row SAYS so when that substitution happened, or when nothing can answer at all
  // (JOS-273: no silent mutes, and no silent stand-ins either).
  const notice = soundNotice(choice, packs, { defaultPackId: defaultPackId ?? DEFAULT_PACK_ID })
  const soundIds = pack ? Object.keys(pack.sounds) : []
  // What the selects show, and what an edit is applied to — NOT always the same thing when no
  // pack has resolved yet (audioChoice.ts: `writeBase`).
  const view = displayedChoice(choice, pack)
  const base = writeBase(choice, pack)
  const speaksOnly = choice.audio === 'speech'
  const voiceNote = voiceSetup.gap ? VOICE_GAP_SUFFIX : ''
  // The link is for a def that ACTUALLY speaks. Annotating every row in the list with a voice
  // problem none of them have would be chrome, not information.
  const speaks = choice.audio !== 'sound'
  const commit = (next: typeof choice): void => onChange(applyAudioChoice(def, next))

  return (
    <Box sx={{ display: 'contents' }}>
      {/* The output select owns the 'voice' column; the setup note sits UNDER it (same column,
          same left edge) so a row that speaks says what is missing where the choice was made. */}
      <Box sx={{ gridArea: 'voice', minWidth: 0 }}>
        <Select
          size="small"
          data-testid="alert-output"
          value={outputValueOf(view)}
          onChange={(e) => commit(withOutput(base, e.target.value, packs))}
          sx={GRID_SX}
        >
          {packs.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {packLabel(p)}
            </MenuItem>
          ))}
          <Divider />
          <MenuItem value={OUTPUT_SPEECH}>Voice (spoken){voiceNote}</MenuItem>
        </Select>
        {speaks && <VoiceSetupLink notice={voiceSetup} testId="alert-row-voice-setup" />}
        <SoundNoticeLine text={notice} />
      </Box>

      {speaksOnly ? (
        <SayPicker
          selectRef={sayRef}
          mode={view.mode}
          phrase={view.phrase}
          onMode={(mode) => commit(withSpeechMode(base, mode))}
          onCustom={() => setPhraseOpen((n) => n + 1)}
        />
      ) : (
        <Select
          size="small"
          data-testid="alert-sound"
          value={view.soundId}
          onChange={(e) => commit(withSoundId(base, e.target.value))}
          sx={{ gridArea: 'line', ...GRID_SX }}
        >
          {soundIds.map((sid) => (
            <MenuItem key={sid} value={sid}>
              {pack?.sounds[sid]?.label ?? sid}
            </MenuItem>
          ))}
        </Select>
      )}

      {phraseOpen > 0 && (
        <PhrasePopover
          key={phraseOpen}
          anchorEl={sayRef.current}
          initial={view.phrase}
          tokenHint={autoTokenLine(autoTokenNamesFor(def.trigger))}
          onCancel={() => setPhraseOpen(0)}
          onCommit={(phrase) => {
            commit(withPhrase(base, phrase))
            setPhraseOpen(0)
          }}
        />
      )}
    </Box>
  )
}
