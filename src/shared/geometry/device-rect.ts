/**
 * The correctness kernel (PRD FR-40).
 *
 *   deviceRect = cssRect × zoom × devicePixelRatio
 *
 * Kept pure and dependency-free so the 18-cell zoom × DPR regression matrix
 * can run without a browser. Both scale factors are sampled once at capture
 * start; a change mid-capture is an abort, never a best-effort crop.
 */

export interface CssRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A rect in real backing-store pixels. Always whole numbers. */
export type DeviceRect = CssRect

export interface ScaleFactors {
  /** Browser zoom, from `chrome.tabs.getZoom()`. 1 = 100%. */
  readonly zoom: number
  /** Display scaling, from `window.devicePixelRatio`. */
  readonly dpr: number
}

/** Thrown when zoom or DPR moved between capture start and capture end. */
export class ScaleChangedError extends Error {
  constructor(
    readonly before: ScaleFactors,
    readonly after: ScaleFactors,
  ) {
    super(
      `Display scale changed mid-capture: ` +
        `zoom ${before.zoom} → ${after.zoom}, dpr ${before.dpr} → ${after.dpr}. ` +
        `The capture was discarded because its crop could no longer be proven correct.`,
    )
    this.name = 'ScaleChangedError'
  }
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, got ${value}`)
  }
}

export function toDeviceRect(rect: CssRect, scale: ScaleFactors): DeviceRect {
  assertPositive('zoom', scale.zoom)
  assertPositive('dpr', scale.dpr)
  if (!Number.isFinite(rect.width) || rect.width < 0) {
    throw new RangeError(`rect width must be a non-negative finite number, got ${rect.width}`)
  }
  if (!Number.isFinite(rect.height) || rect.height < 0) {
    throw new RangeError(`rect height must be a non-negative finite number, got ${rect.height}`)
  }

  const factor = scale.zoom * scale.dpr

  // Round the EDGES, then derive the size. Rounding origin and size
  // independently lets them drift apart and shifts the crop by a pixel at
  // some zoom levels — visible as a hairline of the wrong content.
  const left = Math.round(rect.x * factor)
  const top = Math.round(rect.y * factor)
  const right = Math.round((rect.x + rect.width) * factor)
  const bottom = Math.round((rect.y + rect.height) * factor)

  return {
    x: left,
    y: top,
    // A selection the user could see must never round away to nothing.
    width: rect.width > 0 ? Math.max(1, right - left) : 0,
    height: rect.height > 0 ? Math.max(1, bottom - top) : 0,
  }
}

export function assertScaleUnchanged(before: ScaleFactors, after: ScaleFactors): void {
  if (before.zoom !== after.zoom || before.dpr !== after.dpr) {
    throw new ScaleChangedError(before, after)
  }
}
