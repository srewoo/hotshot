import { describe, expect, test } from 'vitest'
import {
  boundsOf,
  hitTest,
  isResizable,
  restyleCommand,
  scaleCommand,
  textBounds,
  translateCommand,
  type MeasureText,
} from './object-edit'
import type { AnnotationCommand, AnnotationTool } from './command-list'

/**
 * The geometry behind "click the thing you can see".
 *
 * Hit-testing is where an annotation editor feels either precise or broken,
 * and it is entirely arithmetic — so it is tested here rather than through a
 * browser, where a miss is a screenshot diff nobody can read.
 */

/** 8px per character: a stand-in for the canvas measurer, exact in tests. */
const measure: MeasureText = (value) => value.length * 8

function cmd(over: Partial<AnnotationCommand> & { tool: AnnotationTool }): AnnotationCommand {
  return {
    id: 'c1',
    color: '#FF5A00',
    weight: 2,
    points: [
      { x: 100, y: 100 },
      { x: 200, y: 160 },
    ],
    ...over,
  }
}

describe('boundsOf', () => {
  test('pads a stroked shape by half its weight so the box never crops the ink', () => {
    const box = boundsOf(cmd({ tool: 'rect', weight: 8 }), measure)
    expect(box).toEqual({ x: 96, y: 96, width: 108, height: 68 })
  })

  test('pads an arrow by the head, which reaches past the tip', () => {
    const box = boundsOf(cmd({ tool: 'arrow' }), measure)
    expect(box.x).toBe(100 - 14)
    expect(box.width).toBe(100 + 28)
  })

  test('does not pad a fill — the rect IS the ink', () => {
    expect(boundsOf(cmd({ tool: 'highlight' }), measure)).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 60,
    })
    expect(boundsOf(cmd({ tool: 'redact' }), measure)).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 60,
    })
  })

  test('centres a badge box on its point', () => {
    const box = boundsOf(cmd({ tool: 'number', points: [{ x: 50, y: 60 }] }), measure)
    expect(box).toEqual({ x: 38, y: 48, width: 24, height: 24 })
  })

  test('measures a text box with the supplied measurer', () => {
    const box = boundsOf(
      cmd({ tool: 'text', points: [{ x: 20, y: 30 }], text: 'four' }),
      measure,
    )
    expect(box).toEqual(textBounds('four', { x: 20, y: 30 }, measure))
    expect(box.width).toBe(4 * 8 + 8)
  })

  test('spans every point of a freehand stroke, not just its ends', () => {
    const box = boundsOf(
      cmd({
        tool: 'freehand',
        points: [
          { x: 100, y: 100 },
          { x: 40, y: 300 },
          { x: 200, y: 160 },
        ],
      }),
      measure,
    )
    expect(box.x).toBeLessThanOrEqual(40)
    expect(box.y + box.height).toBeGreaterThanOrEqual(300)
  })

  test.each(['rect', 'ellipse', 'line', 'arrow', 'highlight', 'redact'] as const)(
    'is empty for a half-built %s, which cannot be selected',
    (tool) => {
      expect(boundsOf(cmd({ tool, points: [{ x: 10, y: 10 }] }), measure)).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      })
    },
  )

  test('is empty for a command with no points at all', () => {
    expect(boundsOf(cmd({ tool: 'rect', points: [] }), measure)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    })
  })
})

describe('hitTest', () => {
  test('grabs a line near its ink and misses it further away', () => {
    const line = cmd({
      tool: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    })
    expect(hitTest([line], { x: 50, y: 3 }, 4, measure)?.id).toBe('c1')
    expect(hitTest([line], { x: 50, y: 40 }, 4, measure)).toBeNull()
  })

  test('measures distance to the segment, not to its infinite extension', () => {
    const line = cmd({
      tool: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    })
    // On the line's axis but well past its end.
    expect(hitTest([line], { x: 400, y: 0 }, 4, measure)).toBeNull()
  })

  test('grabs a rectangle by its outline and ignores its interior', () => {
    const rect = cmd({ tool: 'rect', points: [{ x: 0, y: 0 }, { x: 200, y: 100 }] })
    expect(hitTest([rect], { x: 100, y: 1 }, 4, measure)?.id).toBe('c1')
    // The middle stays free so a mark can be drawn inside a box you drew.
    expect(hitTest([rect], { x: 100, y: 50 }, 4, measure)).toBeNull()
  })

  test('grabs a highlight anywhere inside it, unlike a rectangle', () => {
    const fill = cmd({ tool: 'highlight', points: [{ x: 0, y: 0 }, { x: 200, y: 100 }] })
    expect(hitTest([fill], { x: 100, y: 50 }, 4, measure)?.id).toBe('c1')
  })

  test('grabs an ellipse on its curve, not at its centre or its corner', () => {
    const ellipse = cmd({ tool: 'ellipse', points: [{ x: 0, y: 0 }, { x: 200, y: 100 }] })
    expect(hitTest([ellipse], { x: 200, y: 50 }, 4, measure)?.id).toBe('c1') // rightmost point
    expect(hitTest([ellipse], { x: 100, y: 50 }, 4, measure)).toBeNull() // centre
    expect(hitTest([ellipse], { x: 2, y: 2 }, 4, measure)).toBeNull() // bbox corner
  })

  test('grabs a collapsed ellipse as a line rather than dividing by zero', () => {
    const flat = cmd({ tool: 'ellipse', points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] })
    expect(hitTest([flat], { x: 100, y: 51 }, 4, measure)?.id).toBe('c1')
  })

  test('grabs a badge within its disc', () => {
    const badge = cmd({ tool: 'number', points: [{ x: 60, y: 60 }] })
    expect(hitTest([badge], { x: 66, y: 66 }, 2, measure)?.id).toBe('c1')
    expect(hitTest([badge], { x: 120, y: 60 }, 2, measure)).toBeNull()
  })

  test('follows a freehand stroke through its middle vertices', () => {
    const stroke = cmd({
      tool: 'freehand',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 200, y: 0 },
      ],
    })
    expect(hitTest([stroke], { x: 100, y: 98 }, 4, measure)?.id).toBe('c1')
    // Inside the V, far from either leg.
    expect(hitTest([stroke], { x: 100, y: 10 }, 4, measure)).toBeNull()
  })

  test('returns the topmost mark when marks overlap', () => {
    const under = cmd({ id: 'under', tool: 'highlight', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] })
    const over = cmd({ id: 'over', tool: 'highlight', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] })
    expect(hitTest([under, over], { x: 50, y: 50 }, 2, measure)?.id).toBe('over')
  })

  test('a wider stroke is easier to grab, because there is more of it', () => {
    const thin = cmd({ tool: 'line', weight: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })
    const thick = cmd({ tool: 'line', weight: 20, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })
    expect(hitTest([thin], { x: 50, y: 9 }, 1, measure)).toBeNull()
    expect(hitTest([thick], { x: 50, y: 9 }, 1, measure)?.id).toBe('c1')
  })

  test('a larger tolerance is what makes a scaled-down capture usable', () => {
    const line = cmd({ tool: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] })
    // 6 screen px on a 0.27x view is ~22 canvas px of slack.
    expect(hitTest([line], { x: 50, y: 18 }, 6, measure)).toBeNull()
    expect(hitTest([line], { x: 50, y: 18 }, 22, measure)?.id).toBe('c1')
  })

  test('finds nothing in an empty list', () => {
    expect(hitTest([], { x: 1, y: 1 }, 4, measure)).toBeNull()
  })
})

