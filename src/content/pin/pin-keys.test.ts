import { describe, expect, test } from 'vitest'
import { pinKeyIntent } from './pin-keys'
import { OPACITY_CYCLE } from './pin-layout'

describe('pinKeyIntent', () => {
  test.each(['Escape', 'Delete', 'Backspace'])('%s dismisses', (key) => {
    expect(pinKeyIntent({ key })).toEqual({ kind: 'dismiss' })
  })

  test('Tab cycles focus, Shift+Tab the other way', () => {
    expect(pinKeyIntent({ key: 'Tab', code: 'Tab' })).toEqual({ kind: 'focus', direction: 1 })
    expect(pinKeyIntent({ key: 'Tab', code: 'Tab', shiftKey: true })).toEqual({
      kind: 'focus',
      direction: -1,
    })
  })

  test('digits 1-4 set the four opacity levels outright', () => {
    OPACITY_CYCLE.forEach((level, index) => {
      expect(pinKeyIntent({ key: String(index + 1) })).toEqual({ kind: 'opacity', level })
    })
  })

  test('a digit past the levels does nothing rather than a wrong level', () => {
    expect(pinKeyIntent({ key: '5' })).toBeNull()
    expect(pinKeyIntent({ key: '0' })).toBeNull()
  })

  test('O cycles opacity, for when the level is not known in advance', () => {
    expect(pinKeyIntent({ key: 'o', code: 'KeyO' })).toEqual({ kind: 'cycle-opacity' })
  })

  test('C crops within the pin', () => {
    expect(pinKeyIntent({ key: 'c', code: 'KeyC' })).toEqual({ kind: 'crop' })
  })

  test('brackets step the stack, Shift jumps the whole way', () => {
    expect(pinKeyIntent({ key: ']', code: 'BracketRight' })).toEqual({
      kind: 'stack',
      move: 'forward',
    })
    expect(pinKeyIntent({ key: '[', code: 'BracketLeft' })).toEqual({
      kind: 'stack',
      move: 'backward',
    })
    expect(pinKeyIntent({ key: ']', code: 'BracketRight', shiftKey: true })).toEqual({
      kind: 'stack',
      move: 'front',
    })
    expect(pinKeyIntent({ key: '[', code: 'BracketLeft', shiftKey: true })).toEqual({
      kind: 'stack',
      move: 'back',
    })
  })

  test('arrows nudge by one, Shift by ten', () => {
    expect(pinKeyIntent({ key: 'ArrowLeft' })).toEqual({ kind: 'nudge', dx: -1, dy: 0 })
    expect(pinKeyIntent({ key: 'ArrowDown', shiftKey: true })).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: 10,
    })
  })

  /**
   * A pin lives on someone else's page for hours. Swallowing ⌘R or ⌘W would be
   * indistinguishable from a broken site, and the user would blame the site.
   */
  test.each(['r', 'w', 't', 'c', 'o', '1', 'ArrowLeft', 'Escape'])(
    'leaves a modified %s to the browser',
    (key) => {
      expect(pinKeyIntent({ key, code: `Key${key.toUpperCase()}`, metaKey: true })).toBeNull()
      expect(pinKeyIntent({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true })).toBeNull()
      expect(pinKeyIntent({ key, code: `Key${key.toUpperCase()}`, altKey: true })).toBeNull()
    },
  )

  test('an unbound key produces nothing', () => {
    expect(pinKeyIntent({ key: 'q', code: 'KeyQ' })).toBeNull()
    expect(pinKeyIntent({ key: 'Enter', code: 'Enter' })).toBeNull()
  })
})
