// ============================================================================
// SHARED LOG SCRUB — the ONE definition of "third-party chat/social".
// ============================================================================
//
// PROMOTED from `tests/fixture-scrub.mjs` (which is now a thin shim over this module) so that
// the SAME drop list governs two things that must never disagree:
//
//   1. `tests/fixtures/*.log` — committed to a PUBLIC repo by `tests/extract-*.mjs`.
//   2. the log slice a user attaches to an in-app feedback report (src/main/feedback/slice.ts).
//
// Re-implementing a second drop list for the app was FORBIDDEN by AGENTS.md ("never
// re-implement a drop list"), and rightly: two lists diverge, and the divergence ships as
// someone else's words in a public artifact.
//
// LAW: a scrubbed line is DROPPED ENTIRELY. Never rewrite it with a placeholder — a rewritten
// line can still parse into a fake event and pollute the fixture (and therefore the golden
// expectation) with something the real log never said.
//
// Families enumerated by sweeping the real 1.02M-line log (never guessed):
//   1. QUOTED SPEECH — every chat channel in this game prints `<sender> <verb>, '<text>'`:
//      direct tells (`X tells you`, `You told X`), channel tells (`X tells General:1`,
//      `You tell NewPlayers6:1`), group (`X tells the group`, `You tell your party`), guild /
//      raid variants, `X says`, `X says out of character`, `X shouts`, `X auctions`, and the
//      `You say...` first-person forms. A whole-log sweep proved the ONLY non-chat lines that
//      contain `, '` are mob flavor growls, so "contains a quoted-speech comma-quote" is a
//      complete and safe test — we drop mob speech too rather than try to tell a named NPC
//      (Kahaptra Z`Taj, Innoruuk`s Chosen) apart from a player name. Nothing in the parser
//      consumes mob speech.
//   2. /who OUTPUT — the header, the dashed rules, `[ANONYMOUS] Name`,
//      `[<lvl> CLS/CLS] Name (Race) <Guild> ZONE: ...` rows (incl. the ` AFK ` and `* RIP *`
//      corpse variants) and the `There are N players...` footer. Every row names a stranger.
//   3. (REMOVED, owner decision 2026-08-05) GROUP MEMBERSHIP EVENTS — `X has joined/left
//      the group.`, `X invites you to join a group.`, `X is now the leader of your group.`
//      — are KEPT now: they are structural facts about the fight, not communications, and
//      they were the exact context a real combat report (group member missing from meters)
//      needed and did not have. The privacy delta of keeping them is nil — the same names
//      appear uncensored in every combat line of the same slice. What privacy protects is
//      CONTENT, and content stays covered: `X tells the group, '…'` carries the
//      quoted-speech comma-quote and falls to family 1 like every other chat channel.
//   4. PLAYER EMOTES — social emotes with a proper-name subject (`Rykkerr waves at
//      Primitive.`). Mob emotes (`a Teir`Dal ranger yawns.`, `... sighs in tranquility.`) are
//      NOT social emotes and stay.
//   5. GUILD MOTD — defensive; this log has none, but a public fixture must never grow one.
//
// KEPT (the world model needs them): all combat (damage/miss/resist/heal/death), casts, buff
// landings + wear-offs, loot/currency/turn-ins, zone lines, level-ups, AA, charm/pet lines,
// stances, and system messages.
//
// THREE CARVE-OUTS, all load-bearing, all checked BEFORE the drop list:
//
//   * THE PET-CLAIM TELL —
//       `<Name> told you, 'Attacking <target> Master.'`
//       `<Name> told you, 'I am unable to wake <mob>, Master.'`
//     IS a tell, but it is spoken by an NPC pet, not a person, and per AGENTS.md it is the
//     ONLY binding signal for a summoned pet (random proper names: Vebarn, Garer...). 3050 of
//     the 3403 `told you` lines in the log are this family; the rest are merchant NPCs.
//     Dropping it would silently unbind every pet in every combat fixture, so it is kept
//     verbatim. It has NO self-name dependency: a pet's name is not the user's.
//
//   * THE PET-VOICED SAY FAMILY (JOS-47) —
//       `<Name> says, 'Following you, Master.'`
//       `<Name> says, 'Now regrouping, master.'`
//       `<Name> says, 'Sorry, Master... calming down.'`
//       `<Name> says, 'Now holding, Master.  I will not start new attacks until ordered.'`
//       `<Name> says, 'As you wish, oh great one.'`
//       `<Name> says, 'I beg forgiveness, Master.  That is not a legal target.'`
//     Six EXACT sentences — the complete pet-response vocabulary in the 1.4M-line corpus (113
//     lines; the sweep that enumerated them also proved there is no seventh, and that every
//     OTHER quote containing "master" is mob flavor: "None shall defile the realm of our
//     master!", "Uninvited guests to our master's home…", `<X>'s corpse says, 'Innoruuk, I have
//     failed you!'`). Same argument as the tell above: an NPC pet speaks them, never a person,
//     and the SPEAKER is a pet's name — either a random summoned name (Kober, Vabn) or a mob
//     name (`a large heart spider`). No player's words and no player's name can ride this out.
//
//     Kept for a reason the tell's carve-out does not share: these lines are PUBLIC, so they
//     can NEVER bind on their own (another player's pet in earshot says exactly the same
//     words). What they do is NOMINATE — they are the evidence behind the meter's
//     "<Name> — your pet?" offer, and a fixture that cannot carry them cannot test the offer.
//     An exact-sentence match rather than a `Master` pattern is the whole safety of it.
//
//   * THE PET LEADER SAY (JOS-52) — `<Name> says, 'My leader is <Someone>.'`, the
//     `/pet who leader` answer, and the ONLY line in this log in which a pet names its owner out
//     loud. MEASURED (whole-log sweep, 1,404,458 lines, 2026-08-06): the family has exactly ONE
//     member and exactly ONE occurrence — `Jaber says, 'My leader is Primitive.'` (Thu Aug 06
//     12:44:20). There is no follower variant, no no-leader variant and no charmed variant; the
//     log's only other 12 lines containing "leader" are seven group-leader lines and five
//     players' chat.
//
//     IT WAS GATED ON `opts.selfName` UNTIL JOS-270 — kept when the leader it named was the
//     owner, dropped when it named anybody else. Owner ruling 2026-08-13 removed the gate: the
//     line is now kept WHATEVER NAME it carries, which puts it on exactly the same footing as
//     the two carve-outs above it.
//
//     WHY THE GATE COST MORE THAN IT PROTECTED. The self-gated form let the LIVE app act on a
//     third party's leader say (it binds a group-mate's pet to them — allyCharms.ts) while
//     guaranteeing that no feedback report could ever CONTAIN one. That is a structurally
//     un-triageable defect: report 01KZVYMCAD72XFC36D73D8J2E8 is an ally's summoned pet whose
//     damage joined nobody's parse, and the one line that would have bound it is the one line
//     the slice was built to delete.
//
//     WHY KEEPING IT COSTS NOTHING. This is the 2026-08-05 group-membership ruling's reasoning
//     (family 3 above), applied to the same shape of fact: the leader's name is a structural fact
//     about the fight, not a communication, and the SAME NAME already appears uncensored in every
//     combat line of the same slice — the pet is swinging, the leader is casting and healing. The
//     delta is nil. What privacy protects is CONTENT, and no content rides out here: the sentence
//     is fixed, the speaker is an NPC pet, and the only variable is a name the slice is already
//     full of.
//
//     THE RESIDUAL, stated rather than waved at. The shape is a common grammar, so a PLAYER who
//     types `My leader is <X>.` in /say produces a line this rule now keeps. That is precisely
//     the risk the six-says carve-out has always accepted (a player can type "Following you,
//     Master." too), and it is bounded the same way: an EXACT sentence shape, never a `/leader/`
//     pattern, and one measured occurrence in 1.4M lines. Cost accepted at the same price.
//
//   * THE SELF `/who` ROW — `opts.selfName`. The owner's own identity is theirs to publish,
//     and their row is the ONLY line in the log that states the class loadout
//     (`extract-leveling-fixtures.mjs` and the class-combo model's single Tier-A observation
//     depend on it). PARAMETERIZED, not a constant: for a fixture self is 'Primitive'; for a
//     user's feedback report self is THEIR active character. Absent ⇒ no self carve-out at
//     all, which is the safe default — every /who row then falls to the drop list.
//
// This module is PURE: zero imports, no `node:`, no Electron, no DOM. It compiles under both
// tsconfigs and is safe to call 50,000 times in a row on a slice.

