// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { coverAll, frameSelection, type Veils } from './veil-view'

/**
 * The veils are the only thing standing between the user and a capture they
 * cannot see the edges of, and their one hard invariant is invisible in code
 * review: each carries 44% alpha, so any two overlapping is a darker page than
 * the design specifies.
 */

function veils(): Veils {
  return [0, 1, 2, 3].map(() => document.createElement('div')) as unknown as Veils
}

/** Area in CSS px, treating `100vw`/`100vh` against a known viewport. */
function area(veil: HTMLDivElement, viewport: { width: number; height: number }): number {
  const read = (value: string, full: number): number =>
    value === '100vw' || value === '100vh' ? full : Number.parseFloat(value || '0') || 0
  return read(veil.style.width, viewport.width) * read(veil.style.height, viewport.height)
}

const viewport = { width: 1200, height: 800 }

describe('coverAll', () => {
  test('dims the viewport with exactly one layer', () => {
    const v = veils()
    coverAll(v)
    const covering = v.filter((veil) => area(veil, viewport) > 0)
    expect(covering).toHaveLength(1)
  })

  test('the covering layer spans the whole viewport', () => {
    const v = veils()
    coverAll(v)
    expect(area(v[0], viewport)).toBe(viewport.width * viewport.height)
    // happy-dom normalises `0` to `0px`; either is the same pixel.
    expect(Number.parseFloat(v[0].style.left)).toBe(0)
    expect(Number.parseFloat(v[0].style.top)).toBe(0)
  })

  test('writes explicit edges, never the `inset` shorthand', () => {
    // A leftover `inset: 0` over-constrains the rects `frameSelection` then
    // sets, which is how a veil ends up the wrong size.
    const v = veils()
    coverAll(v)
    for (const veil of v) expect(veil.style.inset).toBe('')
  })

  test('is idempotent, because it runs on every repaint with no selection', () => {
    const v = veils()
    coverAll(v)
    coverAll(v)
    expect(v.filter((veil) => area(veil, viewport) > 0)).toHaveLength(1)
  })
})

describe('frameSelection', () => {
  const rect = { x: 200, y: 100, width: 400, height: 300 }

  test('leaves the selection itself uncovered', () => {
    const v = veils()
    frameSelection(v, rect, viewport)
    const [top, right, bottom, left] = v
    expect(top.style.height).toBe('100px')
    expect(bottom.style.top).toBe('400px')
    expect(left.style.width).toBe('200px')
    expect(right.style.left).toBe('600px')
  })

  test('the four bands tile the viewport without overlapping each other', () => {
    const v = veils()
    frameSelection(v, rect, viewport)
    const covered =
      area(v[0], viewport) + area(v[1], viewport) + area(v[2], viewport) + area(v[3], viewport)
    const expected = viewport.width * viewport.height - rect.width * rect.height
    expect(covered).toBe(expected)
  })

  test('a selection flush to an edge collapses that band rather than going negative', () => {
    const v = veils()
    frameSelection(v, { x: 0, y: 0, width: viewport.width, height: viewport.height }, viewport)
    for (const veil of v) expect(area(veil, viewport)).toBe(0)
  })

  test('recovers from a previous coverAll instead of inheriting its size', () => {
    const v = veils()
    coverAll(v)
    frameSelection(v, rect, viewport)
    const covered =
      area(v[0], viewport) + area(v[1], viewport) + area(v[2], viewport) + area(v[3], viewport)
    expect(covered).toBe(viewport.width * viewport.height - rect.width * rect.height)
  })
})
