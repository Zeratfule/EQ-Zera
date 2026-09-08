// Suggested-alert templates + id convention (Task #38).
//
// The ONE place that maps a spell (catalog entry) → the exact AlertDef a one-click
// suggestion authors. Kept separate from the dialog so the id convention is a single source
// of truth: the wizard uses it to build defs AND to detect already-created suggestions
// (checked/disabled), and AGENTS.md documents it.
//
// ID CONVENTION:  `suggest:<spellKey>:<template>`
//   spellKey = the catalog entry's canonical (lowercased, rank-stripped) key.
//   template ∈ the `TemplateKind` union below (the record is the list; keep them in step).
//   Illusion is the SHARED, deduped suggestion `suggest:illusion:fade` (one alert for the
//   generic `Your illusion fades.` line, which names no spell — see logEvents.ts IllusionFade).
//
// AND SINCE JOS-353 MOST OF THEM SAY WHO. Five templates ship a spoken phrase carrying `{target}`,
// which the app fills from the matched event's own entity field with no regex anywhere
// (shared/alertTargets.ts) — the owner's ruling that naming the affected mob must not require the
// user to write a pattern. The `speaks` field on each template is the whole of it.
//
// Each template's trigger was validated to actually fire in the AlertsModule against a
// matching synthetic LogEvent (scripts/_task38_harness.mts): the `where.spell` matcher tests
// the event's `spell` field case-insensitively; illusionFade carries no spell field, so its
// suggestion has no `where`.

import type { AlertDef, LogEventKind, SpellCatalogEntry } from '@shared/types'
// RELATIVE value import, not `@shared/*` (repo law, the mobSearch.ts precedent): this module is
// now NODE-TESTED — tests/suggestedAlertsFire.test.mts pushes the defs it authors through the
// real parser and the real AlertsModule — and the alias resolves only through the vite/tsconfig
// path map, so an aliased VALUE import makes the module unloadable under tsx. That it was
// unloadable is part of why JOS-84 shipped: no test could ever have run a real suggestion def.
import { spellIdFragment, parseSpellRank } from '../../../../shared/spellLines'
import type { SpellRank } from '@shared/spellLines'

export type TemplateKind =
  | 'wearsOff'
  | 'fade'
  | 'lands'
  | 'landsOnYou'
  | 'landsOnOther'
  | 'healsOverTime'
  | 'breaks'
  | 'charmBreaks'

/**
 * RANK-AWARE templates (spell levelling intelligence). Everything above is rank-LESS by
 * construction: the fade / wears-off / landing lines the parser matches drop the roman-numeral
 * suffix, so an alert on them survives every rank change untouched. Two families keep the
 * suffix, and those are the ones worth pinning to a rank — and the ones the upgrade offers
 * exist for:
 *   castRank   `You begin casting Mesmerization III.`      → castBegin { spell }
 *   resistRank `<mob> resisted your Mesmerization III!`     → resist { caster:'you', spell }
 * Both shapes were verified against the real log (359 and 136 occurrences for that one rank).
 */
export type RankTemplateKind = 'castRank' | 'resistRank'

/** UI + authoring metadata for each template. */
export const SUGGEST_TEMPLATES: Record<
  TemplateKind,
  {
    chip: string
    kind: LogEventKind
    verb: string
    sound: string
    where?: (name: string) => Record<string, string>
    /** A SECOND event kind the same def also fires on, as an `any` composite. See `wearsOff`. */
    alsoKind?: LogEventKind
    /**
     * This template authors a `raw` capture trigger instead of an event one, and the pattern
     * comes off the catalog entry (`castOnOtherCapture`). See `landsOnOther`.
     */
    raw?: true
    /**
     * THE SPOKEN PHRASE THIS TEMPLATE SHIPS, given the spell's distinctive word — and the whole of
     * JOS-353's "suggested alerts can emit it" (owner ruling 2026-08-14).
     *
     * A template with one gets `audio:'speech'` and a `custom` speech mode. It used to get the
     * combined 'both' channel — the pack sound as a guaranteed-audible half with the sentence
     * riding behind it — and that channel is retired (JOS-362, owner: "also remove sound + spoken
     * - too much garbage"). These templates exist to SAY something, so 'speech' is the half that
     * survives; a machine with no voice set up is told so by `VoiceSetupLink` on the row itself,
     * which is a fix rather than a silent substitution.
     *
     * `{target}` needs NO PATTERN — the app fills it from the event's own entity field
     * (shared/alertTargets.ts). `{player}` is `landsOnOther`'s declared capture group and is the
     * one phrase here that depends on a regex, because that family has no typed event to read.
     *
     * A template with NO phrase is one where the answer would be a tautology: `landsOnYou` already
     * says "on you" in its own trigger, and `healsOverTime` is a question about whether your heal
     * is working rather than about whom.
     */
    speaks?: (short: string) => string
  }
