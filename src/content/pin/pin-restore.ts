/**
 * Recovering pins lost to navigation (PRD FR-38, DESIGN §3.9).
 *
 * A pin deliberately does not survive navigation: silently resurrecting an
 * overlay on an unexpected page would be worse than losing it. But the loss
 * has to be recoverable, so a six-second strip turns it into one keypress —
 * backed by real persisted capture ids, because an offer the product cannot
 * honour is worse than no offer.
 */

/** Long enough that the user still remembers what they lost; short enough not to clutter. */
export const RESTORE_WINDOW_MS = 6_000

export interface RestoreStore {
  read(origin: string): Promise<string[]>
  write(origin: string, ids: string[]): Promise<void>
}

export interface PinRestore {
  remember(origin: string, ids: readonly string[], now: number): Promise<void>
  pending(origin: string, now: number): Promise<string[]>
  /** Returns the ids and clears the offer, so it can never fire twice. */
  consume(origin: string, now: number): Promise<string[]>
}

/** Stored as `<timestamp>:<id>` so the window can be checked without a second key. */
const encode = (ids: readonly string[], now: number): string[] =>
  ids.map((id) => `${now}:${id}`)

function decode(rows: readonly string[], now: number): string[] {
  const fresh: string[] = []
  for (const row of rows) {
    const separator = row.indexOf(':')
    if (separator === -1) continue
    const at = Number(row.slice(0, separator))
    if (!Number.isFinite(at) || now - at > RESTORE_WINDOW_MS) continue
    fresh.push(row.slice(separator + 1))
  }
  return fresh
}

export function createPinRestore(store: RestoreStore): PinRestore {
  return {
    async remember(origin, ids, now) {
      // Replaces rather than appends: the offer is about THIS navigation, and
      // accumulating would resurrect pins the user dismissed long ago.
      await store.write(origin, ids.length > 0 ? encode(ids, now) : [])
    },

    async pending(origin, now) {
      return decode(await store.read(origin), now)
    },

    async consume(origin, now) {
      const fresh = decode(await store.read(origin), now)
      await store.write(origin, [])
      return fresh
    },
  }
}
