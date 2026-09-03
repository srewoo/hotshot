/**
 * Trimming a finished recording (PRD §10 v1.1).
 *
 * The first and last few seconds of a screen recording are almost always the
 * user finding the record button and then finding the stop button. Trimming is
 * what turns a 40-second clip into the 12 seconds that show the bug.
 *
 * The arithmetic is here and pure. Applying it differs by format: a GIF is a
 * list of frames and trimming is a slice, while a WebM has to be replayed and
 * re-encoded, which is `recorder-trim.ts`.
 */

export interface TrimRange {
  readonly startMs: number
  readonly endMs: number
}

/** A trim shorter than this is a mis-drag, not an edit. */
export const MIN_TRIM_MS = 250

export function fullRange(durationMs: number): TrimRange {
  return { startMs: 0, endMs: Math.max(0, durationMs) }
}

/**
 * Clamps a requested range into the recording, keeping it ordered.
 *
 * Handles the reversed drag — someone pulling the out-point past the in-point —
 * by swapping rather than by producing a negative duration that would encode
 * as an empty file.
 */
export function clampRange(range: TrimRange, durationMs: number): TrimRange {
  const duration = Math.max(0, durationMs)
  const a = Math.min(Math.max(0, range.startMs), duration)
  const b = Math.min(Math.max(0, range.endMs), duration)
  const [startMs, endMs] = a <= b ? [a, b] : [b, a]
  return { startMs, endMs }
}

export function rangeDurationMs(range: TrimRange): number {
  return Math.max(0, range.endMs - range.startMs)
}

export function isTrimmed(range: TrimRange, durationMs: number): boolean {
  const clamped = clampRange(range, durationMs)
  return clamped.startMs > 0 || clamped.endMs < Math.max(0, durationMs)
}

export function isUsableRange(range: TrimRange, durationMs: number): boolean {
  return rangeDurationMs(clampRange(range, durationMs)) >= MIN_TRIM_MS
}

/**
 * Which frames of a fixed-rate capture fall inside the range.
 *
 * Inclusive of the frame at `startMs` and exclusive of the one at `endMs`, so
 * two adjacent trims of the same recording cannot both claim the same frame.
 */
export function frameRange(
  range: TrimRange,
  frameCount: number,
  delayMs: number,
): { readonly from: number; readonly to: number } {
  if (delayMs <= 0 || frameCount <= 0) return { from: 0, to: frameCount }
  const from = Math.min(frameCount, Math.max(0, Math.floor(range.startMs / delayMs)))
  const to = Math.min(frameCount, Math.max(from, Math.ceil(range.endMs / delayMs)))
  return { from, to }
}

/** mm:ss.t — tenths, because a trim handle moves in fractions of a second. */
export function formatPosition(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = Math.floor(clamped / 1000)
  const tenths = Math.floor((clamped % 1000) / 100)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}.${tenths}`
}