> = {
  // Beneficial: the DUAL-DEFAULT expiry (Task #47). The user's directive — "the wears off for
  // you is different than for somebody else … build good sane defaults that help with both by
  // default." The buffs module emits a RESOLVED `buffExpired { spell, target }` for BOTH sides:
  // a self message wears-off (target 'self') AND a fade on your pet/target (target = its name).
  // So ONE simple trigger `{buffExpired, where:{spell}}` (target omitted → matches any) fires
  // whether the buff wears off YOU or your pet — the sane both-sides default, no composite
  // needed for this template. (The composite machinery still ships for user-authored combos.)
  //
  // WIDENED TO A COMPOSITE (JOS-103), because the derived event alone covers only the buffs YOU
  // cast. `buffExpired` is synthesized by the buffs module when it RESOLVES a wear-off against
  // its active set — and the module's OWN-CAST GATE (buffs.ts `onBuffApply`, the user's rule "if
  // something isn't cast by me we shouldn't track it") means a buff a GROUPMATE cast on you never
  // becomes an active instance, so nothing is ever resolved and no buffExpired is ever emitted.
  // MEASURED for Spirit of the Puma: `You begin to snarl as your features become feline.` →
  // `The spirit of the puma departs.` yields buffApply + buffWearOff and ZERO derived events.
  // Every group buff in the game is in that state — which is most of the buffs a player actually
  // wants a wear-off alert for.
  //
  // The raw `buffWearOff` is the other half: EQ prints the wears-off emote to the buff's HOLDER,
  // so the event always means "this wore off YOU", whoever cast it. An `any` composite covers
  // both, and the two can never double-fire in practice: the derived event is stamped with the
  // PRIMARY event's ts (buffs.ts `emitBuffExpired`), so both arrive at the same millisecond and
  // the alert's own cooldown swallows the second. One chip, both sides, one sound.
  wearsOff: {
    chip: 'When it wears off (you or your pet)',
    kind: 'buffExpired',
    verb: 'wears off',
    // "A moment of your time, if you'd be so kind."
    sound: 'input-required-alarm-02',
    where: (name) => ({ spell: name }),
    alsoKind: 'buffWearOff',
    // BOTH conditions name who: `buffExpired.target` is 'self' or the bound entity, and the raw
    // `buffWearOff.target` is always 'self' — which speaks as "you", because the wears-off emote
    // is printed to the holder. So this chip answers the reporters' question on the self side too.
    speaks: (short) => `${short} wore off {target}`
  },
  // Beneficial: JUST the pet/named-target fade side (target-only), for users who want to
  // separate it from the self-side. Uses the raw buffFade the parser already emits.
  // "That, as they say, is that."
  fade: {
    chip: 'When it fades on pet/target only',
    kind: 'buffFade',
    verb: 'fades',
    sound: 'resource-limit-thud-01',
    where: (name) => ({ spell: name }),
    // `buffFade.target` is the named mob, the literal 'pet', or ABSENT for the self form — and the
    // resolver reads all three (absence is what `Your <Spell> spell has worn off.` means, so it
    // speaks "you"). This is the "Soothe has worn off a Fire Giant" sentence for every non-hold buff.
    speaks: (short) => `${short} faded on {target}`
  },
  // Detrimental + cast-on-other: the debuff landing on a target.
  //
  // THE TRIGGER NAMES A FAMILY, NOT A SPELL (JOS-84), and it has to. EQ prints ONE landing
  // sentence for a whole spell line — `<mob> slows down.` is five spells, `<mob> looks frail.`
  // is three — so `buffApply.spell` is a documented BEST-EFFORT first candidate and pinning an
  // alert to it was a coin flip the user always lost: a v0.10.0 enchanter created this exact
  // suggestion for Shiftless Deeds and the parser handed the matcher "Forlorn Deeds", so it
  // never fired once. The def below is UNCHANGED; what changed is that a `where.spell` matcher
  // now tests the event's whole candidate list (main/modules/alerts.ts `spellCandidateNames`),
  // which means this alert fires when the SENTENCE its spell prints appears — and cannot tell
  // you which member of the family printed it, because the log does not say.
  // "Consider this my opening move."
  lands: {
    chip: 'When it lands on a target',
    kind: 'buffApply',
    verb: 'lands',
    sound: 'task-acknowledge-blip-01',
    where: (name) => ({ spell: name }),
    // THE LANDING ALERT THE REPORTS ASKED FOR (JOS-353). `buffApply.target` is the mob the debuff
    // landed on, so this says "Shiftless on Coercer T`vala" with no regex anywhere — the same
    // sentence `landsOnOther` had to author a capture pattern to reach, now available to every
    // spell that has a typed landing event.
    speaks: (short) => `${short} on {target}`
  },
  // Beneficial + cast-on-YOU: the buff landing on the person casting it (JOS-318).
  //
  // THE HOLE. `lands` above is DETRIMENTAL-only, because it was written for a debuff landing on a
  // mob and gates on the cast-on-OTHER sentence. So the whole beneficial half of the game had no
  // "it landed" chip at all, and a HoT is the family that notices: `Flowering Heal` (report 3JM1ZD)
  // and `Slugs Healing` (01KZZXVW888E09C088QBRD5HCD) both state no wear-off sentence, so `wearsOff`
  // is not offered either, and everything the wizard DID offer them was about somebody else's copy
  // of the buff. The event was there the whole time — `You feel a heal flowering within you.` parses
  // to `buffApply {target:'self'}` off the DB's own `msgCastOnYou`.
  //
  // `target:'self'` IS PART OF THE TRIGGER, not decoration: it is what separates this chip from
  // `lands`/`landsOnOther` on a spell that offers both, so a shaman who wants "my HoT landed on me"
  // and "my HoT landed on the tank" can have two sounds. The parser writes the literal string
  // 'self' for a first-person landing (log/parseCasts.ts), and a `where` key that is not `spell`
  // keeps its exact-compare semantics (main/modules/alerts.ts) — so this matches that and nothing
  // else.
  // "A moment of your time, if you'd be so kind."
  landsOnYou: {
    chip: 'When it lands on you',
    kind: 'buffApply',
    verb: 'lands on you',
    sound: 'task-acknowledge-blip-01',
    where: (name) => ({ spell: name, target: 'self' })
  },
  // THE CAPTURE TEMPLATE (JOS-103) — "who did this land on?", answered out loud.
  //
  // THE REPORTED CASE, and why it cannot be an event trigger. Spirit of the Puma's cast-on-other
  // message is `Target growls with the spirit of the puma.` The suffix table that drives
  // `buffApply` is keyed by what is left after stripping the wiki's "Someone " subject, and this
  // message does not use that subject — so it is not in the table, and MEASURED against the
  // owner's own log, `[Sat Aug 01 18:38:10 2026] Fail growls with the spirit of the puma.` parses
  // to kind `unknown`. There is no typed event for this family. A `raw` trigger is not a shortcut
  // taken here; it is the only thing that exists.
  //
  // THE PATTERN IS NOT WRITTEN HERE. It arrives on the catalog entry as `castOnOtherCapture`,
  // authored in main by `subjectCapturePattern` (shared/alertCaptures.ts), because its two
  // security properties — the `^\[…\] ` timestamp anchor and the name-shaped character class —
  // are what stop a stranger typing the sentence into guild chat and having their text captured
  // and spoken. Read that module's threat model before touching this.
  //
  // IT SPEAKS, FULL STOP. This template shipped on the combined 'both' channel — the pack sound
  // as the guaranteed-audible half, the spoken name behind it — until JOS-362 retired that
  // channel; the point of the template is the NAME it says, so 'speech' is what it keeps. The def
  // still carries its pack sound, so a user who switches the row's output back to a pack gets a
  // working sound alert with one click. "Consider this my opening move."
  landsOnOther: {
    chip: 'When it lands on someone (say who)',
    kind: 'buffApply', // unused for this template — see `raw`; kept so the record shape is total.
    verb: 'lands on someone',
    sound: 'task-acknowledge-blip-01',
    raw: true,
    // `{player}` — the group `subjectCapturePattern` declares, NOT the auto token. This family has
    // no typed event to read an entity field off (that is the whole reason it is a `raw` trigger),
    // so the declared capture is the only thing that can answer. If the two ever disagree the token
    // renders literally, which is visible in the editor's preview rather than silent.
    speaks: (short) => `${short} on {player}`
  },
  // THE HEAL-OVER-TIME TICK (JOS-318) — the one line a HoT cannot fail to print.
  //
  // WHY A SEVENTH TEMPLATE RATHER THAN A BETTER GATE ON THE SIX. Every other template rests on a
  // sentence the WIKI had to get right, and both reports behind this ticket are spells the wiki got
  // wrong: `Slugs Healing`'s scraped landing and cast-on-other messages are the literal stubs
  // `You .` / `Someone .`, and it states no wear-off at all. The corrections overlay fixes that one
  // spell from the reporter's own bytes — but `Sloths Healing`, the next rank up the same shaman
  // ladder, has the same stubs and NO log anywhere has printed a line of it, so it cannot be
  // corrected without inventing a sentence (AGENTS.md's awaiting-sample law). This trigger is what
  // covers it anyway: `You healed Ahyeon over time for 247 hit points by Slugs Healing.` is printed
  // by the HEALING ENGINE, not by a message table, so it exists for every HoT in the game.
  //
  // AND IT IS RANK-LESS AT THE SOURCE, which is the other half of this ticket. The reporter's cast
  // line says `Slugs Healing VII` and this line says `Slugs Healing` — the alerts matcher folds
  // both to one line key (JOS-259), but this one needs no folding to begin with.
  //
  // THE COOLDOWN IS THE SPELL'S DURATION, not the 3 s default: a HoT prints this line every six
  // seconds for its whole duration, and a user who asks to be told their heal is working wants one
  // sound per CAST. `buildDef` reads `entry.durationMs` for it. The wiki figure is a FLOOR in this
  // app, so the failure direction is an extra sound on a long re-cast, never a swallowed one.
  // "Consider this my opening move."
  healsOverTime: {
    chip: 'While it is healing (once per cast)',
    kind: 'heal',
    verb: 'heals over time',
    sound: 'task-acknowledge-blip-01',
    where: (name) => ({ spell: name })
  },
  // Crowd control: the HOLD ENDING, per spell (JOS-161).
  //
  // WHY IT IS NOT `wearsOff`. That template is beneficial-only and rests on the derived
  // `buffExpired`, which the buffs module synthesizes only from an AUTHORITATIVE wear-off message.
  // A mez on a mob has none: `Your <Song> spell has worn off of <mob>.` is claimed by
  // `classifyWornOff` and becomes `cc {refresh:true}` (that is how the "Mez / root broke" group has
  // always fired), and the hygiene cull that retires an unwitnessed hold is deliberately silent. So
  // a bard asking for "tell me when my mez expires" had nothing to click and nothing to hand-write
  // — the reported defect, and it was true of every mez and root in the game, not just this ladder.
  //
  // `refresh:'true'` is what separates the BREAK from the landing: the same `cc` kind carries both,
  // and only the break shape names a spell (the landing carries `candidates`). The group alert
  // pins the same key for the same reason (shared/alertGroups.ts `group:cc:broke`).
  //
  // THE HONEST LIMIT, restated from that group because it is the same sentence: EQ prints this line
  // whether the hold ran its course or a nuke broke it early. This alert is "it ended", never "it
  // ended early", and it is named that way.
  // "It has all gone rather pear-shaped."
  breaks: {
    chip: 'When the mez/root breaks',
    kind: 'cc',
    verb: 'broke',
    sound: 'task-error-buzz-01',
    where: (name) => ({ spell: name, refresh: 'true' }),
    // "Mez has dropped on a ghoul" — the reporters' own sentence, and the `cc` break spells its
    // entity `mob` rather than `target`, which is exactly why the resolver is a table and the user
    // never has to know (shared/alertTargets.ts).
    speaks: (short) => `${short} broke on {target}`
  },
  // The CHARM breaking, per spell (JOS-200) — `breaks`'s twin, and a different EVENT.
  //
  // WHY IT IS NOT `breaks`. One sentence, two rosters, two events: `classifyWornOff` tests
  // `charmSpell` first and emits `uncharm`, then `ccSpell` and emits `cc {refresh:true}`. A charm
  // break therefore never carries `refresh`, and the mez template's trigger cannot see it — which
  // is exactly what three bards hit in a row (JOS-200: Solon's Bewitching Bravura was in the wrong
  // roster AND had no charm-shaped chip to click even once it moved).
  //
  // WHY IT EXISTS BESIDE THE GROUP. `shared/alertGroups.ts` has fired "Charm break" for every
  // charm at once since JOS-69, but a user goes looking by SPELL NAME — an enchanter typing
  // "Allure", a bard typing "Bravura" — and until now the search surface had nothing for them.
  // Same argument the per-spell mez break made in JOS-161, applied to the other roster.
  //
  // NO `refresh` KEY, deliberately: `uncharm` carries `mob` and `spell` and nothing else, so
  // pinning the name is the whole trigger. Measured for JOS-200 over the owner's whole log: 3,382
  // of 3,383 `Your <X> spell has worn off of <mob>.` lines are rank-less, so the catalog's display
  // name is the string the sentence actually carries.
  //
  // SAME SOUND AS THE SEEDED CHARM-BREAK ALERT (`SOUND.charmBreak` in shared/alertGroups.ts, and
  // DEFAULT_ALERT_SOUNDS.charmBreak in main): a user who owns both hears one charm-break voice.
  // "I find myself... requiring your attention."
  charmBreaks: {
    chip: 'When the charm breaks',
    kind: 'uncharm',
    verb: 'charm broke',
    sound: 'input-required-alarm-01',
    where: (name) => ({ spell: name }),
    // Same sentence as `breaks`, same `mob` field, different event — and naming the mob matters
    // MORE here: a broken charm is a pet turning on you, and which one is the whole question.
    speaks: (short) => `${short} charm broke on {target}`
  }
}

