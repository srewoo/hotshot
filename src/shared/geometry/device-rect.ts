/**
 * The correctness kernel (PRD FR-40).
 *
 *   deviceRect = cssRect × devicePixelRatio
 *
 * NOT `× zoom × devicePixelRatio`, which is what this module did first and
 * what FR-40 literally says. In Chrome `window.devicePixelRatio` ALREADY
 * includes browser zoom, so multiplying by `chrome.tabs.getZoom()` as well
 * double-counts it: at 150% zoom a crop was scaled 2.25× instead of 1.5× and
 * read its pixels from far outside the selection.
 *
 * Measured, not assumed — `e2e/zoom-scale.spec.ts` sets a real tab to 150%
 * and observes `devicePixelRatio` 1 → 1.5 with `innerWidth` 1280 → 853. The
 * two multiply out to the window's true physical width, which is the identity
 * `captureVisibleTab`'s bitmap obeys. That test is the guard on this file's
 * whole premise; if it ever fails, this maths is wrong again.
 *
 * `zoom` is still carried and still validated: the readout shows it, and a
 * mid-capture change of either factor is an abort rather than a best-effort
 * crop. It is simply not a multiplier.
 *
 * Kept pure and dependency-free so the zoom × DPR regression matrix can run
 * without a browser.
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

  // `dpr` alone: see this module's header. `zoom` is validated above because
  // a nonsense zoom still means the sample was taken wrong.
  const factor = scale.dpr

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
