import { describe, expect, test } from 'vitest'
import {
  allTags,
  filterEntries,
  formatBytes,
  matchesQuery,
  quotaPlan,
  selectRange,
  storageUsage,
  toggleSelected,
  withTag,
  withoutTag,
} from './library-query'
import type { HistoryEntry } from './history-repo'

function entry(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'a',
    capturedAt: 1_000,
    sourceUrl: 'https://staging.acme.com/invoices/412',
    title: 'Invoice 412 — Acme',
    widthDevicePx: 1_200,
    heightDevicePx: 800,
    bytes: 400_000,
    incognito: false,
    ...over,
  }
}

describe('matchesQuery', () => {
  test('an empty query matches everything', () => {
    expect(matchesQuery(entry(), '')).toBe(true)
    expect(matchesQuery(entry(), '   ')).toBe(true)
  })

  test('matches the title', () => {
    expect(matchesQuery(entry(), 'invoice')).toBe(true)
  })

  test('matches the hostname, which is how people describe a capture', () => {
    expect(matchesQuery(entry(), 'staging')).toBe(true)
  })

  test('matches the full URL path', () => {
    expect(matchesQuery(entry(), 'invoices/412')).toBe(true)
  })

  test('matches a tag', () => {
    expect(matchesQuery(entry({ tags: ['regression'] }), 'regress')).toBe(true)
  })

  test('matches the destination it was sent to', () => {
    const sent = entry({ destination: { provider: 'jira', key: 'ABC-412' } })
    expect(matchesQuery(sent, 'abc-412')).toBe(true)
    expect(matchesQuery(sent, 'jira')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(matchesQuery(entry(), 'INVOICE')).toBe(true)
  })

  /**
   * Every term must match. A second word that widened the result set would
   * make search useless on a library where everything shares a hostname.
   */
  test('all terms must match, so a second word narrows', () => {
    expect(matchesQuery(entry(), 'invoice staging')).toBe(true)
    expect(matchesQuery(entry(), 'invoice production')).toBe(false)
  })

  test('does not match something absent', () => {
    expect(matchesQuery(entry(), 'receipt')).toBe(false)
  })

  test('survives an unparseable URL rather than throwing', () => {
    expect(matchesQuery(entry({ sourceUrl: 'not a url', title: 'Kept' }), 'kept')).toBe(true)
  })
})

describe('filterEntries', () => {
  const entries = [
    entry({ id: 'a', title: 'Invoice', favourite: true, tags: ['billing'] }),
    entry({ id: 'b', title: 'Login', destination: { provider: 'jira', key: 'ABC-1' } }),
    entry({ id: 'c', title: 'Report', tags: ['billing', 'weekly'] }),
  ]

  test('no filter returns everything', () => {
    expect(filterEntries(entries)).toHaveLength(3)
  })

  test('favourites only', () => {
    expect(filterEntries(entries, { favouritesOnly: true }).map((e) => e.id)).toEqual(['a'])
  })

  test('by tag', () => {
    expect(filterEntries(entries, { tag: 'billing' }).map((e) => e.id)).toEqual(['a', 'c'])
  })

  test('by destination', () => {
    expect(filterEntries(entries, { destination: 'jira' }).map((e) => e.id)).toEqual(['b'])
  })

  test('filters compose, rather than the last one winning', () => {
    expect(
      filterEntries(entries, { tag: 'billing', query: 'report' }).map((e) => e.id),
    ).toEqual(['c'])
  })
})

describe('tags', () => {
  test('lists every tag in use, sorted and deduplicated', () => {
    expect(
      allTags([entry({ tags: ['b', 'a'] }), entry({ tags: ['a', 'c'] }), entry()]),
    ).toEqual(['a', 'b', 'c'])
  })

  /**
   * Normalised at the single write path. A filter row showing both "Bug" and
   * "bug" is a library nobody trusts.
   */
  test('normalises case and whitespace when adding', () => {
    expect(withTag([], '  Bug  ')).toEqual(['bug'])
  })

  test('never adds a duplicate', () => {
    expect(withTag(['bug'], 'BUG')).toEqual(['bug'])
  })

  test('keeps tags sorted so the UI does not reshuffle', () => {
    expect(withTag(['zebra'], 'apple')).toEqual(['apple', 'zebra'])
  })

  test('caps length rather than storing a paragraph as a label', () => {
    expect(withTag([], 'x'.repeat(80))[0]).toHaveLength(24)
  })

  test('an empty tag is not added', () => {
    expect(withTag(['bug'], '   ')).toEqual(['bug'])
  })

  test('removes a tag', () => {
    expect(withoutTag(['bug', 'ui'], 'bug')).toEqual(['ui'])
  })

  test('removing an absent tag is a no-op', () => {
    expect(withoutTag(['bug'], 'nope')).toEqual(['bug'])
  })
})

describe('storageUsage', () => {
  test('sums count, bytes and favourites', () => {
    expect(
      storageUsage([
        entry({ bytes: 1_000, favourite: true }),
        entry({ bytes: 2_500 }),
      ]),
    ).toEqual({ count: 2, bytes: 3_500, favourites: 1 })
  })

  test('an empty library reports zero rather than NaN', () => {
    expect(storageUsage([])).toEqual({ count: 0, bytes: 0, favourites: 0 })
  })

  test('tolerates a row with no recorded size', () => {
    expect(storageUsage([entry({ bytes: Number.NaN })]).bytes).toBe(0)
  })
})

describe('formatBytes', () => {
  test.each([
    [0, '0 B'],
    [512, '512 B'],
    [1_500, '2 KB'],
    [400_000, '400 KB'],
    [1_543_000, '1.5 MB'],
  ])('formats %s as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  test('refuses to invent a size for nonsense', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-5)).toBe('—')
  })
})