/** UI metadata for the two rank-pinned templates. `chip` takes the rank display name. */
export const RANK_TEMPLATES: Record<
  RankTemplateKind,
  { chip: (rank: string) => string; kind: LogEventKind; verb: string; sound: string }
> = {
  castRank: {
    chip: (rank) => `When you cast ${rank}`,
    kind: 'castBegin',
    verb: 'cast',
    // "Consider this my opening move."
    sound: 'task-acknowledge-blip-01'
  },
  resistRank: {
    chip: (rank) => `When ${rank} is resisted`,
    kind: 'resist',
    verb: 'resisted',
    // a dry error read — it was shrugged off.
    sound: 'task-error-buzz-01'
  }
}

/** A concrete suggestion: the template it came from + the exact AlertDef it authors. */
export interface Suggestion {
  template: TemplateKind | RankTemplateKind | 'illusion'
  def: AlertDef
  /** the rank display name a rank-pinned suggestion targets (absent for rank-less ones). */
  rank?: string
}

/**
 * The SHIPPED sound pack — the ONE pack the app provisions, and the pack every surface here
 * falls back to when the user has expressed no preference of their own.
 * Mirrors DEFAULT_ALERT_PACK_ID / DEFAULT_ALERT_SOUNDS in src/main/data/defaultPacks.ts
 * — repeated as literals because the renderer bundle can't import from src/main. Keep
 * the two in sync (the ids there carry the spoken line each one is).
 *
 * IT IS NO LONGER THE PACK EVERY PICKER PRE-SELECTS (JOS-273). That is now the user's stored
 * default-pack preference, which arrives as an ARGUMENT (`packId` below) because it is runtime
 * state and this is a compile-time fact about what the app ships. When the two differ, the
 * argument wins; when nothing is stored, they are the same thing and nothing has changed.
 */
