// eqassets/pfs.ts — READ AN EVERQUEST `.s3d` ARCHIVE (EQ Zera, 2026-09-06; character-model spike,
// phase 1).
//
// `.s3d` is a PFS container: a header pointing at a directory of `{crc, offset, size}` entries,
// each entry's bytes stored as a run of zlib-deflated blocks, and ONE special entry (crc
// 0x61580AC9) holding the file names. Names are matched to entries by DATA OFFSET ORDER, which is
// the format's own rule (LanternExtractor documents it; this reader is checked against the real
// archives in tests/eqAssets.test.mts, and skips when no install is present).
//
// PURE NODE. No Electron, no app state: it takes bytes and gives back files, so the test can hand
// it a real archive and the IPC layer can hand it whatever the configured install root has.

import { inflateSync } from 'node:zlib'

const DIRECTORY_CRC = 0x61580ac9
const MAGIC = 'PFS '

export interface PfsEntry {
  name: string
  size: number
}

export interface PfsArchive {
  /** file names, lower-cased as the game treats them, in data order */
  entries: PfsEntry[]
  /** the inflated bytes of one file, by lower-cased name; undefined when the archive has none */
  read: (name: string) => Uint8Array | undefined
  /** whether a file is in the archive, without inflating it */
  has: (name: string) => boolean
}

interface RawEntry {
  crc: number
  offset: number
  size: number
}

function inflateEntry(buf: Buffer, entry: RawEntry): Uint8Array {
  const out = Buffer.alloc(entry.size)
  let at = entry.offset
  let written = 0
  while (written < entry.size) {
    const deflated = buf.readUInt32LE(at)
    const inflated = buf.readUInt32LE(at + 4)
    const chunk = inflateSync(buf.subarray(at + 8, at + 8 + deflated))
    chunk.copy(out, written, 0, Math.min(chunk.length, inflated))
    written += inflated
    at += 8 + deflated
  }
  return out
}

/** Parse an archive from its bytes. Throws on a file that is not a PFS. */
export function readPfs(bytes: Uint8Array): PfsArchive {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dirOffset = buf.readUInt32LE(0)
  if (buf.toString('latin1', 4, 8) !== MAGIC) throw new Error('not a PFS archive')
  const count = buf.readUInt32LE(dirOffset)
  const raw: RawEntry[] = []
  for (let i = 0; i < count; i++) {
    const at = dirOffset + 4 + i * 12
    raw.push({ crc: buf.readUInt32LE(at), offset: buf.readUInt32LE(at + 4), size: buf.readUInt32LE(at + 8) })
  }
  const dirEntry = raw.find((e) => e.crc === DIRECTORY_CRC)
  if (!dirEntry) throw new Error('PFS archive has no file-name directory')
  const names = Buffer.from(inflateEntry(buf, dirEntry))
  const nameCount = names.readUInt32LE(0)
  const list: string[] = []
  let at = 4
  for (let i = 0; i < nameCount; i++) {
    const len = names.readUInt32LE(at)
    let name = names.toString('latin1', at + 4, at + 4 + len)
    const nul = name.indexOf('\0')
    if (nul >= 0) name = name.slice(0, nul)
    list.push(name.toLowerCase())
    at += 4 + len
  }
  const files = raw.filter((e) => e.crc !== DIRECTORY_CRC).sort((a, b) => a.offset - b.offset)
  const byName = new Map<string, RawEntry>()
  const entries: PfsEntry[] = []
  for (let i = 0; i < files.length && i < list.length; i++) {
    byName.set(list[i], files[i])
    entries.push({ name: list[i], size: files[i].size })
  }
  const cache = new Map<string, Uint8Array>()
  return {
    entries,
    has: (name: string) => byName.has(name.toLowerCase()),
    read: (name: string) => {
      const key = name.toLowerCase()
      const hit = cache.get(key)
      if (hit) return hit
      const entry = byName.get(key)
      if (!entry) return undefined
      const data = inflateEntry(buf, entry)
      cache.set(key, data)
      return data
    }
  }
}
