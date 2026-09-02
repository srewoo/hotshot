import type { CssRect } from '../../shared/geometry/device-rect'
import type { Handle, Point } from './selection-rect'

/**
 * Selection handle geometry and hit-testing (PRD FR-34).
 *
 * Drawn small, hit large. WCAG 2.2 §2.5.8 measures the target rather than the
 * ink, so 8px squares carry 24px targets — which is also simply better to use.
 */

export const HANDLE_INK_PX = 8
export const HANDLE_HIT_PX = 24

/** Corners are listed first: where targets overlap, the corner wins. */
const ORDER: readonly Handle[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e']

export function handlePositions(rect: CssRect): Record<Handle, Point> {
  const { x, y, width, height } = rect
  const midX = x + width / 2
  const midY = y + height / 2
  const right = x + width
  const bottom = y + height

  return {
    nw: { x, y },
    n: { x: midX, y },
    ne: { x: right, y },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x, y: bottom },
    w: { x, y: midY },
  }
}

export function handleAtPoint(rect: CssRect, point: Point): Handle | null {
  // On a collapsed rect every handle is coincident, so offering one would be
  // meaningless — the user is starting a new drag, not resizing.
  if (rect.width <= 0 || rect.height <= 0) return null

  const positions = handlePositions(rect)
  const reach = HANDLE_HIT_PX / 2

  for (const handle of ORDER) {
    const at = positions[handle]
    if (Math.abs(point.x - at.x) <= reach && Math.abs(point.y - at.y) <= reach) {
      return handle
    }
  }
  return null
}
