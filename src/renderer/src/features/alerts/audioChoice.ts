// audioChoice.ts — the PURE half of "what does this alert do when it fires", as edited from the
// alert LIST's two dropdowns (owner: "the voice vs sound should be integrated into this dropdown
// instead of having to drill into edit").
//
// The alert row shows two selects and nothing else, but the def carries three things behind them:
// the audio channel (`audio`: sound | speech — 'both' is retired, JOS-362), the pack sound
// (`sound.packId`/`soundId`) and what a spoken alert says (`speech.mode`/`phrase`). This module is
// the mapping between the two, kept pure and DOM-free so the
// mapping itself is node-testable: every "clicking X writes Y on the def" claim in the row is a
// function here, not a closure inside a Select.
//
// THE SHAPE OF THE WRITE IS LOAD-BEARING, not cosmetic. `audio` is omitted at 'sound' and
// `speech` is omitted when nothing is configured — exactly as SpeechBlock.speechFieldsFor does
// it — so an alert that never asked to speak still saves byte-identically to how it always did.
// That is what keeps every pre-voice def, every share string and the import de-duplication
// fingerprint stable (shared/alertTypes.ts: absent `audio` ⇒ 'sound', by construction).
//
// THERE IS NO PER-ALERT VOICE ANY MORE (JOS-362). This module used to carry a def's
// `speech.voiceId` through every write untouched, because the editor could author one and a row
// edit must not silently drop it. The owner retired the whole dimension — "our settings shouldn't
// store which voice per alert, only the preferences should (within Voice (spoken))" — so the id is
// neither read nor written here, and Preferences owns who speaks, for every alert at once.
//
// Value imports from `shared/` are RELATIVE, never `@shared/*` — the repo-wide rule for anything
// node:test loads (AGENTS.md toolchain gotchas, the mobSearch.ts precedent). Type-only imports
// keep the alias, which is erased before Node ever sees the file.

import type { AlertAudioChoice, AlertDef, AlertSpeech, SoundPack, SpeechMode } from '@shared/types'
import type { SoundFallback } from '@shared/soundPacks'
import { MAX_SPEECH_CHARS, resolveAlertAudio } from '../../../../shared/speechText'
import { resolveSoundRef } from '../../../../shared/soundPacks'

/**
 * The audio state ONE row edits, flattened out of the def.
 *
 * `mode`/`phrase` are always present (at their defaults when the def has no speech block),
 * because a picker needs a value to display even for a def that has never spoken.
 */
export interface AudioChoice {
  /** Never 'both': a stored one is resolved away on the way IN (`audioChoiceOf`), JOS-362. */
  audio: AlertAudioChoice
  packId: string
  soundId: string
  mode: SpeechMode
  phrase: string
}

/** The def fields this module reads and writes. Any AlertDef satisfies it. */
export type AudioDef = Pick<AlertDef, 'audio' | 'sound' | 'speech'>

/**
 * The one non-pack entry of the OUTPUT select, as a select value.
 *
 * It shares the select's value space with pack ids, so it is namespaced with a colon —
 * `isSafePackId` (main/ipc) restricts a pack id to filename-safe characters, so the string can
 * never collide with a real pack. (`output:both` was the second one until JOS-362 retired the
 * combined channel: there is no select value for a channel nothing may write.)
 */
export const OUTPUT_SPEECH = 'output:speech'

/**
 * Flatten a def into the row's editable state.
 *
 * The channel comes through `resolveAlertAudio`, so a def still storing the retired 'both' is
 * shown as the channel it will actually be heard on rather than as a mode the picker cannot
 * display — AudioPicker's own law that no row may sit in a state it does not state (JOS-362).
 */
export function audioChoiceOf(def: AudioDef): AudioChoice {
  return {
    audio: resolveAlertAudio(def),
    packId: def.sound.packId,
    soundId: def.sound.soundId,
    mode: def.speech?.mode ?? 'alertName',
    phrase: def.speech?.phrase ?? ''
  }
}

/** Which OUTPUT select entry a choice is showing: a pack id, or the voice entry. */
export function outputValueOf(choice: AudioChoice): string {
  return choice.audio === 'speech' ? OUTPUT_SPEECH : choice.packId
}

/**
 * The `speech` block a choice implies, or undefined for "omit the key".
 *
 * IT USED TO CARRY A voiceId THROUGH, and deliberately: the row could not author a per-alert
 * voice, so it preserved the one the editor had written. JOS-362 removed the per-alert voice
 * outright (owner: "our settings shouldn't store which voice per alert, only the preferences
 * should"), so there is nothing to preserve — a def that still carries one is not read, and the
 * first row edit rebuilds the block without it. That is the "drop on next write" half of the rule.
 */
function speechFieldsOf(choice: AudioChoice): AlertSpeech | undefined {
  const speech: AlertSpeech = { mode: choice.mode }
  const phrase = choice.phrase.trim().slice(0, MAX_SPEECH_CHARS)
  if (phrase) speech.phrase = phrase
  const configured = speech.mode !== 'alertName' || speech.phrase !== undefined
  return configured ? speech : undefined
}

/**
 * Write a choice back onto a def, omitting every field that is at its default (see header).
 *
 * The keys are DELETED rather than set to `undefined`: the def is persisted as JSON and compared
 * as an object (the share fingerprint), and a present-but-undefined key is a different object
 * from an absent one even when it serializes the same.
 */
