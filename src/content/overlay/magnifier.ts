import type { CssRect, ScaleFactors } from '../../shared/geometry/device-rect'
import type { Point, Viewport } from './selection-rect'

/**
 * The loupe (DESIGN §3.1, PRD FR-1 · review finding B2).
 *
 * Reads from the FROZEN backdrop — the same bitmap the crop is cut from — so
 * what the user places the edge against is literally what gets captured. That
 * shared bitmap is why taking the capture eagerly at overlay-open pays for
 * itself: one API call buys the magnifier, the frozen backdrop, and the crop.
 */

export const LOUPE_PX = 132
export const LOUPE_ZOOM = 12
/** 11 × 12 = 132, so the neighbourhood fills the loupe exactly. */
export const SOURCE_SPAN_PX = 11

const GAP = 18

/**
 * The source neighbourhood in DEVICE pixels.
 *
 * Sampling CSS pixels would magnify an already-interpolated image — the exact
 * blur a loupe exists to eliminate.
 */
export function sourceRectFor(cursor: Point, scale: ScaleFactors): CssRect {
  const factor = scale.zoom * scale.dpr
  const half = Math.floor(SOURCE_SPAN_PX / 2)
  return {
    x: Math.max(0, Math.round(cursor.x * factor) - half),
    y: Math.max(0, Math.round(cursor.y * factor) - half),
    width: SOURCE_SPAN_PX,
    height: SOURCE_SPAN_PX,
  }
}

/**
 * Where to put the loupe so it stays on screen and never covers the cursor —
 * a loupe under the pointer hides the very pixel being placed.
 */
export function loupePlacement(cursor: Point, viewport: Viewport): Point {
  const fitsRight = cursor.x + GAP + LOUPE_PX <= viewport.width
  const fitsBelow = cursor.y + GAP + LOUPE_PX <= viewport.height

  const x = fitsRight ? cursor.x + GAP : cursor.x - GAP - LOUPE_PX
  const y = fitsBelow ? cursor.y + GAP : cursor.y - GAP - LOUPE_PX

  return {
    x: Math.min(Math.max(0, x), Math.max(0, viewport.width - LOUPE_PX)),
    y: Math.min(Math.max(0, y), Math.max(0, viewport.height - LOUPE_PX)),
  }
}
