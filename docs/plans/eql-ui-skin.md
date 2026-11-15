# EQ Zera in-game UI skin

Owner asks (2026-11-15), in order:

1. "Build a custom EQL UI theme for in the game, in the same style and color theme as the app."
2. After the first preview (a recolour of Daybreak's stone/gold art): "I want the assets to look
   like the EQ Zera app. So it'll be a completely custom UI." The recolour is out.
3. "If anything, I'd like it more based on the Default Modern skin but I still want custom assets
   to look like EQ Zera."
4. Ruling: it ships behind a use-at-your-own-risk notice (`src/shared/uiSkinDisclaimer.ts`), shown
   on the card and confirmed once, in page, before the first build.

## Shape

- **Base skin: `default_modern`, over `default`.** The skin inherits the modern skin's XML
  layouts, window structure and atlas geometry. The client falls back to `default` (never to
  `default_modern`), so every file `default_modern` carries that differs from `default` is copied
  into the skin. Files the two share byte for byte are left to the client's fallback. Without a
  `default_modern` folder the skin builds over `default` alone.
- **Our chrome, drawn.** Every chrome piece is DRAWN by `src/main/uiSkin/paint.ts`, in the app's
  language (`src/shared/palette.ts`, `src/renderer/src/theme/theme.ts`). It is drawn at exactly
  the rectangle the XML cuts, into an atlas of exactly the base texture's size and format, so the
  stock XML slices our art correctly. Window backgrounds are BLACK (see the in-game fixes below).
- **Nothing of Daybreak's is committed.** The repo carries the codecs, classifier, painter, rules
  and synthetic test fixtures. Art the skin does not draw (icons, coins, cursors, logos, gems,
  pictorial menu buttons) and the inherited XML are copied from the player's own files when the
  skin is generated, on their machine.
- **Output:** `<EQ root>/uifiles/EQZera/` (always via `effectiveEqRoot()`). Shipped skins are never
  written. The builder refuses any output folder inside a source skin, and any folder holding
  files without `eqzera-skin.json`.
- **Switch in game:** `/loadskin EQZera 1`. Building while the game runs is safe (a separate
  folder). The client sees changes on the next skin load.
- **Out of date:** `eqzera-skin.json` records size + mtime of every file in both source skins and
  `RULES_VERSION`. A game patch touching either reads `stale`.
- **Entry points:** the Preferences card (Preferences -> In-game UI) through `uiSkin:*` IPC, and
  `npm run gen:eql-skin [-- --root <EQ root>] [--out <dir>] [--preview]`. `--preview` renders the
  mockups described below.

## What the skins are made of (measured 2026-11-15)

- `default`: 1020 files. `default_modern`: 985 files, 257 XML. 302 of its files differ from
  default's (211 XML, plus its own chrome atlases, cursors, a few spell/gem sheets).
- Chrome atlases in `default_modern`:
  - `window_pieces01-07`, `09` (TGA)
  - `window_br_pieces`, `window_br_pieces01a`: window borders, title bars, the transparent
    variants
  - `window_fg_pieces`, `window_fg_pieces_black`: inner frames, tabs, scrollbars
  - `rounded_br_tooltip`: tooltip frame
  - `window_pieces11a.dds`, `11b.dds`, `12.dds`: check boxes, recessed boxes, sliders, wide gem
    holders
- TGA encodings: type 2 and type 10 RLE, 24/32-bit, both origins. DDS: uncompressed A8R8G8B8, one
  mip.
  - `tga.ts` and `dds.ts` read and write exactly these, and each file keeps its own encoding.
  - Compressed (DXT) DDS such as the drag-item art is refused and never drawn.
- Pieces are `<Ui2DAnimation>` frames (texture + Location + Size).
  - `WDT_Def` in the modern skin is `A_BorderFrame*` (2-3 px) + `A_WindowTitle*` (16 px) +
    `wnd_bg_light_rock.tga`.

## Drawn vs copied, per atlas

`pieceKinds.ts` decides from the piece NAME what it is. Anything it does not recognise, plus
`ART_PIECES` (`rules.ts`), keeps the base skin's pixels, and those rectangles are restored after
drawing even where a chrome rectangle overlaps them. Pixels outside every piece are the base's
untouched.

| Atlas | Drawn (ours) | Copied from the base |
| --- | --- | --- |
| `window_br_pieces.tga` | border frame, rounded frame, window title (all pieces) | nothing referenced |
| `window_br_pieces01a.tga` | transparent rounded frames and titles (translucent paper) | - |
| `window_fg_pieces.tga` | inner frames, tab frames, VSB/HSB arrow buttons and thumbs | gauge track, target / tooltip indicators |
| `window_fg_pieces_black.tga` | black inner frames | - |
| `rounded_br_tooltip.tga` | tooltip frame | - |
| `window_pieces01.tga` | close/min/max/tile/help buttons, sliders, plus/minus, dividers, list headers, highlight frames, recessed box | every gauge piece, coins, crystals, cursors, tab icons, white pixel |
| `window_pieces02.tga` | inventory slot backgrounds (our labels: EAR, NECK, ... MAIN, OFF), spell gem holder/background | the pictorial menu buttons (inventory, pet, buff, spells, options...), gem highlight |
| `window_pieces03.tga` | standard/small/big/square buttons, arrow buttons, title pieces | - |
| `window_pieces04.tga` | zoom/pan/toolbar buttons, charm slot | compass, mail/parcel icons, pictorial menu buttons |
| `window_pieces05.tga` | chat frames, chat title, chat min/max/close, filigree frames, power-source slot | EQ menu button (the game's logo) |
| `window_pieces06/07.tga` | hot-button slots 1-12, all states | buff/debuff icon backgrounds, player-state icons |
| `window_pieces09.tga` | radio buttons, rotate buttons | coin types, upconvert pieces, marketplace button |
| `window_pieces11a.dds` | check boxes (all states), recessed boxes, small gem holder, slider | loot/edit/roll/question glyph buttons, drag indicator |
| `window_pieces11b.dds` | large slider thumb and cap | difficulty icon sheet |
| `window_pieces12.dds` | wide spell gem holder/background | - |
| `stoneui_*` (default only) | stone frames, slots (used only when no modern skin) | gauges, coin plates |

Whole textures (repainted, alpha kept):
- every `wnd_bg_*`, `wnd_dark_rock`, `wnd_fg_dark_rock` and the scrollbar gutters become black.

Not touched: the login screen (`EQLSUI*`, `eqls_*`), character-select pieces, spell/gem/item art,
achievement art, the 4a.dds pictorial buttons.

## The look (from the app)

- **Panels:** `paper` #131a2b on `bg` #0b0f1a.
- **Window edges:** a 1px accent-violet line (#a78bfa at 55%) with a soft outer glow where the
  piece has room. Radius 4 (2 on thin pieces).
- **Buttons:** radius 2.
  - normal: paper face with a violet edge.
  - hover: lifted face, accentHi edge and glow.
  - pressed: violet-tinted face, cyan glyph.
  - disabled: ground face, faint edge.
- **Title bars:** a slight top-down lift with the accent hairline underneath.
- **Gauges:** not drawn. Every gauge keeps default_modern's own pieces and colours (owner, in game).
- **Check boxes / radios:** violet fill with an ink check or dot.
- **Slots:** ground with a soft violet edge and a dim accentHi label in a 5x7 pixel font
  (`font5x7.ts`).
- **Dividers:** the neon hairline (violet to cyan).

## Retrowave ornament steps (owner, 2026-11-15: "more ornamental", "retrowave design details")

The layout and every rule above are unchanged. One switch, `SkinStyle` in
`src/main/uiSkin/look.ts`, adds ornament drawn by `ornament.ts` over the clean pieces. It is the
`style` option of `buildSkin` and `--style` on the script, and is recorded in the manifest (a
different style reads as out of date). The default is **ornamental**.

- **clean:** the flat draft above.
- **subtle:** the title hairline runs the NEON rule. The gradient is split across the caps: the
  left cap is magenta to violet, the middle violet, the right cap violet to cyan. Also: top-lit
  button bevel, a diamond on dividers wide enough
  to hold one, grip lines on the scrollbar thumb.
- **ornamental:** adds:
  - double-line frames (inner cyan) with extra bloom;
  - diamond rivets on corners with room;
  - chevron title caps, a blooming 2px hairline and a lit top edge on title bars;
  - title scanlines;
  - cyan corner ticks on hot-button slots;
  - a violet inner glow on pressed buttons.
- **synthwave:** adds a magenta inner line, a neon band across the title bar, the striped retro
  sun on the title's left cap, stronger bloom and a magenta pressed glow.

**Limits.** The modern window border is 2-3px, so corner rivets only show where a frame has 5px or
more (rounded/tooltip frames, title caps).

## In-game fixes (owner's ornamental test, 2026-11-15)

1. **Content areas are black.** Window backgrounds came out as a light slate with the grid
   showing, and player-chosen chat colours (purple tells) lost contrast. Every window background
   texture is now black (alpha kept), with no grid or noise. The EQ Zera look lives only in the
   frames, title bars, tabs and buttons. Pinned: a background is black with its alpha intact, and
   stock chat colours clear 4.5:1 on it.
2. **Gauges are default_modern's, all of them** (owner, after trying deep segmented fills and an
   exp/AA-only exemption: "revert the health, mana, and endurance bars too"). No gauge piece is
   drawn in any atlas: the classifier returns nothing for any name containing `Gauge`. No colour
   inside a `<Gauge>` element is rewritten: `xmlColors.ts` skips every gauge element whole. The
   short-lived `EQZBase_` copies and Animations insertion were removed, since the untouched base
   pieces already give the base look. A rebuild also deletes any file an earlier build's manifest
   lists that no rule writes any more. Pinned: gauge pieces stay byte-identical, the gauge element
   in XML stays byte-identical.
3. **Borderless windows stay borderless.** A piece whose base pixels are (almost) empty, mean
   alpha under 6% (`EMPTY_ALPHA`), is a transparent template's chrome. It keeps the base pixels
   instead of getting a frame or fill. This stops the stray frames on empty boxes, around the
   character and through the buff row. Pinned in `tests/uiSkin.test.mts`.
4. **No grid anywhere; dividers never eat buttons.** The background grid was already gone. What the
   owner saw as a grid in the Group window was a line through each disabled button.
   default_modern cuts `A_DividerVertical` from the same rectangle as `A_BtnDisabled`, and the
   divider was drawn last. Dividers now draw first, so the button wins. Pinned in
   `tests/uiSkin.test.mts`.
5. **The two empty black boxes** (mid-left, and right of the compass) are the pet and target
   windows with nothing to show (owner). They are left as they are.

## XML colour map

Only the three numbers of a colour block change, and never inside a `<Gauge>` element; every other byte is copied from the source
(`xmlColors.ts`). `EQUI_ColorPickerWnd.xml` is excluded, and the login screen is out of scope.

| Role | Elements | Rule |
| --- | --- | --- |
| text | `TextColor`, `Tab*Color`, `Mouseover/Pressed/DisabledColor` | light grey (luma >= 200) -> `text` #e5e9f5 exactly; mid grey -> text hue at its brightness; gold/yellow headings -> `accentHi`; blue links -> `cyan`; red/green keep meaning; dark text stays |
| tint | `MiddleTint`, `BackgroundTextureTint`, `Tint1/2` | neutrals stay; saturated tints snap by hue at the original brightness |

**Fonts:** EQ's XML picks fonts by number (`<Font>N</Font>`) from the client's own fixed set, which
is sizes of one face. A skin cannot name a typeface, so fonts are left as the base has them.

## Preview

`npm run gen:eql-skin -- --preview` writes `%TEMP%\eqzera-skin-mockup-1x.png` and `-2x.png`:
- an inventory, a player window with HP/mana/endurance gauges, a target window, a hotbar and a
  chat window with a scrollbar, check boxes and radios;
- composed from the XML's named pieces (approximate layout);
- `default_modern` on the left, EQ Zera on the right.

## Not verifiable outside the game

- Whether the client accepts every drawn texture. Sizes and formats are identical by
  construction.
- How the art reads at in-game scale and UI scaling.
- Whether any window draws chrome from a piece the classifier does not know, which would keep the
  modern skin's look there.
- Whether the client stretches or tiles each piece the way the mockup assumes.
