// The SHARED SCRUB (src/shared/logScrub.ts) — the ONE definition of "third-party chat/social".
//
// Promoted this wave out of `tests/fixture-scrub.mjs`, because the same drop list now governs
// TWO artifacts that must never disagree: the `tests/fixtures/*.log` committed to a PUBLIC
// repo, and the log slice a user attaches to an in-app bug report. Re-implementing a second
// drop list for the app was forbidden by AGENTS.md; this suite is what keeps the one list
// honest.
//
// Every sample below is copied from the live log or a committed fixture — never invented. The
// families are the five enumerated in the module header, and ALL FOUR carve-outs are pinned:
//   * the pet-claim tell — an NPC pet's binding signal for a summoned pet, kept verbatim,
//     with no dependence on who is reading the log;
//   * the six pet-voiced PUBLIC says (JOS-47) — the same argument (an NPC's words, an NPC's
//     name) for the only public evidence that an entity is somebody's pet. Pinned as an EXACT
//     sentence set, because a loose `Master` pattern would have leaked six kinds of mob flavor;
//   * the `/pet who leader` answer (JOS-52) — the one pet-voiced line that names its OWNER, so
//     the one that binds AND the one that carries a player's name inside the quote. SELF-GATED
//     until JOS-270; kept whatever name it carries since (owner ruling 2026-08-13), which puts
//     it on the same footing as the two above it;
//   * the owner's own /who row — kept ONLY for the name passed in `selfName`, which is the
//     whole reason the carve-out became a PARAMETER instead of a constant (a fixture's self is
//     'Primitive'; a user's report's self is whoever they are playing).
//
// The last test pins `tests/fixture-scrub.mjs` (now a shim) to this module, so the promotion
// cannot silently drift back into two opinions.
//
// No Electron, no network, no fixtures — this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PET_CLAIM_RE,
  PET_LEADER_RE,
  PET_SAY_RE,
  isThirdPartyChat,
  scrubKeep,
  scrubLines
} from '../src/shared/logScrub'
import {
  SELF_NAME as SHIM_SELF_NAME,
  scrubKeep as shimScrubKeep,
  isThirdPartyChat as shimIsThirdPartyChat,
  PET_CLAIM_RE as SHIM_PET_CLAIM_RE
} from './fixture-scrub.mjs'

// ---------------------------------------------------------------------------------------
// logScrub — the families, against real log text
// ---------------------------------------------------------------------------------------

const SELF = 'Primitive'

/** Lines that must NEVER survive into a public fixture or an attached slice. */
const DROPPED: Record<string, string[]> = {
  'quoted speech': [
    "[Tue Jul 28 21:35:25 2026] Dranix tells the group, 'shinlord'",
    "[Tue Jul 28 22:13:52 2026] Dranix tells the group, 'What? Ghoulbane?'",
    "[Wed Jul 29 01:20:33 2026] Rykkerr tells you, 'want a port?'",
    "[Wed Jul 29 01:20:33 2026] You told Rykkerr, 'sure, thanks'",
    "[Wed Jul 29 01:20:33 2026] Rykkerr tells General:1, 'WTS Ghoulbane'",
    "[Wed Jul 29 01:20:33 2026] You tell NewPlayers6:1, 'where is the bank'",
    "[Wed Jul 29 01:20:33 2026] Rykkerr says, 'hail'",
    "[Wed Jul 29 01:20:33 2026] Rykkerr says out of character, 'lfg'",
    "[Wed Jul 29 01:20:33 2026] Rykkerr shouts, 'train to zone'",
    "[Wed Jul 29 01:20:33 2026] Rykkerr auctions, 'WTB Fine Steel'",
    "[Wed Jul 29 01:20:33 2026] You say, 'hail'",
    // mob speech goes too: nothing parses it, and a named NPC is indistinguishable from a
    // player name by shape alone
    "[Sat Aug 01 19:29:05 2026] a Teir`Dal ranger says, 'You will die!'"
  ],
  '/who output': [
    '[Tue Jul 28 14:11:26 2026] Players in EverQuest Legends:',
    '[Tue Jul 28 14:11:26 2026] ---------------------------',
    '[Tue Jul 28 14:11:26 2026] [ANONYMOUS] Brash ',
    '[Tue Jul 28 14:11:26 2026] [3 WAR/NEC] Redlola (Human)  ZONE: West Commonlands (commons)  ',
    '[Tue Jul 28 14:11:26 2026] [4 BRD/BER] Gooner (Kerran)  ZONE: West Commonlands (commons)  ',
    '[Tue Jul 28 14:11:26 2026] There are 50 players in EverQuest Legends.',
    '[Tue Jul 28 14:11:26 2026] There is 1 player in EverQuest Legends.',
    '[Tue Jul 28 14:11:26 2026] AFK [3 CLR/DRU] Ehle (Dark Elf)  ZONE: West Commonlands (commons)  ',
    '[Tue Jul 28 14:11:26 2026] * RIP * [3 CLR/DRU] Ehle (Dark Elf)  ZONE: West Commonlands (commons)  '
  ],
  'player emotes': [
    '[Wed Jul 29 01:20:33 2026] Rykkerr waves at Primitive.',
    '[Wed Jul 29 01:20:33 2026] Rykkerr bows before Primitive.',
    '[Wed Jul 29 01:20:33 2026] You wave at Rykkerr.',
    '[Wed Jul 29 01:20:33 2026] You thank at Rykkerr.'
  ],
  'guild motd': [
    '[Wed Jul 29 01:20:33 2026] GUILD MOTD: raid at 8',
    '[Wed Jul 29 01:20:33 2026] Guild message of the day: raid at 8'
  ]
}

