import { describe, expect, test } from 'vitest'
import { maxCapturableCssHeight } from './canvas-limits'

/**
 * Chrome's canvas backing store has two independent hard caps:
 *   - 65,535 device px on either axis
 *   - 268,435,456 device px total area (16,384²)
 *
 * PRD FR-43 / review finding B4: the original guard was expressed in CSS
 * pixels and would not have fired until 30,000 px, handing the user a
 * silently non-rendering canvas on an ordinary display.
 *
 * The table below is the one published in PRD §6.
 */
describe('maxCapturableCssHeight', () => {
  test('is bounded by the per-axis cap on a narrow viewport at DPR 1', () => {
    expect(maxCapturableCssHeight({ cssWidth: 1280, dpr: 1 })).toBe(65_535)
  })

  test('halves with DPR because the cap is in device pixels', () => {
    expect(maxCapturableCssHeight({ cssWidth: 1280, dpr: 2 })).toBe(32_767)
  })

  test('is bounded by the AREA cap on a wide viewport at DPR 2', () => {
    // 2560 × 2 = 5120 device px wide; 268_435_456 / 5120 = 52_428 device px
    // tall; ÷ 2 = 26_214 CSS px. Below the per-axis cap, so area governs.
    expect(maxCapturableCssHeight({ cssWidth: 2560, dpr: 2 })).toBe(26_214)
  })

  test('collapses to a normal article length on a 27-inch display at DPR 3', () => {
    // The case that matters: 11_650 CSS px, where the old CSS-pixel guard
    // would not have fired until 30_000.
    expect(maxCapturableCssHeight({ cssWidth: 2560, dpr: 3 })).toBe(11_650)
  })

  test('rejects a non-finite or non-positive viewport width', () => {
    expect(() => maxCapturableCssHeight({ cssWidth: 0, dpr: 1 })).toThrow(
      /cssWidth/,
    )
    expect(() => maxCapturableCssHeight({ cssWidth: Number.NaN, dpr: 1 })).toThrow(
      /cssWidth/,
    )
  })

  test('rejects a non-positive device pixel ratio', () => {
    expect(() => maxCapturableCssHeight({ cssWidth: 1280, dpr: 0 })).toThrow(/dpr/)
  })

  test('refuses outright when the viewport width alone breaks the axis cap', () => {
    // 25_000 × 3 = 75_000 device px wide, past the 65_535 axis cap. No height
    // is possible, so this is a refusal rather than a very small number.
    expect(maxCapturableCssHeight({ cssWidth: 25_000, dpr: 3 })).toBe(0)
  })

  test('still permits a short capture on an absurdly wide viewport', () => {
    // 20_000 × 3 = 60_000 device px wide: under the axis cap, and the area cap
    // leaves room for 4_473 device rows — a real, if small, answer.
    expect(maxCapturableCssHeight({ cssWidth: 20_000, dpr: 3 })).toBe(1_491)
  })
})
