import type { HistoryEntry } from './history-repo'

/**
 * Searching, selecting and accounting for the local library (PRD FR-25).
 *
 * All of it is pure, and all of it is local. That is the point worth stating:
 * a hosted product would answer these questions on a server with an index, and
 * the reason Hotshot can answer them in a pure function over twenty rows is
 * the same reason it has no backend to leak.
 */

export type LibraryLayout = 'grid' | 'list'

export interface LibraryFilter {
  readonly query?: string
  readonly favouritesOnly?: boolean
  readonly tag?: string | null
  /** Only captures that reached this service. */
  readonly destination?: string | null
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    // A capture from a page with an unparseable URL still deserves to be
    // findable by its title.
    return ''
  }
}

/**
 * Whether an entry matches a free-text query.
 *
 * Searches title, full URL, hostname, tags and destination together, because
 * people remember a capture by whichever of those stuck — "the invoice one",
 * "the one from staging", "the one I put in ABC-412".
 */
export function matchesQuery(entry: HistoryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  const haystack = [
    entry.title,
    entry.sourceUrl,
    hostOf(entry.sourceUrl),
    ...(entry.tags ?? []),
    entry.destination?.provider ?? '',
    entry.destination?.key ?? '',
  ]
    .join(' ')
    .toLowerCase()

  // Every whitespace-separated term must appear: "invoice abc" narrows rather
  // than widening, which is what makes a second word useful at all.
  return needle.split(/\s+/).every((term) => haystack.includes(term))
}

export function filterEntries(
  entries: readonly HistoryEntry[],
  filter: LibraryFilter = {},
): readonly HistoryEntry[] {
  return entries.filter((entry) => {
    if (filter.favouritesOnly && !entry.favourite) return false
    if (filter.tag && !(entry.tags ?? []).includes(filter.tag)) return false
    if (filter.destination && entry.destination?.provider !== filter.destination) return false
    return matchesQuery(entry, filter.query ?? '')
  })
}

/** Every tag in use, sorted, so the filter row is stable between renders. */
export function allTags(entries: readonly HistoryEntry[]): readonly string[] {
  return [...new Set(entries.flatMap((entry) => entry.tags ?? []))].sort((a, b) =>
    a.localeCompare(b),
  )
}

/**
 * Adds a tag to an entry's list.
 *
 * Normalised and deduplicated here rather than at the call site: a library
 * with both "Bug" and "bug" in its filter row is a library nobody trusts.
 */
export function withTag(
  tags: readonly string[] | undefined,
  tag: string,
): readonly string[] {
  const clean = tag.trim().toLowerCase().slice(0, 24)
  if (!clean) return tags ?? []
  return [...new Set([...(tags ?? []), clean])].sort((a, b) => a.localeCompare(b))
}

export function withoutTag(
  tags: readonly string[] | undefined,
  tag: string,
): readonly string[] {
  return (tags ?? []).filter((entry) => entry !== tag)
}

export interface StorageUsage {
  readonly count: number
  readonly bytes: number
  readonly favourites: number
}

export function storageUsage(entries: readonly HistoryEntry[]): StorageUsage {
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    favourites: entries.filter((entry) => entry.favourite).length,
  }
}

/** Human bytes. `MB` at three digits, because "1543 KB" is not a size anyone reads. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1_000) return `${Math.round(bytes)} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * Which entries to evict to get back under a budget.
 *
 * Oldest first, favourites last resort. Returning the ids rather than deleting
 * them keeps the decision testable and lets the caller tell the user what is
 * about to go — a library that silently drops captures is one people stop
 * relying on, which is the only thing it has.
 */
export function quotaPlan(
  entries: readonly HistoryEntry[],
  limits: { readonly maxCount: number; readonly maxBytes: number },
): readonly string[] {
  const oldestFirst = [...entries].sort((a, b) => a.capturedAt - b.capturedAt)
  // Favourites are evicted only after everything else, and only if the budget
  // still cannot be met.
  const ordered = [
    ...oldestFirst.filter((entry) => !entry.favourite),
    ...oldestFirst.filter((entry) => entry.favourite),
  ]

  const evicted: string[] = []
  let count = entries.length
  let bytes = storageUsage(entries).bytes

  for (const entry of ordered) {
    if (count <= limits.maxCount && bytes <= limits.maxBytes) break
    evicted.push(entry.id)
    count -= 1
    bytes -= entry.bytes || 0
  }
  return evicted
}

/** Toggles one id in a selection, which is all multi-select needs to be. */
export function toggleSelected(
  selected: readonly string[],
  id: string,
): readonly string[] {
  return selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]
}

/**
 * Extends a selection to a range, for Shift-click.
 *
 * Anchored on the last selected id and resolved against the CURRENTLY VISIBLE
 * order, so a range means what the user can see rather than what the store
 * happens to hold.
 */
export function selectRange(
  visible: readonly HistoryEntry[],
  anchorId: string,
  toId: string,
): readonly string[] {
  const from = visible.findIndex((entry) => entry.id === anchorId)
  const to = visible.findIndex((entry) => entry.id === toId)
  if (from === -1 || to === -1) return [toId]
  const [start, end] = from <= to ? [from, to] : [to, from]
  return visible.slice(start, end + 1).map((entry) => entry.id)
}
