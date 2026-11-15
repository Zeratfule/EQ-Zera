/**
 * WHICH default-skin files the EQ Zera skin overrides, and which pieces inside them it must never
 * touch. docs/plans/eql-ui-skin.md is the long-form map (file -> what it is -> what it becomes).
 *
 * Nothing from Daybreak's skin is committed: these are names and rules, and the generator reads
 * the player's own `uifiles/default` to produce the skin on their machine.
 */

import { UI_SKIN_COMMAND, UI_SKIN_NAME } from '../../shared/uiSkin'

/** The skin's folder name under `uifiles`, and the word a player types after /loadskin. */
export const SKIN_NAME = UI_SKIN_NAME

/** The build record written beside the skin; its presence is what marks a folder as ours. */
export const MANIFEST_FILE = 'eqzera-skin.json'

/** Bump when a rule below changes, so an installed skin reports itself out of date. */
export const RULES_VERSION = 1

/** The command a player types in game. */
export const LOADSKIN_COMMAND = UI_SKIN_COMMAND

/** Plain backgrounds and gutters: recoloured edge to edge. */
export const WHOLE_TEXTURES: readonly string[] = [
  'wnd_bg_dark_rock.tga',
  'wnd_bg_light_rock.tga',
  'wnd_bg_mid_rock.tga',
  'wnd_bg_fade.tga',
  'scrollbar_gutter.tga',
  'scrollbar_Hgutter.tga'
]

/**
 * Atlases that mix chrome with icons. Only the rectangles a `<Ui2DAnimation>` cuts from them are
 * recoloured, and never a rectangle whose name matches `ART_PIECES`.
 */
export const REGION_TEXTURES: readonly string[] = [
  'window_pieces01.tga',
  'window_pieces02.tga',
  'window_pieces03.tga',
  'window_pieces04.tga',
  'window_pieces05.tga',
  'window_pieces06.tga',
  'window_pieces07.tga',
  'window_pieces09.tga',
  'window_pieces11a.tga',
  'stoneui_br_pieces_01.tga',
  'stoneui_pieces01.tga',
  'stoneui_pieces03.tga'
]

/**
 * Pieces that are art, icons or meaning rather than chrome: coins, cursors, class/race/tab icons,
 * buff-icon backgrounds (their colour says buff or debuff), the compass, logos (the EQ menu
 * button is the game's logo), and the white gauge fills the XML tints (recolouring those would
 * muddy every gauge colour).
 */
export const ART_PIECES =
  /EQBtn|Coin|Crystal|Cursor|Icon|Logo|Race|Class|Compass|PWCS|Difficulty|Upconvert|Invigorate|Parcels|CharacterSelect|DisabledMinion|Inv_StoneUI(Plat|Gold|Silver|Copper)|GaugeFill|GaugeLinesFill|WhitePixel|WhiteBtnBase|SpellGemHighlight|TT_Indicator|Loot_|LootCheck|IWAllowLoadoutSwap|IWNoLoadoutSwap/i

/** The XML the skin may carry a colour-rewritten copy of: the in-game windows, minus the colour
 *  picker (its colours ARE the content). The login screen (EQLSUI) is out of scope. */
export function isXmlSource(name: string): boolean {
  return /^EQUI.*\.xml$/i.test(name) && !/ColorPicker/i.test(name)
}

/** Every file name the builder may write, lower-cased. Anything else is refused. */
export function isAllowedOutput(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower === MANIFEST_FILE) return true
  if (isXmlSource(name)) return true
  return [...WHOLE_TEXTURES, ...REGION_TEXTURES].some((t) => t.toLowerCase() === lower)
}
