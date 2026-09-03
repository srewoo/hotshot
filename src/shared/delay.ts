/**
 * Capture delay (PRD FR-4).
 *
 * A delay is chosen PER CAPTURE, not configured once and left on: the reason
 * to want one — opening a hover state or a menu that vanishes on click — is
 * true of one capture in fifty, and a delay that silently applies to every
 * capture is a booby trap. Settings still carries a default for the keyboard
 * commands, which cannot express a choice.
 */

export const DELAY_CHOICES = [0, 3, 5, 10] as const
export type DelaySeconds = (typeof DELAY_CHOICES)[number]

export function isDelaySeconds(value: unknown): value is DelaySeconds {
  return DELAY_CHOICES.includes(value as DelaySeconds)
}

/**
 * The delay to actually use.
 *
 * An explicit per-capture choice always wins, INCLUDING an explicit zero —
 * that is the difference between "no preference" and "no delay", and treating
 * them alike is how a stored default resurrects itself after the user has
 * turned it off for this capture.
 */
export function resolveDelay(requested: unknown, fallback: unknown): DelaySeconds {
  if (isDelaySeconds(requested)) return requested
  return isDelaySeconds(fallback) ? fallback : 0
}

/** Human label for a choice, used by the popup and Settings alike. */
export function delayLabel(seconds: DelaySeconds): string {
  return seconds === 0 ? 'None' : `${seconds}s`
}
