/**
 * Hit-testing that pierces open shadow roots (PRD FR-3).
 *
 * `document.elementFromPoint` retargets to the shadow HOST, so without this a
 * web component is opaque: you could capture the whole component and never a
 * card, row or field inside it. On a design-system-heavy app — the case R-3
 * names explicitly — that is most of the page.
 *
 * A CLOSED root cannot be pierced by anyone, including us. There the host is
 * the honest answer, which is the graceful degradation FR-3 asks for rather
 * than a wrong element presented as right.
 */

/** Depth guard: deeply nested roots are real, infinite ones are a bug. */
const MAX_DEPTH = 20

export function deepElementFromPoint(
  x: number,
  y: number,
  from: Document | ShadowRoot = document,
): Element | null {
  let current: Element | null = from.elementFromPoint(x, y)
  let depth = 0

  while (current && depth++ < MAX_DEPTH) {
    const root = current.shadowRoot
    if (!root) return current

    const inner = root.elementFromPoint(x, y)
    // A root that hands back the host, or nothing, has bottomed out — keep
    // the host rather than looping.
    if (!inner || inner === current) return current
    current = inner
  }

  return current
}
