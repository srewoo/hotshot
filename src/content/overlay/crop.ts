import { renderFilename, DEFAULT_FILENAME_TEMPLATE } from '../../storage/filename'
import type { DeviceRect } from '../../shared/geometry/device-rect'

/**
 * Cuts the selection out of the frozen backdrop.
 *
 * Runs in the content script so the download begins inside the user's gesture
 * — the same focus rule that governs the clipboard (FR-42).
 */

const pad = (n: number): string => String(n).padStart(2, '0')

export function captureFilename(now: Date = new Date()): string {
  return renderFilename(DEFAULT_FILENAME_TEMPLATE, {
    title: document.title,
    host: location.hostname,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    sequence: 1,
  })
}

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

export function downloadBlob(blob: Blob, filename = captureFilename()): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  // Revoked on the next task so the download has already taken the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
