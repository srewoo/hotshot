import { describe, expect, test } from 'vitest'
import {
  COLLAPSE_BELOW_PX,
  MAX_PINS_PER_TAB,
  MAX_SCALE,
  MIN_SCALE,
  OPACITY_CYCLE,
  cascadeOrigin,
  clampPinPosition,
  clampPinSize,
  displayFormFor,
  mipmapChain,
  nextOpacity,
  pinMemoryBytes,
  pinNumbers,
  resizePinFromCorner,
  restack,
  snapPinPosition,
  withinMemoryBudget,
} from './pin-layout'

/**
 * PRD FR-37 / FR-38, DESIGN §3.9.
 *
 * The pin is persistent furniture on someone else's page, so its geometry
 * rules are what stop it becoming either useless or hostile.
 */

describe('cascade', () => {
  test('offsets each pin by 24px so they stay distinguishable', () => {
    expect(cascadeOrigin(0)).toEqual({ x: 24, y: 24 })
    expect(cascadeOrigin(1)).toEqual({ x: 48, y: 48 })
    expect(cascadeOrigin(2)).toEqual({ x: 72, y: 72 })
  })

  test('caps the number of pins per tab', () => {
    expect(MAX_PINS_PER_TAB).toBe(4)
  })
})

describe('opacity cycling', () => {
  test('cycles 100 -> 75 -> 50 -> 25 -> 100', () => {
    expect(OPACITY_CYCLE).toEqual([1, 0.75, 0.5, 0.25])
    expect(nextOpacity(1)).toBe(0.75)
    expect(nextOpacity(0.75)).toBe(0.5)
    expect(nextOpacity(0.5)).toBe(0.25)
    expect(nextOpacity(0.25)).toBe(1)
  })

  test('recovers from an unrecognised value rather than sticking', () => {
    expect(nextOpacity(0.42)).toBe(1)
  })
})

describe('size clamping', () => {
  test('allows scaling between 25% and 200%', () => {
    const natural = { width: 400, height: 300 }
    expect(clampPinSize(natural, 0.25)).toEqual({ width: 100, height: 75 })
    expect(clampPinSize(natural, 2)).toEqual({ width: 800, height: 600 })
  })

  test('refuses to scale beyond the permitted range', () => {
    const natural = { width: 400, height: 300 }
    expect(clampPinSize(natural, 5)).toEqual({ width: 800, height: 600 })
    expect(clampPinSize(natural, 0.01)).toEqual({ width: 100, height: 75 })
  })

  test('always preserves aspect ratio', () => {
    // DESIGN §3.9: aspect is always locked; shift-drag crops instead of
    // distorting, because a distorted screenshot is a false document.
    const natural = { width: 1000, height: 250 }
    const scaled = clampPinSize(natural, 0.5)
    expect(scaled.width / scaled.height).toBeCloseTo(natural.width / natural.height, 5)
  })
})

describe('display form', () => {
  test('renders as a plate at a normal size', () => {
    expect(displayFormFor({ width: 400, height: 300 })).toBe('plate')
  })

  test('collapses to a chip below the legibility threshold', () => {
    // Hotshot refuses to render an illegible smear and changes form to say so.
    expect(COLLAPSE_BELOW_PX).toBe(96)
    expect(displayFormFor({ width: 80, height: 300 })).toBe('chip')
    expect(displayFormFor({ width: 400, height: 60 })).toBe('chip')
  })

  test('treats the threshold as inclusive of the plate form', () => {
    expect(displayFormFor({ width: 96, height: 96 })).toBe('plate')
  })
})

describe('memory budget (FR-38)', () => {
  test('charges 4 bytes per device pixel', () => {
    expect(pinMemoryBytes({ width: 100, height: 100 }, 1)).toBe(40_000)
  })

  test('scales with device pixel ratio, which is where the cost actually is', () => {
    expect(pinMemoryBytes({ width: 100, height: 100 }, 2)).toBe(160_000)
  })

  test('accepts four pins at the capped display size', () => {
    // FR-38 caps the display bitmap at a 2,000px long edge => ~16MB per pin.
    const capped = { width: 2_000, height: 2_000 }
    const pins = Array.from({ length: 4 }, () => capped)
    expect(withinMemoryBudget(pins, 1)).toBe(true)
  })

  test('refuses a fifth pin that would breach the 64MB per-tab ceiling', () => {
    const capped = { width: 2_000, height: 2_000 }
    const pins = Array.from({ length: 5 }, () => capped)
    expect(withinMemoryBudget(pins, 1)).toBe(false)
  })

  test('refuses retina pins that would breach the ceiling in half the count', () => {
    // A renderer OOM presents to users as "Chrome crashed", so the cap is a
    // tested hard limit rather than an aspiration (R-10).
    const capped = { width: 2_000, height: 2_000 }
    expect(withinMemoryBudget([capped, capped, capped], 2)).toBe(false)
  })
})

