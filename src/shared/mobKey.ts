// mobKey.ts — THE canonical identity key for a mob name, for BOTH processes.
//
// It lived in `src/main/mobLookupParse.ts` until JOS-350 and is unchanged in behaviour; only its
// address moved. `mobLookupParse.ts` re-exports it, so every existing main-side importer is
// untouched. The move is the seam `features/overview/useCurrentMob.ts` named in its own header
// ("Main's `mobKey` additionally folds backtick variants and whitespace runs; moving it to
// src/shared is a named future seam") — the renderer had no way to reach it, so three surfaces
// spelled a WEAKER key inline (`name.trim().toLowerCase()`) and one of them, the kills join,
// was a measured bug: the Overview's Target card names the mob as `WorldModel.label()` spells
// it — with the spawn-generation ` (N)` suffix — and no kill record is ever keyed that way, so
// the mob page opened from there read 0 kills for a mob the Mobs tab counted correctly.
//
// A renderer surface that keys anything BY MOB NAME imports this. A surface that only needs to
// dedupe its own requests may keep a narrower key, but it should say so, and it should never
// use a narrower key to JOIN against data somebody else keyed.

/**
 * Canonical identity key for a MOB name. The same rule as parser.idKey (lowercase + trim) plus
 * two folds.
 *
 * QUOTE FOLD: the log writes ``Innoruuk`s Chosen`` with a backtick, the wiki writes it with a
 * typographic or straight apostrophe, and the quest catalog uses whatever its page did. Folding
 * all three to `'` is what lets one mob be one key across the three sources.
 *
 * COPY-NUMBER STRIP — a trailing ` (N)`. That suffix is OURS, not the game's: no log line ever
 * carries it (a full-log sweep of the live log finds `(N)` only in heal amounts and skill-up
 * levels). `WorldModel.label()` (combat/world.ts) appends the spawn GENERATION when more than
 * one instance of a name has been engaged — "an elemental capturer (14)" is the 14th capturer
 * this session, not a different creature — and that label rides
 * `Encounter.lastOutTarget` → `CurrentTarget.name` → the Overview tab's `lookupMob(name)`.
 * MEASURED consequence before this strip: the dev userData cache
 * (`%APPDATA%\everquest-companion-dev\mob-knowledge-cache.json`) held ELEVEN such keys —
 * 'an elemental capturer (14)', 'a rock golem (45)', 'an elemental crusader (28)',
 * 'an elemental channeler (19)', 'an elemental visier (12)', … — and every one of them was
 * `notFound`, while all eleven base names are catalog hits carrying real drop tables. Plane of
 * Sky is where it bites: the island trash comes in same-named packs, so gen counters run high.
 *
 * A copy number is not part of an identity — loot off "an elemental capturer (14)"'s corpse is
 * that mob's loot, and the wiki has exactly one page for it. Same canonicalize-at-a-boundary
 * family as the item ` +N` strip (itemLookupParse.normalizeItemName, world-model law 2), and
 * as there, DISPLAY stays raw: callers pass the untouched name to `knowledgeFromCatalog`, so
 * the card still reads "An elemental capturer (14)".
 *
 * Only DIGITS are stripped. A parenthesized WORD is part of the name (instance tiers like
 * "(Awakened)", wiki disambiguators), so `(\d+)` is the whole rule — and it is safe against the
 * committed catalog, where zero of the 7,866 entries end in a parenthesized number.
 *
 * The cache SHAPE is unchanged, so no CACHE_VERSION bump and no purge: the old ' (N)'-keyed
 * entries simply become unreachable, and being negatives they age out under NEG_TTL_MS anyway.
 *
 * Deliberately does NOT strip the leading article: "a giant rat" and "giant rat" are different
 * page titles on the wiki, and the log always prints the article, so keeping it is both honest
 * and lossless. Article-insensitive matching is a BOSS-matching rule (law 2), not this one.
 */
export function mobKey(name: string): string {
  return name
    .trim()
    .replace(/\s*\(\d+\)$/, '')
    .toLowerCase()
    .replace(/[`’´]/g, "'")
    .replace(/\s+/g, ' ')
}
