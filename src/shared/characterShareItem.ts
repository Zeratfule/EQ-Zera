// ============================================================================
// shared/characterShareItem.ts — WHAT ONE WORN ITEM SAYS, ON THE WIRE (body v2).
// ============================================================================
//
// The owner's report (2026-09-09), verbatim: *"a lot of the item names don't show what the +X
// ranks are because item names are too long, we should fix this or add the ability to see the gear
// tool tips, with exalts, and ranks to the profile link page. We should also find a way to add the
// stats added from gear to your character stats so people get a full picture of the character."*
//
// A share card used to carry a NAME per worn slot and a summed total for the whole set, which is
// two ends of a fact with the middle missing: a reader could see `Gauntlets of Fiery Might +5` and
// see `AC 447`, and had no way to ask what those gauntlets contribute. So the body now carries each
// worn item's OWN reading, and this file is that projection plus its sanitizer, kept beside
// `characterShare.ts` rather than inside it because the two halves of one item (build it, then
// rebuild it from a stranger's JSON) are a file's worth of rules on their own.
//
// ---------------------------------------------------------------------------
// IT READS EACH ITEM AT THE ` +N` THE DUMP SPELLED, THROUGH THE ONE ALGORITHM
// ---------------------------------------------------------------------------
// `wornBlock` (characterSheet.ts) is the same call the gear TOTALS go through — the exact port of
// the wiki's own ItemLevelSlider calculator, at the state the name states. Nothing about upgrade
// arithmetic is written here, and because both halves call it, an item's stat lines and the totals
// they were folded into can never disagree on the card. A stat this repo has never classified is
// left alone by the scaler, exactly as it is in the totals.
//
// ---------------------------------------------------------------------------
// FOUR NUMBERS GET FIELDS; EVERYTHING ELSE IS A STATED LINE
// ---------------------------------------------------------------------------
// AC, HP, Mana and Endurance are what a reader adds up in their head, so they travel as integers a
// page can lay out. Every other row travels as `{key, label, value}` with the VALUE VERBATIM —
// `+15`, `10%`, `1 per tick` — because a percentage that became a number would be the exact lie
// `sumGear` refuses to tell (law 6: say what the sources cannot say). An HP/Mana/Endurance row
// whose value is NOT a plain integer therefore stays a stated line rather than being rounded into
// its field: unreadable is not zero.
//
// WHAT IS NOT HERE: nothing is invented for an item the committed DB never had. `known:false` is
// carried so the reader is told "not in the item database" instead of shown an empty window, which
// is the same thing the Character tab's own totals say out loud (law 1).

import { statInteger, wornBlock, type SheetItemView } from './characterSheet'
import { statLabel, type ItemEffectKind, type ItemStat, type ItemStatBlock } from './itemStats'
import { clampStr, SHARE_LIMITS } from './shareSchema'

/** One stat row of an item window: the block's own key, its label, and its value verbatim. */
export interface ShareStatLine {
  /** the block's key (`STR`, `SV FIRE`, `HASTE`) - what the item page called it */
  key: string
  /** `statLabel(key)`, so a page needs no table of its own */
  label: string
  /** the value as the item states it (`+15`, `10%`) - never parsed into a number */
  value: string
}

/** One effect line: which socket it belongs to, its spell name, and the parenthetical. */
export interface ShareEffect {
  kind: ItemEffectKind
  name: string
  detail?: string
}

/** The three weapon numbers, when the item is one. */
export interface ShareWeapon {
  dmg?: number
  delay?: number
  skill?: string
}

/**
 * Everything the wire says about ONE worn item beyond its name - the v2 addition.
 *
 * `known` is REQUIRED: it is the difference between "this item has no stats" and "this app has
 * never heard of this item", and a card that cannot tell them apart has to guess at one of them.
 */
export interface ShareItemFacts {
  /** the ` +N`-stripped name, present only when the name carried a rank - see `itemFacts` */
  base?: string
  /** false when the committed item DB had no record: the reader is told, never shown nothing */
  known: boolean
  ac?: number
  hp?: number
  mana?: number
  endurance?: number
  stats?: ShareStatLine[]
  effects?: ShareEffect[]
  flags?: string[]
  weapon?: ShareWeapon
}

