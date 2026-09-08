// planner/weaponType.ts — WHAT KIND OF WEAPON A GEAR ROW IS (JOS-302, the owner's third ask:
// *searching among weapon types (1HS, 2HS, 1HB, 1HP, 2HB, piercing) and among categories that span
// several types*).
//
// THE DATA WAS ALREADY THERE, AND THAT IS THE FIRST THING THIS FILE EXISTS TO RECORD. `GearRow.skill`
// has carried the wiki's `Skill:` line verbatim since phase 2 (`gearIndex.ts optionalFields` reads
// `k.stats.skill`) and `tests/gearIndex.test.mts` already pinned Thelvorn's as `1H Slashing`. Nothing
// had to be plumbed; what was missing was a VOCABULARY to compare two of those strings with.
//
// THE VOCABULARY IS MEASURED, NOT REMEMBERED. Census over the committed corpus (2026-08-13 build,
// 6,814 equippable rows, 1,614 of them stating a `Skill:`):
//
//     1H Slashing 413 · Piercing 322 · 1H Blunt 321 · 2H Slashing 223 · 2H Blunt 195 ·
//     Archery 63 · 2H Piercing 24 · Throwingv2 22 · Hand to Hand 11 · Throwingv1 8 ·
//     Throwing 7 · 1H Piercing 2 · SHIELD 1 · "1H Slashing /" 1 · 1H Slash 1
//
// FOUR THINGS THAT CENSUS SAYS OUT LOUD, and every one of them shaped the table below.
//
//   1. THE CORPUS SPELLS ONE SKILL FOUR WAYS. `1H Slashing`, `1H Slash` and `1H Slashing /` are one
//      skill written by three editors, and `Throwing` / `Throwingv1` / `Throwingv2` are one skill
//      with the wiki's own template-version suffix stuck to it. So a raw-string compare is not a
//      filter, it is a lottery — the fold below is law 2 (names are dirty; canonicalize at the
//      boundary, display raw) applied to a field nobody had had to compare before.
//   2. THE CLASSIC PIERCING SKILL IS SPELLED BARE. 322 pages say `Piercing` and 2 say `1H Piercing`;
//      the game's one-handed piercing skill has no `1H` in its name, and `2H Piercing` is the later,
//      separately-named one. Both bare spellings fold to `1HP` and `2H Piercing` stands alone.
//   3. NOTHING IS INVENTED. Only the fifteen spellings the corpus actually states are in the table.
//      `1H Crushing`, `H2H`, `Bash` and every other plausible synonym are ABSENT on purpose (the
//      awaiting-sample law): a spelling the wiki has never printed gets an entry the day it prints
//      one, and `tests/gearIndex.test.mts` fails the suite over the corpus's census until it does.
//   4. `SHIELD` IS NOT A WEAPON SKILL and is not made into one. One page (Crushbone Fetish, a
//      SECONDARY with no DMG and no delay) states it, so `weaponTypeOf` answers `null` and the row
//      is simply not a weapon — the same answer the 5,200 rows that state no skill at all get. The
//      unmapped set is pinned as an EQUALITY in the index test, so a sixteenth spelling stops the
//      suite instead of quietly falling out of the filter.
//
// A CATEGORY IS A UNION OF TYPES AND NOTHING ELSE (the ticket's own words). It is not a second
// classification with its own rules — `weaponTypesFor` expands it and the predicate never learns
// that categories exist, which is what keeps "one-handed" and "1HS + 1HB + 1HP + H2H" the same
// question with two spellings.
//
// HAND TO HAND SITS UNDER ONE-HANDED, and that is the corpus's verdict rather than a memory of
// EverQuest: all eleven H2H rows are PRIMARY (10) and SECONDARY (5), which is exactly the shape of
// a one-hander and nothing like the shape of a two-hander (2H Slashing: 223 PRIMARY, 0 SECONDARY).
//
// PURE, ELECTRON-FREE AND NODE-TESTED. Value imports would be relative if it had any; it has none.

/**
 * The nine weapon skills the corpus states, folded to one token each. Ordered the way the picker
 * lists them: the one-handers, the two-handers, then the two ranged skills.
 */
export const WEAPON_TYPES = ['1HS', '1HB', '1HP', 'H2H', '2HS', '2HB', '2HP', 'ARCHERY', 'THROWING'] as const

export type WeaponType = (typeof WEAPON_TYPES)[number]

/** The picks that stand for several types at once — see the header on why a category is only a union. */
export const WEAPON_CATEGORIES = ['ONE_HAND', 'TWO_HAND', 'RANGED'] as const

export type WeaponCategory = (typeof WEAPON_CATEGORIES)[number]

/**
 * What the filter actually holds: a list of types, categories, or both. They live in ONE list rather
 * than in two fields because the answer is the same either way — the union of everything picked —
 * and two fields would have made "1HS or two-handed" an intersection question nobody asked.
 */
export type WeaponPick = WeaponType | WeaponCategory

