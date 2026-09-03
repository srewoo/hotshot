/**
 * Pin geometry and resource limits (PRD FR-37/FR-38, DESIGN §3.9).
 *
 * A pin is persistent furniture on someone else's page. These rules are what
 * keep it useful without becoming hostile: it never distorts the capture, it
 * never renders an illegible smear, and it can never exhaust the tab's
 * renderer — an OOM presents to users as "Chrome crashed" (R-10), so the cap
 * is a tested hard limit rather than an aspiration.
 */

export interface Size {
  readonly width: number
  readonly height: number
}

export type DisplayForm = 'plate' | 'chip'

export const MAX_PINS_PER_TAB = 4
export const CASCADE_STEP_PX = 24

/** Below this on either axis the image is a smear, so the pin changes form. */
export const COLLAPSE_BELOW_PX = 96

export const MIN_SCALE = 0.25
export const MAX_SCALE = 2

/** FR-38: display bitmap capped at a 2,000px long edge, 64MB per tab. */
export const MAX_PIN_LONG_EDGE_PX = 2_000
export const PIN_MEMORY_CEILING_BYTES = 64 * 1024 * 1024

export const OPACITY_CYCLE: readonly number[] = [1, 0.75, 0.5, 0.25]

/**
 * Below this a pin is a ghost: it stops taking pointer events entirely, so the
 * page underneath is usable through it. That is why the grab tab exists — at
 * this opacity the plate itself can no longer be clicked, and without a tab
 * the pin would be unrecoverable furniture.
 */
export const GHOST_OPACITY = 0.25

/** How close to an edge before a drag snaps to it. */
export const SNAP_THRESHOLD_PX = 12

export interface PinRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Viewport {
  readonly width: number
  readonly height: number
}

export type PinCorner = 'nw' | 'ne' | 'sw' | 'se'

/**
 * Keeps a pin reachable.
 *
 * A pin dragged off-screen — or left behind when the window is made smaller —
 * is furniture the user cannot get back, since it has no entry in any list.
 * Clamping guarantees a grabbable strip stays inside the viewport rather than
 * pinning the whole plate, so a pin can still hang off an edge deliberately.
 */
export function clampPinPosition(
  rect: PinRect,
  viewport: Viewport,
  minVisiblePx = 32,
): { x: number; y: number } {
  const maxX = Math.max(0, viewport.width - minVisiblePx)
  const maxY = Math.max(0, viewport.height - minVisiblePx)
  const minX = Math.min(0, minVisiblePx - rect.width)
  const minY = 0 // Never above the top: the drag handle would be unreachable.
  return {
    x: Math.min(maxX, Math.max(minX, rect.x)),
    y: Math.min(maxY, Math.max(minY, rect.y)),
  }
}

/**
 * Snaps a dragged pin to the viewport edges and centre lines.
 *
 * Only within the threshold, and never at a distance: a pin that leaps across
 * the screen to a guide the user could not see is worse than one that sits
 * two pixels off true.
 */
export function snapPinPosition(
  rect: PinRect,
  viewport: Viewport,
  threshold = SNAP_THRESHOLD_PX,
): { x: number; y: number } {
  const near = (value: number, target: number): boolean => Math.abs(value - target) <= threshold

  let { x, y } = rect
  const centreX = Math.round((viewport.width - rect.width) / 2)
  const centreY = Math.round((viewport.height - rect.height) / 2)

  if (near(x, 0)) x = 0
  else if (near(x + rect.width, viewport.width)) x = viewport.width - rect.width
  else if (near(x, centreX)) x = centreX

  if (near(y, 0)) y = 0
  else if (near(y + rect.height, viewport.height)) y = viewport.height - rect.height
  else if (near(y, centreY)) y = centreY

  return { x, y }
}

/**
 * Resizes from a corner, always preserving aspect ratio.
 *
 * Width drives the change and height follows, so the two can never disagree.
 * A stretched screenshot is a false document, and someone will eventually
 * paste one into a ticket as evidence (FR-38) — which is why there is no
 * unlocked mode at all, not merely a default.
 *
 * The opposite corner is the anchor, so dragging the north-west handle moves
 * the origin instead of the pin appearing to walk across the screen.
 */
