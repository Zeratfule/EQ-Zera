// feedback/inventory.ts — package the current `/outputfile inventory` dump as a report attachment.
//
// ============================ THE ONE RULE ============================
// THE DUMP IS OPENED READ-ONLY AND IS NEVER WRITTEN TO. `readFile(path)` and `stat(path)`, and
// that is the entire filesystem surface of this module. The file belongs to the game and to the
// player; the app is a guest in it, exactly as it is in the log (slice.ts).
// ======================================================================
//
// ---------------------------------------------------------------------------------------------
// THE SCRUB QUESTION, ANSWERED BY READING THE FORMAT RATHER THAN BY ASSUMING (JOS-296)
// ---------------------------------------------------------------------------------------------
// `src/shared/logScrub.ts` exists because a game log is full of OTHER PEOPLE'S WORDS. Before
// declaring it inapplicable here, the two committed dumps were swept end to end
// (`tests/fixtures/Primitive_freeport-Inventory.txt`, 295 rows, and
// `tests/fixtures/jos66-sky-keyring-Inventory.txt`). What is in them:
//
//   * a tab-separated header row `Location Name ID Count Slots`, then item rows;
//   * a blank line, then a second header `KeyRing Name ID` and its rows;
//   * `Location` is a slot vocabulary the CLIENT owns — `Ear`, `Primary`, `General 3`,
//     `Bank17`, `SharedBank2`, `Personal`, `Activated`, and `-Slot<n>` children of those;
//   * `Name` is an item name out of the game's own item table (`Brigandine Tunic +1`,
//     `Djarn's Amethyst Ring +1`, `Empty`), `ID` is its numeric item id, `Count` and `Slots`
//     are integers.
//
// AND WHAT THE SWEEP LOOKED FOR AND DID NOT FIND: no quoted speech, no tells, no `/who` rows, no
// timestamps, no zone lines, no coordinates, no filesystem paths, no URLs, no e-mail-shaped text,
// not one byte outside printable ASCII + TAB/CR/LF, and — checked explicitly — NOT THE CHARACTER
// NAME OR THE SERVER NAME ANYWHERE IN THE CONTENTS. Those two appear only in the FILENAME
// (`Primitive_freeport-Inventory.txt`), which is why `InventoryDumpMeta` deliberately does not
// carry it. The apostrophes the sweep did turn up are item names (`Djarn's Amethyst Ring`), not
// speech.
//
// SO THE SLICE SCRUBBER IS NOT RUN HERE, and that is a finding rather than a shrug: there is no
// line in this format that it could drop, and running a chat-line drop list over a table of item
// rows would only create the risk of removing a row whose item name happened to trip a pattern.
// What IS still true is that the file is text the app did not write and will put on somebody's
// screen, so the OWNER side sanitizes control characters out of the copy it keeps
// (`src/main/triage/rows.ts sanitizeInventory`) — the same third leg the slice has.
//
// THIS SWEEP IS ABOUT THE FORMAT AS OBSERVED. If a future dump kind (or a client patch) puts
// free text in a dump, the finding above is what has to be re-checked, and the awaiting-sample
// law in shared/outputs/kinds.ts is the precedent for refusing until someone has looked.
//
// ---------------------------------------------------------------------------------------------
// Electron-free and path-parameterized, for the same reason slice.ts is: `tests/feedbackInventory
// .test.mts` drives the whole pipeline against temp files, and the resolution of WHICH dump
// belongs to the active character stays in `submit.ts`, where the registry and the store live.

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import {
  MAX_INVENTORY_LINES,
  MAX_UPLOAD_BYTES,
  PREVIEW_MAX_LINES,
  type InventoryDumpMeta,
  type InventoryUnavailable
} from '../../shared/feedback'

/**
 * The most raw dump we will read into memory. A real dump is ~10 KB; this is four orders of
 * magnitude of headroom and exists so a file that is not an inventory dump at all (a log
 * accidentally renamed, a filesystem returning nonsense) can never be loaded whole. Over it, the
 * answer is `too-large` WITHOUT the read — the stat is enough to know.
 */
export const MAX_DUMP_READ_BYTES = 8 * 1024 * 1024

