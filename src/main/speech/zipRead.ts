// zipRead.ts — the twenty lines of zip this app needs, and not one more.
//
// WHY THIS EXISTS. JOS-274 fetches the Microsoft Visual C++ runtime from Microsoft's own
// Visual Studio release channel, and the artifact that channel serves is a `.vsix` — which is
// a plain PKZIP archive with a manifest inside. Four DLLs have to come out of it. That is the
// entire requirement, so this is a READER for a known-good archive, not a zip library: no
// writing, no encryption, no multi-disk, no ZIP64, no streaming.
//
// THE SAFETY POSTURE IS "THE CALLER ALREADY VERIFIED THE BYTES". The archive this reads has
// passed a sha256 gate against a pinned digest before it gets here (vcRuntime.ts), so the file
// is either exactly the archive this build was written against or it never reaches this code.
// That is what lets the parsing below be small and strict: anything unexpected is an ERROR
// (null / throw), never a heuristic recovery, because "unexpected" cannot mean "a slightly
// different zip in the wild" — it can only mean the verification above was bypassed.
//
// NAMES ARE NEVER JOINED TO A PATH BY THIS MODULE, and that is deliberate. The classic zip
// vulnerability is an entry named `../../windows/system32/…`; the caller (vcRuntime.ts) looks
// entries up by their EXACT pinned full name and writes to a filename IT chose, so an archive
// entry name never reaches `join()` at all. There is nothing here to traverse with.
//
// `voicePack.ts` next door walks a zip too (the Kokoro `.npz`), and the two do NOT share code
// on purpose: that one is a POSITIONAL walk of a uniform 54-entry file read through 512-byte
// windowed reads without ever holding 28 MB, which is a different problem with a different
// shape. This one has 3 MB in a Buffer and wants two entries out of thirty-three.

import { inflateRawSync } from 'node:zlib'

/** One central-directory record, reduced to what an extractor needs. */
export interface ZipEntry {
  /** The entry's full name, exactly as stored (forward slashes). */
  readonly name: string
  /** 0 = stored, 8 = deflate. Anything else is refused at read time. */
  readonly method: number
  /** Compressed and uncompressed lengths, from the central directory. */
  readonly compressedSize: number
  readonly uncompressedSize: number
  /** Offset of the entry's LOCAL header (where the bytes actually live). */
  readonly localHeaderOffset: number
}

/** End-of-central-directory signature, and the furthest back it can hide (comment ≤ 64 KB). */
const EOCD_SIG = Buffer.from([0x50, 0x4b, 0x05, 0x06])
const EOCD_MAX_SCAN = 66_000
/** A ZIP64 archive spells these fields all-ones; we refuse rather than misread them. */
const ZIP64_SENTINEL = 0xff_ff_ff_ff

/**
 * Read the central directory. Returns null when the buffer is not a plain single-disk zip —
 * which, given the sha256 gate above this, means the caller was handed something it did not
 * pin. It never throws, so a corrupt archive is a `return null` at the call site rather than
 * an exception crossing the provisioning state machine.
 */
export function readZipEntries(buf: Buffer): ZipEntry[] | null {
  const eocd = buf.lastIndexOf(EOCD_SIG, buf.length - 1)
  if (eocd < 0 || eocd < buf.length - EOCD_MAX_SCAN || eocd + 22 > buf.length) return null
  const count = buf.readUInt16LE(eocd + 10)
  const start = buf.readUInt32LE(eocd + 16)
  if (start === ZIP64_SENTINEL || count === 0xff_ff || start >= buf.length) return null
  const entries: ZipEntry[] = []
  let p = start
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x0201_4b50) return null
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      uncompressedSize: buf.readUInt32LE(p + 24),
      localHeaderOffset: buf.readUInt32LE(p + 42)
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * The bytes of one entry.
 *
 * The local header's own name/extra lengths are re-read rather than reusing the central
 * directory's: the two are allowed to differ (writers routinely put a different extra field in
 * each), and trusting the central copy is the bug that lands an inflate on the wrong offset.
 *
 * Returns null for anything this reader does not do — an unsupported method, a header that is
 * not there, a payload that runs off the end — and for an inflate that fails.
 */
export function readZipEntryBytes(buf: Buffer, entry: ZipEntry): Buffer | null {
  const lho = entry.localHeaderOffset
  if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x0403_4b50) return null
  const nameLen = buf.readUInt16LE(lho + 26)
  const extraLen = buf.readUInt16LE(lho + 28)
  const from = lho + 30 + nameLen + extraLen
  const to = from + entry.compressedSize
  if (to > buf.length) return null
  const raw = buf.subarray(from, to)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method !== 8) return null
  try {
    return inflateRawSync(raw)
  } catch {
    return null
  }
}
