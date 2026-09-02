import type { Candidate } from './element-choice'

/**
 * Builds the innermost → outermost element chain under the cursor (PRD FR-3).
 *
 * Deliberately thin: it walks and measures, and judges nothing. Every decision
 * about which link the user meant lives in `element-choice`, where it can be
 * tested without a DOM.
 */

/** Marks our own overlay host so the picker can refuse to walk into it. */
export const HOTSHOT_HOST_ATTRIBUTE = 'data-hotshot-overlay'

const STOP_AT = new Set(['body'])

function toCandidate(element: Element): Candidate {
  const box = element.getBoundingClientRect()
  return {
    tag: element.tagName.toLowerCase(),
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
  }
}

/**
 * The next node outward, crossing a shadow boundary to its host rather than
 * dead-ending inside a web component (FR-3).
 */
function parentOf(element: Element): Element | null {
  const parent = element.parentElement
  if (parent) return parent

  const root = element.getRootNode()
  if (root instanceof ShadowRoot) return root.host
  return null
}

export function buildChain(target: Element | null): Candidate[] {
  if (!target) return []

  const chain: Candidate[] = []
  let current: Element | null = target

  while (current) {
    // Walking into our own overlay would let the user "capture" Hotshot's UI.
    // Refusing the whole chain is right: if the target is inside the overlay,
    // there is no page element under the cursor to offer.
    if (current.hasAttribute(HOTSHOT_HOST_ATTRIBUTE)) return []

    chain.push(toCandidate(current))
    if (STOP_AT.has(current.tagName.toLowerCase())) break

    current = parentOf(current)
  }

  return chain
}
