/**
 * Chrome's canvas backing-store limits, expressed in DEVICE pixels.
 *
 * Both caps are real and independent. Expressing a guard in CSS pixels — as
 * the first draft of PRD FR-43 did — misses both, because a CSS pixel is not
 * a unit the GPU has ever heard of.
 */
export const MAX_CANVAS_AXIS_DEVICE_PX = 65_535
export const MAX_CANVAS_AREA_DEVICE_PX = 268_435_456 // 16_384²

export interface ViewportMetrics {
  /** Viewport width in CSS pixels. */
  readonly cssWidth: number
  /** Device pixel ratio at capture time. */
  readonly dpr: number
}

/**
 * The tallest page, in CSS pixels, that can be stitched into a single canvas
 * at this viewport width and device pixel ratio.
 *
 * Returns 0 when the viewport is itself too wide to admit any height at all,
 * which is a refusal, not a degenerate success.
 */
export function maxCapturableCssHeight({ cssWidth, dpr }: ViewportMetrics): number {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) {
    throw new RangeError(`cssWidth must be a positive finite number, got ${cssWidth}`)
  }
  if (!Number.isFinite(dpr) || dpr <= 0) {
    throw new RangeError(`dpr must be a positive finite number, got ${dpr}`)
  }

  const deviceWidth = cssWidth * dpr
  if (deviceWidth > MAX_CANVAS_AXIS_DEVICE_PX) return 0

  const heightFromAxisCap = MAX_CANVAS_AXIS_DEVICE_PX
  const heightFromAreaCap = Math.floor(MAX_CANVAS_AREA_DEVICE_PX / deviceWidth)

  const deviceHeight = Math.min(heightFromAxisCap, heightFromAreaCap)
  return Math.floor(deviceHeight / dpr)
}
