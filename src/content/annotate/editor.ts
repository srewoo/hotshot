import { createCommandList } from './command-list'
import { renderCommands } from './render'
import { canvasSurface, TEXT_FONT } from './canvas-surface'
import { buildToolbar, PALETTE, type ToolbarState } from './toolbar'
import { keyIntent, stepWeight } from './editor-keys'
import { commitCapture, type EditorResult } from './editor-commit'
import { fitForUpload } from './export-image'
import { ATTACHMENT_LIMIT_BYTES } from '../../integrations/limits'
import { buildEditorView } from './editor-view'
import { buildObjectChrome } from './object-chrome'
import { createMarkEditing } from './mark-editing'
import type { MeasureText } from './object-edit'
import type { DeviceRect } from '../../shared/geometry/device-rect'
import { mountDestinations } from './destinations-mount'
import { shipToDestination } from './ship-request'
import type { ProviderId } from '../../storage/token-repo'

/**
 * The in-page annotation editor (PRD FR-7, FR-34, DESIGN §3.3).
 *
 * Stays ON the page rather than opening an editor tab — keeping the user where
 * they were is the entire speed thesis, and opening a tab is what makes the
 * incumbents slow.
 *
 * Marks remain editable after they are drawn: the command list holds
 * descriptions, not pixels, so select/move/resize/recolour are transformations
 * of a few points. Responsibilities are split deliberately — geometry in
 * `object-edit`, the keymap in `editor-keys`, the stage and its transforms in
 * `editor-view`, selection and gestures in `mark-editing`, delivery in
 * `editor-commit` — and this file wires them to the toolbar and destinations.
 */

export type { EditorResult } from './editor-commit'

