// THE CHARACTER MODEL'S READING OF A SHEET (EQ Zera, 2026-09-06) - pure, so the paper doll the
// Character tab draws is a rendering of facts decided here and tested without a DOM.
//
// WHAT THE GAME SHOWS and what this app can know are different things. The app has no armour art;
// it has the item's NAME, its icon, and - since the ornamentation socket is read - the name and
// icon of the item whose look it wears. So the model is a stylised body whose regions take the
// COLOUR of the armour's material (read off the name: "Breastplate" is plate, "Coif" is chain,
// "Tunic" is leather, "Robe" is cloth) with the item's icon pinned to the region. That is honest
// about its limits and still says at a glance "plate tank" or "cloth caster", which is what a
// glance at a character is for.
//
// TWO TOGGLES, both the game's own: "show helmet" (the client's helm-visibility option) and
// "show ornamentations" (whether a slot draws its ornament's look or its own).

import { SHEET_SLOTS, type SheetCellView, type SheetItemView } from './characterSheet'
import type { EquipSlot } from './planner/types'
import type { EqModelHand, EqModelHands, EqModelWear, Tint, WearPart, WearVariant } from './eqModel'

export type ArmorMaterial = 'plate' | 'chain' | 'leather' | 'cloth' | 'unknown'

/** Name words that decide a material, longest match first within each family. */
const MATERIAL_WORDS: readonly [ArmorMaterial, readonly string[]][] = [
  ['plate', ['breastplate', 'plate', 'greaves', 'vambraces', 'gauntlets', 'pauldrons', 'helm', 'sabatons', 'cuirass', 'bracers of', 'girdle']],
  ['chain', ['chainmail', 'chain', 'coif', 'mail', 'links', 'scale', 'hauberk', 'ringmail', 'banded']],
  ['leather', ['leather', 'hide', 'tunic', 'sleeves', 'moccasins', 'wristbands', 'cap', 'skin', 'fur', 'pelt', 'boots']],
  ['cloth', ['robe', 'silk', 'cloth', 'gloves', 'sandals', 'cowl', 'hat', 'veil', 'mantle', 'shawl', 'pantaloons', 'slippers', 'sash', 'cord']]
]

/** The material a piece is made of, from its name. Unknown is a colour too - grey, not a guess. */
export function armorMaterial(name: string): ArmorMaterial {
  const n = name.toLowerCase()
  for (const [material, words] of MATERIAL_WORDS) {
    if (words.some((w) => n.includes(w))) return material
  }
  return 'unknown'
}

export const MATERIAL_COLOR: Record<ArmorMaterial, string> = {
  plate: '#b9c4d8',
  chain: '#8892a8',
  leather: '#a5744c',
  cloth: '#8b7fc4',
  unknown: '#4d566b'
}

export const MATERIAL_LABEL: Record<ArmorMaterial, string> = {
  plate: 'plate',
  chain: 'chain',
  leather: 'leather',
  cloth: 'cloth',
  unknown: 'unknown make'
}

export interface ModelOptions {
  /** the client's helm-visibility option: off hides the head piece */
  showHelm: boolean
  /** draw each slot as the item whose look it wears, when it wears one */
  showOrnaments: boolean
}

/** What one slot LOOKS like, once the toggles have spoken. */
export interface SlotLook {
  id: string
  /** the name the model shows - the ornament's when it is worn as one */
  name: string
  iconId?: number
  material: ArmorMaterial
  /** true when the ornament's look replaced the item's own */
  ornamented: boolean
  /** true when the toggle hid it (a helm with helms off) */
  hidden: boolean
  /** the game's own model (`IT68`) of what is shown - the ornament's when ornamented */
  model?: string
  /** the item's weapon skill - the model's fallback; never the ornament's */
  skill?: string
  /** the client's material code of what is shown, when the item table knows it */
  materialCode?: number
  /** the client's dye of what is shown, when the item table knows it */
  color?: number
}

/** The game look of what a slot shows: the ornament donor's when the ornament is worn, the item's own otherwise. */
function gameLook(item: SheetItemView, ornamented: boolean): Pick<SlotLook, 'model' | 'skill' | 'materialCode' | 'color'> {
  const out: Pick<SlotLook, 'model' | 'skill' | 'materialCode' | 'color'> = {}
  const model = ornamented ? item.ornamentModel : item.model
  const materialCode = ornamented ? item.ornamentMaterial : item.material
  const color = ornamented ? item.ornamentColor : item.color
  if (model !== undefined) out.model = model
  if (!ornamented && item.skill !== undefined) out.skill = item.skill
  if (materialCode !== undefined) out.materialCode = materialCode
  if (color !== undefined) out.color = color
  return out
}

