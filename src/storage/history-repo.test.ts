import { beforeEach, describe, expect, test } from 'vitest'
import {
  createHistoryRepo,
  expiredBefore,
  HISTORY_LIMIT,
  type HistoryEntry,
  type HistoryStore,
} from './history-repo'

/**
 * PRD FR-25 / FR-26.
 *
 * Retention is a privacy promise, not a convenience feature — and the
 * Incognito rule ships regardless of whether history itself does.
 */

function fakeStore(): HistoryStore & { rows: Map<string, HistoryEntry> } {
  const rows = new Map<string, HistoryEntry>()
  return {
    rows,
    async put(entry) {
      rows.set(entry.id, entry)
    },
    async all() {
      return [...rows.values()]
    },
    async delete(ids) {
      for (const id of ids) rows.delete(id)
    },
  }
}

const entry = (id: string, capturedAt: number, incognito = false): HistoryEntry => ({
  id,
  capturedAt,
  sourceUrl: 'https://example.com/page',
  title: 'Example',
  widthDevicePx: 800,
  heightDevicePx: 600,
  bytes: 1024,
  incognito,
})

describe('retention window', () => {
  const now = Date.UTC(2026, 8, 2, 12, 0, 0)
  const day = 24 * 60 * 60 * 1000

  test('session-only expires everything already stored', () => {
    expect(expiredBefore('session', now)).toBe(now)
  })

  test('7 days is the default window', () => {
    expect(expiredBefore('7d', now)).toBe(now - 7 * day)
  })

  test('30 days is supported', () => {
    expect(expiredBefore('30d', now)).toBe(now - 30 * day)
  })
})

describe('history repo', () => {
  let store: ReturnType<typeof fakeStore>

  beforeEach(() => {
    store = fakeStore()
  })

  test('records a capture and reads it back', async () => {
    const repo = createHistoryRepo(store)
    await repo.record(entry('a', 1_000))
    expect((await repo.list()).map((e) => e.id)).toEqual(['a'])
  })

  test('lists newest first, which is the order a person wants', async () => {
    const repo = createHistoryRepo(store)
    await repo.record(entry('old', 1_000))
    await repo.record(entry('new', 5_000))
    expect((await repo.list()).map((e) => e.id)).toEqual(['new', 'old'])
  })

  test('NEVER writes an Incognito capture, regardless of retention setting', async () => {
    // FR-26: this rule ships even if history itself slips.
    const repo = createHistoryRepo(store)
    await repo.record(entry('secret', 1_000, true))
    expect(await repo.list()).toEqual([])
    expect(store.rows.size).toBe(0)
  })

  test('keeps at most 20 captures, evicting the oldest', async () => {
    expect(HISTORY_LIMIT).toBe(20)
    const repo = createHistoryRepo(store)
    for (let i = 0; i < 25; i++) await repo.record(entry(`e${i}`, i * 1_000))

    const ids = (await repo.list()).map((e) => e.id)
    expect(ids).toHaveLength(20)
    expect(ids).not.toContain('e0')
    expect(ids).toContain('e24')
  })

  test('prune removes entries older than the retention window', async () => {
    const repo = createHistoryRepo(store)
    await repo.record(entry('stale', 1_000))
    await repo.record(entry('fresh', 9_000))

    await repo.prune(5_000)

    expect((await repo.list()).map((e) => e.id)).toEqual(['fresh'])
  })

  test('clear removes everything', async () => {
    const repo = createHistoryRepo(store)
    await repo.record(entry('a', 1))
    await repo.record(entry('b', 2))

    await repo.clear()

    expect(await repo.list()).toEqual([])
  })

  test('remove deletes one capture by id', async () => {
    const repo = createHistoryRepo(store)
    await repo.record(entry('a', 1))
    await repo.record(entry('b', 2))

    await repo.remove('a')

    expect((await repo.list()).map((e) => e.id)).toEqual(['b'])
  })

  test('records the source URL so a capture can be traced back', async () => {
    const repo = createHistoryRepo(store)
    await repo.record(entry('a', 1))
    expect((await repo.list())[0]?.sourceUrl).toBe('https://example.com/page')
  })
})
