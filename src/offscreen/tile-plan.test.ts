import { describe, expect, test } from 'vitest'
import {
  CAPTURE_INTERVAL_MS,
  estimateDurationMs,
  planTiles,
  progressFrom,
} from './tile-plan'

/**
 * PRD FR-2 / FR-31 / review finding B3.
 *
 * `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` is 2, so the throttle is the
 * scheduler's DESIGN BASIS, not an error path. The published figures in PRD §6
 * are derived from exactly this maths.
 */

describe('planTiles', () => {
  test('plans a single tile for a page that fits the viewport', () => {
    expect(planTiles({ documentHeight: 800, viewportHeight: 800 })).toEqual([{ index: 0, scrollY: 0 }])
  })

  test('plans one tile per viewport for an exact multiple', () => {
    const tiles = planTiles({ documentHeight: 2400, viewportHeight: 800 })
    expect(tiles).toEqual([
      { index: 0, scrollY: 0 },
      { index: 1, scrollY: 800 },
      { index: 2, scrollY: 1600 },
    ])
  })

  test('adds a final tile for a partial remainder', () => {
    const tiles = planTiles({ documentHeight: 2000, viewportHeight: 800 })
    expect(tiles).toHaveLength(3)
    // The last tile is pinned to the document bottom rather than overscrolling,
    // so it overlaps the previous one instead of capturing blank space.
    expect(tiles[2]).toEqual({ index: 2, scrollY: 1200 })
  })

  test('never plans zero tiles for a non-empty page', () => {
    expect(planTiles({ documentHeight: 10, viewportHeight: 800 })).toHaveLength(1)
  })

  test('rejects a non-positive viewport rather than looping forever', () => {
    expect(() => planTiles({ documentHeight: 800, viewportHeight: 0 })).toThrow(/viewportHeight/)
  })

  test('plans 25 tiles for a 20,000px page at an 800px viewport', () => {
    expect(planTiles({ documentHeight: 20_000, viewportHeight: 800 })).toHaveLength(25)
  })
})

describe('estimateDurationMs', () => {
  test('uses the 500ms throttle interval as the basis', () => {
    expect(CAPTURE_INTERVAL_MS).toBe(500)
  })

  test('reproduces the published figure for an 8,000px page', () => {
    // PRD §6: ~7s, corrected from the original ~4s claim.
    const tiles = planTiles({ documentHeight: 8_000, viewportHeight: 800 })
    const ms = estimateDurationMs(tiles.length)
    expect(ms).toBeGreaterThanOrEqual(4_500)
    expect(ms).toBeLessThanOrEqual(7_500)
  })

  test('reproduces the published figure for a 20,000px page', () => {
    // PRD §6: ~17s.
    const tiles = planTiles({ documentHeight: 20_000, viewportHeight: 800 })
    const ms = estimateDurationMs(tiles.length)
    expect(ms).toBeGreaterThanOrEqual(12_000)
    expect(ms).toBeLessThanOrEqual(18_000)
  })

  test('charges no throttle wait for a single tile', () => {
    // The first capture is immediate; the interval is a gap BETWEEN calls.
    expect(estimateDurationMs(1)).toBeLessThan(CAPTURE_INTERVAL_MS)
  })
})

describe('progressFrom', () => {
  test('is determinate from tile zero', () => {
    // The total is known before the first capture, which is what makes the
    // progress bar honest rather than a spinner with numbers.
    const p = progressFrom({ captured: 0, total: 14, elapsedMs: 0 })
    expect(p.total).toBe(14)
    expect(p.captured).toBe(0)
  })

  test('estimates the remaining time from the MEASURED mean, not the theory', () => {
    // 4 tiles in 2,600ms => 650ms each; 10 remaining => ~6,500ms.
    const p = progressFrom({ captured: 4, total: 14, elapsedMs: 2_600 })
    expect(p.etaMs).toBeGreaterThan(6_000)
    expect(p.etaMs).toBeLessThan(7_000)
  })

  test('falls back to the theoretical interval before any tile completes', () => {
    const p = progressFrom({ captured: 0, total: 10, elapsedMs: 0 })
    expect(p.etaMs).toBe(10 * CAPTURE_INTERVAL_MS)
  })

  test('reports zero remaining when every tile is captured', () => {
    expect(progressFrom({ captured: 14, total: 14, elapsedMs: 7_000 }).etaMs).toBe(0)
  })

  test('rounds the estimate to half a second, matching the UI', () => {
    // DESIGN §6.1 shows a `~`-prefixed estimate; sub-second churn reads as
    // instability rather than precision.
    const p = progressFrom({ captured: 3, total: 20, elapsedMs: 1_900 })
    expect(p.etaMs % 500).toBe(0)
  })

  test('never reports a negative estimate', () => {
    expect(progressFrom({ captured: 20, total: 14, elapsedMs: 9_000 }).etaMs).toBe(0)
  })
})