/** Lines the world model needs. Dropping any of these silently corrupts a golden expectation. */
const KEPT: Record<string, string[]> = {
  combat: [
    '[Sun Aug 02 15:30:39 2026] You slash a Teir`Dal ranger for 42 points of damage.',
    '[Sun Aug 02 15:30:39 2026] A zol ghoul knight hits YOU for 17 points of damage.',
    '[Sun Aug 02 15:30:39 2026] You try to frenzy on a deadly black widow, but miss!',
    '[Sun Aug 02 19:28:52 2026] A zol ghoul knight resisted your Condemnation of Nife!',
    '[Sun Aug 02 15:32:00 2026] You have slain Baron Telyx V`Zher!',
    '[Sun Aug 02 17:10:51 2026] You healed Primitive for 1351 (5968) hit points by Lay on Hands VI.'
  ],
  'casts, buffs, stances': [
    '[Sun Aug 02 15:30:23 2026] You begin casting Swift Like the Wind I.',
    '[Sun Aug 02 15:30:25 2026] Your speed returns to normal.',
    '[Sun Aug 02 15:30:25 2026] You assume an offensive stance.',
    '[Sun Aug 02 15:30:25 2026] You activate Quick Buff.',
    '[Sun Aug 02 15:30:25 2026] Your illusion fades.'
  ],
  'loot, zones, progress': [
    "[Sun Aug 02 15:32:05 2026] --You have looted a Ghoulbane from a zol ghoul knight's corpse.--",
    '[Mon Aug 03 01:23:01 2026] You have entered The Ruins of Old Paineel.',
    '[Sun Aug 02 15:32:05 2026] You gain party experience! (1.42%)',
    '[Sun Aug 02 15:32:05 2026] You have gained 1 ability point(s)! You now have 3 ability point(s).',
    '[Sun Aug 02 15:32:05 2026] You have become better at 1H Slashing! (122)'
  ],
  // Group MEMBERSHIP events are structural facts, not communications (owner decision
  // 2026-08-05): the same names appear in every combat line of the same slice, and these
  // lines are the context a combat triage needs. Chat CONTENT (`tells the group, '…'`)
  // still falls to the quoted-speech family — see the DROPPED block above.
  'group membership events': [
    '[Tue Jul 28 21:09:31 2026] Dranix has joined the group.',
    '[Tue Jul 28 21:09:31 2026] Dranix has left the group.',
    '[Tue Jul 28 21:09:31 2026] Dranix invites you to join a group.',
    '[Tue Jul 28 21:09:31 2026] Dranix is now the leader of your group.'
  ],
  // Mob emotes are not SOCIAL emotes: no proper-name subject, nobody's words.
  'mob emotes': [
    '[Sun Aug 02 15:30:39 2026] a Teir`Dal ranger yawns.',
    '[Sun Aug 02 15:30:39 2026] an ice giant priest sighs in tranquility.'
  ]
}

