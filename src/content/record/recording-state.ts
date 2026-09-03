/**
 * Recording lifecycle for video and GIF (PRD §10, v1.1).
 *
 * Duration caps are a correctness requirement, not politeness: an unbounded
 * recording fills the renderer and the tab dies as "Chrome crashed", which
 * users never attribute to the extension — the same failure mode as R-10.
 */

export type RecordMode = 'video' | 'gif'
export type RecordState = 'idle' | 'recording' | 'paused' | 'stopped' | 'cancelled'

/** WebM/VP9 compresses well, so five minutes is affordable. */
export const VIDEO_MAX_MS = 5 * 60_000

/** GIF is palette-limited and barely compressed; a 60s GIF is enormous. */
export const GIF_MAX_MS = 60_000

const CAPS: Record<RecordMode, number> = { video: VIDEO_MAX_MS, gif: GIF_MAX_MS }

export interface RecordingSession {
  state(): RecordState
  start(now: number): void
  /**
   * Pauses the clock as well as the recorder.
   *
   * Paused time must not count against the cap: a five-minute cap that
   * includes the four minutes you were paused is a cap that cuts you off
   * mid-sentence with no explanation.
   */
  pause(now: number): void
  resume(now: number): void
  stop(now: number): void
  cancel(): void
  elapsedMs(now: number): number
  remainingMs(now: number): number
  /** True once the cap is reached — stop AT the cap, keeping what was recorded. */
  shouldAutoStop(now: number): boolean
  shouldDeliver(): boolean
  /** mm:ss for the recording badge. */
  label(now: number): string
}

export function createRecordingSession(mode: RecordMode): RecordingSession {
  const cap = CAPS[mode]
  let state: RecordState = 'idle'
  /** When the CURRENT run began; earlier runs are already in `accruedMs`. */
  let startedAt = 0
  /** Time from completed runs, so a pause does not restart the clock. */
  let accruedMs = 0
  let frozenMs = 0

  function elapsed(now: number): number {
    if (state === 'idle') return 0
    if (state === 'recording') return accruedMs + Math.max(0, now - startedAt)
    if (state === 'paused') return accruedMs
    return frozenMs
  }

  return {
    state: () => state,

    start(now) {
      state = 'recording'
      startedAt = now
      accruedMs = 0
      frozenMs = 0
    },

    pause(now) {
      if (state !== 'recording') return
      accruedMs += Math.max(0, now - startedAt)
      state = 'paused'
    },

    resume(now) {
      if (state !== 'paused') return
      startedAt = now
      state = 'recording'
    },

    stop(now) {
      // Stopping from a pause keeps what was recorded, which is the whole
      // reason to allow it: "pause, think, decide it is enough".
      if (state !== 'recording' && state !== 'paused') return
      frozenMs = elapsed(now)
      state = 'stopped'
    },

    cancel() {
      state = 'cancelled'
    },

    elapsedMs: elapsed,

    remainingMs: (now) => Math.max(0, cap - elapsed(now)),

    shouldAutoStop: (now) => state === 'recording' && elapsed(now) >= cap,

    // A zero-length recording is a broken file, not a short one.
    shouldDeliver: () => state === 'stopped' && frozenMs > 0,

    label(now) {
      const total = Math.floor(elapsed(now) / 1000)
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
    },
  }
}

export interface EstimateInput {
  readonly mode: RecordMode
  readonly ms: number
  readonly width: number
  readonly height: number
}

/**
 * Rough size estimate, used to warn before a recording becomes unusable.
 *
 * Deliberately crude — these are order-of-magnitude numbers for a warning, and
 * presenting them as precise would be worse than presenting them as rough.
 */
export function estimateBytes({ mode, ms, width, height }: EstimateInput): number {
  if (ms <= 0) return 0
  const seconds = ms / 1000
  const megapixels = (width * height) / 1_000_000

  // VP9 at a middling quality: ~0.6 MB per megapixel-second.
  if (mode === 'video') return Math.round(seconds * megapixels * 0.6 * 1_024 * 1_024)

  // GIF: 256-colour frames at ~10fps, LZW giving maybe 3x. Far heavier per
  // second than video, which is exactly why its cap is a minute.
  return Math.round(seconds * megapixels * 10 * 0.33 * 1_024 * 1_024)
}
