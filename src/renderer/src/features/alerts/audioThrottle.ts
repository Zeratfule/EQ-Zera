// audioThrottle.ts — CROSS-ALERT audio coalescing: "if three buffs fade at once, that is one
// audio alert" (owner direction, 2026-08-04).
//
// THE PROBLEM THIS SOLVES IS NOT COOLDOWN. Each AlertDef already has its own `cooldownMs`,
// which stops ONE alert from repeating. It says nothing about three DIFFERENT alerts landing in
// the same tick — a Quick Buff burst, a zone-in, an AoE that fades four buffs at once — and
// those are exactly the moments the app was loudest and least useful: four sounds stacked into
// a smear that carries less information than one. So this is a second, orthogonal gate applied
// ACROSS alerts, on top of every def's own cooldown, which is untouched.
//
// WHAT IT GATES IS AUDIO, NOT FIRING. A suppressed firing still fires: main's evaluation,
// cooldowns, and the recent-fires ring are all upstream of here and see every fire. The record
// is not the noise. What is dropped is the second, third and fourth SOUND — and the speech with
// it, because "one audio alert" is a claim about what you HEAR, not about which channel it came
// out of. Since JOS-362 a firing is one channel or the other (the combined 'both' is retired), so
// an occupancy is one sound or one utterance and the question of charging a def twice is moot.
//
// THE WINDOW COALESCES BY WHAT WOULD BE HEARD, NOT BY OCCUPANCY (JOS-347). It used to hold a
// single timestamp, so the FIRST firing in a burst silenced every other firing in it whatever
// they had to say. That is right for the case the rule was written for and wrong for the case
// that reported it, and the difference is the whole cut:
//   * THREE BUFFS FADING is three `wearsOff` alerts, and the suggestion builder gives every
//     alert of one template the SAME pack sound with no speech — three firings that would be
//     heard as the same 0.8 seconds of audio. Playing it three times says nothing the first
//     playing did not. Still ONE audio alert, exactly as the owner asked.
//   * A BARD'S FOUR TUYEN CHANTS resisting in one song pulse is four alerts the user
//     deliberately gave four DIFFERENT voice lines, precisely so they could be told apart —
//     and MEASURED against the owner's own log, a bard's songs all re-apply in the SAME
//     six-second tick, so their resist lines arrive in one batch, in one delta, in one
//     synchronous play loop. Under a timestamp window that is not a burst, it is a permanent
//     mute: the earliest-created def is evaluated first, wins the channel every pulse, and the
//     other three are never audible once. The reporter's words were "only the first alert is
//     ever played, and it seems to play for any spell or song that I cast and gets resisted"
//     (report 01KZZD3DF8V9XNFGQKGVB5562J) — which is what that mechanism sounds like from the
//     outside, because the firings themselves were always correct.
// So the window remembers the audible IDENTITIES already heard inside it (`audioIdentity` — the
// pack sound that would play plus the words that would be spoken). A firing repeating one of
// them is swallowed; a firing that would say something new is heard, ONCE, and joins the set.
// Nothing repeats inside a window and nothing distinct is lost — the smear the throttle exists
// to prevent is a stack of the SAME sound, and that is still exactly one sound.
//
// FIRST ARRIVAL OWNS THE CLOCK, and a suppressed firing does NOT extend the window. A rolling
// window would let a steady stream of alerts mute the app indefinitely; a fixed one always
// reopens. A firing that is heard for being distinct joins the set without moving `at`, so the
// window it is heard in still expires when the one that opened it does.
//
// PURE, so the whole policy is node-tested with no DOM and no clock: the caller owns the
// `AudioWindow` cell and the `now` reading, this file owns the decision.

import type { AlertDef } from '@shared/types'

/**
 * How long one played alert occupies the audio channel.
 *
 * 1500ms is a burst-coalescing window, deliberately NOT a rate limit and deliberately NOT a
 * user setting. It is long enough to fold the simultaneous cases the owner named (a
 * multi-buff fade, a zone-in, an AoE) into one utterance, and short enough that two things
 * that genuinely happened at different moments still both speak — a typical alert sound is
 * ~0.6-1.2s, so the next alert is audible as soon as the previous one has stopped talking
 * rather than queuing behind it. Making it configurable would be offering the user a dial for
 * "how much of my own log do I want to miss"; the two opt-outs below — this alert, or all of
 * them (JOS-222) — are the honest knob, because an opt-out states what it costs and a shorter
 * window would not.
 */
export const AUDIO_COALESCE_MS = 1500

