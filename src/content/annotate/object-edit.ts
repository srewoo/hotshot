import type { CssRect } from '../../shared/geometry/device-rect'
import type { AnnotationCommand, AnnotationPoint } from './command-list'
import { ARROW_HEAD_PX, BADGE_RADIUS } from './render'

/**
 * Editing marks after they are drawn (PRD FR-7, FR-34 applied to annotations).
 *
 * The command list already stores marks as descriptions rather than pixels,
 * which is what makes them editable at all: selecting, moving, resizing and
 * recolouring are transformations of a few points, not repainting. This module
 * is the pure half — no DOM, no canvas — so the geometry can be tested
 * exhaustively without a browser.
 *
 * Everything here works in CANVAS coordinates (full device resolution). The
 * caller converts pointer positions and tolerances from screen space, because
 * a 6px finger-slip on screen is 22 canvas px on a 0.27×-scaled full-page
 * stitch, and hit-testing at screen tolerance would make tall captures
 * un-selectable.
 */

/** Measures a string in canvas pixels at the renderer's text font. */
export type MeasureText = (value: string) => number

/**
 * The text backing box, in one place.
 *
 * `canvas-surface` draws the dark plate behind free text with exactly these
 * offsets, so the box the user clicks is provably the box they can see.
 */
const TEXT_PAD_X = 4
const TEXT_PAD_TOP = 3
export const TEXT_BOX_HEIGHT = 22

export function textBounds(
  value: string,
  at: AnnotationPoint,
  measure: MeasureText,
): CssRect {
  return {
    x: at.x - TEXT_PAD_X,
    y: at.y - TEXT_PAD_TOP,
    width: measure(value) + TEXT_PAD_X * 2,
    height: TEXT_BOX_HEIGHT,
  }
}

const EMPTY: CssRect = { x: 0, y: 0, width: 0, height: 0 }

/** Scaling a zero-width bbox is a translation, not a division by zero. */
const EPSILON = 0.0001

function bbox(points: readonly AnnotationPoint[]): CssRect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

function inflate(rect: CssRect, by: number): CssRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + by * 2,
    height: rect.height + by * 2,
  }
}

function rectFromPoints(a: AnnotationPoint, b: AnnotationPoint): CssRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

/**
 * The mark's visible extent, including its ink.
 *
 * Padded by half the stroke weight — and by the arrow head, which reaches
 * beyond the tip — so the selection box never crops the thing it surrounds.
 * Returns an empty rect for a command with no points, which is not selectable.
 */
export function boundsOf(command: AnnotationCommand, measure: MeasureText): CssRect {
  const [first, second] = command.points
  if (!first) return EMPTY

  switch (command.tool) {
    case 'number':
      return {
        x: first.x - BADGE_RADIUS,
        y: first.y - BADGE_RADIUS,
        width: BADGE_RADIUS * 2,
        height: BADGE_RADIUS * 2,
      }

    case 'text':
      return textBounds(command.text ?? '', first, measure)

    case 'highlight':
    case 'redact':
      // Fills, not strokes: the rect IS the ink, so it gets no padding.
      return second ? rectFromPoints(first, second) : EMPTY

    case 'arrow':
      return second
        ? inflate(rectFromPoints(first, second), ARROW_HEAD_PX)
        : EMPTY

    case 'freehand':
      return command.points.length >= 2
        ? inflate(bbox(command.points), command.weight / 2)
        : EMPTY

    default:
      return second ? inflate(rectFromPoints(first, second), command.weight / 2) : EMPTY
  }
}

function distanceToSegment(p: AnnotationPoint, a: AnnotationPoint, b: AnnotationPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < EPSILON) return Math.hypot(p.x - a.x, p.y - a.y)

  // Projection of p onto ab, clamped to the segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function inside(rect: CssRect, point: AnnotationPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** True when the point is near the rect's OUTLINE rather than its interior. */
