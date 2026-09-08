// SpeechBlock — the alert editor's SPEECH half (docs/plans/voice-alerts.md §4): which audio
// channel this alert uses, what it says, in whose voice, and whether it may be swallowed by the
// cross-alert audio throttle.
//
// Its own file because AlertDialog.tsx is already at the factoring ceiling, and because this
// block is a self-contained sub-form: `useSpeechForm` owns its four fields, `speechFieldsFor`
// turns them back into the def's optional keys, and the component is the rendering. AlertDialog
// composes the three.
//
// THE PREVIEW IS LIVE AND NEEDS NO FIRING. `speechTextFor(def, firing?)` is pure and takes an
// OPTIONAL firing precisely so this line can be resolved while the user types (W1's contract) —
// so the user reads the actual sentence, resolved by the same function the player will run,
// before ever pressing ▶. On a spell mode there is no spell yet, so the preview shows the
// alertName FALLBACK — which is the honest answer: it is exactly what they will hear whenever
// the trigger turns out to name no spell.
//
// WHAT IS DELIBERATELY NOT HERE: rate, volume and the DEFAULT voice. Those are global (the
// Preferences → Voice section); this block only overrides. A per-alert rate would be four
// places to look when one alert sounds wrong.

import { type JSX, useEffect, useState } from 'react'
import {
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { AlertAudioChoice, AlertDef, AlertSpeech, SpeechMode } from '@shared/types'
import {
  ALERT_AUDIO_CHOICES,
  MAX_SPEECH_CHARS,
  SPEECH_MODES,
  resolveAlertAudio,
  speechTextFor
} from '@shared/speechText'
import { tokensIn } from '@shared/alertCaptures'
import { currentVoicePrefs, speak } from '../../lib/speech'
import VoiceSetupLink, { type VoiceSetupNotice } from './VoiceSetupLink'

/**
 * Human labels for the audio-action selector. Keyed off the closed union of what a user may
 * CHOOSE (`AlertAudioChoice`), never free text — the retired 'both' has no label because it has no
 * entry (JOS-362).
 */
const AUDIO_LABELS: Record<AlertAudioChoice, string> = {
  sound: 'Play a sound',
  speech: 'Speak it'
}

/** Human labels for the mode picker, in the order SPEECH_MODES declares. */
const MODE_LABELS: Record<SpeechMode, string> = {
  alertName: 'the alert’s name',
  spellName: 'the spell’s name',
  spellFirstWord: 'the spell’s first word',
  custom: 'a phrase I write'
}

/** The sub-form AlertDialog holds and this block renders. */
export interface SpeechForm {
  audio: AlertAudioChoice
  setAudio: (v: AlertAudioChoice) => void
  mode: SpeechMode
  setMode: (v: SpeechMode) => void
  phrase: string
  setPhrase: (v: string) => void
  alwaysPlay: boolean
  setAlwaysPlay: (v: boolean) => void
}

/** The three fields + the opt-out, read off a def (edit) or at their defaults (add). */
function speechDefaults(initial: AlertDef | null): {
  audio: AlertAudioChoice
  mode: SpeechMode
  phrase: string
  alwaysPlay: boolean
} {
  const speech = initial?.speech
  return {
    // Through `resolveAlertAudio`, so a def still storing the retired 'both' opens on the channel
    // it will actually be heard on rather than on a value this select has no entry for (JOS-362).
    audio: initial ? resolveAlertAudio(initial) : 'sound',
    mode: speech?.mode ?? 'alertName',
    phrase: speech?.phrase ?? '',
    // `speech.voiceId` is deliberately NOT read (JOS-362): a def may still carry one, and it is
    // ignored rather than migrated — the next save of this alert simply omits it.
    alwaysPlay: initial?.alwaysPlay === true
  }
}

/** Hydrate the speech sub-form from `initial` (edit) or its defaults (add), on every open. */
export function useSpeechForm(open: boolean, initial: AlertDef | null): SpeechForm {
  const [audio, setAudio] = useState<AlertAudioChoice>('sound')
  const [mode, setMode] = useState<SpeechMode>('alertName')
  const [phrase, setPhrase] = useState('')
  const [alwaysPlay, setAlwaysPlay] = useState(false)

  useEffect(() => {
    if (!open) return
    const d = speechDefaults(initial)
    setAudio(d.audio)
    setMode(d.mode)
    setPhrase(d.phrase)
    setAlwaysPlay(d.alwaysPlay)
  }, [open, initial])

  return {
    audio,
    setAudio,
    mode,
    setMode,
    phrase,
    setPhrase,
    alwaysPlay,
    setAlwaysPlay
  }
}

/**
 * The def keys this block owns. Each is OMITTED at its default, so an alert that never asked to
 * speak saves byte-identically to how it always did — which is what keeps every pre-voice def,
 * every share string and the import de-duplication fingerprint stable.
 *
 * AND `speech.voiceId` IS NEVER AMONG THEM (JOS-362). The block is rebuilt from the form, and the
 * form has no voice field any more, so saving an alert that still carries a stored voice DROPS it
 * — the "normalize on read, drop on next write" half of retiring the per-alert override. It is
 * not read on the way in either, so an unedited def keeps the dead key and behaves identically.
 */
export function speechFieldsFor(f: SpeechForm): Pick<AlertDef, 'audio' | 'speech' | 'alwaysPlay'> {
  const speech: AlertSpeech = { mode: f.mode }
  const phrase = f.phrase.trim().slice(0, MAX_SPEECH_CHARS)
  if (phrase) speech.phrase = phrase
  const configured = f.mode !== 'alertName' || speech.phrase !== undefined
  return {
    ...(f.audio === 'sound' ? {} : { audio: f.audio }),
    ...(configured ? { speech } : {}),
    ...(f.alwaysPlay ? { alwaysPlay: true } : {})
  }
}

/** The resolved sentence this alert will speak, with no firing — W1's editor-preview contract. */
export function previewTextFor(name: string, f: SpeechForm): string | null {
  const fields = speechFieldsFor(f)
  return speechTextFor({ name, ...(fields.speech ? { speech: fields.speech } : {}) }, null)
}

/**
 * The one sentence the greyed-out opt-out says on hover (JOS-222). A NATIVE title, never a popper:
 * this file renders three Selects and the rule (JOS-143) is that no file mounting a dropdown may
 * also mount a hover card that could open over its option list — the same spelling AlertDialog's
 * early-warning info icon uses.
 */
const ALL_ALWAYS_PLAY_TITLE =
  'Always play is on for every alert, in the Alerts toolbar - turn it off there to set this per alert.'

/**
 * Audio-channel selector + the always-play opt-out. Both apply whether or not speech is on.
 *
 * THE OPT-OUT GREYS OUT WHEN THE GLOBAL PREFERENCE IS ON, and it keeps showing THIS alert's own
 * saved value rather than being forced to look on (JOS-222). The global one is a bypass applied
 * over the top; it does not rewrite what any def says, so a user who turns it back off finds every
 * per-alert choice exactly where they left it — which is also what saving from this dialog does,
 * because a disabled switch changes no state and `speechFieldsFor` still emits the stored key.
 */
function AudioActionRow({ form, allAlwaysPlay }: { form: SpeechForm; allAlwaysPlay: boolean }): JSX.Element {
  return (
    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
      <Box sx={{ minWidth: 200 }}>
        <Typography variant="caption" color="text.secondary">
          When this fires…
        </Typography>
        <Select
          size="small"
          fullWidth
          data-testid="alert-audio-action"
          value={form.audio}
          onChange={(e) => form.setAudio(e.target.value as AlertAudioChoice)}
        >
          {ALERT_AUDIO_CHOICES.map((a) => (
            <MenuItem key={a} value={a}>
              {AUDIO_LABELS[a]}
            </MenuItem>
          ))}
        </Select>
      </Box>
      {/* The span is what carries the hover: a disabled control swallows mouse events, so a title
          on the Switch itself would never fire (same reason the Remove-condition button is
          wrapped). It is present only while disabled, so nothing explains a control that works. */}
      <span
        {...(allAlwaysPlay ? { title: ALL_ALWAYS_PLAY_TITLE } : {})}
        data-testid="alert-always-play-wrap"
      >
        <FormControlLabel
          disabled={allAlwaysPlay}
          control={
            <Switch
              size="small"
              data-testid="alert-always-play"
              checked={form.alwaysPlay}
              onChange={(e) => form.setAlwaysPlay(e.target.checked)}
            />
          }
          label={<Typography variant="body2">Always play (skip audio throttle)</Typography>}
        />
      </span>
    </Stack>
  )
}

/** Render a token list the way the user writes it: `{player} {target}`. */
function tokenList(names: readonly string[]): string {
  return names.map((n) => `{${n}}`).join(' ')
}

/**
 * THE ONE SENTENCE that names the tokens the app fills in by itself for a trigger, or null when it
 * fills in none (JOS-353's ruling, rendered).
 *
 * EXPORTED BECAUSE THERE ARE NOW TWO PLACES A PHRASE IS WRITTEN (JOS-362): this dialog, and the
 * alert row's own phrase popover (AudioPicker's `PhrasePopover`). Both take their names from
 * `autoTokenNamesFor(trigger)` so neither can name a token this alert cannot fill, and both say it
 * in the SAME words — a second hand-written copy of this sentence is a drift waiting to happen.
 */
export function autoTokenLine(names: readonly string[]): string | null {
  if (names.length === 0) return null
  return `Companion fills in ${tokenList(names)} for you - who the spell is affecting. No pattern needed.`
}

/**
 * WHAT `{tokens}` THIS ALERT MAY WRITE, and which ones nothing will fill in (JOS-103, JOS-353).
 *
 * The readable form of control 4 in shared/alertCaptures.ts's threat model: the set of values this
 * alert can ever speak is a FINITE LIST that can be printed. It matters most for a def that
 * arrived in somebody else's share string — you can see what it is able to say without reading the
 * regex.
 *
 * TWO LISTS, BECAUSE THERE ARE TWO KINDS OF TOKEN AND THE DIFFERENCE IS THE FEATURE. The first is
 * what the def's own PATTERN declared (`captureNamesIn`) — the JOS-103 story, and it needs a
 * regex. The second is what the app fills in BY ITSELF from the event kinds this trigger watches
 * (`autoTokenNamesFor`), which is the whole of JOS-353's owner ruling: `{target}` has to be
 * reachable from the plain editor, so the plain editor is where it is announced. Printing them
 * separately is also what keeps control 4 honest — a reader can still see which values came from a
 * declaration they can inspect.
 *
 * The unknown-token line is a WARNING, never a save block: an unresolved token renders literally,
 * which is a legible sentence rather than a broken alert, and a user mid-edit should not be
 * stopped from typing `{pl` on the way to `{player}`.
 */
function CaptureHint({
  phrase,
  captureNames,
  autoNames
}: {
  phrase: string
  captureNames: string[]
  autoNames: string[]
}): JSX.Element | null {
  const used = tokensIn(phrase)
  const unknown = used.filter((t) => !captureNames.includes(t) && !autoNames.includes(t))
  const autoLine = autoTokenLine(autoNames)
  if (captureNames.length === 0 && autoNames.length === 0 && unknown.length === 0) return null
  return (
    <Box data-testid="alert-speech-captures">
      {autoLine !== null && (
        <Typography variant="caption" color="text.secondary" display="block" data-testid="alert-speech-auto-tokens">
          {autoLine}
        </Typography>
      )}
      {captureNames.length > 0 && (
        <Typography variant="caption" color="text.secondary" display="block">
          {`This alert’s pattern captures: ${tokenList(captureNames)} - write one in the phrase to speak it.`}
        </Typography>
      )}
      {unknown.length > 0 && (
        <Typography variant="caption" color="warning.main" display="block">
          {`${tokenList(unknown)} ${unknown.length === 1 ? 'is not' : 'are not'} filled in by this alert - spoken as written.`}
        </Typography>
      )}
    </Box>
  )
}

/** Mode picker + live preview + (custom only) the capped phrase field. */
function SaysRow({
  name,
  form,
  captureNames,
  autoNames
}: {
  name: string
  form: SpeechForm
  captureNames: string[]
  autoNames: string[]
}): JSX.Element {
  const preview = previewTextFor(name, form)
  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="caption" color="text.secondary">
          Say…
        </Typography>
        <Select
          size="small"
          fullWidth
          data-testid="alert-speech-mode"
          value={form.mode}
          onChange={(e) => form.setMode(e.target.value as SpeechMode)}
        >
          {SPEECH_MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {MODE_LABELS[m]}
            </MenuItem>
          ))}
        </Select>
      </Box>

      {form.mode === 'custom' && (
        <>
          <TextField
            size="small"
            label="Phrase"
            data-testid="alert-speech-phrase"
            value={form.phrase}
            onChange={(e) => form.setPhrase(e.target.value)}
            slotProps={{ htmlInput: { maxLength: MAX_SPEECH_CHARS } }}
            helperText={`${String(form.phrase.length)} / ${String(MAX_SPEECH_CHARS)}`}
          />
          <CaptureHint phrase={form.phrase} captureNames={captureNames} autoNames={autoNames} />
        </>
      )}

      {/* THE PREVIEW SHOWS TOKENS UNRESOLVED, ON PURPOSE. There is no firing yet, so there is no
          captured value, and substituting a made-up sample would put words in the alert's mouth
          that no log line said (world-model law 1). The literal `{player}` is exactly what the
          user will hear if the capture is ever missing, and `CaptureHint` above is where they
          learn that the pattern really does declare it. */}
      <Typography variant="caption" color="text.secondary" data-testid="alert-speech-preview">
        {preview ? `Speaks: “${preview}”` : 'Speaks nothing - give the alert a name or a phrase.'}
      </Typography>
    </Stack>
  )
}

