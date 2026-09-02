import { describe, expect, test } from 'vitest'
import {
  createRecordingSession,
  GIF_MAX_MS,
  VIDEO_MAX_MS,
  estimateBytes,
} from './recording-state'

/**
 * Video and GIF recording (PRD §10, v1.1).
 *
 * Caps are correctness, not politeness: an unbounded recording fills the
 * renderer's memory and the tab dies as "Chrome crashed", which users never
 * attribute to the extension (same failure mode as R-10).
 */

describe('caps', () => {
  test('GIF is capped much shorter than video', () => {
    // GIF is uncompressed-ish and palette-limited; a 60s GIF is enormous and
    // nobody wants one.
    expect(GIF_MAX_MS).toBe(60_000)
    expect(VIDEO_MAX_MS).toBe(5 * 60_000)
    expect(GIF_MAX_MS).toBeLessThan(VIDEO_MAX_MS)
  })
})

describe('recording session', () => {
  test('starts idle', () => {
    const session = createRecordingSession('video')
    expect(session.state()).toBe('idle')
    expect(session.elapsedMs(0)).toBe(0)
  })

  test('records elapsed time from the start instant', () => {
    const session = createRecordingSession('video')
    session.start(1_000)
    expect(session.elapsedMs(4_500)).toBe(3_500)
  })

  test('stopping freezes the elapsed time', () => {
    const session = createRecordingSession('video')
    session.start(1_000)
    session.stop(6_000)
    expect(session.elapsedMs(99_000)).toBe(5_000)
    expect(session.state()).toBe('stopped')
  })

  test('reports remaining time against its own cap', () => {
    const session = createRecordingSession('gif')
    session.start(0)
    expect(session.remainingMs(10_000)).toBe(GIF_MAX_MS - 10_000)
  })

  test('reaching the cap stops the recording rather than truncating later', () => {
    // Stopping AT the cap keeps whatever was recorded; discovering the limit
    // afterwards would throw away the whole take.
    const session = createRecordingSession('gif')
    session.start(0)
    expect(session.shouldAutoStop(GIF_MAX_MS + 1)).toBe(true)
    expect(session.shouldAutoStop(GIF_MAX_MS - 1)).toBe(false)
  })

  test('never reports negative remaining time', () => {
    const session = createRecordingSession('gif')
    session.start(0)
    expect(session.remainingMs(GIF_MAX_MS * 2)).toBe(0)
  })

  test('a stopped session does not auto-stop again', () => {
    const session = createRecordingSession('gif')
    session.start(0)
    session.stop(1_000)
    expect(session.shouldAutoStop(GIF_MAX_MS * 2)).toBe(false)
  })

  test('cancelling discards rather than delivering', () => {
    const session = createRecordingSession('video')
    session.start(0)
    session.cancel()
    expect(session.state()).toBe('cancelled')
    expect(session.shouldDeliver()).toBe(false)
  })

  test('a stopped recording with content is delivered', () => {
    const session = createRecordingSession('video')
    session.start(0)
    session.stop(3_000)
    expect(session.shouldDeliver()).toBe(true)
  })

  test('a stop with no elapsed time delivers nothing', () => {
    // A zero-length video is a broken file, not a short one.
    const session = createRecordingSession('video')
    session.start(1_000)
    session.stop(1_000)
    expect(session.shouldDeliver()).toBe(false)
  })

  test('formats elapsed time as mm:ss for the recording badge', () => {
    const session = createRecordingSession('video')
    session.start(0)
    expect(session.label(0)).toBe('0:00')
    expect(session.label(9_000)).toBe('0:09')
    expect(session.label(65_000)).toBe('1:05')
    expect(session.label(600_000)).toBe('10:00')
  })
})

describe('estimateBytes', () => {
  test('scales with duration', () => {
    const short = estimateBytes({ mode: 'video', ms: 10_000, width: 1280, height: 720 })
    const long = estimateBytes({ mode: 'video', ms: 60_000, width: 1280, height: 720 })
    expect(long).toBeGreaterThan(short * 4)
  })

  test('scales with pixel count', () => {
    const small = estimateBytes({ mode: 'video', ms: 10_000, width: 640, height: 360 })
    const large = estimateBytes({ mode: 'video', ms: 10_000, width: 1920, height: 1080 })
    expect(large).toBeGreaterThan(small)
  })

  test('rates GIF far heavier than video per second', () => {
    // This is what justifies the shorter cap, and the warning the UI shows.
    const video = estimateBytes({ mode: 'video', ms: 10_000, width: 800, height: 600 })
    const gif = estimateBytes({ mode: 'gif', ms: 10_000, width: 800, height: 600 })
    expect(gif).toBeGreaterThan(video * 3)
  })

  test('returns zero for a zero-length recording', () => {
    expect(estimateBytes({ mode: 'video', ms: 0, width: 800, height: 600 })).toBe(0)
  })
})
