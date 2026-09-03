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
    expect(planTiles({ documentHeight: 800, viewportHeight: 800 })).toEqual([
      { index: 0, scrollY: 0, offsetCssPx: 0 },
    ])
  })

  test('plans one tile per viewport for an exact multiple', () => {
    const tiles = planTiles({ documentHeight: 2400, viewportHeight: 800 })
    expect(tiles).toEqual([
      { index: 0, scrollY: 0, offsetCssPx: 0 },
      { index: 1, scrollY: 800, offsetCssPx: 800 },
      { index: 2, scrollY: 1600, offsetCssPx: 1600 },
    ])
  })

  test('adds a final tile for a partial remainder', () => {
    const tiles = planTiles({ documentHeight: 2000, viewportHeight: 800 })
    expect(tiles).toHaveLength(3)
    // The last tile is pinned to the document bottom rather than overscrolling,
    // so it overlaps the previous one instead of capturing blank space.
    expect(tiles[2]).toEqual({ index: 2, scrollY: 1200, offsetCssPx: 1200 })
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

describe('planTiles over a bounded band (FR-5)', () => {
  test('captures only the band, not the whole document', () => {
    // A 3,000px element starting 5,000px down a 20,000px page.
    const tiles = planTiles({
      documentHeight: 20_000,
      viewportHeight: 1_000,
      band: { top: 5_000, height: 3_000 },
    })
    expect(tiles).toHaveLength(3)
    expect(tiles.map((t) => t.scrollY)).toEqual([5_000, 6_000, 7_000])
  })

  test('offsets are relative to the band, so the stitch starts at its top', () => {
    const tiles = planTiles({
      documentHeight: 20_000,
      viewportHeight: 1_000,
      band: { top: 5_000, height: 3_000 },
    })
    expect(tiles.map((t) => t.offsetCssPx)).toEqual([0, 1_000, 2_000])
  })

  test('a band shorter than the viewport is a single tile', () => {
    const tiles = planTiles({
      documentHeight: 9_000,
      viewportHeight: 800,
      band: { top: 400, height: 300 },
    })
    expect(tiles).toEqual([{ index: 0, scrollY: 400, offsetCssPx: 0 }])
  })

  /**
   * The case that makes negative offsets necessary. A band at the very bottom
   * of a page cannot be scrolled to its own top — the page runs out of scroll
   * — so the tile contains content ABOVE the band, and the stitcher clips it
   * by drawing at a negative offset instead of misaligning the whole capture.
   */
  test('a band against the page bottom clips from above rather than misaligning', () => {
    const tiles = planTiles({
      documentHeight: 2_000,
      viewportHeight: 800,
      band: { top: 1_500, height: 500 },
    })
    expect(tiles).toEqual([{ index: 0, scrollY: 1_200, offsetCssPx: -300 }])
  })

  test('later tiles of a band at the bottom clamp to the maximum scroll', () => {
    const tiles = planTiles({
      documentHeight: 3_000,
      viewportHeight: 1_000,
      band: { top: 1_800, height: 1_200 },
    })
    expect(tiles.map((t) => t.scrollY)).toEqual([1_800, 2_000])
    expect(tiles.map((t) => t.offsetCssPx)).toEqual([0, 200])
  })

  test('an omitted band is exactly the old whole-document behaviour', () => {
    const metrics = { documentHeight: 8_000, viewportHeight: 800 }
    const whole = planTiles(metrics)
    const explicit = planTiles({ ...metrics, band: { top: 0, height: 8_000 } })
    expect(explicit).toEqual(whole)
    expect(whole.every((t) => t.offsetCssPx === t.scrollY)).toBe(true)
  })

  test('every tile of a band covers it end to end, with no gap', () => {
    const viewportHeight = 700
    const band = { top: 2_345, height: 2_600 }
    const tiles = planTiles({ documentHeight: 40_000, viewportHeight, band })
    // Each tile must start no lower than the previous tile's bottom edge.
    for (const [i, tile] of tiles.entries()) {
      if (i === 0) continue
      const previousBottom = (tiles[i - 1] as { offsetCssPx: number }).offsetCssPx + viewportHeight
      expect(tile.offsetCssPx).toBeLessThanOrEqual(previousBottom)
    }
    const last = tiles[tiles.length - 1] as { offsetCssPx: number }
    expect(last.offsetCssPx + viewportHeight).toBeGreaterThanOrEqual(band.height)
  })

  test.each([
    [{ top: -1, height: 100 }, 'top'],
    [{ top: 0, height: 0 }, 'height'],
    [{ top: 0, height: -5 }, 'height'],
    [{ top: Number.NaN, height: 100 }, 'top'],
    [{ top: 0, height: Number.POSITIVE_INFINITY }, 'height'],
  ])('refuses a nonsense band %j', (band, field) => {
    expect(() => planTiles({ documentHeight: 9_000, viewportHeight: 800, band })).toThrow(
      new RegExp(field),
    )
  })
})
