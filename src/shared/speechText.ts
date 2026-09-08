// speechText.ts — WHAT a voice alert says. The content half of voice alerts
// (docs/plans/voice-alerts.md §1), and nothing else: no engine, no audio, no IPC.
//
// THE ONE FUNCTION. `speechTextFor(def, firing)` resolves a def's speech config plus the
// firing's spell context into the literal string to speak. It is PURE — no clock, no store,
// no I/O — so the alert editor's live preview, the renderer's player and any future
// main-side caller all produce byte-identical text from the same inputs. It answers WHAT to
// say; whether to say anything at all is `def.audio` ('speech' | 'both'), which lives on the
// def precisely so the two questions never get tangled.
//
// RANK-STRIPPING IS THE RESOLVER'S JOB. The log casts `Mesmerization III` and the fade line
// says `Mesmerization`; ranks are noise aloud, so the spell modes fold them out through
// `parseSpellRank` — the SAME rank machinery `spellCanonKey`/`spellLineKey` use (shared/
// spellLines.ts, whose equality with the parser helper is pinned by tests/spellLines.test.mts).
// It is imported, not re-implemented: a second rank regex in the tree is a second answer.
//
// CAPTURE SUBSTITUTION LIVES NEXT DOOR (JOS-103). A 'custom' phrase may write `{player}` and the
// firing's named regex captures fill it in — "Puma on Fail". The semantics, the caps and the
// THREAT MODEL are all in shared/alertCaptures.ts, which this module calls into rather than
// re-deriving: captured text is attacker-influenced (a stranger's character name, a stranger's
// typed chat), alert defs are shareable, and there is exactly one place that decides how far such
// a value may travel. What is enforced HERE is the part that is this module's own: substitution
// happens inside the 'custom' branch, so the resolved sentence is still `tidy`-ed and still
// truncated at MAX_SPEECH_CHARS. There is no path by which a token's expansion escapes the cap.
//
// NEVER SILENT, NEVER A GUESS (world-model law 1). A spell mode on a firing that carries no
// spell — an app-signal alert, a raw trigger on a spell-less line, an event family that names
// no spell — falls back to the alert's own NAME. Saying the alert's name is a true statement
// about what fired; saying nothing is a broken alert the user cannot see, and inventing a
// spell name is worse than both.
//
// This module also owns the RUNTIME constants of the voice model (the mode/engine/action
// lists, the char cap, the pref defaults). The TYPES live in shared/alertTypes.ts; these are
// their values, kept here because this is the module every consumer — the migration, the
// editor, the preferences panel — already has to import.

import type {
  AlertAudio,
  AlertAudioChoice,
  AlertDef,
  AlertSpeech,
  FiredAlert,
  SpeechEngine,
  SpeechMode,
  VoicePrefs
} from './alertTypes'
import { applyCaptures } from './alertCaptures'
import { parseSpellRank } from './spellLines'

/**
 * Longest utterance a single alert may speak, in characters.
 *
 * 120 is roughly eight seconds of speech at a normal rate — already far past the point where
 * an ALERT stops being an alert. The cap is not a validation error: over-long text is TRUNCATED
 * so a paste-happy custom phrase still speaks its opening words instead of failing.
 */
export const MAX_SPEECH_CHARS = 120

/** Every SpeechMode, for the editor's mode picker. Exhaustive by construction. */
export const SPEECH_MODES = [
  'alertName',
  'spellName',
  'spellFirstWord',
  'custom'
] as const satisfies readonly SpeechMode[]

/**
 * Every audio action a STORE may hold — the tolerated union, not the offered one. It is what the
 * share importer validates against and what the store migration keeps (`pickLiteral`), so a def
 * carrying the retired 'both' still round-trips instead of being coerced into a guess.
 * Exhaustive by construction.
 */
export const ALERT_AUDIO_ACTIONS = ['sound', 'speech', 'both'] as const satisfies readonly AlertAudio[]

/**
 * Every audio action a PICKER offers — sound, or spoken (JOS-362, owner: "also remove sound +
 * spoken - too much garbage"). Exhaustive over `AlertAudioChoice` by construction, so retiring or
 * adding a channel is one edit to the type.
 */