/** A packaged dump: the metadata for the JSON body, the gz for S3, the text, and the preview. */
export interface InventoryAttachment extends InventoryDumpMeta {
  readonly ok: true
  /** The bytes the presigned POST uploads. */
  readonly gz: Buffer
  /** The complete dump text — exactly what `gz` is the gzip of. */
  readonly text: string
  readonly previewLines: string[]
  readonly truncatedPreview: boolean
  /** The dump's file name (never its directory). Shown in the dialog; never sent. */
  readonly fileName: string
}

/** Either a packaged dump or the NAMED reason there is none. Never a bare null: see
 *  `FeedbackInventoryPreview`'s header for why the reason has to survive to the UI. */
export type InventoryResult =
  | InventoryAttachment
  | { readonly ok: false; readonly reason: InventoryUnavailable }

const refuse = (reason: InventoryUnavailable): InventoryResult => ({ ok: false, reason })

/**
 * Split a dump into lines, dropping ONLY a trailing empty line from the final newline.
 *
 * Interior blank lines are KEPT: the file uses one as its section separator (item table, blank,
 * keyring table) and `inventoryParse` reads the sections positionally. A "helpful" blank-line
 * filter here would hand the owner a dump that parses differently from the player's.
 */
export function dumpLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The capped preview that crosses IPC, mirroring `slice.ts previewOf` — with the head/tail split
 * dropped, because a dump is not a timeline. It is a table read from the top (equipment first,
 * bank last), so the first N rows ARE the useful N rows and an omission marker at the end says
 * the rest honestly.
 */
export function previewOfDump(lines: readonly string[]): {
  previewLines: string[]
  truncatedPreview: boolean
} {
  if (lines.length <= PREVIEW_MAX_LINES) {
    return { previewLines: lines.slice(), truncatedPreview: false }
  }
  const omitted = lines.length - PREVIEW_MAX_LINES
  return {
    previewLines: [
      ...lines.slice(0, PREVIEW_MAX_LINES),
      `… ${omitted.toLocaleString()} more rows in the dump …`
    ],
    truncatedPreview: true
  }
}

/**
 * Package the dump at `path` for upload. Never throws — every failure is a named reason, because
 * the dialog has to SAY which nothing it is looking at.
 *
 * The order is the cheap-first order slice.ts uses: stat (existence, mtime, a raw-size refusal),
 * then the read, then the row cap, then gzip, then the byte cap. Nothing is trimmed at any step
 * — see MAX_INVENTORY_LINES's header for why a partial inventory is worse than none.
 */
export async function buildInventoryAttachment(
  path: string,
  fileName: string
): Promise<InventoryResult> {
  let updatedAt: number
  let rawBytes: number
  try {
    const st = await stat(path)
    // A REGULAR FILE OR NOTHING, and the check is before the size one on purpose: a directory
    // stats fine and reports size 0 on Windows, so "is it empty" would answer `empty` for
    // something that is not a dump at all. `unreadable` is the honest word for a path that
    // exists and cannot be a dump.
    if (!st.isFile()) return refuse('unreadable')
    updatedAt = Math.floor(st.mtimeMs)
    rawBytes = st.size
  } catch {
    return refuse('no-dump')
  }
  if (rawBytes <= 0) return refuse('empty')
  if (rawBytes > MAX_DUMP_READ_BYTES) return refuse('too-large')

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    // The file was listed a moment ago and cannot be read now: a permission problem, or it went
    // away between the stat and the read. Either way it is unreadable, not absent.
    return refuse('unreadable')
  }

  const lines = dumpLines(text)
  if (lines.length === 0) return refuse('empty')
  if (lines.length > MAX_INVENTORY_LINES) return refuse('too-large')

  const gz = gzipSync(Buffer.from(text, 'utf8'), { level: 9 })
  if (gz.length > MAX_UPLOAD_BYTES) return refuse('too-large')

  return {
    ok: true,
    bytes: gz.length,
    lines: lines.length,
    updatedAt,
    sha256: createHash('sha256').update(gz).digest('hex'),
    gz,
    text,
    fileName,
    ...previewOfDump(lines)
  }
}

/** The metadata half of a packaged dump — what travels in the JSON body. */
export function inventoryMeta(dump: InventoryAttachment): InventoryDumpMeta {
  const { bytes, lines, updatedAt, sha256 } = dump
  return { bytes, lines, updatedAt, sha256 }
}