function onOutline(rect: CssRect, point: AnnotationPoint, band: number): boolean {
  if (!inside(inflate(rect, band), point)) return false
  const inner = inflate(rect, -band)
  return inner.width <= 0 || inner.height <= 0 || !inside(inner, point)
}

function hitsCommand(
  command: AnnotationCommand,
  point: AnnotationPoint,
  tolerance: number,
  measure: MeasureText,
): boolean {
  const [first, second] = command.points
  if (!first) return false
  const band = tolerance + command.weight / 2

  switch (command.tool) {
    case 'number':
      return Math.hypot(point.x - first.x, point.y - first.y) <= BADGE_RADIUS + tolerance

    case 'text':
    case 'highlight':
    case 'redact':
      // Filled or plated marks are grabbed anywhere inside them.
      return inside(inflate(boundsOf(command, measure), tolerance), point)

    case 'freehand':
      return command.points.some(
        (from, i) =>
          i + 1 < command.points.length &&
          distanceToSegment(point, from, command.points[i + 1] as AnnotationPoint) <= band,
      )

    case 'line':
    case 'arrow':
      return second ? distanceToSegment(point, first, second) <= band : false

    case 'rect':
      // Outline only. An interior hit would make it impossible to draw a
      // second mark inside a rectangle you have already drawn around it.
      return second ? onOutline(rectFromPoints(first, second), point, band) : false

    case 'ellipse': {
      if (!second) return false
      const box = rectFromPoints(first, second)
      const a = box.width / 2
      const b = box.height / 2
      if (a < EPSILON || b < EPSILON) return distanceToSegment(point, first, second) <= band
      const nx = (point.x - (box.x + a)) / a
      const ny = (point.y - (box.y + b)) / b
      // Radial distance from the curve, scaled back into pixels by the
      // shorter semi-axis, which is the tightest honest approximation.
      return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(a, b) <= band
    }

    default:
      return false
  }
}

/**
 * The topmost mark under the point, or null.
 *
 * Iterates newest-first because the newest mark is the one drawn on top, and
 * clicking overlapping marks must select what the user can actually see.
 */
export function hitTest(
  commands: readonly AnnotationCommand[],
  point: AnnotationPoint,
  tolerance: number,
  measure: MeasureText,
): AnnotationCommand | null {
  for (let i = commands.length - 1; i >= 0; i--) {
    const command = commands[i] as AnnotationCommand
    if (hitsCommand(command, point, tolerance, measure)) return command
  }
  return null
}

export function translateCommand(
  command: AnnotationCommand,
  dx: number,
  dy: number,
): AnnotationCommand {
  return { ...command, points: command.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
}

/**
 * Maps every point from one bounding box into another.
 *
 * A degenerate axis — a perfectly horizontal line has zero height — translates
 * instead of scaling, because the alternative is a NaN that silently deletes
 * the mark.
 */
export function scaleCommand(
  command: AnnotationCommand,
  from: CssRect,
  to: CssRect,
): AnnotationCommand {
  const sx = from.width > EPSILON ? to.width / from.width : 1
  const sy = from.height > EPSILON ? to.height / from.height : 1

  return {
    ...command,
    points: command.points.map((p) => ({
      x: to.x + (p.x - from.x) * sx,
      y: to.y + (p.y - from.y) * sy,
    })),
  }
}

export function restyleCommand(
  command: AnnotationCommand,
  style: { readonly color?: string; readonly weight?: number },
): AnnotationCommand {
  return {
    ...command,
    color: style.color ?? command.color,
    weight: style.weight ?? command.weight,
  }
}

/**
 * Point-anchored marks are moved, never resized.
 *
 * A step badge has one authored size (FR-8 numbers it; it is not a shape), and
 * a text label resizes by editing its text. Offering eight handles that do
 * nothing legible is worse than offering none.
 */
export function isResizable(command: AnnotationCommand): boolean {
  return command.tool !== 'number' && command.tool !== 'text'
}
