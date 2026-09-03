import { buildChain } from './element-chain'
import { chooseInitialIndex, walkChain, type Candidate } from './element-choice'
import type { Viewport } from './selection-rect'
import { pageElementFromPoint } from './deep-hit'
import { HOTSHOT_HOST_ATTRIBUTE } from './element-chain'

/**
 * Element-mode hit-testing and chain state (PRD FR-3).
 *
 * Holds the chain under the cursor so `[` and `]` walk it without
 * re-hit-testing, which would fight the user's hand as the pointer drifts.
 */

export interface ElementMode {
  hover(x: number, y: number): Candidate | null
  walk(direction: 'in' | 'out'): Candidate | null
  current(): Candidate | null
}

// The overlay's shadow root is no longer needed here: hit-testing goes through
// `elementsFromPoint` and skips our UI by attribute instead.
export function createElementMode(viewport: Viewport): ElementMode {
  let chain: Candidate[] = []
  let index = -1

  const current = (): Candidate | null => chain[index] ?? null

  return {
    current,

    hover(x, y) {
      // Skips our own overlay (which is on top and would otherwise be the only
      // hit) and pierces the page's own shadow roots.
      const under = pageElementFromPoint(x, y, HOTSHOT_HOST_ATTRIBUTE)

      const next = buildChain(under)
      if (next.length === 0) return current()

      chain = next
      index = chooseInitialIndex(chain, viewport)
      return current()
    },

    walk(direction) {
      index = walkChain(chain, index, direction, viewport)
      return current()
    },
  }
}