export function applyAudioChoice(def: AlertDef, choice: AudioChoice): AlertDef {
  const next: AlertDef = { ...def, sound: { packId: choice.packId, soundId: choice.soundId } }
  if (choice.audio === 'sound') delete next.audio
  else next.audio = choice.audio
  const speech = speechFieldsOf(choice)
  if (speech) next.speech = speech
  else delete next.speech
  return next
}

/**
 * The choice the selects DISPLAY: the def's state normalized onto a pack that actually exists.
 *
 * A MUI Select whose value is not among its items renders blank and warns, so a def pointing at
 * an uninstalled pack (or a sound that pack no longer carries) has to be shown as SOMETHING —
 * `pack` is the caller's resolution (the def's pack, else the shipped default).
 */
export function displayedChoice(choice: AudioChoice, pack: SoundPack | undefined): AudioChoice {
  const soundIds = pack ? Object.keys(pack.sounds) : []
  return {
    ...choice,
    packId: pack?.id ?? '',
    soundId: pack?.sounds[choice.soundId] ? choice.soundId : soundIds[0] ?? ''
  }
}

/**
 * The choice an edit is applied TO — which is NOT always the displayed one.
 *
 * With no pack resolved at all (packs still loading, or none installed yet — the e2e channel, or
 * a first run before the default pack has self-provisioned) the displayed choice is a pair of
 * EMPTY STRINGS, and writing that would erase the def's sound as a side effect of switching it
 * to voice. So a write normalizes only when there is something honest to normalize to, and
 * otherwise leaves the sound exactly as the def stated it.
 */
export function writeBase(choice: AudioChoice, pack: SoundPack | undefined): AudioChoice {
  return pack ? displayedChoice(choice, pack) : choice
}

/**
 * WHAT THE ROW SAYS WHEN THE SOUND IT NAMES IS NOT THE SOUND IT WILL PLAY (JOS-273) — or null
 * when there is nothing to say, which is the overwhelmingly common case.
 *
 * The owner's ruling has three parts and this is the third: a ref into a pack that is gone
 * resolves through the default-pack preference rather than going silently mute, and where it
 * CANNOT resolve the alert row says so visibly. A user who deletes a pack should find out from
 * the alerts list, not from an alert that never fired.
 *
 * Pure, and here rather than in the component, for the reason this whole module exists: "the row
 * claims X about the def" is a function, not a closure inside JSX.
 */
export function soundNotice(
  choice: AudioChoice,
  packs: readonly SoundPack[],
  fallback: SoundFallback
): string | null {
  // A spoken-only alert plays no pack sound at all, so its pack being gone is not a fact about
  // anything the user can hear.
  if (choice.audio === 'speech') return null
  const resolved = resolveSoundRef(
    { packId: choice.packId, soundId: choice.soundId },
    packs,
    fallback
  )
  if (resolved.status === 'exact') return null
  if (resolved.status === 'missing') {
    return `No sound pack installed - this alert stays silent until you install one.`
  }
  if (resolved.packId === choice.packId) return null // same pack, another line: not worth a line of chrome
  const name = packs.find((p) => p.id === resolved.packId)?.name ?? resolved.packId
  return `"${choice.packId}" is not installed - playing ${name} instead.`
}

/**
 * Choosing an entry in the OUTPUT select.
 *
 * A PACK IS A CHANNEL CHOICE TOO: picking one means "play this sound", i.e. `audio:'sound'` —
 * so switching a spoken alert back to a pack is one click, not a trip to the editor. The voice
 * entry keeps the pack/sound the def already had, because a user who tries speech and changes
 * their mind should get their sound back unchanged.
 *
 * The soundId is re-seeded from the new pack (its first sound) unless that pack happens to
 * carry the same id — a sound the pack does not have would render an out-of-range select.
 */
export function withOutput(
  choice: AudioChoice,
  value: string,
  packs: readonly SoundPack[]
): AudioChoice {
  if (value === OUTPUT_SPEECH) return { ...choice, audio: 'speech' }
  const pack = packs.find((p) => p.id === value)
  if (!pack) return { ...choice, audio: 'sound', packId: value }
  const soundId = pack.sounds[choice.soundId] ? choice.soundId : Object.keys(pack.sounds)[0] ?? ''
  return { ...choice, audio: 'sound', packId: value, soundId }
}

/** Choosing a sound in the contextual select (the 'sound' case). */
export function withSoundId(choice: AudioChoice, soundId: string): AudioChoice {
  return { ...choice, soundId }
}

/**
 * Choosing a speak-what mode in the contextual select (the 'speech' case).
 *
 * Switching AWAY from 'custom' keeps the phrase: it is the user's text, and coming back to
 * custom should find it where they left it. It stops being spoken the moment the mode changes
 * (speechText.ts reads `phrase` only for 'custom'), which is the whole of what the change means.
 */
export function withSpeechMode(choice: AudioChoice, mode: SpeechMode): AudioChoice {
  return { ...choice, mode }
}

/**
 * Committing the inline custom-phrase popover.
 *
 * EMPTY TEXT IS NOT A CUSTOM PHRASE. `speechTextFor` would resolve it to nothing and fall back
 * to the alert's name, so leaving the mode on 'custom' would leave the select saying "custom"
 * about an alert that says its name — a picker lying about the def. It reverts to the mode that
 * describes what will actually be spoken.
 */
export function withPhrase(choice: AudioChoice, phrase: string): AudioChoice {
  const text = phrase.trim().slice(0, MAX_SPEECH_CHARS)
  return text ? { ...choice, mode: 'custom', phrase: text } : { ...choice, mode: 'alertName', phrase: '' }
}
