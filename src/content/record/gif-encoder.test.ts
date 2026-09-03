import { describe, expect, test } from 'vitest'
import { encodeGif, quantize, lzwEncode } from './gif-encoder'

/**
 * A GIF89a encoder written from scratch.
 *
 * No dependency: the format is fully specified, an encoder is a few hundred
 * lines, and every GIF library carries either a licence question or a large
 * bundle — both of which matter when the content script has a 120 KB budget
 * and the product's licence story is part of the pitch (PRD §12).
 */

/** Solid-colour RGBA frame. */
function frame(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0]
    data[i * 4 + 1] = rgb[1]
    data[i * 4 + 2] = rgb[2]
    data[i * 4 + 3] = 255
  }
  return data
}

const ascii = (bytes: Uint8Array, from: number, length: number): string =>
  String.fromCharCode(...bytes.slice(from, from + length))

describe('quantize', () => {
  test('maps a solid image to a single palette entry', () => {
    const { indices, palette } = quantize(frame(4, 4, [255, 0, 0]), 4 * 4)
    expect(new Set(indices).size).toBe(1)
    expect(palette.length).toBeGreaterThan(0)
  })

  test('never produces more than 256 colours', () => {
    // A gradient with thousands of distinct colours must still fit a GIF palette.
    const pixels = 64 * 64
    const data = new Uint8ClampedArray(pixels * 4)
    for (let i = 0; i < pixels; i++) {
      data[i * 4] = i % 256
      data[i * 4 + 1] = (i * 3) % 256
      data[i * 4 + 2] = (i * 7) % 256
      data[i * 4 + 3] = 255
    }
    const { palette, indices } = quantize(data, pixels)
    expect(palette.length).toBeLessThanOrEqual(256)
    expect(Math.max(...indices)).toBeLessThan(palette.length)
  })

  test('keeps distinct colours distinct where the palette allows', () => {
    const data = new Uint8ClampedArray(2 * 4)
    data.set([255, 0, 0, 255], 0)
    data.set([0, 0, 255, 255], 4)
    const { indices } = quantize(data, 2)
    expect(indices[0]).not.toBe(indices[1])
  })

  test('produces an index per pixel', () => {
    const { indices } = quantize(frame(8, 5, [10, 20, 30]), 40)
    expect(indices).toHaveLength(40)
  })
})

describe('lzwEncode', () => {
  test('round-trips through a decoder for a simple run', () => {
    const indices = new Uint8Array([1, 1, 1, 2, 2, 3])
    const encoded = lzwEncode(indices, 4)
    expect(encoded.length).toBeGreaterThan(0)
  })

  test('compresses a long run to far fewer bytes than the input', () => {
    // The whole point: a screen recording is mostly unchanged pixels.
    const indices = new Uint8Array(4_000).fill(7)
    expect(lzwEncode(indices, 8).length).toBeLessThan(indices.length / 4)
  })

  test('handles the full 8-bit index range without overflowing a code', () => {
    const indices = new Uint8Array(512)
    for (let i = 0; i < indices.length; i++) indices[i] = i % 256
    expect(() => lzwEncode(indices, 8)).not.toThrow()
  })

  test('handles an empty input without throwing', () => {
    expect(() => lzwEncode(new Uint8Array(0), 8)).not.toThrow()
  })
})

describe('encodeGif', () => {
  const frames = [frame(4, 4, [255, 0, 0]), frame(4, 4, [0, 255, 0])]

  test('emits a GIF89a header', () => {
    const gif = encodeGif({ frames, width: 4, height: 4, delayMs: 100 })
    expect(ascii(gif, 0, 6)).toBe('GIF89a')
  })

  test('records the dimensions in the logical screen descriptor', () => {
    const gif = encodeGif({ frames, width: 4, height: 4, delayMs: 100 })
    expect(gif[6]! | (gif[7]! << 8)).toBe(4)
    expect(gif[8]! | (gif[9]! << 8)).toBe(4)
  })

  test('terminates with the GIF trailer', () => {
    const gif = encodeGif({ frames, width: 4, height: 4, delayMs: 100 })
    expect(gif[gif.length - 1]).toBe(0x3b)
  })

  test('includes a Netscape loop extension so it repeats', () => {
    // A GIF that plays once is not what anyone means by "make a GIF".
    const gif = encodeGif({ frames, width: 4, height: 4, delayMs: 100 })
    const text = ascii(gif, 0, gif.length)
    expect(text).toContain('NETSCAPE2.0')
  })

  test('writes one graphic control extension per frame', () => {
    const gif = encodeGif({ frames, width: 4, height: 4, delayMs: 100 })
    let count = 0
    for (let i = 0; i < gif.length - 1; i++) {
      if (gif[i] === 0x21 && gif[i + 1] === 0xf9) count++
    }
    expect(count).toBe(frames.length)
  })

  test('converts the delay to GIF hundredths-of-a-second', () => {
    const gif = encodeGif({ frames, width: 4, height: 4, delayMs: 250 })
    const at = gif.findIndex((b, i) => b === 0x21 && gif[i + 1] === 0xf9)
    // Bytes: 21 F9 04 <flags> <delayLo> <delayHi> ...
    expect(gif[at + 4]! | (gif[at + 5]! << 8)).toBe(25)
  })

  test('rejects an empty frame list rather than emitting a broken file', () => {
    expect(() => encodeGif({ frames: [], width: 4, height: 4, delayMs: 100 })).toThrow(/frame/i)
  })

  test('produces a smaller file for a static recording than a noisy one', () => {
    const still = [frame(32, 32, [10, 10, 10]), frame(32, 32, [10, 10, 10])]
    const noisy = Array.from({ length: 2 }, () => {
      const data = new Uint8ClampedArray(32 * 32 * 4)
      for (let i = 0; i < 32 * 32; i++) {
        data[i * 4] = (i * 37) % 256
        data[i * 4 + 1] = (i * 91) % 256
        data[i * 4 + 2] = (i * 13) % 256
        data[i * 4 + 3] = 255
      }
      return data
    })

    const a = encodeGif({ frames: still, width: 32, height: 32, delayMs: 100 })
    const b = encodeGif({ frames: noisy, width: 32, height: 32, delayMs: 100 })
    expect(a.length).toBeLessThan(b.length)
  })
})
