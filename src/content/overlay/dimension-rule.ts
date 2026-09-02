import { el, TOKENS } from './overlay-chrome'
import type { CssRect } from '../../shared/geometry/device-rect'

/**
 * The DIN dimension rules (DESIGN §3.1) — the most characteristic mark in the
 * product. A paired rule with outward tick serifs, drawn in the rule-pair
 * treatment so the measurement is legible over anything.
 *
 * Suppressed below 64px on an axis, where the rule would be longer than the
 * thing it measures.
 */

const MIN_AXIS_PX = 64
const OFFSET = 6

export interface DimensionRules {
  readonly nodes: readonly HTMLElement[]
  update(rect: CssRect): void
  hide(): void
}

function rule(horizontal: boolean): HTMLDivElement {
  return el('div', {
    position: 'fixed',
    background: TOKENS.ruleInner,
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}`,
    height: horizontal ? '1px' : 'auto',
    width: horizontal ? 'auto' : '1px',
    pointerEvents: 'none',
    display: 'none',
  })
}

export function buildDimensionRules(): DimensionRules {
  const horizontal = rule(true)
  const vertical = rule(false)

  return {
    nodes: [horizontal, vertical],

    update(rect) {
      const showH = rect.width >= MIN_AXIS_PX
      horizontal.style.display = showH ? 'block' : 'none'
      if (showH) {
        horizontal.style.left = `${rect.x}px`
        horizontal.style.width = `${rect.width}px`
        horizontal.style.top = `${rect.y + rect.height + OFFSET}px`
      }

      const showV = rect.height >= MIN_AXIS_PX
      vertical.style.display = showV ? 'block' : 'none'
      if (showV) {
        vertical.style.top = `${rect.y}px`
        vertical.style.height = `${rect.height}px`
        vertical.style.left = `${Math.max(0, rect.x - OFFSET)}px`
      }
    },

    hide() {
      horizontal.style.display = 'none'
      vertical.style.display = 'none'
    },
  }
}
