import type { Viewport } from './selection-rect'
import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * Deciding how a hovered element gets captured (PRD FR-3, FR-5).
 *
 * The pure half of the choice: whether an element fits in the viewport, and if
 * it does not, what band of the document the worker should scroll and stitch.
 *
 * It is separated because clamping used to happen too early. The picker
 * clamped every candidate to the viewport before anything else saw it, which
 * is precisely why element capture could only ever return the visible sliver
 * of a long table — the true rect was thrown away before the decision was
 * made.
 */

/** True when the element runs past the top or bottom of the viewport. */
export function needsScrollCapture(rect: CssRect, viewport: Viewport): boolean {
  // A half-pixel tolerance: a fractional layout should not send a
  // viewport-sized element down the much slower scrolling path.
  return rect.y < -0.5 || rect.y + rect.height > viewport.height + 0.5
}

export interface ElementBand {
  /** CSS px from the document's top, so it survives the scrolling. */
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

/**
 * The band to ask the worker for, or null when there are no pixels to get.
 *
 * Only ever asks for pixels that can exist: nothing left of the viewport, and
 * nothing wider than it, since this pipeline does not scroll sideways.
 */
export function bandFor(
  rect: CssRect,
  viewport: Viewport,
  scrollY: number,
): ElementBand | null {
  const left = Math.max(0, rect.x)
  const width = Math.min(rect.width, viewport.width - left)
  if (width <= 0) return null

  return {
    top: Math.max(0, rect.y + scrollY),
    left,
    width,
    height: rect.height,
  }
}

/** What the readout should report for a hovered element. */
export function reportedSize(
  rect: CssRect,
  viewport: Viewport,
): { readonly width: number; readonly height: number; readonly willScroll: boolean } {
  // The ELEMENT, not the sliver of it on screen: a readout that showed 380
  // for a 2,400px table would be quietly lying about what it is about to
  // capture.
  return { width: rect.width, height: rect.height, willScroll: needsScrollCapture(rect, viewport) }
}
