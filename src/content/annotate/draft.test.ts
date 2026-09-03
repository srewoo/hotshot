import { describe, expect, test } from 'vitest'
import { isMeaningfulDraft } from './draft'
import type { AnnotationCommand } from './command-list'

/**
 * Whether a draft stroke is worth committing.
 *
 * A click that never moved is not a mark, and committing it would leave an
 * invisible command in the undo stack. But the check must look at the WHOLE
 * path, not the first two points — a freehand draft starts as [at, at] and
 * appends as the pointer moves, so comparing points[0] to points[1] always
 * says "no movement" and silently discarded every freehand stroke.
 */

const draft = (
  tool: AnnotationCommand['tool'],
  points: Array<[number, number]>,
): AnnotationCommand => ({
  id: 'c1',
  tool,
  color: '#FF5A00',
  weight: 2,
  points: points.map(([x, y]) => ({ x, y })),
})

describe('isMeaningfulDraft', () => {
  test('rejects a click that never moved', () => {
    expect(isMeaningfulDraft(draft('arrow', [[10, 10], [10, 10]]))).toBe(false)
  })

  test('accepts a drag beyond the threshold', () => {
    expect(isMeaningfulDraft(draft('arrow', [[10, 10], [80, 60]]))).toBe(true)
  })

  test('rejects a jitter drag of a pixel or two', () => {
    // A hand tremor on click should not leave an invisible mark behind.
    expect(isMeaningfulDraft(draft('rect', [[10, 10], [11, 11]]))).toBe(false)
  })

  test('KEEPS a freehand stroke whose first two points are identical', () => {
    // The bug: a freehand draft begins as [at, at] and appends as the pointer
    // moves, so points[0] and points[1] are always the same. Comparing those
    // two discarded every freehand stroke ever drawn.
    const stroke = draft('freehand', [
      [10, 10],
      [10, 10],
      [24, 18],
      [48, 40],
      [90, 70],
    ])
    expect(isMeaningfulDraft(stroke)).toBe(true)
  })

  test('rejects a freehand stroke that truly never left the start', () => {
    expect(isMeaningfulDraft(draft('freehand', [[10, 10], [10, 10], [10, 10]]))).toBe(false)
  })

  test('accepts a freehand stroke that returns to its origin', () => {
    // A closed loop ends where it started; measuring end-to-start alone would
    // throw it away, so total path length is what counts.
    const loop = draft('freehand', [
      [50, 50],
      [50, 50],
      [90, 50],
      [90, 90],
      [50, 90],
      [50, 50],
    ])
    expect(isMeaningfulDraft(loop)).toBe(true)
  })

  test('rejects a draft with fewer than two points', () => {
    expect(isMeaningfulDraft(draft('arrow', [[10, 10]]))).toBe(false)
    expect(isMeaningfulDraft(draft('arrow', []))).toBe(false)
  })

  test('always keeps a single-point tool that places rather than drags', () => {
    // Badges and text are placed by one click; they have no drag to measure.
    expect(isMeaningfulDraft(draft('number', [[10, 10]]))).toBe(true)
    expect(isMeaningfulDraft({ ...draft('text', [[10, 10]]), text: 'note' })).toBe(true)
  })
})
