// alertCaptures.ts — CAPTURE GROUPS IN ALERT SPEECH (JOS-103). The one module that owns what a
// `{token}` in a spoken phrase means, where the value behind it may come from, and how far it is
// allowed to go.
//
// THE FEATURE, in one sentence: an alert whose pattern declares a NAMED capture group
// (`(?<player>…)`) may write `{player}` in its custom spoken phrase, and the alert says the text
// that group captured — "Puma on Fail" instead of "Puma landed".
//
// ============================================================================================
// THE THREAT MODEL. READ THIS BEFORE CHANGING ANYTHING BELOW.
// ============================================================================================
//
// ALERT DEFINITIONS ARE SHAREABLE. `shared/shareSchema.ts` encodes a set of AlertDefs into an
// `EQC1-` string that people paste to each other, and the app imports it. So a def in a user's
// store is not necessarily a def that user wrote.
//
// AND THE NEIGHBOURS SHOW HOW FAR THAT GOES. EQ Log Parser distributes trigger sets as
// `{EQLPT:<base64>}` / `{GINA:<sessionId>}` tokens SPOKEN IN CHAT: it watches group/guild/raid
// lines for them, fetches the GINA package over plaintext HTTP, and — if the sender's chat
// DISPLAY NAME is on a trusted list — merges the triggers with no prompt at all
// (`GinaUtil.CheckGina`). GINA itself ships `.gtp` packages and a moderated repository. "A
// stranger's trigger is running in your client" is the normal state of this ecosystem, not the
// worst case, which is why the controls below are properties of the RUNTIME rather than advice
// about who to trust.
//
// AND LOG LINES ARE ATTACKER-INFLUENCED. A `raw` trigger is tested against the whole log line.
// Lines carry other players' CHOSEN character and pet names, guild names, and — for the chat
// families the shipped `tells` group already subscribes to — text a stranger TYPED. A capture
// group is therefore a channel with a third party at each end: a pattern the USER did not write,
// selecting text a STRANGER did write, which the app then SPEAKS ALOUD or RENDERS.
//
// That is the whole of the risk. Five controls answer it, and each is enforced HERE plus once
// more at the boundary it protects (defense in depth — no single caller is trusted to have run
// the other's half):
//
//   1. THE SHARED SANITIZERS ARE UNCONDITIONAL. Every captured value goes through
//      `sanitizeOneLine` (shared/sanitizeText.ts): ANSI/VT escape sequences leave WHOLE (OSC 52
//      writes the operator's clipboard; `ESC c` resets a terminal), every C0/C1/DEL control is
//      deleted, CR/LF/TAB collapse to one space, and the invisible + BiDi-override class (the
//      "Trojan Source" family, which makes one string RENDER as another) is deleted. This is the
//      repo's law 3 applied to a new inlet: a captured value is DATA and must never be able to
//      speak to the surface that prints it. After it, terminal escapes and control characters are
//      inert — there is nothing left to be inert about.
//
//   2. A CAPTURE IS HARD-CAPPED WELL BELOW THE UTTERANCE CAP. `MAX_CAPTURE_CHARS` (48) is a
//      NAME's worth of text, not a LINE's worth: EQ character names are at most 15 characters and
//      the longest mob display names in the shipped 7.9k-row DB sit under 40. A hostile pattern
//      is free to write `(?<x>.+)` — it simply cannot vacuum a 300-character log line into your
//      speaker, because the value is cut to 48 before it reaches any consumer. The whole utterance
//      is still capped independently at MAX_SPEECH_CHARS (shared/speechText.ts); this cap exists
//      so that ONE token cannot spend the entire budget on one stranger's sentence.
//
//   3. WHAT MAY BE CAPTURED IS THE ALERT'S OWN MATCH, AND NOTHING ELSE. Values come only from the
//      def's OWN regexes, evaluated against the text that def's OWN condition already matched, on
//      an event the alert system already delivered to it. Concretely (main/modules/alerts.ts):
//        * a `raw` condition captures from `LogEvent.raw` — the line it just tested;
//        * an `event` condition's `/regex/`-form `where` matcher captures from the value of the
//          field it just tested, on the event kind the trigger names.
//      There is no path by which a def captures from a line it did not match, from an event kind
//      it did not subscribe to, from another alert's firing, or from app state. In particular
//      THERE ARE NO AMBIENT TOKENS — no `{C}` for your character name, no `{L}` for the whole
//      line, no file paths, no clock. GINA ships ambient tokens; this deliberately does not,
//      because an ambient token is a value a shared def can read WITHOUT the importing user's
//      pattern ever having declared it, and the declaration is the entire security property.
//
//   4. A TOKEN IS A DECLARATION, NOT A LOOKUP. `{player}` resolves only if the def's own pattern
//      wrote `(?<player>…)`. So a shared def's phrase can be READ: every value it can speak is
//      visible in the pattern printed above it in the editor, and `captureNamesIn` renders exactly
//      that list. This is why the design is NAMED-ONLY and rejects GINA's positional `{S1}`/`{S2}`
//      — a positional token cannot be understood without mentally executing a stranger's regex.
//      **ONE TOKEN IS EXEMPT SINCE JOS-353, AND IT IS A CLOSED LIST OF ONE**: `{target}` is filled
//      from a parser-extracted entity field of the very event this def matched, with no group
//      declared, because the owner's ruling is that naming the affected mob must not require the
//      user to write regex. The exemption's whole argument — why it is one name and not a
//      namespace, why the value can never be free text, and how the editor keeps the "you can read
//      what a shared def is able to say" property anyway — lives in shared/alertTargets.ts. Read it
//      before adding a second such token; the answer is meant to be hard to say yes to.
//
//   5. THE TEMPLATE LANGUAGE IS NOT A LANGUAGE. One left-to-right pass, plain substitution, and
//      that is the entire grammar (see `applyCaptures`): no nesting, no recursion, no re-scan of
//      substituted text, no defaults, no conditionals, no arithmetic, no formatting, no function
//      calls. An unknown token renders LITERALLY, so nothing is silently deleted. The substitution
//      uses a FUNCTION replacer, never a replacement STRING, so `$&` / `$1` / `` $` `` inside a
//      captured value are inert text rather than `String.prototype.replace` directives — a
//      captured name is never a program.
//
// WHAT THIS MODULE DOES NOT FIX, stated rather than hidden:
//
//   * A `raw` pattern can still match a line the author did not intend, including a CHAT line
//     that quotes the sentence the pattern is looking for. That is a property of raw triggers,
//     which shipped long before this, and the answer is pattern quality rather than a runtime
//     gate: `subjectCapturePattern` below anchors at the START of the line and captures a
//     NAME-SHAPED run, which is what makes it unreachable through a chat line (every EQ chat
//     shape puts `, '` between the speaker and the free text, and the name class admits neither).
//     Controls 1 and 2 bound what such a match can SAY; they do not prevent it from firing.
//   * A hostile pattern can still be catastrophically backtracking (`(a+)+b`). That is
//     pre-existing for every `raw` trigger and unchanged here — capture groups add no new
//     exposure to it, and the share importer's `new RegExp()` check is still only a validity
//     check. Worth its own ticket; not silently claimed as handled.
//
// ============================================================================================
// PRIOR ART, AND WHERE THIS DELIBERATELY DIVERGES (JOS-103 research, 2026-08-08).
// ============================================================================================
//
// Both established EQ trigger tools have this feature, and the design below is a response to
// what they do rather than a copy of it.
//
//   GINA (eq.gimasoft.com) — `{S}`, `{S1}`, `{S2}`… are POSITIONAL wildcards placed in the search
//   text and re-used in "Text to Say"; they compile to `(?<s#>.+)`. With "use regular
//   expressions" on it also accepts .NET's own `${1}` / `${name}` substitution. Plus AMBIENT
//   tokens: `{C}` (your character name) and `{L}` (the whole matched line).
//
//   EQ Log Parser (github.com/kauffman12/EQLogParser) — token regex
//   `\$?\{(?<name>[a-zA-Z0-9_]+)(?:\.(?<modifier>…)(?::(?<arg>…))?)?\}`, so `{name}` and
//   `${name}` both work, named regex groups resolve by name, GINA's `{S#}`/`{N#}` are translated
//   at compile time, and display text supports format modifiers (`{S1.capitalize}`,
//   `.padleft:n`, …). Unknown tokens are emitted verbatim.
//
// THREE DIVERGENCES, each for a stated reason:
//
//   A. NO AMBIENT TOKENS — AND `{target}` IS NOT ONE (JOS-353). `{C}` and `{L}` are APP STATE and
//      THE WHOLE LINE: values a stranger's def reads without any declaration, and `{L}` is
//      precisely the "put the entire log line into the utterance" primitive that control 2 exists
//      to prevent. Neither exists here and neither ever will. `{target}` is a different animal and
//      the distinction is the whole of shared/alertTargets.ts's header: it is ONE name from a
//      closed list, resolved from a CLOSED TABLE of parser-extracted entity fields on the ONE
//      event this def just matched, sanitized and capped by the same two controls as every other
//      value, and enumerated in the editor for the trigger the user is looking at. It can say a
//      mob's name; it cannot say a line, a clock, a path, or anything a stranger typed.
//
//   B. NAMED ONLY, NEVER POSITIONAL. `{S1}` cannot be understood without mentally executing a
//      stranger's regex; `{player}` can be read off the pattern. GINA's `{S#}` is additionally an
//      unbounded `.+` by definition, which is the opposite of control 2.
//
//   C. ONE PASS, NOT FIVE. This is the substantive one. EQ Log Parser's `ProcessDisplayText` /
//      `ProcessTts` run FIVE sequential substitution passes (`originalMatches`, `matches`,
//      `previousMatches`, the `{l}` line expansion, then custom variables), and each pass
//      re-scans the string the previous pass produced. So text captured OUT OF THE LOG — text a
//      stranger typed — can contain a token that a LATER pass resolves, including `{l}`, whose
//      expansion is then walked by the variables pass. It is bounded (five, no loop) so it cannot
//      diverge, but it is second-order substitution over attacker-influenced input. `applyCaptures`
//      below is a single left-to-right pass that never re-reads what it wrote, which makes that
//      whole class unreachable by construction rather than by counting passes.
//
// Two more measured facts worth keeping beside the caps: EQ Log Parser applies NO length bound to
// a substituted value anywhere, and its only sanitization is a TTS-path character whitelist
// (`ReplaceBadCharsRegex`) — its display and overlay surfaces receive the captured text unfiltered.
// Here the sanitizer runs on the value itself, so every surface is covered by the same act.
//
// ============================================================================================
//
// PURE, like every other module in `src/shared/**`: no `node:`, no Electron, no DOM. It compiles
// under both tsconfigs and loads under `tsx` for node:test.

