// speech.ts — THE ENGINE SEAM for voice alerts (docs/plans/voice-alerts.md §3).
//
// `speechText.ts` (shared) answers WHAT is said. This module answers WHO SAYS IT and WHEN —
// and it is the ONLY place in the renderer that touches a speech engine. Every caller (the
// alert firing path, the editor's ▶ test, the preferences preview) goes through `speak()`, so
// there is exactly one answer to "which voice, at what rate, through which tier, and does this
// build utter at all".
//
// TWO TIERS BEHIND ONE CALL (decision D1):
//   'system'  → Chromium's own `speechSynthesis`. It lives in the renderer, so it never crosses
//               IPC: an utterance is constructed here, given the prefs' rate/volume and the
//               matched voice, and handed to the browser. Zero download, zero latency.
//   'kokoro'  → `window.eq.speechSay` into main (a worker, a pinned model, a wav cache). In THIS
//               build that handler is an honest stub answering `{ok:false,
//               reason:'engine-not-installed'}` — so this module FALLS BACK to the system tier
//               and warns ONCE to the console. A user who ticked "kokoro" before wave 3 exists
//               still hears their alert; they do not get an error dialog for a tier they were
//               invited to pick. Surfacing the install state as UI is W3's job.
//
// NEVER SILENT is the through-line (world-model law 1, applied to audio): a fallback, a missing
// voice, an engine that answers 'not-implemented' — none of them turn an alert into nothing.
// The only things that produce silence are the alerts module's own master MUTE, an empty
// utterance, and the e2e channel.
//
// THE E2E CHANNEL NEVER UTTERS. `npm run test:e2e` runs beside the user's game (AGENTS.md: no
// window is ever shown, the store is a temp dir). A headless test that spoke out loud would be
// the single most intrusive thing this repo does. So `speak()` records the utterance on
// `window.__eqSpeech` and returns BEFORE any engine is touched whenever `window.eq.isE2E` is
// true — and that same recording ring is what the e2e spec asserts against, which is the point:
// the test observes the seam, not the sound card.
//
// NODE-TESTABLE BY CONSTRUCTION. `speechPlan` and `pickVoice` are pure and carry the two
// decisions worth pinning (what a firing does with sound vs speech; which voice a stored id
// resolves to), so they are unit-tested with no DOM at all. Nothing at module scope touches
// `window`. Value imports from `shared/` are RELATIVE, never `@shared/*` — the repo-wide rule
// for anything node:test loads (AGENTS.md toolchain gotchas, the mobSearch.ts precedent).

import type {
  AlertAudioChoice,
  AlertDef,
  FiredAlert,
  SpeechEngine,
  SpeechSayResult,
  SpeechUnavailableReason,
  SpeechVoice,
  VoicePrefs
} from '@shared/types'
import {
  DEFAULT_VOICE_PREFS,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  resolveAlertAudio,
  speechTextFor
} from '../../../shared/speechText'

// ------------------------------------------------------------------ the pure decisions

/**
 * What ONE firing of an alert should actually do. The whole sound-vs-speech question, decided
 * in one pure function so the firing path, the editor's preview and the tests agree.
 *
 *  - `sound`  play the def's pack sound.
 *  - `speak`  the utterance, or null for "say nothing".
 *
 * EXACTLY ONE OF THEM IS EVER SET (JOS-362). There used to be a third field, `after`: the 'both'
 * contract (D5) played the sound FIRST and queued the utterance behind it. That channel is retired
 * — "also remove sound + spoken - too much garbage" (owner, 2026-08-14) — so a plan is now one
 * channel or none, and `resolveAlertAudio` is where a def still storing 'both' picks its side.
 */
export interface SpeechPlan {
  sound: boolean
  speak: string | null
}

const SILENT: SpeechPlan = { sound: false, speak: null }
const SOUND_ONLY: SpeechPlan = { sound: true, speak: null }

