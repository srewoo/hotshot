import { moveBy, resizeBy, type Viewport } from './selection-rect'
import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * Keyboard adjustment of the selection (PRD FR-35, DESIGN §7.2).
 *
 * Arrow moves, Alt+Arrow resizes, Shift multiplies the step by ten. Pure
 * except for reading the event, so the mapping stays readable and the overlay
 * controller stays about interaction.
 */

const STEP = 1
const COARSE_STEP = 10

const DELTAS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * Returns the adjusted rect, or null when the key is not an adjustment.
 * Resizing drags the south-east corner, which keeps the origin stable — the
 * behaviour people expect from a keyboard nudge.
 */
export function adjustSelection(
  rect: CssRect,
  event: KeyboardEvent,
  viewport: Viewport,
): CssRect | null {
  const delta = DELTAS[event.key]
  if (!delta) return null

  const step = event.shiftKey ? COARSE_STEP : STEP
  const dx = delta[0] * step
  const dy = delta[1] * step

  return event.altKey ? resizeBy(rect, 'se', dx, dy, viewport) : moveBy(rect, dx, dy, viewport)
}
