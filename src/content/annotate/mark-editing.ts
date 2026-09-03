import { isMeaningfulDraft } from './draft'
import { TEXT_FONT_SIZE_PX } from './canvas-surface'
import { openTextInput, type TextInputHandle } from './text-input'
import { screenRectFrom } from './view-transform'
import {
  boundsOf,
  hitTest,
  isResizable,
  restyleCommand,
  scaleCommand,
  translateCommand,
  type MeasureText,
} from './object-edit'
import { handleAtPoint, HANDLE_HIT_PX } from '../overlay/handle-hit'
import { resizeBy, type Handle } from '../overlay/selection-rect'
import type { AnnotationCommand, AnnotationPoint, CommandList } from './command-list'
import type { CssRect } from '../../shared/geometry/device-rect'
import type { ToolbarState } from './toolbar'
import type { EditorView } from './editor-view'
import type { ObjectChrome } from './object-chrome'

/**
 * Selecting and editing marks that are already drawn (PRD FR-7, FR-34).
 *
 * This is the state machine: what is selected, which gesture is in flight, and
 * the live preview of an edit before it is committed to the command list. It
 * owns exactly that state and nothing else — the geometry is `object-edit`,
 * the coordinate mapping is `editor-view`, the chrome is `object-chrome`.
 *
 * The commit rule: one command-list entry per GESTURE, never per pointermove,
 * so a single undo steps back over a whole drag.
 */

type Gesture =
  | { readonly kind: 'idle' }
  | { readonly kind: 'draw' }
  | { readonly kind: 'move'; readonly from: AnnotationPoint; readonly original: AnnotationCommand }
  | {
      readonly kind: 'resize'
      readonly from: AnnotationPoint
      readonly original: AnnotationCommand
      readonly bounds: CssRect
      readonly handle: Handle
    }

export interface MarkEditingDeps {
  /** Where the inline text field mounts — the editor's own shadow root. */
  readonly root: ShadowRoot | HTMLElement
  readonly view: EditorView
  readonly commands: CommandList
  /** The live toolbar state; new marks take their tool, colour and weight. */
  readonly state: ToolbarState
  readonly measure: MeasureText
  readonly chrome: ObjectChrome
  readonly newId: () => string
  repaint: () => void
}

export interface MarkEditing {
  /** Committed marks with any live edit or in-progress draft substituted in. */
  visible(): AnnotationCommand[]
  selected(): AnnotationCommand | null
  select(id: string | null): void
  /** The draft's badge number, so a badge previews with its real digit. */
  draftId(): string | null
  syncChrome(): void
  /** True while the inline text field owns the keyboard. */
  isTyping(): boolean
  /** Removes the selection. Returns false when there was nothing selected. */
  deleteSelected(): boolean
  /** Applies a style to the selection, if any. */
  restyleSelected(patch: { readonly color?: string; readonly weight?: number }): void
  /** Clears selection and any in-flight gesture, e.g. after an undo. */
  reset(): void
  bind(canvas: HTMLCanvasElement): void
}

