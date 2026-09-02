import { buildChain } from '../../src/content/overlay/element-chain'
import { chooseInitialIndex, walkChain } from '../../src/content/overlay/element-choice'
import { deepElementFromPoint } from '../../src/content/overlay/deep-hit'

/**
 * Exposes the REAL element-picker algorithm to the fixture suite.
 *
 * The point of the suite is that the layout engine is real: `getBoundingClientRect`
 * on a transformed, shadow-rooted, or virtualised element is exactly what the
 * picker will see in production. Reimplementing any of it here would test the
 * reimplementation instead.
 */

declare global {
  interface Window {
    __hotshotPick(x: number, y: number): { tag: string; rect: DOMRect } | null
    __hotshotWalk(x: number, y: number, steps: number): { tag: string } | null
  }
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

window.__hotshotPick = (x, y) => {
  const chain = buildChain(deepElementFromPoint(x, y))
  const index = chooseInitialIndex(chain, viewport())
  const candidate = chain[index]
  if (!candidate) return null
  return {
    tag: candidate.tag,
    rect: candidate.rect as DOMRect,
  }
}

window.__hotshotWalk = (x, y, steps) => {
  const chain = buildChain(deepElementFromPoint(x, y))
  let index = chooseInitialIndex(chain, viewport())
  for (let i = 0; i < Math.abs(steps); i++) {
    index = walkChain(chain, index, steps > 0 ? 'out' : 'in', viewport())
  }
  return chain[index] ? { tag: chain[index].tag } : null
}
