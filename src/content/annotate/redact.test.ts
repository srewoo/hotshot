import { describe, expect, test } from 'vitest'
import { pixelateRegion, solidFillRegion, REDACT_BLOCK_PX } from './redact'

/**
 * PRD FR-9. Redaction must be DESTRUCTIVE: the original pixels must not exist
 * in the exported buffer. A CSS blur that can be un-blurred is a security
 * incident, not a rendering choice.
 *
 * These tests operate on raw RGBA so they can assert the actual bytes rather
 * than trusting a canvas to have done the right thing.
 */

/** A width x height RGBA buffer with a unique value per pixel. */
function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i % 256
    data[i * 4 + 1] = (i * 7) % 256
    data[i * 4 + 2] = (i * 13) % 256
    data[i * 4 + 3] = 255
  }
  return data
}

const at = (data: Uint8ClampedArray, width: number, x: number, y: number): number[] => {
  const o = (y * width + x) * 4
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!]
}

describe('solidFillRegion', () => {
  test('replaces every pixel in the region with the fill colour', () => {
    const data = gradient(8, 8)
    solidFillRegion(data, 8, { x: 2, y: 2, width: 4, height: 4 }, [0, 0, 0])

    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        expect(at(data, 8, x, y)).toEqual([0, 0, 0, 255])
      }
    }
  })

  test('leaves pixels outside the region untouched', () => {
    const original = gradient(8, 8)
    const data = gradient(8, 8)
    solidFillRegion(data, 8, { x: 2, y: 2, width: 4, height: 4 }, [0, 0, 0])

    expect(at(data, 8, 0, 0)).toEqual(at(original, 8, 0, 0))
    expect(at(data, 8, 7, 7)).toEqual(at(original, 8, 7, 7))
  })

  test('the redacted region carries zero variance, so nothing is recoverable', () => {
    const data = gradient(16, 16)
    solidFillRegion(data, 16, { x: 0, y: 0, width: 16, height: 16 }, [12, 34, 56])

    const reds = new Set<number>()
    for (let i = 0; i < 16 * 16; i++) reds.add(data[i * 4]!)
    expect(reds.size).toBe(1)
  })

  test('clamps a region that overhangs the buffer instead of corrupting memory', () => {
    const data = gradient(8, 8)
    expect(() =>
      solidFillRegion(data, 8, { x: 6, y: 6, width: 100, height: 100 }, [0, 0, 0]),
    ).not.toThrow()
    expect(at(data, 8, 7, 7)).toEqual([0, 0, 0, 255])
  })

  test('ignores a fully out-of-bounds region', () => {
    const original = gradient(8, 8)
    const data = gradient(8, 8)
    solidFillRegion(data, 8, { x: 50, y: 50, width: 10, height: 10 }, [0, 0, 0])
    expect(Array.from(data)).toEqual(Array.from(original))
  })
})

describe('pixelateRegion', () => {
  test('uses blocks of at least 12px, as FR-9 requires', () => {
    expect(REDACT_BLOCK_PX).toBeGreaterThanOrEqual(12)
  })

  test('makes every pixel within a block identical', () => {
    const size = REDACT_BLOCK_PX * 2
    const data = gradient(size, size)
    pixelateRegion(data, size, { x: 0, y: 0, width: size, height: size })

    const first = at(data, size, 0, 0)
    for (let y = 0; y < REDACT_BLOCK_PX; y++) {
      for (let x = 0; x < REDACT_BLOCK_PX; x++) {
        expect(at(data, size, x, y)).toEqual(first)
      }
    }
  })

  test('destroys the original values rather than reordering them', () => {
    const size = REDACT_BLOCK_PX * 2
    const original = gradient(size, size)
    const data = gradient(size, size)
    pixelateRegion(data, size, { x: 0, y: 0, width: size, height: size })

    // The number of distinct colours must collapse to roughly the block count.
    const distinct = new Set<string>()
    for (let i = 0; i < size * size; i++) {
      distinct.add(`${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]}`)
    }
    const originalDistinct = new Set<string>()
    for (let i = 0; i < size * size; i++) {
      originalDistinct.add(`${original[i * 4]},${original[i * 4 + 1]},${original[i * 4 + 2]}`)
    }
    expect(distinct.size).toBeLessThanOrEqual(4)
    expect(distinct.size).toBeLessThan(originalDistinct.size)
  })

  test('leaves pixels outside the region untouched', () => {
    const size = REDACT_BLOCK_PX * 3
    const original = gradient(size, size)
    const data = gradient(size, size)
    pixelateRegion(data, size, { x: 0, y: 0, width: REDACT_BLOCK_PX, height: REDACT_BLOCK_PX })

    const far = size - 1
    expect(at(data, size, far, far)).toEqual(at(original, size, far, far))
  })

  test('handles a region smaller than one block without leaving detail', () => {
    const data = gradient(8, 8)
    pixelateRegion(data, 8, { x: 0, y: 0, width: 5, height: 5 })

    const first = at(data, 8, 0, 0)
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        expect(at(data, 8, x, y)).toEqual(first)
      }
    }
  })
})
