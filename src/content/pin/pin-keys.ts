import { OPACITY_CYCLE, type StackMove } from './pin-layout'

/**
 * The keymap for a focused pin (PRD FR-37/FR-38, DESIGN §3.9).
 *
 * Pure, like the editor's, for the same reason: a pin is persistent furniture
 * on someone else's page, and a binding that fights the page — or that shadows
 * the browser — is a bug the user attributes to the site. Everything here is a
 * bare key or an explicit modifier, and nothing claims a browser shortcut.
 */

export interface PinKeyLike {
  readonly key: string
  readonly code?: string
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
}

export type PinIntent =
  | { readonly kind: 'dismiss' }
  | { readonly kind: 'crop' }
  | { readonly kind: 'opacity'; readonly level: number }
  | { readonly kind: 'cycle-opacity' }
  | { readonly kind: 'stack'; readonly move: StackMove }
  | { readonly kind: 'focus'; readonly direction: 1 | -1 }
  | { readonly kind: 'nudge'; readonly dx: number; readonly dy: number }

const NUDGE_KEYS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export function pinKeyIntent(event: PinKeyLike): PinIntent | null {
  // A modified key belongs to the browser or the page. A pin that swallowed
  // ⌘R or ⌘W would be indistinguishable from a broken site.
  if (event.metaKey || event.ctrlKey || event.altKey) return null

  if (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace') {
    return { kind: 'dismiss' }
  }

  if (event.code === 'Tab' || event.key === 'Tab') {
    return { kind: 'focus', direction: event.shiftKey ? -1 : 1 }
  }

  /**
   * Digits set opacity outright. Cycling to reach a level you already know is
   * three presses too many, and 1–4 map to the same 100/75/50/25 the cycle
   * walks — so the two can never disagree.
   */
  const level = OPACITY_CYCLE[Number(event.key) - 1]
  if (level !== undefined) return { kind: 'opacity', level }

  if (event.code === 'KeyO') return { kind: 'cycle-opacity' }
  if (event.code === 'KeyC') return { kind: 'crop' }

  // `[` and `]` mean "one step" here exactly as they do in the editor, where
  // they step stroke weight. Shift makes it all the way.
  if (event.code === 'BracketRight') {
    return { kind: 'stack', move: event.shiftKey ? 'front' : 'forward' }
  }
  if (event.code === 'BracketLeft') {
    return { kind: 'stack', move: event.shiftKey ? 'back' : 'backward' }
  }

  const nudge = NUDGE_KEYS[event.key]
  if (nudge) {
    // Shift nudges by ten, the same ratio the capture selection uses (FR-35).
    const step = event.shiftKey ? 10 : 1
    return { kind: 'nudge', dx: nudge[0] * step, dy: nudge[1] * step }
  }

  return null
}
