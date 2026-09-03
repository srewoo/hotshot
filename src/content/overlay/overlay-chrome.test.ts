// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { buildChrome, TOKENS, writeReadout } from './overlay-chrome'

/**
 * The readout is the overlay's only text that changes per frame, and it used
 * to be written through `innerHTML`. These tests pin both halves of the fix:
 * the rendered text is unchanged, and no HTML sink is touched — the second is
 * the one that matters, because a Trusted Types page turns that sink into a
 * thrown TypeError and a dead overlay.
 */

function readoutNode(): HTMLDivElement {
  return buildChrome('hint').readout
}

describe('writeReadout', () => {
  test('renders bare dimensions at 1x and 100%', () => {
    const readout = readoutNode()
    writeReadout(readout, 800, 600, { dpr: 1, zoom: 1 })
    expect(readout.textContent).toBe('800 × 600')
    expect(readout.querySelectorAll('span')).toHaveLength(0)
  })

  test('rounds fractional CSS pixels', () => {
    const readout = readoutNode()
    writeReadout(readout, 800.4, 600.6, { dpr: 1, zoom: 1 })
    expect(readout.textContent).toBe('800 × 601')
  })

  test('appends the DPR badge in the flare colour', () => {
    const readout = readoutNode()
    writeReadout(readout, 800, 600, { dpr: 2, zoom: 1 })
    expect(readout.textContent).toBe('800 × 600 @2x')
    const spans = readout.querySelectorAll('span')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.textContent).toBe('@2x')
    expect(spans[0]?.style.color).toBe(TOKENS.flare)
  })

  test('appends the zoom badge as a whole percentage', () => {
    const readout = readoutNode()
    writeReadout(readout, 800, 600, { dpr: 1, zoom: 1.5 })
    expect(readout.textContent).toBe('800 × 600 150%')
  })

  test('shows both badges, DPR before zoom', () => {
    const readout = readoutNode()
    writeReadout(readout, 800, 600, { dpr: 2, zoom: 1.5 })
    expect(readout.textContent).toBe('800 × 600 @2x 150%')
    expect(readout.querySelectorAll('span')).toHaveLength(2)
  })

  test('replaces prior content rather than appending to it', () => {
    const readout = readoutNode()
    writeReadout(readout, 800, 600, { dpr: 2, zoom: 1.5 })
    writeReadout(readout, 10, 20, { dpr: 1, zoom: 1 })
    expect(readout.textContent).toBe('10 × 20')
    expect(readout.querySelectorAll('span')).toHaveLength(0)
  })

  test('touches no HTML sink, so a Trusted Types page cannot break it', () => {
    const readout = readoutNode()
    // Stand-in for the TypeError a `require-trusted-types-for 'script'` page
    // raises on an unsafe assignment. Reaching for the sink now fails loudly
    // in CI rather than silently on a customer's hardened intranet.
    for (const sink of ['innerHTML', 'outerHTML'] as const) {
      Object.defineProperty(readout, sink, {
        configurable: true,
        set() {
          throw new TypeError(`blocked ${sink} assignment (Trusted Types)`)
        },
        get: () => '',
      })
    }
    readout.insertAdjacentHTML = () => {
      throw new TypeError('blocked insertAdjacentHTML (Trusted Types)')
    }

    expect(() => writeReadout(readout, 800, 600, { dpr: 2, zoom: 1.5 })).not.toThrow()
    expect(readout.textContent).toBe('800 × 600 @2x 150%')
  })
})