export function resizePinFromCorner(
  rect: PinRect,
  natural: Size,
  corner: PinCorner,
  dx: number,
  dy: number,
): PinRect {
  const aspect = natural.width / natural.height
  if (!Number.isFinite(aspect) || aspect <= 0) return rect

  const growsRight = corner === 'ne' || corner === 'se'
  const growsDown = corner === 'se' || corner === 'sw'

  // Both axes are consulted and the LARGER intent wins, converted through the
  // aspect ratio. Using dx alone made a vertical drag on a wide pin feel dead;
  // using whichever axis the hand actually moved keeps the handle responsive
  // in every direction while the ratio stays locked.
  const widthFromX = rect.width + (growsRight ? dx : -dx)
  const widthFromY = (rect.height + (growsDown ? dy : -dy)) * aspect
  const requestedWidth =
    Math.abs(widthFromX - rect.width) >= Math.abs(widthFromY - rect.width)
      ? widthFromX
      : widthFromY

  // Clamped against the CAPTURE's natural size, not the current size, so a
  // pin cannot be grown past MAX_SCALE by repeated small drags.
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, requestedWidth / natural.width))
  const width = Math.round(natural.width * scale)
  const height = Math.round(width / aspect)

  const anchorRight = corner === 'nw' || corner === 'sw'
  const anchorBottom = corner === 'nw' || corner === 'ne'

  return {
    x: anchorRight ? rect.x + rect.width - width : rect.x,
    y: anchorBottom ? rect.y + rect.height - height : rect.y,
    width,
    height,
  }
}

/**
 * The chain of halvings used to downscale a capture for display.
 *
 * One `drawImage` from 2,400px to 300px is a single bilinear sample per output
 * pixel: it discards seven eighths of the source and turns text into grey
 * mush. Halving repeatedly averages the pixels in between, which is what a
 * mipmap is and what makes a small pin readable.
 */
export function mipmapChain(natural: Size, target: Size): readonly Size[] {
  if (target.width <= 0 || target.height <= 0) return []

  const steps: Size[] = []
  let width = natural.width
  let height = natural.height

  // Stop while still at least twice the target: the final draw does the rest,
  // and going below it would upscale.
  while (width > target.width * 2 && height > target.height * 2) {
    width = Math.max(target.width, Math.floor(width / 2))
    height = Math.max(target.height, Math.floor(height / 2))
    steps.push({ width, height })
  }
  steps.push(target)
  return steps
}

/** Where a pin sits in the stack. Front is last, which is what paints on top. */
export type StackMove = 'forward' | 'backward' | 'front' | 'back'

/**
 * Reorders one pin within the stack.
 *
 * Returns a new array; an unknown id returns the order unchanged rather than
 * appending, because appending would silently promote a pin that no longer
 * exists to the front.
 */
export function restack(order: readonly string[], id: string, move: StackMove): readonly string[] {
  const index = order.indexOf(id)
  if (index === -1) return order

  const next = [...order]
  next.splice(index, 1)

  const target =
    move === 'front'
      ? next.length
      : move === 'back'
        ? 0
        : move === 'forward'
          ? Math.min(next.length, index + 1)
          : Math.max(0, index - 1)

  next.splice(target, 0, id)
  return next
}

/** Pin numbers are derived from the stack, so a dismissal renumbers (FR-8's rule). */
export function pinNumbers(order: readonly string[]): Record<string, number> {
  return Object.fromEntries(order.map((id, index) => [id, index + 1]))
}

export function cascadeOrigin(index: number): { x: number; y: number } {
  const offset = (index + 1) * CASCADE_STEP_PX
  return { x: offset, y: offset }
}

export function nextOpacity(current: number): number {
  const index = OPACITY_CYCLE.indexOf(current)
  // An unrecognised value returns to full rather than sticking — a pin the
  // user cannot make opaque again is a pin they cannot use.
  if (index === -1) return OPACITY_CYCLE[0] as number
  return OPACITY_CYCLE[(index + 1) % OPACITY_CYCLE.length] as number
}

/**
 * Scales within the permitted range, always preserving aspect ratio.
 * Shift-drag crops instead of distorting: a stretched screenshot is a false
 * document, and someone will eventually paste one into a ticket as evidence.
 */
export function clampPinSize(natural: Size, scale: number): Size {
  const clamped = Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)
  return {
    width: Math.round(natural.width * clamped),
    height: Math.round(natural.height * clamped),
  }
}

export function displayFormFor(size: Size): DisplayForm {
  return size.width < COLLAPSE_BELOW_PX || size.height < COLLAPSE_BELOW_PX ? 'chip' : 'plate'
}

/** RGBA backing store: 4 bytes per DEVICE pixel, which is where the cost is. */
export function pinMemoryBytes(size: Size, dpr: number): number {
  return size.width * dpr * size.height * dpr * 4
}

export function withinMemoryBudget(pins: readonly Size[], dpr: number): boolean {
  if (pins.length > MAX_PINS_PER_TAB) return false
  const total = pins.reduce((sum, pin) => sum + pinMemoryBytes(pin, dpr), 0)
  return total <= PIN_MEMORY_CEILING_BYTES
}
