import type { DeviceRect } from '../../shared/geometry/device-rect'

/**
 * Cuts the selection out of the frozen backdrop.
 *
 * Stays on the capture fast path. Saving to disk moved to `../download` with
 * the rest of the editor chunk.
 */

export async function cropToBitmap(
  backdropDataUrl: string,
  rect: DeviceRect,
): Promise<ImageBitmap> {
  const response = await fetch(backdropDataUrl)
  const source = await createImageBitmap(await response.blob())
  try {
    // The backdrop is exactly the visible viewport, so a selection cannot
    // legitimately fall outside it — clamping means a rounding disagreement
    // yields a smaller crop rather than a transparent edge.
    const width = Math.min(rect.width, source.width - rect.x)
    const height = Math.min(rect.height, source.height - rect.y)
    if (width <= 0 || height <= 0) {
      throw new RangeError(
        `Selection fell outside the captured area (${rect.x},${rect.y} ${rect.width}x${rect.height} in ${source.width}x${source.height}).`,
      )
    }
    return await createImageBitmap(source, rect.x, rect.y, width, height)
  } finally {
    source.close()
  }
}