/**
 * Resolve a def + firing into what to play.
 *
 * MUTE IS ABSOLUTE. The alerts module's master mute is a promise that the app makes no noise;
 * speech is noise. A muted module speaks nothing, whatever the voice prefs say (§2).
 *
 * THE DEF'S OWN `audio` IS THE WHOLE SWITCH (owner, 2026-08-04). This function used to take the
 * voice prefs and degrade 'speech'/'both' to the pack sound whenever a global `VoicePrefs.enabled`
 * was off — which is why a row switched to "Voice (spoken)" played its old sound instead of
 * talking, in the preview AND in a real firing, with nothing on screen saying why. That switch is
 * gone (schema v8): an alert with `audio:'speech'` speaks, full stop. Prefs still decide WHICH
 * voice says it — that is `speak()`'s job, one layer down, and it is a configuration rather than
 * a permission.
 *
 * There is still exactly one way a speaking alert falls back to its sound: nothing truthful to
 * say (`speechTextFor` resolved to null — a nameless def with an empty phrase). Silence is never
 * the answer for an alert the user can see is enabled.
 *
 * THE RETIRED 'both' RESOLVES HERE TOO, through the same `resolveAlertAudio` the two pickers read
 * (JOS-362). That shared call is the point: a def whose row says "Voice (spoken)" must not play a
 * sound, and one shown on a pack must not talk — the split-brain that a second interpretation of
 * `audio` in the firing path would create is exactly the bug class the global voice switch was.
 */
export function speechPlan(
  def: Pick<AlertDef, 'name' | 'audio' | 'speech'>,
  firing: Pick<FiredAlert, 'spell'> | null,
  muted: boolean
): SpeechPlan {
  if (muted) return SILENT
  const action: AlertAudioChoice = resolveAlertAudio(def)
  if (action === 'sound') return SOUND_ONLY
  const text = speechTextFor(def, firing)
  if (!text) return SOUND_ONLY
  return { sound: false, speak: text }
}

/** The minimum a voice has to state for `pickVoice` to match it (a `SpeechSynthesisVoice` does). */
export interface VoiceLike {
  name: string
  voiceURI?: string
  lang?: string
}

/**
 * The id a stored pref holds for one system voice. `voiceURI` is the stable identifier Chromium
 * gives (`urn:moz-tts:sapi:Microsoft David - English (United States)?en-US`); `name` is the
 * fallback for engines that state no URI.
 */
export function voiceIdOf(voice: VoiceLike): string {
  return voice.voiceURI ?? voice.name
}

/**
 * Resolve a stored voice id against the voices this machine actually has, or null for "let the
 * engine choose".
 *
 * WHY THIS IS FUZZY-ON-PURPOSE-AND-BOUNDED. A voice id is persisted (and can arrive in an
 * imported settings bundle) but the voice LIST is per-machine: SAPI voice URIs differ between
 * Windows builds while the human name ("Microsoft David Desktop") is stable. So the match walks
 * exact URI → exact name → case-insensitive URI → case-insensitive name and then STOPS. It
 * never falls back to "the first voice", because picking a stranger's voice is worse than the
 * engine's own default, and it never substring-matches (AGENTS.md law 12: renames are
 * knowledge, not spelling).
 */
export function pickVoice<T extends VoiceLike>(
  voices: readonly T[],
  wanted: string | null | undefined
): T | null {
  if (!wanted) return null
  const exact = voices.find((v) => voiceIdOf(v) === wanted || v.name === wanted)
  if (exact) return exact
  const lower = wanted.toLowerCase()
  return voices.find((v) => voiceIdOf(v).toLowerCase() === lower || v.name.toLowerCase() === lower) ?? null
}

/** Clamp a number into [lo, hi]; anything non-finite becomes `fallback`. */
function clamp(value: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(hi, Math.max(lo, value))
}

// ------------------------------------------------------------------ the prefs cache

// The voice prefs are main-owned (electron-store) but read on EVERY firing, so the renderer
// keeps one hydrated copy here — beside the engine that consumes it — rather than making each
// of the three call sites own its own async read. `loadVoicePrefs()` hydrates it, the
// preferences panel pushes updates through `applyVoicePrefs()`, and `currentVoicePrefs()` is
// the synchronous read every caller uses.

