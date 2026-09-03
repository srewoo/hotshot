import { clampToViewport } from './selection-rect'
import { adjustSelection } from './selection-keys'
import { createRegionGestures } from './region-gestures'
import { overlayKeyIntent } from './overlay-keys'
import { buildHandles } from './handles-view'
import { buildLoupe } from './loupe-view'
import { buildDimensionRules } from './dimension-rule'
import { HOTSHOT_HOST_ATTRIBUTE } from './element-chain'
import { createElementMode } from './element-mode'
import type { CssRect } from '../../shared/geometry/device-rect'
import { commitSelection } from './commit-selection'
import { startPhaseTwo } from './phase-two'
import { bandFor, needsScrollCapture, reportedSize } from './element-band-request'
import type { CaptureMode } from '../../shared/messaging/protocol'
import { buildChrome, paintSelection } from './overlay-chrome'

/**
 * The capture overlay (DESIGN §3.1).
 *
 * Lives in a CLOSED shadow root attached to documentElement, so the page's own
 * CSS cannot reach in and the overlay's styles cannot leak out. Every mark
 * drawn over the page uses the rule pair — 1px black outboard, 1px white
 * inboard — which is legible at >= 4.58:1 against any backdrop the page could
 * possibly contain.
 */

interface OverlaySession {
  destroy(): void
}

let active: OverlaySession | null = null

