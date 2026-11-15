/**
 * WHAT the EQ Zera skin is built from and which files it draws. docs/plans/eql-ui-skin.md is the
 * long-form map.
 *
 * THE BASE IS `default_modern` (owner, 2026-11-15): its XML layouts and atlas geometry are what the
 * skin inherits, with `default` behind it for any file it does not carry. The game client falls
 * back to `default` only, so every file `default_modern` carries that differs from `default` is
 * copied into the skin on the player's machine; nothing of Daybreak's is committed.
 *
 * THE CHROME IS OURS: every piece the classifier (pieceKinds.ts) recognises is DRAWN (paint.ts) at
 * the rectangle the XML cuts, and window backgrounds are flat paper. Icons, coins, cursors, logos
 * and gems keep the base skin's pixels.
 */

import { UI_SKIN_COMMAND, UI_SKIN_NAME } from '../../shared/uiSkin'

/** The skin's folder name under `uifiles`, and the word a player types after /loadskin. */
export const SKIN_NAME = UI_SKIN_NAME

/** The skin the EQ Zera skin inherits from, and the one the client itself falls back to. */
export const BASE_SKIN = 'default_modern'
export const FALLBACK_SKIN = 'default'

/** The build record written beside the skin; its presence is what marks a folder as ours. */
export const MANIFEST_FILE = 'eqzera-skin.json'

/** Bump when a rule below changes, so an installed skin reports itself out of date. */
export const RULES_VERSION = 4

/** The command a player types in game. */
export const LOADSKIN_COMMAND = UI_SKIN_COMMAND

/** Window backgrounds and gutters, painted black edge to edge (alpha kept): see atlas.ts. */
export const WHOLE_TEXTURES: readonly string[] = [
  'wnd_bg_dark_rock.tga',
  'wnd_bg_light_rock.tga',
  'wnd_bg_light_rock_inner.tga',
  'wnd_bg_mid_rock.tga',
  'wnd_bg_fade.tga',
  'wnd_dark_rock.tga',
  'wnd_fg_dark_rock.tga',
  'scrollbar_gutter.tga',
  'scrollbar_Hgutter.tga'
]

/**
 * Atlases whose chrome pieces are drawn. Pixels outside every drawn piece keep the base skin's
 * bytes. Both the modern skin's names and the classic default's are listed, so a machine without
 * `default_modern` still gets a skin.
 */
export const CHROME_ATLASES: readonly string[] = [
  'window_pieces01.tga',
  'window_pieces02.tga',
  'window_pieces03.tga',
  'window_pieces04.tga',
  'window_pieces05.tga',
  'window_pieces06.tga',
  'window_pieces07.tga',
  'window_pieces09.tga',
  'window_pieces11a.dds',
  'window_pieces11a.tga',
  'window_pieces11b.dds',
  'window_pieces12.dds',
  'window_br_pieces.tga',
  'window_br_pieces01a.tga',
  'window_fg_pieces.tga',
  'window_fg_pieces_black.tga',
  'rounded_br_tooltip.tga',
  'stoneui_br_pieces_01.tga',
  'stoneui_pieces01.tga',
  'stoneui_pieces03.tga'
]

/**
 * Pieces that are art, icons or meaning rather than chrome, restored from the base skin after
 * drawing even where a chrome rectangle overlaps them: coins, cursors, class/race/tab icons,
 * buff-icon backgrounds (their colour says buff or debuff), the compass, logos (the EQ menu button
 * is the game's logo) and the pictorial menu buttons.
 */
export const ART_PIECES =
  /EQBtn|Coin|Crystal|Cursor|Icon|Logo|Race|Class|Compass|PWCS|Difficulty|Upconvert|Invigorate|Parcels|CharacterSelect|DisabledMinion|Inv_StoneUI(Plat|Gold|Silver|Copper)|WhitePixel|WhiteBtnBase|SpellGemHighlight|TT_Indicator|Loot_|LootCheck|IWAllowLoadoutSwap|IWNoLoadoutSwap|Indicator|DragItem/i

/** The XML whose colours the skin retunes: the in-game windows, minus the colour picker (its
 *  colours ARE the content). The login screen (EQLSUI) is out of scope. */
export function isXmlSource(name: string): boolean {
  return /^EQUI.*\.xml$/i.test(name) && !/ColorPicker/i.test(name)
}

export function isChromeAtlas(name: string): boolean {
  const lower = name.toLowerCase()
  return CHROME_ATLASES.some((t) => t.toLowerCase() === lower)
}

export function isWholeTexture(name: string): boolean {
  const lower = name.toLowerCase()
  return WHOLE_TEXTURES.some((t) => t.toLowerCase() === lower)
}
