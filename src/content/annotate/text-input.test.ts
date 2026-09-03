// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openTextInput } from './text-input'
import { TEXT_FONT_FAMILY, TEXT_FONT_SIZE_PX } from './canvas-surface'

/**
 * The text tool's replacement for `window.prompt`.
 *
 * What is worth testing here is the commit contract — when text is kept, when
 * it is dropped, and that keystrokes never escape to the editor's global
 * handler, which would turn typing "arrow" into five tool switches.
 */

function open(over: Partial<Parameters<typeof openTextInput>[1]> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  const handle = openTextInput(host, {
    value: '',
    at: { x: 100, y: 200 },
    fontSizePx: TEXT_FONT_SIZE_PX,
    color: '#FF5A00',
    onCommit,
    onCancel,
    ...over,
  })
  const field = host.querySelector('textarea') as HTMLTextAreaElement
  return { host, field, handle, onCommit, onCancel }
}

function press(field: HTMLTextAreaElement, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  field.dispatchEvent(event)
  return event
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('openTextInput', () => {
  test('mounts a focused field at the requested position', () => {
    const { field } = open()
    expect(field).toBeTruthy()
    expect(field.style.position).toBe('fixed')
    // Offset by the plate padding so the glyphs, not the plate, land on the
    // point the user clicked.
    expect(field.style.left).toBe('96px')
    expect(field.style.top).toBe('197px')
  })

  test('renders in the same face the canvas will draw, so nothing reflows on commit', () => {
    const { field } = open()
    expect(field.style.font).toContain(`${TEXT_FONT_SIZE_PX}px`)
    expect(field.style.font).toContain(TEXT_FONT_FAMILY.split(',')[0]!.trim())
  })

  test('scales the field with the view, so a zoomed-out capture types at size', () => {
    const { field } = open({ fontSizePx: 30 })
    expect(field.style.font).toContain('30px')
    // Padding scales with the font, keeping the plate proportional.
    expect(field.style.left).toBe('92px')
  })

  test('lets the browser choose direction, which is what makes RTL work', () => {
    const { field } = open()
    expect(field.dir).toBe('auto')
  })

  test('seeds an existing value and puts the caret at its end', () => {
    const { field } = open({ value: 'existing label' })
    expect(field.value).toBe('existing label')
    expect(field.selectionStart).toBe('existing label'.length)
    expect(field.selectionEnd).toBe('existing label'.length)
  })

  test('Enter commits the text and removes the field', () => {
    const { field, onCommit, onCancel, host } = open()
    field.value = 'check this'
    press(field, 'Enter')
    expect(onCommit).toHaveBeenCalledWith('check this')
    expect(onCancel).not.toHaveBeenCalled()
    expect(host.querySelector('textarea')).toBeNull()
  })

  test('Shift+Enter inserts a newline instead of committing', () => {
    const { field, onCommit } = open()
    field.value = 'line one'
    const event = press(field, 'Enter', true)
    expect(onCommit).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  test('Escape cancels and keeps nothing', () => {
    const { field, onCommit, onCancel } = open()
    field.value = 'never mind'
    press(field, 'Escape')
    expect(onCancel).toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  test('blur commits, because losing a sentence to a stray click is the worst default', () => {
    const { field, onCommit } = open()
    field.value = 'kept'
    field.dispatchEvent(new FocusEvent('blur'))
    expect(onCommit).toHaveBeenCalledWith('kept')
  })

  test('commits exactly once, even though tearing down also blurs', () => {
    const { field, onCommit, onCancel } = open()
    field.value = 'once'
    press(field, 'Enter')
    field.dispatchEvent(new FocusEvent('blur'))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  test.each(['', '   ', '\n\t '])('whitespace-only input (%j) cancels rather than adding an invisible mark', (value) => {
    const { field, onCommit, onCancel } = open()
    field.value = value
    press(field, 'Enter')
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  test('trims the committed value', () => {
    const { field, onCommit } = open()
    field.value = '  padded  '
    press(field, 'Enter')
    expect(onCommit).toHaveBeenCalledWith('padded')
  })

  /**
   * The bug this prevents: the editor listens for keydown on `window` in the
   * capture phase and maps bare letters to tools. Typing "arrow" would switch
   * tool five times and type nothing.
   */
  test.each(['a', 'A', 'k', 'n', '1', '0', '-', '[', 'Backspace', 'Delete'])(
    'stops %j from reaching the editor keymap',
    (key) => {
      const { field } = open()
      // A capture-phase window listener still sees the event — nothing can
      // stop that — so the editor also guards on `textEditing`. What this
      // asserts is that propagation stops at the field, so no bubble-phase
      // handler on the page or the overlay ever sees the keystroke.
      const bubbled: string[] = []
      const bubbleSpy = (e: Event) => bubbled.push((e as KeyboardEvent).key)
      window.addEventListener('keydown', bubbleSpy)
      press(field, key)
      window.removeEventListener('keydown', bubbleSpy)
      expect(bubbled).toEqual([])
    },
  )

  test('destroy removes the field without committing or cancelling', () => {
    const { field, handle, onCommit, onCancel, host } = open()
    field.value = 'abandoned'
    handle.destroy()
    expect(host.querySelector('textarea')).toBeNull()
    expect(onCommit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  test('destroy after a commit is a no-op rather than a double teardown', () => {
    const { field, handle, onCommit } = open()
    field.value = 'done'
    press(field, 'Enter')
    expect(() => handle.destroy()).not.toThrow()
    expect(onCommit).toHaveBeenCalledTimes(1)
  })
})
