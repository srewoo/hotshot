import type { DrawSurface } from './render'
import type { AnnotationPoint } from './command-list'
import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * Binds the tested `DrawSurface` contract to a real 2D context.
 *
 * All drawing state is set explicitly per call rather than inherited, so a
 * command can never be tinted by whatever the previous one left behind.
 */

const BADGE_FONT = '600 13px "IBM Plex Mono", ui-monospace, monospace'
const TEXT_FONT = '500 15px "IBM Plex Sans", system-ui, sans-serif'

export function canvasSurface(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): DrawSurface {
  let fill = '#FF5A00'

  return {
    width,
    height,

    setStroke(colour, weight) {
      context.strokeStyle = colour
      context.lineWidth = weight
      context.lineCap = 'round'
      context.lineJoin = 'round'
    },

    setFill(colour) {
      fill = colour
      context.fillStyle = colour
    },

    setAlpha(alpha) {
      context.globalAlpha = alpha
    },

    line(from, to) {
      context.beginPath()
      context.moveTo(from.x, from.y)
      context.lineTo(to.x, to.y)
      context.stroke()
    },

    polyline(points: readonly AnnotationPoint[]) {
      if (points.length < 2) return
      context.beginPath()
      const [start, ...rest] = points
      if (!start) return
      context.moveTo(start.x, start.y)
      for (const point of rest) context.lineTo(point.x, point.y)
      context.stroke()
    },

    rect(rect: CssRect) {
      // Highlight fills; every other rect strokes. Distinguished by alpha,
      // which `renderCommands` has already set.
      if (context.globalAlpha < 1) context.fillRect(rect.x, rect.y, rect.width, rect.height)
      else context.strokeRect(rect.x, rect.y, rect.width, rect.height)
    },

    ellipse(rect: CssRect) {
      context.beginPath()
      context.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width / 2,
        rect.height / 2,
        0,
        0,
        Math.PI * 2,
      )
      context.stroke()
    },

    disc(centre, radius) {
      context.beginPath()
      context.arc(centre.x, centre.y, radius, 0, Math.PI * 2)
      context.fillStyle = fill
      context.fill()
      // The rule pair again: a badge must read on any underlying pixels.
      context.strokeStyle = '#FFFFFF'
      context.lineWidth = 1.5
      context.stroke()
    },

    text(value, at) {
      const isBadge = /^\d+$/.test(value)
      context.font = isBadge ? BADGE_FONT : TEXT_FONT
      context.textAlign = isBadge ? 'center' : 'left'
      context.textBaseline = isBadge ? 'middle' : 'top'

      if (isBadge) {
        context.fillStyle = '#FFFFFF'
        context.fillText(value, at.x, at.y)
        return
      }

      // Free text gets a dark backing so it survives a light or busy page.
      const metrics = context.measureText(value)
      context.fillStyle = 'rgba(6,6,5,0.92)'
      context.fillRect(at.x - 4, at.y - 3, metrics.width + 8, 22)
      context.fillStyle = fill
      context.fillText(value, at.x, at.y)
    },

    pixels() {
      return context.getImageData(0, 0, width, height).data
    },

    putPixels(data) {
      // Written through the context's own ImageData rather than constructing
      // one: `Uint8ClampedArray<ArrayBufferLike>` does not satisfy the
      // ImageData constructor, which requires a plain ArrayBuffer.
      const image = context.createImageData(width, height)
      image.data.set(data)
      context.putImageData(image, 0, 0)
    },
  }
}