export async function mountOverlay(requested: CaptureMode): Promise<void> {
  // A second hotkey press replaces the overlay rather than stacking one.
  active?.destroy()

  if (requested !== 'region' && requested !== 'element') {
    // Full page needs no overlay — the whole document is the selection, so it
    // runs straight through the worker's stitcher. Refusing loudly beats
    // silently capturing the wrong thing.
    console.warn(`[Hotshot] capture mode "${requested}" does not use the overlay.`)
    return
  }
  // Narrowed once, here: the two modes are the only ones the rest of this
  // function is written for, and re-checking at each use invites drift.
  const mode: 'region' | 'element' = requested

  const host = document.createElement('div')
  // Lets the element picker recognise and refuse our own UI.
  host.setAttribute(HOTSHOT_HOST_ATTRIBUTE, '')
  const root = host.attachShadow({ mode: 'closed' })
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    // Above everything the page is likely to use, without reaching the
    // 32-bit ceiling where some pages park their own modals.
    zIndex: '2147483646',
  })

  const { frozen, surface, veils, frame, readout, hint } = buildChrome(
    mode === 'element'
      ? 'hover an element · [ ] to adjust · click to capture · esc cancel'
      : 'drag to select · esc cancel',
  )

  // `frozen` goes first so it paints beneath the veils; everything here is
  // synchronous, which is the whole point of phase 1.
  root.append(frozen, surface, ...veils, frame, readout, hint)
  document.documentElement.append(host)

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  /**
   * Read from the page, not awaited from the worker (FR-1 phase 1, FR-40).
   *
   * `devicePixelRatio` already folds in browser zoom, so the crop geometry is
   * correct from the first frame and the overlay does not have to block on a
   * screenshot to become usable. `zoom` is carried only for the readout label
   * and is filled in when the worker replies.
   */
  const scale = { zoom: 1, dpr: window.devicePixelRatio }
  let selection: CssRect | null = null
  /** The hovered element's true rect, which may exceed the viewport. */
  let elementRect: CssRect | null = null
  let drawing = false

  const elements = createElementMode(viewport)

  const handles = buildHandles()
  const rules = buildDimensionRules()
  root.append(...handles.nodes, ...rules.nodes)

  /**
   * This session's own liveness flag.
   *
   * Not `active`: a second hotkey press replaces `active` with a NEW session,
   * so an in-flight phase 2 belonging to the old one would see a truthy
   * `active` and paint into a host that is already off the page.
   */
  let live = true

  /** Both null until phase 2 lands; every use is guarded. */
  let backdropBitmap: ImageBitmap | null = null
  let loupe: ReturnType<typeof buildLoupe> | null = null

  const phaseTwo = startPhaseTwo({
    root,
    frozen,
    hint,
    viewport,
    scale,
    live: () => live,
    repaint: () => paint(selection),
    onLoupe: (built) => {
      loupe = built
    },
    onBitmap: (bitmap) => {
      backdropBitmap = bitmap
    },
    onAbort: destroy,
  })

  /**
   * Positions every piece of chrome for the current selection.
   *
   * Delegated to `paintSelection`, which owns the overlay's visual furniture:
   * this file is the controller, and the arithmetic of where a readout docks
   * belongs with the thing that built it.
   */
  function paint(rect: CssRect | null): void {
    paintSelection(
      { surface, veils, frame, readout, hint, frozen },
      {
        rect,
        viewport,
        scale,
        handles,
        rules,
        // Handles appear once the drag settles; drawing them mid-drag is noise.
        showHandles: mode === 'region' && !drawing,
        reported:
          mode === 'element' && elementRect ? reportedSize(elementRect, viewport) : null,
      },
    )
  }

  /** Strips the selection chrome, leaving the shadow root for the editor. */
  function clearChrome(): void {
    for (const node of [surface, ...veils, ...handles.nodes, ...rules.nodes, frame, readout, hint]) {
      node.remove()
    }
    loupe?.element.remove()
  }

  /**
   * Stops listening, without tearing the host down.
   *
   * Called the moment a capture is handed to the editor. The host must stay —
   * the editor mounts into its shadow root — but the overlay's own keys and
   * pointer handling are finished, and leaving them attached meant the editor
   * never saw them: Enter re-committed the capture instead of sending it, and
   * the arrow keys nudged a selection nobody could see any more.
   */
  function detach(): void {
    surface.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('keydown', onKey, true)
  }

  function destroy(): void {
    live = false
    detach()
    backdropBitmap?.close()
    host.remove()
    active = null
  }

  function paintCandidate(candidate: { rect: CssRect } | null): void {
    // The painted rect is clamped to the viewport because that is all there is
    // to draw on. The FULL rect is kept because a taller-than-viewport element
    // is captured by scrolling, not by cropping (FR-5), and clamping it here
    // was exactly why element capture could only ever return what was visible.
    elementRect = candidate ? candidate.rect : null
    selection = candidate ? clampToViewport(candidate.rect, viewport) : null
    paint(selection)
  }

  /**
   * Captures a tall element by handing its box to the worker (FR-5).
   *
   * The overlay is torn down FIRST and deliberately: the worker is about to
   * scroll the page and take real screenshots, and this overlay is a
   * fixed-position veil covering the whole viewport — leaving it up would
   * stamp it across every tile.
   */
  function commitTallElement(rect: CssRect): void {
    const band = bandFor(rect, viewport, window.scrollY)
    if (!band) {
      console.warn('[Hotshot] the element is entirely off-screen horizontally; capture aborted.')
      destroy()
      return
    }

    destroy()
    void chrome.runtime.sendMessage({ kind: 'capture/element-band', ...band })
  }

  const commit = (rect: CssRect): Promise<void> =>
    commitSelection(rect, phaseTwo.ready, {
      root,
      hint,
      scale,
      backdropUrl: phaseTwo.url,
      live: () => live,
      clearChrome: () => {
        clearChrome()
        // The overlay's keys belong to the editor from here on.
        detach()
      },
      destroy,
    })

  const gestures = createRegionGestures({
    viewport,
    selection: () => selection,
    setSelection: (rect) => {
      selection = rect
    },
    paint,
    showLoupe: (at) => loupe?.show(at),
    hideLoupe: () => loupe?.hide(),
    setDrawing: (value) => {
      drawing = value
    },
  })

  function onDown(event: PointerEvent): void {
    // Element mode has no drag: the pointer only chooses which element.
    if (mode === 'element') return
    gestures.down(event)
  }

  function onMove(event: PointerEvent): void {
    if (mode === 'element') {
      paintCandidate(elements.hover(event.clientX, event.clientY))
      return
    }
    gestures.move(event)
  }

  function onUp(): void {
    if (mode === 'element') {
      if (!selection || selection.width < 2 || selection.height < 2) return
      // A tall element is scrolled and stitched, never silently cropped to
      // what happens to be visible (FR-5).
      if (elementRect && needsScrollCapture(elementRect, viewport)) commitTallElement(elementRect)
      else void commit(selection)
      return
    }
    gestures.up()
  }

  /** Routes a key through the shared keymap; the intents are `overlay-keys`. */
  function onKey(event: KeyboardEvent): void {
    const intent = overlayKeyIntent(event, mode)
    if (!intent) return

    if (intent.kind === 'cancel') {
      event.preventDefault()
      event.stopPropagation()
      return destroy()
    }

    if (intent.kind === 'walk') {
      event.preventDefault()
      event.stopPropagation()
      return paintCandidate(elements.walk(intent.direction))
    }

    if (intent.kind === 'nudge') {
      // `adjustSelection` owns FR-35's 1px / 10px / move-vs-resize rules.
      if (!selection) return
      const adjusted = adjustSelection(selection, event, viewport)
      if (!adjusted) return
      event.preventDefault()
      selection = adjusted
      return paint(selection)
    }

    if (!selection) return
    event.preventDefault()
    event.stopPropagation()
    // Same routing as a click: a tall element is scrolled and stitched, never
    // silently cropped to what happens to be visible (FR-5).
    if (mode === 'element' && elementRect && needsScrollCapture(elementRect, viewport)) {
      commitTallElement(elementRect)
    } else {
      void commit(selection)
    }
  }

  surface.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey, true)

  active = { destroy }

  // FR-1 phase 1: dim the page NOW. The veils have no geometry until they are
  // positioned, so without this the first frame was an invisible overlay — the
  // hotkey looked like it had done nothing until the pointer moved.
  paint(null)
}
