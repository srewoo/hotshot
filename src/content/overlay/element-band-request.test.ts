import { describe, expect, test } from 'vitest'
import { bandFor, needsScrollCapture, reportedSize } from './element-band-request'

const viewport = { width: 1_200, height: 800 }

describe('needsScrollCapture', () => {
  test('an element inside the viewport takes the fast path', () => {
    expect(needsScrollCapture({ x: 10, y: 10, width: 400, height: 300 }, viewport)).toBe(false)
  })

  test('an element running past the bottom needs scrolling', () => {
    expect(needsScrollCapture({ x: 0, y: 100, width: 400, height: 2_400 }, viewport)).toBe(true)
  })

  test('an element starting above the viewport needs scrolling', () => {
    expect(needsScrollCapture({ x: 0, y: -300, width: 400, height: 500 }, viewport)).toBe(true)
  })

  test('an element exactly filling the viewport does not', () => {
    expect(needsScrollCapture({ x: 0, y: 0, width: 1_200, height: 800 }, viewport)).toBe(false)
  })

  /**
   * A fractional layout must not send a viewport-sized element down the much
   * slower scrolling path for a third of a pixel.
   */
  test('tolerates sub-pixel overflow', () => {
    expect(needsScrollCapture({ x: 0, y: 0, width: 100, height: 800.3 }, viewport)).toBe(false)
    expect(needsScrollCapture({ x: 0, y: -0.3, width: 100, height: 100 }, viewport)).toBe(false)
  })
})

describe('bandFor', () => {
  test('converts a viewport rect into a document band', () => {
    expect(bandFor({ x: 280, y: 100, width: 640, height: 2_400 }, viewport, 500)).toEqual({
      top: 600,
      left: 280,
      width: 640,
      height: 2_400,
    })
  })

  test('an element scrolled above the viewport still gets a positive top', () => {
    const band = bandFor({ x: 0, y: -400, width: 400, height: 900 }, viewport, 1_000)
    expect(band?.top).toBe(600)
  })

  test('never asks for a negative document offset', () => {
    expect(bandFor({ x: 0, y: -900, width: 400, height: 900 }, viewport, 100)?.top).toBe(0)
  })

  /** This pipeline does not scroll sideways, so it must not ask for pixels off-screen. */
  test('clamps an element starting left of the viewport', () => {
    const band = bandFor({ x: -100, y: 0, width: 500, height: 900 }, viewport, 0)
    expect(band?.left).toBe(0)
  })

  test('clamps an element wider than the viewport', () => {
    const band = bandFor({ x: 200, y: 0, width: 4_000, height: 900 }, viewport, 0)
    expect(band?.width).toBe(1_000)
  })

  test('refuses an element entirely off-screen horizontally', () => {
    expect(bandFor({ x: 1_400, y: 0, width: 200, height: 900 }, viewport, 0)).toBeNull()
  })
})

describe('reportedSize', () => {
  /**
   * The readout reports the ELEMENT. Showing the visible sliver would be
   * quietly lying about what is going to be captured.
   */
  test('reports the element size, not the visible part', () => {
    expect(reportedSize({ x: 0, y: 100, width: 640, height: 2_400 }, viewport)).toEqual({
      width: 640,
      height: 2_400,
      willScroll: true,
    })
  })

  test('marks a viewport-sized element as not scrolling', () => {
    expect(reportedSize({ x: 0, y: 10, width: 400, height: 300 }, viewport).willScroll).toBe(false)
  })
})
