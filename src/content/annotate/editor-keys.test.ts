import { describe, expect, test } from 'vitest'
import { keyIntent, stepWeight } from './editor-keys'
import { PALETTE, TOOLS, WEIGHTS } from './toolbar'

/**
 * FR-44's collision audit, as a test rather than a table.
 *
 * The review found four keybinding collisions by reading carefully. This suite
 * asserts the resolved map mechanically, including the rule that makes it
 * safe: a bare key belongs to the editor, a modified key belongs to the
 * browser.
 */

describe('keyIntent', () => {
  test('Escape cancels, even while a modifier is held', () => {
    expect(keyIntent({ code: 'Escape' })).toEqual({ kind: 'cancel' })
    expect(keyIntent({ code: 'Escape', metaKey: true, shiftKey: true })).toEqual({
      kind: 'cancel',
    })
  })

  test('undo and redo', () => {
    expect(keyIntent({ code: 'KeyZ', metaKey: true })).toEqual({ kind: 'undo' })
    expect(keyIntent({ code: 'KeyZ', ctrlKey: true })).toEqual({ kind: 'undo' })
    expect(keyIntent({ code: 'KeyZ', metaKey: true, shiftKey: true })).toEqual({ kind: 'redo' })
  })

  test('the commit ladder', () => {
    expect(keyIntent({ code: 'Enter' })).toEqual({ kind: 'commit', action: 'download' })
    expect(keyIntent({ code: 'NumpadEnter' })).toEqual({ kind: 'commit', action: 'download' })
    expect(keyIntent({ code: 'Enter', metaKey: true, shiftKey: true })).toEqual({
      kind: 'commit',
      action: 'pin',
    })
    expect(keyIntent({ code: 'KeyC', metaKey: true, shiftKey: true })).toEqual({
      kind: 'commit',
      action: 'copy',
    })
  })

  test('every tool in the toolbar is reachable by its own code', () => {
    for (const spec of TOOLS) {
      expect(keyIntent({ code: spec.code })).toEqual({ kind: 'tool', tool: spec.tool })
    }
  })

  test('redact is K, because region mode owns R', () => {
    expect(keyIntent({ code: 'KeyK' })).toEqual({ kind: 'tool', tool: 'redact' })
    expect(keyIntent({ code: 'KeyB' })).toEqual({ kind: 'tool', tool: 'rect' })
  })

  test('every palette colour is reachable, and only those', () => {
    PALETTE.forEach((_, i) => {
      expect(keyIntent({ code: `Digit${i + 1}` })).toEqual({ kind: 'colour', index: i })
    })
    expect(keyIntent({ code: `Digit${PALETTE.length + 1}` })).toBeNull()
  })

  test('Digit0 fits the capture rather than selecting a colour', () => {
    expect(keyIntent({ code: 'Digit0' })).toEqual({ kind: 'fit' })
  })

  test('brackets step the stroke weight', () => {
    expect(keyIntent({ code: 'BracketLeft' })).toEqual({ kind: 'weight', index: -1 })
    expect(keyIntent({ code: 'BracketRight' })).toEqual({ kind: 'weight', index: 1 })
  })

  test('zoom on both the main row and the numpad', () => {
    expect(keyIntent({ code: 'Equal' })).toEqual({ kind: 'zoom', direction: 1 })
    expect(keyIntent({ code: 'NumpadAdd' })).toEqual({ kind: 'zoom', direction: 1 })
    expect(keyIntent({ code: 'Minus' })).toEqual({ kind: 'zoom', direction: -1 })
    expect(keyIntent({ code: 'NumpadSubtract' })).toEqual({ kind: 'zoom', direction: -1 })
  })

  test('both delete keys remove the selection', () => {
    expect(keyIntent({ code: 'Backspace' })).toEqual({ kind: 'delete' })
    expect(keyIntent({ code: 'Delete' })).toEqual({ kind: 'delete' })
  })

  /**
   * FR-29: the overlay must not swallow the page's or the browser's own
   * shortcuts. ⌘R, ⌘T, ⌘L and friends have to pass straight through.
   */
  test.each(['KeyR', 'KeyT', 'KeyL', 'KeyN', 'KeyA', 'KeyF', 'Digit1', 'Minus', 'Equal'])(
    'a modified %s is left to the browser',
    (code) => {
      expect(keyIntent({ code, metaKey: true })).toBeNull()
      expect(keyIntent({ code, ctrlKey: true })).toBeNull()
      expect(keyIntent({ code, altKey: true })).toBeNull()
    },
  )

  test('an unbound key produces no intent', () => {
    expect(keyIntent({ code: 'KeyQ' })).toBeNull()
    expect(keyIntent({ code: 'F5' })).toBeNull()
    expect(keyIntent({ code: 'Space' })).toBeNull()
  })

  test('no two bare bindings resolve to the same intent by accident', () => {
    const codes = [
      ...TOOLS.map((t) => t.code),
      ...PALETTE.map((_, i) => `Digit${i + 1}`),
      'Digit0',
      'BracketLeft',
      'BracketRight',
      'Equal',
      'Minus',
      'Backspace',
      'Delete',
      'Enter',
      'Escape',
    ]
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('stepWeight', () => {
  test('steps up and down through the available weights', () => {
    expect(stepWeight(WEIGHTS[0] as number, 1)).toBe(WEIGHTS[1])
    expect(stepWeight(WEIGHTS[1] as number, -1)).toBe(WEIGHTS[0])
  })

  test('clamps at both ends rather than wrapping, which would be a surprise', () => {
    expect(stepWeight(WEIGHTS[0] as number, -1)).toBe(WEIGHTS[0])
    expect(stepWeight(WEIGHTS[WEIGHTS.length - 1] as number, 1)).toBe(
      WEIGHTS[WEIGHTS.length - 1],
    )
  })

  test('an unknown current weight starts from the thinnest rather than failing', () => {
    expect(stepWeight(999, 1)).toBe(WEIGHTS[1])
  })
})