import type { AlertTrigger, AlertTriggerPrimitive } from './alertTypes'
import { sanitizeOneLine } from './sanitizeText'

/**
 * Longest a SINGLE captured value may be, in characters — control 2 of the threat model.
 *
 * 48 is a name's worth of text. EQ character names are at most 15 characters; the longest mob
 * display names in the shipped DB (articles and all — "a Kunark sarnak weaponry overseer") sit
 * under 40. It is 40% of MAX_SPEECH_CHARS, which is the point: even a phrase written entirely out
 * of tokens has to spend its budget across several of them, and no single one can be a sentence.
 *
 * A longer value is TRUNCATED, never refused. The same reasoning MAX_SPEECH_CHARS states: an
 * alert that says the first 48 characters of a very long name is an alert; one that refuses to
 * speak is a bug the user cannot see.
 */
export const MAX_CAPTURE_CHARS = 48

/**
 * Most named groups carried from one firing. A bound on the IPC delta and on the store, not a
 * policy — no honest pattern names eight things, and a pattern that names eighty must not turn
 * every matching line into a payload. Groups past the bound are dropped, so their tokens render
 * literally (which is visible) rather than resolving to something unbounded (which is not).
 */
export const MAX_CAPTURE_GROUPS = 8

/**
 * A `{token}` in a spoken phrase.
 *
 * The name grammar is EXACTLY JavaScript's named-capture-group identifier grammar, and that is
 * deliberate: a token that could not possibly be a group name is not a token this build failed to
 * understand, it is literal text the user typed. `{2}`, `{a-b}` and `{}` are therefore never
 * touched — which also means a phrase containing regex-ish braces survives unharmed.
 */
