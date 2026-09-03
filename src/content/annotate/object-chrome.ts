import { buildHandles } from '../overlay/handles-view'
import { TOKENS } from '../overlay/overlay-chrome'
import { screenRectFrom, type Box, type Size } from './view-transform'
import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * The selection outline and handles for an already-drawn mark (FR-7/FR-34).
 *
 * Lives in the DOM, above the canvas, rather than being drawn INTO it — that
 * is the whole point. Selection chrome painted on the canvas would be baked
 * into the exported PNG, and every export path (`toBlob`, clipboard, ship)
 * reads the same canvas.
 *
 * Reuses the overlay's handle geometry so a resize handle looks and behaves
 * identically whether it is sizing a capture region or an arrow.
 */

export interface ObjectChrome {
  readonly nodes: readonly HTMLElement[]
  /**
   * Positions the chrome around a mark.
   *
   * `bounds` is in canvas pixels; `box` is the canvas's rendered position, so
   * the mapping stays correct under zoom and scroll alike.
   */
  show(bounds: CssRect, box: Box, canvas: Size, resizable: boolean): void
  hide(): void
}

export function buildObjectChrome(): ObjectChrome {
  const outline = document.createElement('div')
  Object.assign(outline.style, {
    position: 'fixed',
    // The rule pair: 1px dark outboard, 1px light inboard, legible on any
    // pixels the capture could possibly contain.
    boxShadow: `0 0 0 1px ${TOKENS.ruleInner}, 0 0 0 2px ${TOKENS.ruleOuter}`,
    display: 'none',
    pointerEvents: 'none',
  })

  const handles = buildHandles()

  /**
   * One layer for all of it, above the stage.
   *
   * Not optional: within a stacking context a positioned element with
   * `z-index: 1` — the stage — paints above a LATER sibling with `z-index:
   * auto`, so the handles were being covered by the capture even though they
   * came after it in the tree. The outline survived only because it carried a
   * z-index of its own. Fixed-position children still position against the
   * viewport, since this wrapper creates no containing block.
   */
  const layer = document.createElement('div')
  Object.assign(layer.style, {
    position: 'fixed',
    inset: '0',
    // Never intercepts: pointer hits belong to the canvas, which hit-tests in
    // canvas coordinates and knows what is actually under the cursor.
    pointerEvents: 'none',
    zIndex: '3',
  })
  layer.append(outline, ...handles.nodes)

  return {
    nodes: [layer],

    show(bounds, box, canvas, resizable) {
      const rect = screenRectFrom(bounds, box, canvas)
      Object.assign(outline.style, {
        display: 'block',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
      // Point-anchored marks show the outline but no handles: eight targets
      // that cannot resize anything is worse than none (see `isResizable`).
      if (resizable) handles.show(rect)
      else handles.hide()
    },

    hide() {
      outline.style.display = 'none'
      handles.hide()
    },
  }
}