/** Flags carried per item (`MAGIC ITEM`, `LORE ITEM`, `NO DROP`). Six is the whole of the DB. */
const MAX_CELL_FLAGS = 8

/** Longest flag this wire carries, in characters. `Lore Equipped` is thirteen. */
const MAX_FLAG_CHARS = 24

/** Longest stat label / stat value. `Recommended Level` is seventeen; `+15` is three. */
const MAX_STAT_CHARS = 40

/** The three stat keys that get a field of their own. AC is not here: the block stores it. */
const FIELD_OF_KEY: Record<string, 'hp' | 'mana' | 'endurance'> = {
  HP: 'hp',
  MANA: 'mana',
  END: 'endurance',
  ENDURANCE: 'endurance'
}

/** Untrusted -> a finite integer in `[min, max]`, or undefined. Shared with `characterShare.ts`. */
export function clampInt(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.max(min, Math.min(max, Math.round(v)))
}

// ---------------------------------------------------------------------------------------- build

/** Fold one `{key, value}` row into either a named field or a stated line. See the header. */
function foldRow(row: ItemStat, facts: ShareItemFacts, lines: ShareStatLine[]): void {
  const field = FIELD_OF_KEY[row.key.toUpperCase()]
  const n = field === undefined ? null : statInteger(row.value)
  if (field === 'hp' && n !== null) facts.hp = (facts.hp ?? 0) + n
  else if (field === 'mana' && n !== null) facts.mana = (facts.mana ?? 0) + n
  else if (field === 'endurance' && n !== null) facts.endurance = (facts.endurance ?? 0) + n
  else if (lines.length < SHARE_LIMITS.maxCellStats) {
    lines.push({ key: row.key, label: statLabel(row.key), value: row.value })
  }
}

/** The effect lines, capped. An effect with no name is nothing a card could draw. */
function shareEffects(block: ItemStatBlock): ShareEffect[] {
  const out: ShareEffect[] = []
  for (const effect of block.effects) {
    if (out.length >= SHARE_LIMITS.maxCellEffects) break
    if (!effect.name) continue
    const one: ShareEffect = { kind: effect.kind, name: effect.name }
    if (effect.detail !== undefined) one.detail = effect.detail
    out.push(one)
  }
  return out
}

/** The weapon numbers, or undefined when this item is not one. */
function shareWeapon(block: ItemStatBlock): ShareWeapon | undefined {
  if (block.dmg === undefined && block.atkDelay === undefined && block.skill === undefined) {
    return undefined
  }
  const weapon: ShareWeapon = {}
  if (block.dmg !== undefined) weapon.dmg = block.dmg
  if (block.atkDelay !== undefined) weapon.delay = block.atkDelay
  if (block.skill !== undefined) weapon.skill = block.skill
  return weapon
}

/** The stat block's contribution, written onto `facts` in place. */
function applyBlock(facts: ShareItemFacts, block: ItemStatBlock): void {
  const lines: ShareStatLine[] = []
  for (const row of block.stats) foldRow(row, facts, lines)
  for (const row of block.saves) foldRow(row, facts, lines)
  if (block.ac !== undefined) facts.ac = block.ac
  if (lines.length) facts.stats = lines
  const effects = shareEffects(block)
  if (effects.length) facts.effects = effects
  const flags = block.flags.slice(0, MAX_CELL_FLAGS)
  if (flags.length) facts.flags = flags
  const weapon = shareWeapon(block)
  if (weapon) facts.weapon = weapon
}

/**
 * One worn item -> what the wire says about it, READ AT ITS OWN ` +N` (see the header).
 *
 * `base` rides only when the name actually carries a rank, because `base ?? item` is what a
 * renderer prints and a second copy of an unranked name would be bytes saying nothing.
 */
export function itemFacts(item: SheetItemView): ShareItemFacts {
  const facts: ShareItemFacts = { known: item.known }
  if (item.baseName !== item.name) facts.base = item.baseName
  const block = wornBlock({ tier: item.tier, block: item.block })
  if (block) applyBlock(facts, block)
  return facts
}

// ------------------------------------------------------------------------------------- sanitize

