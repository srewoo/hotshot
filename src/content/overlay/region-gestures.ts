import {
  clampToViewport,
  moveBy,
  rectFromDrag,
  resizeBy,
  type Handle,
  type Point,
  type Viewport,
} from './selection-rect'
import { handleAtPoint } from './handle-hit'
import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * The region-select drag (PRD FR-1, FR-34).
 *
 * Extracted from `overlay-host` the way `mark-editing` is from the editor: the
 * host owns mounting, phase 2 and the commit, and this owns what a pointer
 * does to a selection. The geometry itself is `selection-rect`; this is the
 * state machine that decides which of its operations a drag means.
 *
 * The rule worth naming: an existing selection is never restarted by accident.
 * A press on a handle resizes, a press inside moves, and only a press on empty
 * space begins again — FR-34 treats one imprecise drag forcing a restart as a
 * bug, because it is the difference between adjusting a crop and redoing it.
 */

export interface RegionGestureDeps {
  readonly viewport: Viewport
  selection(): CssRect | null
  setSelection(rect: CssRect | null): void
  /** Repaints the chrome for the current selection. */
  paint(rect: CssRect | null): void
  /** The loupe, which only exists once phase 2 has landed. */
  showLoupe(at: Point): void
  hideLoupe(): void
  /** True while a fresh drag is in progress, which suppresses the handles. */
  setDrawing(drawing: boolean): void
}

export interface RegionGestures {
  down(event: PointerEvent): void
  move(event: PointerEvent): void
  /** Returns the settled selection, or null when the drag produced nothing. */
  up(): CssRect | null
  /** True while a handle or the selection body is being dragged. */
  adjusting(): boolean
}

/** Below this a selection is a stray click, not a crop. */
const MIN_SELECTION_PX = 2

export function createRegionGestures(deps: RegionGestureDeps): RegionGestures {
  let anchor: Point | null = null
  let dragOrigin: Point | null = null
  let activeHandle: Handle | null = null

  const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY })

  function inside(rect: CssRect, at: Point): boolean {
    return (
      at.x >= rect.x &&
      at.x <= rect.x + rect.width &&
      at.y >= rect.y &&
      at.y <= rect.y + rect.height
    )
  }

  return {
    adjusting: () => dragOrigin !== null,

    down(event) {
      const at = pointOf(event)
      const selection = deps.selection()

      // An existing selection can be resized or moved rather than restarted.
      if (selection) {
        const handle = handleAtPoint(selection, at)
        if (handle) {
          activeHandle = handle
          dragOrigin = at
          return
        }
        if (inside(selection, at)) {
          dragOrigin = at
          return
        }
      }

      deps.setDrawing(true)
      anchor = at
      deps.setSelection(null)
      deps.paint(null)
    },

    move(event) {
      const at = pointOf(event)
      const selection = deps.selection()

      if (selection && dragOrigin) {
        const dx = at.x - dragOrigin.x
        const dy = at.y - dragOrigin.y
        const next = activeHandle
          ? resizeBy(selection, activeHandle, dx, dy, deps.viewport)
          : moveBy(selection, dx, dy, deps.viewport)
        // The origin advances with the pointer so the delta stays relative;
        // measuring from the press instead makes a slow drag accelerate.
        dragOrigin = at
        deps.setSelection(next)
        deps.paint(next)
        return
      }

      if (!anchor) return
      // The loupe appears only during a drag: pixel placement is the only
      // time it earns its space.
      deps.showLoupe(at)
      const next = clampToViewport(rectFromDrag(anchor, at), deps.viewport)
      deps.setSelection(next)
      deps.paint(next)
    },

    up() {
      // Finishing an adjustment keeps the selection live so it can be adjusted
      // again; only a fresh drag decides whether there is a selection at all.
      if (dragOrigin) {
        dragOrigin = null
        activeHandle = null
        const selection = deps.selection()
        deps.paint(selection)
        return selection
      }

      deps.setDrawing(false)
      deps.hideLoupe()

      const selection = deps.selection()
      const usable =
        selection !== null &&
        selection.width >= MIN_SELECTION_PX &&
        selection.height >= MIN_SELECTION_PX

      anchor = null
      if (!usable) {
        deps.setSelection(null)
        deps.paint(null)
        return null
      }

      // The selection stays live so it can be adjusted; Enter commits it.
      deps.paint(selection)
      return selection
    },
  }
}
