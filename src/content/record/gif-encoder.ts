/**
 * A GIF89a encoder, written from scratch.
 *
 * No dependency, deliberately: the format is fully specified, an encoder is a
 * few hundred lines, and every GIF library carries either a licence question
 * or a large bundle — both of which matter when the content script has a
 * 120 KB budget and the licence story is part of the product (PRD §12).
 */

export interface Quantized {
  readonly indices: Uint8Array
  /** Flat RGB triples, at most 256 entries. */
  readonly palette: Uint8Array
}

const MAX_COLOURS = 256

/**
 * Colour reduction by uniform RGB bucketing (3-3-2 bits).
 *
 * Not the best possible palette — median-cut would be better on photographs.
 * It is chosen because screen recordings are mostly flat UI colour, where
 * bucketing is nearly lossless, and because it is deterministic and fast
 * enough to run per frame without dropping the capture.
 */
export function quantize(data: Uint8ClampedArray, pixelCount: number): Quantized {
  const indices = new Uint8Array(pixelCount)
  const bucketToIndex = new Map<number, number>()
  const palette: number[] = []

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * 4] ?? 0
    const g = data[i * 4 + 1] ?? 0
    const b = data[i * 4 + 2] ?? 0

    const bucket = ((r >> 5) << 5) | ((g >> 5) << 2) | (b >> 6)

    let index = bucketToIndex.get(bucket)
    if (index === undefined) {
      if (palette.length / 3 >= MAX_COLOURS) {
        // Palette full: reuse the nearest existing entry rather than failing.
        index = nearest(palette, r, g, b)
      } else {
        index = palette.length / 3
        palette.push(r, g, b)
      }
      bucketToIndex.set(bucket, index)
    }
    indices[i] = index
  }

  // A GIF colour table must be a power of two, at least 2 entries.
  const used = Math.max(2, palette.length / 3)
  const size = 1 << Math.ceil(Math.log2(used))
  const table = new Uint8Array(size * 3)
  table.set(palette.slice(0, size * 3))

  return { indices, palette: table }
}

function nearest(palette: readonly number[], r: number, g: number, b: number): number {
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < palette.length; i += 3) {
    const dr = (palette[i] ?? 0) - r
    const dg = (palette[i + 1] ?? 0) - g
    const db = (palette[i + 2] ?? 0) - b
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = i / 3
    }
  }
  return best
}

/** Emits GIF's variable-width LZW codes, least-significant bit first. */
class BitWriter {
  private readonly bytes: number[] = []
  private current = 0
  private bitsUsed = 0

  write(code: number, width: number): void {
    for (let bit = 0; bit < width; bit++) {
      if ((code >> bit) & 1) this.current |= 1 << this.bitsUsed
      if (++this.bitsUsed === 8) {
        this.bytes.push(this.current)
        this.current = 0
        this.bitsUsed = 0
      }
    }
  }

  finish(): number[] {
    if (this.bitsUsed > 0) this.bytes.push(this.current)
    return this.bytes
  }
}

/** LZW compression as GIF specifies it, including the clear/end codes. */
export function lzwEncode(indices: Uint8Array, colourBits: number): Uint8Array {
  const minCodeSize = Math.max(2, colourBits)
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1

  const writer = new BitWriter()
  let dictionary = new Map<string, number>()
  let nextCode = endCode + 1
  let codeWidth = minCodeSize + 1

  const reset = (): void => {
    dictionary = new Map()
    nextCode = endCode + 1
    codeWidth = minCodeSize + 1
  }

  writer.write(clearCode, codeWidth)
  reset()

  if (indices.length === 0) {
    writer.write(endCode, codeWidth)
    return Uint8Array.from(writer.finish())
  }

  let sequence = String(indices[0])

  for (let i = 1; i < indices.length; i++) {
    const next = String(indices[i])
    const candidate = `${sequence},${next}`

    if (dictionary.has(candidate)) {
      sequence = candidate
      continue
    }

    writer.write(dictionary.get(sequence) ?? Number(sequence), codeWidth)
    dictionary.set(candidate, nextCode++)

    if (nextCode > 1 << codeWidth) {
      if (codeWidth < 12) codeWidth++
      else {
        // The dictionary is full at 12 bits; GIF requires a clear code here.
        writer.write(clearCode, codeWidth)
        reset()
      }
    }
    sequence = next
  }

  writer.write(dictionary.get(sequence) ?? Number(sequence), codeWidth)
  writer.write(endCode, codeWidth)
  return Uint8Array.from(writer.finish())
}

export interface GifInput {
  readonly frames: readonly Uint8ClampedArray[]
  readonly width: number
  readonly height: number
  readonly delayMs: number
}

export function encodeGif({ frames, width, height, delayMs }: GifInput): Uint8Array {
  if (frames.length === 0) {
    throw new RangeError('A GIF needs at least one frame.')
  }

  const out: number[] = []
  const byte = (v: number): void => void out.push(v & 0xff)
  const short = (v: number): void => {
    byte(v)
    byte(v >> 8)
  }
  const text = (value: string): void => {
    for (const char of value) byte(char.charCodeAt(0))
  }

  text('GIF89a')
  short(width)
  short(height)
  byte(0x70) // no global colour table; each frame carries its own
  byte(0)
  byte(0)

  // Netscape looping extension — without it the GIF plays once, which is not
  // what anyone means by "make a GIF".
  byte(0x21)
  byte(0xff)
  byte(11)
  text('NETSCAPE2.0')
  byte(3)
  byte(1)
  short(0) // 0 = loop forever
  byte(0)

  const delayCentiseconds = Math.max(1, Math.round(delayMs / 10))
  const pixelCount = width * height

  for (const frame of frames) {
    const { indices, palette } = quantize(frame, pixelCount)
    const colourCount = palette.length / 3
    const colourBits = Math.max(1, Math.ceil(Math.log2(colourCount)))

    // Graphic control extension: per-frame delay.
    byte(0x21)
    byte(0xf9)
    byte(4)
    byte(0)
    short(delayCentiseconds)
    byte(0)
    byte(0)

    // Image descriptor, with a local colour table.
    byte(0x2c)
    short(0)
    short(0)
    short(width)
    short(height)
    byte(0x80 | (colourBits - 1))
    for (const component of palette) byte(component)

    const minCodeSize = Math.max(2, colourBits)
    byte(minCodeSize)

    // LZW output is written in sub-blocks of at most 255 bytes.
    const compressed = lzwEncode(indices, colourBits)
    for (let offset = 0; offset < compressed.length; offset += 255) {
      const chunk = compressed.subarray(offset, offset + 255)
      byte(chunk.length)
      for (const value of chunk) byte(value)
    }
    byte(0)
  }

  byte(0x3b) // trailer
  return Uint8Array.from(out)
}
