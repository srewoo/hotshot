/**
 * The overlay's visual furniture (DESIGN §2 tokens, §3.1 layout).
 *
 * Construction only — no behaviour, no state. Separated from the controller so
 * the design system lives in one readable place and the controller stays about
 * interaction.
 */

import type { CssRect, ScaleFactors } from '../../shared/geometry/device-rect'
import { coverAll, frameSelection } from './veil-view'

export const TOKENS = {
  veil: 'rgba(14,14,13,0.44)',
  ruleOuter: 'rgba(6,6,5,0.92)',
  ruleInner: '#FFFFFF',
  flare: '#FF5A00',
  graphite950: '#0E0E0D',
  graphite25: '#F7F7F5',
  graphite400: '#8C8880',
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
  /**
   * The frozen page, painted under everything once the bitmap arrives (FR-1
   * phase 2). Empty until then, so phase 1 shows the live page through the
   * veil rather than waiting on a screenshot to become interactive.
   */
  readonly frozen: HTMLDivElement
  readonly surface: HTMLDivElement
  /** Four rects — top, right, bottom, left — never one masked layer. */
  readonly veils: readonly [HTMLDivElement, HTMLDivElement, HTMLDivElement, HTMLDivElement]
  readonly frame: HTMLDivElement
  readonly readout: HTMLDivElement
  readonly hint: HTMLDivElement
}

export function buildChrome(hintText: string): OverlayChrome {
  const frozen = el('div', {
    position: 'fixed',
    inset: '0',
    // Sized to the viewport it was captured from, so a device-pixel bitmap
    // lands back on its own CSS pixels exactly.
    backgroundSize: '100% 100%',
    backgroundRepeat: 'no-repeat',
    pointerEvents: 'none',
    display: 'none',
  })

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

  return { frozen, surface, veils, frame, readout, hint }
}

/** A scale annotation — `@2x`, `150%` — in the flare colour. */
function flareSpan(text: string): HTMLSpanElement {
  const span = document.createElement('span')
  span.style.color = TOKENS.flare
  span.textContent = text
  return span
}

/**
 * Writes the dimension readout by building nodes, never by parsing markup.
 *
 * `innerHTML` is a Trusted Types sink. Every value interpolated here is a
 * number, so the old assignment was never an injection risk — it was an
 * AVAILABILITY one: on any page serving `require-trusted-types-for 'script'`
 * the assignment throws a TypeError and takes the whole overlay down with it.
 * Those are precisely the security-conscious pages a capture tool has to work
 * on, and DESIGN's in-page hardening rule bans the sink for this reason.
 *
 * The separator is a text node rather than a leading space inside the span so
 * that the gap does not depend on white-space collapsing rules.
 */
export function writeReadout(
  readout: HTMLDivElement,
  width: number,
  height: number,
  scale: ScaleFactors,
  /**
   * Set when the target runs past the viewport and will be captured by
   * scrolling (FR-5). Without it the readout reports the VISIBLE size, which
   * for a tall element is a smaller number than the capture it produces —
   * the readout would be quietly lying about the thing being captured.
   */
  willScroll = false,
): void {
  const parts: Node[] = [
    document.createTextNode(`${Math.round(width)} × ${Math.round(height)}`),
  ]
  if (scale.dpr !== 1) parts.push(document.createTextNode(' '), flareSpan(`@${scale.dpr}x`))
  if (scale.zoom !== 1) {
    parts.push(document.createTextNode(' '), flareSpan(`${Math.round(scale.zoom * 100)}%`))
  }
  if (willScroll) parts.push(document.createTextNode(' '), flareSpan('scroll'))
  readout.replaceChildren(...parts)
}

/** The nodes `paintSelection` positions. */
export interface PaintTargets {
  readonly surface: HTMLDivElement
  readonly veils: OverlayChrome['veils']
  readonly frame: HTMLDivElement
  readonly readout: HTMLDivElement
  readonly hint: HTMLDivElement
  readonly frozen: HTMLDivElement
}

export interface PaintState {
  readonly rect: CssRect | null
  readonly viewport: { readonly width: number; readonly height: number }
  readonly scale: ScaleFactors
  readonly handles: { show(rect: CssRect): void; hide(): void }
  readonly rules: { update(rect: CssRect): void; hide(): void }
  readonly showHandles: boolean
  /** Element mode reports the ELEMENT, which may exceed the selection. */
  readonly reported: { width: number; height: number; willScroll: boolean } | null
}

/** How far the readout sits from the selection, and its own height. */
const READOUT_GAP = 6
const READOUT_HEIGHT = 24

/**
 * Positions the frame, veils, handles, rules and readout for a selection.
 *
 * Pulled out of the controller because it is entirely arithmetic about where
 * things go, and the controller is about what the pointer means. A null rect
 * is the resting state — the whole viewport dimmed, nothing framed — which is
 * what phase 1 paints before the user has drawn anything.
 */
export function paintSelection(targets: PaintTargets, state: PaintState): void {
  const { frame, readout, veils } = targets
  const { rect, viewport, handles, rules } = state

  if (!rect || rect.width === 0 || rect.height === 0) {
    frame.style.display = 'none'
    readout.style.display = 'none'
    handles.hide()
    rules.hide()
    coverAll(veils)
    return
  }

  const { x, y, width, height } = rect
  frame.style.display = 'block'
  Object.assign(frame.style, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
  })

  frameSelection(veils, rect, viewport)

  if (state.showHandles) handles.show(rect)
  else handles.hide()
  rules.update(rect)

  readout.style.display = 'block'
  const reported = state.reported ?? { width, height, willScroll: false }
  writeReadout(readout, reported.width, reported.height, state.scale, reported.willScroll)

  // Dock below the selection; flip above when that would leave the viewport.
  const below = y + height + READOUT_GAP
  readout.style.left = `${x}px`
  readout.style.top =
    below + READOUT_HEIGHT > viewport.height
      ? `${Math.max(0, y - READOUT_HEIGHT - 4)}px`
      : `${below}px`
}
