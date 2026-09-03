import {
  cascadeOrigin,
  clampPinPosition,
  clampPinSize,
  GHOST_OPACITY,
  MAX_PINS_PER_TAB,
  pinNumbers,
  restack,
  withinMemoryBudget,
  type PinRect,
  type Size,
} from './pin-layout'
import { buildPinView, type PinView } from './pin-view'
import { displaySizeFor, renderPinImage } from './pin-mipmap'
import { bindPinGestures } from './pin-gestures'
import { cropBlob } from './pin-crop'

/**
 * The pins on a page, as a set (PRD FR-37/FR-38, DESIGN §3.9).
 *
 * One pin's DOM is `pin-view` and its gestures are `pin-gestures`; the
 * geometry is `pin-layout`. This owns what only makes sense across pins: the
 * stack order and its numbering, focus cycling, the memory ceiling that keeps
 * a tab out of OOM, and the undo that makes dismissal safe.
 */

const DEFAULT_WIDTH_PX = 520

interface Pin {
  readonly id: string
  readonly view: PinView
  readonly natural: Size
  readonly url: string
  /** The full-resolution capture, kept so a crop and an undo stay lossless. */
  readonly source: Blob
  rect: PinRect
  opacity: number
}

const pins = new Map<string, Pin>()
/** Back to front. The last id paints on top. */
let order: readonly string[] = []
let focused: string | null = null

/**
 * The last dismissed pin, restorable for a short while.
 *
 * Dismissal is one keypress on a pin that took a capture, a crop and an
 * annotation to produce — and Escape sits next to the arrow keys that move it.
 * Without an undo, a slip destroys all of that silently.
 */
export const DISMISS_UNDO_MS = 8_000
let lastDismissed: { source: Blob; rect: PinRect; opacity: number; at: number } | null = null

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

function repaintStack(): void {
  const numbers = pinNumbers(order)
  for (const [index, id] of order.entries()) {
    const pin = pins.get(id)
    if (!pin) continue
    pin.view.setStackIndex(index)
    pin.view.setNumber(numbers[id] as number)
    pin.view.setActive(id === focused)
  }
}

export function pinCount(): number {
  return pins.size
}

export function dismissAllPins(): void {
  for (const pin of pins.values()) {
    URL.revokeObjectURL(pin.url)
    pin.view.destroy()
  }
  pins.clear()
  order = []
  focused = null
}

function removePin(id: string, options: { silent?: boolean } = {}): void {
  const pin = pins.get(id)
  if (!pin) return

  // A crop replaces a pin rather than dismissing it, so it must not overwrite
  // the undo slot — cropping would otherwise discard the user's last real
  // dismissal and offer to restore something they never lost.
  if (!options.silent) {
    lastDismissed = { source: pin.source, rect: pin.rect, opacity: pin.opacity, at: Date.now() }
  }

  URL.revokeObjectURL(pin.url)
  pin.view.destroy()
  pins.delete(id)
  order = order.filter((entry) => entry !== id)
  if (focused === id) focused = order[order.length - 1] ?? null
  repaintStack()
  if (focused) pins.get(focused)?.view.host.focus({ preventScroll: true })
}

/** Restores the most recently dismissed pin, if the window has not passed. */
export async function undoDismiss(now = Date.now()): Promise<boolean> {
  if (!lastDismissed || now - lastDismissed.at > DISMISS_UNDO_MS) return false
  const { source, rect, opacity } = lastDismissed
  lastDismissed = null
  return await addPin(source, { rect, opacity })
}

/** Moves focus between pins, so a pin is reachable without a pointer. */
export function cycleFocus(direction: 1 | -1 = 1): boolean {
  if (order.length === 0) return false
  const at = focused ? order.indexOf(focused) : -1
  // The doubled length keeps the modulo positive when arrowing backwards from
  // the first pin, which is the wrap a focus ring is expected to have.
  const next = order[(at + direction + order.length * 2) % order.length]
  if (!next) return false
  focused = next
  repaintStack()
  pins.get(next)?.view.host.focus({ preventScroll: true })
  return true
}

