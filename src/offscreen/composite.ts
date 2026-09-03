import { maxCapturableCssHeight } from '../shared/geometry/canvas-limits'

/**
 * Compositing tiles onto one canvas (PRD FR-2, FR-5, FR-43).
 *
 * Extracted from the offscreen document's message plumbing so the geometry can
 * be driven directly by a test. It is the part that is easy to get subtly
 * wrong and impossible to eyeball: a bounded element capture composites tiles
 * at a NEGATIVE vertical offset (when the band cannot be scrolled to its own
 * top) and at a negative horizontal one (to crop the element out of the
 * viewport-wide tile), and either sign inverted yields a plausible-looking
 * image of the wrong thing.
 */

export interface CompositorSpec {
  /** Canvas width: the viewport for a page, the element's box for FR-5. */
  readonly widthDevicePx: number
  readonly totalHeightDevicePx: number
  /** The canvas width in CSS px, which is what the canvas guard is about. */
  readonly cssWidth: number
  readonly dpr: number
  /** Left edge of the crop within each tile, in device px. Default 0. */
  readonly originXDevicePx?: number
}

export interface Compositor {
  /** `offsetDevicePx` may be negative; the canvas clips what falls outside. */
  addTile(tile: ImageBitmap, offsetDevicePx: number): void
  finish(): Promise<Blob>
  readonly width: number
  readonly height: number
}

export function assertWithinCanvasLimits(spec: CompositorSpec): void {
  // Refuse BEFORE allocating, in device pixels against both Chrome caps. A
  // canvas past the limit does not throw — it silently fails to render, which
  // the user would only discover by looking at a blank PNG.
  const maxCss = maxCapturableCssHeight({ cssWidth: spec.cssWidth, dpr: spec.dpr })
  const requestedCss = spec.totalHeightDevicePx / spec.dpr
  if (requestedCss > maxCss) {
    throw new Error(
      `This capture is ${Math.round(requestedCss)} CSS px tall; on this display Hotshot can stitch up to ${maxCss}.`,
    )
  }
}

export function createCompositor(spec: CompositorSpec): Compositor {
  assertWithinCanvasLimits(spec)

  if (spec.widthDevicePx <= 0 || spec.totalHeightDevicePx <= 0) {
    throw new RangeError(
      `A capture must have a positive size, got ${spec.widthDevicePx}x${spec.totalHeightDevicePx}.`,
    )
  }

  const canvas = new OffscreenCanvas(spec.widthDevicePx, spec.totalHeightDevicePx)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not acquire a 2D context for stitching.')

  const originX = spec.originXDevicePx ?? 0

  return {
    width: canvas.width,
    height: canvas.height,

    addTile(tile, offsetDevicePx) {
      // Tiles overlap at the document bottom by design (see `planTiles`);
      // drawing at the true offset lets the later tile paint over the
      // duplicate rows. A negative x or y is the crop.
      context.drawImage(tile, -originX, offsetDevicePx)
    },

    finish() {
      return canvas.convertToBlob({ type: 'image/png' })
    },
  }
}
