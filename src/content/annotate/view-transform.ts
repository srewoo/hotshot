import type { CssRect } from '../../shared/geometry/device-rect'
import type { AnnotationPoint } from './command-list'

/**
 * How the capture is displayed, and how screen coordinates come back (FR-2/FR-7).
 *
 * A full-page stitch is routinely three times the height of the viewport. The
 * editor's first version scaled it to fit BOTH axes, which showed a 2,400px
 * page at 27% — annotating that is placing a badge on a thumbnail. The rule
 * here is fit the WIDTH and scroll vertically, so ink lands where the user
 * aimed it, with an explicit fit-all for when they want the whole thing.
 *
 * Pure arithmetic, so every mapping is tested without a browser.
 */

export interface Size {
  readonly width: number
  readonly height: number
}

/** The subset of DOMRect this module needs. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4
/** One step is a noticeable but not disorienting jump. */
export const ZOOM_STEP = 1.25

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`)
  }
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/**
 * The default: fill the available width, never magnify past 1:1.
 *
 * Capping at 1 matters — upscaling a small crop to fill the stage would show
 * the user soft pixels that are not in their capture.
 */
export function fitWidthScale(image: Size, stage: Size): number {
  assertPositive('image.width', image.width)
  assertPositive('stage.width', stage.width)
  return clampZoom(Math.min(1, stage.width / image.width))
}

/**
 * Fit the whole capture, both axes. Bound to a key for "show me all of it".
 *
 * Bounded below by `MIN_ZOOM`: a 9,000px page would need 0.071x to fit a
 * 640px stage, which is a 45px strip — unreadable and un-annotatable. Past
 * the floor the capture keeps scrolling instead, which is the usable answer.
 */
export function fitAllScale(image: Size, stage: Size): number {
  assertPositive('image.height', image.height)
  assertPositive('stage.height', stage.height)
  return clampZoom(
    Math.min(fitWidthScale(image, stage), stage.height / image.height),
  )
}

export function zoomBy(scale: number, direction: 1 | -1): number {
  assertPositive('scale', scale)
  return clampZoom(direction === 1 ? scale * ZOOM_STEP : scale / ZOOM_STEP)
}

/**
 * A pointer position in canvas coordinates.
 *
 * Derived from the rendered box rather than from the scale factor, so it stays
 * correct while the stage is scrolled, zoomed, or both — the box already
 * accounts for all of it.
 */
export function canvasPointFrom(
  client: { readonly x: number; readonly y: number },
  box: Box,
  canvas: Size,
): AnnotationPoint {
  assertPositive('box.width', box.width)
  assertPositive('box.height', box.height)
  return {
    x: ((client.x - box.left) / box.width) * canvas.width,
    y: ((client.y - box.top) / box.height) * canvas.height,
  }
}

/** A canvas-space rect in viewport coordinates, for positioning DOM chrome. */
export function screenRectFrom(rect: CssRect, box: Box, canvas: Size): CssRect {
  assertPositive('canvas.width', canvas.width)
  assertPositive('canvas.height', canvas.height)
  const sx = box.width / canvas.width
  const sy = box.height / canvas.height
  return {
    x: box.left + rect.x * sx,
    y: box.top + rect.y * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  }
}

/**
 * A screen-space distance expressed in canvas pixels.
 *
 * This is the whole reason hit tolerance is a parameter: 6px of finger-slip is
 * 6 canvas px at 1:1 and 22 at 0.27×, and a fixed canvas tolerance makes a
 * long capture feel broken.
 */
export function toCanvasDistance(screenPx: number, box: Box, canvas: Size): number {
  assertPositive('box.width', box.width)
  return screenPx * (canvas.width / box.width)
}