export const ALERT_AUDIO_CHOICES = ['sound', 'speech'] as const satisfies readonly AlertAudioChoice[]

/**
 * WHAT A STORED `audio` MEANS TODAY — the one place the retired 'both' turns back into a channel
 * the app still has (JOS-362).
 *
 * THE RULE, and the owner's constraint it comes from ("don't screw up anyone's settings except for
 * the insane people who use that one option in the process"): a def that says 'both' resolves to
 *   * 'speech' when it carries a custom PHRASE — somebody wrote those words for this alert, and a
 *     phrase is the most specific statement of intent a def can make about its audio; else
 *   * 'sound' — the channel that alert was already guaranteed to be heard on.
 * Every other def resolves to exactly what it stored, so nobody else's settings move at all.
 *
 * IT IS A READ, NOT A REWRITE. The store is not walked and no def is re-saved: the value stays
 * 'both' on disk until the user edits that alert, at which point the row/editor writes the
 * resolved channel like any other edit. That keeps a downgrade, a share string and an exported
 * bundle readable, and it keeps this from being a migration that touches defs nobody asked us to
 * touch. Both authoring surfaces and the firing path call this, so what the row SAYS and what the
 * player DOES cannot disagree.
 */
export function resolveAlertAudio(def: Pick<AlertDef, 'audio' | 'speech'>): AlertAudioChoice {
  const stored = def.audio ?? 'sound'
  if (stored !== 'both') return stored
  return def.speech?.phrase?.trim() ? 'speech' : 'sound'
}

/** Every engine tier, for the preferences engine picker. Exhaustive by construction. */
export const SPEECH_ENGINES = ['system', 'kokoro'] as const satisfies readonly SpeechEngine[]

// Compile-time proof that each list covers its WHOLE union — the logEventKinds.ts pattern. If a
// member is added to the union and forgotten here, the assignment below stops compiling.
const _modesExhaustive: (typeof SPEECH_MODES)[number] = null as unknown as SpeechMode
const _actionsExhaustive: (typeof ALERT_AUDIO_ACTIONS)[number] = null as unknown as AlertAudio
const _enginesExhaustive: (typeof SPEECH_ENGINES)[number] = null as unknown as SpeechEngine
void _modesExhaustive
void _actionsExhaustive
void _enginesExhaustive

/**
 * The voice's CONFIGURATION at its defaults — the free, zero-download tier, the engine's own
 * choice of voice, ordinary speed and full volume (decision D1).
 *
 * There is no `enabled` here because there is no master switch: an alert speaks because ITS
 * `audio` says 'speech'/'both', full stop (see VoicePrefs in shared/alertTypes.ts). "Off until
 * asked for" is still true, and is still what a fresh install does — it is just enforced where
 * the ask happens (no alert asks to speak by default) instead of by a second global toggle.
 */
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  engine: 'system',
  voiceId: null,
  rate: 1,
  volume: 1
}

/** Rate bounds. Below 0.5 speech drags past the alert's usefulness; above 2 it is a chipmunk. */
export const MIN_SPEECH_RATE = 0.5
export const MAX_SPEECH_RATE = 2

/**
 * Repair anything that claims to be VoicePrefs into something that IS.
 *
 * Takes `unknown` because that is the honest type of what it is handed: the store's `voice`
 * key (a file a user can edit, a downgrade can predate, and a future build can have written)
 * and the renderer's setter payload (a renderer string is a renderer string). ONE
 * implementation so the migration, the store read and the store write can never disagree
 * about which values are legal — an unknown engine is not coerced into a guess, it falls
 * back to the documented default.
 */
