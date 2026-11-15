# EQ Zera in-game UI skin

Owner ask (2026-11-15): "build a custom EQL UI theme for in the game, in the same style and color
theme as the app." Owner ruling the same day: it ships, behind a use-at-your-own-risk notice
(`src/shared/uiSkinDisclaimer.ts`) shown on the card and confirmed once, in page, before the first
build.

## Shape

- **Generated on the player's machine, never shipped.** The repo carries the generator
  (`src/main/uiSkin/`), these rules, and tests over SYNTHETIC fixtures
  (`tests/uiSkinSynthetic.mts`). No Daybreak texture or XML is committed or redistributed.
- **Source:** `<EQ root>/uifiles/default` (read-only, always via `effectiveEqRoot()`).
  **Output:** `<EQ root>/uifiles/EQZera/`, holding ONLY the files it overrides; the client falls
  back to `default` for everything else. Shipped skins are never written: the builder refuses any
  output folder that has files and no `eqzera-skin.json`, and any path inside the source.
- **Switch in game:** `/loadskin EQZera 1` (or the Options window's UI skin picker). Building while
  the game runs is safe (a separate folder); the client sees changes on the next skin load.
- **Out of date:** `eqzera-skin.json` records size + mtime of every default-skin file the build read
  and `RULES_VERSION`. A game patch that touches any of them (or adds a window XML) reads `stale`.
- **Entry points:** the Preferences card (Preferences -> In-game UI) through `uiSkin:*` IPC, and
  `npm run gen:eql-skin [-- --root <EQ root>] [--out <dir>] [--preview]`.

## What the default skin is made of (measured 2026-11-15, EQ Legends client)

- 1020 files, 305 `.tga`, 228 `.xml`, 456 `.dds` (drag-item art and guild banners), loose `.jpg`,
  `.cur`, `.ini`.
- TGA encodings in use: type 2 uncompressed 24-bit (52), type 2 32-bit (222, both origins), type 10
  RLE 32-bit (30). One file (`FemaleRaceDisabled.tga`) is not a TGA at all; the codec refuses it.
  `src/main/uiSkin/tga.ts` reads and writes exactly these, keeping each file's own encoding.
- Chrome lives in atlases cut by `<Ui2DAnimation>` frames (texture + Location + Size) in
  `EQUI_Animations.xml` and per-window XML. 1308 named animations.
- Colours live in XML as `<Tag><R/><G/><B/></Tag>` blocks: `TextColor` (723), `FillTint` (281),
  `TabTextActiveColor` (129), `MiddleTint` (84, scrollbar gutters), `BackgroundTextureTint` (79),
  `DisabledColor`/`PressedColor`/`MouseoverColor` (~40 each), `LinesFillTint` (29),
  `TabTextColor`, `Tint1/2`.

## Texture map (file -> what it is -> what it becomes)

Recolour rule for every chrome pixel (`recolor.ts`): luminance is kept exactly, alpha is never
written. Neutral stone/steel -> navy (`paper` hue) in the shadows drifting to soft violet in the
highlights; gold/bronze -> accent violet (bright gold lands on `accentHi`); blue -> cyan; any other
hue (red gems, green lights) is left as drawn. Low-chroma pixels blend between the two treatments
so anti-aliased trim does not seam.

Whole texture (every pixel):

| File | What it is | Becomes |
| --- | --- | --- |
| `wnd_bg_dark_rock.tga` | default window background (`WDT_Inner`, chat, most windows) | navy rock |
| `wnd_bg_light_rock.tga`, `wnd_bg_mid_rock.tga` | lighter window backgrounds | navy/violet rock |
| `wnd_bg_fade.tga` | fade strip | (all black today, so no output) |
| `scrollbar_gutter.tga`, `scrollbar_Hgutter.tga` | scrollbar tracks (tinted by `MiddleTint`) | navy |

Regions only (chrome rectangles minus art rectangles, from the animation frames):

| File | Chrome recoloured | Left untouched (art) |
| --- | --- | --- |
| `window_pieces01.tga` | window frames, title bars, close/min/max/help buttons, scrollbar arrows and thumbs, list headers, sliders, +/- buttons, rounded/filigree frames, dividers, recessed boxes, tabs | cursors, coins, crystals, tab icons, `A_WhitePixel` |
| `window_pieces02.tga` | inventory/pet/hotbox/buff/actions/spell/friends/help/options round buttons, inventory slot backgrounds (`A_Inv*`), spell gem holder/background | spell gem highlight |
| `window_pieces03.tga` | standard, small, big, square and arrow buttons (normal/hover/pressed/disabled), title pieces, vertical divider | nothing |
| `window_pieces04.tga` | song/guild/map/journal/LFG/mercenary buttons, map zoom/pan/toolbar buttons, charm slot | compass strip and overlay, mail/parcel icons |
| `window_pieces05.tga` | chat window title, borders, inner frames, chat buttons, filigree frames 1-3 | the EQ menu button (`A_EQBtn*`, the game's logo, defined in `EQUI_EQMainWnd*.xml`) |
| `window_pieces06.tga`, `window_pieces07.tga` | hot buttons 1-12 frames | buff/debuff icon backgrounds, player-state icons (`A_PWCS*`), upconvert pieces |
| `window_pieces09.tga` | radio buttons, rotate buttons, marketplace button | coin types, upconvert/invigorate pieces |
| `window_pieces11a.tga` | check boxes, small recessed boxes, small gem holder, grab/check/edit/stop/cancel/roll/question buttons | tooltip indicator |
| `stoneui_br_pieces_01.tga` | the newer stone frames: inner, transparent, tiny, inset, rounded, tab frames, title bars | nothing |
| `stoneui_pieces01.tga` | spellbook and target gauge backgrounds and end caps, spellbook page buttons, name plate | gauge fills (white, tinted by XML) |
| `stoneui_pieces03.tga` | gauge background/end caps/lines, slider, stone inventory slots, large recessed box | gauge fills, the four coin plates |

Deliberately not touched: spell icons (`Spells*.tga`, `gemicons*.tga`), class/race/achievement
art, item art (`dragitem*.dds`), maps, portraits, the login screen (`EQLSUI*`, `eqls_*`), the
character-select pieces (`window_pieces08/10/11`, `window_pieces11b`), `window_pieces11c.dds`
(DDS, loot buttons; the codec reads TGA only), `TargetBox.tga`, and `white.tga`.

## XML colour map

Only the three numbers of a colour block change; every other byte (structure, comments, CRLF) is
copied from the source (`xmlColors.ts`). Only window files whose colours actually change are
written (98 of the in-game `EQUI*.xml` today); `EQUI_ColorPickerWnd.xml` is excluded (its colours
are the content), and the login screen (`EQLSUI*`) is out of scope.

| Role | Elements | Rule |
| --- | --- | --- |
| gauge | `FillTint`, `LinesFillTint` | snapped by hue: red -> `red` (HP), blue -> `cyan` (mana), yellow/olive/orange -> `amber` (endurance, experience), green -> `green` (pet HP), purple -> `accent` (casting), magenta -> `magenta`; neutral stays |
| text | `TextColor`, `TabTextColor`, `TabTextActiveColor`, `MouseoverColor`, `PressedColor`, `DisabledColor` | light greys -> `text` at the original brightness; gold/yellow -> `accentHi`; blue -> `cyan`; red -> `red`; green -> `green`; dark text (on light buttons) stays; a dim colour stays dim |
| tint | `MiddleTint`, `BackgroundTextureTint`, `DisabledBackgroundTextureTint`, `Tint1/2` | neutrals stay (the texture already moved); saturated tints snap to the palette by hue at the original brightness |

## Not verifiable outside the game

Whether the client accepts every rewritten texture and XML (structure is unchanged by
construction), how the recoloured chrome reads at in-game scale, and whether any window draws
gold/blue chrome from a texture not in the tables above. The owner checks in game.