export interface AddPinOptions {
  /** Restores an exact position, used by undo and by crop. */
  readonly rect?: PinRect | undefined
  readonly opacity?: number | undefined
}

export async function addPin(blob: Blob, options: AddPinOptions = {}): Promise<boolean> {
  const probe = await createImageBitmap(blob)
  const natural: Size = { width: probe.width, height: probe.height }
  probe.close()

  const size = options.rect
    ? { width: options.rect.width, height: options.rect.height }
    : clampPinSize(natural, Math.min(1, DEFAULT_WIDTH_PX / natural.width))

  // Refuse rather than risk a renderer OOM, which the user experiences as
  // "Chrome crashed" and never attributes to us (R-10).
  const sizes = [...[...pins.values()].map((pin) => pin.rect), size]
  if (pins.size >= MAX_PINS_PER_TAB || !withinMemoryBudget(sizes, 1)) {
    console.warn(`[Hotshot] pin refused: at most ${MAX_PINS_PER_TAB} pins per tab.`)
    return false
  }

  // Rendered down through a mipmap chain: a pin's whole job is to stay
  // legible, and a single-step browser downscale is what makes it not.
  const url = URL.createObjectURL(await renderPinImage(blob, displaySizeFor(natural)))

  const id = `pin${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const view = buildPinView(url)
  const origin = options.rect ?? cascadeOrigin(pins.size)
  const pin: Pin = {
    id,
    view,
    natural,
    url,
    source: blob,
    rect: { x: origin.x, y: origin.y, width: size.width, height: size.height },
    opacity: options.opacity ?? 1,
  }

  pins.set(id, pin)
  order = [...order, id]
  focused = id

  bindPinGestures({
    view,
    natural,
    rect: () => pin.rect,
    place(rect) {
      pin.rect = rect
      view.place(rect)
    },
    opacity: () => pin.opacity,
    setOpacity(level) {
      pin.opacity = level
      view.setOpacity(level)
    },
    viewport,

    bringToFront() {
      focused = id
      order = restack(order, id, 'front')
      repaintStack()
    },
    restack(move) {
      order = restack(order, id, move)
      repaintStack()
    },
    cycleFocus,
    dismiss: () => removePin(id),

    applyCrop(selection, region) {
      void (async () => {
        try {
          const cropped = await cropBlob(pin.source, region)
          // Sized to the marquee the user drew, not to the source region: the
          // pin stays where it was and the same size on screen it was cropped
          // at. Using the source size made a crop of a downscaled pin jump to
          // the capture's own resolution.
          const rect = {
            x: pin.rect.x + selection.x,
            y: pin.rect.y + selection.y,
            width: Math.round(selection.width),
            height: Math.round(selection.height),
          }
          // Replaces this pin rather than adding one: a crop changes the
          // reference you are keeping, it does not create a second one.
          removePin(id, { silent: true })
          await addPin(cropped, {
            rect: { ...rect, ...clampPinPosition(rect, viewport()) },
            opacity: pin.opacity,
          })
        } catch (error: unknown) {
          // A swallowed rejection here is the worst outcome: the user drags a
          // marquee and nothing happens, with no reason given.
          console.error(
            `[Hotshot] the pin could not be cropped: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      })()
    },
  })

  // A window resize can leave a pin off-screen, which makes it unrecoverable.
  const onResize = (): void => {
    pin.rect = { ...pin.rect, ...clampPinPosition(pin.rect, viewport()) }
    view.place(pin.rect)
  }
  window.addEventListener('resize', onResize)

  view.place(pin.rect)
  view.setOpacity(pin.opacity)
  document.documentElement.append(view.host)
  repaintStack()
  view.host.focus({ preventScroll: true })
  return true
}

export { GHOST_OPACITY }
