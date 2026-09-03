import { createRecordingSession, estimateBytes, type RecordMode } from './recording-state'
import { encodeGif } from './gif-encoder'
import {
  DEFAULT_RECORD_OPTIONS,
  needsCompositing,
  type RecordOptions,
} from './record-options'
import { acquireMedia, buildComposite, mixAudio } from './media-streams'

/**
 * Screen recording (PRD §10, v1.1).
 *
 * Stream acquisition and compositing are `media-streams`; the clock and its
 * caps are `recording-state`; trimming is `recorder-trim`. This is the state
 * machine that drives them, and it must be called inside a user gesture — the
 * browser refuses `getDisplayMedia` otherwise.
 *
 * Everything is encoded in the page. There is no upload, no transcription and
 * no share link: motion is a feature, a media backend is not.
 */

const GIF_FPS = 10
const GIF_MAX_WIDTH = 640

export interface RecordingResult {
  readonly blob: Blob
  readonly extension: 'webm' | 'gif'
  readonly durationMs: number
  /**
   * Everything a trim needs, when the format can be trimmed exactly.
   *
   * Present for GIF, whose frames are still in hand; absent for WebM, which
   * `recorder-trim` re-encodes from the blob instead.
   */
  readonly gifSource?:
    | {
        readonly frames: readonly Uint8ClampedArray[]
        readonly width: number
        readonly height: number
        readonly delayMs: number
      }
    | undefined
}

export interface RecorderHandle {
  pause(): void
  resume(): void
  stop(): void
  cancel(): void
  state(): 'recording' | 'paused' | 'other'
}

export interface RecorderCallbacks {
  onTick(label: string, estimateBytes: number, paused: boolean): void
  onDone(result: RecordingResult | null): void
  onError(message: string): void
}

