// IS THIS NAME SHAPED LIKE A PLAYER? (JOS-250)
//
// EverQuest gives PLAYERS a single capitalized word with no space in it — Scooba, Kaldurak,
// Phatez, Primitive — and gives MOBS an article plus a noun phrase — `a froglok ton knight`,
// `an elite dragoon`, `a fire giant warrior`. The log capitalizes a sentence-initial article
// (`A fire giant warrior begins singing Solon's Bewitching Bravura.`), which is exactly why
// CAPITALIZATION IS NOT THE DISCRIMINATOR and the WORD COUNT is (AGENTS.md states the same trap
// for the tell family: `A gorgon told you, …` looks as proper-named as `Shiro tells you, …`).
//
// WHAT THIS IS FOR, and what it is emphatically not. It gates the ONE inference in this app that
// has to read a stranger's name off a third-person line and decide whether a person is behind it:
// the ally-charm bind (`<Name> begins casting <charm spell>.` joined to a caster-less
// `<mob> has been charmed.`). Without it the log's own
//
//     A fire giant warrior begins singing Solon's Bewitching Bravura.
//
// would bind a mob as a charmer. It is NOT a way to grow `EngineState.knownPlayers`, whose two
// narrow sources are deliberate and whose entries delete real damage when they are wrong
// (state.ts's notePlayer carries the measurement). A shape is weaker evidence than a heal line,
// so it stays in its own set, used by its own gate.
//
// THE HONEST LIMITS, stated rather than discovered later:
//   * a single-word proper-named MOB passes (`Innoruuk`, `Phinigel`). Callers pair this with the
//     behavioural refusals that already exist — a name you have LANDED DAMAGE ON is a mob
//     (`everStruck`), a name any charm broadcast has ever named is a mob (`everCharmed`), a name
//     that is or was your pet is a pet (`everPet`) — which is the same three-guard belt
//     `notePlayer` wears.
//   * a name with a space in it is refused even when a player has one; EQ Legends does not issue
//     those, and admitting spaces would admit every mob in the game.
//   * it says nothing about whether the person is FRIENDLY. That is the caller's question too.

/** Leading article, the mob-name marker EQ prints (sentence-initial or not). */
const ARTICLE_RE = /^(?:a|an|the)\s/i

/**
 * A single capitalized word: a letter, then letters/apostrophes/backticks. EQ names carry
 * backticks and apostrophes (`T\`Kail`, `N'Kari`); they never carry spaces, digits or punctuation
 * beyond those two. Anchored at both ends, so any multi-word phrase is refused outright.
 */
const SINGLE_WORD_NAME_RE = /^[A-Z][A-Za-z`']*$/

/** True when `name` has the shape EverQuest gives a PLAYER (see the header for the limits). */
export function isPlayerShapedName(name: string): boolean {
  const n = name.trim()
  if (n.length === 0) return false
  // Stated separately from the single-word test even though `a ` could never satisfy it: the
  // article is THE mob marker, and a reader looking for "how do we refuse mobs" should find it.
  if (ARTICLE_RE.test(n)) return false
  return SINGLE_WORD_NAME_RE.test(n)
}