/** The slots the model can draw, and the body region each is pinned to. */
export const MODEL_SLOT_IDS = [
  'head', 'face', 'ear1', 'ear2', 'neck', 'shoulders', 'back', 'chest', 'arms', 'wrist1', 'wrist2',
  'hands', 'waist', 'legs', 'feet', 'primary', 'secondary', 'range', 'finger1', 'finger2'
] as const
export type ModelSlotId = (typeof MODEL_SLOT_IDS)[number]

export function slotLook(cell: SheetCellView, opts: ModelOptions): SlotLook | null {
  const item = cell.item
  if (!item) return null
  const ornamented = opts.showOrnaments && item.ornament !== undefined
  const name = ornamented && item.ornament !== undefined ? item.ornament : item.baseName
  const look: SlotLook = {
    id: cell.id,
    name,
    material: armorMaterial(name),
    ornamented,
    hidden: cell.id === 'head' && !opts.showHelm,
    ...gameLook(item, ornamented)
  }
  const iconId = ornamented ? item.ornamentIconId : item.iconId
  if (iconId !== undefined) look.iconId = iconId
  return look
}

/** A material as the game's texture-variant digit: bare for cloth (no robe textures here) and unknown. */
const VARIANT_OF: Record<ArmorMaterial, WearVariant> = { plate: 3, chain: 2, leather: 1, cloth: 0, unknown: 0 }

/** Sheet slot → the body part whose texture it changes. Wrists share the forearm. */
const PART_OF_SLOT: Partial<Record<ModelSlotId, 'ch' | 'ua' | 'fa' | 'hn' | 'lg' | 'ft'>> = {
  chest: 'ch',
  arms: 'ua',
  wrist1: 'fa',
  wrist2: 'fa',
  hands: 'hn',
  legs: 'lg',
  feet: 'ft'
}

/** The client's material codes the race archive has textures for: cloth, leather, chain, plate. */
function isArchiveVariant(code: number | undefined): code is WearVariant {
  return code === 0 || code === 1 || code === 2 || code === 3
}

/** The client's ARGB dye as a 0..1 tint, or undefined for "no dye" (0, or pure black which the client treats as none). */
export function tintOfColor(color: number | undefined): Tint | undefined {
  if (color === undefined || color === 0) return undefined
  const r = (color >>> 16) & 255
  const g = (color >>> 8) & 255
  const b = color & 255
  if (r + g + b < 6) return undefined
  return [r / 255, g / 255, b / 255]
}

/** The wear part a sheet slot dresses: an armour part, the helm for the head, nothing for jewellery and weapons. */
function wearPartOf(slot: ModelSlotId): WearPart | 'helm' | undefined {
  return PART_OF_SLOT[slot] ?? (slot === 'head' ? 'helm' : undefined)
}

/**
 * A slot's texture variant: the item table's material code when it is one the archive has textures
 * for, the name's material otherwise (the later armour sets, codes 4 and up, have no classic texture).
 */
function variantOf(look: SlotLook): WearVariant {
  return isArchiveVariant(look.materialCode) ? look.materialCode : VARIANT_OF[look.material]
}

/**
 * What the real model wears, from the sheet: each armour slot as the game's texture variant (see
 * `variantOf`), the heavier wrist winning the forearm, the head as a helm kind unless the helmet
 * is hidden, and the item table's dye as a tint per part.
 */
export function wearFromLooks(looks: ReadonlyMap<ModelSlotId, SlotLook>): EqModelWear {
  const wear: EqModelWear = {}
  for (const [slot, look] of looks) {
    const part = wearPartOf(slot)
    if (look.hidden || !part) continue
    const v = variantOf(look)
    if (part === 'helm') wear.helm = v
    else if (v > (wear[part] ?? 0)) wear[part] = v
    const tint = tintOfColor(look.color)
    if (tint) (wear.tint ??= {})[part] = tint
  }
  return wear
}

/** What each hand holds: the shown item's model (the ornament's when worn), the weapon skill as the fallback. */
export function handsFromLooks(looks: ReadonlyMap<ModelSlotId, SlotLook>): EqModelHands {
  const hands: EqModelHands = {}
  for (const id of ['primary', 'secondary'] as const) {
    const look = looks.get(id)
    if (!look) continue
    const hand: EqModelHand = {}
    if (look.model) hand.model = look.model
    if (look.skill) hand.skill = look.skill
    if (hand.model === undefined && hand.skill === undefined) continue
    hands[id] = hand
  }
  return hands
}

/** Every drawable slot's look, keyed by slot id; a slot with nothing in it is absent. */
export function modelLooks(cells: readonly SheetCellView[], opts: ModelOptions): Map<ModelSlotId, SlotLook> {
  const out = new Map<ModelSlotId, SlotLook>()
  const ids = new Set<string>(MODEL_SLOT_IDS)
  for (const cell of cells) {
    if (!ids.has(cell.id)) continue
    const look = slotLook(cell, opts)
    if (look) out.set(cell.id as ModelSlotId, look)
  }
  return out
}