export const DEFAULT_PACK_ID = 'eq-zera-console'
/** Default cooldown for a suggested alert (ms). */
const DEFAULT_COOLDOWN_MS = 3000

function suggestionId(spellKey: string, template: TemplateKind): string {
  return `suggest:${spellKey}:${template}`
}

/**
 * THE ID A RANK CHIP IS "ALREADY CREATED" UNDER — the dedupe key, rank-folded (JOS-276).
 *
 * THE PROBLEM THE RANK FOLD CREATED. The two rank templates mint one id per RANK
 * (`suggest:<line>:castRank:mesmerization-iii`), which was exactly right while a def pinned to a
 * rank only ever fired on that rank: two ranks were two alerts about two different sets of lines.
 * Since JOS-259 they are not — one def fires on the whole line — so the wizard was offering an
 * unchecked "Mesmerization IV casts" chip beside a def that already answers every Mesmerization
 * cast line, and a click on it bought the user a SECOND alert firing on the SAME lines. Two
 * sounds, no way to see why. `detectRankUpgrades`'s add-alongside clone (`…::rank:<frag>`) folds
 * here for the same reason and by the same cut.
 *
 * THE FOLD IS ON THE ID, NOT ON THE DEF. Ids already stored keep their spelling — nothing is
 * migrated, nothing is rewritten, and a def the user edited is still their own — so this changes
 * exactly one thing: whether the chip renders checked. `entry.key` is itself the rank-STRIPPED
 * line key (buildSpellCatalog), so cutting the id after the template name yields one key per
 * (line, template), which is precisely the set of lines one of these defs now fires on.
 *
 * Every other suggestion id is returned unchanged — they were rank-less by construction already.
 */
