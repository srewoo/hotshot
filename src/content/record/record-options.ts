import type { RecordMode } from './recording-state'

/**
 * What a recording captures, beyond the screen (PRD §10 v1.1).
 *
 * Every option here is LOCAL. Microphone and camera streams are composited in
 * the page and encoded in the page; nothing is uploaded, transcribed, or given
 * a share link, and there is deliberately no code here that could. That is the
 * line the product draws: motion is a feature, a media backend is not.
 */

export interface RecordOptions {
  /** The tab's own audio, offered by Chrome's share picker. */
  readonly tabAudio: boolean
  /** The microphone, via `getUserMedia`. Needs its own permission prompt. */
  readonly microphone: boolean
  /** A camera bubble composited into a corner. */
  readonly webcam: boolean
}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = {
  tabAudio: false,
  microphone: false,
  webcam: false,
}

/**
 * Whether the recording needs a canvas compositing pass.
 *
 * Straight screen capture can go from `getDisplayMedia` into `MediaRecorder`
 * untouched, which is cheaper and higher quality. A webcam bubble has to be
 * drawn over the screen frames, and that means a canvas — so the pipeline is
 * chosen from the options rather than always paying for compositing.
 */
export function needsCompositing(mode: RecordMode, options: RecordOptions): boolean {
  // GIF always samples onto a canvas anyway.
  return mode === 'gif' || options.webcam
}

/** Constraints for the screen share, including tab audio when asked for. */
export function displayConstraints(options: RecordOptions): MediaStreamConstraints {
  return {
    video: { frameRate: { ideal: 30 } },
    // Chrome only offers tab audio when the request asks for it, and the user
    // still has to tick "share tab audio" in the picker — so this widens what
    // is possible, never what happens without a decision.
    audio: options.tabAudio,
  }
}

/** Constraints for the microphone, or null when it was not asked for. */
export function microphoneConstraints(options: RecordOptions): MediaStreamConstraints | null {
  if (!options.microphone) return null
  return {
    audio: {
      // Voice-over on a screen recording: the room is the problem, not the
      // fidelity, so the browser's own cleanup is exactly what is wanted.
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  }
}

export function webcamConstraints(options: RecordOptions): MediaStreamConstraints | null {
  if (!options.webcam) return null
  // Small on purpose: the bubble is rendered at a couple of hundred pixels, and
  // asking for 1080p would spend a core on frames that are then thrown away.
  return { video: { width: { ideal: 480 }, height: { ideal: 480 } }, audio: false }
}

export interface BubbleRect {
  readonly x: number
  readonly y: number
  readonly size: number
}

/** How much of the frame's short edge the bubble occupies. */
export const BUBBLE_FRACTION = 0.18
export const BUBBLE_MARGIN_FRACTION = 0.02

/**
 * Where the camera bubble sits in the composited frame.
 *
 * Bottom-left, and sized from the SHORT edge so it stays the same visual
 * weight on a tall window and a wide one. Bottom-left rather than
 * bottom-right because that is where Chrome's own "sharing this tab" bar and
 * most site chat widgets are not.
 */
export function bubbleRect(frame: { width: number; height: number }): BubbleRect {
  const short = Math.min(frame.width, frame.height)
  const size = Math.max(48, Math.round(short * BUBBLE_FRACTION))
  const margin = Math.round(short * BUBBLE_MARGIN_FRACTION)
  return { x: margin, y: frame.height - size - margin, size }
}

/** Human summary for the record bar, so what is being captured is never a guess. */
export function describeOptions(options: RecordOptions): string {
  const parts = [
    options.tabAudio ? 'tab audio' : null,
    options.microphone ? 'mic' : null,
    options.webcam ? 'camera' : null,
  ].filter(Boolean)
  return parts.length === 0 ? 'screen only' : `screen + ${parts.join(' + ')}`
}
