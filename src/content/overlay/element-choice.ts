import type { CssRect } from '../../shared/geometry/device-rect'
import type { Viewport } from './selection-rect'

/**
 * Which element did the user actually mean? (PRD FR-3, Wedge 1.)
 *
 * Kept pure and separate from DOM measurement because R-3 is explicit that an
 * 80%-reliable element picker fails publicly. Judgement that can be tested
 * exhaustively without a browser is judgement that can be trusted.
 *
 * A chain runs innermost → outermost: `chain[0]` is the deepest element under
 * the cursor, the last entry is `<body>`.
 */

export interface Candidate {
  readonly tag: string
  readonly rect: CssRect
}

export type WalkDirection = 'in' | 'out'

/** Below this, the element is decoration inside the thing the user meant. */
const MIN_USABLE_PX = 8

/** Above this share of the viewport, it is a page wrapper, not an element. */
const MAX_VIEWPORT_SHARE = 0.95

/** Structural elements are never a capture target. */
const NEVER = new Set(['html', 'body', 'head', 'script', 'style'])

function isUsable(candidate: Candidate, viewport: Viewport): boolean {
  const { tag, rect } = candidate
  if (NEVER.has(tag.toLowerCase())) return false
  if (rect.width < MIN_USABLE_PX || rect.height < MIN_USABLE_PX) return false

  // A full-bleed wrapper is what full-page capture is for. Offering it as
  // "an element" is a wrong answer dressed as a right one.
  const coversViewport =
    rect.width >= viewport.width * MAX_VIEWPORT_SHARE &&
    rect.height >= viewport.height * MAX_VIEWPORT_SHARE
  return !coversViewport
}

const area = (c: Candidate): number => c.rect.width * c.rect.height

/**
 * The innermost candidate worth selecting, falling back outward and then to
 * the largest non-structural element rather than returning something absurd.
 */
export function chooseInitialIndex(chain: readonly Candidate[], viewport: Viewport): number {
  if (chain.length === 0) return -1

  const usable = chain.findIndex((c) => isUsable(c, viewport))
  if (usable !== -1) return usable

  // Everything is a sliver or a wrapper. Prefer the largest thing that is at
  // least not structural; only then give up and take the deepest node.
  let best = -1
  let bestArea = -1
  for (const [index, candidate] of chain.entries()) {
    if (NEVER.has(candidate.tag.toLowerCase())) continue
    if (area(candidate) > bestArea) {
      best = index
      bestArea = area(candidate)
    }
  }
  return best === -1 ? 0 : best
}

/**
 * Moves one step along the chain, skipping candidates that are not usable.
 *
 * Staying put at either end — rather than wrapping around — is what makes
 * `[` and `]` trustworthy under the hand: the selection never jumps somewhere
 * surprising because the user pressed once too often.
 */
export function walkChain(
  chain: readonly Candidate[],
  index: number,
  direction: WalkDirection,
  viewport: Viewport,
): number {
  if (chain.length === 0) return -1
  const start = Math.min(Math.max(index, 0), chain.length - 1)
  const step = direction === 'out' ? 1 : -1

  for (let i = start + step; i >= 0 && i < chain.length; i += step) {
    const candidate = chain[i]
    if (candidate && isUsable(candidate, viewport)) return i
  }
  return start
}
