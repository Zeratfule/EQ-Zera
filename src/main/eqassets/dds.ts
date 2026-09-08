// eqassets/dds.ts — A DDS TEXTURE AS A BMP THE RENDERER CAN SHOW (EQ Zera, 2026-09-06; the
// character-model spike).
//
// The classic archives carry 8-bit BMPs, which a browser decodes on its own. The later item
// archives (gequip5.s3d onward) carry DirectDraw Surfaces - DXT1/3/5 block compression, or plain
// 32/24-bit pixels - which no browser image tag understands. This decodes the top mip level to
// 32-bit BGRA and wraps it as a BMP, so the same `data:image/bmp` road serves both.
//
// ORIENTATION. A DDS stores its top row first; a BMP with a positive height stores its bottom row
// first. Writing the DDS rows in file order therefore flips the image - deliberately: the game's
// UVs were authored against bottom-up bitmaps, and every extractor flips a DDS the same way.

const DDS_MAGIC = 0x20534444 // 'DDS '
const HEADER = 128

interface DdsHeader {
  width: number
  height: number
  fourCC: string
  bitCount: number
}

function header(b: Buffer): DdsHeader | null {
  if (b.length < HEADER || b.readUInt32LE(0) !== DDS_MAGIC) return null
  return {
    height: b.readUInt32LE(12),
    width: b.readUInt32LE(16),
    fourCC: b.readUInt32LE(84) === 0 ? '' : b.toString('latin1', 84, 88),
    bitCount: b.readUInt32LE(88)
  }
}

/** A 5:6:5 colour as [r, g, b] on 0..255. */
function rgb565(c: number): [number, number, number] {
  return [Math.round(((c >> 11) & 31) * (255 / 31)), Math.round(((c >> 5) & 63) * (255 / 63)), Math.round((c & 31) * (255 / 31))]
}

type Rgba = [number, number, number, number]

/** The four colours a DXT colour block interpolates; DXT1 alone has the 3-colour + transparent mode. */
function palette(c0: number, c1: number, dxt1: boolean): Rgba[] {
  const a = rgb565(c0)
  const b = rgb565(c1)
  const mix = (wa: number, wb: number): Rgba => [
    Math.round((a[0] * wa + b[0] * wb) / (wa + wb)),
    Math.round((a[1] * wa + b[1] * wb) / (wa + wb)),
    Math.round((a[2] * wa + b[2] * wb) / (wa + wb)),
    255
  ]
  if (dxt1 && c0 <= c1) return [[...a, 255], [...b, 255], mix(1, 1), [0, 0, 0, 0]]
  return [[...a, 255], [...b, 255], mix(2, 1), mix(1, 2)]
}

/** The eight alphas a DXT5 alpha block interpolates. */
function alphas(a0: number, a1: number): number[] {
  if (a0 > a1) return [a0, a1, ...[6, 5, 4, 3, 2, 1].map((w, i) => Math.round((a0 * w + a1 * (i + 1)) / 7))]
  return [a0, a1, ...[4, 3, 2, 1].map((w, i) => Math.round((a0 * w + a1 * (i + 1)) / 5)), 0, 255]
}

/** Decode one block-compressed image into RGBA, row 0 first as stored. */
function decodeDxt(b: Buffer, h: DdsHeader): Uint8Array {
  const out = new Uint8Array(h.width * h.height * 4)
  const blockBytes = h.fourCC === 'DXT1' ? 8 : 16
  const bw = Math.ceil(h.width / 4)
  const bh = Math.ceil(h.height / 4)
  let at = HEADER
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, at += blockBytes) {
      if (at + blockBytes > b.length) return out
      writeBlock(b, at, h, { out, bx, by })
    }
  }
  return out
}

