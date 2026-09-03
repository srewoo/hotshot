import { describe, expect, test } from 'vitest'
import {
  canvasPointFrom,
  clampZoom,
  fitAllScale,
  fitWidthScale,
  MAX_ZOOM,
  MIN_ZOOM,
  screenRectFrom,
  toCanvasDistance,
  zoomBy,
  ZOOM_STEP,
} from './view-transform'

/** A 27" window with the editor's chrome subtracted. */
const stage = { width: 1104, height: 640 }

describe('fitWidthScale', () => {
  test('fits the width of a full-page stitch and lets it scroll', () => {
    const scale = fitWidthScale({ width: 2208, height: 9000 }, stage)
    expect(scale).toBe(0.5)
    // The point of the rule: the height is allowed to overflow.
    expect(9000 * scale).toBeGreaterThan(stage.height)
  })

  test('never magnifies a small crop past 1:1', () => {
    expect(fitWidthScale({ width: 300, height: 200 }, stage)).toBe(1)
  })

  test('a tall narrow crop stays at 1:1 rather than shrinking to fit', () => {
    // The old fit-both rule showed this at 81%; there is no reason to.
    expect(fitWidthScale({ width: 300, height: 790 }, stage)).toBe(1)
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a nonsense image width (%s) instead of returning NaN',
    (width) => {
      expect(() => fitWidthScale({ width, height: 100 }, stage)).toThrow(RangeError)
    },
  )

  test('refuses a collapsed stage', () => {
    expect(() => fitWidthScale({ width: 100, height: 100 }, { width: 0, height: 640 })).toThrow(
      RangeError,
    )
  })
})

describe('fitAllScale', () => {
  test('is bound by whichever axis is tighter', () => {
    // Height binds here: fit-width would be 0.5, fit-all is 640/2000.
    expect(fitAllScale({ width: 2208, height: 2000 }, stage)).toBeCloseTo(0.32, 6)
  })

  /**
   * A deliberate limit, not an oversight. Fitting a 9,000px page into 640px
   * needs 0.071x — a 45px-tall strip nobody can annotate or even read. The
   * floor holds and the capture keeps scrolling, which is the usable state.
   */
  test('clamps at the zoom floor for a page too long to fit at all', () => {
    expect(fitAllScale({ width: 2208, height: 9000 }, stage)).toBe(MIN_ZOOM)
  })

  test('equals fit-width when the capture already fits vertically', () => {
    const image = { width: 2208, height: 400 }
    expect(fitAllScale(image, stage)).toBe(fitWidthScale(image, stage))
  })

  test('never magnifies past 1:1 either', () => {
    expect(fitAllScale({ width: 200, height: 100 }, stage)).toBe(1)
  })
})

describe('zoomBy and clampZoom', () => {
  test('steps up and down by a fixed factor', () => {
    expect(zoomBy(1, 1)).toBe(ZOOM_STEP)
    expect(zoomBy(1, -1)).toBeCloseTo(1 / ZOOM_STEP, 10)
  })

  test('a step out then in returns to where it started', () => {
    expect(zoomBy(zoomBy(0.5, 1), -1)).toBeCloseTo(0.5, 10)
  })

  test('stops at the ceiling instead of running away', () => {
    let scale = 1
    for (let i = 0; i < 40; i++) scale = zoomBy(scale, 1)
    expect(scale).toBe(MAX_ZOOM)
  })

  test('stops at the floor instead of reaching zero, which would be unrecoverable', () => {
    let scale = 1
    for (let i = 0; i < 100; i++) scale = zoomBy(scale, -1)
    expect(scale).toBe(MIN_ZOOM)
  })

  test('clamps out-of-range input from either direction', () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM)
  })

  test('refuses a non-positive scale rather than propagating it', () => {
    expect(() => zoomBy(0, 1)).toThrow(RangeError)
  })
})

describe('canvasPointFrom', () => {
  const canvas = { width: 2000, height: 4000 }
  // Rendered at 0.5x, offset because the stage is centred.
  const box = { left: 52, top: 80, width: 1000, height: 2000 }

  test('maps a click at the top-left corner to the canvas origin', () => {
    expect(canvasPointFrom({ x: 52, y: 80 }, box, canvas)).toEqual({ x: 0, y: 0 })
  })

  test('maps a centre click to the centre of the bitmap', () => {
    expect(canvasPointFrom({ x: 552, y: 1080 }, box, canvas)).toEqual({ x: 1000, y: 2000 })
  })

  test('is scroll-safe: a scrolled box has a negative top and still maps correctly', () => {
    // Scrolled down 600 screen px, so the box top is above the viewport.
    const scrolled = { ...box, top: -520 }
    expect(canvasPointFrom({ x: 52, y: 80 }, scrolled, canvas)).toEqual({ x: 0, y: 1200 })
  })

  test('round-trips against screenRectFrom', () => {
    const point = canvasPointFrom({ x: 300, y: 500 }, box, canvas)
    const back = screenRectFrom({ ...point, width: 0, height: 0 }, box, canvas)
    expect(back.x).toBeCloseTo(300, 6)
    expect(back.y).toBeCloseTo(500, 6)
  })

  test('refuses a collapsed box instead of dividing by zero', () => {
    expect(() => canvasPointFrom({ x: 1, y: 1 }, { ...box, width: 0 }, canvas)).toThrow(RangeError)
  })
})

describe('screenRectFrom', () => {
  const canvas = { width: 2000, height: 4000 }
  const box = { left: 52, top: 80, width: 1000, height: 2000 }

  test('scales a canvas rect into viewport coordinates', () => {
    expect(screenRectFrom({ x: 200, y: 400, width: 100, height: 200 }, box, canvas)).toEqual({
      x: 152,
      y: 280,
      width: 50,
      height: 100,
    })
  })

  test('a zero-size rect keeps its position, so handles on a flat line still show', () => {
    expect(screenRectFrom({ x: 200, y: 400, width: 0, height: 0 }, box, canvas)).toMatchObject({
      x: 152,
      y: 280,
      width: 0,
      height: 0,
    })
  })
})

describe('toCanvasDistance', () => {
  test('converts screen slack into canvas pixels at the current scale', () => {
    const canvas = { width: 2208, height: 9000 }
    const box = { left: 0, top: 0, width: 552, height: 2250 } // 0.25x
    expect(toCanvasDistance(6, box, canvas)).toBe(24)
  })

  test('is the identity at 1:1', () => {
    const canvas = { width: 800, height: 600 }
    expect(toCanvasDistance(6, { left: 0, top: 0, width: 800, height: 600 }, canvas)).toBe(6)
  })
})
