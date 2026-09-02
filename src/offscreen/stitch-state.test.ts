import { describe, expect, test } from 'vitest'
import { createStitchSession } from './stitch-state'

/**
 * PRD FR-31. Aborting a five-to-seventeen second operation must never
 * silently bin the work already done: the first Esc stops and KEEPS the
 * partial stitch, a second discards it.
 *
 * Quota exhaustion follows the same rule — partial delivery is a documented
 * normal path, not an error.
 */

describe('stitch session', () => {
  test('starts capturing with nothing done', () => {
    const session = createStitchSession(14)
    expect(session.state()).toBe('capturing')
    expect(session.captured()).toBe(0)
  })

  test('counts completed tiles', () => {
    const session = createStitchSession(3)
    session.tileDone()
    session.tileDone()
    expect(session.captured()).toBe(2)
  })

  test('completes when every tile is captured', () => {
    const session = createStitchSession(2)
    session.tileDone()
    session.tileDone()
    expect(session.state()).toBe('complete')
  })

  test('the first cancel stops and KEEPS the partial', () => {
    const session = createStitchSession(10)
    session.tileDone()
    session.tileDone()
    session.cancel()

    expect(session.state()).toBe('stopped-kept')
    expect(session.shouldDeliver()).toBe(true)
    expect(session.captured()).toBe(2)
  })

  test('a second cancel discards it', () => {
    const session = createStitchSession(10)
    session.tileDone()
    session.cancel()
    session.cancel()

    expect(session.state()).toBe('discarded')
    expect(session.shouldDeliver()).toBe(false)
  })

  test('cancelling before any tile lands discards rather than delivering nothing', () => {
    // Delivering a zero-tile image would be a blank PNG presented as a capture.
    const session = createStitchSession(10)
    session.cancel()
    expect(session.shouldDeliver()).toBe(false)
    expect(session.state()).toBe('discarded')
  })

  test('quota exhaustion stops and keeps, exactly like a user cancel', () => {
    const session = createStitchSession(20)
    session.tileDone()
    session.tileDone()
    session.quotaExhausted()

    expect(session.state()).toBe('stopped-kept')
    expect(session.shouldDeliver()).toBe(true)
  })

  test('reports how much of the page the partial covers', () => {
    const session = createStitchSession(14)
    for (let i = 0; i < 7; i++) session.tileDone()
    session.cancel()

    expect(session.summary()).toBe('captured 7 of 14 tiles')
  })

  test('a completed stitch needs no warning', () => {
    const session = createStitchSession(2)
    session.tileDone()
    session.tileDone()
    expect(session.summary()).toBeNull()
  })

  test('stops accepting tiles once cancelled', () => {
    const session = createStitchSession(10)
    session.tileDone()
    session.cancel()
    session.tileDone()
    expect(session.captured()).toBe(1)
  })

  test('reports whether the loop should keep going', () => {
    const session = createStitchSession(3)
    expect(session.running()).toBe(true)
    session.cancel()
    expect(session.running()).toBe(false)
  })
})