function pickMimeType(): string {
  for (const type of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export async function startRecording(
  mode: RecordMode,
  callbacks: RecorderCallbacks,
  options: RecordOptions = DEFAULT_RECORD_OPTIONS,
): Promise<RecorderHandle | null> {
  const acquired = await acquireMedia(options)
  if (!acquired) {
    // The user dismissing the picker is a normal outcome, not an error.
    callbacks.onDone(null)
    return null
  }
  // Bound to a const the compiler can keep narrowed inside the closures below.
  const media = acquired

  const session = createRecordingSession(mode)
  const track = media.screen.getVideoTracks()[0]
  const settings = track?.getSettings() ?? {}
  const width = settings.width ?? 1_280
  const height = settings.height ?? 720

  // Stopping the share from Chrome's own bar must end the recording cleanly,
  // not leave it running against a dead track.
  track?.addEventListener('ended', () => handle.stop())

  let ticker: number | undefined
  const startTick = (): void => {
    ticker = window.setInterval(() => {
      const now = Date.now()
      callbacks.onTick(
        session.label(now),
        estimateBytes({ mode, ms: session.elapsedMs(now), width, height }),
        session.state() === 'paused',
      )
      if (session.shouldAutoStop(now)) handle.stop()
    }, 500)
  }
  const stopTick = (): void => {
    if (ticker !== undefined) window.clearInterval(ticker)
  }

  let handle: RecorderHandle

  if (mode === 'video') {
    const composite = needsCompositing(mode, options)
      ? await buildComposite(media, { width, height })
      : null

    // Compositing draws every frame itself; without it the display track goes
    // to the recorder untouched, which is cheaper and higher quality.
    let painter: number | undefined
    let videoStream: MediaStream
    if (composite) {
      videoStream = composite.canvas.captureStream(30)
      const paint = (): void => {
        if (session.state() === 'recording') composite.draw()
        painter = requestAnimationFrame(paint)
      }
      painter = requestAnimationFrame(paint)
    } else {
      videoStream = new MediaStream(media.screen.getVideoTracks())
    }

    // Tab audio and a microphone are separate tracks and MediaRecorder takes
    // only the first, so a recording with both would silently lose the voice.
    const audio = mixAudio([media.screen, ...(media.microphone ? [media.microphone] : [])])
    if (audio.track) videoStream.addTrack(audio.track)

    const chunks: Blob[] = []
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(videoStream, mimeType ? { mimeType } : undefined)

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      stopTick()
      if (painter !== undefined) cancelAnimationFrame(painter)
      composite?.stop()
      audio.close()
      media.stopAll()
      if (!session.shouldDeliver()) return callbacks.onDone(null)
      callbacks.onDone({
        blob: new Blob(chunks, { type: mimeType || 'video/webm' }),
        extension: 'webm',
        durationMs: session.elapsedMs(Date.now()),
      })
    })
    recorder.addEventListener('error', () =>
      callbacks.onError('The recorder stopped unexpectedly. Anything captured so far was kept.'),
    )

    handle = {
      state: () =>
        session.state() === 'recording' ? 'recording' : session.state() === 'paused' ? 'paused' : 'other',

      pause() {
        if (session.state() !== 'recording') return
        session.pause(Date.now())
        // The recorder is paused too, so the file has no gap where the paused
        // time would otherwise be encoded as frozen frames.
        if (recorder.state === 'recording') recorder.pause()
      },
      resume() {
        if (session.state() !== 'paused') return
        session.resume(Date.now())
        if (recorder.state === 'paused') recorder.resume()
      },
      stop() {
        if (session.state() !== 'recording' && session.state() !== 'paused') return
        session.stop(Date.now())
        if (recorder.state !== 'inactive') recorder.stop()
      },
      cancel() {
        session.cancel()
        stopTick()
        if (painter !== undefined) cancelAnimationFrame(painter)
        composite?.stop()
        audio.close()
        media.stopAll()
        if (recorder.state !== 'inactive') recorder.stop()
        callbacks.onDone(null)
      },
    }

    session.start(Date.now())
    recorder.start(1_000)
    startTick()
    return handle
  }

  // --- GIF: sample frames onto a canvas, encode at the end -------------------

  // Downscaled deliberately: a full-resolution GIF is unusable at any length,
  // and the size warning would be the only thing the user ever saw.
  const scale = Math.min(1, GIF_MAX_WIDTH / width)
  const frameWidth = Math.max(2, Math.round(width * scale))
  const frameHeight = Math.max(2, Math.round(height * scale))

  const composite = await buildComposite(media, { width: frameWidth, height: frameHeight })
  const context = composite.canvas.getContext('2d', { willReadFrequently: true })

  const frames: Uint8ClampedArray[] = []
  const delayMs = 1_000 / GIF_FPS
  const sampler = window.setInterval(() => {
    // A paused GIF samples nothing, so the pause leaves no frozen stretch.
    if (!context || session.state() !== 'recording') return
    composite.draw()
    frames.push(context.getImageData(0, 0, frameWidth, frameHeight).data)
  }, delayMs)

  function finish(deliver: boolean): void {
    window.clearInterval(sampler)
    stopTick()
    composite.stop()
    media.stopAll()

    if (!deliver || frames.length === 0) return callbacks.onDone(null)

    try {
      const gif = encodeGif({ frames, width: frameWidth, height: frameHeight, delayMs })
      callbacks.onDone({
        blob: new Blob([gif.slice().buffer as ArrayBuffer], { type: 'image/gif' }),
        extension: 'gif',
        durationMs: session.elapsedMs(Date.now()),
        // Kept so a trim is an exact re-slice rather than a re-encode.
        gifSource: { frames, width: frameWidth, height: frameHeight, delayMs },
      })
    } catch (error) {
      callbacks.onError(error instanceof Error ? error.message : 'The GIF could not be encoded.')
      callbacks.onDone(null)
    }
  }

  handle = {
    state: () =>
      session.state() === 'recording' ? 'recording' : session.state() === 'paused' ? 'paused' : 'other',
    pause: () => session.pause(Date.now()),
    resume: () => session.resume(Date.now()),
    stop() {
      if (session.state() !== 'recording' && session.state() !== 'paused') return
      session.stop(Date.now())
      finish(session.shouldDeliver())
    },
    cancel() {
      session.cancel()
      finish(false)
    },
  }

  session.start(Date.now())
  startTick()
  return handle
}