test('every enumerated third-party family is DROPPED', () => {
  for (const [family, lines] of Object.entries(DROPPED)) {
    for (const line of lines) {
      assert.equal(
        isThirdPartyChat(line, { selfName: SELF }),
        true,
        `${family} must drop: ${line}`
      )
      assert.equal(scrubKeep(line, { selfName: SELF }), false)
    }
  }
})

test('everything the world model reads is KEPT', () => {
  for (const [family, lines] of Object.entries(KEPT)) {
    for (const line of lines) {
      assert.equal(scrubKeep(line, { selfName: SELF }), true, `${family} must keep: ${line}`)
      // and keeping does not depend on knowing who "self" is
      assert.equal(scrubKeep(line), true, `${family} must keep without selfName: ${line}`)
    }
  }
})

// ---- CARVE-OUT 1: the pet-claim tell ----------------------------------------------------

const PET_CLAIMS = [
  "[Sat Aug 01 19:29:05 2026] An ice giant priest told you, 'Attacking an ice giant Master.'",
  "[Sat Aug 01 19:32:23 2026] An ice giant priest told you, 'Attacking giant wooly spider Master.'",
  "[Sun Jul 19 23:07:26 2026] Konartik told you, 'I am unable to wake a Rosch Mas Gnoll, Master.'"
]

test('CARVE-OUT: the pet-claim tell survives — it is the ONLY binding signal for a pet', () => {
  for (const line of PET_CLAIMS) {
    assert.ok(PET_CLAIM_RE.test(line), `PET_CLAIM_RE must match: ${line}`)
    // kept with a self name, without one, and for a DIFFERENT character's log: a pet's tell
    // has nothing to do with who is reading it.
    assert.equal(scrubKeep(line, { selfName: SELF }), true)
    assert.equal(scrubKeep(line), true)
    assert.equal(scrubKeep(line, { selfName: 'Vexxa' }), true)
  }
})

test('a real tell that merely mentions a pet is NOT the carve-out', () => {
  // The carve-out is anchored on the exact pet-claim wording at end of line. Anything else
  // that quotes a person is still quoted speech.
  const notAClaim = [
    "[Sat Aug 01 19:29:05 2026] Rykkerr told you, 'Attacking your Master.' and then laughed",
    "[Sat Aug 01 19:29:05 2026] Rykkerr told you, 'nice pet'",
    "[Sat Aug 01 19:29:05 2026] Rykkerr tells you, 'Attacking an ice giant Master.'"
  ]
  for (const line of notAClaim) {
    assert.equal(scrubKeep(line, { selfName: SELF }), false, `must drop: ${line}`)
  }
})

// ---- CARVE-OUT 2: the pet-voiced PUBLIC say (JOS-47) --------------------------------------
//
// Six exact sentences, all copied verbatim from the real log's 113 occurrences. They are an
// NPC's words spoken by an NPC's name, so keeping them costs no one their privacy — and they
// are the only public evidence that an entity is somebody's pet, which the meter's
// "<Name> — your pet?" offer is built on. A fixture that cannot carry them cannot test it.

const PET_SAYS = [
  "[Thu Jul 30 16:10:18 2026] Kober says, 'Sorry, Master... calming down.'",
  "[Thu Jul 30 16:10:24 2026] Kober says, 'Now regrouping, master.'",
  "[Thu Jul 30 16:29:50 2026] Kober says, 'As you wish, oh great one.'",
  "[Sun Jul 26 21:44:12 2026] Gobantik says, 'Following you, Master.'",
  "[Wed Jul 22 02:11:53 2026] An isle goblin says, 'Now holding, Master.  I will not start new attacks until ordered.'",
  "[Fri Jul 24 18:03:09 2026] A large heart spider says, 'I beg forgiveness, Master.  That is not a legal target.'"
]

test('CARVE-OUT: the six pet-voiced SAY sentences survive — they are an NPC pet speaking', () => {
  for (const line of PET_SAYS) {
    assert.ok(PET_SAY_RE.test(line.slice(line.indexOf('] ') + 2)), `PET_SAY_RE must match: ${line}`)
    // Like the tell, this has no self-name dependence: a pet's name is nobody's identity.
    assert.equal(scrubKeep(line, { selfName: SELF }), true)
    assert.equal(scrubKeep(line), true)
    assert.equal(scrubKeep(line, { selfName: 'Vexxa' }), true)
  }
})

