import { describe, expect, test } from 'vitest'
import { HANDLE_HIT_PX, HANDLE_INK_PX, handleAtPoint, handlePositions } from './handle-hit'

/**
 * PRD FR-34. Handles are drawn small and hit large: WCAG 2.2 §2.5.8 measures
 * the TARGET, not the ink, so 8px squares carry 24px hit areas.
 */

const rect = { x: 100, y: 100, width: 200, height: 200 }

describe('handle geometry', () => {
  test('draws 8px ink inside a 24px target', () => {
    expect(HANDLE_INK_PX).toBe(8)
    expect(HANDLE_HIT_PX).toBe(24)
  })

  test('places all eight handles on the rect', () => {
    const positions = handlePositions(rect)
    expect(Object.keys(positions).sort()).toEqual(
      ['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'].sort(),
    )
  })

  test('positions corners at the rect corners', () => {
    const p = handlePositions(rect)
    expect(p.nw).toEqual({ x: 100, y: 100 })
    expect(p.ne).toEqual({ x: 300, y: 100 })
    expect(p.sw).toEqual({ x: 100, y: 300 })
    expect(p.se).toEqual({ x: 300, y: 300 })
  })

  test('positions edge handles at edge midpoints', () => {
    const p = handlePositions(rect)
    expect(p.n).toEqual({ x: 200, y: 100 })
    expect(p.s).toEqual({ x: 200, y: 300 })
    expect(p.w).toEqual({ x: 100, y: 200 })
    expect(p.e).toEqual({ x: 300, y: 200 })
  })
})

describe('handleAtPoint', () => {
  test('hits a corner handle dead centre', () => {
    expect(handleAtPoint(rect, { x: 100, y: 100 })).toBe('nw')
  })

  test('hits within the 24px target even though the ink is 8px', () => {
    // 10px away from centre: outside the ink, inside the target.
    expect(handleAtPoint(rect, { x: 110, y: 108 })).toBe('nw')
  })

  test('misses beyond the target', () => {
    expect(handleAtPoint(rect, { x: 130, y: 130 })).toBeNull()
  })

  test('returns null in the middle of the selection', () => {
    expect(handleAtPoint(rect, { x: 200, y: 200 })).toBeNull()
  })

  test('prefers a corner over an edge where their targets overlap', () => {
    // On a small rect the nw and n targets overlap; the corner is the more
    // specific intent, so it must win.
    const small = { x: 100, y: 100, width: 30, height: 30 }
    expect(handleAtPoint(small, { x: 104, y: 100 })).toBe('nw')
  })

  test('distinguishes the four corners', () => {
    expect(handleAtPoint(rect, { x: 300, y: 100 })).toBe('ne')
    expect(handleAtPoint(rect, { x: 100, y: 300 })).toBe('sw')
    expect(handleAtPoint(rect, { x: 300, y: 300 })).toBe('se')
  })

  test('hits edge handles at their midpoints', () => {
    expect(handleAtPoint(rect, { x: 200, y: 100 })).toBe('n')
    expect(handleAtPoint(rect, { x: 300, y: 200 })).toBe('e')
  })

  test('finds no handle on a zero-size rect rather than returning all of them', () => {
    const empty = { x: 100, y: 100, width: 0, height: 0 }
    // Every handle would be coincident; offering one would be meaningless.
    expect(handleAtPoint(empty, { x: 100, y: 100 })).toBeNull()
  })
})