/** Decode the 4x4 block at `at` into its place in `out`. */
function writeBlock(b: Buffer, at: number, h: DdsHeader, block: { out: Uint8Array; bx: number; by: number }): void {
  const { out, bx, by } = block
  const colorAt = at + (h.fourCC === 'DXT1' ? 0 : 8)
  const colors = palette(b.readUInt16LE(colorAt), b.readUInt16LE(colorAt + 2), h.fourCC === 'DXT1')
  const bits = b.readUInt32LE(colorAt + 4)
  const alpha = blockAlpha(b, at, h.fourCC)
  for (let p = 0; p < 16; p++) {
    const x = bx * 4 + (p & 3)
    const y = by * 4 + (p >> 2)
    if (x >= h.width || y >= h.height) continue
    const c = colors[(bits >> (p * 2)) & 3]
    const o = (y * h.width + x) * 4
    out[o] = c[0]
    out[o + 1] = c[1]
    out[o + 2] = c[2]
    out[o + 3] = alpha ? alpha[p] : c[3]
  }
}

/** The 16 alphas of a DXT3 (4-bit) or DXT5 (interpolated 3-bit) block; null for DXT1. */
function blockAlpha(b: Buffer, at: number, fourCC: string): number[] | null {
  if (fourCC === 'DXT3') {
    const out: number[] = []
    for (let p = 0; p < 16; p++) out.push(((b[at + (p >> 1)] >> ((p & 1) * 4)) & 15) * 17)
    return out
  }
  if (fourCC !== 'DXT5') return null
  const table = alphas(b[at], b[at + 1])
  const out: number[] = []
  // 48 bits of 3-bit indices, little-endian, spread over two 24-bit halves.
  for (let half = 0; half < 2; half++) {
    const base = at + 2 + half * 3
    const bits = b[base] | (b[base + 1] << 8) | (b[base + 2] << 16)
    for (let p = 0; p < 8; p++) out.push(table[(bits >> (p * 3)) & 7])
  }
  return out
}

/** Decode a plain 32- or 24-bit image (BGRA / BGR as DirectDraw lays them out) into RGBA. */
function decodePlain(b: Buffer, h: DdsHeader): Uint8Array | null {
  const bytes = h.bitCount / 8
  if (bytes !== 4 && bytes !== 3) return null
  const out = new Uint8Array(h.width * h.height * 4)
  for (let i = 0, at = HEADER; i < h.width * h.height; i++, at += bytes) {
    if (at + bytes > b.length) break
    out[i * 4] = b[at + 2]
    out[i * 4 + 1] = b[at + 1]
    out[i * 4 + 2] = b[at]
    out[i * 4 + 3] = bytes === 4 ? b[at + 3] : 255
  }
  return out
}

/** A 32-bit BMP around RGBA rows written in the order given (see ORIENTATION above). */
function bmpOf(rgba: Uint8Array, width: number, height: number): Buffer {
  const size = 54 + width * height * 4
  const out = Buffer.alloc(size)
  out.write('BM', 0, 'latin1')
  out.writeUInt32LE(size, 2)
  out.writeUInt32LE(54, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(32, 28)
  out.writeUInt32LE(width * height * 4, 34)
  for (let i = 0; i < width * height; i++) {
    out[54 + i * 4] = rgba[i * 4 + 2]
    out[54 + i * 4 + 1] = rgba[i * 4 + 1]
    out[54 + i * 4 + 2] = rgba[i * 4]
    out[54 + i * 4 + 3] = rgba[i * 4 + 3]
  }
  return out
}

/** True when the file is a DirectDraw Surface. */
export function isDds(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === DDS_MAGIC
}

/** The DDS's top mip level as a 32-bit BMP; null when the file is not a DDS or a kind this does not decode. */
export function ddsToBmp(bytes: Buffer): Buffer | null {
  const h = header(bytes)
  if (!h || h.width === 0 || h.height === 0) return null
  const compressed = h.fourCC === 'DXT1' || h.fourCC === 'DXT3' || h.fourCC === 'DXT5'
  const rgba = compressed ? decodeDxt(bytes, h) : h.fourCC === '' ? decodePlain(bytes, h) : null
  return rgba ? bmpOf(rgba, h.width, h.height) : null
}