test('the vocabulary is EXACT — mob flavor that merely says "master" is still dropped', () => {
  // Every one of these is real, and every one of them is a mob talking about ITS master or a
  // player talking about a mastery AA. An anchored six-sentence alternation is the whole
  // safety of the carve-out; a `/Master/` pattern would have leaked all of them.
  const stillDropped = [
    "[Thu Aug 06 19:04:11 2026] An ire ghast says, 'Uninvited guests to our master's home must be shown the way out!'",
    "[Thu Aug 06 19:12:02 2026] A scorn banshee says, 'You are almost beneath notice, but our master commands your death.'",
    "[Thu Aug 06 19:20:41 2026] Cleric of Innoruuk says, 'None shall defile the realm of our master!'",
    "[Tue Jul 28 03:14:55 2026] Cazic-Thule shouts, 'Denizens of Fear, your master commands you to come forth to his aid!'",
    "[Thu Aug 06 19:31:22 2026] Cleric of Innoruuk's corpse says, 'Innoruuk, I have failed you!'",
    "[Wed Jul 29 11:02:14 2026] Bloody tells General1:1, 'Wu's Fist of Mastery +6 is what ya want'",
    // …and the pet sentence spoken on ANY other channel is still a person's words.
    "[Thu Jul 30 16:10:18 2026] Rykkerr tells you, 'Sorry, Master... calming down.'",
    "[Thu Jul 30 16:10:18 2026] Rykkerr shouts, 'As you wish, oh great one.'"
  ]
  for (const line of stillDropped) {
    assert.equal(scrubKeep(line, { selfName: SELF }), false, `must drop: ${line}`)
  }
})

// ---- CARVE-OUT 3: the `/pet who leader` answer, UN-GATED since JOS-270 --------------------
//
// `<Name> says, 'My leader is <Someone>.'` is the only line in this log in which a pet names its
// OWNER, which is what makes it a bind rather than a nomination — and what makes it the first
// pet-voiced line to carry a PLAYER's name inside the quote. Carve-outs 1 and 2 both rest on
// "an NPC's words under an NPC's name, so nobody's privacy is at stake". Until JOS-270 this one
// could not borrow that and borrowed carve-out 4's instead (your own name is yours to publish),
// so it was gated on `selfName` and a THIRD PARTY's leader say was dropped.
//
// OWNER RULING 2026-08-13 removed the gate, on the 2026-08-05 group-membership reasoning: the
// leader's name is a structural fact about the fight, not a communication, and both names in it
// already appear uncensored in every combat line of the same slice. The gate's real cost was
// measured on report 01KZVYMCAD72XFC36D73D8J2E8 — the LIVE app binds a group-mate's pet off this
// line, but no feedback slice could ever contain one, which made that whole defect structurally
// un-triageable.
//
// MEASURED (whole-log sweep, 1,404,458 lines, 2026-08-06): one member, one occurrence.

const LEADER_SELF = "[Thu Aug 06 12:44:20 2026] Jaber says, 'My leader is Primitive.'"
const LEADER_THIRD_PARTY = "[Thu Aug 06 12:44:20 2026] Vebarn says, 'My leader is Rykkerr.'"
/** The evidence line from report 01KZVYMCAD72XFC36D73D8J2E8, which today's scrub deleted. */
const LEADER_REPORT = "[Wed Aug 12 17:19:31 2026] Gasarn says, 'My leader is Zeksara.'"

test('CARVE-OUT: the /pet who leader answer survives whatever name it carries', () => {
  // The real line, verbatim, from tests/fixtures/p2-pet-arc-bound.log.
  assert.equal(scrubKeep(LEADER_SELF, { selfName: SELF }), true)
  assert.ok(PET_LEADER_RE.test(LEADER_SELF.slice(LEADER_SELF.indexOf('] ') + 2)))
  // Case-insensitive, like every other name comparison (world-model law 2).
  assert.equal(scrubKeep(LEADER_SELF, { selfName: 'primitive' }), true)
  // …and UN-gated since JOS-270: a group-mate's pet naming the group-mate is the evidence a
  // combat report needs, and it survives for every reader.
  assert.equal(scrubKeep(LEADER_SELF, { selfName: 'Vexxa' }), true)
  assert.equal(scrubKeep(LEADER_THIRD_PARTY, { selfName: SELF }), true)
  assert.equal(scrubKeep(LEADER_REPORT, { selfName: 'Vexxa' }), true, 'JOS-270 acceptance')
  // No `selfName` at all is no longer a reason to drop it — the carve-out consults no name.
  assert.equal(scrubKeep(LEADER_SELF), true)
  assert.equal(scrubKeep(LEADER_THIRD_PARTY), true)
  assert.equal(scrubKeep(LEADER_REPORT, { selfName: '' }), true)
})