/** The owner-only pet-claim tell — an NPC pet's binding signal, NOT a person's words. */
export const PET_CLAIM_RE =
  /told you, '(?:Attacking .+ Master|I am unable to wake .+?, Master)\.'$/

/**
 * THE PET-RESPONSE VOCABULARY — the six exact sentences a pet says OUT LOUD, in the order the
 * whole-log sweep counted them (calm 61, regroup 29, comply 13, illegal-target 7, follow 2,
 * hold 1). PUBLIC, so they identify a pet but never WHOSE — which is why, since JOS-49, the app
 * is allowed to do NOTHING with one beyond parse it and let an alert fire on it. See the
 * carve-out note above for why the scrub keeps them anyway.
 *
 * Exported as sentences rather than as one regex so the parser can name WHICH response it saw
 * without a second table: `PET_SAY_RE` below is built from this list, and the parser matches
 * the same list to derive its `say` discriminant. One vocabulary, two readers.
 */
export const PET_SAY_LINES = [
  ['follow', 'Following you, Master.'],
  ['regroup', 'Now regrouping, master.'],
  ['calm', 'Sorry, Master... calming down.'],
  ['hold', 'Now holding, Master.  I will not start new attacks until ordered.'],
  ['comply', 'As you wish, oh great one.'],
  ['illegalTarget', 'I beg forgiveness, Master.  That is not a legal target.']
] as const

