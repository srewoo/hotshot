/**
 * Capture history (PRD FR-25, FR-26).
 *
 * Two rules here are privacy promises rather than features:
 *   - An Incognito capture is NEVER written, whatever the retention setting.
 *     That rule ships even if history itself slips (FR-26).
 *   - Retention is enforced on read and on write, not only by a background
 *     job, because a service worker that never wakes would silently keep data
 *     past the window the user chose.
 *
 * The 20-capture cap is load-bearing for memory (PRD §6): blobs stay
 * compressed, only thumbnails decode.
 */

export const HISTORY_LIMIT = 20

export type Retention = 'session' | '7d' | '30d'

/** Where a capture was sent, so the library can offer to send it again. */
export interface HistoryDestination {
  readonly provider: string
  readonly key: string
  /** Deep link to the created or updated item, when the service gave one. */
  readonly url?: string | undefined
}

export interface HistoryEntry {
  readonly id: string
  readonly capturedAt: number
  readonly sourceUrl: string
  readonly title: string
  readonly widthDevicePx: number
  readonly heightDevicePx: number
  readonly bytes: number
  /** Captures taken in an Incognito window are never persisted. */
  readonly incognito: boolean
  /**
   * Kept out of the retention sweep.
   *
   * A capture worth keeping is worth keeping past seven days, and the
   * alternative — the user exporting it somewhere else to be safe — defeats
   * the point of a local library.
   */
  readonly favourite?: boolean | undefined
  /** Local labels. They never leave the machine and are never suggested. */
  readonly tags?: readonly string[] | undefined
  /** FR-25's "destination outcome". */
  readonly destination?: HistoryDestination | null | undefined
}

/** The storage surface, injected so the rules can be tested without IndexedDB. */
export interface HistoryStore {
  put(entry: HistoryEntry): Promise<void>
  all(): Promise<HistoryEntry[]>
  delete(ids: readonly string[]): Promise<void>
}

export interface HistoryRepo {
  record(entry: HistoryEntry): Promise<void>
  list(): Promise<HistoryEntry[]>
  remove(ids: readonly string[]): Promise<void>
  /** Merges a change into one entry: a favourite, a tag, a ship outcome. */
  update(id: string, patch: Partial<HistoryEntry>): Promise<void>
  prune(olderThan: number): Promise<void>
  clear(): Promise<void>
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The timestamp before which entries are expired for a given retention. */
export function expiredBefore(retention: Retention, now: number): number {
  switch (retention) {
    case 'session':
      return now
    case '7d':
      return now - 7 * DAY_MS
    case '30d':
      return now - 30 * DAY_MS
  }
}

const newestFirst = (a: HistoryEntry, b: HistoryEntry): number => b.capturedAt - a.capturedAt

export function createHistoryRepo(store: HistoryStore): HistoryRepo {
  async function sorted(): Promise<HistoryEntry[]> {
    return (await store.all()).sort(newestFirst)
  }

  return {
    async record(entry) {
      // The check is here, at the single write path, rather than at each call
      // site — a caller that forgets is a privacy incident.
      if (entry.incognito) return

      await store.put(entry)

      // Quota management, at the write path. Favourites are exempt: the cap
      // exists to bound memory, and a user who marked something is telling us
      // which twenty to bound.
      const entries = await sorted()
      const evictable = entries.filter((e) => !e.favourite)
      const overBy = entries.length - HISTORY_LIMIT
      if (overBy > 0 && evictable.length > 0) {
        await store.delete(evictable.slice(-overBy).map((e) => e.id))
      }
    },

    list: sorted,

    async remove(ids) {
      if (ids.length > 0) await store.delete(ids)
    },

    async update(id, patch) {
      const existing = (await store.all()).find((entry) => entry.id === id)
      // A patch for an entry that has been pruned is dropped, not resurrected
      // as a partial row with no capture behind it.
      if (!existing) return
      await store.put({ ...existing, ...patch, id: existing.id })
    },

    async prune(olderThan) {
      const stale = (await store.all()).filter(
        (e) => e.capturedAt < olderThan && !e.favourite,
      )
      if (stale.length > 0) await store.delete(stale.map((e) => e.id))
    },

    async clear() {
      await store.delete((await store.all()).map((e) => e.id))
    },
  }
}