/**
 * How many DISTINCT audible identities one window will hold before it stops admitting new ones.
 *
 * A backstop, not a policy: the window is 1.5 seconds wide and a firing has to say something no
 * other firing in it said, so reaching eight means eight different things genuinely happened at
 * once — at which point more audio carries less, which is the throttle's whole premise. It also
 * bounds the cell, which is carried across firings by the caller.
 */
export const AUDIO_DISTINCT_CAP = 8

/** The def fields the throttle reads. Any AlertDef satisfies it. */
export type ThrottledDef = Pick<AlertDef, 'alwaysPlay' | 'sound'>

/**
 * What a firing would actually be HEARD as, resolved by the caller (`speechPlan` has already
 * decided both halves by the time the throttle is asked). `sound` is false when the plan is
 * speech-only; `speak` is absent when nothing is spoken.
 */
export interface AudioPlanLike {
  sound: boolean
  speak?: string | null
}

/**
 * THE IDENTITY OF WHAT WOULD BE HEARD — the pack sound that would play and the words that would
 * be spoken, and nothing else.
 *
 * NOT the alert id, deliberately: two different alerts pointed at one sound with no speech are
 * indistinguishable to the person in the room, and folding them is the owner's rule. NOT the
 * alert NAME either — an unspoken name is not audio. The two halves are joined with a NUL, which
 * can appear in no pack id, no sound id and no spoken phrase, so no pair of identities can
 * collide by concatenation.
 */
export function audioIdentity(def: ThrottledDef, plan: AudioPlanLike): string {
  const sound = plan.sound ? `${def.sound.packId}\u0000${def.sound.soundId}` : ''
  return `${sound}\u0000${plan.speak ?? ''}`
}

/**
 * The audio channel's occupancy: when the current window opened, and everything already heard
 * inside it. `null` is an open channel.
 */
export interface AudioWindow {
  /** when the window OPENED. It expires AUDIO_COALESCE_MS after this, never later. */
  at: number
  /** every audible identity already played inside it, oldest first. */
  heard: readonly string[]
}

export interface ThrottleDecision {
  /** may this firing make a sound (and/or speak)? */
  play: boolean
  /** the caller's new window cell — write it back verbatim. */
  window: AudioWindow | null
}

/**
 * Decide whether this firing's audio plays, and what the audio channel's occupancy becomes.
 *
 * THE OPT-OUT BYPASSES **AND DOES NOT OCCUPY** (deliberate, of the two honest rules):
 * `alwaysPlay` marks an alert the user has said must never be swallowed — a raid wipe call, a
 * charm break. If such an alert also OPENED a window, the very act of protecting it would
 * silence the ordinary alert behind it, and two `alwaysPlay` alerts firing together would
 * silence each other — precisely the alerts that must not be silenced. So an opted-out firing
 * is transparent to the window in both directions: it ignores one, and it leaves whatever
 * window was already open exactly as it found it (a burst of ordinary alerts is still coalesced
 * around it).
 *
 * `opts.allAlwaysPlay` is the GLOBAL preference (JOS-222, `AlertPrefs.alwaysPlayAll`) and it is
 * the SAME rule with a wider subject: while it is on, every firing takes the opt-out's branch, so
 * no window is ever opened and none is ever consulted — the throttle is off, not loosened. It is
 * `false` by default at this signature too, so a caller that has not been taught about the
 * preference still gets the shipped behavior rather than a silent bypass.
 *
 * `opts.heard` is what this firing would sound like (`audioIdentity`). It defaults to the empty
 * identity so a caller that has not been taught about it gets the pre-JOS-347 behavior — one
 * identity for everything, therefore one audio alert per window — rather than a silent bypass.
 */
export interface CoalesceOptions {
  /** the global always-play preference (JOS-222). Absent ⇒ off, which is where it starts. */
  allAlwaysPlay?: boolean
  /** this firing's audible identity (`audioIdentity`). Absent ⇒ the empty one. */
  heard?: string
}

export function coalesceAudio(
  def: ThrottledDef,
  now: number,
  window: AudioWindow | null,
  opts: CoalesceOptions = {}
): ThrottleDecision {
  const heard = opts.heard ?? ''
  if (opts.allAlwaysPlay === true || def.alwaysPlay === true) return { play: true, window }
  if (window === null || now - window.at >= AUDIO_COALESCE_MS) {
    return { play: true, window: { at: now, heard: [heard] } }
  }
  if (window.heard.includes(heard) || window.heard.length >= AUDIO_DISTINCT_CAP) {
    return { play: false, window }
  }
  return { play: true, window: { at: window.at, heard: [...window.heard, heard] } }
}
