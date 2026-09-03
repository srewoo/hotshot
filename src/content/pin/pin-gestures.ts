import {
  clampPinPosition,
  nextOpacity,
  resizePinFromCorner,
  snapPinPosition,
  type PinCorner,
  type PinRect,
  type Size,
  type StackMove,
  type Viewport,
} from './pin-layout'
import { pinKeyIntent } from './pin-keys'
import {
  cropFromDrag,
  cropToSourceRect,
  isMeaningfulCrop,
  type CropSelection,
} from './pin-crop'
import type { PinView } from './pin-view'

/**
 * One pin's interaction: drag, resize, crop, and its keymap (FR-37/FR-38).
 *
 * Split from `pin-controller` the way `mark-editing` is split from the editor:
 * the controller owns the pins as a SET — the stack, the numbering, the memory
 * ceiling, the undo — and this owns what happens to one of them under a
 * pointer. The dependencies are narrow on purpose, so the gesture state
 * machine can be read without the registry in your head.
 */

export interface PinGestureDeps {
  readonly view: PinView
  /** The pin's live geometry and capture, read and written through `place`. */
  readonly natural: Size
  rect(): PinRect
  place(rect: PinRect): void
  opacity(): number
  setOpacity(level: number): void
  viewport(): Viewport
  /** Interacting brings a pin to the front, as every window manager does. */
  bringToFront(): void
  restack(move: StackMove): void
  cycleFocus(direction: 1 | -1): void
  dismiss(): void
  /** Replaces this pin with the selected region of its own capture. */
  applyCrop(selection: CropSelection, region: PinRect): void
}

type Gesture =
  | { readonly kind: 'none' }
  | { readonly kind: 'drag'; readonly offsetX: number; readonly offsetY: number }
  | {
      readonly kind: 'resize'
      readonly corner: PinCorner
      readonly from: { x: number; y: number }
      readonly start: PinRect
    }
  | { readonly kind: 'crop'; readonly from: { x: number; y: number } }

export function bindPinGestures(deps: PinGestureDeps): void {
  const { view } = deps
  let gesture: Gesture = { kind: 'none' }
  /** Armed by `C`; the next drag inside the pin selects a region. */
  let cropping = false

  /** Pointer position relative to the pin's own top-left. */
  function localPoint(event: PointerEvent): { x: number; y: number } {
    const box = view.host.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }

  view.host.addEventListener('pointerdown', (event) => {
    deps.bringToFront()

    const target = event.target as HTMLElement
    const corner = target.dataset?.hotshotCorner as PinCorner | undefined
    view.host.setPointerCapture(event.pointerId)

    if (cropping && !corner) {
      const from = localPoint(event)
      gesture = { kind: 'crop', from }
      view.showCrop({ ...from, width: 0, height: 0 })
      return
    }

    if (corner) {
      gesture = {
        kind: 'resize',
        corner,
        from: { x: event.clientX, y: event.clientY },
        start: deps.rect(),
      }
      return
    }

    const local = localPoint(event)
    gesture = { kind: 'drag', offsetX: local.x, offsetY: local.y }
    view.host.style.cursor = 'grabbing'
  })

  view.host.addEventListener('pointermove', (event) => {
    if (gesture.kind === 'none') return

    if (gesture.kind === 'crop') {
      view.showCrop(cropFromDrag(gesture.from, localPoint(event)))
      return
    }

    if (gesture.kind === 'drag') {
      const moved = {
        ...deps.rect(),
        x: event.clientX - gesture.offsetX,
        y: event.clientY - gesture.offsetY,
      }
      // Snap first, then clamp: snapping to an edge must not be undone by a
      // clamp, and clamping must have the last word on reachability.
      const snapped = { ...moved, ...snapPinPosition(moved, deps.viewport()) }
      deps.place({ ...snapped, ...clampPinPosition(snapped, deps.viewport()) })
      return
    }

    const next = resizePinFromCorner(
      gesture.start,
      deps.natural,
      gesture.corner,
      event.clientX - gesture.from.x,
      event.clientY - gesture.from.y,
    )
    deps.place({ ...next, ...clampPinPosition(next, deps.viewport()) })
  })

  function endGesture(event: PointerEvent): void {
    if (gesture.kind === 'crop') {
      const selection = cropFromDrag(gesture.from, localPoint(event))
      view.hideCrop()
      cropping = false
      view.host.style.cursor = 'grab'
      gesture = { kind: 'none' }
      if (isMeaningfulCrop(selection)) {
        deps.applyCrop(selection, cropToSourceRect(selection, deps.rect(), deps.natural))
      }
      return
    }

    gesture = { kind: 'none' }
    view.host.style.cursor = 'grab'
    if (view.host.hasPointerCapture(event.pointerId)) {
      view.host.releasePointerCapture(event.pointerId)
    }
  }
  view.host.addEventListener('pointerup', endGesture)
  view.host.addEventListener('pointercancel', endGesture)

  view.host.addEventListener('keydown', (event) => {
    const intent = pinKeyIntent(event)
    if (!intent) return
    event.preventDefault()

    switch (intent.kind) {
      case 'dismiss':
        return deps.dismiss()
      case 'crop':
        cropping = !cropping
        // The cursor is the only affordance for an armed mode on a pin that
        // deliberately has no toolbar.
        view.host.style.cursor = cropping ? 'crosshair' : 'grab'
        return
      case 'opacity':
        return deps.setOpacity(intent.level)
      case 'cycle-opacity':
        return deps.setOpacity(nextOpacity(deps.opacity()))
      case 'stack':
        return deps.restack(intent.move)
      case 'focus':
        return deps.cycleFocus(intent.direction)
      case 'nudge': {
        const rect = deps.rect()
        const moved = { ...rect, x: rect.x + intent.dx, y: rect.y + intent.dy }
        return deps.place({ ...moved, ...clampPinPosition(moved, deps.viewport()) })
      }
    }
  })
}
