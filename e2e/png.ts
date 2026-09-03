import { inflateSync } from 'node:zlib'

/**
 * A minimal PNG reader for visual assertions.
 *
 * The overlay and editor live in a CLOSED shadow root, so page JavaScript
 * cannot reach their DOM to assert on it — that isolation is deliberate. The
 * screenshot is therefore the only honest observation point, and this decodes
 * one so a test can assert on pixels rather than on a thumbnail looking right.
 */

export interface Bitmap {
  readonly width: number
  readonly height: number
  /** RGBA, row-major. */
  readonly data: Uint8Array
}

function unfilter(raw: Buffer, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp
  const out = new Uint8Array(stride * height)
  let previous = new Uint8Array(stride)
  let offset = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[offset++]!
    const line = new Uint8Array(raw.subarray(offset, offset + stride))
    offset += stride

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp]! : 0
      const b = previous[x]!
      const c = x >= bpp ? previous[x - bpp]! : 0
      const value = line[x]!

      switch (filter) {
        case 1:
          line[x] = (value + a) & 0xff
          break
        case 2:
          line[x] = (value + b) & 0xff
          break
        case 3:
          line[x] = (value + ((a + b) >> 1)) & 0xff
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          line[x] = (value + pr) & 0xff
          break
        }
        default:
          break
      }
    }
    out.set(line, y * stride)
    previous = line
  }
  return out
}

export function decodePng(buffer: Buffer): Bitmap {
  let offset = 8 // skip the signature
  let width = 0
  let height = 0
  let colourType = 6
  const idat: Buffer[] = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)

    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      colourType = body[9]!
    } else if (type === 'IDAT') {
      idat.push(body)
    }
    offset += 12 + length
  }

  const bpp = colourType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const pixels = unfilter(raw, width, height, bpp)

  if (bpp === 4) return { width, height, data: pixels }

  // Normalise RGB to RGBA so callers only ever handle one layout.
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3]!
    rgba[i * 4 + 1] = pixels[i * 3 + 1]!
    rgba[i * 4 + 2] = pixels[i * 3 + 2]!
    rgba[i * 4 + 3] = 255
  }
  return { width, height, data: rgba }
}

/** Counts pixels within `tolerance` of a colour — how a test sees an annotation. */
export function countNear(
  bitmap: Bitmap,
  [r, g, b]: readonly [number, number, number],
  tolerance = 40,
): number {
  let count = 0
  for (let i = 0; i < bitmap.data.length; i += 4) {
    if (
      Math.abs(bitmap.data[i]! - r) <= tolerance &&
      Math.abs(bitmap.data[i + 1]! - g) <= tolerance &&
      Math.abs(bitmap.data[i + 2]! - b) <= tolerance
    ) {
      count++
    }
  }
  return count
}

export interface PixelBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly count: number
}

/**
 * The extent of a colour in the screenshot.
 *
 * Counting pixels proves a mark exists; its extent proves it MOVED or was
 * RESIZED, which is the only way to verify object editing through a closed
 * shadow root.
 */
export function boundsNear(
  bitmap: Bitmap,
  colour: readonly [number, number, number],
  tolerance = 40,
): PixelBounds {
  const [r, g, b] = colour
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let count = 0

  for (let i = 0; i < bitmap.data.length; i += 4) {
    if (
      Math.abs(bitmap.data[i]! - r) <= tolerance &&
      Math.abs(bitmap.data[i + 1]! - g) <= tolerance &&
      Math.abs(bitmap.data[i + 2]! - b) <= tolerance
    ) {
      const pixel = i / 4
      const x = pixel % bitmap.width
      const y = Math.floor(pixel / bitmap.width)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      count++
    }
  }

  return { minX, minY, maxX, maxY, count }
}

/**
 * A rectangular region of the screenshot.
 *
 * Assertions on annotation colour MUST be cropped to the capture: the toolbar's
 * active-tool chip, the palette swatches and the Jira/Send buttons are drawn in
 * the same palette as the marks, so a whole-screenshot count of "flare pixels"
 * is thousands of pixels of chrome and proves nothing about the canvas.
 */
export function crop(
  bitmap: Bitmap,
  region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Bitmap {
  const out = new Uint8Array(region.width * region.height * 4)
  for (let row = 0; row < region.height; row++) {
    const from = ((region.y + row) * bitmap.width + region.x) * 4
    out.set(bitmap.data.subarray(from, from + region.width * 4), row * region.width * 4)
  }
  return { width: region.width, height: region.height, data: out }
}
