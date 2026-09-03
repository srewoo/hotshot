import { describe, expect, test } from 'vitest'
import {
  bubbleRect,
  BUBBLE_FRACTION,
  DEFAULT_RECORD_OPTIONS,
  describeOptions,
  displayConstraints,
  microphoneConstraints,
  needsCompositing,
  webcamConstraints,
  type RecordOptions,
} from './record-options'

const options = (over: Partial<RecordOptions> = {}): RecordOptions => ({
  ...DEFAULT_RECORD_OPTIONS,
  ...over,
})

describe('the defaults', () => {
  /**
   * Nothing beyond the screen is captured unless it was asked for. A default
   * that recorded the microphone would be a privacy incident dressed as a
   * convenience.
   */
  test('capture nothing but the screen', () => {
    expect(DEFAULT_RECORD_OPTIONS).toEqual({ tabAudio: false, microphone: false, webcam: false })
  })
})

describe('needsCompositing', () => {
  test('plain video goes straight to the recorder, with no canvas pass', () => {
    expect(needsCompositing('video', options())).toBe(false)
  })

  test('a webcam bubble forces compositing, because it must be drawn over', () => {
    expect(needsCompositing('video', options({ webcam: true }))).toBe(true)
  })

  test('GIF always composites, since it samples frames anyway', () => {
    expect(needsCompositing('gif', options())).toBe(true)
  })

  test('audio alone does not force a canvas pass', () => {
    expect(needsCompositing('video', options({ tabAudio: true, microphone: true }))).toBe(false)
  })
})

describe('displayConstraints', () => {
  test('asks for audio only when tab audio was chosen', () => {
    expect(displayConstraints(options()).audio).toBe(false)
    expect(displayConstraints(options({ tabAudio: true })).audio).toBe(true)
  })

  test('always asks for video at a sensible frame rate', () => {
    expect(displayConstraints(options()).video).toEqual({ frameRate: { ideal: 30 } })
  })
})

describe('microphoneConstraints', () => {
  test('is null when the microphone was not chosen', () => {
    expect(microphoneConstraints(options())).toBeNull()
  })

  test('asks for cleaned-up voice, not fidelity', () => {
    const constraints = microphoneConstraints(options({ microphone: true }))
    expect(constraints?.video).toBe(false)
    expect(constraints?.audio).toMatchObject({ echoCancellation: true, noiseSuppression: true })
  })
})

describe('webcamConstraints', () => {
  test('is null when the camera was not chosen', () => {
    expect(webcamConstraints(options())).toBeNull()
  })

  test('asks for a small frame, since the bubble is small', () => {
    const constraints = webcamConstraints(options({ webcam: true })) as MediaStreamConstraints
    expect(constraints.audio).toBe(false)
    expect(constraints.video).toMatchObject({ width: { ideal: 480 } })
  })
})

describe('bubbleRect', () => {
  test('sits in the bottom-left, inset from both edges', () => {
    const rect = bubbleRect({ width: 1_280, height: 720 })
    expect(rect.x).toBeGreaterThan(0)
    expect(rect.y).toBeGreaterThan(0)
    expect(rect.y + rect.size).toBeLessThan(720)
  })

  /**
   * Sized from the SHORT edge so the bubble carries the same visual weight on
   * a tall window as on a wide one.
   */
  test('is sized from the short edge', () => {
    expect(bubbleRect({ width: 1_280, height: 720 }).size).toBe(
      Math.round(720 * BUBBLE_FRACTION),
    )
    expect(bubbleRect({ width: 600, height: 1_200 }).size).toBe(
      Math.round(600 * BUBBLE_FRACTION),
    )
  })

  test('never collapses below a visible size on a tiny frame', () => {
    expect(bubbleRect({ width: 80, height: 60 }).size).toBeGreaterThanOrEqual(48)
  })

  test('stays inside the frame at every aspect ratio', () => {
    for (const frame of [
      { width: 1_920, height: 1_080 },
      { width: 800, height: 2_400 },
      { width: 500, height: 500 },
    ]) {
      const rect = bubbleRect(frame)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.size).toBeLessThanOrEqual(frame.width)
      expect(rect.y + rect.size).toBeLessThanOrEqual(frame.height)
    }
  })
})

describe('describeOptions', () => {
  test('says plainly when only the screen is captured', () => {
    expect(describeOptions(options())).toBe('screen only')
  })

  test('names everything being captured, so it is never a guess', () => {
    expect(describeOptions(options({ tabAudio: true, microphone: true, webcam: true }))).toBe(
      'screen + tab audio + mic + camera',
    )
  })

  test('names a single addition', () => {
    expect(describeOptions(options({ microphone: true }))).toBe('screen + mic')
  })
})
