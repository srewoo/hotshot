import { describe, expect, test } from 'vitest'
import { DELAY_CHOICES, delayLabel, isDelaySeconds, resolveDelay } from './delay'

describe('isDelaySeconds', () => {
  test.each(DELAY_CHOICES)('accepts the offered choice %s', (value) => {
    expect(isDelaySeconds(value)).toBe(true)
  })

  test.each([1, 2, 7, 30, -3, 3.5, '3', null, undefined, {}, Number.NaN])(
    'rejects %j, which no UI can produce',
    (value) => {
      expect(isDelaySeconds(value)).toBe(false)
    },
  )
})

describe('resolveDelay', () => {
  test('an explicit choice wins over the stored default', () => {
    expect(resolveDelay(5, 10)).toBe(5)
  })

  /**
   * The bug this exists to prevent: treating an explicit 0 as "unset" lets a
   * stored default reappear on the very capture where the user turned it off.
   */
  test('an explicit zero is a choice, not an absence', () => {
    expect(resolveDelay(0, 10)).toBe(0)
  })

  test('falls back to the stored default when nothing was chosen', () => {
    expect(resolveDelay(undefined, 3)).toBe(3)
    expect(resolveDelay(null, 3)).toBe(3)
  })

  test('falls back to no delay when neither is usable', () => {
    expect(resolveDelay(undefined, undefined)).toBe(0)
    expect(resolveDelay('soon', 99)).toBe(0)
  })

  test('never returns a value outside the offered choices', () => {
    for (const requested of [7, '5', -1, undefined]) {
      for (const fallback of [7, '5', -1, undefined]) {
        expect(DELAY_CHOICES).toContain(resolveDelay(requested, fallback))
      }
    }
  })
})

describe('delayLabel', () => {
  test('names the off state rather than showing a bare zero', () => {
    expect(delayLabel(0)).toBe('None')
  })

  test('labels the rest in seconds', () => {
    expect(delayLabel(3)).toBe('3s')
    expect(delayLabel(10)).toBe('10s')
  })
})