/** Untrusted -> the stat lines, capped and bounded. A row missing either half is not a row. */
function sanitizeStatLines(v: unknown): ShareStatLine[] {
  if (!Array.isArray(v)) return []
  const out: ShareStatLine[] = []
  for (const one of v.slice(0, SHARE_LIMITS.maxCellStats)) {
    if (!one || typeof one !== 'object') continue
    const r = one as Record<string, unknown>
    const key = clampStr(r.key, MAX_STAT_CHARS).trim()
    const value = clampStr(r.value, MAX_STAT_CHARS).trim()
    if (!key || !value) continue
    out.push({ key, label: clampStr(r.label, MAX_STAT_CHARS).trim() || key, value })
  }
  return out
}

/** The six socket words this build can draw. A kind it cannot place is not a kind. */
const EFFECT_KINDS: readonly ItemEffectKind[] = ['combat', 'focus', 'click', 'worn', 'proc', 'effect']

function sanitizeEffects(v: unknown): ShareEffect[] {
  if (!Array.isArray(v)) return []
  const out: ShareEffect[] = []
  for (const one of v.slice(0, SHARE_LIMITS.maxCellEffects)) {
    if (!one || typeof one !== 'object') continue
    const r = one as Record<string, unknown>
    const kind = EFFECT_KINDS.find((k) => k === r.kind)
    const name = clampStr(r.name, SHARE_LIMITS.maxNameChars).trim()
    if (kind === undefined || !name) continue
    const effect: ShareEffect = { kind, name }
    const detail = clampStr(r.detail, SHARE_LIMITS.maxNameChars).trim()
    if (detail) effect.detail = detail
    out.push(effect)
  }
  return out
}

function sanitizeFlags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const one of v.slice(0, MAX_CELL_FLAGS)) {
    const flag = clampStr(one, MAX_FLAG_CHARS).trim()
    if (flag) out.push(flag)
  }
  return out
}

function sanitizeWeapon(v: unknown): ShareWeapon | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  const weapon: ShareWeapon = {}
  const dmg = clampInt(r.dmg, 0, 100_000)
  if (dmg !== undefined) weapon.dmg = dmg
  const delay = clampInt(r.delay, 0, 100_000)
  if (delay !== undefined) weapon.delay = delay
  const skill = clampStr(r.skill, MAX_STAT_CHARS).trim()
  if (skill) weapon.skill = skill
  return weapon.dmg === undefined && weapon.delay === undefined && weapon.skill === undefined
    ? undefined
    : weapon
}

/** The four integers, written onto `facts` in place. Absent stays absent; 0 is a stated 0. */
function applyNumbers(facts: ShareItemFacts, r: Record<string, unknown>): void {
  const ac = clampInt(r.ac, -100_000, 100_000)
  if (ac !== undefined) facts.ac = ac
  const hp = clampInt(r.hp, -1_000_000, 1_000_000)
  if (hp !== undefined) facts.hp = hp
  const mana = clampInt(r.mana, -1_000_000, 1_000_000)
  if (mana !== undefined) facts.mana = mana
  const endurance = clampInt(r.endurance, -1_000_000, 1_000_000)
  if (endurance !== undefined) facts.endurance = endurance
}

/**
 * An untrusted cell object -> the item facts this app may draw. Never throws; a malformed entry is
 * DROPPED rather than repaired, and an absent field stays absent.
 *
 * `known` DEFAULTS TO TRUE, and that is the v1 migration stated in one line: a body written before
 * this generation carried no per-item stats at all, so it never claimed an item was missing from
 * the database and nothing here may claim it for it. Only an explicit `false` says so. (A v2 body
 * always writes the boolean, so this default is reached by old bodies alone.)
 */
export function sanitizeItemFacts(r: Record<string, unknown>): ShareItemFacts {
  const facts: ShareItemFacts = { known: r.known !== false }
  const base = clampStr(r.base, SHARE_LIMITS.maxNameChars).trim()
  if (base) facts.base = base
  applyNumbers(facts, r)
  const stats = sanitizeStatLines(r.stats)
  if (stats.length) facts.stats = stats
  const effects = sanitizeEffects(r.effects)
  if (effects.length) facts.effects = effects
  const flags = sanitizeFlags(r.flags)
  if (flags.length) facts.flags = flags
  const weapon = sanitizeWeapon(r.weapon)
  if (weapon) facts.weapon = weapon
  return facts
}
