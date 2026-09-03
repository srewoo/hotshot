import type { PinRect, Size } from './pin-layout'

/**
 * Cropping inside a pin (PRD FR-38 crop-in-pin).
 *
 * The use is narrow and real: a pin is a reference you keep beside your work,
 * and half of a captured table is often all you need for the next twenty
 * minutes. Cropping in place beats recapturing, which would mean navigating
 * back to whatever the capture came from.
 *
 * The geometry is here and pure, because it is the part that goes wrong: the
 * marquee is drawn in the pin's DISPLAY pixels and the crop must be taken in
 * the capture's own, at whatever scale the pin happens to be.
 */

export interface CropSelection {
  /** Marquee in display pixels, relative to the pin's top-left. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Below this the marquee is a slip of the hand, not a selection. */
export const MIN_CROP_PX = 8

export function isMeaningfulCrop(selection: CropSelection): boolean {
  return selection.width >= MIN_CROP_PX && selection.height >= MIN_CROP_PX
}

/** Normalises a drag between two points into a positive-sized rect. */
export function cropFromDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
): CropSelection {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

/**
 * Maps a display-space marquee onto the capture's own pixels.
 *
 * Clamped to the source, so a marquee dragged past the pin's edge yields a
 * smaller crop rather than a transparent margin — the same rule the capture
 * overlay follows.
 */
export function cropToSourceRect(
  selection: CropSelection,
  display: PinRect,
  source: Size,
): PinRect {
  if (display.width <= 0 || display.height <= 0) {
    throw new RangeError('A pin with no area cannot be cropped.')
  }

  const scaleX = source.width / display.width
  const scaleY = source.height / display.height

  const x = Math.max(0, Math.round(selection.x * scaleX))
  const y = Math.max(0, Math.round(selection.y * scaleY))

  return {
    x,
    y,
    width: Math.max(1, Math.min(source.width - x, Math.round(selection.width * scaleX))),
    height: Math.max(1, Math.min(source.height - y, Math.round(selection.height * scaleY))),
  }
}

/** Cuts the region out of the capture, returning a new PNG. */
export async function cropBlob(source: Blob, region: PinRect): Promise<Blob> {
  const bitmap = await createImageBitmap(source, region.x, region.y, region.width, region.height)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not acquire a 2D context to crop the pin.')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the cropped pin.'))),
        'image/png',
      ),
    )
  } finally {
    bitmap.close()
  }
}