export async function openEditor(
  root: ShadowRoot,
  source: ImageBitmap,
  rect: DeviceRect,
  onDone: (result: EditorResult) => void,
): Promise<void> {
  const commands = createCommandList()
  const state: ToolbarState = {
    tool: 'arrow',
    color: PALETTE[0] as string,
    weight: 2,
    exportKind: 'png',
  }

  let view: ReturnType<typeof buildEditorView>
  try {
    view = buildEditorView(source)
  } catch (error: unknown) {
    // A canvas we cannot draw into is a dead end, and a silent one would leave
    // an opaque overlay the user cannot dismiss.
    console.error(`[Hotshot] ${error instanceof Error ? error.message : String(error)}`)
    onDone({ action: 'cancel' })
    return
  }

  const { canvas, context, size } = view
  const chrome = buildObjectChrome()

  /** Measures in the renderer's own font, so hit boxes match drawn ink. */
  const measure: MeasureText = (value) => {
    context.font = TEXT_FONT
    return context.measureText(value).width
  }

  const marks = createMarkEditing({
    root,
    view,
    commands,
    state,
    measure,
    chrome,
    newId,
    repaint: () => repaint(),
  })

  function repaint(): void {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0)
    const surface = canvasSurface(context, canvas.width, canvas.height)
    const numbers = commands.badgeNumbers()
    const draftId = marks.draftId()
    renderCommands(
      surface,
      marks.visible(),
      // A badge being dragged out still shows the digit it will get.
      draftId ? { ...numbers, [draftId]: Object.keys(numbers).length + 1 } : numbers,
    )
    marks.syncChrome()
  }

  function restyle(patch: { color?: string; weight?: number }): void {
    Object.assign(state, patch)
    if (patch.color) toolbar.setColor(patch.color)
    // A palette press with something selected recolours it AND becomes the
    // active style for the next mark. Both, because either alone surprises.
    marks.restyleSelected(patch)
  }

  function rewind(direction: 'undo' | 'redo'): void {
    direction === 'undo' ? commands.undo() : commands.redo()
    // The selection may not exist on the other side of an undo.
    marks.reset()
    repaint()
  }

  function onKey(event: KeyboardEvent): void {
    // While a text field owns the keyboard, the keymap stands down — this
    // listener is capture-phase on `window`, so it sees keys first and would
    // otherwise eat letters that happen to be tool bindings.
    if (marks.isTyping() || destinations.isTyping()) return

    const intent = keyIntent(event)
    if (!intent) return
    event.preventDefault()
    event.stopPropagation()

    switch (intent.kind) {
      case 'cancel':
        return onDone({ action: 'cancel' })
      case 'undo':
      case 'redo':
        return rewind(intent.kind)
      case 'commit':
        return void finish(intent.action)
      case 'tool':
        state.tool = intent.tool
        return toolbar.setTool(intent.tool)
      case 'colour':
        return restyle({ color: PALETTE[intent.index] as string })
      case 'weight':
        return restyle({ weight: stepWeight(state.weight, intent.index) })
      case 'zoom':
        return view.zoom(intent.direction)
      case 'fit':
        return view.fitAll()
      case 'delete':
        marks.deleteSelected()
        return
    }
  }

  /**
   * Exports and delivers.
   *
   * Nothing touches the DOM before the export. Hiding the selection chrome
   * first was observed to leave `toBlob`'s callback unfired, so the capture
   * never encoded and Enter did nothing at all — no error, no delivery. The
   * chrome is DOM and never reaches the PNG anyway, so it comes down after.
   */
  async function finish(action: 'copy' | 'download' | 'pin'): Promise<void> {
    try {
      const result = await commitCapture(canvas, action, state.exportKind)
      chrome.hide()
      onDone(result)
    } catch (error: unknown) {
      // The editor stays open with the work intact, exactly as a failed ship
      // does (FR-32): a failed export must not also discard the capture.
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Hotshot] the capture could not be delivered: ${message}`)
      destinations.setStatus('Could not save the capture — nothing was lost, try again.', 'error')
    }
  }

  async function send(id: ProviderId, key: string): Promise<void> {
    destinations.setStatus('Sending…', 'busy')

    let blob: Blob
    let note: string | null = null
    try {
      // Compress to the destination's limit BEFORE uploading: a 413 after the
      // work of annotating is the worst place to learn the file is too big.
      // Export before hiding the chrome, for the reason documented on `finish`.
      const fitted = await fitForUpload(canvas, ATTACHMENT_LIMIT_BYTES[id])
      blob = fitted.blob
      note = fitted.note
    } catch (error: unknown) {
      destinations.setStatus(
        error instanceof Error ? error.message : 'The capture could not be prepared.',
        'error',
      )
      return
    }

    chrome.hide()
    const response = await shipToDestination(id, key, blob)
    if (!response.ok) {
      // The capture stays on screen so a failed ship never loses work (FR-32).
      destinations.setStatus(response.message, 'error')
      marks.syncChrome()
      return
    }
    // What was given up to fit is reported, never silent.
    destinations.hidePicker()
    destinations.setStatus(note ? `Sent — ${note}` : 'Sent', 'ok')
    setTimeout(() => onDone({ action: 'shipped' }), note ? 2200 : 700)
  }

  const toolbar = buildToolbar(
    state,
    (next) => {
      if (next.tool) {
        state.tool = next.tool
        toolbar.setTool(next.tool)
      }
      if (next.color) restyle({ color: next.color })
      if (next.weight) restyle({ weight: next.weight })
      if (next.exportKind) {
        state.exportKind = next.exportKind
        toolbar.setExportKind(next.exportKind)
      }
    },
    (action) => {
      if (action === 'undo' || action === 'redo') return rewind(action)
      void finish(action)
    },
  )

  const destinations = await mountDestinations(root, {
    onSend: (id, key) => void send(id, key),
  })

  marks.bind(canvas)
  window.addEventListener('keydown', onKey, true)
  view.onLayout(marks.syncChrome)
  view.dock(toolbar, destinations.element)

  root.append(view.stage, toolbar.element, destinations.element, ...chrome.nodes)

  // Fit the WIDTH by default and let the capture scroll: fitting both axes
  // showed a full-page stitch at 27%, which is annotating a thumbnail.
  view.fitWidth()
  repaint()
  // The toolbar can only be measured once it has been laid out.
  requestAnimationFrame(() => view.dock(toolbar, destinations.element))

  void rect
  void size
}

function newId(): string {
  return `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`
}
