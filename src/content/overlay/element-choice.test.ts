import { describe, expect, test } from 'vitest'
import { chooseInitialIndex, walkChain, type Candidate } from './element-choice'

/**
 * PRD FR-3 — Wedge 1, the only differentiator a desktop tool structurally
 * cannot copy, because it has no DOM.
 *
 * R-3 is explicit that an 80%-reliable version fails publicly, so the
 * judgement of WHICH element the user meant is kept pure and tested
 * exhaustively, separate from DOM measurement.
 *
 * A chain runs innermost → outermost: chain[0] is the deepest element under
 * the cursor, and the last entry is <body>.
 */

const viewport = { width: 1280, height: 800 }

const c = (tag: string, width: number, height: number, x = 0, y = 0): Candidate => ({
  tag,
  rect: { x, y, width, height },
})

describe('chooseInitialIndex', () => {
  test('picks the deepest element when it is a reasonable size', () => {
    const chain = [c('button', 120, 40), c('div', 400, 300), c('body', 1280, 800)]
    expect(chooseInitialIndex(chain, viewport)).toBe(0)
  })

  test('skips a sliver too small to be what the user meant', () => {
    // Hovering a 3px icon inside a button: the button is the intent.
    const chain = [c('svg', 3, 3), c('button', 120, 40), c('body', 1280, 800)]
    expect(chooseInitialIndex(chain, viewport)).toBe(1)
  })

  test('skips a zero-size element', () => {
    const chain = [c('span', 0, 0), c('a', 90, 24), c('body', 1280, 800)]
    expect(chooseInitialIndex(chain, viewport)).toBe(1)
  })

  test('never selects body when a real element exists', () => {
    const chain = [c('p', 600, 20), c('body', 1280, 800)]
    expect(chooseInitialIndex(chain, viewport)).toBe(0)
  })

  test('never selects html', () => {
    const chain = [c('div', 200, 100), c('body', 1280, 800), c('html', 1280, 800)]
    const index = chooseInitialIndex(chain, viewport)
    expect(chain[index]?.tag).not.toBe('html')
  })

  test('rejects an element covering essentially the whole viewport', () => {
    // A full-bleed wrapper is never the intent — that is what full-page
    // capture is for, and offering it as "an element" is a wrong answer
    // dressed as a right one.
    const chain = [c('div', 1280, 800), c('main', 1200, 700), c('body', 1280, 800)]
    expect(chain[chooseInitialIndex(chain, viewport)]?.tag).toBe('main')
  })

  test('falls back to the largest usable candidate when all are slivers', () => {
    const chain = [c('i', 2, 2), c('span', 4, 4), c('body', 1280, 800)]
    // Body is excluded, so the least-bad real answer is the span.
    expect(chain[chooseInitialIndex(chain, viewport)]?.tag).toBe('span')
  })

  test('returns 0 for a single-element chain rather than failing', () => {
    expect(chooseInitialIndex([c('div', 50, 50)], viewport)).toBe(0)
  })

  test('returns -1 for an empty chain instead of guessing', () => {
    expect(chooseInitialIndex([], viewport)).toBe(-1)
  })
})

describe('walkChain', () => {
  const chain = [c('span', 40, 16), c('button', 120, 40), c('div', 400, 300), c('body', 1280, 800)]

  test('walking out moves toward the ancestor', () => {
    expect(walkChain(chain, 0, 'out', viewport)).toBe(1)
  })

  test('walking in moves toward the descendant', () => {
    expect(walkChain(chain, 2, 'in', viewport)).toBe(1)
  })

  test('stops at the outermost usable element rather than reaching body', () => {
    expect(walkChain(chain, 2, 'out', viewport)).toBe(2)
  })

  test('stops at the innermost element', () => {
    expect(walkChain(chain, 0, 'in', viewport)).toBe(0)
  })

  test('walking out then in returns to where it started', () => {
    // Round-tripping is what makes `[` and `]` feel trustworthy under the hand.
    const start = 0
    const out = walkChain(chain, start, 'out', viewport)
    expect(walkChain(chain, out, 'in', viewport)).toBe(start)
  })

  test('skips unusable candidates while walking rather than selecting them', () => {
    const withSliver = [c('a', 80, 20), c('em', 1, 1), c('section', 500, 200), c('body', 1280, 800)]
    expect(walkChain(withSliver, 0, 'out', viewport)).toBe(2)
  })

  test('tolerates an out-of-range index without throwing', () => {
    expect(() => walkChain(chain, 99, 'out', viewport)).not.toThrow()
    expect(() => walkChain(chain, -5, 'in', viewport)).not.toThrow()
  })
})
