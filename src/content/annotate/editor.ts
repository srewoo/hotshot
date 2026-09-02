import { createCommandList, type AnnotationCommand, type AnnotationPoint } from './command-list'
import { renderCommands } from './render'
import { canvasSurface } from './canvas-surface'
import { buildToolbar, PALETTE, TOOLS, type ToolbarState } from './toolbar'
import { TOKENS } from '../overlay/overlay-chrome'
import { writeImageToClipboard, browserClipboard } from '../clipboard'
import { isErr } from '../../shared/result'
import type { DeviceRect } from '../../shared/geometry/device-rect'
import { mountDestinations } from './destinations-mount'
import { shipToDestination } from './ship-request'
import type { ProviderId } from '../../storage/token-repo'

/**
 * The in-page annotation editor (PRD FR-7, DESIGN §3.3).
 *
 * Stays ON the page rather than opening an editor tab — keeping the user where
 * they were is the entire speed thesis, and opening a tab is what makes the
 * incumbents slow.
 */

export interface EditorResult {
  readonly action: 'copy' | 'download' | 'pin' | 'shipped' | 'cancel'
  readonly blob?: Blob | undefined
}

export async function openEditor(
  root: ShadowRoot,
  source: ImageBitmap,
  rect: DeviceRect,
  onDone: (result: EditorResult) => void,
): Promise<void> {
  const commands = createCommandList()
  const state: ToolbarState = { tool: 'arrow', color: PALETTE[0] as string, weight: 2 }

  const cssWidth = rect.width
  const cssHeight = rect.height

  const stage = document.createElement('div')
  Object.assign(stage.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(6,6,5,0.72)',
    display: 'grid',
    placeItems: 'center',
    zIndex: '1',
  })

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const scale = Math.min(
    1,
    (window.innerWidth - 96) / source.width,
    (window.innerHeight - 160) / source.height,
  )
  Object.assign(canvas.style, {
    width: `${Math.round(source.width * scale)}px`,
    height: `${Math.round(source.height * scale)}px`,
    boxShadow: `0 0 0 1px ${TOKENS.ruleInner}, 0 0 0 2px ${TOKENS.ruleOuter}`,
    cursor: 'crosshair',
    borderRadius: '2px',
  })

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    onDone({ action: 'cancel' })
    return
  }

  function repaint(): void {
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0)
    const surface = canvasSurface(context, canvas.width, canvas.height)
    renderCommands(surface, commands.commands(), commands.badgeNumbers())
    if (draft) {
      renderCommands(surface, [draft], { ...commands.badgeNumbers(), [draft.id]: nextBadge() })
    }
  }

  function nextBadge(): number {
    return Object.keys(commands.badgeNumbers()).length + 1
  }

  /** Canvas coordinates from a pointer event, independent of display scale. */
  function pointAt(event: PointerEvent): AnnotationPoint {
    const box = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) / box.width) * canvas.width,
      y: ((event.clientY - box.top) / box.height) * canvas.height,
    }
  }

  let draft: AnnotationCommand | null = null
  let drawing = false

  canvas.addEventListener('pointerdown', (event) => {
    const at = pointAt(event)
    const id = `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`

    // A badge is placed by a single click; everything else is a drag.
    if (state.tool === 'number') {
      commands.push({ id, tool: 'number', color: state.color, weight: state.weight, points: [at] })
      repaint()
      return
    }

    if (state.tool === 'text') {
      const value = window.prompt('Text')
      if (value) {
        commands.push({
          id,
          tool: 'text',
          color: state.color,
          weight: state.weight,
          points: [at],
          text: value,
        })
        repaint()
      }
      return
    }

    drawing = true
    draft = { id, tool: state.tool, color: state.color, weight: state.weight, points: [at, at] }
  })

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing || !draft) return
    const at = pointAt(event)
    draft =
      draft.tool === 'freehand'
        ? { ...draft, points: [...draft.points, at] }
        : { ...draft, points: [draft.points[0] as AnnotationPoint, at] }
    repaint()
  })

  function commitDraft(): void {
    if (draft) {
      const [a, b] = draft.points
      // A click that never moved is not a mark; committing it would leave an
      // invisible command in the undo stack.
      const moved = !a || !b || Math.hypot(b.x - a.x, b.y - a.y) > 2
      if (moved) commands.push(draft)
    }
    draft = null
    drawing = false
    repaint()
  }

  canvas.addEventListener('pointerup', commitDraft)
  canvas.addEventListener('pointerleave', () => drawing && commitDraft())

  async function toBlob(): Promise<Blob> {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the capture.'))),
        'image/png',
      ),
    )
  }

  const toolbar = buildToolbar(
    state,
    (next) => {
      Object.assign(state, next)
      if (next.tool) toolbar.setTool(next.tool)
      if (next.color) toolbar.setColor(next.color)
    },
    (action) => {
      if (action === 'undo') return void (commands.undo(), repaint())
      if (action === 'redo') return void (commands.redo(), repaint())
      void finish(action)
    },
  )

  async function finish(action: 'copy' | 'download' | 'pin'): Promise<void> {
    const blob = await toBlob()

    // Recorded before the destination runs, so a failed ship never loses the
    // capture (FR-32). The worker owns storage; Incognito is filtered there.
    void chrome.runtime.sendMessage({
      kind: 'history/record',
      blob: await blob.arrayBuffer(),
      widthDevicePx: canvas.width,
      heightDevicePx: canvas.height,
      sourceUrl: location.href,
      title: document.title,
    })

    if (action === 'copy') {
      // Awaited before teardown: FR-20's fire-and-forget is carved out here,
      // because a clipboard write racing its own teardown fails silently.
      const written = await writeImageToClipboard(blob, browserClipboard())
      if (isErr(written)) {
        console.warn(`[Hotshot] ${written.error.detail}`)
        onDone({ action: 'download', blob })
        return
      }
    }
    onDone({ action, blob })
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onDone({ action: 'cancel' })
      return
    }

    const meta = event.metaKey || event.ctrlKey

    if (meta && event.code === 'KeyZ') {
      event.preventDefault()
      event.shiftKey ? commands.redo() : commands.undo()
      repaint()
      return
    }

    // The commit ladder (FR-44): Enter downloads, ⇧⌘Enter pins, ⇧⌘C copies.
    if (event.code === 'Enter') {
      event.preventDefault()
      void finish(meta && event.shiftKey ? 'pin' : 'download')
      return
    }
    if (meta && event.shiftKey && event.code === 'KeyC') {
      event.preventDefault()
      void finish('copy')
      return
    }

    if (meta) return

    // Dispatch on `event.code` so bindings survive AZERTY and Dvorak.
    const spec = TOOLS.find((t) => t.code === event.code)
    if (spec) {
      event.preventDefault()
      state.tool = spec.tool
      toolbar.setTool(spec.tool)
      return
    }

    const paletteIndex = Number(event.key) - 1
    if (paletteIndex >= 0 && paletteIndex < PALETTE.length) {
      event.preventDefault()
      state.color = PALETTE[paletteIndex] as string
      toolbar.setColor(state.color)
    }
  }

  const destinations = await mountDestinations(root, {
    onSend: (id, key) => void send(id, key),
  })

  async function send(id: ProviderId, key: string): Promise<void> {
    destinations.setStatus('Sending…', 'busy')
    const blob = await toBlob()
    const response = await shipToDestination(id, key, blob)
    if (!response.ok) {
      // The capture stays on screen so a failed ship never loses work (FR-32).
      destinations.setStatus(response.message, 'error')
      return
    }
    destinations.setStatus('Sent', 'ok')
    setTimeout(() => onDone({ action: 'shipped' }), 700)
  }

  window.addEventListener('keydown', onKey, true)

  stage.append(canvas)
  root.append(stage, toolbar.element)
  repaint()

  requestAnimationFrame(() => {
    const box = canvas.getBoundingClientRect()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    toolbar.position(box, viewport)

    // The destination strip sits under the toolbar, never over the capture.
    const toolbarBox = toolbar.element.getBoundingClientRect()
    destinations.element.style.left = `${toolbarBox.left}px`
    destinations.element.style.top = `${Math.min(toolbarBox.bottom + 8, viewport.height - 48)}px`
  })

  void cssWidth
  void cssHeight
}