const TOKEN_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * A named group DECLARATION inside a regex source (`(?<player>`).
 *
 * Lookbehind (`(?<=`, `(?<!`) cannot match this by construction — `=` and `!` are not in the
 * identifier class — so no pattern can make a lookbehind look like a declaration.
 */
const GROUP_DECL_RE = /\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g

/** A `where` matcher written in `/regex/` form (main/modules/alerts.ts `compileFieldMatch`). */
function regexSpecBody(spec: string): string | null {
  return spec.length >= 2 && spec.startsWith('/') && spec.endsWith('/') ? spec.slice(1, -1) : null
}

/**
 * ONE captured value, made safe — controls 1 and 2, in the order that matters.
 *
 * Sanitize BEFORE capping: a truncation that cut an ANSI sequence in half would leave the ESC
 * behind for the control class to delete, but it would also let the byte count of an escape
 * sequence buy a hostile pattern extra room under the cap. Strip first, then measure what is
 * left, then trim again (the strip can expose new edge whitespace — `\x1B[31m ` becomes ` `).
 *
 * Returns null for "nothing survived", which the callers treat as "this group captured nothing":
 * its token renders literally rather than resolving to an empty string, so a phrase never
 * silently collapses into a shorter, different sentence.
 */
export function sanitizeCapture(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null
  const clean = sanitizeOneLine(raw).trim()
  if (!clean) return null
  return clean.slice(0, MAX_CAPTURE_CHARS).trim() || null
}