/**
 * The ▶ that speaks the preview through the real engine — and NOTHING about which voice says it.
 *
 * THE PER-ALERT VOICE IS GONE (JOS-362, owner: "our settings shouldn't store which voice per
 * alert, only the preferences should (within Voice (spoken))"). A picker sat here, and what it
 * produced was a def carrying a voice id that outlived the preference — an alert authored while
 * one voice was selected kept speaking in it forever, which is the symptom the owner reported as
 * "alerts … don't change when you select a new voice". The remedy is not a better default, it is
 * having no second place for the answer to live: the voice comes from `currentVoicePrefs()` at
 * speak time, here and in the firing path, so Preferences > Voice (spoken) moves every alert at
 * once. The Test button therefore auditions with exactly what a real firing will use.
 */
function VoiceRow({ name, form }: { name: string; form: SpeechForm }): JSX.Element {
  const prefs = currentVoicePrefs()
  const preview = previewTextFor(name, form)
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-end" flexWrap="wrap" useFlexGap>
      <Button
        size="small"
        startIcon={<PlayArrowIcon />}
        data-testid="alert-speech-test"
        disabled={!preview}
        onClick={() => {
          if (preview) void speak(preview, prefs)
        }}
      >
        Test
      </Button>
    </Stack>
  )
}

