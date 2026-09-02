import { describe, expect, test } from 'vitest'
import { type CssRect, toDeviceRect, assertScaleUnchanged, ScaleChangedError } from './device-rect'

/**
 * PRD FR-40 / review finding B8 — the highest-severity defect found in review.
 *
 * deviceRect = cssRect × zoom × devicePixelRatio
 *
 * Browser zoom was absent from the first PRD draft entirely. An engineer
 * implementing the original FR-6 literally would have shipped every capture
 * 50% wrong at 150% zoom: a wrong crop, presented to the user as correct,
 * which is exactly the failure R-3 declares unacceptable.
 */

const rect: CssRect = { x: 100, y: 50, width: 640, height: 480 }

describe('toDeviceRect', () => {
  test('is the identity at 100% zoom on a non-retina display', () => {
    expect(toDeviceRect(rect, { zoom: 1, dpr: 1 })).toEqual({
      x: 100,
      y: 50,
      width: 640,
      height: 480,
    })
  })

  test('doubles every component on a retina display', () => {
    expect(toDeviceRect(rect, { zoom: 1, dpr: 2 })).toEqual({
      x: 200,
      y: 100,
      width: 1280,
      height: 960,
    })
  })

  test('scales the ORIGIN as well as the size at 150% zoom', () => {
    // The specific bug: scaling width/height but not x/y yields a correctly
    // sized crop taken from the wrong place, which is harder to spot.
    expect(toDeviceRect(rect, { zoom: 1.5, dpr: 1 })).toEqual({
      x: 150,
      y: 75,
      width: 960,
      height: 720,
    })
  })

  test('composes zoom and dpr multiplicatively', () => {
    expect(toDeviceRect(rect, { zoom: 1.5, dpr: 2 })).toEqual({
      x: 300,
      y: 150,
      width: 1920,
      height: 1440,
    })
  })

  test('rounds to whole device pixels rather than emitting fractions', () => {
    // 110% zoom produces fractional device pixels; a canvas cannot address them.
    const r = toDeviceRect({ x: 0, y: 0, width: 101, height: 33 }, { zoom: 1.1, dpr: 1 })
    expect(Number.isInteger(r.width)).toBe(true)
    expect(Number.isInteger(r.height)).toBe(true)
    expect(r).toEqual({ x: 0, y: 0, width: 111, height: 36 })
  })

  test('never rounds a non-empty selection away to zero', () => {
    const r = toDeviceRect({ x: 0, y: 0, width: 1, height: 1 }, { zoom: 0.25, dpr: 1 })
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })

  test('rejects a negative-sized rect instead of silently normalising it', () => {
    expect(() =>
      toDeviceRect({ x: 0, y: 0, width: -5, height: 10 }, { zoom: 1, dpr: 1 }),
    ).toThrow(/width/)
  })

  test('rejects a non-positive scale factor', () => {
    expect(() => toDeviceRect(rect, { zoom: 0, dpr: 1 })).toThrow(/zoom/)
    expect(() => toDeviceRect(rect, { zoom: 1, dpr: -2 })).toThrow(/dpr/)
  })
})

describe('the 18-cell zoom x DPR regression matrix (PRD FR-40)', () => {
  // Chrome's zoom stops, and the three DPRs we support.
  const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3] as const
  const DPRS = [1, 2, 3] as const

  for (const zoom of ZOOMS) {
    for (const dpr of DPRS) {
      test(`zoom ${zoom} x dpr ${dpr} lands within 1 device px of the exact product`, () => {
        const actual = toDeviceRect(rect, { zoom, dpr })
        const scale = zoom * dpr
        expect(Math.abs(actual.x - rect.x * scale)).toBeLessThanOrEqual(1)
        expect(Math.abs(actual.y - rect.y * scale)).toBeLessThanOrEqual(1)
        expect(Math.abs(actual.width - rect.width * scale)).toBeLessThanOrEqual(1)
        expect(Math.abs(actual.height - rect.height * scale)).toBeLessThanOrEqual(1)
      })
    }
  }
})

describe('assertScaleUnchanged', () => {
  test('passes when neither factor moved during the capture', () => {
    expect(() =>
      assertScaleUnchanged({ zoom: 1.5, dpr: 2 }, { zoom: 1.5, dpr: 2 }),
    ).not.toThrow()
  })

  test('aborts when the user zooms mid-capture', () => {
    expect(() => assertScaleUnchanged({ zoom: 1, dpr: 2 }, { zoom: 1.5, dpr: 2 })).toThrow(
      ScaleChangedError,
    )
  })

  test('aborts when the window is dragged to a display with different scaling', () => {
    // A 17-second stitch is long enough for this to happen in practice.
    expect(() => assertScaleUnchanged({ zoom: 1, dpr: 2 }, { zoom: 1, dpr: 1 })).toThrow(
      ScaleChangedError,
    )
  })

  test('names both factors in the error so the toast can explain itself', () => {
    try {
      assertScaleUnchanged({ zoom: 1, dpr: 2 }, { zoom: 1.5, dpr: 1 })
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ScaleChangedError)
      expect((e as ScaleChangedError).message).toMatch(/zoom/)
      expect((e as ScaleChangedError).message).toMatch(/dpr/)
    }
  })
})
