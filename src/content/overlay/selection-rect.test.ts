import { describe, expect, test } from 'vitest'
import { clampToViewport, moveBy, rectFromDrag, resizeBy, type Handle } from './selection-rect'

/**
 * PRD FR-1 / FR-34 / FR-35, DESIGN §3.1.
 *
 * Pure rect maths, deliberately separated from pointer and DOM handling so it
 * can be tested exhaustively without a browser. Every value here is in CSS
 * pixels; the conversion to device pixels happens once, later, in
 * `shared/geometry/device-rect`.
 */

const viewport = { width: 1280, height: 800 }

describe('rectFromDrag', () => {
  test('builds a rect when dragging down and to the right', () => {
    expect(rectFromDrag({ x: 100, y: 50 }, { x: 300, y: 250 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 200,
    })
  })

  test('normalises a drag up and to the left', () => {
    // Users drag from any corner; a negative-width rect is not a thing.
    expect(rectFromDrag({ x: 300, y: 250 }, { x: 100, y: 50 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 200,
    })
  })

  test('normalises a drag that crosses only one axis', () => {
    expect(rectFromDrag({ x: 300, y: 50 }, { x: 100, y: 250 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 200,
    })
  })

  test('yields a zero-size rect for a click without movement', () => {
    expect(rectFromDrag({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 0,
      height: 0,
    })
  })
})

describe('clampToViewport', () => {
  test('leaves a fully visible rect alone', () => {
    const r = { x: 100, y: 100, width: 200, height: 200 }
    expect(clampToViewport(r, viewport)).toEqual(r)
  })

  test('pulls a rect back inside the right and bottom edges', () => {
    const r = { x: 1200, y: 700, width: 200, height: 200 }
    expect(clampToViewport(r, viewport)).toEqual({
      x: 1200,
      y: 700,
      width: 80,
      height: 100,
    })
  })

  test('pulls a rect back inside the top and left edges', () => {
    const r = { x: -50, y: -30, width: 200, height: 200 }
    expect(clampToViewport(r, viewport)).toEqual({ x: 0, y: 0, width: 150, height: 170 })
  })

  test('collapses a rect entirely outside the viewport to zero size', () => {
    const r = { x: 2000, y: 2000, width: 100, height: 100 }
    const out = clampToViewport(r, viewport)
    expect(out.width).toBe(0)
    expect(out.height).toBe(0)
  })
})

describe('moveBy', () => {
  test('translates the rect without changing its size', () => {
    const r = { x: 100, y: 100, width: 200, height: 150 }
    expect(moveBy(r, 10, -20, viewport)).toEqual({ x: 110, y: 80, width: 200, height: 150 })
  })

  test('stops at the viewport edge instead of scrolling past it', () => {
    // FR-35: clamp, never autoscroll. Autoscroll-during-drag is the classic
    // cause of accidental 8,000px selections.
    const r = { x: 1000, y: 100, width: 280, height: 150 }
    expect(moveBy(r, 500, 0, viewport)).toEqual({ x: 1000, y: 100, width: 280, height: 150 })
  })

  test('stops at the top-left corner', () => {
    const r = { x: 5, y: 5, width: 100, height: 100 }
    expect(moveBy(r, -50, -50, viewport)).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  test('preserves size exactly when clamped, rather than shrinking', () => {
    const r = { x: 1200, y: 750, width: 80, height: 50 }
    const out = moveBy(r, 999, 999, viewport)
    expect(out.width).toBe(80)
    expect(out.height).toBe(50)
  })
})

describe('resizeBy', () => {
  test('drags the south-east handle outward', () => {
    const r = { x: 100, y: 100, width: 200, height: 200 }
    expect(resizeBy(r, 'se', 50, 30, viewport)).toEqual({
      x: 100,
      y: 100,
      width: 250,
      height: 230,
    })
  })

  test('drags the north-west handle, moving the origin', () => {
    const r = { x: 100, y: 100, width: 200, height: 200 }
    expect(resizeBy(r, 'nw', 50, 30, viewport)).toEqual({
      x: 150,
      y: 130,
      width: 150,
      height: 170,
    })
  })

  test('edge handles move one axis only', () => {
    const r = { x: 100, y: 100, width: 200, height: 200 }
    expect(resizeBy(r, 'e', 40, 999, viewport)).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 200,
    })
    expect(resizeBy(r, 'n', 999, 40, viewport)).toEqual({
      x: 100,
      y: 140,
      width: 200,
      height: 160,
    })
  })

  test('does not invert the rect when a handle is dragged past its opposite edge', () => {
    // Passing through zero must not produce a negative-size rect.
    const r = { x: 100, y: 100, width: 200, height: 200 }
    const out = resizeBy(r, 'se', -500, -500, viewport)
    expect(out.width).toBeGreaterThanOrEqual(0)
    expect(out.height).toBeGreaterThanOrEqual(0)
    expect(out.x).toBeLessThanOrEqual(r.x + r.width)
  })

  test('clamps a resize at the viewport edge', () => {
    const r = { x: 1000, y: 600, width: 200, height: 100 }
    const out = resizeBy(r, 'se', 500, 500, viewport)
    expect(out.x + out.width).toBeLessThanOrEqual(viewport.width)
    expect(out.y + out.height).toBeLessThanOrEqual(viewport.height)
  })

  test('every one of the eight handles is supported', () => {
    const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    const r = { x: 100, y: 100, width: 200, height: 200 }
    for (const h of handles) {
      expect(() => resizeBy(r, h, 10, 10, viewport), `handle ${h}`).not.toThrow()
    }
  })
})