const RANK_SUGGESTION_ID_RE = /^(suggest:.*:(?:castRank|resistRank))(?::|$)/

export function suggestionCoverageId(id: string): string {
  return RANK_SUGGESTION_ID_RE.exec(id)?.[1] ?? id
}

/** Function words a spell name hides its distinctive noun behind. */
const NAME_FUNCTION_WORDS: ReadonlySet<string> = new Set(['of', 'the', 'de', 'in', 'a', 'an'])

/**
 * The DISTINCTIVE word of a spell name, for the default spoken phrase — "Spirit of the Puma" →
 * "Puma", "Ward of Calliav" → "Calliav", "Clarity" → "Clarity".
 *
 * WHY NOT `spellFirstWord`. The speech resolver already has a shortest-utterance mode and it
 * takes the FIRST word, which is right for "Swift Like the Wind" and useless for the whole
 * "<something> of the <something>" family: "Spirit" names Spirit of Wolf, Spirit of the Puma,
 * Spirit of the Scorpion, Spirit of Bih`Li and a dozen more. The rule here is one line — take the
 * words after the LAST function word, else the first word — and it is AUTHORING ONLY: it picks
 * the default text of an editable phrase and renames nothing. `speechFirstWord` is untouched.
 *
 * MEASURED over the committed DB (1,926 spells): 48 names resolve to more than one word and the
 * rest to exactly one. Its known weak case is the leading possessive — "Sha's Lethargy" → "Sha's"
 * — which is a worse-sounding default and not a wrong one, and the user edits the phrase.
 */
