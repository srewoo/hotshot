import { describe, expect, test } from 'vitest'
import { renderCommands, type DrawSurface } from './render'
import type { AnnotationCommand } from './command-list'

/**
 * PRD FR-7/8/11. Rendering is tested by RECORDING the draw calls rather than
 * inspecting pixels: it verifies intent (a badge draws a filled disc and its
 * number; an arrow draws a shaft and a head) without a real canvas, and leaves
 * pixel-level truth to the redaction tests where it actually matters.
 */

function recorder() {
  const ops: string[] = []
  const surface: DrawSurface = {
    setStroke: (colour, weight) => ops.push(`stroke:${colour}:${weight}`),
    setFill: (colour) => ops.push(`fill:${colour}`),
    setAlpha: (a) => ops.push(`alpha:${a}`),
    line: (a, b) => ops.push(`line:${a.x},${a.y}->${b.x},${b.y}`),
    polyline: (pts) => ops.push(`poly:${pts.length}`),
    rect: (r) => ops.push(`rect:${r.x},${r.y},${r.width},${r.height}`),
    ellipse: (r) => ops.push(`ellipse:${r.x},${r.y},${r.width},${r.height}`),
    disc: (c, radius) => ops.push(`disc:${c.x},${c.y},${radius}`),
    text: (value, at) => ops.push(`text:${value}@${at.x},${at.y}`),
    pixels: () => new Uint8ClampedArray(0),
    putPixels: () => ops.push('putPixels'),
    width: 800,
    height: 600,
  }
  return { ops, surface }
}

const cmd = (over: Partial<AnnotationCommand>): AnnotationCommand => ({
  id: 'c1',
  tool: 'arrow',
  color: '#FF5A00',
  weight: 2,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ],
  ...over,
})

describe('renderCommands', () => {
  test('draws nothing for an empty list', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [], {})
    expect(ops).toEqual([])
  })

  test('applies colour and weight before drawing', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [cmd({ tool: 'line' })], {})
    expect(ops[0]).toBe('stroke:#FF5A00:2')
  })

  test('draws a line as a single segment', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [cmd({ tool: 'line' })], {})
    expect(ops).toContain('line:0,0->100,50')
  })

  test('draws an arrow as a shaft plus a head', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [cmd({ tool: 'arrow' })], {})
    const lines = ops.filter((o) => o.startsWith('line:'))
    // Shaft plus two head strokes.
    expect(lines.length).toBeGreaterThanOrEqual(3)
  })

  test('draws a rectangle from its two corner points', () => {
    const { ops, surface } = recorder()
    renderCommands(
      surface,
      [cmd({ tool: 'rect', points: [{ x: 10, y: 20 }, { x: 110, y: 70 }] })],
      {},
    )
    expect(ops).toContain('rect:10,20,100,50')
  })

  test('normalises a rectangle dragged up-and-left', () => {
    const { ops, surface } = recorder()
    renderCommands(
      surface,
      [cmd({ tool: 'rect', points: [{ x: 110, y: 70 }, { x: 10, y: 20 }] })],
      {},
    )
    expect(ops).toContain('rect:10,20,100,50')
  })

  test('draws an ellipse from its bounding box', () => {
    const { ops, surface } = recorder()
    renderCommands(
      surface,
      [cmd({ tool: 'ellipse', points: [{ x: 0, y: 0 }, { x: 80, y: 40 }] })],
      {},
    )
    expect(ops).toContain('ellipse:0,0,80,40')
  })

  test('draws freehand as a polyline, not a series of lines', () => {
    const { ops, surface } = recorder()
    const points = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i }))
    renderCommands(surface, [cmd({ tool: 'freehand', points })], {})
    expect(ops).toContain('poly:20')
  })

  test('draws a numbered badge as a disc with its number', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [cmd({ id: 'b1', tool: 'number', points: [{ x: 50, y: 50 }] })], {
      b1: 3,
    })
    expect(ops.some((o) => o.startsWith('disc:50,50'))).toBe(true)
    expect(ops).toContain('text:3@50,50')
  })

  test('omits a badge with no assigned number rather than drawing a blank disc', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [cmd({ id: 'b1', tool: 'number', points: [{ x: 5, y: 5 }] })], {})
    expect(ops).toEqual([])
  })

  test('draws highlight at reduced alpha and restores it afterwards', () => {
    const { ops, surface } = recorder()
    renderCommands(
      surface,
      [cmd({ tool: 'highlight', points: [{ x: 0, y: 0 }, { x: 50, y: 20 }] })],
      {},
    )
    expect(ops).toContain('alpha:0.35')
    expect(ops[ops.length - 1]).toBe('alpha:1')
  })

  test('draws text at its anchor point', () => {
    const { ops, surface } = recorder()
    renderCommands(
      surface,
      [cmd({ tool: 'text', text: 'note', points: [{ x: 12, y: 34 }] })],
      {},
    )
    expect(ops).toContain('text:note@12,34')
  })

  test('skips a text command with no content', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [cmd({ tool: 'text', points: [{ x: 1, y: 2 }] })], {})
    expect(ops).toEqual([])
  })

  test('skips a command with too few points instead of throwing', () => {
    const { ops, surface } = recorder()
    renderCommands(surface, [cmd({ tool: 'line', points: [] })], {})
    expect(ops).toEqual([])
  })

  test('redaction goes through the pixel path, never a stroke', () => {
    // FR-9: redaction must destroy pixels. Drawing a rectangle over them
    // would leave the originals in the buffer.
    const { ops, surface } = recorder()
    renderCommands(
      surface,
      [cmd({ tool: 'redact', points: [{ x: 0, y: 0 }, { x: 40, y: 40 }] })],
      {},
    )
    expect(ops).toContain('putPixels')
    expect(ops.some((o) => o.startsWith('rect:'))).toBe(false)
  })

  test('renders commands in order so later marks sit on top', () => {
    const { ops, surface } = recorder()
    renderCommands(
      surface,
      [cmd({ id: 'a', tool: 'line' }), cmd({ id: 'b', tool: 'rect', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] })],
      {},
    )
    expect(ops.findIndex((o) => o.startsWith('line:'))).toBeLessThan(
      ops.findIndex((o) => o.startsWith('rect:')),
    )
  })
})
