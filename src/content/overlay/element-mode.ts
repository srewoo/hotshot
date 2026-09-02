import { buildChain } from './element-chain'
import { chooseInitialIndex, walkChain, type Candidate } from './element-choice'
import type { Viewport } from './selection-rect'

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

export function createElementMode(root: ShadowRoot, viewport: Viewport): ElementMode {
  let chain: Candidate[] = []
  let index = -1

  const current = (): Candidate | null => chain[index] ?? null

  return {
    current,

    hover(x, y) {
      // `document.elementFromPoint` returns our own host, so ask the shadow
      // root what lies beneath it rather than hit-testing the page twice.
      const inShadow = root.elementFromPoint?.(x, y) ?? null
      const under = inShadow ?? document.elementFromPoint(x, y)

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
