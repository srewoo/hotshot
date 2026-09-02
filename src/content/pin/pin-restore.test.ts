import { beforeEach, describe, expect, test } from 'vitest'
import { createPinRestore, RESTORE_WINDOW_MS, type RestoreStore } from './pin-restore'

/**
 * PRD FR-38, DESIGN §3.9.
 *
 * A pin does not survive navigation — silently resurrecting an overlay on an
 * unexpected page would be worse than losing it. But the loss must be
 * recoverable, so the strip turns it into one keypress, backed by real
 * persisted state rather than a promise the product cannot keep.
 */

function fakeStore(): RestoreStore & { rows: Map<string, string[]> } {
  const rows = new Map<string, string[]>()
  return {
    rows,
    async read(origin) {
      return rows.get(origin) ?? []
    },
    async write(origin, ids) {
      rows.set(origin, ids)
    },
  }
}

describe('pin restore', () => {
  let store: ReturnType<typeof fakeStore>

  beforeEach(() => {
    store = fakeStore()
  })

  test('offers nothing when no pins were dismissed', async () => {
    const restore = createPinRestore(store)
    expect(await restore.pending('https://example.com', Date.now())).toEqual([])
  })

  test('remembers pins lost to navigation', async () => {
    const restore = createPinRestore(store)
    await restore.remember('https://example.com', ['cap-1', 'cap-2'], 1_000)

    expect(await restore.pending('https://example.com', 1_500)).toEqual(['cap-1', 'cap-2'])
  })

  test('the offer expires after the restore window', async () => {
    // A restore strip that lingers forever is clutter; six seconds is the
    // window in which the user still remembers what they lost.
    expect(RESTORE_WINDOW_MS).toBe(6_000)

    const restore = createPinRestore(store)
    await restore.remember('https://example.com', ['cap-1'], 1_000)

    expect(await restore.pending('https://example.com', 1_000 + RESTORE_WINDOW_MS + 1)).toEqual([])
  })

  test('is scoped to the origin, so pins do not reappear on an unrelated site', async () => {
    const restore = createPinRestore(store)
    await restore.remember('https://example.com', ['cap-1'], 1_000)

    expect(await restore.pending('https://other.test', 1_500)).toEqual([])
  })

  test('consuming the offer clears it, so it cannot fire twice', async () => {
    const restore = createPinRestore(store)
    await restore.remember('https://example.com', ['cap-1'], 1_000)

    expect(await restore.consume('https://example.com', 1_500)).toEqual(['cap-1'])
    expect(await restore.pending('https://example.com', 1_600)).toEqual([])
  })

  test('consuming after the window returns nothing', async () => {
    const restore = createPinRestore(store)
    await restore.remember('https://example.com', ['cap-1'], 1_000)

    expect(await restore.consume('https://example.com', 99_000)).toEqual([])
  })

  test('remembering an empty set records nothing to offer', async () => {
    const restore = createPinRestore(store)
    await restore.remember('https://example.com', [], 1_000)
    expect(await restore.pending('https://example.com', 1_100)).toEqual([])
  })

  test('a later navigation replaces the earlier offer rather than accumulating', async () => {
    const restore = createPinRestore(store)
    await restore.remember('https://example.com', ['cap-1'], 1_000)
    await restore.remember('https://example.com', ['cap-2'], 2_000)

    expect(await restore.pending('https://example.com', 2_100)).toEqual(['cap-2'])
  })
})
