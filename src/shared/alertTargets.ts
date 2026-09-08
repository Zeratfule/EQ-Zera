// alertTargets.ts — `{target}`, THE TOKEN THE APP FILLS IN ITSELF (JOS-353).
//
// THE FEATURE, in one sentence: an alert whose trigger names an event family that says WHO the
// spell is affecting may write `{target}` in its spoken phrase — `haste {target}`, `Mez broke on
// {target}` — and the app fills it in from the event it just matched, with NO regex to write and
// nothing to configure.
//
// THE OWNER'S RULING (2026-08-14, JOS-353, verbatim in intent): Companion parses which mob a spell
// is affecting and exposes it as a variable usable in alert text; it integrates with the existing
// capture-group work and MUST NOT require the user to write heavy regex or do custom intervention.
// Three reports asked for the same thing from two directions — fade alerts ("Soothe has worn off a
// Fire Giant", "Mez has dropped on a ghoul") and landing alerts.
//
// ============================================================================================
// HOW THIS SITS INSIDE shared/alertCaptures.ts's THREAT MODEL. READ THAT FILE FIRST.
// ============================================================================================
//
// `{target}` is a token in the same one-pass template language, resolved out of the same
// `FiredAlert.captures` map, through the same `applyCaptures` replacer. Controls 1, 2 and 5 of
// that model apply to it UNCHANGED and are re-enforced here: every value returned below has been
// through `sanitizeCapture`, so it is one line, control-character-free, BiDi-free and capped at
// MAX_CAPTURE_CHARS before anything can speak it.
//
// CONTROL 3 (a value comes only from the event the def's own condition matched) HOLDS, and holds
// literally. `resolveTarget` is handed the SAME `LogEvent` the alert just fired on — not a
// previous one, not another alert's, not app state, not the clock. There is still no path to a
// line this def did not match.
//
// CONTROL 4 (a token is a DECLARATION, not a lookup) IS THE ONE THAT MOVES, and this file is the
// argument for why that is safe. Before this, a `{token}` resolved only if the def's own pattern
// wrote `(?<token>…)`, which is what made a stranger's shared def READABLE: every value it could
// speak was visible in the pattern printed above it. `{target}` is not declared by a pattern. Four
// things keep the property that matters:
//
//   a. IT IS ONE NAME, NOT A NAMESPACE. `AUTO_TOKEN_NAMES` is a closed, one-element list. There is
//      no `{C}` for your character, no `{L}` for the line, no `{zone}`, no `{time}` — and adding
//      one is a deliberate edit to this file, not a consequence of a pattern someone else wrote.
//      GINA's `{L}` — "put the whole matched line in the utterance" — remains exactly as
//      unreachable as it was, because nothing here can name a line.
//
//   b. THE VALUE IS A PARSER-EXTRACTED ENTITY, NEVER FREE TEXT. `TARGET_FIELD_BY_KIND` is a CLOSED
//      TABLE over event kinds, and each entry names one field the parser filled from a structured
//      capture of a game-authored sentence — the mob a debuff landed on, the entity a buff faded
//      from. It is the same shape of table, written for the same reason, as
//      `SPELL_FIELD_BY_KIND` in main/modules/alertsFields.ts. A kind that is not in the table
//      resolves to nothing at all, so a `raw` trigger that matched a CHAT line gets no value: the
//      chat families are not in the table and cannot be, which is what keeps a stranger's typed
//      words out of the one token that does not need declaring.
//
//   c. THE READABILITY PROPERTY IS KEPT BY THE EDITOR, NOT LOST. `autoTokenNamesFor(trigger)`
//      answers "which of these does THIS trigger fill?", and SpeechBlock's capture hint prints the
//      answer beside the pattern's own groups. So a def that arrived in somebody else's share
//      string still shows you the complete finite list of values it is able to say — the property
//      control 4 exists for — it is simply computed from the trigger's KINDS as well as from its
//      regexes.
//
//   d. IT ADDS NO EXPOSURE THAT DECLARING A GROUP DID NOT ALREADY HAVE. Anything `{target}` can
//      say, a shared def could already have said by writing `(?<target>…)` into a `raw` pattern
//      over the same line — with a LOOSER character class than the parser's, which is the strictly
//      worse version. This is a convenience over an existing capability, not a new channel.
//
// AND THE VALUE ONLY LEAVES MAIN IF THE PHRASE ASKED FOR IT. main/modules/alerts.ts computes the
// wanted set at COMPILE time from the def's own phrase (`autoTokensWanted`), so an alert that never
// writes `{target}` carries no target on its firing and its `module:delta` stays byte-identical to
// what it was before this file existed. That is a bound on the IPC surface and on what any future
// consumer of `FiredAlert.captures` can see, and it is enforced at the producer.
//
// PURE, like every other module in `src/shared/**`: no `node:`, no Electron, no DOM.