/**
 * Turn a `RegExpExecArray['groups']` object into the bounded, sanitized map a firing may carry.
 *
 * The ONE place raw regex output becomes a `FiredAlert.captures`, so every producer gets the same
 * bounds whether it matched a raw line or a `where` field. Returns undefined when nothing
 * survived — an absent key is the honest JSON encoding of "this pattern named nothing", and it
 * keeps the delta byte-identical for the overwhelming majority of alerts, which capture nothing.
 */
export function harvestCaptures(
  groups: Record<string, string | undefined> | undefined
): Record<string, string> | undefined {
  if (!groups) return undefined
  const out: Record<string, string> = {}
  let n = 0
  for (const name of Object.keys(groups)) {
    if (n >= MAX_CAPTURE_GROUPS) break
    const value = sanitizeCapture(groups[name])
    if (value === null) continue
    out[name] = value
    n += 1
  }
  return n > 0 ? out : undefined
}

/**
 * Substitute `{token}`s in `template` from `captures` — control 5, and the whole template
 * language.
 *
 * ONE PASS. `String.replace` with a /g regex walks the template left to right and never re-reads
 * what it wrote, so a captured value containing `{other}` is spoken as the literal characters
 * `{other}`. There is no nesting and there can be no recursion, by construction rather than by a
 * depth counter.
 *
 * THE REPLACER IS A FUNCTION, NOT A STRING, and this is load-bearing rather than stylistic: a
 * replacement STRING gives `$&`, `$1`, `` $` `` and `$'` their special meanings, so a player named
 * `$&` would re-inject the matched token and a `$'` would append the rest of the phrase. A
 * function replacer's return value is inserted verbatim. A captured name is text, never a
 * directive.
 *
 * VALUES ARE RE-SANITIZED HERE. They arrive already sanitized when they came through
 * `harvestCaptures`, and this function still runs `sanitizeCapture` on each one, because this is
 * the last code between a captured value and a speech engine — and it is reachable from the
 * editor preview, from a unit test, and from any future caller that assembled a firing itself.
 * A safety property that depends on the caller having been careful is not a safety property.
 *
 * AN UNKNOWN TOKEN RENDERS LITERALLY. `{player}` with no `player` capture speaks as "{player}".
 * Ugly on purpose: the alternative — deleting it — turns "Puma on {player}" into "Puma on", a
 * different and quietly wrong sentence, and gives the user nothing to debug from.
 */
export function applyCaptures(template: string, captures?: Record<string, string>): string {
  if (!captures || !template.includes('{')) return template
  return template.replace(TOKEN_RE, (whole, name: string) => sanitizeCapture(captures[name]) ?? whole)
}

/** Every `{token}` a phrase writes, in order, de-duplicated. The editor lints against this. */
export function tokensIn(phrase: string): string[] {
  const out = new Set<string>()
  for (const m of phrase.matchAll(TOKEN_RE)) out.add(m[1])
  return [...out]
}

/**
 * Every capture name a TRIGGER declares — what the editor tells the user they may write in a
 * phrase, and the readable form of control 4.
 *
 * It reads the def's regexes as TEXT rather than compiling them, because the question ("what does
 * this pattern promise to name?") is answered by the source and because a def that arrived from a
 * stranger must not be compiled just to render a hint. Composite triggers contribute every
 * condition's names: 'any' fires on whichever condition matched, so all of them are reachable.
 */
export function captureNamesIn(trigger: AlertTrigger): string[] {
  const out = new Set<string>()
  const conditions = 'conditions' in trigger ? trigger.conditions : [trigger]
  for (const c of conditions) {
    for (const source of conditionRegexSources(c)) {
      for (const m of source.matchAll(GROUP_DECL_RE)) out.add(m[1])
    }
  }
  return [...out]
}

