/**
 * A minimal DDS codec for the one kind the EQ Legends modern skin's chrome atlases use:
 * uncompressed 32-bit RGBA (pixel-format flags RGB | ALPHAPIXELS, explicit channel masks), one
 * mip level. Compressed (FourCC) or mip-mapped files are refused. The 128-byte header is kept
 * verbatim on encode, so a rewritten atlas is loaded exactly the way the original was.
 */

export interface DdsImage {
  readonly width: number
  readonly height: number
  /** RGBA, top-left origin */
  readonly rgba: Uint8Array
  /** the original 128-byte header */
  readonly header: Uint8Array
}

export class DdsError extends Error {}

const HEADER = 128
const DDPF_RGB = 0x40
const DDPF_FOURCC = 0x4

interface Masks {
  r: number
  g: number
  b: number
  a: number
}

function shiftOf(mask: number): number {
  if (mask === 0) return 0
  let s = 0
  while (((mask >>> s) & 1) === 0) s++
  return s
}

function readHeader(buf: Uint8Array): { w: number; h: number; masks: Masks } {
  if (buf.length < HEADER) throw new DdsError('file shorter than a DDS header')
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x20534444) throw new DdsError('not a DDS file')
  const flags = dv.getUint32(80, true)
  const bpp = dv.getUint32(88, true)
  const mips = dv.getUint32(28, true)
  if (flags & DDPF_FOURCC || !(flags & DDPF_RGB) || bpp !== 32) throw new DdsError('only uncompressed 32-bit DDS is supported')
  if (mips > 1) throw new DdsError('mip-mapped DDS is not supported')
  const w = dv.getUint32(16, true)
  const h = dv.getUint32(12, true)
  if (buf.length < HEADER + w * h * 4) throw new DdsError('truncated pixel data')
  const masks = { r: dv.getUint32(92, true), g: dv.getUint32(96, true), b: dv.getUint32(100, true), a: dv.getUint32(104, true) }
  return { w, h, masks }
}

export function decodeDds(buf: Uint8Array): DdsImage {
  const { w, h, masks } = readHeader(buf)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const rgba = new Uint8Array(w * h * 4)
  const sr = shiftOf(masks.r)
  const sg = shiftOf(masks.g)
  const sb = shiftOf(masks.b)
  const sa = shiftOf(masks.a)
  for (let i = 0; i < w * h; i++) {
    const v = dv.getUint32(HEADER + i * 4, true)
    rgba[i * 4] = (v & masks.r) >>> sr
    rgba[i * 4 + 1] = (v & masks.g) >>> sg
    rgba[i * 4 + 2] = (v & masks.b) >>> sb
    rgba[i * 4 + 3] = masks.a ? (v & masks.a) >>> sa : 255
  }
  return { width: w, height: h, rgba, header: buf.slice(0, HEADER) }
}

export function encodeDds(img: DdsImage): Uint8Array {
  const { w, masks } = readHeader(new Uint8Array([...img.header, ...new Uint8Array(img.width * img.height * 4)]))
  if (w !== img.width) throw new DdsError('header does not match the image')
  const out = new Uint8Array(HEADER + img.width * img.height * 4)
  out.set(img.header, 0)
  const dv = new DataView(out.buffer)
  const sr = shiftOf(masks.r)
  const sg = shiftOf(masks.g)
  const sb = shiftOf(masks.b)
  const sa = shiftOf(masks.a)
  for (let i = 0; i < img.width * img.height; i++) {
    const p = i * 4
    const v =
      ((img.rgba[p] ?? 0) << sr) |
      ((img.rgba[p + 1] ?? 0) << sg) |
      ((img.rgba[p + 2] ?? 0) << sb) |
      (masks.a ? (img.rgba[p + 3] ?? 0) << sa : 0)
    dv.setUint32(HEADER + p, v >>> 0, true)
  }
  return out
}