describe('clampPinPosition', () => {
  const viewport = { width: 1200, height: 800 }
  const rect = { x: 0, y: 0, width: 400, height: 300 }

  test('leaves a pin inside the viewport alone', () => {
    expect(clampPinPosition({ ...rect, x: 100, y: 100 }, viewport)).toEqual({ x: 100, y: 100 })
  })

  /**
   * A pin has no entry in any list, so one dragged off-screen is furniture the
   * user cannot get back. A grabbable strip always stays reachable.
   */
  test('keeps a grabbable strip on screen when dragged right', () => {
    const clamped = clampPinPosition({ ...rect, x: 5_000, y: 10 }, viewport)
    expect(clamped.x).toBeLessThanOrEqual(viewport.width - 32)
  })

  test('keeps a strip on screen when dragged past the bottom', () => {
    const clamped = clampPinPosition({ ...rect, x: 10, y: 5_000 }, viewport)
    expect(clamped.y).toBeLessThanOrEqual(viewport.height - 32)
  })

  test('never lets a pin above the top, where the drag handle would be lost', () => {
    expect(clampPinPosition({ ...rect, x: 10, y: -500 }, viewport).y).toBe(0)
  })

  test('allows a deliberate overhang to the left, keeping a strip visible', () => {
    const clamped = clampPinPosition({ ...rect, x: -5_000, y: 10 }, viewport)
    expect(clamped.x).toBe(32 - rect.width)
    expect(clamped.x + rect.width).toBe(32)
  })

  test('handles a viewport smaller than the minimum visible strip', () => {
    const clamped = clampPinPosition({ ...rect, x: 900, y: 900 }, { width: 20, height: 20 })
    expect(Number.isFinite(clamped.x) && Number.isFinite(clamped.y)).toBe(true)
    expect(clamped.x).toBeGreaterThanOrEqual(32 - rect.width)
  })
})

describe('snapPinPosition', () => {
  const viewport = { width: 1200, height: 800 }
  const size = { width: 400, height: 300 }

  test('snaps to the left and top edges', () => {
    expect(snapPinPosition({ ...size, x: 6, y: 4 }, viewport)).toEqual({ x: 0, y: 0 })
  })

  test('snaps to the right and bottom edges', () => {
    expect(snapPinPosition({ ...size, x: 795, y: 495 }, viewport)).toEqual({ x: 800, y: 500 })
  })

  test('snaps to the centre lines', () => {
    expect(snapPinPosition({ ...size, x: 402, y: 248 }, viewport)).toEqual({ x: 400, y: 250 })
  })

  /**
   * Snapping at a distance is worse than not snapping: a pin that leaps to a
   * guide the user cannot see feels broken.
   */
  test('does nothing outside the threshold', () => {
    expect(snapPinPosition({ ...size, x: 120, y: 140 }, viewport)).toEqual({ x: 120, y: 140 })
  })

  test('prefers the nearer edge when both are in range on a tiny viewport', () => {
    // 40px-wide viewport, 30px pin: both edges within threshold.
    const snapped = snapPinPosition({ x: 4, y: 0, width: 30, height: 10 }, { width: 40, height: 10 })
    expect(snapped.x).toBe(0)
  })

  test('honours a custom threshold', () => {
    expect(snapPinPosition({ ...size, x: 20, y: 20 }, viewport, 4)).toEqual({ x: 20, y: 20 })
    expect(snapPinPosition({ ...size, x: 20, y: 20 }, viewport, 24)).toEqual({ x: 0, y: 0 })
  })
})

