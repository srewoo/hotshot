/**
 * Full-page capture scheduling (PRD FR-2, FR-31 · review finding B3).
 *
 * Chrome caps `captureVisibleTab` at 2 calls per second. That throttle is this
 * scheduler's DESIGN BASIS, not an error path — the original PRD priced it as
 * non-binding and published a ≤4s figure for an 8,000px page that was off by
 * roughly a factor of two. Everything here derives from the real interval, and
 * the published §6 figures are these functions' output.
 */

/** 2 calls/second, expressed as the mandatory gap between them. */
export const CAPTURE_INTERVAL_MS = 500

/**
 * Time allowed for lazy content to settle after a scroll. It runs INSIDE the
 * throttle gap (250 + ~120 < 500), so it costs nothing additional — the
 * correction to the reviewer's otherwise-correct arithmetic.
 */
export const SETTLE_MS = 250

export interface Tile {
  readonly index: number
  readonly scrollY: number
  /**
   * Where this tile's top edge belongs on the stitch canvas, in CSS px.
   *
   * Zero for a full-page capture. For a bounded region it can be NEGATIVE:
   * when the region starts below the page's maximum scroll offset, the tile
   * necessarily includes content above the region, and the stitcher clips it
   * by drawing at a negative offset.
   */
  readonly offsetCssPx: number
}

/**
 * A vertical band of the document to capture, in CSS px from its top.
 *
 * Bounding the stitch is what makes FR-5 possible: an element taller than the
 * viewport is the same scroll-and-stitch pipeline, stopped at the element's
 * own box instead of the document's.
 */
export interface CaptureBand {
  readonly top: number
  readonly height: number
}

export interface PageMetrics {
  readonly documentHeight: number
  readonly viewportHeight: number
  /** Defaults to the whole document. */
  readonly band?: CaptureBand | undefined
}

export interface ProgressInput {
  readonly captured: number
  readonly total: number
  readonly elapsedMs: number
}

export interface Progress {
  readonly captured: number
  readonly total: number
  readonly etaMs: number
}

export function planTiles({ documentHeight, viewportHeight, band }: PageMetrics): Tile[] {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new RangeError(`viewportHeight must be a positive finite number, got ${viewportHeight}`)
  }

  const top = band ? band.top : 0
  const height = band ? band.height : documentHeight
  if (!Number.isFinite(top) || top < 0) {
    throw new RangeError(`band.top must be a non-negative finite number, got ${top}`)
  }
  if (!Number.isFinite(height) || height <= 0) {
    throw new RangeError(`band.height must be a positive finite number, got ${height}`)
  }

  const count = Math.max(1, Math.ceil(height / viewportHeight))
  const maxScroll = Math.max(0, documentHeight - viewportHeight)

  return Array.from({ length: count }, (_, index) => {
    // The last tile is pinned rather than overscrolling: it overlaps its
    // predecessor, which the stitcher paints over — capturing blank space
    // below the content would be worse.
    const scrollY = Math.min(top + index * viewportHeight, maxScroll)
    return { index, scrollY, offsetCssPx: scrollY - top }
  })
}

/** Wall-clock estimate. The first capture is immediate; the gap is between calls. */
export function estimateDurationMs(tileCount: number): number {
  if (tileCount <= 0) return 0
  return (tileCount - 1) * CAPTURE_INTERVAL_MS
}

/** Rounded to half a second: sub-second churn reads as instability. */
function roundToHalfSecond(ms: number): number {
  return Math.round(ms / 500) * 500
}

export function progressFrom({ captured, total, elapsedMs }: ProgressInput): Progress {
  const remaining = Math.max(0, total - captured)

  if (remaining === 0) return { captured, total, etaMs: 0 }

  // Before any tile completes there is nothing measured, so fall back to the
  // theoretical interval. After that, trust what the page is actually doing —
  // a lazy-loading page is slower than theory and the user deserves the truth.
  if (captured === 0 || elapsedMs <= 0) {
    return { captured, total, etaMs: remaining * CAPTURE_INTERVAL_MS }
  }

  const meanMs = elapsedMs / captured
  return { captured, total, etaMs: roundToHalfSecond(remaining * meanMs) }
}
