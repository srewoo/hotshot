import { encodeGif } from './gif-encoder'
import { clampRange, frameRange, isTrimmed, isUsableRange, type TrimRange } from './trim'

/**
 * Applying a trim (PRD §10 v1.1).
 *
 * Two formats, two mechanisms, and the difference is worth stating because it
 * is a real cost the user can feel:
 *
 *   GIF   is a list of frames, so a trim is a slice and a re-encode of fewer
 *         frames. Exact and fast.
 *   WebM  has no seekable frame index a page can address, so trimming means
 *         replaying the recording into a canvas and re-encoding what passes.
 *         That takes about as long as the trimmed span itself, and it is a
 *         generational loss — which is why an UNTRIMMED recording is returned
 *         untouched rather than pointlessly round-tripped.
 */

export interface TrimmedGifSource {
  readonly frames: readonly Uint8ClampedArray[]
  readonly width: number
  readonly height: number
  readonly delayMs: number
}

/** Slices a GIF's frames to the range and re-encodes. Exact, no quality loss. */
export function trimGif(source: TrimmedGifSource, range: TrimRange): Blob {
  const durationMs = source.frames.length * source.delayMs
  const { from, to } = frameRange(clampRange(range, durationMs), source.frames.length, source.delayMs)
  const frames = source.frames.slice(from, Math.max(from + 1, to))

  const gif = encodeGif({
    frames,
    width: source.width,
    height: source.height,
    delayMs: source.delayMs,
  })
  // Copied into a fresh ArrayBuffer: a Uint8Array over a possibly-shared
  // buffer is not a valid BlobPart.
  return new Blob([gif.slice().buffer as ArrayBuffer], { type: 'image/gif' })
}

function pickMimeType(): string {
  for (const type of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

/**
 * Re-encodes a WebM between two points.
 *
 * Plays the source into a canvas and records the canvas. The alternative —
 * rewriting the container's cues by hand — means implementing enough of Matroska
 * to be dangerous, on a file the user cannot get back if we corrupt it.
 */
export async function trimVideo(source: Blob, range: TrimRange, durationMs: number): Promise<Blob> {
  const clamped = clampRange(range, durationMs)
  // Nothing to do, and a needless re-encode would cost quality for no reason.
  if (!isTrimmed(clamped, durationMs) || !isUsableRange(clamped, durationMs)) return source

  const url = URL.createObjectURL(source)
  const video = document.createElement('video')
  video.src = url
  video.muted = true

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('The recording could not be read for trimming.'))
    })

    const width = video.videoWidth || 1_280
    const height = video.videoHeight || 720
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not acquire a 2D context to trim the recording.')

    const mimeType = pickMimeType()
    const stream = canvas.captureStream(30)
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })

    const done = new Promise<Blob>((resolve) => {
      recorder.addEventListener('stop', () =>
        resolve(new Blob(chunks, { type: mimeType || 'video/webm' })),
      )
    })

    video.currentTime = clamped.startMs / 1000
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
    })

    recorder.start(500)
    await video.play().catch(() => undefined)

    let frame = 0
    const pump = (): void => {
      if (video.currentTime * 1000 >= clamped.endMs || video.ended) {
        video.pause()
        if (recorder.state !== 'inactive') recorder.stop()
        return
      }
      context.drawImage(video, 0, 0, width, height)
      frame += 1
      requestAnimationFrame(pump)
    }
    requestAnimationFrame(pump)

    const trimmed = await done
    // An empty result means nothing was drawn; the untrimmed original is a far
    // better outcome than a zero-byte file the user cannot open.
    return frame > 0 && trimmed.size > 0 ? trimmed : source
  } finally {
    video.src = ''
    URL.revokeObjectURL(url)
  }
}
