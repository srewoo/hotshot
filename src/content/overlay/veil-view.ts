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

/**
 * Dims the whole viewport with ONE layer.
 *
 * Not four: they each carry the veil's 44% alpha, so stacking all four at
 * `inset: 0` composited to ~90% and turned "dimmed" into "nearly black" —
 * hiding the page the user is about to select from. Geometry is written as
 * explicit edges rather than `inset` so a later `frameSelection` is never
 * fighting a leftover shorthand.
 */
export function coverAll(veils: Veils): void {
  const [cover, ...rest] = veils
  Object.assign(cover.style, { left: '0', top: '0', width: '100vw', height: '100vh' })
  for (const veil of rest) {
    Object.assign(veil.style, { left: '0', top: '0', width: '0px', height: '0px' })
  }
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