let prefs: VoicePrefs = DEFAULT_VOICE_PREFS

export function currentVoicePrefs(): VoicePrefs {
  return prefs
}

/** Adopt prefs the app already has in hand (the preferences panel, after a successful save). */
export function applyVoicePrefs(next: VoicePrefs): void {
  prefs = next
}

/** Re-read the prefs blob from main. Never rejects — a failed read keeps the last known copy. */
export async function loadVoicePrefs(): Promise<VoicePrefs> {
  try {
    prefs = await window.eq.getVoicePrefs()
  } catch {
    // Keep whatever we had; speech simply behaves as it did a moment ago.
  }
  return prefs
}

// ------------------------------------------------------------------ system-tier voices

/**
 * `speechSynthesis.getVoices()` IS ASYNC IN DISGUISE. On a cold renderer it returns an EMPTY
 * array and fires `voiceschanged` once the platform's voice list has actually loaded — so a
 * picker built from the first call renders "no voices" forever, and an utterance built from it
 * silently gets the default voice. This is the dance: answer immediately when the list is
 * already there, otherwise wait for the event, with a deadline so a platform that never fires
 * it (or has genuinely zero voices) resolves empty instead of hanging.
 *
 * The promise is cached because the list is stable for the app's lifetime — EXCEPT when it
 * resolved empty, which is the one answer worth retrying.
 */
const VOICES_TIMEOUT_MS = 2000
let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
}

export function loadSystemVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesPromise) return voicesPromise
  const s = synth()
  if (!s) return Promise.resolve([])
  const ready = s.getVoices()
  if (ready.length) {
    voicesPromise = Promise.resolve(ready)
    return voicesPromise
  }
  voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      s.removeEventListener('voiceschanged', finish)
      resolve(s.getVoices())
    }
    timer = setTimeout(finish, VOICES_TIMEOUT_MS)
    s.addEventListener('voiceschanged', finish)
  }).then((list) => {
    // An empty answer is not knowledge — drop the cache so the next caller asks again.
    if (!list.length) voicesPromise = null
    return list
  })
  return voicesPromise
}

/** Forget the cached voice list (the preferences panel's refresh). */
export function forgetSystemVoices(): void {
  voicesPromise = null
}

/** One tier's voices, in the shared shape the pickers render. Never rejects. */
export async function listVoices(engine: SpeechEngine): Promise<SpeechVoice[]> {
  if (engine === 'kokoro') {
    try {
      return await window.eq.speechVoices()
    } catch {
      return []
    }
  }
  const voices = await loadSystemVoices()
  return voices.map((v) => ({
    id: voiceIdOf(v),
    label: v.name,
    engine: 'system' as const,
    ...(v.lang ? { lang: v.lang } : {})
  }))
}

// ------------------------------------------------------- is there a voice to speak with?

/**
 * The ONE thing that can still stand between "this alert says it speaks" and "you hear words",
 * now that the master switch is gone. The first two are SETUP states, not errors:
 *
 *  - 'engine-not-installed' → the natural (Kokoro) tier is selected but its ~115 MB pack is not
 *    downloaded. Speech still happens — `speak()` falls back to the system voice and warns once —
 *    so this is "not the voice you asked for", not silence.
 *  - 'no-voices' → the system tier has no voices at all (a stripped Windows image, a platform
 *    with no `speechSynthesis`). This one IS silence, and it is the only one that is.
 *
 * …and the last two are JOS-247: the pack IS downloaded and it still is not the voice you hear.
 *
 *  - 'engine-failed' → main tried and produced no audio.
 *  - 'engine-unloadable' → main cannot even load the engine on this PC (ERR_DLOPEN_FAILED).
 *
 * THE DIFFERENCE BETWEEN THE FIRST TWO AND THE LAST TWO IS WHERE THE FACT COMES FROM, and it is
 * why they cannot all be derived by `speechSetupGap`. A setup gap is a property of the INVENTORY
 * and is knowable by asking; an engine fault is only ever knowable by having TRIED, because a
 * downloaded pack whose worker dies enumerates its 54 voices perfectly (`speech:voices` reads
 * the file, not the engine). That is exactly the reporter's screen: a full picker, a natural
 * voice selected, and every alert in the default Microsoft voice. So the fault is LATCHED from
 * the first failed utterance (below) and merged in by `useSpeechSetup`.
 *
 * Null means there is nothing to say about setup.
 */
