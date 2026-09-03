import { describe, expect, test, vi } from 'vitest'
import { CACHE_TTL_MS, createTargetCache, isFresh, parseEntry } from './target-cache'

function fakeArea() {
  const store: Record<string, unknown> = {}
  return {
    store,
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
    ),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items)
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const key of keys) delete store[key]
    }),
  }
}

const candidates = [{ key: 'ABC-1', title: 'Login fails', hint: 'ABC-1' }]

describe('isFresh', () => {
  test('a just-written entry is fresh', () => {
    expect(isFresh({ at: 1_000, candidates: [] }, 1_000)).toBe(true)
  })

  test('an entry past the TTL is stale', () => {
    expect(isFresh({ at: 0, candidates: [] }, CACHE_TTL_MS + 1)).toBe(false)
  })

  test('the boundary is exclusive, so the TTL means what it says', () => {
    expect(isFresh({ at: 0, candidates: [] }, CACHE_TTL_MS)).toBe(false)
    expect(isFresh({ at: 0, candidates: [] }, CACHE_TTL_MS - 1)).toBe(true)
  })

  /**
   * A laptop waking from sleep, or an NTP correction, can move the clock
   * backwards. Treating a future timestamp as fresh would pin a stale list
   * until the clock caught up.
   */
  test('an entry timestamped in the future is not fresh', () => {
    expect(isFresh({ at: 5_000, candidates: [] }, 1_000)).toBe(false)
  })

  test('a missing entry is never fresh', () => {
    expect(isFresh(null, 1_000)).toBe(false)
  })
})

describe('parseEntry', () => {
  test('accepts a well-formed entry', () => {
    expect(parseEntry({ at: 5, candidates })).toEqual({ at: 5, candidates })
  })

  test.each([null, undefined, 7, 'x', [], {}, { at: 'soon', candidates: [] }, { at: 1 }])(
    'rejects a malformed entry (%j)',
    (value) => {
      expect(parseEntry(value)).toBeNull()
    },
  )

  /**
   * Storage is shared with older and newer versions of the extension, so its
   * contents are untrusted input like any other boundary (CLAUDE.md §2).
   */
  test('drops candidates that are not usable rather than the whole entry', () => {
    const entry = parseEntry({
      at: 1,
      candidates: [{ key: 'A-1', title: 'ok' }, { key: 5 }, null, { title: 'no key' }],
    })
    expect(entry?.candidates).toEqual([{ key: 'A-1', title: 'ok' }])
  })
})

describe('createTargetCache', () => {
  test('returns nothing before anything is written', async () => {
    const cache = createTargetCache(fakeArea())
    expect(await cache.read('jira')).toBeNull()
  })

  test('round-trips a list within the TTL', async () => {
    const cache = createTargetCache(fakeArea())
    await cache.write('jira', candidates, 1_000)
    expect(await cache.read('jira', 1_500)).toEqual(candidates)
  })

  test('expires a list after the TTL', async () => {
    const cache = createTargetCache(fakeArea())
    await cache.write('jira', candidates, 1_000)
    expect(await cache.read('jira', 1_000 + CACHE_TTL_MS)).toBeNull()
  })

  test('keeps services apart', async () => {
    const cache = createTargetCache(fakeArea())
    await cache.write('jira', candidates, 1_000)
    expect(await cache.read('notion', 1_000)).toBeNull()
  })

  test('clear removes the cached titles, which are account data', async () => {
    const area = fakeArea()
    const cache = createTargetCache(area)
    await cache.write('jira', candidates, 1_000)
    await cache.clear('jira')
    expect(await cache.read('jira', 1_000)).toBeNull()
    expect(Object.keys(area.store)).toHaveLength(0)
  })

  test('honours a custom TTL', async () => {
    const cache = createTargetCache(fakeArea(), 10)
    await cache.write('jira', candidates, 0)
    expect(await cache.read('jira', 5)).toEqual(candidates)
    expect(await cache.read('jira', 11)).toBeNull()
  })
})
