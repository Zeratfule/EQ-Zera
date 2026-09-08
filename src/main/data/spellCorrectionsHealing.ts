// THE SHAMAN HEAL-OVER-TIME LADDER: THE STUB, FILLED IN FROM THE LOG (JOS-318).
//
// One drift class of the corrections overlay, in its own file for the reason `spellCorrectionsSubjects.ts`
// is in its own file: `spellCorrectionsList.ts` is where the argument for a family lives, and that
// file carries a code-mass ceiling shared with nothing. READ THAT FILE'S HEADER FIRST — the evidence
// bar, the five drift classes and the idempotence rules are stated there and every entry below is
// held to them. `spellCorrections.ts` is the mechanism; this list is appended to the same pass.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE REPORT (01KZZXVW888E09C088QBRD5HCD, v0.27.0, a shaman): "Slugs healing audio trigger not
// working. Tortoise Healing works, but even when manually changing the spell name regex to Slugs,
// the audio trigger doesn't go off." Both halves of that sentence are the same fact, and the
// reporter had isolated it better than the report knew: the two spells are ADJACENT RANKS OF ONE
// LADDER — Snails 14 → Tortoises 28 → Slugs 42 → Sloths 50 — and the wiki filled the messages in for
// exactly one of them.
//
//   Tortoises Healing  msgCastOnYou `You being to feel healed by the tortoise.` (the game's own
//                      typo, captured faithfully) and msgWearsOff `You feel the tortoise spirit
//                      depart.` — so it earns `landsOnYou` and `wearsOff`, and it fires.
//   Slugs Healing      msgCastOnYou `You .`, msgCastOnOther `Someone .`, and no wear-off at all —
//                      the scrape stubs `applyPlaceholderMessages` blanks at load. So the spell is
//                      in NO message table, no landing and no wear-off event is ever emitted for it,
//                      and NOTHING the user types into a `where.spell` matcher — a literal, a
//                      regex, any spelling of "Slugs" — can match an event that does not exist.
//                      That is why hand-editing the pattern changed nothing, and it is the defect.
//
// THE RANK WAS NEVER THE PROBLEM, and the ticket asked. `You begin casting Slugs Healing VII.` folds
// to the same line key as `Slugs Healing` (JOS-259), and the heal-over-time tick line prints the
// bare name anyway; tests/rankBlindSpellAlerts.test.mts pins both on this reporter's own lines.
//
// THE EVIDENCE LOG IS THE OWNER'S OWN — whole-log `eqlog_Primitive_freeport.txt`, 1,732,267 lines,
// measured 2026-08-14. The reporter's slice agrees with it line for line and is cited where it adds
// the first-person half, but no count here depends on it. The wiki forms `You .` and `Someone .`
// occur ZERO times in that log, which is rule 1 read for a stub: a placeholder is not a sentence the
// game has ever printed.
//
// THE ORDER MAKES THIS POSSIBLE, and it was written down before it was needed. `loadSpellDb` runs
// the corrections overlay BEFORE the placeholder pass precisely so a correction that replaces `You .`
// with the line the game really prints wins, rather than being blanked out from under itself and
// reported stale (spellDb.ts's load-order comment says so). These are the first entries to use it.
//
// SLOTHS HEALING IS NOT CORRECTED, and that is a decision rather than an oversight. It carries the
// same two stubs, and the obvious extrapolation — `You being to feel healed by the sloth.` — is
// exactly the invented content word rule 3 forbids: the whole log holds ZERO lines mentioning a
// sloth, no reporter slice has ever carried one, and `Sloths Healing` appears in it exactly once, in
// an NPC merchant's sales pitch. It waits for a sample. What covers it in the meantime is the
// `healsOverTime` alert template (JOS-318), which rests on the healing engine's own tick line and on
// no message table at all — tests/suggestedAlertsFire.test.mts H4 is that claim.
//
// TWO TAILS ARE MINTED HERE, and they are held to the same rule the subject sweep states: a restored
// suffix must be ABSENT from the cast-on-other table or byte-identical to one already in it, never a
// partial overlap. ` is healed by the spirit of the {slug,snail}.` are new, nothing in the table is a
// suffix of either and neither has one as a suffix, and the lines they claim classify as `unknown`
// today — so nothing is taken from another classifier. `Tortoises Healing`'s own version of the same
// sentence lost only its SUBJECT and is corrected in `spellCorrectionsSubjects.ts`, where that class
// lives.