/** Regex metacharacters in the sentences are literal (`...`, `.`). */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `<Name> says, '<one of the six>'` — the pet-voiced PUBLIC say. Anchored on the whole line
 * body and on the exact sentence, so a mob growl that merely contains the word "master"
 * ("None shall defile the realm of our master!") can never match. Capture 1 is the speaker.
 */
export const PET_SAY_RE = new RegExp(
  `^(.+?) says, '(${PET_SAY_LINES.map(([, s]) => reEscape(s)).join('|')})'$`
)

/**
 * `<Name> says, 'My leader is <Someone>.'` — the `/pet who leader` answer (JOS-52). Capture 1
 * is the SPEAKER (the pet), capture 2 is the LEADER it named.
 *
 * EXACT SHAPE, never a `/leader/` pattern: the sweep that found this line also found seven
 * `<Name> is now the leader of your group.` lines and five players discussing leadership in
 * chat, and the six-says precedent (a loose `/Master/` would have leaked six kinds of mob
 * flavor) is the standing rule here.
 *
 * The two captures are deliberately PERMISSIVE — a charmed pet answers with a mob's name
 * (`a large heart spider`), and the leader is whatever the game printed. Nothing rides on the
 * captures being tight, because in BOTH readers the whole guard is an equality test against a
 * name supplied from outside: the owner's `selfName` here, `ParserConfig.characterName` in
 * src/main/log/parseCasts.ts. That is precisely how the self-`/who` rule is built (a permissive
 * row regex, the name is the guard), and for the same reason — a `/who` row and a leader say are
 * both a common grammar in which only the name distinguishes you from a stranger.
 *
 * One vocabulary, two readers: the scrub decides whether the line may leave the machine, the
 * parser decides whether it binds a pet. Neither owns a second copy of the shape.
 */
export const PET_LEADER_RE = /^(.+?) says, 'My leader is (.+?)\.'$/

export interface ScrubOpts {
  /** The character whose own `/who` row survives. Fixtures: 'Primitive'. A user's report:
   *  their active character name. Absent ⇒ no self carve-out. */
  readonly selfName?: string
}

const SOCIAL_EMOTE_VERBS =
  'waves|bows|cheers|claps|nods|agrees|thanks|salutes|smiles|laughs|giggles|dances|hugs|kneels|points|cries|apologizes|greets|welcomes|congratulates|shrugs|winks|whistles|slaps|tickles|pokes|beckons'
const SELF_EMOTE_VERBS =
  'wave|bow|cheer|clap|nod|agree|thank|salute|smile|laugh|giggle|dance|hug|kneel|point|cry|apologize|greet|welcome|congratulate|shrug|wink|whistle|slap|tickle|poke|beckon'