test('the leader shape is EXACT — the other lines containing "leader" are untouched', () => {
  // The same sweep that found the one pet line found twelve others carrying "leader": seven
  // group-leader lines and five players discussing leadership in chat. A `/leader/` pattern
  // would have taken opinions about all of them; these keep behaving exactly as they did, and
  // un-gating the carve-out did not widen it by one line.
  assert.equal(
    scrubKeep('[Thu Aug 06 12:20:01 2026] Rykkerr is now the leader of your group.', { selfName: SELF }),
    true,
    'group membership events are KEPT (owner decision 2026-08-05), and not by this carve-out'
  )
  for (const line of [
    "[Wed Jul 29 11:02:14 2026] Bloody tells General1:1, 'you the leader fire it up'",
    "[Wed Jul 29 11:03:41 2026] Bloody tells General1:1, 'poor leader'",
    // the shape on ANOTHER CHANNEL is a person's words, exactly as in carve-out 2 — `says` is
    // the only channel a pet has, so this is where the un-gated carve-out stops
    "[Thu Aug 06 12:44:20 2026] Rykkerr tells you, 'My leader is Primitive.'",
    "[Thu Aug 06 12:44:20 2026] Rykkerr shouts, 'My leader is Primitive.'",
    "[Thu Aug 06 12:44:20 2026] Rykkerr tells the group, 'My leader is Primitive.'",
    // …and the sentence must be the whole quote, ending where the game ends it
    "[Thu Aug 06 12:44:20 2026] Rykkerr says, 'My leader is Primitive and he is afk'",
    "[Thu Aug 06 12:44:20 2026] Rykkerr says, 'who is My leader is Primitive.'"
  ]) {
    assert.equal(scrubKeep(line, { selfName: SELF }), false, `must drop: ${line}`)
  }
})

test('the leader carve-out consults NO name, so no name can widen or narrow it', () => {
  // It used to reach an equality test against `selfName`; since JOS-270 it reaches nothing at
  // all, and a pathological name cannot change the answer in either direction.
  for (const selfName of ['Prim.tive', 'Nobody|Primitive', '.*', '', 'Vebarn']) {
    assert.equal(scrubKeep(LEADER_SELF, { selfName }), true)
    assert.equal(scrubKeep(LEADER_THIRD_PARTY, { selfName }), true)
    assert.equal(
      scrubKeep("[Wed Jul 29 01:20:33 2026] Rykkerr says, 'hail'", { selfName }),
      false,
      'and ordinary speech still goes'
    )
  }
})

// ---- CARVE-OUT 4: the owner's own /who row, PARAMETERIZED --------------------------------

/** The real self rows from the log, for two different owners. */
const selfWho = (name: string): string[] => [
  `[Tue Jul 28 20:16:48 2026] [17 PAL/MNK/ENC] ${name} (Dark Elf)  ZONE: The City of Guk (guktop)  `,
  `[Tue Jul 28 14:11:26 2026] [7 CLR/BER] ${name} (Froglok)  ZONE: West Commonlands (commons)  `,
  `[Tue Jul 28 14:11:26 2026] AFK [7 CLR/BER] ${name} (Froglok)  ZONE: West Commonlands (commons)  `,
  `[Tue Jul 28 14:11:26 2026] * RIP * [7 CLR/BER] ${name}'s corpse (Froglok)  ZONE: West Commonlands (commons)  `
]

test('CARVE-OUT: the owner\'s own /who row survives — for the name they passed in', () => {
  // The carve-out is a PARAMETER now: a fixture's self is Primitive, a user's report's self is
  // whoever they are playing. Both work, and neither leaks the other.
  for (const name of ['Primitive', 'Vexxa']) {
    for (const line of selfWho(name)) {
      assert.equal(scrubKeep(line, { selfName: name }), true, `self row must keep: ${line}`)
      // ...and the SAME row is third-party chat to anybody else's slice
      assert.equal(scrubKeep(line, { selfName: 'Someone' }), false, `stranger must drop: ${line}`)
      // ...and with no self declared there is no carve-out at all (the safe default)
      assert.equal(scrubKeep(line), false, `no selfName must drop: ${line}`)
      assert.equal(scrubKeep(line, { selfName: '' }), false, `empty selfName must drop: ${line}`)
    }
  }
})