describe('quotaPlan', () => {
  const limits = { maxCount: 3, maxBytes: 1_000_000 }
  const library = [
    entry({ id: 'oldest', capturedAt: 1, bytes: 300_000 }),
    entry({ id: 'older', capturedAt: 2, bytes: 300_000 }),
    entry({ id: 'newer', capturedAt: 3, bytes: 300_000 }),
    entry({ id: 'newest', capturedAt: 4, bytes: 300_000 }),
  ]

  test('evicts nothing when inside both budgets', () => {
    expect(quotaPlan(library.slice(0, 2), limits)).toEqual([])
  })

  test('evicts the oldest to meet the count budget', () => {
    expect(quotaPlan(library, { ...limits, maxBytes: 10_000_000 })).toEqual(['oldest'])
  })

  test('evicts as many as the byte budget needs', () => {
    expect(quotaPlan(library, { maxCount: 100, maxBytes: 700_000 })).toEqual([
      'oldest',
      'older',
    ])
  })

  /**
   * A favourite is the user saying "keep this one". Evicting it before an
   * unmarked capture would be actively wrong.
   */
  test('spares favourites while anything else can go', () => {
    const withFavourite = [
      entry({ id: 'kept', capturedAt: 1, bytes: 300_000, favourite: true }),
      entry({ id: 'plain', capturedAt: 4, bytes: 300_000 }),
    ]
    expect(quotaPlan(withFavourite, { maxCount: 1, maxBytes: 10_000_000 })).toEqual(['plain'])
  })

  test('evicts a favourite only when it is the only way to meet the budget', () => {
    const onlyFavourites = [
      entry({ id: 'a', capturedAt: 1, bytes: 500_000, favourite: true }),
      entry({ id: 'b', capturedAt: 2, bytes: 500_000, favourite: true }),
    ]
    expect(quotaPlan(onlyFavourites, { maxCount: 1, maxBytes: 10_000_000 })).toEqual(['a'])
  })

  test('never evicts more than it must', () => {
    const plan = quotaPlan(library, { maxCount: 3, maxBytes: 10_000_000 })
    expect(plan).toHaveLength(1)
  })
})

describe('selection', () => {
  test('toggling adds then removes', () => {
    expect(toggleSelected([], 'a')).toEqual(['a'])
    expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b'])
  })

  const visible = [entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' }), entry({ id: 'd' })]

  test('a range covers everything between anchor and target', () => {
    expect(selectRange(visible, 'b', 'd')).toEqual(['b', 'c', 'd'])
  })

  test('a range works backwards too', () => {
    expect(selectRange(visible, 'd', 'b')).toEqual(['b', 'c', 'd'])
  })

  test('a range of one is just that one', () => {
    expect(selectRange(visible, 'b', 'b')).toEqual(['b'])
  })

  /**
   * Ranges resolve against what is VISIBLE, so Shift-clicking in a filtered
   * view cannot silently select rows the filter is hiding.
   */
  test('an anchor that is no longer visible selects only the target', () => {
    expect(selectRange(visible, 'gone', 'c')).toEqual(['c'])
  })
})
