import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * Destructive redaction (PRD FR-9).
 *
 * These functions overwrite the pixel buffer in place. Nothing about the
 * original values survives — no filter, no overlay, no CSS. A blur that can be
 * un-blurred is a security incident, and this is the module that has to be
 * right for the product's privacy claim to mean anything.
 */

/** FR-9 requires at least 12px blocks; below that, text stays readable. */
export const REDACT_BLOCK_PX = 12

export type Rgb = readonly [number, number, number]

interface Bounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

/** Clamps the region to the buffer so an overhang truncates rather than corrupts. */
function boundsOf(data: Uint8ClampedArray, width: number, region: CssRect): Bounds | null {
  const height = data.length / 4 / width
  const left = Math.max(0, Math.floor(region.x))
  const top = Math.max(0, Math.floor(region.y))
  const right = Math.min(width, Math.ceil(region.x + region.width))
  const bottom = Math.min(height, Math.ceil(region.y + region.height))
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom }
}

export function solidFillRegion(
  data: Uint8ClampedArray,
  width: number,
  region: CssRect,
  colour: Rgb,
): void {
  const bounds = boundsOf(data, width, region)
  if (!bounds) return

  const [r, g, b] = colour
  for (let y = bounds.top; y < bounds.bottom; y++) {
    for (let x = bounds.left; x < bounds.right; x++) {
      const offset = (y * width + x) * 4
      data[offset] = r
      data[offset + 1] = g
      data[offset + 2] = b
      data[offset + 3] = 255
    }
  }
}

export function pixelateRegion(data: Uint8ClampedArray, width: number, region: CssRect): void {
  const bounds = boundsOf(data, width, region)
  if (!bounds) return

  for (let blockY = bounds.top; blockY < bounds.bottom; blockY += REDACT_BLOCK_PX) {
    for (let blockX = bounds.left; blockX < bounds.right; blockX += REDACT_BLOCK_PX) {
      const endX = Math.min(blockX + REDACT_BLOCK_PX, bounds.right)
      const endY = Math.min(blockY + REDACT_BLOCK_PX, bounds.bottom)

      let sumR = 0
      let sumG = 0
      let sumB = 0
      let count = 0
      for (let y = blockY; y < endY; y++) {
        for (let x = blockX; x < endX; x++) {
          const offset = (y * width + x) * 4
          sumR += data[offset]!
          sumG += data[offset + 1]!
          sumB += data[offset + 2]!
          count++
        }
      }
      if (count === 0) continue

      // One averaged colour per block, written back over every source pixel.
      // The detail is not hidden; it no longer exists.
      const avgR = Math.round(sumR / count)
      const avgG = Math.round(sumG / count)
      const avgB = Math.round(sumB / count)
      for (let y = blockY; y < endY; y++) {
        for (let x = blockX; x < endX; x++) {
          const offset = (y * width + x) * 4
          data[offset] = avgR
          data[offset + 1] = avgG
          data[offset + 2] = avgB
          data[offset + 3] = 255
        }
      }
    }
  }
}