export function spellShortName(name: string): string {
  const words = parseSpellRank(name).base.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return name.trim()
  let last = -1
  for (let i = 0; i < words.length; i += 1) {
    if (NAME_FUNCTION_WORDS.has(words[i].toLowerCase())) last = i
  }
  return last >= 0 && last < words.length - 1 ? words.slice(last + 1).join(' ') : words[0]
}

/**
 * The trigger one template authors for one spell.
 *
 * Three shapes, and the branch order is the record's own declaration order: a `raw` capture
 * template (`landsOnOther`), a two-kind `any` composite (`wearsOff`), and the plain event trigger
 * every other template has always authored. A `landsOnOther` for an entry with no
 * `castOnOtherCapture` is unreachable — `suggestionsFor` gates on `templates.landsOnOther`, which
 * main sets only when it also wrote the pattern — but it degrades to the event shape rather than
 * throwing, because a suggestion that crashes the wizard is worse than one that is merely dull.
 */
function buildTrigger(entry: SpellCatalogEntry, template: TemplateKind): AlertDef['trigger'] {
  const t = SUGGEST_TEMPLATES[template]
  const where = t.where ? t.where(entry.name) : undefined
  if (t.raw && entry.castOnOtherCapture) return { type: 'raw', regex: entry.castOnOtherCapture }
  if (t.alsoKind) {
    return {
      type: 'any',
      conditions: [
        { type: 'event', kind: t.kind, ...(where ? { where } : {}) },
        { type: 'event', kind: t.alsoKind, ...(where ? { where } : {}) }
      ]
    }
  }
  return { type: 'event', kind: t.kind, where }
}

