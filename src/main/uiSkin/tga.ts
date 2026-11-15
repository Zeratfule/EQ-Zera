/**
 * A pure TGA codec for the in-game skin generator: true-colour only (type 2 uncompressed,
 * type 10 RLE), 24 or 32 bits per pixel. That is every TGA the EQ Legends default skin ships
 * except one mislabelled file, which `decodeTga` refuses (and the builder then leaves alone).
 *
 * The decoded image is always RGBA, top-left origin, row-major. `encodeTga` writes the SAME
 * encoding, depth, descriptor and origin the source used (`TgaImage.format`), so a recoloured
 * texture is loaded by the client exactly the way the original was. 24-bit sources carry no
 * alpha, so their decoded alpha is 255 and encoding drops it again.
 */

export interface TgaFormat {
  /** 2 = uncompressed true-colour, 10 = RLE true-colour */
  readonly imageType: 2 | 10
  readonly bitsPerPixel: 24 | 32
  /** the raw image descriptor byte (alpha bits + origin bits) */
  readonly descriptor: number
  /** the image ID field, kept verbatim */
  readonly id: Uint8Array
}

export interface TgaImage {
  readonly width: number
  readonly height: number
  /** RGBA, top-left origin, `width * height * 4` bytes */
  readonly rgba: Uint8Array
  readonly format: TgaFormat
}

const HEADER = 18
const TOP_ORIGIN = 0x20
const RIGHT_ORIGIN = 0x10

export class TgaError extends Error {}

interface Header {
  idLength: number
  colorMapType: number
  imageType: number
  colorMapLength: number
  colorMapEntryBits: number
  width: number
  height: number
  bpp: number
  descriptor: number
}

function readHeader(buf: Uint8Array): Header {
  if (buf.length < HEADER) throw new TgaError('file shorter than a TGA header')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  return {
    idLength: buf[0] ?? 0,
    colorMapType: buf[1] ?? 0,
    imageType: buf[2] ?? 0,
    colorMapLength: dv.getUint16(5, true),
    colorMapEntryBits: buf[7] ?? 0,
    width: dv.getUint16(12, true),
    height: dv.getUint16(14, true),
    bpp: buf[16] ?? 0,
    descriptor: buf[17] ?? 0
  }
}

function checkHeader(h: Header): asserts h is Header & { imageType: 2 | 10; bpp: 24 | 32 } {
  if (h.imageType !== 2 && h.imageType !== 10) {
    throw new TgaError(`unsupported TGA image type ${String(h.imageType)}`)
  }
  if (h.bpp !== 24 && h.bpp !== 32) throw new TgaError(`unsupported depth ${String(h.bpp)}`)
  if (h.colorMapType !== 0 && h.colorMapType !== 1) throw new TgaError('bad colour map type')
  if (h.width === 0 || h.height === 0) throw new TgaError('empty image')
}

/** Reads the source pixel stream (BGR[A], file order) into `out`, `count` pixels long. */
function readPixels(buf: Uint8Array, start: number, h: Header, count: number): Uint8Array {
  const bytes = h.bpp / 8
  const out = new Uint8Array(count * 4)
  let p = start
  let i = 0
  const take = (o: number): void => {
    if (p + bytes > buf.length) throw new TgaError('truncated pixel data')
    out[o] = buf[p + 2] ?? 0
    out[o + 1] = buf[p + 1] ?? 0
    out[o + 2] = buf[p] ?? 0
    out[o + 3] = bytes === 4 ? (buf[p + 3] ?? 0) : 255
    p += bytes
  }
  if (h.imageType === 2) {
    for (; i < count; i++) take(i * 4)
    return out
  }
  while (i < count) {
    if (p >= buf.length) throw new TgaError('truncated RLE data')
    const packet = buf[p++] ?? 0
    const n = (packet & 0x7f) + 1
    if (i + n > count) throw new TgaError('RLE packet overruns the image')
    if (packet & 0x80) {
      take(i * 4)
      for (let k = 1; k < n; k++) out.copyWithin((i + k) * 4, i * 4, i * 4 + 4)
    } else {
      for (let k = 0; k < n; k++) take((i + k) * 4)
    }
    i += n
  }
  return out
}

