import type { TargetCandidate } from '../integrations/provider'
import type { ProviderId } from '../storage/token-repo'

/**
 * A short-lived local cache of destination targets (PRD FR-41).
 *
 * The picker opens on every capture, and asking a service for the same
 * recently-viewed list several times a minute is rude to the service and slow
 * for the user. It is deliberately SHORT-lived and local: a stale list is
 * worse than a fresh one because the whole point is to show work in progress,
 * and this is exactly the sort of data that must never leave the machine.
 *
 * Only the empty-query list is cached. A typed query is a live search: caching
 * those would mean showing results for a prefix the user has moved past.
 */

export const CACHE_TTL_MS = 60_000
const PREFIX = 'hotshot.targets.'

export interface CacheEntry {
  readonly at: number
  readonly candidates: readonly TargetCandidate[]
}

export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export function isFresh(entry: CacheEntry | null, now: number, ttlMs = CACHE_TTL_MS): boolean {
  if (!entry) return false
  // A clock that has gone backwards must not make an entry immortal.
  const age = now - entry.at
  return age >= 0 && age < ttlMs
}

export function parseEntry(value: unknown): CacheEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as { at?: unknown; candidates?: unknown }
  if (typeof entry.at !== 'number' || !Array.isArray(entry.candidates)) return null

  const candidates = entry.candidates.filter(
    (candidate): candidate is TargetCandidate =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as TargetCandidate).key === 'string' &&
      typeof (candidate as TargetCandidate).title === 'string',
  )
  return { at: entry.at, candidates }
}

export function createTargetCache(area: StorageArea, ttlMs = CACHE_TTL_MS) {
  const keyFor = (id: ProviderId): string => `${PREFIX}${id}`

  return {
    async read(id: ProviderId, now = Date.now()): Promise<readonly TargetCandidate[] | null> {
      const stored = await area.get([keyFor(id)])
      const entry = parseEntry(stored[keyFor(id)])
      return isFresh(entry, now, ttlMs) ? (entry as CacheEntry).candidates : null
    },

    async write(
      id: ProviderId,
      candidates: readonly TargetCandidate[],
      now = Date.now(),
    ): Promise<void> {
      await area.set({ [keyFor(id)]: { at: now, candidates } satisfies CacheEntry })
    },

    /** Called when a token is revoked: cached titles are account data. */
    async clear(id: ProviderId): Promise<void> {
      await area.remove([keyFor(id)])
    },
  }
}
