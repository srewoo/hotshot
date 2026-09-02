import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * Selection rect maths (PRD FR-1, FR-34, FR-35 · DESIGN §3.1).
 *
 * Pure and DOM-free on purpose: pointer handling, hit targets and rendering
 * live elsewhere, so every geometric edge case can be tested exhaustively
 * without a browser. All values are CSS pixels — the single conversion to
 * device pixels happens later, in `shared/geometry/device-rect`.
 */

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

/** Edges, which is the representation every operation here is easiest in. */
interface Edges {
  left: number
  top: number
  right: number
  bottom: number
}

const toEdges = (r: CssRect): Edges => ({
  left: r.x,
  top: r.y,
  right: r.x + r.width,
  bottom: r.y + r.height,
})

/** Collapses rather than inverting: a negative-size rect is never valid. */
const toRect = (e: Edges): CssRect => ({
  x: Math.min(e.left, e.right),
  y: Math.min(e.top, e.bottom),
  width: Math.max(0, e.right - e.left),
  height: Math.max(0, e.bottom - e.top),
})

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** A drag from any corner produces the same rect. */
export function rectFromDrag(anchor: Point, current: Point): CssRect {
  return {
    x: Math.min(anchor.x, current.x),
    y: Math.min(anchor.y, current.y),
    width: Math.abs(current.x - anchor.x),
    height: Math.abs(current.y - anchor.y),
  }
}

/** Trims a rect to the visible viewport, shrinking it if it overhangs. */
export function clampToViewport(rect: CssRect, viewport: Viewport): CssRect {
  const e = toEdges(rect)
  return toRect({
    left: clamp(e.left, 0, viewport.width),
    top: clamp(e.top, 0, viewport.height),
    right: clamp(e.right, 0, viewport.width),
    bottom: clamp(e.bottom, 0, viewport.height),
  })
}

/**
 * Translates the rect, stopping at the viewport edge with its size intact.
 *
 * FR-35: clamp, never autoscroll. Autoscroll-during-drag is the classic cause
 * of accidental 8,000 px selections — and a move that silently shrinks the
 * selection at the edge is just as surprising, so size is preserved here
 * rather than clipped.
 */
export function moveBy(rect: CssRect, dx: number, dy: number, viewport: Viewport): CssRect {
  const maxX = Math.max(0, viewport.width - rect.width)
  const maxY = Math.max(0, viewport.height - rect.height)
  return {
    x: clamp(rect.x + dx, 0, maxX),
    y: clamp(rect.y + dy, 0, maxY),
    width: rect.width,
    height: rect.height,
  }
}

/** Which edges each handle drags. */
const MOVES: Record<Handle, { readonly x: 'left' | 'right' | null; readonly y: 'top' | 'bottom' | null }> = {
  nw: { x: 'left', y: 'top' },
  n: { x: null, y: 'top' },
  ne: { x: 'right', y: 'top' },
  e: { x: 'right', y: null },
  se: { x: 'right', y: 'bottom' },
  s: { x: null, y: 'bottom' },
  sw: { x: 'left', y: 'bottom' },
  w: { x: 'left', y: null },
}

/**
 * Drags one handle by a delta, clamped to the viewport.
 *
 * Dragging a handle past its opposite edge collapses the rect rather than
 * inverting it, so the selection can pass through zero without the crop
 * silently flipping.
 */
export function resizeBy(
  rect: CssRect,
  handle: Handle,
  dx: number,
  dy: number,
  viewport: Viewport,
): CssRect {
  const e = toEdges(rect)
  const move = MOVES[handle]

  if (move.x === 'left') e.left = clamp(e.left + dx, 0, e.right)
  if (move.x === 'right') e.right = clamp(e.right + dx, e.left, viewport.width)
  if (move.y === 'top') e.top = clamp(e.top + dy, 0, e.bottom)
  if (move.y === 'bottom') e.bottom = clamp(e.bottom + dy, e.top, viewport.height)

  return toRect(e)
}
