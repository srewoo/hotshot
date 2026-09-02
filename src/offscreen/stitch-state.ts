/**
 * Lifecycle of one full-page stitch (PRD FR-31).
 *
 * A 20,000px page takes ~17 seconds. Aborting that must never silently bin the
 * work already done, so the first cancel STOPS AND KEEPS the partial and only
 * a second discards it. Quota exhaustion takes the same path: partial delivery
 * is a documented normal outcome, not an error — the throttle is the
 * scheduler's design basis, so running into it is expected.
 */

export type StitchState = 'capturing' | 'complete' | 'stopped-kept' | 'discarded'

export interface StitchSession {
  state(): StitchState
  captured(): number
  /** Whether the capture loop should take another tile. */
  running(): boolean
  /** Whether there is a partial worth handing to the user. */
  shouldDeliver(): boolean
  /** Warning text for a partial delivery, or null when complete. */
  summary(): string | null
  tileDone(): void
  cancel(): void
  quotaExhausted(): void
}

export function createStitchSession(total: number): StitchSession {
  let state: StitchState = 'capturing'
  let captured = 0

  function stopKeeping(): void {
    // Nothing captured means there is no partial — delivering a zero-tile
    // image would be a blank PNG presented to the user as their capture.
    state = captured > 0 ? 'stopped-kept' : 'discarded'
  }

  return {
    state: () => state,
    captured: () => captured,
    running: () => state === 'capturing',
    shouldDeliver: () => state === 'complete' || state === 'stopped-kept',

    summary: () => (state === 'complete' ? null : `captured ${captured} of ${total} tiles`),

    tileDone() {
      if (state !== 'capturing') return
      captured++
      if (captured >= total) state = 'complete'
    },

    cancel() {
      if (state === 'capturing') stopKeeping()
      else if (state === 'stopped-kept') state = 'discarded'
    },

    quotaExhausted() {
      if (state === 'capturing') stopKeeping()
    },
  }
}
