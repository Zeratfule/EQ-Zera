# The app icon — "EQZ", a retro-wave cartridge badge

Status: SHIPPED. Author: executor session (Fable), 2026-09-08. Owner-requested
("Desktop app icon needs to change ASAP. It should read EQZ and be completely
unique in style and design… I don't want it to look even remotely close to the
EQ Companion app icon"). Lane: the app's own 2026-09-06 UI direction — clean,
modern, a touch of 80s/90s retro wave, a dash of classic gaming console.

Generator: `scripts/gen-icon.mts` (`npm run gen:icon`). Zero dependencies.

## What was replaced

A dark rounded panel with a violet serif-ish "EQ"/"EQC", inherited from the
upstream generator's idea of a companion-app mark. Nothing of it survives: not
the rounded square, not the serif letterforms, not the gold border.

## The mark

A **cartridge badge**, not a rounded square:

- **Silhouette** — a plate whose top-left and bottom-right corners are cut away
  at 45 degrees (deep, `cut`) and whose other two corners take a small nick.
  The strong TL→BR diagonal reads as a console cartridge on a tilt, and it is
  what makes the icon identifiable at 16px before a single letter resolves. The
  frame outside the plate is TRANSPARENT.
- **Rim** — a neon edge running the app's signature gradient vertically: cyan at
  the top, accent violet through the middle, magenta at the base.
- **Ground** — a horizon gradient inside the rim: `bg` darkened at the top,
  through `bg`×`accent`, to `bg`×`magenta` at the base.
- **Sun** — a disc behind the letters, `accentHi` → `accent` → `magenta` top to
  bottom, cut by four widening scanline bars and clipped where it meets the
  horizon. Two of the bars sit in the gap between the letters' baseline and the
  horizon, so they read as bars rather than a smudge.
- **Horizon** — a soft cyan glow band with a bright `accentHi` line on it.
- **Grid** — a perspective floor below the horizon: six rays to a vanishing
  point plus three receding rungs, cyan at 40%.
- **Letters** — bold, blocky, extended **EQZ** in `text` (near-white), built from
  rectangles and quads with explicit coordinates: the E is a spine and three
  bars (middle one short), the Q is a rectangular ring with a chamfered SE
  corner and a 45-degree tail that starts inside the counter and exits past it,
  the Z is two bars and a slanted parallelogram. A 2px `accent` outline
  separates them from the sun; a magenta copy 3px left and a cyan copy 3px right
  give the VHS chromatic fringe.

Every colour is a `PALETTE` token (`src/shared/palette.ts`) or a mix of two.
No game art, no imported fonts, no image assets.

## The sizes, and what each one shows

The geometry is written once in unit coordinates (0..1 of the frame). Every
frame is **drawn at its own resolution** at 4x supersample and box-downscaled —
none is a shrunk copy of the master, because detail that reads at 256px is mud
at 32px.

| frame | layout | shows |
| --- | --- | --- |
| 256, 128 | `big` | everything: grid, sun + scanlines, horizon, outline, chromatic fringe |
| 64 | `big` | drops the grid and the fringe |
| 48 | `small` | sun + horizon + outline, pixel-snapped lighter letters |
| 32 | `small` | plate + horizon + letters; no sun, no outline |
| 16 | `tiny` | plate + letters only; full-bleed plate, 1px strokes on a 7px cap |

Three layouts because a 16px frame is not a small 256px frame:

- `big` breathes — a 0.045 plate margin, a 0.275 cap, a 0.0715 stroke.
- `small` is **pixel-snapped** (every coordinate rounded to a whole device
  pixel before supersampling) with a lighter stroke: at the big layout's weight
  the Q's counter closes up below 64px.
- `tiny` is hand-set bitmap: every value a whole 16th, so at 16px the E is
  bar/gap/bar/gap/bar = 1/2/1/2/1 on a 7px cap and the Q keeps a 2×5 counter.
  Unsnapped, those three bars average into one grey block.

**Three letters do read at 16px** — verified by rendering and looking at an 8x
magnification, which is the only honest way to judge it, so the fallback of a
lone "Z" was not needed.

## Regenerating

```sh
export PATH="/c/Program Files/nodejs:$PATH"   # this machine
npm run gen:icon
```

Writes `build/icon.png` (256), `build/icon-tray.png` (32) and `build/icon.ico`
(PNG-in-ICO frames at 256/128/64/48/32/16). All three are committed; they are
the shipped brand mark.

To look at the small frames:

```sh
EQ_ICON_PREVIEW=/c/Users/<you>/AppData/Local/Temp/eq-icon npx tsx scripts/gen-icon.mts
```

which additionally writes `icon-preview-<size>.png` plus an 8x
nearest-neighbour magnification of each, and `icon-preview-tray-16*.png` — what
the tray icon looks like today (see below). Preview output is never written
into the repo.

## Consumers

- `electron-builder.yml` → `win.icon: build/icon.ico` — the exe (via rcedit),
  the NSIS installer and uninstaller, the Start-menu and desktop shortcuts.
- `src/main/tray.ts` → `import trayIconAsset from '../../build/icon.png?asset'`,
  then `nativeImage.createFromPath(...).resize({ width: 16, height: 16 })`.

Nothing else references an icon file: there is no `resources/icon*`, and the
renderer has no in-app logo mark (the nav rail draws its own set in
`src/renderer/src/components/railIcons.tsx`).

## Open item for the integrator: the tray

The tray asks Electron to crush the **256px** master down to 16px in one step.
At 16:1 the letters average into a single bright blob — see
`icon-preview-tray-16-x8.png` beside the natively-drawn `icon-preview-16-x8.png`
for the difference. `build/icon-tray.png` is the same mark drawn at 32px with
pixel-snapped 2px strokes, ready for a one-line change in `src/main/tray.ts`:

```ts
import trayIconAsset from '../../build/icon-tray.png?asset'
```

with the `.resize({ width: 16, height: 16 })` dropped, so Windows scales the
32px art per DPI instead. `tray.ts` was out of this task's scope, so the file
is generated but not yet wired up.