export function normalizeVoicePrefs(value: unknown): VoicePrefs {
  const raw: Record<string, unknown> =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const engine = SPEECH_ENGINES.find((e) => e === raw.engine)
  const voiceId = raw.voiceId
  // A legacy `enabled` key is DROPPED, not read: schema v8 retired the master switch, and the
  // migration that retired it is the only code that may still look at the old value (it decides
  // whether the user's spoken alerts stay spoken). Anything reading it here would be a second,
  // undocumented switch.
  return {
    engine: engine ?? DEFAULT_VOICE_PREFS.engine,
    // null (never undefined) is the stated "use whatever voice the engine defaults to".
    voiceId: typeof voiceId === 'string' && voiceId.trim() ? voiceId : null,
    rate: clampNumber(raw.rate, MIN_SPEECH_RATE, MAX_SPEECH_RATE, DEFAULT_VOICE_PREFS.rate),
    volume: clampNumber(raw.volume, 0, 1, DEFAULT_VOICE_PREFS.volume)
  }
}

/** A finite number clamped into [lo, hi]; anything that is not a number becomes `fallback`. */
function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, value))
}

/**
 * The firing context `speechTextFor` reads. Structural on purpose: a `FiredAlert` satisfies it
 * (that is the real caller), and so does a `{ spell }` literal in a test or an editor preview,
 * without either having to fabricate an alertId and a timestamp.
 */
export type SpeechFiring = Pick<FiredAlert, 'spell' | 'captures'>

/** The def fields the resolver reads. Any AlertDef satisfies it. */
export type SpeechDef = Pick<AlertDef, 'name' | 'speech'>

/** Trim + collapse runs of whitespace: a newline in a phrase is a pause, not a word break. */
function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Cap an utterance at MAX_SPEECH_CHARS, cutting mid-word rather than refusing to speak. */
function cap(text: string): string {
  return text.length <= MAX_SPEECH_CHARS ? text : text.slice(0, MAX_SPEECH_CHARS).trimEnd()
}

/** The rank-stripped display base of a spell name ("Mesmerization III" → "Mesmerization"). */
function spellBase(spell: string): string {
  return tidy(parseSpellRank(spell).base)
}

/**
 * Resolve ONE mode against the firing, or null when this mode cannot answer (a spell mode with
 * no spell, an empty custom phrase). Null is what the caller turns into the alertName fallback.
 */
function resolveMode(mode: SpeechMode, speech: AlertSpeech, firing: SpeechFiring | null): string | null {
  // 'custom' is the ONLY mode a `{token}` can appear in, because it is the only one whose text
  // the def's AUTHOR wrote — the other three resolve to values the app owns (the def's name, a
  // name out of the committed spell DB) and have no template to substitute into. Substitution
  // happens here, INSIDE the mode, so the whole-utterance `cap()` below still governs the result:
  // a phrase that grew when its tokens resolved is truncated exactly like a long literal one.
  // Ordering matters: substitute FIRST, `tidy` the result — so whitespace a captured value
  // brought with it is collapsed into the one sentence, rather than the phrase being tidied
  // around a token and the value smuggling a run of spaces in afterwards.
  if (mode === 'custom') return tidy(applyCaptures(speech.phrase ?? '', firing?.captures)) || null
  if (mode === 'alertName') return null
  const spell = tidy(firing?.spell ?? '')
  if (!spell) return null
  const base = spellBase(spell)
  if (!base) return null
  if (mode === 'spellName') return base
  // 'spellFirstWord' — shortest useful utterance. `base` is already whitespace-collapsed.
  return base.split(' ')[0] || null
}

/**
 * The text this alert should speak for this firing, or null when there is nothing truthful to
 * say (a nameless def whose mode resolved to nothing — the UI shows no preview and the player
 * speaks nothing rather than an empty utterance).
 *
 * `firing` is optional so the alert editor can render a live preview before anything has fired;
 * with no firing the spell modes simply take the alertName fallback, which is exactly what the
 * user will hear if the trigger turns out to name no spell.
 */
export function speechTextFor(def: SpeechDef, firing?: SpeechFiring | null): string | null {
  // A def with no speech block still has a sensible thing to say: its own name. Defaulting
  // here (rather than refusing) means enabling `audio:'speech'` on an existing alert is a
  // one-field change that already works.
  const speech: AlertSpeech = def.speech ?? { mode: 'alertName' }
  const resolved = resolveMode(speech.mode, speech, firing ?? null)
  const text = resolved ?? tidy(def.name)
  return text ? cap(text) : null
}
