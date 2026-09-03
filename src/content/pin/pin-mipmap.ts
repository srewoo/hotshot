import { mipmapChain, type Size } from './pin-layout'

/**
 * Downscaling a capture for display on a pin (FR-38).
 *
 * A pin shows a 2,400px capture at 400px. Letting the browser do that in one
 * step samples an eighth of the source per output pixel and turns text into
 * grey mush — on a pin whose entire purpose is to keep a reference legible
 * while you work beside it.
 *
 * The chain of halvings is `pin-layout`'s arithmetic; this applies it.
 */

/** Long edge beyond which a pin renders from a reduced copy (FR-38). */
export const MAX_PIN_LONG_EDGE_PX = 2_000

export function displaySizeFor(natural: Size, longEdgeCap = MAX_PIN_LONG_EDGE_PX): Size {
  const longEdge = Math.max(natural.width, natural.height)
  if (longEdge <= longEdgeCap) return natural
  const scale = longEdgeCap / longEdge
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  }
}

/**
 * Renders the capture at `target`, averaging down through intermediate sizes.
 *
 * Returns a blob rather than a canvas so the pin can hold an object URL and
 * release the intermediate memory immediately — four pins each holding a
 * full-size canvas is how a tab reaches the OOM that R-10 is about.
 */
export async function renderPinImage(source: Blob, target: Size): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const chain = mipmapChain({ width: bitmap.width, height: bitmap.height }, target)
    if (chain.length === 0) return source

    let current: HTMLCanvasElement | null = null
    let previous: CanvasImageSource = bitmap

    for (const step of chain) {
      const canvas = document.createElement('canvas')
      canvas.width = step.width
      canvas.height = step.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not acquire a 2D context to scale the pin.')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(previous, 0, 0, step.width, step.height)
      current = canvas
      previous = canvas
    }

    if (!current) return source
    const rendered = current
    return await new Promise<Blob>((resolve, reject) =>
      rendered.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the pin image.'))),
        'image/png',
      ),
    )
  } finally {
    bitmap.close()
  }
}