/** Patterns applied to the line body (timestamp already stripped). */
const DROP: readonly RegExp[] = [
  // 1. quoted speech — every chat channel, plus mob speech (parser consumes none of it)
  /, '/,
  // 2. /who output
  /^Players (in|on) EverQuest Legends:$/,
  /^-{5,}\s*$/,
  /^\s*(?:\* RIP \*\s*)?(?:AFK\s+)?\[(?:ANONYMOUS|\d+ [A-Z]{3}(?:\/[A-Z]{3})*)\]/,
  /^There (?:are|is) (?:no|\d+) players? in EverQuest Legends/,
  // 3. group MEMBERSHIP events — deliberately absent since 2026-08-05 (see the header):
  //    joined/left/invite/leader lines are kept; group chat CONTENT still falls to rule 1.
  // 4. player social emotes (proper-name or first-person subject)
  new RegExp(`^[A-Z][a-z'\`]+ (?:${SOCIAL_EMOTE_VERBS})\\b`),
  new RegExp(`^You (?:${SELF_EMOTE_VERBS}) at \\b`),
  // 5. guild MOTD (defensive — this log has none)
  /^(?:GUILD MOTD|Guild MOTD|Guild message of the day)/i,
]

/** Strip the `[Day Mon DD HH:MM:SS YYYY] ` prefix, if present. */
function body(line: string): string {
  const i = line.indexOf('] ')
  return i === -1 ? line : line.slice(i + 2)
}

/** Regex metacharacters in a name are literal text (EQ names carry backticks and apostrophes;
 *  a `.` in a name must not become "any character"). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The self `/who` row matcher for one character name.
 *
 * The optional `* RIP *` / ` AFK ` prefixes mirror what the RUNTIME rule accepts
 * (src/main/log/parseWho.ts): this character has printed neither yet, but a scrub that drops a
 * row the parser would have claimed silently deletes evidence from a future fixture. The
 * trailing `\b` already covers the corpse row's `<Name>'s corpse`. The NAME is the whole
 * guard — every stranger's row falls through to the /who DROP rule.
 */
function selfWhoRe(selfName: string): RegExp {
  return new RegExp(
    `^\\s*(?:\\* RIP \\*\\s*)?(?:AFK\\s+)?\\[\\d+ [A-Z]{3}(?:/[A-Z]{3})*\\] ${escapeRe(selfName)}\\b`,
  )
}

/** One compiled regex per character name — this runs per line over a 50k-line slice. */
const selfWhoCache = new Map<string, RegExp>()
function cachedSelfWhoRe(selfName: string): RegExp {
  let re = selfWhoCache.get(selfName)
  if (!re) {
    re = selfWhoRe(selfName)
    selfWhoCache.set(selfName, re)
  }
  return re
}

/**
 * True when the line is third-party chat/social and must be DROPPED from a public artifact.
 * The three pet carve-outs and the owner's own `/who` row are checked FIRST.
 */
export function isThirdPartyChat(line: string, opts?: ScrubOpts): boolean {
  if (PET_CLAIM_RE.test(line)) return false
  const b = body(line)
  // The pet-voiced PUBLIC say. Anchored on the body (the tell's regex above is a suffix match
  // and needs no strip), and on the exact sentence — see PET_SAY_RE.
  if (PET_SAY_RE.test(b)) return false
  // The `/pet who leader` answer, WHOEVER it names (JOS-270, owner ruling 2026-08-13). No longer
  // gated on `selfName`: an ally's pet naming an ally is the same structural fact about the fight
  // that the group-membership lines are, and both ends of it already appear uncensored in every
  // combat line of the same slice. See the carve-out note above for the whole argument.
  if (PET_LEADER_RE.test(b)) return false
  const selfName = opts?.selfName
  if (selfName !== undefined && selfName !== '') {
    // the owner's own /who row (`[50 PAL/MNK/ENC] Primitive (Dark Elf) ...`) is their identity
    if (cachedSelfWhoRe(selfName).test(b)) return false
  }
  return DROP.some((re) => re.test(b))
}

/** Convenience inverse — `lines.filter((l) => scrubKeep(l, opts))`. */
export function scrubKeep(line: string, opts?: ScrubOpts): boolean {
  return !isThirdPartyChat(line, opts)
}

/**
 * One pass over a slice: the kept lines plus how many were dropped.
 *
 * `dropped` is what makes the feedback dialog's preview honest by construction — the user is
 * told the exact number of lines removed, not a claim that "chat was removed".
 */
export function scrubLines(
  lines: readonly string[],
  opts?: ScrubOpts,
): { kept: string[]; dropped: number } {
  const kept: string[] = []
  let dropped = 0
  for (const line of lines) {
    if (isThirdPartyChat(line, opts)) dropped++
    else kept.push(line)
  }
  return { kept, dropped }
}
