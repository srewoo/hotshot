import { describe, expect, test } from 'vitest'
import { overlayKeyIntent } from './overlay-keys'

describe('overlayKeyIntent', () => {
  test('Escape cancels in either mode, even with a modifier held', () => {
    expect(overlayKeyIntent({ key: 'Escape' }, 'region')).toEqual({ kind: 'cancel' })
    expect(overlayKeyIntent({ key: 'Escape' }, 'element')).toEqual({ kind: 'cancel' })
    expect(overlayKeyIntent({ key: 'Escape', metaKey: true }, 'region')).toEqual({
      kind: 'cancel',
    })
  })

  test('Enter commits in either mode', () => {
    expect(overlayKeyIntent({ key: 'Enter' }, 'region')).toEqual({ kind: 'commit' })
    expect(overlayKeyIntent({ key: 'Enter' }, 'element')).toEqual({ kind: 'commit' })
  })

  test('brackets walk the element chain, on their physical keys', () => {
    expect(overlayKeyIntent({ key: ']', code: 'BracketRight' }, 'element')).toEqual({
      kind: 'walk',
      direction: 'out',
    })
    expect(overlayKeyIntent({ key: '[', code: 'BracketLeft' }, 'element')).toEqual({
      kind: 'walk',
      direction: 'in',
    })
  })

  /**
   * `]` is not on the same physical key on AZERTY. Dispatching on `key` would
   * make the walk bindings move with the layout, which for a picker is
   * unusable rather than merely surprising.
   */
  test('the walk is decided by code, not by the character produced', () => {
    // An AZERTY layout reporting a different character on the same key.
    expect(overlayKeyIntent({ key: '$', code: 'BracketRight' }, 'element')).toEqual({
      kind: 'walk',
      direction: 'out',
    })
  })

  test('brackets do nothing in region mode, where there is no chain', () => {
    expect(overlayKeyIntent({ key: ']', code: 'BracketRight' }, 'region')).toBeNull()
  })

  test('arrows nudge a region selection', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(overlayKeyIntent({ key }, 'region')).toEqual({ kind: 'nudge' })
    }
  })

  test('arrows do nothing in element mode, which walks with brackets', () => {
    expect(overlayKeyIntent({ key: 'ArrowLeft' }, 'element')).toBeNull()
  })

  /** FR-29: the overlay must not swallow the browser's own shortcuts. */
  test.each(['r', 't', 'w', 'l', 'Enter', 'ArrowLeft', ']'])(
    'leaves a modified %s to the browser',
    (key) => {
      expect(overlayKeyIntent({ key, code: 'BracketRight', metaKey: true }, 'region')).toBeNull()
      expect(overlayKeyIntent({ key, code: 'BracketRight', ctrlKey: true }, 'element')).toBeNull()
    },
  )

  test('an unbound key produces nothing', () => {
    expect(overlayKeyIntent({ key: 'q', code: 'KeyQ' }, 'region')).toBeNull()
    expect(overlayKeyIntent({ key: ' ', code: 'Space' }, 'element')).toBeNull()
  })
})