/** Which types each category covers. The one place membership is stated. */
export const WEAPON_CATEGORY_MEMBERS: Record<WeaponCategory, readonly WeaponType[]> = {
  ONE_HAND: ['1HS', '1HB', '1HP', 'H2H'],
  TWO_HAND: ['2HS', '2HB', '2HP'],
  RANGED: ['ARCHERY', 'THROWING']
}

/**
 * Every option the control offers, categories FIRST. A player reaching for this filter usually
 * wants "the two-handers", and making them scroll past seven types to find it would be the wrong
 * order for the common question.
 */
export const WEAPON_PICKS: readonly WeaponPick[] = [...WEAPON_CATEGORIES, ...WEAPON_TYPES]

/**
 * The words each pick wears — the corpus's own spellings for the types, so a chip in the toolbar
 * reads the way the item page does.
 */
export const WEAPON_PICK_LABEL: Record<WeaponPick, string> = {
  ONE_HAND: 'One-handed',
  TWO_HAND: 'Two-handed',
  RANGED: 'Ranged',
  '1HS': '1H Slashing',
  '1HB': '1H Blunt',
  '1HP': '1H Piercing',
  H2H: 'Hand to Hand',
  '2HS': '2H Slashing',
  '2HB': '2H Blunt',
  '2HP': '2H Piercing',
  ARCHERY: 'Archery',
  THROWING: 'Throwing'
}

const CATEGORY_SET: ReadonlySet<string> = new Set<string>(WEAPON_CATEGORIES)

/** Is this pick a category (and therefore a union) rather than a single type? */
export function isWeaponCategory(pick: WeaponPick): pick is WeaponCategory {
  return CATEGORY_SET.has(pick)
}

/**
 * THE FOLD, over the fifteen spellings the corpus states. See the header: only measured spellings
 * are here, and the index test's census is what keeps that claim true across a rescrape.
 */
const SKILL_TYPES: ReadonlyMap<string, WeaponType> = new Map<string, WeaponType>([
  ['1H SLASHING', '1HS'],
  ['1H SLASH', '1HS'],
  ['1H BLUNT', '1HB'],
  // The classic skill is spelled bare on 322 pages and `1H Piercing` on 2 — one skill, two editors.
  ['PIERCING', '1HP'],
  ['1H PIERCING', '1HP'],
  ['HAND TO HAND', 'H2H'],
  ['2H SLASHING', '2HS'],
  ['2H BLUNT', '2HB'],
  ['2H PIERCING', '2HP'],
  ['ARCHERY', 'ARCHERY'],
  // The wiki's template version suffix, not three different skills.
  ['THROWING', 'THROWING'],
  ['THROWINGV1', 'THROWING'],
  ['THROWINGV2', 'THROWING']
])

/**
 * A `Skill:` string reduced to the shape the table is keyed by: upper case, every run of anything
 * that is not a letter or a digit collapsed to one space, ends trimmed.
 *
 * That single rule is what absorbs `1H Slashing /` (a stray separator an editor left behind) without
 * a per-typo entry — and it is a NORMALIZATION, never a repair: a spelling it does not reduce to a
 * known key stays unknown rather than being guessed at.
 */
export function normalizeSkillToken(skill: string): string {
  return skill.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

/**
 * What kind of weapon this skill names, or `null` when the string names none — which covers the
 * row that states no skill at all (5,200 of them: armour, jewellery, bags), and the one page that
 * states `SHIELD`. Absent and unrecognized give the same answer on purpose: neither is a weapon,
 * and a filter has nothing to say about either.
 */
export function weaponTypeOf(skill: string | undefined): WeaponType | null {
  if (skill === undefined) return null
  return SKILL_TYPES.get(normalizeSkillToken(skill)) ?? null
}

/** Does this one pick cover this type? A type covers itself; a category covers its members. */
export function pickCoversType(pick: WeaponPick, type: WeaponType): boolean {
  if (!isWeaponCategory(pick)) return pick === type
  return WEAPON_CATEGORY_MEMBERS[pick].includes(type)
}

/**
 * Every type a list of picks stands for — the UNION, deduped, in vocabulary order.
 *
 * The predicate does not use this (it walks the picks directly, so a keystroke over 6,814 rows
 * allocates nothing); it is here because the union is the thing the ticket specified and a claim
 * that cannot be stated cannot be tested.
 */
export function weaponTypesFor(picks: readonly WeaponPick[]): WeaponType[] {
  return WEAPON_TYPES.filter((type) => picks.some((pick) => pickCoversType(pick, type)))
}

/**
 * Does a row whose skill is `skill` survive this pick list? An EMPTY list is no filter at all — the
 * standing rule for every field of `GearFilters` — and once anything is picked a row that is not a
 * weapon is not an answer to "show me the two-handers".
 */
export function weaponPicksMatch(skill: string | undefined, picks: readonly WeaponPick[]): boolean {
  if (picks.length === 0) return true
  const type = weaponTypeOf(skill)
  return type !== null && picks.some((pick) => pickCoversType(pick, type))
}
