import type { CssRect } from '../../shared/geometry/device-rect'
import type { Viewport } from './selection-rect'

/**
 * The four veil rectangles (DESIGN §3.1).
 *
 * Four rects rather than one masked layer, so the selected pixels are never
 * composited through anything — what the user sees is exactly what gets
 * captured, which is the claim the whole overlay rests on.
 */

export type Veils = readonly [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement]

export function coverAll(veils: Veils): void {
  for (const veil of veils) Object.assign(veil.style, { inset: '0' })
}

export function frameSelection(veils: Veils, rect: CssRect, viewport: Viewport): void {
  const [top, right, bottom, left] = veils
  const { x, y, width, height } = rect

  Object.assign(top.style, { left: '0', top: '0', width: '100vw', height: `${y}px` })
  Object.assign(bottom.style, {
    left: '0',
    top: `${y + height}px`,
    width: '100vw',
    height: `${Math.max(0, viewport.height - y - height)}px`,
  })
  Object.assign(left.style, { left: '0', top: `${y}px`, width: `${x}px`, height: `${height}px` })
  Object.assign(right.style, {
    left: `${x + width}px`,
    top: `${y}px`,
    width: `${Math.max(0, viewport.width - x - width)}px`,
    height: `${height}px`,
  })
}