import { sanitizeCapture, tokensIn } from './alertCaptures'
import type { AlertTrigger } from './alertTypes'
import type { LogEvent } from './logEvents'

/**
 * EVERY kind the parser can emit — deliberately NOT `alertTypes.ts`'s curated `LogEventKind`,
 * which is the smaller set the editor's kind picker offers.
 *
 * The table below is asked its question by a `raw` trigger too, and a raw trigger fires on
 * whatever kind the line it matched turned out to be — including the parser-internal ones the
 * picker withholds (`ccWake` is the standing example). Keying on the curated union would leave a
 * hole exactly where the answer is least predictable.
 */
type ParsedKind = LogEvent['kind']

/**
 * Every token the app fills in by itself. ONE name, on purpose — see (a) in the header.
 *
 * `target` reads as English in the phrases users actually write ("haste {target}", "Mez broke on
 * {target}") and it is the word the reports used. It is deliberately NOT `mob`: half the families
 * below name a player or a pet, and a token that says "mob" while speaking your groupmate's name
 * is a token that lies about what it is.
 */
export const AUTO_TOKEN_NAMES = ['target'] as const

export type AutoTokenName = (typeof AUTO_TOKEN_NAMES)[number]

/**
 * How ONE event kind says who it is about: the field to read, and — for the one family that omits
 * the field to MEAN something — what an absent value stands for.
 */
interface TargetField {
  /** The LogEvent field holding the entity's display name. */
  field: string
  /**
   * What an ABSENT field means, when absence is itself a statement. Only `buffFade` has one:
   * `Your <Spell> spell has worn off.` with no "of <mob>" and no "pet's" is the SELF form, and
   * the parser omits `target` for exactly that shape (log/parseCasts.ts). Everywhere else an
   * absent field is an absent answer and the token renders literally.
   */
  absent?: string
}

/**
 * WHICH FIELD OF WHICH KIND NAMES THE ENTITY — the closed table, and control (b) of the header.
 *
 * Every entry was read off shared/logEvents.ts, not assumed. The families divide into three
 * groups and all three are here because a user asking "who did this land on" does not care which
 * of the parser's kinds carried the answer:
 *
 *   THE SPELL LANES — the ticket's own subject. `buffApply` (the debuff landing on a mob, the
 *   buff landing on you), `buffExpired` (the RESOLVED wear-off, 'self' or the bound entity),
 *   `buffWearOff` and `illusionFade` (always 'self' — the emote prints to the holder), `buffFade`
 *   (a named mob, 'pet', or the self form above), `resist`, `heal`, `healUnstated`, `poisonProc`.
 *
 *   THE HOLD LANES, which spell it `mob` rather than `target` — and this is the whole reason the
 *   table exists rather than a property read. `cc` is the mez/root landing AND the break
 *   (`refresh:true`) the reports quoted; `ccWake` is the hold ending because something hit it;
 *   `charm`/`uncharm` are the charm pair. A user writing `{target}` on a mez-break alert must not
 *   have to know the parser calls it `mob`.
 *
 *   THE COMBAT LANES — `damage` and `miss`. A nuke alert saying which mob it hit is the same
 *   question with a different verb, and `damage.target` is already what `cooldownScope:'target'`
 *   keys its per-mob clock by.
 *
 * `spellEmote.subject` is here too: it is 'self' or the pet name, resolved exactly like the rest.
 *
 * EXCLUDED, and the exclusion is the point of `TARGET_FIELD_EXCLUDED_KINDS` below: every OTHER
 * kind in the union carries no entity field at all, with one trap that does — `itemMergeFailed`
 * spells an ITEM name `target`. Speaking a Coldain Prayer Shawl as the mob a spell is affecting
 * would be a wrong answer wearing the right field name, so it is refused by name and pinned by
 * tests/alertTargetToken.test.mts, which re-reads shared/logEvents.ts and fails when a NEW kind
 * grows an entity field without a ruling here.
 */
export const TARGET_FIELD_BY_KIND: Partial<Record<ParsedKind, TargetField>> = {
  buffApply: { field: 'target' },
  buffExpired: { field: 'target' },
  buffWearOff: { field: 'target' },
  buffFade: { field: 'target', absent: 'self' },
  illusionFade: { field: 'target' },
  cc: { field: 'mob' },
  ccWake: { field: 'mob' },
  charm: { field: 'mob' },
  uncharm: { field: 'mob' },
  resist: { field: 'target' },
  heal: { field: 'target' },
  healUnstated: { field: 'target' },
  poisonProc: { field: 'target' },
  spellEmote: { field: 'subject' },
  damage: { field: 'target' },
  miss: { field: 'target' }
}

