/**
 * The capture overlay's keymap (PRD FR-28, FR-35, FR-44 scope S1/S2).
 *
 * Pure event → intent, like the editor's and the pin's. Dispatch is on
 * `event.code` wherever a binding is a punctuation key: `[` and `]` are on
 * different physical keys on AZERTY and Dvorak, and a picker whose walk keys
 * moved with the layout would be unusable rather than merely surprising.
 */

export interface OverlayKeyLike {
  readonly key: string
  readonly code?: string
  readonly metaKey?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
}

export type OverlayIntent =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'commit' }
  | { readonly kind: 'nudge' }
  | { readonly kind: 'walk'; readonly direction: 'in' | 'out' }

export function overlayKeyIntent(
  event: OverlayKeyLike,
  mode: 'region' | 'element',
): OverlayIntent | null {
  // Escape first and unconditionally: the way out must never be shadowed, and
  // it is the only binding that survives a held modifier.
  if (event.key === 'Escape') return { kind: 'cancel' }

  // Anything else holding a modifier belongs to the browser. Swallowing ⌘R
  // while an overlay happens to be open is how an extension earns a one-star
  // review (FR-29).
  if (event.metaKey || event.ctrlKey || event.altKey) return null

  if (event.key === 'Enter') return { kind: 'commit' }

  if (mode === 'element') {
    if (event.code === 'BracketRight') return { kind: 'walk', direction: 'out' }
    if (event.code === 'BracketLeft') return { kind: 'walk', direction: 'in' }
    // Arrow keys adjust a REGION; in element mode the chain is walked with
    // brackets, and an arrow would have nothing to move.
    return null
  }

  // The arrow itself is decoded by `adjustSelection`, which owns the 1px /
  // 10px / resize-vs-move rules of FR-35.
  if (event.key.startsWith('Arrow')) return { kind: 'nudge' }
  return null
}