export type SpeechSetupGap = 'engine-not-installed' | 'no-voices' | 'engine-failed' | 'engine-unloadable'

/** The subset of the above that only a failed utterance can reveal. */
export type SpeechEngineFault = 'engine-failed' | 'engine-unloadable'

/**
 * Resolve a tier + its actual voice inventory into the gap, if any. Pure, so the annotation the
 * alert row and the editor render is one decision rather than two lookalike conditionals.
 *
 * The caller must only pass a LOADED inventory: `[]` from a system tier that is still doing the
 * `voiceschanged` dance means "not yet", not "none", and flashing "no voices" for 200 ms on every
 * row would be a lie with a UI attached (see `useSpeechSetup`).
 */
export function speechSetupGap(engine: SpeechEngine, voices: readonly unknown[]): SpeechSetupGap | null {
  if (voices.length > 0) return null
  return engine === 'kokoro' ? 'engine-not-installed' : 'no-voices'
}

/**
 * What each gap MEANS, in the user's terms. The link that follows it is the fix.
 *
 * The 'engine-unloadable' line NAMES A REMEDY, which no other note here does, and it is allowed
 * to because the remedy was measured rather than guessed: the shipped `onnxruntime_binding.node`
 * and `onnxruntime.dll` import VCRUNTIME140/VCRUNTIME140_1/MSVCP140 (PE import tables, 2026-08-12)
 * and Electron ships none of them, so a PC without the Microsoft Visual C++ x64 runtime fails to
 * load the engine in exactly this way. It says "usually" because a dlopen can fail for other
 * reasons (an antivirus quarantine of the same files is the other realistic one) and this app
 * cannot see which happened.
 */
export const SPEECH_SETUP_NOTES: Record<SpeechSetupGap, string> = {
  'engine-not-installed': 'The natural voice isn’t downloaded - a Windows voice speaks until it is.',
  'no-voices': 'This machine has no speech voices installed.',
  'engine-failed':
    'The natural voice is downloaded but could not speak - a Windows voice is speaking instead.',
  'engine-unloadable':
    'The natural voice is downloaded but will not start on this PC - a Windows voice is speaking ' +
    'instead. Installing the Microsoft Visual C++ x64 runtime usually fixes it.'
}

// ------------------------------------------------------- the engine fault, once it has spoken

/**
 * THE LATCH. `speak()` is the only thing in this app that ever learns the downloaded tier does
 * not work, and before JOS-247 the only thing it did with that knowledge was `console.warn`
 * once — so a user whose natural voice had never once worked saw a perfectly healthy picker and
 * had no way to find out. This holds the fault so the UI can state it.
 *
 * IT IS STICKY FOR THE SESSION, on purpose. The engine's own failure is latched in main (a
 * thread that could not load its native module cannot load it later), and a phrase said BEFORE
 * the failure is served from the wav cache and still succeeds — so clearing this on the next
 * success would blink the note off for a cached word and back on for a new one. "The natural
 * voice failed this session" stays true either way.
 *
 * Deliberately module state and not React state: `speak()` is called from the alert firing path,
 * the row's ▶ and the preferences preview, none of which are inside a component.
 */
let engineFault: SpeechEngineFault | null = null
const faultListeners = new Set<(fault: SpeechEngineFault | null) => void>()

/** The fault this session has seen, or null while the tier has never failed. */
export function speechEngineFault(): SpeechEngineFault | null {
  return engineFault
}