test('the self carve-out is a NAME, not a pattern', () => {
  // A name is inserted into a regex, so its metacharacters must be literal — otherwise
  // `Prim.tive` would claim `Primitive`'s row, and a name with a `|` could claim anyone's.
  const row = '[Tue Jul 28 14:11:26 2026] [7 CLR/BER] Primitive (Froglok)  ZONE: West Commonlands (commons)  '
  assert.equal(scrubKeep(row, { selfName: 'Prim.tive' }), false)
  assert.equal(scrubKeep(row, { selfName: 'Nobody|Primitive' }), false)
  assert.equal(scrubKeep(row, { selfName: 'Primitive' }), true)
  // A prefix is not a name: `\b` after the name stops `Prim` claiming `Primitive`.
  assert.equal(scrubKeep(row, { selfName: 'Prim' }), false)
})

test('the self carve-out does not extend to the owner being quoted', () => {
  // Even your own words are somebody else's conversation; only the /who ROW is exempt.
  assert.equal(
    scrubKeep("[Wed Jul 29 01:20:33 2026] You told Rykkerr, 'sure, thanks'", { selfName: SELF }),
    false
  )
  assert.equal(
    scrubKeep('[Wed Jul 29 01:20:33 2026] Primitive waves at Rykkerr.', { selfName: SELF }),
    false
  )
})

// ---- scrubLines: the counting variant the preview depends on -----------------------------

test('scrubLines returns the kept lines and an honest dropped count, in ONE pass', () => {
  const lines = [
    ...KEPT.combat!,
    ...DROPPED['quoted speech']!,
    ...PET_CLAIMS,
    ...selfWho(SELF)
  ]
  const res = scrubLines(lines, { selfName: SELF })
  const expectedKept = KEPT.combat!.length + PET_CLAIMS.length + selfWho(SELF).length
  assert.equal(res.kept.length, expectedKept)
  assert.equal(res.dropped, DROPPED['quoted speech']!.length)
  assert.equal(res.kept.length + res.dropped, lines.length)
  // kept lines are VERBATIM and in order — a scrub DROPS, it never rewrites (the law)
  assert.deepEqual(
    res.kept,
    lines.filter((l) => scrubKeep(l, { selfName: SELF }))
  )
  for (const line of res.kept) assert.ok(lines.includes(line))

  // without a self name the same corpus loses exactly the four /who rows
  const anon = scrubLines(lines)
  assert.equal(anon.dropped, res.dropped + selfWho(SELF).length)
  assert.equal(anon.kept.length + anon.dropped, lines.length)

  const empty = scrubLines([])
  assert.deepEqual(empty, { kept: [], dropped: 0 })
})

// ---- the shim is a shim, not a second opinion --------------------------------------------

test('tests/fixture-scrub.mjs agrees with the shared module, line for line', () => {
  assert.equal(SHIM_SELF_NAME, SELF)
  // the SAME regex object, not a copy of it — a copy is how two opinions start
  assert.equal(SHIM_PET_CLAIM_RE, PET_CLAIM_RE)
  const corpus = [
    ...Object.values(DROPPED).flat(),
    ...Object.values(KEPT).flat(),
    ...PET_CLAIMS,
    ...PET_SAYS,
    LEADER_SELF,
    "[Thu Aug 06 12:44:20 2026] Vebarn says, 'My leader is Rykkerr.'",
    ...selfWho(SELF),
    ...selfWho('Vexxa'),
    // a couple of shapes with no timestamp prefix at all (an extractor's raw first line)
    'Players in EverQuest Legends:',
    'You have entered The Ruins of Old Paineel.'
  ]
  for (const line of corpus) {
    assert.equal(
      shimScrubKeep(line),
      scrubKeep(line, { selfName: SHIM_SELF_NAME }),
      `shim disagrees on: ${line}`
    )
    assert.equal(
      shimIsThirdPartyChat(line),
      isThirdPartyChat(line, { selfName: SHIM_SELF_NAME }),
      `shim disagrees on: ${line}`
    )
  }
})