describe('translateCommand', () => {
  test('moves every point by the delta and keeps everything else', () => {
    const moved = translateCommand(cmd({ tool: 'arrow' }), 10, -5)
    expect(moved.points).toEqual([
      { x: 110, y: 95 },
      { x: 210, y: 155 },
    ])
    expect(moved.id).toBe('c1')
    expect(moved.color).toBe('#FF5A00')
  })

  test('is exactly reversible, so a drag can be undone by dragging back', () => {
    const original = cmd({ tool: 'freehand', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
    expect(translateCommand(translateCommand(original, 40, 9), -40, -9).points).toEqual(
      original.points,
    )
  })
})

describe('scaleCommand', () => {
  const from = { x: 0, y: 0, width: 100, height: 100 }

  test('maps points proportionally between boxes', () => {
    const scaled = scaleCommand(
      cmd({ tool: 'rect', points: [{ x: 0, y: 0 }, { x: 50, y: 100 }] }),
      from,
      { x: 0, y: 0, width: 200, height: 50 },
    )
    expect(scaled.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ])
  })

  test('carries the box offset, so resizing from a corner does not drift', () => {
    const scaled = scaleCommand(
      cmd({ tool: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }),
      from,
      { x: 30, y: 40, width: 100, height: 100 },
    )
    expect(scaled.points).toEqual([
      { x: 30, y: 40 },
      { x: 130, y: 140 },
    ])
  })

  test('translates a degenerate axis instead of producing NaN', () => {
    // A perfectly horizontal line: zero-height bbox.
    const flat = cmd({ tool: 'line', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] })
    const scaled = scaleCommand(flat, { x: 0, y: 50, width: 100, height: 0 }, {
      x: 0,
      y: 80,
      width: 200,
      height: 0,
    })
    expect(scaled.points).toEqual([
      { x: 0, y: 80 },
      { x: 200, y: 80 },
    ])
    for (const p of scaled.points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
    }
  })

  test('collapsing a box to nothing keeps the mark finite and recoverable', () => {
    const scaled = scaleCommand(cmd({ tool: 'rect' }), from, {
      x: 10,
      y: 10,
      width: 0,
      height: 0,
    })
    expect(scaled.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('restyleCommand', () => {
  test('changes colour without touching geometry', () => {
    const next = restyleCommand(cmd({ tool: 'rect' }), { color: '#1F6FEB' })
    expect(next.color).toBe('#1F6FEB')
    expect(next.weight).toBe(2)
    expect(next.points).toEqual(cmd({ tool: 'rect' }).points)
  })

  test('changes weight independently', () => {
    expect(restyleCommand(cmd({ tool: 'rect' }), { weight: 7 })).toMatchObject({
      color: '#FF5A00',
      weight: 7,
    })
  })

  test('an empty patch is a no-op rather than a reset to defaults', () => {
    expect(restyleCommand(cmd({ tool: 'rect' }), {})).toMatchObject({
      color: '#FF5A00',
      weight: 2,
    })
  })
})

describe('isResizable', () => {
  test.each(['rect', 'ellipse', 'line', 'arrow', 'freehand', 'highlight', 'redact'] as const)(
    '%s resizes',
    (tool) => expect(isResizable(cmd({ tool }))).toBe(true),
  )

  test.each(['number', 'text'] as const)('%s is point-anchored and only moves', (tool) =>
    expect(isResizable(cmd({ tool }))).toBe(false),
  )
})
