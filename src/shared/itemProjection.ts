// itemProjection.ts — the rows an item window draws, optionally projected to a whole ` +N` tier.
//
// THE BLOCK HANDED IN MUST BE THE BASE (+0) BLOCK, or the upgrade is applied twice. Which
// ItemWindow callers hold which:
//   loot item page (ItemDetailContent)  BASE: `lookupItem` strips ` +N` and parses the wiki
//                                       `|statsblock`; posky's fallback is keyed by base name.
//                                       The only `projectable` caller.
//   KnownItemTooltip, feed hover cards  BASE, same lookup, but compact: never projected.
//   share card (ShareItemTooltip)       ALREADY SCALED: `characterShareItem` runs `wornBlock`
//                                       at the sharer's tier before the cell travels. Compact.
//
// Every number comes from `itemUpgrade.ts`; this module only lays the scaled block beside the base
// one. A row carries `base` exactly when projection changed its value, so at tier 0 every row is
// what the window drew before projection existed.

import { ITEM_MAX_TIER, damageRatio, itemTierFromName, type ItemStat, type ItemStatBlock } from './itemStats'
import { scaleStatBlock, upgradeStateForTier } from './itemUpgrade'

/** One drawn row. `key` is the stat key for attribute/save rows and the label for grid rows. */
export interface ItemWindowRow {
  key: string
  value: string
  /** the +0 value, present only when the projection changed it */
  base?: string
  /** a line the upgrade adds that the base item does not print (the synthesized SV VOID) */
  added?: boolean
}

export interface ItemWindowRows {
  /** left grid column: Size, Weight, Skill, Range */
  physical: ItemWindowRow[]
  /** right grid column: AC, Base Dmg, Dmg Bonus, Delay, Backstab */
  combat: ItemWindowRow[]
  /** damage / delay, closing the combat column */
  ratio?: ItemWindowRow
  attrs: ItemWindowRow[]
  /** cast/cooldown timing, drawn under the effects rather than in the attribute grid */
  timing: ItemStat[]
  saves: ItemWindowRow[]
}

/** Stat keys that describe an effect's timing rather than the item's own numbers. */
const TIMING_KEYS = new Set(['CAST TIME', 'COOLDOWN', 'RECAST', 'CHARGES'])

const EMPTY_ROWS: ItemWindowRows = { physical: [], combat: [], attrs: [], timing: [], saves: [] }

/** Whole tiers only, clamped to the game's 0..10. */
export function clampProjectionTier(tier: number): number {
  return Math.min(ITEM_MAX_TIER, Math.max(0, Math.trunc(tier) || 0))
}

/** The item's own tier: the name's ` +N` when it states one, else the observed merge tier, else 0. */
export function defaultProjectionTier(name: string, observedTier: number | undefined): number {
  return clampProjectionTier(itemTierFromName(name) ?? observedTier ?? 0)
}

function row(key: string, base: string, value: string): ItemWindowRow {
  return value === base ? { key, value } : { key, value, base }
}

function optional(out: ItemWindowRow[], key: string, base?: string | number, value?: string | number): void {
  if (base === undefined || base === '') return
  out.push(row(key, String(base), String(value ?? base)))
}

function physicalRows(base: ItemStatBlock, scaled: ItemStatBlock): ItemWindowRow[] {
  const out: ItemWindowRow[] = []
  optional(out, 'Size', base.size, scaled.size)
  optional(out, 'Weight', base.weight, scaled.weight)
  optional(out, 'Skill', base.skill, scaled.skill)
  optional(out, 'Range', base.range, scaled.range)
  return out
}

function combatRows(base: ItemStatBlock, scaled: ItemStatBlock): ItemWindowRow[] {
  const out: ItemWindowRow[] = []
  optional(out, 'AC', base.ac, scaled.ac)
  optional(out, 'Base Dmg', base.dmg, scaled.dmg)
  optional(out, 'Dmg Bonus', base.dmgBonus, scaled.dmgBonus)
  optional(out, 'Delay', base.atkDelay, scaled.atkDelay)
  optional(out, 'Backstab', base.backstab, scaled.backstab)
  return out
}

/** Scaled DMG over the BASE delay (delay never scales), as the item window prints it. */
function ratioRow(base: ItemStatBlock, scaled: ItemStatBlock): ItemWindowRow | undefined {
  const before = damageRatio(base.dmg, base.atkDelay)
  if (before === undefined) return undefined
  const after = damageRatio(scaled.dmg, scaled.atkDelay) ?? before
  return row('Ratio', before.toFixed(2), after.toFixed(2))
}

/** `scaleStatBlock` maps stats and saves one-to-one in order; anything past the base is added. */
function pairStats(base: ItemStat[], scaled: ItemStat[]): ItemWindowRow[] {
  return scaled.map((s, i) => {
    const b = base[i] as ItemStat | undefined
    return b === undefined ? { key: s.key, value: s.value, added: true } : row(s.key, b.value, s.value)
  })
}

/** The rows of `block` at whole tier `tier` (0 = the block as given). */
export function itemWindowRows(block: ItemStatBlock | undefined, tier = 0): ItemWindowRows {
  if (!block) return EMPTY_ROWS
  const t = clampProjectionTier(tier)
  const scaled = t === 0 ? block : scaleStatBlock(block, upgradeStateForTier(t))
  const stats = pairStats(block.stats, scaled.stats)
  return {
    physical: physicalRows(block, scaled),
    combat: combatRows(block, scaled),
    ratio: ratioRow(block, scaled),
    attrs: stats.filter((s) => !TIMING_KEYS.has(s.key)),
    timing: block.stats.filter((s) => TIMING_KEYS.has(s.key)),
    saves: pairStats(block.saves, scaled.saves)
  }
}

function rowsChanged(rows: ItemWindowRow[]): boolean {
  return rows.some((r) => r.base !== undefined || r.added === true)
}

/** Whether ANY drawn value moves with the upgrade; if none does, a projection control is noise. */
export function blockScalesWithUpgrade(block: ItemStatBlock | undefined): boolean {
  if (!block) return false
  const top = itemWindowRows(block, ITEM_MAX_TIER)
  return [top.physical, top.combat, top.attrs, top.saves].some(rowsChanged)
}

/**
 * The line under the control. Grey values are always the +0 base, so the caption names the tier
 * the bright values are drawn at whenever that is not the base.
 */
export function projectionCaption(projected: number, home: number): string | undefined {
  const grey = projected > 0 ? ' · grey is base +0' : ''
  if (projected !== home) return `Projected at +${String(projected)}${grey}`
  if (projected > 0) return `At this item's +${String(projected)}${grey}`
  return undefined
}
