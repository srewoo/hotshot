import { describe, expect, test } from 'vitest'
import {
  COLLAPSE_BELOW_PX,
  MAX_PINS_PER_TAB,
  OPACITY_CYCLE,
  cascadeOrigin,
  clampPinSize,
  displayFormFor,
  nextOpacity,
  pinMemoryBytes,
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
