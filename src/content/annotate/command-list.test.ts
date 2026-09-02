import { describe, expect, test } from 'vitest'
import { createCommandList, type AnnotationCommand } from './command-list'

/**
 * PRD FR-10 / review finding B4.
 *
 * Undo is a COMMAND LIST, never raster snapshots: 20 snapshots of a large
 * capture is ~640 MB, which is how the original memory budget became
 * impossible. A command is a description of a mark, not a copy of the canvas.
 */

const arrow = (id: string): AnnotationCommand => ({
  id,
  tool: 'arrow',
  color: '#FF5A00',
  weight: 2,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
})

const badge = (id: string): AnnotationCommand => ({
  id,
  tool: 'number',
  color: '#FF5A00',
  weight: 2,
  points: [{ x: 5, y: 5 }],
})

describe('command list', () => {
  test('starts empty', () => {
    const list = createCommandList()
    expect(list.commands()).toEqual([])
    expect(list.canUndo()).toBe(false)
    expect(list.canRedo()).toBe(false)
  })

  test('records commands in order', () => {
    const list = createCommandList()
    list.push(arrow('a'))
    list.push(arrow('b'))
    expect(list.commands().map((c) => c.id)).toEqual(['a', 'b'])
  })

  test('undo removes the most recent command', () => {
    const list = createCommandList()
    list.push(arrow('a'))
    list.push(arrow('b'))
    list.undo()
    expect(list.commands().map((c) => c.id)).toEqual(['a'])
  })

  test('redo restores an undone command', () => {
    const list = createCommandList()
    list.push(arrow('a'))
    list.undo()
    list.redo()
    expect(list.commands().map((c) => c.id)).toEqual(['a'])
  })

  test('a new command after undo discards the redo branch', () => {
    // Standard editor behaviour: branching history surprises people.
    const list = createCommandList()
    list.push(arrow('a'))
    list.push(arrow('b'))
    list.undo()
    list.push(arrow('c'))
    expect(list.commands().map((c) => c.id)).toEqual(['a', 'c'])
    expect(list.canRedo()).toBe(false)
  })

  test('undo on an empty list is a no-op rather than an error', () => {
    const list = createCommandList()
    expect(() => list.undo()).not.toThrow()
    expect(list.commands()).toEqual([])
  })

  test('redo with nothing undone is a no-op', () => {
    const list = createCommandList()
    list.push(arrow('a'))
    list.redo()
    expect(list.commands().map((c) => c.id)).toEqual(['a'])
  })

  test('keeps at least 20 levels of undo (FR-10)', () => {
    const list = createCommandList()
    for (let i = 0; i < 25; i++) list.push(arrow(`a${i}`))
    for (let i = 0; i < 20; i++) list.undo()
    expect(list.commands()).toHaveLength(5)
  })

  test('remove deletes a specific command by id', () => {
    const list = createCommandList()
    list.push(arrow('a'))
    list.push(arrow('b'))
    list.push(arrow('c'))
    list.remove('b')
    expect(list.commands().map((c) => c.id)).toEqual(['a', 'c'])
  })

  test('removing is itself undoable', () => {
    const list = createCommandList()
    list.push(arrow('a'))
    list.remove('a')
    list.undo()
    expect(list.commands().map((c) => c.id)).toEqual(['a'])
  })
})

describe('numbered badges (FR-8)', () => {
  test('numbers badges in the order they were placed', () => {
    const list = createCommandList()
    list.push(badge('x'))
    list.push(arrow('a'))
    list.push(badge('y'))
    expect(list.badgeNumbers()).toEqual({ x: 1, y: 2 })
  })

  test('renumbers after a badge is deleted', () => {
    // FR-8: badges auto-increment AND renumber on delete. A gap in the
    // sequence makes the screenshot wrong, not just untidy.
    const list = createCommandList()
    list.push(badge('x'))
    list.push(badge('y'))
    list.push(badge('z'))
    list.remove('y')
    expect(list.badgeNumbers()).toEqual({ x: 1, z: 2 })
  })

  test('renumbers after undo', () => {
    const list = createCommandList()
    list.push(badge('x'))
    list.push(badge('y'))
    list.undo()
    expect(list.badgeNumbers()).toEqual({ x: 1 })
  })

  test('ignores non-badge commands when numbering', () => {
    const list = createCommandList()
    list.push(arrow('a'))
    list.push(badge('x'))
    expect(list.badgeNumbers()).toEqual({ x: 1 })
  })
})
