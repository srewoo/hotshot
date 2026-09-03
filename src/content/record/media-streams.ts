import {
  bubbleRect,
  displayConstraints,
  microphoneConstraints,
  webcamConstraints,
  type RecordOptions,
} from './record-options'

/**
 * Acquiring and combining the streams a recording needs (PRD §10 v1.1).
 *
 * Everything is composited and encoded IN THE PAGE. There is no upload, no
 * transcription and no share link, and deliberately no code here that could
 * add one — the line the product draws is that motion is a feature and a media
 * backend is not.
 *
 * `getDisplayMedia` rather than `chrome.tabCapture`: tabCapture needs a
 * manifest permission with an install-time warning, and getDisplayMedia puts
 * Chrome's own surface picker in front of the user so the choice of what gets
 * recorded is explicitly theirs (FR-23's reasoning).
 */

export interface AcquiredMedia {
  readonly screen: MediaStream
  readonly microphone: MediaStream | null
  readonly webcam: MediaStream | null
  /** Every track acquired, so teardown cannot miss one. */
  stopAll(): void
}

/**
 * Requests the screen, and then the optional extras.
 *
 * The screen comes first and its rejection aborts everything: dismissing
 * Chrome's picker is a normal way to change your mind, and prompting for a
 * microphone afterwards would be absurd. A rejected microphone or camera, by
 * contrast, degrades — the screen recording is still worth having.
 */
export async function acquireMedia(options: RecordOptions): Promise<AcquiredMedia | null> {
  let screen: MediaStream
  try {
    screen = await navigator.mediaDevices.getDisplayMedia(displayConstraints(options))
  } catch {
    return null
  }

  const optional = async (
    constraints: MediaStreamConstraints | null,
    what: string,
  ): Promise<MediaStream | null> => {
    if (!constraints) return null
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch {
      console.warn(`[Hotshot] ${what} was unavailable; recording without it.`)
      return null
    }
  }

  const microphone = await optional(microphoneConstraints(options), 'the microphone')
  const webcam = await optional(webcamConstraints(options), 'the camera')

  return {
    screen,
    microphone,
    webcam,
    stopAll() {
      for (const stream of [screen, microphone, webcam]) {
        for (const track of stream?.getTracks() ?? []) track.stop()
      }
    },
  }
}

/**
 * Mixes several audio sources into one track.
 *
 * Tab audio and a microphone are separate tracks, and `MediaRecorder` records
 * only the first — so a recording with both would silently drop the voice-over.
 * A WebAudio destination is the standard way to sum them.
 */
export function mixAudio(sources: readonly MediaStream[]): {
  readonly track: MediaStreamTrack | null
  close(): void
} {
  const withAudio = sources.filter((stream) => stream.getAudioTracks().length > 0)
  if (withAudio.length === 0) return { track: null, close: () => undefined }
  // One source needs no mixing, and routing it through WebAudio would only add
  // a resample.
  if (withAudio.length === 1) {
    return { track: withAudio[0]?.getAudioTracks()[0] ?? null, close: () => undefined }
  }

  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  for (const stream of withAudio) context.createMediaStreamSource(stream).connect(destination)
  return {
    track: destination.stream.getAudioTracks()[0] ?? null,
    close: () => void context.close(),
  }
}

export interface CompositeSurface {
  readonly canvas: HTMLCanvasElement
  /** Draws one frame: the screen, then the camera bubble over it. */
  draw(): void
  stop(): void
}

/**
 * Composites the screen and an optional camera bubble onto a canvas.
 *
 * Needed because `MediaRecorder` records one video track: a camera bubble has
 * to be drawn over the screen frames rather than sent alongside them.
 */
export async function buildComposite(
  media: AcquiredMedia,
  frame: { readonly width: number; readonly height: number },
): Promise<CompositeSurface> {
  const screenVideo = document.createElement('video')
  screenVideo.srcObject = media.screen
  screenVideo.muted = true
  await screenVideo.play().catch(() => undefined)

  let webcamVideo: HTMLVideoElement | null = null
  if (media.webcam) {
    webcamVideo = document.createElement('video')
    webcamVideo.srcObject = media.webcam
    webcamVideo.muted = true
    await webcamVideo.play().catch(() => undefined)
  }

  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')

  const bubble = bubbleRect(frame)

  return {
    canvas,

    draw() {
      if (!context) return
      context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)
      if (!webcamVideo) return

      // A circular bubble, cropped to a square from the middle of the camera
      // frame so a 4:3 webcam is not squashed into a circle.
      const source = Math.min(webcamVideo.videoWidth, webcamVideo.videoHeight) || 1
      const sx = (webcamVideo.videoWidth - source) / 2
      const sy = (webcamVideo.videoHeight - source) / 2

      context.save()
      context.beginPath()
      context.arc(
        bubble.x + bubble.size / 2,
        bubble.y + bubble.size / 2,
        bubble.size / 2,
        0,
        Math.PI * 2,
      )
      context.closePath()
      context.clip()
      context.drawImage(
        webcamVideo,
        sx,
        sy,
        source,
        source,
        bubble.x,
        bubble.y,
        bubble.size,
        bubble.size,
      )
      context.restore()

      // A ring, so the bubble reads as deliberate over any content.
      context.beginPath()
      context.arc(
        bubble.x + bubble.size / 2,
        bubble.y + bubble.size / 2,
        bubble.size / 2,
        0,
        Math.PI * 2,
      )
      context.lineWidth = 2
      context.strokeStyle = '#FFFFFF'
      context.stroke()
    },

    stop() {
      screenVideo.srcObject = null
      if (webcamVideo) webcamVideo.srcObject = null
    },
  }
}