/**
 * Subscribe to changes of the session's fault. Returns the unsubscribe.
 *
 * It carries `null` as well as a fault since JOS-274 — because there is now exactly one thing
 * that can UNDO one. See `clearSpeechEngineFault`.
 */
export function onSpeechEngineFault(
  listener: (fault: SpeechEngineFault | null) => void
): () => void {
  faultListeners.add(listener)
  return () => faultListeners.delete(listener)
}

/**
 * Record what a failed `speech:say` said about itself. Only the two ENGINE faults latch:
 * 'engine-not-installed' is already visible everywhere as a setup gap (the picker says "not
 * installed", the row links to Preferences), and latching it would double every one of those.
 */
export function noteSpeechEngineFault(reason: SpeechUnavailableReason): void {
  if (reason !== 'engine-failed' && reason !== 'engine-unloadable') return
  if (engineFault === reason) return
  engineFault = reason
  for (const listener of faultListeners) listener(reason)
}

/**
 * Forget the session's fault, and TELL the subscribers — the sticky-for-the-session rule, and
 * its one exception (JOS-274).
 *
 * The rule's premise is that nothing between one alert and the next changes whether a native
 * module can be loaded. Finishing a voice install now can: the same run provisions the Microsoft
 * Visual C++ runtime beside the engine, main unlatches its own fault, and the next utterance
 * really does go to Kokoro. Leaving "will not start on this PC" on screen after that would be
 * the mirror image of the bug JOS-247 fixed — a true sentence about a machine that has since
 * been repaired.
 *
 * Called from the Voice panel on a completed install, and nowhere else. If the repair did not
 * take, the very next failed utterance re-latches within seconds, so the honest worst case is a
 * note that blinks rather than one that lies.
 */
export function clearSpeechEngineFault(): void {
  if (engineFault === null) return
  engineFault = null
  for (const listener of faultListeners) listener(null)
}

/** Tests only: forget the session's fault so cases do not leak into each other. */
export function resetSpeechEngineFault(): void {
  clearSpeechEngineFault()
}

// ------------------------------------------------------------------ the e2e / test hook

/**
 * One recorded utterance. `uttered` is the whole point: it says whether an engine was actually
 * reached, so the e2e spec can assert BOTH that the seam was invoked and that the e2e channel
 * stayed quiet — two claims one boolean would conflate.
 */
export interface SpokenRecord {
  text: string
  engine: SpeechEngine
  voiceId: string | null
  uttered: boolean
  ts: number
}

/** Bounded: this is a debugging/e2e window, never a log. */
const SPOKEN_CAP = 50

interface SpeechTestHook {
  spoken: SpokenRecord[]
}

function hook(): SpeechTestHook | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { __eqSpeech?: SpeechTestHook }
  w.__eqSpeech ??= { spoken: [] }
  return w.__eqSpeech
}

function record(entry: SpokenRecord): void {
  const h = hook()
  if (!h) return
  h.spoken.push(entry)
  if (h.spoken.length > SPOKEN_CAP) h.spoken.splice(0, h.spoken.length - SPOKEN_CAP)
}

/** True in the headless integration-test channel, where nothing may make a sound. */
function isE2E(): boolean {
  return typeof window !== 'undefined' && window.eq.isE2E
}

// ------------------------------------------------------------------ speaking

/**
 * Extra knobs on one utterance. `gain` is the alerts module's own effective volume (§2).
 *
 * WHICH VOICE IS NOT ONE OF THEM (JOS-362). There used to be a `voiceId` here — the per-alert
 * override (`AlertSpeech.voiceId`), passed by the firing path and by the editor's preview. The
 * owner retired the whole idea: "our settings shouldn't store which voice per alert, only the
 * preferences should (within Voice (spoken))". Every utterance now takes its voice from the prefs
 * blob it is handed, so changing the voice in Preferences changes every spoken alert at once —
 * structurally, not by convention: there is no argument left with which to say otherwise.
 */
export interface SpeakOptions {
  /** 0..1 multiplier applied on top of `VoicePrefs.volume` — the alerts master × per-alert volume. */
  gain?: number
}

