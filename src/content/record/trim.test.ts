import { describe, expect, test } from 'vitest'
import {
  clampRange,
  formatPosition,
  frameRange,
  fullRange,
  isTrimmed,
  isUsableRange,
  MIN_TRIM_MS,
  rangeDurationMs,
} from './trim'

describe('fullRange', () => {
  test('spans the whole recording', () => {
    expect(fullRange(12_000)).toEqual({ startMs: 0, endMs: 12_000 })
  })

  test('a nonsense duration collapses rather than going negative', () => {
    expect(fullRange(-5)).toEqual({ startMs: 0, endMs: 0 })
  })
})

describe('clampRange', () => {
  test('leaves a valid range alone', () => {
    expect(clampRange({ startMs: 1_000, endMs: 5_000 }, 10_000)).toEqual({
      startMs: 1_000,
      endMs: 5_000,
    })
  })

  test('clamps past the end of the recording', () => {
    expect(clampRange({ startMs: 0, endMs: 99_000 }, 10_000).endMs).toBe(10_000)
  })

  test('clamps a negative start', () => {
    expect(clampRange({ startMs: -500, endMs: 5_000 }, 10_000).startMs).toBe(0)
  })

  /**
   * Dragging the out-point past the in-point is a normal thing to do with two
   * handles on one bar. Swapping keeps it usable; a negative duration would
   * encode an empty file.
   */
  test('swaps a reversed range rather than producing a negative duration', () => {
    expect(clampRange({ startMs: 8_000, endMs: 2_000 }, 10_000)).toEqual({
      startMs: 2_000,
      endMs: 8_000,
    })
  })
})

describe('rangeDurationMs', () => {
  test('is the span between the handles', () => {
    expect(rangeDurationMs({ startMs: 2_000, endMs: 6_500 })).toBe(4_500)
  })

  test('never negative', () => {
    expect(rangeDurationMs({ startMs: 6_000, endMs: 2_000 })).toBe(0)
  })
})

describe('isTrimmed', () => {
  test('an untouched range is not a trim, so nothing is re-encoded', () => {
    expect(isTrimmed({ startMs: 0, endMs: 10_000 }, 10_000)).toBe(false)
  })

  test('moving either handle is a trim', () => {
    expect(isTrimmed({ startMs: 500, endMs: 10_000 }, 10_000)).toBe(true)
    expect(isTrimmed({ startMs: 0, endMs: 9_500 }, 10_000)).toBe(true)
  })
})

describe('isUsableRange', () => {
  test('rejects a mis-drag', () => {
    expect(isUsableRange({ startMs: 1_000, endMs: 1_000 + MIN_TRIM_MS - 1 }, 10_000)).toBe(false)
  })

  test('accepts a real trim at the threshold', () => {
    expect(isUsableRange({ startMs: 1_000, endMs: 1_000 + MIN_TRIM_MS }, 10_000)).toBe(true)
  })
})

describe('frameRange', () => {
  // 10fps: one frame every 100ms, 100 frames in ten seconds.
  test('maps a range onto frame indices', () => {
    expect(frameRange({ startMs: 1_000, endMs: 2_000 }, 100, 100)).toEqual({ from: 10, to: 20 })
  })

  test('a full range keeps every frame', () => {
    expect(frameRange({ startMs: 0, endMs: 10_000 }, 100, 100)).toEqual({ from: 0, to: 100 })
  })

  test('clamps past the end of the capture', () => {
    expect(frameRange({ startMs: 0, endMs: 99_000 }, 100, 100).to).toBe(100)
  })

  /**
   * Half-open, so two adjacent trims of one recording cannot both claim the
   * same frame — which would show a duplicated moment at the seam.
   */
  test('is inclusive of the start frame and exclusive of the end', () => {
    const a = frameRange({ startMs: 0, endMs: 1_000 }, 100, 100)
    const b = frameRange({ startMs: 1_000, endMs: 2_000 }, 100, 100)
    expect(a.to).toBe(b.from)
  })

  test('never returns an inverted pair', () => {
    const range = frameRange({ startMs: 5_000, endMs: 1_000 }, 100, 100)
    expect(range.to).toBeGreaterThanOrEqual(range.from)
  })

  test('a zero frame delay returns everything rather than dividing by zero', () => {
    expect(frameRange({ startMs: 0, endMs: 1_000 }, 42, 0)).toEqual({ from: 0, to: 42 })
  })

  test('an empty capture has no frames to keep', () => {
    expect(frameRange({ startMs: 0, endMs: 1_000 }, 0, 100)).toEqual({ from: 0, to: 0 })
  })
})

describe('formatPosition', () => {
  test.each([
    [0, '0:00.0'],
    [1_500, '0:01.5'],
    [65_400, '1:05.4'],
    [600_000, '10:00.0'],
  ])('formats %sms as %s', (ms, expected) => {
    expect(formatPosition(ms)).toBe(expected)
  })

  test('a negative position reads as the start, not as nonsense', () => {
    expect(formatPosition(-500)).toBe('0:00.0')
  })
})
