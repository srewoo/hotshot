import type { AnnotationTool } from './command-list'
import { PALETTE, TOOLS, WEIGHTS } from './toolbar'

/**
 * The editor keymap, resolved (PRD FR-10, FR-11, FR-44; DESIGN §7.2 scope S3).
 *
 * Kept as a pure event → intent function for two reasons. It is the part of
 * the keyboard model that can be exhaustively tested — FR-44 exists because a
 * review found four binding collisions by reading tables — and it keeps the
 * editor's own key handler down to a switch over intents.
 *
 * Dispatch is on `event.code` throughout, so a binding means the same physical
 * key on AZERTY, Dvorak and QWERTY alike.
 */

/** The fields this module reads. Narrow so tests need no DOM. */
export interface KeyLike {
  readonly code: string
  readonly metaKey?: boolean
  readonly ctrlKey?: boolean
  readonly shiftKey?: boolean
  readonly altKey?: boolean
}

export type EditorIntent =
  | { readonly kind: 'cancel' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'commit'; readonly action: 'download' | 'pin' | 'copy' }
  | { readonly kind: 'tool'; readonly tool: AnnotationTool }
  | { readonly kind: 'colour'; readonly index: number }
  | { readonly kind: 'weight'; readonly index: number }
  | { readonly kind: 'zoom'; readonly direction: 1 | -1 }
  | { readonly kind: 'fit' }
  | { readonly kind: 'delete' }

const ZOOM_IN = new Set(['Equal', 'NumpadAdd'])
const ZOOM_OUT = new Set(['Minus', 'NumpadSubtract'])
const DELETE = new Set(['Backspace', 'Delete'])
const COLOUR_CODES = PALETTE.map((_, i) => `Digit${i + 1}`)
const WEIGHT_CODES: readonly string[] = ['BracketLeft', 'BracketRight']

export function keyIntent(event: KeyLike): EditorIntent | null {
  const meta = Boolean(event.metaKey || event.ctrlKey)

  // Escape first, unconditionally: the way out must never be shadowed.
  if (event.code === 'Escape') return { kind: 'cancel' }

  if (meta && event.code === 'KeyZ') {
    return event.shiftKey ? { kind: 'redo' } : { kind: 'undo' }
  }

  // The commit ladder (FR-44): Enter downloads, ⇧⌘Enter pins, ⇧⌘C copies.
  if (event.code === 'Enter' || event.code === 'NumpadEnter') {
    return { kind: 'commit', action: meta && event.shiftKey ? 'pin' : 'download' }
  }
  if (meta && event.shiftKey && event.code === 'KeyC') {
    return { kind: 'commit', action: 'copy' }
  }

  // Everything below is a bare key. Anything still holding a modifier belongs
  // to the browser or the OS, and swallowing it is how an extension earns a
  // one-star review (FR-29).
  if (meta || event.altKey) return null

  if (DELETE.has(event.code)) return { kind: 'delete' }
  if (ZOOM_IN.has(event.code)) return { kind: 'zoom', direction: 1 }
  if (ZOOM_OUT.has(event.code)) return { kind: 'zoom', direction: -1 }
  if (event.code === 'Digit0') return { kind: 'fit' }

  const colour = COLOUR_CODES.indexOf(event.code)
  if (colour !== -1) return { kind: 'colour', index: colour }

  const weight = WEIGHT_CODES.indexOf(event.code)
  if (weight !== -1) {
    // `[` steps down, `]` steps up. Returned as a delta the caller clamps
    // against WEIGHTS, which owns how many weights there are.
    return { kind: 'weight', index: weight === 0 ? -1 : 1 }
  }

  const tool = TOOLS.find((spec) => spec.code === event.code)
  return tool ? { kind: 'tool', tool: tool.tool } : null
}

/** Steps a weight index within the available weights, without wrapping. */
export function stepWeight(current: number, delta: number): number {
  const index = WEIGHTS.indexOf(current)
  const from = index === -1 ? 0 : index
  const next = Math.min(WEIGHTS.length - 1, Math.max(0, from + delta))
  return WEIGHTS[next] as number
}