describe('resizePinFromCorner', () => {
  const natural = { width: 800, height: 600 }
  const rect = { x: 100, y: 100, width: 400, height: 300 }

  test('preserves the aspect ratio when growing', () => {
    const next = resizePinFromCorner(rect, natural, 'se', 200, 0)
    expect(next.width / next.height).toBeCloseTo(natural.width / natural.height, 2)
  })

  test('the south-east corner grows away from the origin', () => {
    const next = resizePinFromCorner(rect, natural, 'se', 200, 0)
    expect(next.x).toBe(100)
    expect(next.y).toBe(100)
    expect(next.width).toBeGreaterThan(rect.width)
  })

  /**
   * Anchoring matters: without it, dragging the north-west handle appears to
   * walk the pin across the screen instead of resizing it in place.
   */
  test('the north-west corner anchors the opposite corner', () => {
    const next = resizePinFromCorner(rect, natural, 'nw', -200, 0)
    expect(next.x + next.width).toBe(rect.x + rect.width)
    expect(next.y + next.height).toBe(rect.y + rect.height)
    expect(next.width).toBeGreaterThan(rect.width)
  })

  test('the north-east corner anchors the bottom-left', () => {
    const next = resizePinFromCorner(rect, natural, 'ne', 200, 0)
    expect(next.x).toBe(rect.x)
    expect(next.y + next.height).toBe(rect.y + rect.height)
  })

  test('the south-west corner anchors the top-right', () => {
    const next = resizePinFromCorner(rect, natural, 'sw', -200, 0)
    expect(next.x + next.width).toBe(rect.x + rect.width)
    expect(next.y).toBe(rect.y)
  })

  test('a vertical drag resizes too, rather than feeling dead', () => {
    const next = resizePinFromCorner(rect, natural, 'se', 0, 150)
    expect(next.height).toBeGreaterThan(rect.height)
    expect(next.width / next.height).toBeCloseTo(natural.width / natural.height, 2)
  })

  test('clamps against the capture at MAX_SCALE, however many drags', () => {
    let next = rect
    for (let i = 0; i < 20; i++) next = resizePinFromCorner(next, natural, 'se', 500, 500)
    expect(next.width).toBeLessThanOrEqual(natural.width * MAX_SCALE)
  })

  test('clamps at MIN_SCALE rather than inverting', () => {
    let next = rect
    for (let i = 0; i < 20; i++) next = resizePinFromCorner(next, natural, 'se', -500, -500)
    expect(next.width).toBeGreaterThanOrEqual(natural.width * MIN_SCALE)
    expect(next.height).toBeGreaterThan(0)
  })

  test('a degenerate capture returns the rect untouched instead of NaN', () => {
    expect(resizePinFromCorner(rect, { width: 0, height: 0 }, 'se', 50, 50)).toEqual(rect)
  })
})

describe('mipmapChain', () => {
  test('is a single step when the capture is already near the target', () => {
    expect(mipmapChain({ width: 500, height: 400 }, { width: 400, height: 320 })).toEqual([
      { width: 400, height: 320 },
    ])
  })

  /**
   * The reason this exists: one bilinear draw from 2,400px to 300px samples
   * an eighth of the source and turns text into grey mush.
   */
  test('halves repeatedly for a big reduction, ending exactly at the target', () => {
    const chain = mipmapChain({ width: 2_400, height: 1_800 }, { width: 300, height: 225 })
    expect(chain.length).toBeGreaterThan(1)
    expect(chain[chain.length - 1]).toEqual({ width: 300, height: 225 })
  })

  test('every step is smaller than the last, and none below the target', () => {
    const target = { width: 300, height: 225 }
    const chain = mipmapChain({ width: 2_400, height: 1_800 }, target)
    let previous = { width: 2_400, height: 1_800 }
    for (const step of chain) {
      expect(step.width).toBeLessThanOrEqual(previous.width)
      expect(step.width).toBeGreaterThanOrEqual(target.width)
      previous = step
    }
  })

  test('never upscales: a target larger than the capture is one step', () => {
    expect(mipmapChain({ width: 100, height: 100 }, { width: 400, height: 400 })).toEqual([
      { width: 400, height: 400 },
    ])
  })

  test('a zero target produces no work rather than an infinite loop', () => {
    expect(mipmapChain({ width: 800, height: 600 }, { width: 0, height: 0 })).toEqual([])
  })
})

describe('restack', () => {
  const order = ['a', 'b', 'c', 'd']

  test('forward moves one place towards the front', () => {
    expect(restack(order, 'b', 'forward')).toEqual(['a', 'c', 'b', 'd'])
  })

  test('backward moves one place towards the back', () => {
    expect(restack(order, 'c', 'backward')).toEqual(['a', 'c', 'b', 'd'])
  })

  test('front and back jump the whole way', () => {
    expect(restack(order, 'a', 'front')).toEqual(['b', 'c', 'd', 'a'])
    expect(restack(order, 'd', 'back')).toEqual(['d', 'a', 'b', 'c'])
  })

  test('the frontmost pin cannot go further forward', () => {
    expect(restack(order, 'd', 'forward')).toEqual(order)
  })

  test('the backmost pin cannot go further back', () => {
    expect(restack(order, 'a', 'backward')).toEqual(order)
  })

  test('an unknown id leaves the order alone rather than joining it', () => {
    expect(restack(order, 'ghost', 'front')).toEqual(order)
  })

  test('does not mutate the input', () => {
    const original = [...order]
    restack(order, 'a', 'front')
    expect(order).toEqual(original)
  })
})

describe('pinNumbers', () => {
  test('numbers from one, in stack order', () => {
    expect(pinNumbers(['a', 'b', 'c'])).toEqual({ a: 1, b: 2, c: 3 })
  })

  test('renumbers after a dismissal, leaving no gap', () => {
    expect(pinNumbers(['a', 'c'])).toEqual({ a: 1, c: 2 })
  })

  test('an empty stack has no numbers', () => {
    expect(pinNumbers([])).toEqual({})
  })
})
