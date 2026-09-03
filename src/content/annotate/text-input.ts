import { TEXT_FONT_FAMILY, TEXT_FONT_SIZE_PX, TEXT_FONT_WEIGHT } from './canvas-surface'

/**
 * Inline text entry, on the capture (PRD FR-7 text tool).
 *
 * Replaces `window.prompt`, which was the one place the editor left the page:
 * a browser dialog steals focus, cannot be positioned, shows none of the
 * styling the text will have, and on some platforms is suppressed entirely.
 *
 * The caret, selection, IME composition, dead keys and RTL all come from a
 * real `<textarea>` rather than being hand-written. The PRD calls a
 * hand-rolled caret with IME support "the named sinkhole" and prices it at
 * 1.5 weeks; the browser already ships a correct one, positioned over the
 * canvas and styled to match what will be drawn.
 */

export interface TextInputSpec {
  /** Existing text when re-editing a mark; empty for a new one. */
  readonly value: string
  /** Viewport position of the text's top-left corner. */
  readonly at: { readonly x: number; readonly y: number }
  /** Rendered font size — the canvas size scaled by the current view. */
  readonly fontSizePx: number
  readonly color: string
  /** Called with trimmed, non-empty text. */
  readonly onCommit: (value: string) => void
  /** Called when the user escapes, or commits nothing. */
  readonly onCancel: () => void
}

export interface TextInputHandle {
  destroy(): void
}

/** Matches the canvas plate in `canvas-surface`, so nothing shifts on commit. */
const PAD_X = 4
const PAD_TOP = 3
const MIN_WIDTH_PX = 24

export function openTextInput(
  root: ShadowRoot | HTMLElement,
  spec: TextInputSpec,
): TextInputHandle {
  const field = document.createElement('textarea')
  field.value = spec.value
  field.rows = 1
  field.spellcheck = false
  // Lets the browser pick the base direction from what is typed, so Hebrew or
  // Arabic lays out correctly without a language setting.
  field.dir = 'auto'
  field.setAttribute('aria-label', 'Annotation text')

  const scale = spec.fontSizePx / TEXT_FONT_SIZE_PX

  Object.assign(field.style, {
    position: 'fixed',
    left: `${spec.at.x - PAD_X * scale}px`,
    top: `${spec.at.y - PAD_TOP * scale}px`,
    font: `${TEXT_FONT_WEIGHT} ${spec.fontSizePx}px ${TEXT_FONT_FAMILY}`,
    lineHeight: '1.2',
    color: spec.color,
    caretColor: spec.color,
    background: 'rgba(6,6,5,0.92)',
    border: 'none',
    outline: `1px solid ${spec.color}`,
    padding: `${PAD_TOP * scale}px ${PAD_X * scale}px`,
    margin: '0',
    minWidth: `${MIN_WIDTH_PX}px`,
    width: `${MIN_WIDTH_PX}px`,
    height: 'auto',
    overflow: 'hidden',
    resize: 'none',
    whiteSpace: 'pre',
    zIndex: '4',
  })

  let done = false

  /** Grows to fit, so the field is never a scrolling one-line box. */
  function autosize(): void {
    field.style.width = `${MIN_WIDTH_PX}px`
    field.style.height = 'auto'
    // `scrollWidth` is only meaningful once the value is laid out, which is
    // why this runs after every input rather than once at open.
    field.style.width = `${field.scrollWidth + 2}px`
    field.style.height = `${field.scrollHeight}px`
  }

  function finish(value: string | null): void {
    // Blur fires while tearing down, so without this latch a commit is
    // immediately followed by a cancel and the text disappears.
    if (done) return
    done = true
    field.remove()
    const trimmed = value?.trim() ?? ''
    // An empty text command renders nothing and cannot be selected, so it
    // would be an invisible mark in the undo stack. Cancel instead.
    if (trimmed) spec.onCommit(trimmed)
    else spec.onCancel()
  }

  field.addEventListener('input', autosize)

  field.addEventListener('keydown', (event) => {
    // Every key is stopped here: the editor's own handler is a capture-phase
    // listener on `window`, and letters must type rather than switch tools.
    event.stopPropagation()

    if (event.key === 'Escape') {
      event.preventDefault()
      finish(null)
      return
    }
    // Enter commits; Shift+Enter is a newline, the convention everywhere else.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      finish(field.value)
      return
    }
    // Recompute on the next frame so the field has grown before the caret
    // reaches its edge.
    requestAnimationFrame(autosize)
  })

  // Clicking away keeps what was typed. Losing a sentence to a stray click is
  // the worst possible default.
  field.addEventListener('blur', () => finish(field.value))

  root.append(field)
  field.focus()
  // Places the caret at the end when re-editing, rather than selecting all —
  // the common intent is to add to a label, not replace it.
  field.setSelectionRange(field.value.length, field.value.length)
  autosize()

  return {
    destroy() {
      if (done) return
      done = true
      field.remove()
    },
  }
}