/**
 * The cooldown one template authors.
 *
 * Every template but one fires on a sentence the game prints ONCE per event, so the 3 s default is
 * a double-fire guard and nothing more. `healsOverTime` is the exception (JOS-318): its line repeats
 * every six seconds for the spell's whole duration, so its cooldown is that duration and one CAST
 * makes one sound. A spell whose duration the wiki never stated falls back to the default rather
 * than to silence — a chatty alert is a thing the user can see and edit, a missing one is not.
 */
function cooldownFor(entry: SpellCatalogEntry, template: TemplateKind): number {
  if (template !== 'healsOverTime') return DEFAULT_COOLDOWN_MS
  return Math.max(DEFAULT_COOLDOWN_MS, entry.durationMs ?? 0)
}

/** Build the AlertDef for one (spell, template) pair, pointed at `packId` (the user's default). */
function buildDef(entry: SpellCatalogEntry, template: TemplateKind, packId: string): AlertDef {
  const t = SUGGEST_TEMPLATES[template]
  const def: AlertDef = {
    id: suggestionId(entry.key, template),
    name: `${entry.name} ${t.verb}`,
    enabled: true,
    trigger: buildTrigger(entry, template),
    sound: { packId, soundId: t.sound },
    cooldownMs: cooldownFor(entry, template),
    note: `Suggested alert (Task #38/#47) - ${template} for ${entry.name}.`
  }
  // THE TEMPLATES THAT SAY WHO (JOS-103 for `{player}`, JOS-353 for `{target}`). One branch for
  // all of them now: the phrase is the template's own (`speaks`), and every template that has one
  // gets the same 'speech' channel for the reason argued on that field.
  const phrase = t.speaks?.(spellShortName(entry.name))
  if (phrase !== undefined) {
    def.audio = 'speech'
    def.speech = { mode: 'custom', phrase }
  }
  return def
}

/**
 * Build the AlertDef for one (rank, rank-template) pair. The trigger pins the DISPLAY name
 * with its suffix, which is exactly what makes the def go stale on a level-up — and exactly
 * what `detectRankUpgrades` (shared/spellLines.ts) looks for.
 *
 * THE RESIST CHIP SAYS WHICH SPELL (JOS-347). Every resist suggestion draws the same pack sound,
 * which is right for a player who owns one of them and useless for the player who reported this:
 * a bard clicked the chip on all four Tuyen chants and got four alerts that were, to the ear, one
 * alert. And a bard is exactly the case that produces them at once — measured against the owner's
 * own log, a bard's songs all re-apply in the SAME six-second pulse, so the four resist lines
 * arrive together. Four identical sounds in one instant is one sound (audioThrottle.ts, and it is
 * right to fold them); four DIFFERENT lines are four facts, and the throttle now keeps them all.
 * So the def the wizard authors names its own spell out loud, in the same shape and for the same
 * reasons as `landsOnOther`: `audio:'speech'`, because the whole value of this suggestion is the
 * word that tells the four chants apart. (It shipped on the combined 'both' channel until JOS-362
 * retired that channel.) The phrase is editable like any other — this is the DEFAULT that the
 * reporter had to build by hand four times.
 *
 * `castRank` is deliberately left alone: its lines are one per cast, not one per song pulse, and
 * a chip that starts talking because its twin had to is a change nobody asked for.
 */
