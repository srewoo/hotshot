/**
 * The overlay's visual furniture (DESIGN §2 tokens, §3.1 layout).
 *
 * Construction only — no behaviour, no state. Separated from the controller so
 * the design system lives in one readable place and the controller stays about
 * interaction.
 */

export const TOKENS = {
  veil: 'rgba(14,14,13,0.44)',
  ruleOuter: 'rgba(6,6,5,0.92)',
  ruleInner: '#FFFFFF',
  flare: '#FF5A00',
  graphite950: '#0E0E0D',
  graphite25: '#F7F7F5',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: '"IBM Plex Sans", system-ui, -apple-system, sans-serif',
} as const

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node.style, style)
  return node
}

export interface OverlayChrome {
  readonly surface: HTMLDivElement
  /** Four rects — top, right, bottom, left — never one masked layer. */
  readonly veils: readonly [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement]
  readonly frame: HTMLDivElement
  readonly readout: HTMLDivElement
  readonly hint: HTMLDivElement
}

export function buildChrome(hintText: string): OverlayChrome {
  const surface = el('div', {
    position: 'fixed',
    inset: '0',
    cursor: 'crosshair',
    userSelect: 'none',
  })

  // Four veil rects rather than one masked layer: the selected pixels are
  // never composited through anything, so what you see is what gets captured.
  const veils = [0, 1, 2, 3].map(() =>
    el('div', { position: 'fixed', background: TOKENS.veil, pointerEvents: 'none' }),
  ) as unknown as OverlayChrome['veils']

  // The rule pair: 1px white inboard, 1px black outboard. Legible at >= 4.58:1
  // against any backdrop the page could contain.
  const frame = el('div', {
    position: 'fixed',
    boxShadow: `0 0 0 1px ${TOKENS.ruleInner}, 0 0 0 2px ${TOKENS.ruleOuter}`,
    pointerEvents: 'none',
    display: 'none',
  })

  const readout = el('div', {
    position: 'fixed',
    padding: '4px 8px',
    borderRadius: '3px',
    background: TOKENS.graphite950,
    color: TOKENS.graphite25,
    font: `500 11px/1.2 ${TOKENS.mono}`,
    fontVariantNumeric: 'tabular-nums',
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}`,
    pointerEvents: 'none',
    display: 'none',
    whiteSpace: 'nowrap',
  })

  const hint = el('div', {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    padding: '6px 12px',
    borderRadius: '3px',
    background: TOKENS.graphite950,
    color: TOKENS.graphite25,
    font: `400 11px/1.2 ${TOKENS.sans}`,
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}`,
    pointerEvents: 'none',
  })
  hint.textContent = hintText

  return { surface, veils, frame, readout, hint }
}
