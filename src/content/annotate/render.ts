import type { CssRect } from '../../shared/geometry/device-rect'
import type { AnnotationCommand, AnnotationPoint } from './command-list'
import { pixelateRegion } from './redact'

/**
 * Draws the command list (PRD FR-7, FR-8, FR-11).
 *
 * Renders through a narrow `DrawSurface` rather than a canvas context, so the
 * drawing INTENT can be tested without a browser and the same commands can
 * later be replayed onto an offscreen canvas for export.
 */

export interface DrawSurface {
  setStroke(colour: string, weight: number): void
  setFill(colour: string): void
  setAlpha(alpha: number): void
  line(from: AnnotationPoint, to: AnnotationPoint): void
  polyline(points: readonly AnnotationPoint[]): void
  rect(rect: CssRect): void
  ellipse(rect: CssRect): void
  disc(centre: AnnotationPoint, radius: number): void
  text(value: string, at: AnnotationPoint): void
  pixels(): Uint8ClampedArray
  putPixels(data: Uint8ClampedArray): void
  readonly width: number
  readonly height: number
}

const HIGHLIGHT_ALPHA = 0.35
const BADGE_RADIUS = 12
const ARROW_HEAD_PX = 14
const ARROW_HEAD_ANGLE = Math.PI / 7

/** Normalises two corner points into a positive-sized rect. */
function rectFrom(a: AnnotationPoint, b: AnnotationPoint): CssRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function drawArrow(surface: DrawSurface, from: AnnotationPoint, to: AnnotationPoint): void {
  surface.line(from, to)

  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  for (const sign of [1, -1]) {
    const theta = angle + Math.PI + sign * ARROW_HEAD_ANGLE
    surface.line(to, {
      x: to.x + Math.cos(theta) * ARROW_HEAD_PX,
      y: to.y + Math.sin(theta) * ARROW_HEAD_PX,
    })
  }
}

export function renderCommands(
  surface: DrawSurface,
  commands: readonly AnnotationCommand[],
  badgeNumbers: Record<string, number>,
): void {
  for (const command of commands) {
    const [first, second] = command.points

    switch (command.tool) {
      case 'redact': {
        if (!first || !second) break
        // Through the pixel buffer, never a drawn rectangle: a shape on top
        // leaves the original pixels underneath in the exported image (FR-9).
        const data = surface.pixels()
        pixelateRegion(data, surface.width, rectFrom(first, second))
        surface.putPixels(data)
        break
      }

      case 'number': {
        if (!first) break
        const number = badgeNumbers[command.id]
        // A badge with no number would render as a blank disc, which reads as
        // a rendering bug rather than an annotation.
        if (number === undefined) break
        surface.setFill(command.color)
        surface.disc(first, BADGE_RADIUS)
        surface.text(String(number), first)
        break
      }

      case 'text': {
        if (!first || !command.text) break
        surface.setFill(command.color)
        surface.text(command.text, first)
        break
      }

      case 'highlight': {
        if (!first || !second) break
        surface.setAlpha(HIGHLIGHT_ALPHA)
        surface.setFill(command.color)
        surface.rect(rectFrom(first, second))
        // Restored immediately: a leaked alpha would tint every later mark.
        surface.setAlpha(1)
        break
      }

      case 'freehand': {
        if (command.points.length < 2) break
        surface.setStroke(command.color, command.weight)
        surface.polyline(command.points)
        break
      }

      case 'line': {
        if (!first || !second) break
        surface.setStroke(command.color, command.weight)
        surface.line(first, second)
        break
      }

      case 'arrow': {
        if (!first || !second) break
        surface.setStroke(command.color, command.weight)
        drawArrow(surface, first, second)
        break
      }

      case 'rect': {
        if (!first || !second) break
        surface.setStroke(command.color, command.weight)
        surface.rect(rectFrom(first, second))
        break
      }

      case 'ellipse': {
        if (!first || !second) break
        surface.setStroke(command.color, command.weight)
        surface.ellipse(rectFrom(first, second))
        break
      }
    }
  }
}