function buildRankDef(
  entry: SpellCatalogEntry,
  rank: string,
  template: RankTemplateKind,
  packId: string
): AlertDef {
  const t = RANK_TEMPLATES[template]
  // resist carries a caster field: pin it to YOUR casts so a pet's or a bystander's resist of
  // the same spell never fires the alert (the parser sets caster='you' for your own — Task #51).
  const where: Record<string, string> =
    template === 'resistRank' ? { caster: 'you', spell: rank } : { spell: rank }
  const def: AlertDef = {
    id: `suggest:${entry.key}:${template}:${spellIdFragment(rank)}`,
    name: `${rank} ${t.verb}`,
    enabled: true,
    trigger: { type: 'event', kind: t.kind, where },
    sound: { packId, soundId: t.sound },
    cooldownMs: DEFAULT_COOLDOWN_MS,
    note: `Suggested alert - ${template} for ${rank}.`
  }
  if (template === 'resistRank') {
    def.audio = 'speech'
    // The SHORT name, the way every other spoken default in this file says a spell: "Tuyen's
    // Chant of Frost V" is four syllables of preamble before the one word that tells the four
    // chants apart. `spellShortName` strips the rank first, so the phrase survives a level-up
    // the same way the rank-blind matcher does.
    def.speech = { mode: 'custom', phrase: `${spellShortName(rank)} resisted` }
  }
  return def
}

/**
 * All suggestions the spell DB supports for this catalog entry (excludes the shared illusion
 * one). When a `rank` is supplied — the MOST RECENTLY CAST rank of the entry's line, per the
 * owner's ordering rule — the two rank-pinned templates are offered as well.
 *
 * `packId` is the user's default-pack preference (JOS-273), defaulting to the shipped pack so
 * every existing caller and test reads exactly as it did.
 */
export function suggestionsFor(
  entry: SpellCatalogEntry,
  rank?: SpellRank | null,
  packId: string = DEFAULT_PACK_ID
): Suggestion[] {
  const out: Suggestion[] = []
  // The rank-LESS chips, in the order they are offered — one entry per flag, walked rather than
  // branched. It was eight `if`s until JOS-318 added the seventh and eighth and pushed the function
  // past its complexity ceiling; the order is the record's own and the list is the whole of it.
  // (`charmBreaks` is disjoint with `breaks` by construction — `charmSpell` is tested first in
  // classifyWornOff, so the two rosters cannot both claim a spell; tests/charmCcRoster pins it.)
  const RANKLESS: readonly TemplateKind[] = [
    'wearsOff',
    'fade',
    'lands',
    'landsOnYou',
    'landsOnOther',
    'healsOverTime',
    'breaks',
    'charmBreaks'
  ]
  for (const t of RANKLESS) {
    if (entry.templates[t]) out.push({ template: t, def: buildDef(entry, t, packId) })
  }
  // Rank-pinned chips are offered only for a rank we have actually SEEN cast: a rank the log
  // has never printed cannot be confirmed to exist for this character, and an alert on a
  // spelling we guessed would sit there silently forever.
  if (rank?.lastCastMs != null) {
    out.push({
      template: 'castRank',
      rank: rank.name,
      def: buildRankDef(entry, rank.name, 'castRank', packId)
    })
    if (entry.spellType === 'Detrimental') {
      out.push({
        template: 'resistRank',
        rank: rank.name,
        def: buildRankDef(entry, rank.name, 'resistRank', packId)
      })
    }
  }
  return out
}

/** The single, shared illusion-fade suggestion (deduped — one alert for any illusion). */
export function illusionSuggestion(packId: string = DEFAULT_PACK_ID): Suggestion {
  return {
    template: 'illusion',
    def: {
      id: 'suggest:illusion:fade',
      name: 'Illusion fades',
      enabled: true,
      trigger: { type: 'event', kind: 'illusionFade' },
      // "It has all gone rather pear-shaped."
      sound: { packId, soundId: 'task-error-buzz-01' },
      cooldownMs: DEFAULT_COOLDOWN_MS,
      note: 'Suggested alert (Task #38) - fires when your illusion clicks/wears off.'
    }
  }
}