import type { SpellCorrection } from './spellCorrections'

export const HEALING_LADDER_CORRECTIONS: readonly SpellCorrection[] = [
  {
    spells: ['Slugs Healing'],
    field: 'msgCastOnYou',
    from: 'You .',
    to: 'You being to feel healed by the slug.',
    attribution: 'cast',
    evidence:
      'Owner log: 14 lines of `You being to feel healed by the slug.`, 0 of the wiki stub. The owner never casts this line himself (0 own casts), so the cast anchor is third-person and abundant: 27 `Dranix begins casting Slugs Healing IV.`-shape lines, and 248 `<X> healed <Y> over time for N hit points by Slugs Healing.` ticks that name the spell outright. Reporter slice 01KZZXVW888E09C088QBRD5HCD adds the first-person half: 12 `You begin casting Slugs Healing VII.` casts, each followed 1-4 s later by this exact sentence. The DB is its own witness for the SHAPE — `Tortoises Healing`, the rank below, states `You being to feel healed by the tortoise.` verbatim, ungrammatical `being` included — and the only word that differs is the animal the spell is named for.'
  },
  {
    spells: ['Slugs Healing'],
    field: 'msgWearsOff',
    from: null,
    to: 'You feel the slug spirit depart.',
    attribution: 'cast',
    evidence:
      'The ABSENT FIELD drift class: the wiki states no wear-off for any of the four Healing rows. Owner log: 14 lines of `You feel the slug spirit depart.` — exactly as many as the landing above, which is what a 24 s buff that always runs its course looks like. Reporter slice 01KZZXVW888E09C088QBRD5HCD carries 9 of them, each 18-45 s after a `You begin casting Slugs Healing VII.`. Same DB witness for the shape: `Tortoises Healing` states `You feel the tortoise spirit depart.`'
  },
  {
    spells: ['Slugs Healing'],
    field: 'msgCastOnOther',
    from: 'Someone .',
    to: 'Someone is healed by the spirit of the slug.',
    attribution: 'cast',
    evidence:
      'Owner log: 27 lines of `<T> is healed by the spirit of the slug.` (23 on player names, 4 on `an abhorrent`), 0 of the wiki stub. The subject is written `Someone` because that is the token `castOnOtherSuffix` strips. The tail is MINTED — see the header — and the lines classify as `unknown` today, so this adds a match and takes none.'
  },
  {
    spells: ['Snails Healing'],
    field: 'msgCastOnYou',
    from: 'You .',
    to: 'You being to feel healed by the snail.',
    attribution: 'cast',
    evidence:
      'The strongest row of the family, because the owner casts this one himself: 68 of his 69 `You begin casting Snails Healing.` casts are followed within 12 s by `You being to feel healed by the snail.` (64 such lines whole-log, 0 of the wiki stub — the count is below the cast count because one landing can only answer to one cast and two casts inside a tick share theirs).'
  },
  {
    spells: ['Snails Healing'],
    field: 'msgWearsOff',
    from: null,
    to: 'You feel the snail spirit depart.',
    attribution: 'cast',
    evidence:
      'Owner log: 63 lines of `You feel the snail spirit depart.`, and all 69 of his `You begin casting Snails Healing.` casts have one within 120 s. 0 of anything else; the wiki states no wear-off for the row.'
  },
  {
    spells: ['Snails Healing'],
    field: 'msgCastOnOther',
    from: 'Someone .',
    to: 'Someone is healed by the spirit of the snail.',
    attribution: 'cast',
    evidence:
      'Owner log: 8 lines of `<T> is healed by the spirit of the snail.`, 0 of the wiki stub. Same minted-tail argument as the slug row above, and the same sibling shape.'
  }
]
