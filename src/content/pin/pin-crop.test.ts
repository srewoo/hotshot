import { describe, expect, test } from 'vitest'
import { cropFromDrag, cropToSourceRect, isMeaningfulCrop, MIN_CROP_PX } from './pin-crop'

describe('cropFromDrag', () => {
  test('normalises a rightward-downward drag', () => {
    expect(cropFromDrag({ x: 10, y: 20 }, { x: 110, y: 80 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 60,
    })
  })

  test('normalises a drag made backwards, rather than going negative', () => {
    expect(cropFromDrag({ x: 110, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 60,
    })
  })
})

describe('isMeaningfulCrop', () => {
  test('rejects a slip of the hand', () => {
    expect(isMeaningfulCrop({ x: 0, y: 0, width: 2, height: 40 })).toBe(false)
    expect(isMeaningfulCrop({ x: 0, y: 0, width: 40, height: 2 })).toBe(false)
  })

  test('accepts a real selection at the threshold', () => {
    expect(isMeaningfulCrop({ x: 0, y: 0, width: MIN_CROP_PX, height: MIN_CROP_PX })).toBe(true)
  })
})

describe('cropToSourceRect', () => {
  // A 1,600x1,200 capture shown on a 400x300 pin: 4x.
  const display = { x: 0, y: 0, width: 400, height: 300 }
  const source = { width: 1_600, height: 1_200 }

  test('scales the marquee into the capture own pixels', () => {
    expect(cropToSourceRect({ x: 50, y: 30, width: 100, height: 60 }, display, source)).toEqual({
      x: 200,
      y: 120,
      width: 400,
      height: 240,
    })
  })

  test('a full-pin marquee is the whole capture', () => {
    expect(cropToSourceRect({ x: 0, y: 0, width: 400, height: 300 }, display, source)).toEqual({
      x: 0,
      y: 0,
      width: 1_600,
      height: 1_200,
    })
  })

  /**
   * A marquee dragged past the pin's edge must yield a smaller crop, not a
   * region that runs off the capture — `createImageBitmap` would happily
   * return transparent pixels for the overhang.
   */
  test('clamps a marquee that runs past the edge', () => {
    const region = cropToSourceRect({ x: 300, y: 200, width: 400, height: 400 }, display, source)
    expect(region.x + region.width).toBeLessThanOrEqual(source.width)
    expect(region.y + region.height).toBeLessThanOrEqual(source.height)
  })

  test('never returns a zero-sized region', () => {
    const region = cropToSourceRect({ x: 0, y: 0, width: 0.1, height: 0.1 }, display, source)
    expect(region.width).toBeGreaterThanOrEqual(1)
    expect(region.height).toBeGreaterThanOrEqual(1)
  })

  test('works when the pin is larger than the capture', () => {
    const region = cropToSourceRect(
      { x: 100, y: 100, width: 200, height: 200 },
      { x: 0, y: 0, width: 800, height: 800 },
      { width: 400, height: 400 },
    )
    expect(region).toEqual({ x: 50, y: 50, width: 100, height: 100 })
  })

  test('refuses a pin with no area rather than dividing by zero', () => {
    expect(() =>
      cropToSourceRect({ x: 0, y: 0, width: 10, height: 10 }, { ...display, width: 0 }, source),
    ).toThrow(RangeError)
  })
})