/** Every regex SOURCE one primitive condition carries: its raw pattern, or its `/regex/` matchers. */
function conditionRegexSources(c: AlertTriggerPrimitive): string[] {
  if (c.type === 'raw') return [c.regex]
  if (c.type !== 'event') return [] // 'app' conditions carry no pattern at all.
  return Object.values(c.where ?? {})
    .map(regexSpecBody)
    .filter((b): b is string => b !== null)
}

// ---------------------------------------------------------------- authoring a subject capture

/**
 * The subject placeholders the spell wiki uses in a cast-on-other message, longest first so
 * "Someone's" is stripped before "Someone".
 *
 * MEASURED over the committed src/main/data/spells.json (1,926 spells): `Someone` 1269,
 * `Player` 58, `Target` 46, `Someone's` 16, `Target's` 11, `Soandso` 8, `Player's` 5. The
 * remainder either begin mid-sentence ("screams as poison burns their veins!" — the wiki simply
 * dropped the subject) or are possessive fragments, and neither can be turned into a capture
 * without guessing where the name ends, so `subjectCapturePattern` returns null for them.
 */
const SUBJECT_TOKENS = ['Someone', 'Target', 'Player', 'Soandso'] as const

/**
 * A NAME-SHAPED run — what a subject capture is allowed to match, and the reason this pattern is
 * unreachable through a chat line.
 *
 * Letters, spaces, apostrophes and backticks only: that covers a player name (`Fail`), a pet name,
 * and a mob's display name with its article and EQ's fondness for backticks (`Coercer T\`vala`,
 * `a young puma`). It admits NO digit, colon, comma or quote — and every EQ chat shape puts
 * `, '` between the speaker and the free text (`Bob tells General:1, '…'`, `Bob says, '…'`,
 * `Bob tells the guild, '…'`). Combined with the `^\[…\] ` anchor below, a stranger cannot type
 * the sentence into a chat channel and have it captured as a name: the characters between the
 * timestamp and the quoted text are not name-shaped.
 *
 * The `{1,48}` bound mirrors MAX_CAPTURE_CHARS so the regex refuses at match time what
 * `sanitizeCapture` would otherwise truncate afterwards.
 */
const NAME_RUN = "[A-Za-z' `]{1,48}"

/** Escape a literal string for inclusion in a regex. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Turn a wiki cast-on-other message into a raw-trigger pattern that CAPTURES the subject, or null
 * when the message names no subject this can find.
 *
 *   "Target growls with the spirit of the puma."  →  ^\[[^\]]*\] (?<player>[A-Za-z' `]{1,48}) growls with the spirit of the puma\.
 *   "Someone's eyes glow blue."                   →  ^\[[^\]]*\] (?<player>[A-Za-z' `]{1,48})'s eyes glow blue\.
 *
 * ANCHORED AT THE START OF THE LINE, not at the `] ` that closes the timestamp. `LogEvent.raw` is
 * the whole line including `[Sat Aug 01 18:38:10 2026] ` (parser.ts LINE_RE), and the repo's
 * existing raw triggers anchor on `\] ` because a bare `^` written against the MESSAGE text would
 * match nothing. That is right for a fixed notice and NOT ENOUGH for a capture: `\] ` matches any
 * `] ` in the line, including one a stranger typed inside a tell, which would let the capture
 * begin in the middle of somebody's sentence. `^\[[^\]]*\] ` can only match the real timestamp,
 * because `[^\]]*` cannot cross the first `]` in the line.
 *
 * The rest of the message is escaped LITERALLY — the pattern is authored from the DB, and the DB
 * is data, so a message containing regex metacharacters must not become a pattern.
 */
export function subjectCapturePattern(message: string, name = 'player'): string | null {
  const msg = message.trim()
  for (const token of SUBJECT_TOKENS) {
    // The wiki writes the possessive both ways ("Someone's", "Someone 's"); both mean the same
    // thing and both attach straight to the captured name.
    const poss = new RegExp(`^${token}\\s*'s\\b(.*)$`, 'i').exec(msg)
    if (poss) return anchored(`(?<${name}>${NAME_RUN})'s${escapeRegex(poss[1])}`)
    const plain = new RegExp(`^${token}\\s+(.*)$`, 'i').exec(msg)
    if (plain) return anchored(`(?<${name}>${NAME_RUN}) ${escapeRegex(plain[1].trim())}`)
  }
  return null
}

/** The timestamp anchor every authored capture pattern carries. See `subjectCapturePattern`. */
function anchored(body: string): string {
  return `^\\[[^\\]]*\\] ${body}`
}
