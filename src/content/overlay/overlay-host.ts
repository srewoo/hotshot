import { clampToViewport, moveBy, rectFromDrag, resizeBy, type Handle, type Point } from './selection-rect'
import { adjustSelection } from './selection-keys'
import { handleAtPoint } from './handle-hit'
import { buildHandles } from './handles-view'
import { buildLoupe } from './loupe-view'
import { buildDimensionRules } from './dimension-rule'
import { HOTSHOT_HOST_ATTRIBUTE } from './element-chain'
import { createElementMode } from './element-mode'
import { toDeviceRect, type CssRect } from '../../shared/geometry/device-rect'
import { requestBackdrop } from './backdrop-request'
import { cropToBitmap } from './crop'
import { handoffToEditor } from './editor-handoff'
import type { CaptureMode } from '../../shared/messaging/protocol'
import { buildChrome, TOKENS } from './overlay-chrome'
import { coverAll, frameSelection } from './veil-view'

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

export async function mountOverlay(mode: CaptureMode): Promise<void> {
  // A second hotkey press replaces the overlay rather than stacking one.
  active?.destroy()

  if (mode !== 'region' && mode !== 'element') {
    // Full-page capture arrives with the offscreen tile scheduler (stage 8);
    // refusing loudly beats silently capturing the wrong thing.
    console.warn(`[Hotshot] capture mode "${mode}" is not implemented yet.`)
    return
  }

  const backdrop = await requestBackdrop()
  if (!backdrop) {
    console.error('[Hotshot] could not read the page pixels; capture aborted.')
    return
  }

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

  const { surface, veils, frame, readout, hint } = buildChrome(
    mode === 'element'
      ? 'hover an element · [ ] to adjust · click to capture · esc cancel'
      : 'drag to select · esc cancel',
  )

  root.append(surface, ...veils, frame, readout, hint)
  document.documentElement.append(host)

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  // Both factors come from the service worker, sampled at the instant the
  // backdrop was captured (FR-40). Reading them here would risk disagreeing
  // with the bitmap we are about to crop.
  const scale = { zoom: backdrop.zoom, dpr: backdrop.dpr }
  const backdropUrl = backdrop.dataUrl
  let anchor: Point | null = null
  let selection: CssRect | null = null
  let drawing = false
  let dragOrigin: Point | null = null

  const elements = createElementMode(root, viewport)

  const handles = buildHandles()
  const rules = buildDimensionRules()
  // The loupe reads the same bitmap the crop is cut from (review finding B2).
  const backdropBitmap = await createImageBitmap(await (await fetch(backdrop.dataUrl)).blob())
  const loupe = buildLoupe(backdropBitmap, { zoom: backdrop.zoom, dpr: backdrop.dpr }, viewport)
  root.append(...handles.nodes, ...rules.nodes, loupe.element)
  let activeHandle: Handle | null = null

  function paint(rect: CssRect | null): void {
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

    // Handles appear once the drag settles; drawing them mid-drag is noise.
    if (mode === 'region' && !drawing) handles.show(rect)
    else handles.hide()
    rules.update(rect)

    const device = toDeviceRect(rect, scale)
    readout.style.display = 'block'
    readout.innerHTML =
      `${Math.round(width)} × ${Math.round(height)}` +
      (scale.dpr !== 1 ? ` <span style="color:${TOKENS.flare}">@${scale.dpr}x</span>` : '') +
      (scale.zoom !== 1
        ? ` <span style="color:${TOKENS.flare}">${Math.round(scale.zoom * 100)}%</span>`
        : '')
    // Dock below the selection; flip above when that would leave the viewport.
    const below = y + height + 6
    readout.style.left = `${x}px`
    readout.style.top = below + 24 > viewport.height ? `${Math.max(0, y - 28)}px` : `${below}px`
    void device
  }

  /** Strips the selection chrome, leaving the shadow root for the editor. */
  function clearChrome(): void {
    surface.remove()
    for (const veil of veils) veil.remove()
    for (const node of [...handles.nodes, ...rules.nodes]) node.remove()
    loupe.element.remove()
    frame.remove()
    readout.remove()
    hint.remove()
  }

  function destroy(): void {
    surface.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('keydown', onKey, true)
    backdropBitmap.close()
    host.remove()
    active = null
  }

  function paintCandidate(candidate: { rect: CssRect } | null): void {
    selection = candidate ? clampToViewport(candidate.rect, viewport) : null
    paint(selection)
  }

  function onDown(event: PointerEvent): void {
    if (mode === 'element') return
    const at = { x: event.clientX, y: event.clientY }

    // An existing selection can be resized or moved rather than restarted —
    // FR-34 treats one imprecise drag forcing a restart as a bug.
    if (selection) {
      const handle = handleAtPoint(selection, at)
      if (handle) {
        activeHandle = handle
        dragOrigin = at
        return
      }
      const inside =
        at.x >= selection.x &&
        at.x <= selection.x + selection.width &&
        at.y >= selection.y &&
        at.y <= selection.y + selection.height
      if (inside) {
        dragOrigin = at
        return
      }
    }

    drawing = true
    anchor = at
    selection = null
    paint(null)
  }

  function onMove(event: PointerEvent): void {
    if (mode === 'element') {
      paintCandidate(elements.hover(event.clientX, event.clientY))
      return
    }
    const at = { x: event.clientX, y: event.clientY }

    if (selection && dragOrigin) {
      const dx = at.x - dragOrigin.x
      const dy = at.y - dragOrigin.y
      selection = activeHandle
        ? resizeBy(selection, activeHandle, dx, dy, viewport)
        : moveBy(selection, dx, dy, viewport)
      dragOrigin = at
      paint(selection)
      return
    }

    if (!anchor) return
    // The loupe appears only during a drag: pixel placement is the only time
    // it earns its space.
    loupe.show(at)
    selection = clampToViewport(rectFromDrag(anchor, at), viewport)
    paint(selection)
  }

  async function commit(rect: CssRect): Promise<void> {
    const device = toDeviceRect(rect, scale)
    const bitmap = await cropToBitmap(backdropUrl, device)
    clearChrome()
    await handoffToEditor(root, bitmap, device, destroy)
  }

  function onUp(): void {
    if (dragOrigin) {
      dragOrigin = null
      activeHandle = null
      paint(selection)
      return
    }
    drawing = false
    loupe.hide()

    if (mode === 'element') {
      if (selection && selection.width >= 2 && selection.height >= 2) void commit(selection)
      return
    }
    if (!anchor || !selection || selection.width < 2 || selection.height < 2) {
      anchor = null
      selection = null
      paint(null)
      return
    }
    anchor = null
    // The selection stays live so it can be adjusted; Enter commits it.
    paint(selection)
  }

  function onKey(event: KeyboardEvent): void {
    if (mode === 'region' && event.key === 'Enter' && selection) {
      event.preventDefault()
      event.stopPropagation()
      void commit(selection)
      return
    }

    if (mode === 'region' && selection && event.key.startsWith('Arrow')) {
      const adjusted = adjustSelection(selection, event, viewport)
      if (adjusted) {
        event.preventDefault()
        selection = adjusted
        paint(selection)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      destroy()
      return
    }

    if (mode === 'element' && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
      // Dispatch on `event.code`, not `event.key`: bare-letter and bracket
      // bindings otherwise break on AZERTY and Dvorak (FR-44).
      event.preventDefault()
      event.stopPropagation()
      paintCandidate(elements.walk(event.code === 'BracketRight' ? 'out' : 'in'))
      return
    }

    if (mode === 'element' && event.key === 'Enter' && selection) {
      event.preventDefault()
      event.stopPropagation()
      void commit(selection)
    }
  }

  surface.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey, true)

  active = { destroy }
}