/** Warn once per session, not once per alert: a fallback is a state, not an event stream. */
let warnedFallback = false

function warnKokoroFallback(reason: string): void {
  if (warnedFallback) return
  warnedFallback = true
  // A DIAGNOSTIC, not an error: nothing failed for the user (they still hear their alert), so
  // this must not reach `reportError`/errors.log, which is the channel for things that broke.
  // `console.warn` is the tree's own convention for exactly that (main/errorLog.ts logWarn).
  // eslint-disable-next-line no-console
  console.warn(
    `[everquest-companion] voice: the downloaded speech engine is unavailable (${reason}) - ` +
      'speaking with the system voice instead.'
  )
}

/**
 * Say something. The ONE entry point; every caller in the app funnels through it.
 *
 * Resolves once the utterance has been HANDED to an engine, not when it finishes — an alert
 * must not make the firing path wait on speech synthesis.
 */
export async function speak(text: string, voicePrefs: VoicePrefs, opts: SpeakOptions = {}): Promise<void> {
  const said = text.trim()
  if (!said) return
  const voiceId = voicePrefs.voiceId
  const uttered = !isE2E()
  record({ text: said, engine: voicePrefs.engine, voiceId, uttered, ts: Date.now() })
  if (!uttered) return
  if (voicePrefs.engine === 'kokoro') {
    const ok = await sayThroughEngine(said, voicePrefs, opts)
    if (ok) return
    // Fall through: the downloaded tier is not there yet, and an alert that says nothing is
    // worse than one that says it in the wrong voice.
  }
  speakSystem(said, voicePrefs, opts)
}

/** The Kokoro tier: main synthesizes + caches and hands back a playable url. False ⇒ fall back. */
async function sayThroughEngine(
  text: string,
  voicePrefs: VoicePrefs,
  opts: SpeakOptions
): Promise<boolean> {
  let result: SpeechSayResult
  try {
    const voiceId = voicePrefs.voiceId
    result = await window.eq.speechSay({ text, ...(voiceId ? { voiceId } : {}) })
  } catch {
    warnKokoroFallback('the speech channel is unavailable')
    return false
  }
  if (!result.ok) {
    // The console warning stays a once-per-session DIAGNOSTIC; the LATCH is what the UI reads.
    // Both, because they answer different questions: the warning tells a developer reading a dev
    // console what happened at 21:04, the latch tells the user why their voice is not the one
    // they picked, at whatever later moment they go looking.
    noteSpeechEngineFault(result.reason)
    warnKokoroFallback(result.reason)
    return false
  }
  const audio = new Audio(result.url)
  // Kokoro synthesizes at speed 1.0 (the cache key is (voice, text) — a baked-in
  // rate would make one key mean two sounds); the user's rate applies at PLAYBACK.
  audio.playbackRate = clamp(voicePrefs.rate, 0.5, 2, 1)
  audio.volume = clamp(voicePrefs.volume * (opts.gain ?? 1), 0, 1, 1)
  void audio.play().catch(() => undefined)
  return true
}

/** The system tier: Chromium's own synthesizer, right here in the renderer. */
function speakSystem(text: string, voicePrefs: VoicePrefs, opts: SpeakOptions): void {
  const s = synth()
  if (!s) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = clamp(voicePrefs.rate, MIN_SPEECH_RATE, MAX_SPEECH_RATE, DEFAULT_VOICE_PREFS.rate)
  utterance.volume = clamp(voicePrefs.volume * (opts.gain ?? 1), 0, 1, 1)
  // The voice list may still be loading on the very first alert of a session; in that case the
  // utterance goes out in the engine's default voice rather than waiting (an alert is late or
  // it is not an alert), and every later one gets the chosen voice.
  const voice = pickVoice(s.getVoices(), voicePrefs.voiceId)
  if (voice) {
    utterance.voice = voice
    if (voice.lang) utterance.lang = voice.lang
  }
  s.speak(utterance)
}
