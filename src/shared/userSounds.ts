// userSounds.ts — the PURE half of "bring your own sound" (JOS-68): the reserved pack
// identity, the accepted formats, the size cap, and the filename → soundId derivation.
//
// WHY A SHARED MODULE. Three consumers need the same facts and none of them may import the
// others: main copies the file and mints the id, the preload/IPC layer names the channels,
// and the renderer labels the pack in every picker and warns before a delete. Everything
// here is Electron-free and node-tested (tests/userSounds.test.mts).
//
// THE RESERVED PACK. An imported sound is not a registry pack and must never be confused
// with one, so `my-sounds` is a RESERVED id with its own directory ROOT
// (`<userData>/my-sounds/`, beside `<userData>/soundpacks/` — never inside it). That
// separation is what makes a collision unrepresentable rather than merely unlikely:
//   - every registry install/uninstall joins onto `<userData>/soundpacks/` only, so no pack
//     of any name can write over or delete the user's own audio;
//   - `packDir()` resolves this id to the user-sounds root FIRST, ahead of the soundpack
//     roots, so even a same-named pack on disk can never serve bytes in its place;
//   - `installPack()` refuses the reserved name outright, so the app will not create one.
// The id still satisfies `isSafePackId` (it is a directory name that reaches `join()` from
// the renderer over `sounds:getData`), because it goes through the SAME door as every other
// pack — one validated handler, never a second one.

/** The reserved pack id for the user's own imported sounds (== its directory name). */
export const USER_SOUNDS_PACK_ID = 'my-sounds'

/** Display name of that pack, shown in every sound picker. */
export const USER_SOUNDS_PACK_NAME = 'My sounds'

/**
 * Extensions the import accepts — exactly the three Chromium decodes and the three
 * `sounds.ts` already has a MIME for. A format the renderer cannot play is not an import,
 * it is a silent alert.
 */
export const USER_SOUND_EXTENSIONS = ['wav', 'mp3', 'ogg'] as const

/**
 * The one size guard, stated once. 25 MB is far past any alert sting (the whole 60-line
 * Alan Rickman pack is 1.9 MB) and far short of a video file dropped in by mistake — the
 * bytes are read into memory, base64'd and shipped over IPC on every play, so an absurd
 * file is refused politely instead of wedging the alert path.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

/** The cap as a whole number of MB, for the message the user reads. */
export const MAX_IMPORT_MB = MAX_IMPORT_BYTES / (1024 * 1024)

/** Longest slug an imported filename may mint. The id BECOMES the on-disk filename. */
const MAX_SOUND_ID_LEN = 64

/** Basename of a path in either slash flavour (main hands us an OS path). */
export function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? ''
}

/** A filename with its extension removed ("Fanfare (1).mp3" → "Fanfare (1)"). */
export function stemOf(path: string): string {
  return baseName(path).replace(/\.[^.]+$/, '')
}

/**
 * The DISPLAY name of an imported sound: the filename's stem, verbatim apart from trimming.
 * The user named the file; the picker shows what they named it. Empty stems (a file called
 * ".wav") fall back to the whole basename so a row is never blank.
 */
export function userSoundLabel(path: string): string {
  const stem = stemOf(path).trim()
  return stem || baseName(path) || 'Imported sound'
}

/**
 * Mint a soundId from a filename: lowercase, non-alphanumerics folded to single dashes,
 * ends trimmed, capped, de-duplicated against `taken` with a numeric suffix.
 *
 * IT IS NOT `deriveSoundId` (sounds.ts) even though it rhymes with it. That one prefixes a
 * CESP category (there is none here) and its output is only ever a manifest KEY. This id is
 * also the FILENAME the copied audio is written under — which is exactly why it carries a
 * length cap and why the caller never lets a byte of the user's original filename reach
 * `join()`. The output always matches /^[a-z0-9][a-z0-9-]*$/ (pinned by test), so it is
 * filesystem-safe, cannot be `..`, cannot be hidden, and cannot name a stream or a drive.
 */
export function userSoundId(path: string, taken: ReadonlySet<string>): string {
  const slug = stemOf(path)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, MAX_SOUND_ID_LEN)
    .replace(/-+$/, '')
  // A stem of pure punctuation (or one that truncated to nothing) still needs an id, and a
  // leading digit is fine — a leading dash or dot is not, and cannot survive the folding.
  let id = slug || 'sound'
  if (taken.has(id)) {
    let n = 2
    while (taken.has(`${id}-${n}`)) n++
    id = `${id}-${n}`
  }
  return id
}
