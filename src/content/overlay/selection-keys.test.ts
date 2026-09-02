import { describe, expect, test } from 'vitest'
import { adjustSelection } from './selection-keys'

/** PRD FR-35: arrow moves, Alt+arrow resizes, Shift makes the step coarse. */

const viewport = { width: 1280, height: 800 }
const rect = { x: 100, y: 100, width: 200, height: 200 }

const key = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent =>
  ({ shiftKey: false, altKey: false, ...init }) as KeyboardEvent

describe('adjustSelection', () => {
  test('moves by one pixel on a bare arrow', () => {
    expect(adjustSelection(rect, key({ key: 'ArrowRight' }), viewport)).toMatchObject({
      x: 101,
      width: 200,
    })
  })

  test('moves by ten with shift', () => {
    expect(adjustSelection(rect, key({ key: 'ArrowDown', shiftKey: true }), viewport)).toMatchObject(
      { y: 110, height: 200 },
    )
  })

  test('resizes rather than moves when alt is held', () => {
    const out = adjustSelection(rect, key({ key: 'ArrowRight', altKey: true }), viewport)
    // The origin stays put — a keyboard nudge that moved the whole rect while
    // resizing would feel like the selection was sliding away.
    expect(out).toMatchObject({ x: 100, y: 100, width: 201 })
  })

  test('resizes coarsely with alt and shift', () => {
    expect(adjustSelection(rect, key({ key: 'ArrowDown', altKey: true, shiftKey: true }), viewport))
      .toMatchObject({ height: 210 })
  })

  test('clamps a move at the viewport edge', () => {
    const atEdge = { x: 1080, y: 100, width: 200, height: 200 }
    expect(adjustSelection(atEdge, key({ key: 'ArrowRight' }), viewport)).toMatchObject({ x: 1080 })
  })

  test('returns null for a key that is not an adjustment', () => {
    expect(adjustSelection(rect, key({ key: 'a' }), viewport)).toBeNull()
    expect(adjustSelection(rect, key({ key: 'Enter' }), viewport)).toBeNull()
  })
})
