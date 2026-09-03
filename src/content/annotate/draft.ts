import type { AnnotationCommand } from './command-list'

/**
 * Is this draft worth committing?
 *
 * A click that never moved is not a mark, and committing it would leave an
 * invisible entry in the undo stack. The measurement is TOTAL PATH LENGTH,
 * not first-to-second point:
 *
 *   - a freehand draft begins as [at, at] and appends as the pointer moves, so
 *     points[0] and points[1] are always identical. Comparing those two
 *     discarded every freehand stroke the user ever drew.
 *   - a closed freehand loop ends where it began, so first-to-last would throw
 *     that away too.
 *
 * Path length is the only measure that gets both right.
 */

/** Below this the "drag" is a hand tremor on a click. */
const MIN_PATH_PX = 3

/** Tools placed with a single click, which have no drag to measure. */
const PLACED_TOOLS = new Set<AnnotationCommand['tool']>(['number', 'text'])

export function isMeaningfulDraft(draft: AnnotationCommand): boolean {
  if (PLACED_TOOLS.has(draft.tool)) return true
  if (draft.points.length < 2) return false

  let length = 0
  for (let i = 1; i < draft.points.length; i++) {
    const from = draft.points[i - 1]
    const to = draft.points[i]
    if (!from || !to) continue
    length += Math.hypot(to.x - from.x, to.y - from.y)
    // Early exit: once it is long enough, the rest cannot change the answer.
    if (length > MIN_PATH_PX) return true
  }
  return false
}
