// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { buildTargetPicker } from './target-picker'
import type { TargetCandidate } from '../../integrations/provider'

/**
 * FR-41's list. The behaviours worth pinning are the ones a careless
 * implementation gets wrong in a way that ships to the wrong place: what Enter
 * sends when nothing is highlighted, and whether arrowing wraps.
 */

const candidates: TargetCandidate[] = [
  { key: 'ABC-1', title: 'Login fails on Safari', hint: 'ABC-1' },
  { key: 'ABC-2', title: 'Invoice table overflows', hint: 'ABC-2' },
  { key: 'ABC-3', title: 'Add export button', hint: 'ABC-3' },
]

beforeEach(() => {
  document.body.innerHTML = ''
})

function picker() {
  const chosen = vi.fn()
  const instance = buildTargetPicker(chosen)
  document.body.append(instance.element)
  return { instance, chosen }
}

describe('buildTargetPicker', () => {
  test('starts hidden', () => {
    const { instance } = picker()
    expect(instance.visible).toBe(false)
    expect(instance.element.style.display).toBe('none')
  })

  test('shows a row per candidate, with its title and hint', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    const rows = instance.element.querySelectorAll('[role="option"]')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('Login fails on Safari')
    expect(rows[0]?.textContent).toContain('ABC-1')
  })

  /**
   * The load-bearing default. If a candidate were preselected, a user who
   * pasted an id and pressed Enter would ship to whatever the search happened
   * to return first — the wrong issue, silently.
   */
  test('highlights nothing until asked, so Enter sends what was typed', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    expect(instance.active()).toBeNull()
  })

  test('arrowing down highlights the first candidate, then the next', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    expect(instance.move(1)?.key).toBe('ABC-1')
    expect(instance.move(1)?.key).toBe('ABC-2')
    expect(instance.active()?.key).toBe('ABC-2')
  })

  test('clamps at both ends rather than wrapping', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    instance.move(1)
    expect(instance.move(-1)?.key, 'arrowing up from the first should stay').toBe('ABC-1')
    instance.move(1)
    instance.move(1)
    expect(instance.move(1)?.key, 'arrowing past the last should stay').toBe('ABC-3')
  })

  test('moving does nothing while hidden', () => {
    const { instance } = picker()
    expect(instance.move(1)).toBeNull()
  })

  test('an empty result shows the reason and offers the id escape hatch', () => {
    const { instance } = picker()
    instance.show([], 'Nothing matched — paste an id instead.')
    expect(instance.element.textContent).toContain('paste an id')
    expect(instance.element.querySelectorAll('[role="option"]')).toHaveLength(0)
    // Still visible: a silently absent list looks like a broken feature.
    expect(instance.visible).toBe(true)
  })

  test('choosing a row reports the candidate', () => {
    const { instance, chosen } = picker()
    instance.show(candidates, 'nothing')
    const row = instance.element.querySelectorAll('[role="option"]')[1] as HTMLElement
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(chosen).toHaveBeenCalledWith(candidates[1])
  })

  /**
   * `mousedown` rather than `click`: the search field has focus, and a click
   * blurs it first — which commits the field before the choice lands.
   */
  test('a row prevents the default mousedown so the field keeps focus', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    const row = instance.element.querySelectorAll('[role="option"]')[0] as HTMLElement
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    row.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  test('re-showing replaces the previous rows rather than appending', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    instance.show([candidates[0] as TargetCandidate], 'nothing')
    expect(instance.element.querySelectorAll('[role="option"]')).toHaveLength(1)
  })

  test('re-showing clears the highlight, since the rows are different rows', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    instance.move(1)
    instance.show(candidates, 'nothing')
    expect(instance.active()).toBeNull()
  })

  test('hiding clears the highlight so a reopen cannot send a stale target', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    instance.move(1)
    instance.hide()
    expect(instance.visible).toBe(false)
    expect(instance.active()).toBeNull()
  })

  test('busy state is additive, not a replacement for the list', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    instance.setBusy(true)
    // The rows a user is already reading must not vanish mid-keystroke.
    expect(instance.element.querySelectorAll('[role="option"]')).toHaveLength(3)
    expect(instance.element.textContent).toContain('Searching')
    instance.setBusy(false)
    expect(instance.element.textContent).not.toContain('Searching')
  })

  test('is announced to assistive tech as a listbox of options', () => {
    const { instance } = picker()
    instance.show(candidates, 'nothing')
    expect(instance.element.getAttribute('role')).toBe('listbox')
    instance.move(1)
    const rows = instance.element.querySelectorAll('[role="option"]')
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true')
    expect(rows[1]?.getAttribute('aria-selected')).toBe('false')
  })
})
