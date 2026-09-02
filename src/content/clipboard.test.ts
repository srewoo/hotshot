// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest'
import { writeImageToClipboard, type ClipboardTarget } from './clipboard'
import { isErr, isOk } from '../shared/result'

/**
 * PRD FR-42 / review finding B5.
 *
 * The clipboard write MUST happen in a focused document, in the user's
 * gesture. An offscreen document can never take focus, so `navigator.clipboard`
 * throws `NotAllowedError` there — the mechanism the reviewer identified.
 *
 * B5's downstream point stands regardless of mechanism: FR-20 tears the
 * overlay down immediately, which can race the write. So the write is
 * awaited BEFORE teardown, and a failure degrades to a stated fallback rather
 * than losing the capture silently.
 */

const blob = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

function target(overrides: Partial<ClipboardTarget> = {}): ClipboardTarget {
  return {
    hasFocus: () => true,
    write: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('writeImageToClipboard', () => {
  test('writes a PNG when the document is focused', async () => {
    const t = target()
    const result = await writeImageToClipboard(blob(), t)

    expect(isOk(result)).toBe(true)
    expect(t.write).toHaveBeenCalledTimes(1)
  })

  test('refuses without attempting the write when the document is not focused', async () => {
    // Attempting it anyway produces a confusing NotAllowedError; refusing
    // early lets the caller degrade deliberately.
    const t = target({ hasFocus: () => false })
    const result = await writeImageToClipboard(blob(), t)

    expect(isErr(result)).toBe(true)
    expect(t.write).not.toHaveBeenCalled()
  })

  test('names the focus problem so the fallback can explain itself', async () => {
    const t = target({ hasFocus: () => false })
    const result = await writeImageToClipboard(blob(), t)
    expect(isErr(result) && result.error.reason).toBe('not-focused')
  })

  test('reports a rejected write rather than throwing', async () => {
    const t = target({
      write: vi.fn(async () => {
        throw new DOMException('Denied', 'NotAllowedError')
      }),
    })
    const result = await writeImageToClipboard(blob(), t)

    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.reason).toBe('write-failed')
    expect(isErr(result) && result.error.detail).toMatch(/Denied/)
  })

  test('rejects a non-PNG blob instead of writing an unreadable clipboard entry', async () => {
    const t = target()
    const jpeg = new Blob([new Uint8Array([1])], { type: 'image/jpeg' })
    const result = await writeImageToClipboard(jpeg, t)

    expect(isErr(result) && result.error.reason).toBe('unsupported-type')
    expect(t.write).not.toHaveBeenCalled()
  })

  test('rejects an empty blob', async () => {
    const t = target()
    const empty = new Blob([], { type: 'image/png' })
    const result = await writeImageToClipboard(empty, t)

    expect(isErr(result) && result.error.reason).toBe('empty')
    expect(t.write).not.toHaveBeenCalled()
  })

  test('completes the write before resolving, so teardown cannot race it', async () => {
    // FR-20's fire-and-forget is explicitly carved out for the clipboard.
    let settled = false
    const t = target({
      write: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5))
        settled = true
      }),
    })

    await writeImageToClipboard(blob(), t)

    expect(settled).toBe(true)
  })
})
