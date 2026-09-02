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