export function createMarkEditing(deps: MarkEditingDeps): MarkEditing {
  const { root, view, commands, state, measure, chrome, newId } = deps

  let selectedId: string | null = null
  let gesture: Gesture = { kind: 'idle' }
  let draft: AnnotationCommand | null = null
  let preview: AnnotationCommand | null = null
  let textInput: TextInputHandle | null = null

  function visible(): AnnotationCommand[] {
    const list = commands
      .commands()
      .map((command) => (preview && command.id === preview.id ? preview : command))
    return draft ? [...list, draft] : list
  }

  function selected(): AnnotationCommand | null {
    if (!selectedId) return null
    return visible().find((command) => command.id === selectedId) ?? null
  }

  /** Selection chrome is DOM, never canvas ink — it must not reach the PNG. */
  function syncChrome(): void {
    const mark = selected()
    if (!mark) return chrome.hide()
    chrome.show(boundsOf(mark, measure), view.box(), view.size, isResizable(mark))
  }

  function select(id: string | null): void {
    selectedId = id
    syncChrome()
  }

  function editText(mark: AnnotationCommand | null, at: AnnotationPoint): void {
    const origin = screenRectFrom({ ...at, width: 0, height: 0 }, view.box(), view.size)
    textInput = openTextInput(root, {
      value: mark?.text ?? '',
      at: { x: origin.x, y: origin.y },
      // Never smaller than legible, however far out the capture is zoomed.
      fontSizePx: Math.max(9, TEXT_FONT_SIZE_PX * view.scale()),
      color: mark?.color ?? state.color,
      onCommit: (text) => {
        textInput = null
        if (mark) {
          commands.replace({ ...mark, text })
        } else {
          const id = newId()
          commands.push({
            id,
            tool: 'text',
            color: state.color,
            weight: state.weight,
            points: [at],
            text,
          })
          selectedId = id
        }
        deps.repaint()
      },
      onCancel: () => {
        textInput = null
        deps.repaint()
      },
    })
  }

  function beginResize(mark: AnnotationCommand, at: AnnotationPoint): boolean {
    if (!isResizable(mark)) return false
    const bounds = boundsOf(mark, measure)
    const handle = handleAtPoint(bounds, at, view.slop(HANDLE_HIT_PX))
    if (!handle) return false
    gesture = { kind: 'resize', from: at, original: mark, bounds, handle }
    return true
  }

  function onDown(event: PointerEvent): void {
    if (textInput) return
    const at = view.canvasPoint({ x: event.clientX, y: event.clientY })
    const mark = selected()

    // A handle on the current selection wins over everything else, including
    // marks underneath it — otherwise a small mark inside a larger one makes
    // the larger one impossible to resize.
    if (mark && beginResize(mark, at)) {
      view.canvas.setPointerCapture(event.pointerId)
      return
    }

    // Alt forces a new mark: the escape hatch for drawing on top of one.
    const hit = event.altKey ? null : hitTest(visible(), at, view.slop(), measure)
    if (hit) {
      select(hit.id)
      gesture = { kind: 'move', from: at, original: hit }
      view.canvas.setPointerCapture(event.pointerId)
      return
    }

    select(null)
    if (state.tool === 'text') {
      // Suppressing the compatibility mouse events is what keeps the field
      // alive: the click's default focus handling would otherwise move focus
      // to the canvas, and the field commits on blur — so it vanished in the
      // same gesture that created it, with nothing typed.
      event.preventDefault()
      return editText(null, at)
    }

    if (state.tool === 'number') {
      const id = newId()
      commands.push({ id, tool: 'number', color: state.color, weight: state.weight, points: [at] })
      selectedId = id
      return deps.repaint()
    }

    gesture = { kind: 'draw' }
    draft = {
      id: newId(),
      tool: state.tool,
      color: state.color,
      weight: state.weight,
      points: [at, at],
    }
    view.canvas.setPointerCapture(event.pointerId)
  }

  function onMove(event: PointerEvent): void {
    if (gesture.kind === 'idle') return
    const at = view.canvasPoint({ x: event.clientX, y: event.clientY })

    if (gesture.kind === 'draw') {
      if (!draft) return
      draft =
        draft.tool === 'freehand'
          ? { ...draft, points: [...draft.points, at] }
          : { ...draft, points: [draft.points[0] as AnnotationPoint, at] }
    } else if (gesture.kind === 'move') {
      preview = translateCommand(gesture.original, at.x - gesture.from.x, at.y - gesture.from.y)
    } else {
      // Resize clamps to the canvas and collapses rather than inverting — the
      // same rule the capture selection follows (FR-34).
      const to = resizeBy(
        gesture.bounds,
        gesture.handle,
        at.x - gesture.from.x,
        at.y - gesture.from.y,
        view.size,
      )
      preview = scaleCommand(gesture.original, gesture.bounds, to)
    }
    deps.repaint()
  }

  function onUp(): void {
    if (gesture.kind === 'draw' && draft) {
      // Measured over the whole path: a freehand draft starts as [at, at], so
      // comparing the first two points discarded every freehand stroke.
      if (isMeaningfulDraft(draft)) {
        commands.push(draft)
        selectedId = draft.id
      }
      draft = null
    } else if (preview) {
      commands.replace(preview)
      preview = null
    }
    gesture = { kind: 'idle' }
    deps.repaint()
  }

  return {
    visible,
    selected,
    select,
    draftId: () => draft?.id ?? null,
    syncChrome,
    isTyping: () => textInput !== null,

    deleteSelected() {
      if (!selectedId) return false
      commands.remove(selectedId)
      select(null)
      deps.repaint()
      return true
    },

    restyleSelected(patch) {
      const mark = selected()
      if (!mark) return
      commands.replace(restyleCommand(mark, patch))
      deps.repaint()
    },

    reset() {
      selectedId = null
      draft = null
      preview = null
      gesture = { kind: 'idle' }
      textInput?.destroy()
      textInput = null
    },

    bind(canvas) {
      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointercancel', onUp)
      canvas.addEventListener('dblclick', (event) => {
        const at = view.canvasPoint({ x: event.clientX, y: event.clientY })
        const hit = hitTest(visible(), at, view.slop(), measure)
        // Double-clicking a label edits it in place: the one gesture people
        // try without being told.
        if (hit?.tool === 'text') editText(hit, hit.points[0] as AnnotationPoint)
      })
    },
  }
}
