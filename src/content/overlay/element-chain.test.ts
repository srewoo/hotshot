// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest'
import { buildChain, HOTSHOT_HOST_ATTRIBUTE } from './element-chain'

/**
 * The DOM half of FR-3. Thin by design — every judgement lives in
 * `element-choice`, so this module only has to walk the tree correctly and
 * handle the three cases the PRD calls out: shadow DOM, our own overlay, and
 * elements Chrome will not let us reach.
 */

function stubRects(): void {
  // happy-dom returns zeroed rects. The chain builder must not depend on
  // measurement, so a fixed stub proves it reads geometry without judging it.
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const w = Number(this.getAttribute('data-w') ?? 100)
    const h = Number(this.getAttribute('data-h') ?? 50)
    return { x: 0, y: 0, width: w, height: h, top: 0, left: 0, right: w, bottom: h, toJSON: () => ({}) } as DOMRect
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  stubRects()
})

describe('buildChain', () => {
  test('walks from the target out to body', () => {
    document.body.innerHTML = `<div id="wrap"><section><button id="b">go</button></section></div>`
    const button = document.getElementById('b')!

    const chain = buildChain(button)

    expect(chain.map((c) => c.tag)).toEqual(['button', 'section', 'div', 'body'])
  })

  test('reports each element own measured size', () => {
    document.body.innerHTML = `<div data-w="400" data-h="300"><span data-w="40" data-h="16">x</span></div>`
    const span = document.querySelector('span')!

    const chain = buildChain(span)

    expect(chain[0]?.rect).toMatchObject({ width: 40, height: 16 })
    expect(chain[1]?.rect).toMatchObject({ width: 400, height: 300 })
  })

  test('returns an empty chain for a null target rather than throwing', () => {
    expect(buildChain(null)).toEqual([])
  })

  test('never includes Hotshot own overlay host', () => {
    // The overlay sits above the page; walking into it would let the user
    // "capture" our own UI.
    const host = document.createElement('div')
    host.setAttribute(HOTSHOT_HOST_ATTRIBUTE, '')
    const inner = document.createElement('span')
    host.append(inner)
    document.body.append(host)

    expect(buildChain(inner)).toEqual([])
  })

  test('crosses a shadow boundary to the host element', () => {
    // FR-3 requires resolving shadow-DOM hosts rather than dead-ending.
    document.body.innerHTML = `<div id="outer"><my-card id="card"></my-card></div>`
    const card = document.getElementById('card')!
    const root = card.attachShadow({ mode: 'open' })
    const inner = document.createElement('p')
    root.append(inner)

    const chain = buildChain(inner)

    expect(chain.map((c) => c.tag)).toEqual(['p', 'my-card', 'div', 'body'])
  })

  test('keeps the element own tag name lowercased for stable comparison', () => {
    document.body.innerHTML = `<DIV><SPAN>x</SPAN></DIV>`
    const span = document.querySelector('span')!
    expect(buildChain(span)[0]?.tag).toBe('span')
  })

  test('stops at body and does not include html or document', () => {
    document.body.innerHTML = `<p>text</p>`
    const p = document.querySelector('p')!
    const tags = buildChain(p).map((c) => c.tag)
    expect(tags).toContain('body')
    expect(tags).not.toContain('html')
  })
})