// ---- previewing an item (EQ Zera, "preview on my character") ----------------------------------
//
// A PREVIEW IS ONE CELL OVERRIDDEN, NOTHING WRITTEN. The item page knows a NAME and, from the gear
// index, the item's equip slots; main's `eqassets:itemLook` answers the name's model / material /
// dye out of the item table. This turns those facts into the one `SheetCellView` the model reads
// for that slot, in place of what the dump says is worn there, so every resolver below it
// (`slotLook`, `wearFromLooks`, `handsFromLooks`) is untouched and the real sheet is never edited.
//
// WHAT A PREVIEW CAN SHOW is bounded by the game's own files, and the UI says so rather than
// pretending: armour is a material texture per body part plus a dye, a helm is a mesh, a held item
// is its model. Rings, ears, neck, back, shoulders, face, waist and range change nothing on the
// 3D model (`INVISIBLE_MODEL_SLOTS`) - they only move the icon pin on the doll.

/** What a previewed item brings to its slot: its name and, where the tables know them, its look. */
export interface PreviewLook {
  /** the item's display name, as the page spelled it */
  item: string
  /** the model slot it is tried in */
  slot: ModelSlotId
  /** the game's own model actor (`IT68`) from the item table, when it has one */
  model?: string
  /** the client's material code from the item table */
  materialCode?: number
  /** the client's dye (ARGB) from the item table */
  color?: number
  /** the item page's weapon skill - the model's fallback for a held item */
  skill?: string
  iconId?: number
  /** how many distinct looks the item table holds under this name (absent or 1 = one) */
  looks?: number
}

/** The model slots a preview cannot change a pixel of: the game draws nothing for them. */
export const INVISIBLE_MODEL_SLOTS: readonly ModelSlotId[] = [
  'face', 'ear1', 'ear2', 'neck', 'shoulders', 'back', 'waist', 'range', 'finger1', 'finger2'
]

/**
 * The model slot a wearable is tried in, from its equip slots (gear index vocabulary). A paired
 * slot takes its FIRST cell; an item that fits a hand goes to the primary unless it is secondary-
 * only (a shield). AMMO has no cell on the model at all, so an ammo-only item yields undefined.
 */
export function modelSlotForEquip(slots: readonly EquipSlot[]): ModelSlotId | undefined {
  const order: readonly [EquipSlot, ModelSlotId][] = [
    ['PRIMARY', 'primary'], ['SECONDARY', 'secondary'], ['HEAD', 'head'], ['CHEST', 'chest'],
    ['ARMS', 'arms'], ['WRIST', 'wrist1'], ['HANDS', 'hands'], ['LEGS', 'legs'], ['FEET', 'feet'],
    ['FACE', 'face'], ['EAR', 'ear1'], ['NECK', 'neck'], ['SHOULDERS', 'shoulders'],
    ['BACK', 'back'], ['WAIST', 'waist'], ['RANGE', 'range'], ['FINGER', 'finger1']
  ]
  const has = new Set<EquipSlot>(slots)
  for (const [equip, model] of order) if (has.has(equip)) return model
  return undefined
}

/** The previewed item as the sheet's own item view: the tables' facts where they exist, no guesses. */
function previewItem(preview: PreviewLook): SheetItemView {
  const item: SheetItemView = { name: preview.item, baseName: preview.item, itemId: 0, exaltations: [], known: true }
  if (preview.iconId !== undefined) item.iconId = preview.iconId
  if (preview.skill !== undefined) item.skill = preview.skill
  if (preview.model !== undefined && preview.model !== '') item.model = preview.model
  if (preview.materialCode !== undefined) item.material = preview.materialCode
  if (preview.color !== undefined) item.color = preview.color
  return item
}

/** The cell a preview occupies, in the sheet's own shape: the dump's cell for that slot, re-filled. */
function previewCell(base: SheetCellView | undefined, preview: PreviewLook): SheetCellView {
  if (base) return { ...base, item: previewItem(preview) }
  const def = SHEET_SLOTS.find((s) => s.id === preview.slot)
  return {
    id: preview.slot,
    label: def?.label ?? preview.slot,
    column: def?.column ?? 'left',
    location: def?.token ?? preview.slot,
    item: previewItem(preview)
  }
}

/**
 * The sheet with ONE cell replaced by the previewed item. The real cells are never mutated; a
 * sheet with no cell for that slot (no dump at all) gains one, so a preview works before the
 * first `/outputfile inventory`. Null preview ⇒ the cells, untouched and by identity.
 */
export function applyPreview(cells: readonly SheetCellView[], preview: PreviewLook | null): readonly SheetCellView[] {
  if (!preview) return cells
  const base = cells.find((c) => c.id === preview.slot)
  const cell = previewCell(base, preview)
  if (!base) return [...cells, cell]
  return cells.map((c) => (c.id === preview.slot ? cell : c))
}
