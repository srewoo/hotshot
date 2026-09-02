import { LOUPE_PX, LOUPE_ZOOM, loupePlacement, SOURCE_SPAN_PX, sourceRectFor } from './magnifier'
import type { Point, Viewport } from './selection-rect'
import type { ScaleFactors } from '../../shared/geometry/device-rect'

/**
 * Renders the loupe over the frozen backdrop (DESIGN §3.1).
 *
 * Appears only during a drag: a magnifier that follows an idle cursor is
 * clutter, and it is only pixel placement that needs one.
 */

export interface LoupeView {
  readonly element: HTMLCanvasElement
  show(cursor: Point): void
  hide(): void
}

export function buildLoupe(source: ImageBitmap, scale: ScaleFactors, viewport: Viewport): LoupeView {
  const canvas = document.createElement('canvas')
  canvas.width = LOUPE_PX
  canvas.height = LOUPE_PX
  Object.assign(canvas.style, {
    position: 'fixed',
    width: `${LOUPE_PX}px`,
    height: `${LOUPE_PX}px`,
    // The rule pair as a bezel, so the loupe reads on any backdrop.
    boxShadow: '0 0 0 1px #FFFFFF, 0 0 0 2px rgba(6,6,5,0.92)',
    borderRadius: '2px',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '3',
  })

  const context = canvas.getContext('2d')
  if (context) context.imageSmoothingEnabled = false // pixels, not mush

  return {
    element: canvas,

    show(cursor) {
      if (!context) return
      const src = sourceRectFor(cursor, scale)
      context.clearRect(0, 0, LOUPE_PX, LOUPE_PX)
      context.drawImage(
        source,
        src.x,
        src.y,
        src.width,
        src.height,
        0,
        0,
        SOURCE_SPAN_PX * LOUPE_ZOOM,
        SOURCE_SPAN_PX * LOUPE_ZOOM,
      )

      // Crosshair on the centre pixel — the one being placed.
      const centre = Math.floor(LOUPE_PX / 2)
      context.strokeStyle = 'rgba(255,90,0,0.9)'
      context.lineWidth = 1
      context.strokeRect(centre - LOUPE_ZOOM / 2, centre - LOUPE_ZOOM / 2, LOUPE_ZOOM, LOUPE_ZOOM)

      const at = loupePlacement(cursor, viewport)
      canvas.style.left = `${at.x}px`
      canvas.style.top = `${at.y}px`
      canvas.style.display = 'block'
    },

    hide() {
      canvas.style.display = 'none'
    },
  }
}