/**
 * Kinds that carry an entity-shaped FIELD NAME and are refused anyway, with the reason. The audit
 * test walks shared/logEvents.ts and requires every `target`/`mob`/`subject` field to be in the
 * table above or on this list — so a future kind cannot join either silently.
 */
export const TARGET_FIELD_EXCLUDED_KINDS: Partial<Record<ParsedKind, string>> = {
  // `Your request to merge <target> with <component> failed.` — `target` is an ITEM, not an
  // entity. The one field in the whole union whose name means something else.
  itemMergeFailed: 'the field names an ITEM being merged, not an entity',
  // `/con` sizes a mob up. It is an entity, and no spell is affecting it — the token means "who
  // this spell is on", and a consider line is about nothing but your own curiosity.
  consider: 'a con names a mob no spell is touching'
}

/**
 * THE SENTINELS THE PARSER WRITES, AND WHAT THEY ARE ALOUD.
 *
 * `self` and `pet` are not names — they are the parser's words for "the first-person form" and
 * "the `Your pet's …` form" (log/parseCasts.ts, logEvents.ts). Speaking them raw would say
 * "Clarity wore off self", which is nobody's sentence. Rendering them as English is a reading of
 * the parser's own vocabulary, not a guess about the world.
 *
 * MATCHED EXACTLY, never case-folded, and that matters: the sentinels are lowercase literals the
 * parser writes itself, while a real name arrives with the game's own casing. A player named
 * `Self` yields the string `Self` and is spoken as `Self`, which is their name.
 */
const SENTINEL_SPEECH: Record<string, string> = {
  self: 'you',
  pet: 'your pet'
}

/**
 * WHO THIS EVENT IS ABOUT, ready to speak — or null when this family names nobody.
 *
 * Null (rather than an empty string) is what makes the token render LITERALLY, which is
 * `applyCaptures`'s documented behaviour for a value that is not there: `Mez broke on {target}` is
 * a legible, debuggable sentence, and `Mez broke on` is a different and quietly wrong one.
 *
 * The dynamic field read mirrors the one every `where` matcher has always done (an alert `where`
 * key names an arbitrary field of an arbitrary event), so this opens no new escape hatch — and it
 * is bounded to the table's own field names, never to a key any def supplies.
 */
export function resolveTarget(ev: LogEvent): string | null {
  const spec = TARGET_FIELD_BY_KIND[ev.kind]
  if (!spec) return null
  const raw = (ev as unknown as Record<string, unknown>)[spec.field]
  const text = typeof raw === 'string' ? raw.trim() : ''
  // `||` on the left, deliberately: an EMPTY field is as absent as a missing one, and the fallback
  // has to answer for both. `??` would let a whitespace-only target win over the stated meaning.
  const value = text || (spec.absent ?? '')
  if (!value) return null
  // Sanitize AFTER the sentinel read, so a sentinel is matched against exactly what the parser
  // wrote, and BEFORE anything can speak it — this is the boundary alertCaptures.ts's control 1
  // says every value crosses, and it is crossed here rather than trusted to a caller.
  return sanitizeCapture(SENTINEL_SPEECH[value] ?? value)
}

/**
 * The auto tokens THIS TRIGGER can fill — what the editor prints beside the pattern's own capture
 * groups (control (c) of the header), and what the module compiles against.
 *
 * A composite contributes every condition's answer, exactly as `captureNamesIn` does and for the
 * same reason: an 'any' fires on whichever condition matched, so all of them are reachable.
 *
 * A `raw` condition answers YES for `{target}`. It has to: a raw trigger tests `ev.raw` and fires
 * on whatever kind that line parsed into, which for the shipped `landsOnOther` pattern is a real
 * `buffApply`. The honest statement to the user is "this may fill in" rather than "this cannot" —
 * and when the line parses into a kind the table does not carry, the token renders literally,
 * which is visible. An 'app' condition answers no: a renderer-evaluated signal never sees a
 * LogEvent at all.
 */
export function autoTokenNamesFor(trigger: AlertTrigger): AutoTokenName[] {
  const conditions = 'conditions' in trigger ? trigger.conditions : [trigger]
  for (const c of conditions) {
    if (c.type === 'raw') return [...AUTO_TOKEN_NAMES]
    if (c.type === 'event' && TARGET_FIELD_BY_KIND[c.kind]) return [...AUTO_TOKEN_NAMES]
  }
  return []
}

/**
 * The auto tokens a PHRASE actually writes — the compile-time gate that keeps a target off every
 * firing that never asked for one (see the header's last paragraph).
 *
 * Reads the phrase, not the trigger: whether a value is worth carrying is a question about what
 * the def will SAY. A def with no custom phrase wants nothing.
 */
export function autoTokensWanted(phrase: string | undefined): AutoTokenName[] {
  if (!phrase) return []
  const used = new Set(tokensIn(phrase))
  return AUTO_TOKEN_NAMES.filter((t) => used.has(t))
}