/**
 * The block. The speech controls are shown only when the alert actually speaks — a sound-only
 * alert has nothing to say, and offering it a phrase field would be offering dead state — but
 * the audio-action row and the throttle opt-out are always there, because both are true of every
 * alert.
 */
export default function SpeechBlock({
  name,
  form,
  voiceSetup,
  captureNames = [],
  autoNames = [],
  allAlwaysPlay = false
}: {
  name: string
  form: SpeechForm
  /** Whether there is a voice to speak with, and how to go set one up (VoiceSetupLink.tsx). */
  voiceSetup: VoiceSetupNotice
  /**
   * The named capture groups the alert's CURRENT trigger declares (`captureNamesIn`), recomputed
   * as the user edits the pattern. Empty for the alerts that capture nothing, which is most of
   * them — and then the hint renders nothing at all rather than an empty label.
   */
  captureNames?: string[]
  /**
   * The tokens the app fills in ITSELF for this trigger (`autoTokenNamesFor`, JOS-353) — today
   * exactly `{target}`, and only for the event kinds whose line names an entity. Recomputed from
   * the live form like `captureNames`, so switching the condition's kind updates the hint in the
   * same dialog.
   */
  autoNames?: string[]
  /**
   * `AlertPrefs.alwaysPlayAll` — the GLOBAL always-play preference (JOS-222). When it is on, this
   * alert's own opt-out is greyed out and says why on hover, because the global one already
   * decides the question for every alert. Defaults to false so a caller with no prefs in hand (a
   * test mounting this block bare) renders the ordinary editable control.
   */
  allAlwaysPlay?: boolean
}): JSX.Element {
  const speaks = form.audio !== 'sound'
  return (
    <Box data-testid="alert-speech-block">
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
        <VolumeUpIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="caption" color="text.secondary">
          Voice
        </Typography>
      </Stack>
      <Stack spacing={1.5}>
        <AudioActionRow form={form} allAlwaysPlay={allAlwaysPlay} />
        {/* No master switch to warn about any more (this used to say "spoken alerts are switched
            off in Preferences"): choosing 'Speak it' above IS the switch. The only thing left to
            say is that the chosen tier has nothing to speak with — and it says it with a LINK. */}
        {speaks && <VoiceSetupLink notice={voiceSetup} testId="alert-speech-setup" />}
        {speaks && <SaysRow name={name} form={form} captureNames={captureNames} autoNames={autoNames} />}
        {speaks && <VoiceRow name={name} form={form} />}
      </Stack>
    </Box>
  )
}
