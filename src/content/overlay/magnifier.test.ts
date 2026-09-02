import { describe, expect, test } from 'vitest'
import { LOUPE_PX, LOUPE_ZOOM, SOURCE_SPAN_PX, loupePlacement, sourceRectFor } from './magnifier'

/**
 * PRD FR-1 / review finding B2, DESIGN §3.1: 132×132 at 12×, over an 11×11
 * source neighbourhood, read from the FROZEN backdrop — which is why the
 * magnifier and the crop are the same bitmap.
 */

const viewport = { width: 1280, height: 800 }

describe('sourceRectFor', () => {
  test('centres an 11-pixel neighbourhood on the cursor', () => {
    expect(SOURCE_SPAN_PX).toBe(11)
    expect(sourceRectFor({ x: 100, y: 100 }, { zoom: 1, dpr: 1 })).toEqual({
      x: 95,
      y: 95,
      width: 11,
      height: 11,
    })
  })

  test('reads DEVICE pixels, so retina shows real pixels rather than blurred ones', () => {
    // The whole point of a loupe is pixel truth; sampling CSS pixels at DPR 2
    // would magnify an already-interpolated image.
    expect(sourceRectFor({ x: 100, y: 100 }, { zoom: 1, dpr: 2 })).toEqual({
      x: 195,
      y: 195,
      width: 11,
      height: 11,
    })
  })

  test('accounts for browser zoom the same way the crop does', () => {
    expect(sourceRectFor({ x: 100, y: 100 }, { zoom: 1.5, dpr: 1 })).toEqual({
      x: 145,
      y: 145,
      width: 11,
      height: 11,
    })
  })

  test('never returns a negative origin at the top-left corner', () => {
    const rect = sourceRectFor({ x: 0, y: 0 }, { zoom: 1, dpr: 1 })
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
  })

  test('magnifies at 12x, which fills the loupe exactly', () => {
    expect(LOUPE_ZOOM).toBe(12)
    expect(LOUPE_PX).toBe(132)
    expect(SOURCE_SPAN_PX * LOUPE_ZOOM).toBe(LOUPE_PX)
  })
})

describe('loupePlacement', () => {
  test('sits below-right of the cursor by default', () => {
    const at = loupePlacement({ x: 200, y: 200 }, viewport)
    expect(at.x).toBeGreaterThan(200)
    expect(at.y).toBeGreaterThan(200)
  })

  test('flips left when it would leave the right edge', () => {
    const at = loupePlacement({ x: 1270, y: 200 }, viewport)
    expect(at.x + LOUPE_PX).toBeLessThanOrEqual(viewport.width)
  })

  test('flips up when it would leave the bottom edge', () => {
    const at = loupePlacement({ x: 200, y: 790 }, viewport)
    expect(at.y + LOUPE_PX).toBeLessThanOrEqual(viewport.height)
  })

  test('stays on screen in the bottom-right corner, where both flips apply', () => {
    const at = loupePlacement({ x: 1275, y: 795 }, viewport)
    expect(at.x).toBeGreaterThanOrEqual(0)
    expect(at.y).toBeGreaterThanOrEqual(0)
    expect(at.x + LOUPE_PX).toBeLessThanOrEqual(viewport.width)
    expect(at.y + LOUPE_PX).toBeLessThanOrEqual(viewport.height)
  })

  test('never covers the cursor itself', () => {
    // A loupe under the pointer hides the very pixel being placed.
    for (const point of [
      { x: 200, y: 200 },
      { x: 1270, y: 200 },
      { x: 200, y: 790 },
      { x: 1275, y: 795 },
    ]) {
      const at = loupePlacement(point, viewport)
      const covers =
        point.x >= at.x && point.x <= at.x + LOUPE_PX && point.y >= at.y && point.y <= at.y + LOUPE_PX
      expect(covers, `loupe covers cursor at ${point.x},${point.y}`).toBe(false)
    }
  })
})
