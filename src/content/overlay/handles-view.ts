import { handlePositions, HANDLE_INK_PX } from './handle-hit'
import type { Handle } from './selection-rect'
import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * The eight selection handles (PRD FR-34, DESIGN §3.1).
 *
 * Drawn at 8px in the rule-pair treatment; the 24px hit target lives in
 * `handle-hit`, which is where WCAG 2.2 §2.5.8 is actually satisfied. This
 * module only paints.
 */

export interface HandlesView {
  readonly nodes: readonly HTMLDivElement[]
  show(rect: CssRect): void
  hide(): void
}

const NAMES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function buildHandles(): HandlesView {
  const nodes = new Map<Handle, HTMLDivElement>()

  for (const name of NAMES) {
    const node = document.createElement('div')
    Object.assign(node.style, {
      position: 'fixed',
      width: `${HANDLE_INK_PX}px`,
      height: `${HANDLE_INK_PX}px`,
      marginLeft: `${-HANDLE_INK_PX / 2}px`,
      marginTop: `${-HANDLE_INK_PX / 2}px`,
      background: '#FFFFFF',
      boxShadow: '0 0 0 1px rgba(6,6,5,0.92)',
      display: 'none',
      pointerEvents: 'none',
    })
    nodes.set(name, node)
  }

  return {
    nodes: [...nodes.values()],

    show(rect) {
      const positions = handlePositions(rect)
      for (const [name, node] of nodes) {
        node.style.display = 'block'
        node.style.left = `${positions[name].x}px`
        node.style.top = `${positions[name].y}px`
      }
    },

    hide() {
      for (const node of nodes.values()) node.style.display = 'none'
    },
  }
}