/** Moves file-order pixels to top-left order (or back: the flip is its own inverse). */
function reorient(src: Uint8Array, w: number, h: number, descriptor: number): Uint8Array {
  const flipY = (descriptor & TOP_ORIGIN) === 0
  const flipX = (descriptor & RIGHT_ORIGIN) !== 0
  if (!flipX && !flipY) return src
  const out = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    const sy = flipY ? h - 1 - y : y
    for (let x = 0; x < w; x++) {
      const sx = flipX ? w - 1 - x : x
      const s = (sy * w + sx) * 4
      out.set(src.subarray(s, s + 4), (y * w + x) * 4)
    }
  }
  return out
}

export function decodeTga(buf: Uint8Array): TgaImage {
  const h = readHeader(buf)
  checkHeader(h)
  const id = buf.slice(HEADER, HEADER + h.idLength)
  const mapBytes = h.colorMapType === 1 ? h.colorMapLength * Math.ceil(h.colorMapEntryBits / 8) : 0
  const start = HEADER + h.idLength + mapBytes
  const raw = readPixels(buf, start, h, h.width * h.height)
  return {
    width: h.width,
    height: h.height,
    rgba: reorient(raw, h.width, h.height, h.descriptor),
    format: { imageType: h.imageType, bitsPerPixel: h.bpp, descriptor: h.descriptor, id }
  }
}

function pixelBytes(rgba: Uint8Array, i: number, bytes: number, out: number[]): void {
  out.push(rgba[i + 2] ?? 0, rgba[i + 1] ?? 0, rgba[i] ?? 0)
  if (bytes === 4) out.push(rgba[i + 3] ?? 0)
}

function samePixel(rgba: Uint8Array, a: number, b: number, bytes: number): boolean {
  for (let k = 0; k < bytes; k++) {
    // RGB at 0..2 and alpha at 3 compare the same way; a 24-bit write ignores alpha.
    if (rgba[a + k] !== rgba[b + k]) return false
  }
  return true
}

/** RLE-encodes one scanline (packets never cross a row, per the TGA 2.0 recommendation). */
function encodeRow(rgba: Uint8Array, bytes: number, out: number[]): void {
  const w = rgba.length / 4
  let x = 0
  while (x < w) {
    let run = 1
    while (x + run < w && run < 128 && samePixel(rgba, x * 4, (x + run) * 4, bytes)) run++
    if (run > 1) {
      out.push(0x80 | (run - 1))
      pixelBytes(rgba, x * 4, bytes, out)
      x += run
      continue
    }
    let lit = 1
    while (
      x + lit < w &&
      lit < 128 &&
      !(x + lit + 1 < w && samePixel(rgba, (x + lit) * 4, (x + lit + 1) * 4, bytes))
    ) lit++
    out.push(lit - 1)
    for (let k = 0; k < lit; k++) pixelBytes(rgba, (x + k) * 4, bytes, out)
    x += lit
  }
}

export function encodeTga(img: TgaImage): Uint8Array {
  const { width: w, height: h, format } = img
  if (img.rgba.length !== w * h * 4) throw new TgaError('pixel buffer does not match the size')
  const bytes = format.bitsPerPixel / 8
  const fileOrder = reorient(img.rgba, w, h, format.descriptor)
  const body: number[] = []
  if (format.imageType === 2) {
    for (let i = 0; i < w * h; i++) pixelBytes(fileOrder, i * 4, bytes, body)
  } else {
    for (let y = 0; y < h; y++) encodeRow(fileOrder.subarray(y * w * 4, (y + 1) * w * 4), bytes, body)
  }
  const out = new Uint8Array(HEADER + format.id.length + body.length)
  const dv = new DataView(out.buffer)
  out[0] = format.id.length
  out[2] = format.imageType
  dv.setUint16(12, w, true)
  dv.setUint16(14, h, true)
  out[16] = format.bitsPerPixel
  out[17] = format.descriptor
  out.set(format.id, HEADER)
  out.set(body, HEADER + format.id.length)
  return out
}
